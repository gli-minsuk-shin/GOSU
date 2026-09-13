import { expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defaultAssistantPreferences } from '@gosu/briefing-core';
import { defaultModelRouting } from '@gosu/contracts';
import { LiveSourceService } from './live-source-service';

it.each([null, 'explicit-model'])(
  'reports the assistant role, preserving explicit pin %s',
  async (pin) => {
    const policy = defaultModelRouting();
    policy.strong = { providerId: 'codex', modelId: 'gpt-6-astra', reasoningOptionId: 'high' };
    policy.fast = { providerId: 'codex', modelId: 'fast-summary', reasoningOptionId: 'low' };
    const resolve = vi.fn(async (preferences) => ({
      modelId: preferences.modelId,
      displayName: preferences.modelId,
    }));
    const service = Object.assign(Object.create(LiveSourceService.prototype), {
      workspace: {
        profile: async () => ({ preferences: { ...defaultAssistantPreferences(), modelId: pin } }),
      },
      modelRouting: async () => policy,
      modelResolver: resolve,
    }) as LiveSourceService;
    const req = Object.assign(Readable.from([JSON.stringify({ routineId: 'r' })]), {
      method: 'POST',
      url: '/assistant/model/current',
      headers: { 'content-type': 'application/json' },
    }) as IncomingMessage;
    let body = '';
    const writeHead = vi.fn();
    const res = {
      writeHead,
      end: (value: string) => {
        body = value;
      },
    } as unknown as ServerResponse;
    await service.handle(req, res, new AbortController().signal);
    expect(writeHead.mock.calls[0]?.[0]).toBe(200);
    expect(JSON.parse(body)).toMatchObject({
      modelId: pin ?? 'gpt-6-astra',
      reasoning: pin ? null : 'high',
    });
    expect(resolve).toHaveBeenCalledTimes(1);
  },
);
