import { createConnection, type Socket } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CLAUDE_CODE_MCP_PROXY_SCRIPT,
  ClaudeCodeMcpBridge,
} from '../src/main/claude-code-mcp-bridge';

const bridges: ClaudeCodeMcpBridge[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.dispose()));
});

function lineReader(socket: Socket) {
  let buffer = '';
  const pending: ((value: unknown) => void)[] = [];
  const queued: unknown[] = [];
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const value = JSON.parse(buffer.slice(0, newline)) as unknown;
      buffer = buffer.slice(newline + 1);
      const resolve = pending.shift();
      if (resolve) resolve(value);
      else queued.push(value);
    }
  });
  return () =>
    queued.length > 0
      ? Promise.resolve(queued.shift())
      : new Promise<unknown>((resolve) => pending.push(resolve));
}

async function connect(bridge: ClaudeCodeMcpBridge) {
  const config = bridge.mcpConfig('/Applications/GOSU.app/Contents/MacOS/GOSU');
  const server = config.mcpServers.gosu_project;
  expect(server.command).toBe('/Applications/GOSU.app/Contents/MacOS/GOSU');
  expect(server.args).toEqual(['--eval', CLAUDE_CODE_MCP_PROXY_SCRIPT]);
  expect(server.env.ELECTRON_RUN_AS_NODE).toBe('1');
  const socket = createConnection(server.env.GOSU_CLAUDE_MCP_SOCKET);
  const nextLine = lineReader(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  socket.write(`${JSON.stringify({ type: 'auth', token: server.env.GOSU_CLAUDE_MCP_TOKEN })}\n`);
  await expect(nextLine()).resolves.toEqual({ type: 'auth_ok' });
  return { socket, nextLine };
}

describe('ClaudeCodeMcpBridge', () => {
  it('rejects any tool catalog outside the single GOSU project namespace', async () => {
    await expect(
      ClaudeCodeMcpBridge.create({
        threadId: 'claude-code:thread:invalid',
        dynamicTools: [
          {
            type: 'namespace',
            name: 'personal_tools',
            description: 'Must never be exposed',
            tools: [
              {
                type: 'function',
                name: 'read_home',
                description: 'Unsafe fixture',
                inputSchema: { type: 'object' },
              },
            ],
          },
        ],
        dynamicToolHandler: vi.fn(),
      }),
    ).rejects.toThrow('claude_mcp_tool_catalog_invalid');
  });

  it('publishes only the supplied GOSU namespace and delivers bounded tool calls', async () => {
    const handler = vi.fn(async () => ({
      contentItems: [{ type: 'inputText' as const, text: '{"project":"bounded"}' }],
      success: true,
    }));
    const onToolEvent = vi.fn();
    const bridge = await ClaudeCodeMcpBridge.create({
      threadId: 'claude-code:thread:fixture',
      dynamicTools: [
        {
          type: 'namespace',
          name: 'gosu_project',
          description: 'Bounded project tools',
          tools: [
            {
              type: 'function',
              name: 'read_workspace',
              description: 'Read bounded workspace state',
              inputSchema: {
                type: 'object',
                properties: { section: { type: 'string' } },
                required: ['section'],
                additionalProperties: false,
              },
            },
          ],
        },
      ],
      dynamicToolHandler: handler,
      onToolEvent,
    });
    bridges.push(bridge);
    const turnAbort = new AbortController();
    bridge.beginTurn('claude-code:turn:fixture', turnAbort.signal);
    const { socket, nextLine } = await connect(bridge);

    socket.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      })}\n`,
    );
    await expect(nextLine()).resolves.toMatchObject({
      id: 1,
      result: { capabilities: { tools: { listChanged: false } } },
    });
    socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    await expect(nextLine()).resolves.toMatchObject({
      id: 2,
      result: { tools: [{ name: 'read_workspace' }] },
    });
    socket.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'read_workspace', arguments: { section: 'summary' } },
      })}\n`,
    );
    await expect(nextLine()).resolves.toMatchObject({
      id: 3,
      result: {
        content: [{ type: 'text', text: '{"project":"bounded"}' }],
        isError: false,
      },
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'claude-code:thread:fixture',
        turnId: 'claude-code:turn:fixture',
        namespace: 'gosu_project',
        tool: 'read_workspace',
        arguments: { section: 'summary' },
      }),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );
    expect(onToolEvent).toHaveBeenCalledTimes(2);
    expect(onToolEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        phase: 'started',
        activity: { section: 'summary' },
        occurredAt: expect.any(String),
      }),
    );
    expect(onToolEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        phase: 'completed',
        success: true,
        activity: { section: 'summary' },
        occurredAt: expect.any(String),
        elapsedMs: expect.any(Number),
      }),
    );
    socket.destroy();
  });

  it('reports broker failure and bounded timing without changing the MCP result', async () => {
    const onToolEvent = vi.fn();
    const payload = JSON.stringify({
      ok: false,
      error: 'ssh_cancelled',
      content: '/Users/private/body',
    });
    const bridge = await ClaudeCodeMcpBridge.create({
      threadId: 'thread-broker',
      dynamicTools: [
        {
          type: 'namespace',
          name: 'gosu_project',
          description: 'Project',
          tools: [
            {
              type: 'function',
              name: 'read_workspace',
              description: 'Read',
              inputSchema: { type: 'object' },
            },
          ],
        },
      ],
      dynamicToolHandler: async () => ({
        success: true,
        contentItems: [{ type: 'inputText', text: payload }],
      }),
      onToolEvent,
    });
    bridges.push(bridge);
    bridge.beginTurn('turn-broker', new AbortController().signal);
    const { socket, nextLine } = await connect(bridge);
    socket.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_workspace', arguments: { section: 'board' } } })}\n`,
    );
    await expect(nextLine()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: { content: [{ type: 'text', text: payload }], isError: false },
    });
    expect(onToolEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'completed',
        success: false,
        activity: { section: 'board', errorCode: 'ssh_cancelled' },
        elapsedMs: expect.any(Number),
      }),
    );
    expect(JSON.stringify(onToolEvent.mock.calls)).not.toContain('/Users/private');
    socket.destroy();
  });

  it('revokes the transport and aborts active tool work', async () => {
    let toolSignal: AbortSignal | undefined;
    const onToolEvent = vi.fn();
    const handler = vi.fn(
      async (_call, delivery) =>
        await new Promise<{ contentItems: []; success: false }>((resolve) => {
          toolSignal = delivery.abortSignal;
          delivery.abortSignal.addEventListener(
            'abort',
            () => resolve({ contentItems: [], success: false }),
            { once: true },
          );
        }),
    );
    const bridge = await ClaudeCodeMcpBridge.create({
      threadId: 'claude-code:thread:revoke',
      onToolEvent,
      dynamicTools: [
        {
          type: 'namespace',
          name: 'gosu_project',
          description: 'Bounded project tools',
          tools: [
            {
              type: 'function',
              name: 'read_workspace',
              description: 'Read bounded workspace state',
              inputSchema: { type: 'object' },
            },
          ],
        },
      ],
      dynamicToolHandler: handler,
    });
    bridges.push(bridge);
    bridge.beginTurn('claude-code:turn:revoke', new AbortController().signal);
    const { socket } = await connect(bridge);
    socket.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'read_workspace', arguments: {} },
      })}\n`,
    );
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());

    bridge.revoke();

    expect(toolSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(socket.destroyed).toBe(true));
    expect(onToolEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'completed',
        success: false,
        activity: { section: 'summary', errorCode: 'tool_cancelled' },
        elapsedMs: expect.any(Number),
      }),
    );
  });
});
