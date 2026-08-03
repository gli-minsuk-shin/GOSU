import { EventEmitter } from 'node:events';
import { WebSocket as WsWebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import type { Identity } from '../src/auth.js';
import {
  RELAY_MAX_BUFFERED_BYTES,
  RelayGateway,
  isTrustedRelayHandshake,
} from '../src/relay.gateway.js';
import { SyncStore } from '../src/store.js';

const identity: Identity = {
  issuer: 'gosu:test',
  subject: 'lead-fixture',
  labId: 'lab-demo',
  role: 'project_lead',
};

class FakeSocket extends EventEmitter {
  readyState: number = WsWebSocket.OPEN;
  bufferedAmount = 0;
  gosuIdentity?: Identity;
  gosuProjectId?: string;
  gosuKind?: 'runner' | 'viewer';
  gosuOriginlessRunner?: boolean;
  sent: unknown[] = [];
  closed?: { code: number; reason: string };

  send(payload: string, callback?: (error?: Error) => void) {
    this.sent.push(JSON.parse(payload) as unknown);
    callback?.();
  }

  close(code: number, reason: string) {
    this.closed = { code, reason };
    this.readyState = WsWebSocket.CLOSING;
  }
}

function transport(eventId: string, sequence: number) {
  return {
    type: 'runner.event',
    projectId: 'project-vision',
    runnerId: 'runner-1',
    event: {
      schemaVersion: 1,
      eventId,
      runnerId: 'runner-1',
      campaignId: 'campaign-1',
      trialId: 'trial-1',
      attemptId: 'attempt-1',
      sequence,
      occurredAt: '2026-08-03T08:00:00.000Z',
      kind: 'state',
      state: 'running',
    },
  };
}

function dispatch(gateway: RelayGateway, client: FakeSocket, value: unknown) {
  const internals = gateway as unknown as {
    handleMessage(target: FakeSocket, payload: Buffer): void;
  };
  internals.handleMessage(client, Buffer.from(JSON.stringify(value)));
}

describe('RelayGateway', () => {
  it('fails closed for foreign browser origins and permits originless declared runners only', () => {
    expect(isTrustedRelayHandshake({ origin: 'https://attacker.invalid' })).toBe(false);
    expect(isTrustedRelayHandshake({})).toBe(false);
    expect(isTrustedRelayHandshake({ 'x-gosu-client-kind': 'runner' })).toBe(true);
    expect(isTrustedRelayHandshake({ origin: 'http://127.0.0.1:3000' })).toBe(true);
  });

  it('ACKs accepted and exact duplicate events without rebroadcasting duplicates or stale events', () => {
    const store = new SyncStore();
    const gateway = new RelayGateway(store);
    const runner = new FakeSocket();
    runner.gosuIdentity = identity;
    runner.gosuOriginlessRunner = true;
    const viewer = new FakeSocket();
    viewer.gosuKind = 'viewer';
    viewer.gosuProjectId = 'project-vision';
    gateway.server = { clients: new Set([runner, viewer]) } as never;

    dispatch(gateway, runner, transport('event-1', 1));
    dispatch(gateway, runner, transport('event-1', 1));
    dispatch(gateway, runner, transport('event-stale', 0));

    expect(viewer.sent).toHaveLength(1);
    expect(runner.sent).toEqual([
      { type: 'events.ack', sequence: 1 },
      { type: 'events.ack', sequence: 1 },
      {
        type: 'error',
        code: 'stale_runner_event',
        eventId: 'event-stale',
        lastSequence: 1,
      },
    ]);
  });

  it('accepts an authenticated originless runner hello and rejects browser event publishing', () => {
    const store = new SyncStore();
    const gateway = new RelayGateway(store);
    gateway.server = { clients: new Set() } as never;

    const runner = new FakeSocket();
    runner.gosuIdentity = identity;
    runner.gosuOriginlessRunner = true;
    dispatch(gateway, runner, {
      type: 'runner.hello',
      projectId: 'project-vision',
      runnerId: 'runner-1',
      protocolVersion: 'v1',
    });
    expect(runner.sent).toEqual([
      {
        type: 'runner.hello.ack',
        projectId: 'project-vision',
        runnerId: 'runner-1',
        protocolVersion: 'v1',
      },
    ]);

    const browser = new FakeSocket();
    browser.gosuIdentity = identity;
    dispatch(gateway, browser, transport('event-browser-forgery', 1));
    expect(browser.sent).toEqual([{ type: 'error', code: 'invalid_relay_payload' }]);
    expect(store.listRunSummaries('project-vision')).toEqual([]);
  });

  it('disconnects a slow viewer instead of growing an unbounded relay buffer', () => {
    const store = new SyncStore();
    const gateway = new RelayGateway(store);
    const runner = new FakeSocket();
    runner.gosuIdentity = identity;
    runner.gosuOriginlessRunner = true;
    const viewer = new FakeSocket();
    viewer.gosuKind = 'viewer';
    viewer.gosuProjectId = 'project-vision';
    viewer.bufferedAmount = RELAY_MAX_BUFFERED_BYTES + 1;
    gateway.server = { clients: new Set([runner, viewer]) } as never;

    dispatch(gateway, runner, transport('event-2', 1));

    expect(viewer.sent).toEqual([]);
    expect(viewer.closed).toEqual({ code: 1013, reason: 'relay_backpressure' });
  });
});
