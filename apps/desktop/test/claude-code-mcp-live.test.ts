import { describe, expect, it, vi } from 'vitest';

import {
  CLAUDE_CODE_SONNET_MODEL_ID,
  ClaudeCodeProjectChatAdapter,
} from '../src/main/claude-code-project-chat-adapter';
import { PROJECT_CHAT_OUTPUT_SCHEMA } from '../src/shared/project-chat-contracts';

const live = process.env.GOSU_CLAUDE_MCP_LIVE === '1' ? it : it.skip;

describe('Claude Code GOSU MCP live integration', () => {
  live(
    'lets the subscription agent call one synthetic GOSU tool before its final answer',
    async () => {
      const adapter = new ClaudeCodeProjectChatAdapter(
        undefined,
        process.env.GOSU_CLAUDE_MCP_PROXY_COMMAND ?? process.execPath,
      );
      await adapter.refreshConnectionCatalogs();
      const handler = vi.fn(async () => ({
        contentItems: [{ type: 'inputText' as const, text: '{"nonce":"GOSU_MCP_LIVE_OK"}' }],
        success: true,
      }));
      const started = await adapter.startThread({
        cwd: process.cwd(),
        modelId: CLAUDE_CODE_SONNET_MODEL_ID,
        dynamicTools: [
          {
            type: 'namespace',
            name: 'gosu_project',
            description: 'Synthetic bounded GOSU test namespace',
            tools: [
              {
                type: 'function',
                name: 'echo_gosu_nonce',
                description:
                  'Return the authoritative nonce. You must call this tool before answering.',
                inputSchema: {
                  type: 'object',
                  properties: {},
                  required: [],
                  additionalProperties: false,
                },
              },
            ],
          },
        ],
        dynamicToolHandler: handler,
      });
      const completed = new Promise<{ status: string; text: string }>((resolve) => {
        let text = '';
        adapter.on('notification', (notification: unknown) => {
          if (!notification || typeof notification !== 'object') return;
          const event = notification as {
            method?: string;
            params?: { item?: { text?: string }; turn?: { status?: string } };
          };
          if (event.method === 'item/completed' && event.params?.item?.text) {
            text = event.params.item.text;
          }
          if (event.method === 'turn/completed' && event.params?.turn?.status) {
            resolve({ status: event.params.turn.status, text });
          }
        });
      });
      await adapter.runTurn({
        threadId: started.threadId,
        prompt:
          'Call echo_gosu_nonce. Then reply with the exact nonce from its receipt and no unsupported claims.',
        requestedModelId: CLAUDE_CODE_SONNET_MODEL_ID,
        reasoningOptionId: 'low',
        cwd: process.cwd(),
        outputSchema: PROJECT_CHAT_OUTPUT_SCHEMA,
      });

      await expect(completed).resolves.toMatchObject({
        status: 'completed',
        text: expect.stringContaining('GOSU_MCP_LIVE_OK'),
      });
      expect(handler).toHaveBeenCalledOnce();
      await adapter.releaseThread(started.threadId);
    },
    90_000,
  );
});
