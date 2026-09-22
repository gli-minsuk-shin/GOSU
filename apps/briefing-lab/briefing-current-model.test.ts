import { expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defaultAssistantPreferences } from '@gosu/briefing-core';
import { defaultModelRouting, usageChoice } from '@gosu/contracts';
import { LiveSourceService } from './live-source-service';
import { briefingChatUsage, routedBriefingPreferences } from './briefing-model-routing';

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
        // Neither paper role is assigned here, so each follows its own fallback: the quick summary
        // follows Briefing and the deep conversation follows the assistant.
        { usage: 'paperSummary', providerId: 'codex', modelId: 'fast-summary', assigned: true },
        { usage: 'paperChat', modelId: 'gpt-6-astra', reasoning: 'high', assigned: true },
      ],
    });
    expect(resolve).toHaveBeenCalledTimes(5);
  },
);

it('separates 논문 요약 from 논문 분석·질의응답, and each falls back to the right role', () => {
  const policy = defaultModelRouting();
  policy.strong = { providerId: 'codex', modelId: 'deep-analysis', reasoningOptionId: 'high' };
  policy.fast = { providerId: 'codex', modelId: 'quick-summary', reasoningOptionId: 'low' };
  policy.lightweight = { providerId: 'codex', modelId: 'cheapest', reasoningOptionId: null };
  policy.usage.briefing = 'fast';
  policy.usage.briefingAssistant = 'strong';
  const resolved = (usage: 'paperSummary' | 'paperChat' | 'briefingAssistant') =>
    routedBriefingPreferences(defaultAssistantPreferences(), policy, usage).modelId;

  // A paper question is the analysis role's work, and everything else stays the assistant's.
  expect(briefingChatUsage(true)).toBe('paperChat');
  expect(briefingChatUsage(false)).toBe('briefingAssistant');

  // Both unset: summarizing follows Briefing, the conversation follows the assistant. The user
  // sets Briefing to their fastest model for bulk mail, so a shared fallback would quietly answer
  // deep questions on it.
  expect(usageChoice(policy, 'paperSummary')).toBe('fast');
  expect(usageChoice(policy, 'paperChat')).toBe('strong');
  expect(resolved('paperSummary')).toBe('quick-summary');
  expect(resolved('paperChat')).toBe('deep-analysis');

  // Assigned separately: a quick summary on the cheapest model does not drag the conversation
  // down with it, which is the whole point of splitting them.
  policy.usage.paperSummary = 'lightweight';
  expect(resolved('paperSummary')).toBe('cheapest');
  expect(resolved('paperChat')).toBe('deep-analysis');
  policy.usage.paperChat = 'strong';
  policy.usage.briefingAssistant = 'lightweight';
  expect(resolved('paperChat')).toBe('deep-analysis');
  expect(resolved('briefingAssistant')).toBe('cheapest');
});
