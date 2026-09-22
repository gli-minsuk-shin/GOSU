import { expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defaultAssistantPreferences } from '@gosu/briefing-core';
import { defaultModelRouting } from '@gosu/contracts';
import { LiveSourceService } from './live-source-service';

it.each([null, 'explicit-model'])(
  'reports the model Settings → Agent assigns to every Briefing usage, whatever the routine stored (%s)',
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
    // A model stored with the routine (from the picker Briefing had until 0.58.135) wins nowhere.
    expect(JSON.parse(body)).toMatchObject({
      modelId: 'gpt-6-astra',
      reasoning: 'high',
      usages: [
        { usage: 'briefing', providerId: 'codex', modelId: 'fast-summary', assigned: true },
        { usage: 'briefingAssistant', modelId: 'gpt-6-astra', reasoning: 'high', assigned: true },
        // No lightweight model in Settings → Agent: the routine's stored selection still runs.
        { usage: 'lightweightTasks', modelId: pin, assigned: false },
        // The paper summary AI has no role of its own here, so it follows Briefing, as before.
        { usage: 'paperSummary', providerId: 'codex', modelId: 'fast-summary', assigned: true },
      ],
    });
    expect(resolve).toHaveBeenCalledTimes(4);
  },
);
