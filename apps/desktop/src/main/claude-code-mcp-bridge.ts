import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rmdir, unlink } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import type { ProjectToolActivity } from '../shared/project-tool-activity';
import {
  projectToolStartedActivity,
  projectToolCompletedActivity,
  projectToolProgressTiming,
} from './project-tool-activity';

import type {
  CodexDynamicToolCall,
  CodexDynamicToolHandler,
  CodexDynamicToolSpec,
  CodexDynamicToolTimeoutOverride,
  CodexJsonValue,
} from './codex-app-server';

const MCP_SERVER_NAME = 'gosu_project';
const MCP_MAX_LINE_BYTES = 1_048_576;
const MCP_DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export const CLAUDE_CODE_MCP_PROXY_SCRIPT = String.raw`
const net = require('node:net');
const readline = require('node:readline');
const socketPath = process.env.GOSU_CLAUDE_MCP_SOCKET;
const token = process.env.GOSU_CLAUDE_MCP_TOKEN;
if (!socketPath || !token) process.exit(78);
const socket = net.createConnection(socketPath);
let authenticated = false;
let buffer = '';
const pending = [];
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  if (authenticated) socket.write(line + '\n');
  else pending.push(line);
});
socket.on('connect', () => socket.write(JSON.stringify({ type: 'auth', token }) + '\n'));
socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  for (;;) {
    const newline = buffer.indexOf('\n');
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!authenticated) {
      let message;
      try { message = JSON.parse(line); } catch { process.exit(76); }
      if (!message || message.type !== 'auth_ok') process.exit(77);
      authenticated = true;
      for (const queued of pending.splice(0)) socket.write(queued + '\n');
      continue;
    }
    process.stdout.write(line + '\n');
  }
});
socket.on('error', () => process.exit(74));
socket.on('close', () => process.exit(0));
process.stdin.on('end', () => socket.end());
`;

type JsonRpcId = string | number;

type JsonRpcRequest = Readonly<{
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}>;

type FlattenedTool = Readonly<{
  namespace: string | null;
  name: string;
  description: string;
  inputSchema: CodexJsonValue;
}>;

type ActiveTurn = Readonly<{
  turnId: string;
  signal: AbortSignal;
}>;

export type ClaudeCodeMcpToolEvent = Readonly<{
  phase: 'started' | 'completed';
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  success?: boolean;
  activity?: ProjectToolActivity | undefined;
  occurredAt?: string;
  elapsedMs?: number;
}>;

export type ClaudeCodeMcpBridgeOptions = Readonly<{
  threadId: string;
  dynamicTools: readonly CodexDynamicToolSpec[];
  dynamicToolHandler: CodexDynamicToolHandler;
  dynamicToolTimeouts?: readonly CodexDynamicToolTimeoutOverride[];
  onToolEvent?: (event: ClaudeCodeMcpToolEvent) => void;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonRpcId(value: unknown): JsonRpcId | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function flattenedTools(specs: readonly CodexDynamicToolSpec[]): readonly FlattenedTool[] {
  const tools: FlattenedTool[] = [];
  for (const spec of specs) {
    if (spec.type === 'namespace') {
      for (const tool of spec.tools) {
        tools.push({
          namespace: spec.name,
          name: tool.name,
          description: `${spec.description}\n\n${tool.description}`,
          inputSchema: tool.inputSchema,
        });
      }
    } else {
      tools.push({
        namespace: null,
        name: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema,
      });
    }
  }
  return tools;
}

function errorMessage(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } } as const;
}

function resultMessage(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0', id, result } as const;
}

function deferredDelivery() {
  let resolve!: (value: 'delivered' | 'discarded' | 'uncertain') => void;
  const outcome = new Promise<'delivered' | 'discarded' | 'uncertain'>((settle) => {
    resolve = settle;
  });
  return { outcome, resolve };
}

export class ClaudeCodeMcpBridge {
  readonly serverName = MCP_SERVER_NAME;
  readonly socketPath: string;
  private readonly token = randomBytes(32).toString('hex');
  private readonly tools: readonly FlattenedTool[];
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly activeCalls = new Map<string, AbortController>();
  private activeTurn: ActiveTurn | null = null;
  private revoked = false;
  private disposed = false;

  private constructor(
    private readonly directory: string,
    private readonly options: ClaudeCodeMcpBridgeOptions,
    server: Server,
    tools: readonly FlattenedTool[],
  ) {
    this.socketPath = join(directory, 'bridge.sock');
    this.tools = tools;
    this.server = server;
  }

  static async create(options: ClaudeCodeMcpBridgeOptions) {
    if (options.dynamicTools.length === 0) throw new Error('claude_mcp_tools_empty');
    const tools = flattenedTools(options.dynamicTools);
    if (
      tools.length === 0 ||
      tools.length > 64 ||
      tools.some(
        (tool) =>
          tool.namespace !== MCP_SERVER_NAME || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(tool.name),
      ) ||
      new Set(tools.map((tool) => tool.name)).size !== tools.length
    ) {
      throw new Error('claude_mcp_tool_catalog_invalid');
    }
    const directory = await mkdtemp('/tmp/gosu-claude-mcp-');
    await chmod(directory, 0o700);
    const server = createServer();
    const bridge = new ClaudeCodeMcpBridge(directory, options, server, tools);
    server.on('connection', (socket) => bridge.accept(socket));
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(bridge.socketPath);
      });
      await chmod(bridge.socketPath, 0o600);
      return bridge;
    } catch (error) {
      server.close();
      await unlink(bridge.socketPath).catch(() => undefined);
      await rmdir(directory).catch(() => undefined);
      throw error;
    }
  }

  mcpConfig(command = process.execPath) {
    return {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'stdio',
          command,
          args: ['--eval', CLAUDE_CODE_MCP_PROXY_SCRIPT],
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            GOSU_CLAUDE_MCP_SOCKET: this.socketPath,
            GOSU_CLAUDE_MCP_TOKEN: this.token,
          },
        },
      },
    } as const;
  }

  beginTurn(turnId: string, signal: AbortSignal) {
    if (this.revoked || this.disposed) throw new Error('claude_mcp_revoked');
    if (this.activeTurn) throw new Error('claude_mcp_turn_busy');
    this.activeTurn = { turnId, signal };
  }

  endTurn(turnId: string) {
    if (this.activeTurn?.turnId !== turnId) return;
    this.activeTurn = null;
    for (const controller of this.activeCalls.values()) controller.abort();
    this.activeCalls.clear();
  }

  revoke() {
    if (this.revoked) return;
    this.revoked = true;
    if (this.activeTurn) this.endTurn(this.activeTurn.turnId);
    for (const socket of this.sockets) socket.destroy();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.revoke();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await unlink(this.socketPath).catch(() => undefined);
    await rmdir(this.directory).catch(() => undefined);
  }

  private accept(socket: Socket) {
    if (this.revoked || this.disposed || this.sockets.size > 0) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    let authenticated = false;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MCP_MAX_LINE_BYTES) {
        socket.destroy();
        return;
      }
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!authenticated) {
          try {
            const auth = JSON.parse(line) as unknown;
            if (!isRecord(auth) || auth.type !== 'auth' || auth.token !== this.token) {
              socket.destroy();
              return;
            }
          } catch {
            socket.destroy();
            return;
          }
          authenticated = true;
          this.send(socket, { type: 'auth_ok' });
          continue;
        }
        void this.handleLine(socket, line);
      }
    });
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  }

  private async handleLine(socket: Socket, line: string) {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      this.send(socket, errorMessage(0, -32700, 'Parse error'));
      return;
    }
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') return;
    const id = jsonRpcId(request.id);
    if (
      request.method === 'notifications/initialized' ||
      request.method === 'notifications/cancelled'
    ) {
      return;
    }
    if (id === null) return;
    if (request.method === 'initialize') {
      const protocolVersion =
        isRecord(request.params) && typeof request.params.protocolVersion === 'string'
          ? request.params.protocolVersion
          : '2025-11-25';
      this.send(
        socket,
        resultMessage(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'GOSU project tools', version: '1' },
        }),
      );
      return;
    }
    if (request.method === 'ping') {
      this.send(socket, resultMessage(id, {}));
      return;
    }
    if (request.method === 'tools/list') {
      this.send(
        socket,
        resultMessage(id, {
          tools: this.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        }),
      );
      return;
    }
    if (request.method === 'tools/call') {
      await this.callTool(socket, id, request.params);
      return;
    }
    this.send(socket, errorMessage(id, -32601, 'Method not found'));
  }

  private async callTool(socket: Socket, id: JsonRpcId, params: unknown) {
    const turn = this.activeTurn;
    if (this.revoked || !turn) {
      this.send(socket, errorMessage(id, -32001, 'Tool transport is not active'));
      return;
    }
    if (!isRecord(params) || typeof params.name !== 'string') {
      this.send(socket, errorMessage(id, -32602, 'Invalid tool arguments'));
      return;
    }
    const tool = this.tools.find((candidate) => candidate.name === params.name);
    if (!tool) {
      this.send(socket, errorMessage(id, -32602, 'Unknown tool'));
      return;
    }
    const callId = `claude-mcp:${randomUUID()}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    turn.signal.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutFor(tool));
    this.activeCalls.set(callId, controller);
    const delivery = deferredDelivery();
    const call: CodexDynamicToolCall = {
      threadId: this.options.threadId,
      turnId: turn.turnId,
      callId,
      namespace: tool.namespace,
      tool: tool.name,
      arguments: (params.arguments ?? {}) as CodexJsonValue,
    };
    const startedAt = Date.now();
    const notify = (event: ClaudeCodeMcpToolEvent) => {
      try {
        this.options.onToolEvent?.(event);
      } catch {
        /* Telemetry cannot alter tool execution. */
      }
    };
    notify({
      phase: 'started',
      threadId: call.threadId,
      turnId: call.turnId,
      callId,
      tool: tool.name,
      activity: projectToolStartedActivity(tool.name, call.arguments),
      occurredAt: new Date(startedAt).toISOString(),
    });
    try {
      const result = await this.options.dynamicToolHandler(call, {
        outcome: delivery.outcome,
        abortSignal: controller.signal,
      });
      const sent = this.send(
        socket,
        resultMessage(id, {
          content: result.contentItems.map((item) => ({ type: 'text', text: item.text })),
          isError: !result.success,
        }),
      );
      delivery.resolve(sent ? 'delivered' : 'uncertain');
      notify({
        phase: 'completed',
        threadId: call.threadId,
        turnId: call.turnId,
        callId,
        tool: tool.name,
        ...projectToolCompletedActivity(
          tool.name,
          call.arguments,
          result,
          timedOut
            ? 'tool_timeout'
            : controller.signal.aborted
              ? 'tool_cancelled'
              : sent
                ? undefined
                : 'tool_delivery_failed',
        ),
        ...projectToolProgressTiming(startedAt),
      });
    } catch {
      const sent = this.send(
        socket,
        resultMessage(id, {
          content: [{ type: 'text', text: 'tool_execution_failed' }],
          isError: true,
        }),
      );
      delivery.resolve(sent ? 'delivered' : 'uncertain');
      notify({
        phase: 'completed',
        threadId: call.threadId,
        turnId: call.turnId,
        callId,
        tool: tool.name,
        ...projectToolCompletedActivity(
          tool.name,
          call.arguments,
          undefined,
          timedOut
            ? 'tool_timeout'
            : controller.signal.aborted
              ? 'tool_cancelled'
              : 'tool_execution_failed',
        ),
        ...projectToolProgressTiming(startedAt),
      });
    } finally {
      clearTimeout(timeout);
      turn.signal.removeEventListener('abort', abort);
      this.activeCalls.delete(callId);
    }
  }

  private timeoutFor(tool: FlattenedTool) {
    return (
      this.options.dynamicToolTimeouts?.find(
        (override) => override.namespace === tool.namespace && override.tool === tool.name,
      )?.timeoutMs ?? MCP_DEFAULT_TOOL_TIMEOUT_MS
    );
  }

  private send(socket: Socket, message: unknown) {
    if (socket.destroyed || !socket.writable) return false;
    return socket.write(`${JSON.stringify(message)}\n`);
  }
}
