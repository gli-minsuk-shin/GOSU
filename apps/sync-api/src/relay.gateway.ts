import { Inject, Injectable, Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { Buffer } from 'node:buffer';
import { WebSocket as WsWebSocket, type RawData, type Server } from 'ws';
import { authenticateHeaders, type Identity } from './auth.js';
import { runnerEventTransportSchema } from './contracts.js';
import { SyncStore } from './store.js';

export const RELAY_MAX_PAYLOAD_BYTES = 128 * 1024;
export const RELAY_MAX_BUFFERED_BYTES = 512 * 1024;

type RelayClient = WsWebSocket & {
  gosuIdentity?: Identity;
  gosuProjectId?: string;
  gosuKind?: 'runner' | 'viewer';
  gosuOriginlessRunner?: boolean;
};

function firstHeader(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function allowedRelayOrigins(raw = process.env.GOSU_ALLOWED_ORIGINS): ReadonlySet<string> {
  const configured = raw ?? 'http://127.0.0.1:3000,http://localhost:3000';
  const origins = configured
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return '';
      }
    })
    .filter(Boolean);
  return new Set(origins);
}

export function isTrustedRelayHandshake(headers: IncomingHttpHeaders): boolean {
  const origin = firstHeader(headers, 'origin');
  if (origin === undefined) {
    // Native runners do not send a browser Origin. They must declare their client class and
    // still pass the same authentication check as every other relay peer.
    return firstHeader(headers, 'x-gosu-client-kind') === 'runner';
  }
  try {
    return allowedRelayOrigins().has(new URL(origin).origin);
  } catch {
    return false;
  }
}

@Injectable()
@WebSocketGateway({
  path: '/v1/relay',
  maxPayload: RELAY_MAX_PAYLOAD_BYTES,
  perMessageDeflate: false,
})
export class RelayGateway {
  private readonly logger = new Logger(RelayGateway.name);
  @WebSocketServer() server!: Server;

  constructor(@Inject(SyncStore) private readonly store: SyncStore) {}

  async handleConnection(client: RelayClient, request: IncomingMessage) {
    if (!isTrustedRelayHandshake(request.headers)) {
      client.close(1008, 'untrusted_origin');
      return;
    }

    try {
      client.gosuIdentity = await authenticateHeaders(request.headers);
      client.gosuOriginlessRunner =
        firstHeader(request.headers, 'origin') === undefined &&
        firstHeader(request.headers, 'x-gosu-client-kind') === 'runner';
    } catch {
      client.close(1008, 'authentication_required');
      return;
    }

    client.on('message', (buffer) => this.handleMessage(client, buffer));
    client.on('error', () => this.logger.warn('Relay peer disconnected after a socket error'));
  }

  private handleMessage(client: RelayClient, buffer: RawData) {
    if (Buffer.byteLength(buffer.toString(), 'utf8') > RELAY_MAX_PAYLOAD_BYTES) {
      client.close(1009, 'relay_payload_too_large');
      return;
    }

    try {
      const identity = client.gosuIdentity;
      if (!identity) throw new Error('authentication_required');
      const message = JSON.parse(buffer.toString()) as Record<string, unknown>;
      if (message.type === 'subscribe' && typeof message.projectId === 'string') {
        if (client.gosuOriginlessRunner) throw new Error('originless_viewer_forbidden');
        this.assertProject(identity, message.projectId);
        client.gosuKind = 'viewer';
        client.gosuProjectId = message.projectId;
        this.sendJson(client, {
          type: 'subscribed',
          projectId: message.projectId,
          persistence: 'none',
        });
        return;
      }

      if (message.type === 'runner.hello') {
        if (!client.gosuOriginlessRunner) throw new Error('runner_identity_required');
        if (
          typeof message.projectId !== 'string' ||
          typeof message.runnerId !== 'string' ||
          message.protocolVersion !== 'v1'
        ) {
          throw new Error('invalid_runner_hello');
        }
        this.assertProject(identity, message.projectId);
        if (identity.role !== 'owner' && identity.role !== 'project_lead') {
          throw new Error('runner_publish_forbidden');
        }
        client.gosuKind = 'runner';
        client.gosuProjectId = message.projectId;
        this.sendJson(client, {
          type: 'runner.hello.ack',
          projectId: message.projectId,
          runnerId: message.runnerId,
          protocolVersion: 'v1',
        });
        return;
      }

      const transport = runnerEventTransportSchema.parse(message);
      if (!client.gosuOriginlessRunner) throw new Error('runner_identity_required');
      this.assertProject(identity, transport.projectId);
      if (identity.role !== 'owner' && identity.role !== 'project_lead') {
        throw new Error('runner_publish_forbidden');
      }
      client.gosuKind = 'runner';
      client.gosuProjectId = transport.projectId;
      const result = this.store.projectRunnerEvent(transport);
      if (result.disposition === 'stale') {
        this.sendJson(client, {
          type: 'error',
          code: 'stale_runner_event',
          eventId: transport.event.eventId,
          lastSequence: result.summary.lastSequence,
        });
        return;
      }

      if (result.disposition === 'accepted') {
        for (const peer of this.server.clients as Set<RelayClient>) {
          if (
            peer !== client &&
            peer.readyState === WsWebSocket.OPEN &&
            peer.gosuKind === 'viewer' &&
            peer.gosuProjectId === transport.projectId
          ) {
            this.sendJson(peer, transport);
          }
        }
      }

      this.sendJson(client, {
        type: 'events.ack',
        sequence: transport.event.sequence,
      });
    } catch {
      this.logger.warn('Rejected relay payload');
      this.sendJson(client, { type: 'error', code: 'invalid_relay_payload' });
    }
  }

  private sendJson(client: RelayClient, value: unknown) {
    if (client.readyState !== WsWebSocket.OPEN) return false;
    if (client.bufferedAmount > RELAY_MAX_BUFFERED_BYTES) {
      client.close(1013, 'relay_backpressure');
      return false;
    }
    const payload = JSON.stringify(value);
    if (Buffer.byteLength(payload, 'utf8') > RELAY_MAX_PAYLOAD_BYTES) {
      client.close(1009, 'relay_payload_too_large');
      return false;
    }
    client.send(payload, (error) => {
      if (error) client.close(1011, 'relay_send_failed');
    });
    return true;
  }

  private assertProject(identity: Identity, projectId: string) {
    if (this.store.projectLabId(projectId) !== identity.labId) {
      throw new Error('cross_lab_access_denied');
    }
  }
}
