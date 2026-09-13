// Opt-in native LLM smoke: delayed SYNTHETIC tool results only. Never reads Mail/Calendar/arXiv.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { defaultLiveSettings, defaultAssistantPreferences } from '@gosu/briefing-core';
import { BriefingWorkspaceStore } from '../briefing-workspace-store';
import { briefingClientContext } from '../briefing-client-context';
import { runBriefingAssistant, assistantModel } from '../briefing-assistant';
import { createRoutineTransport, runRoutineAgent } from '../briefing-native';

const dir = await mkdtemp(join(tmpdir(), 'briefing-chat-deadline-'));
try {
  await briefingClientContext.run(randomBytes(32).toString('hex'), async () => {
    const workspace = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7));
    const preferences = {
      ...defaultAssistantPreferences(),
      providerId: 'codex' as const,
      mailRead: true,
      mailAi: true,
      calendarRead: true,
      calendarIds: ['synthetic-calendar'],
    };
    const model = await assistantModel(preferences);
    preferences.modelId = model.modelId;
    preferences.reasoning = model.reasoningOptions.find((r) => r.id === 'low')?.id ?? null;
    const profile = await workspace.save(
      {
        routineId: 'synthetic-deadline',
        name: 'Synthetic only',
        timeZone: 'Asia/Seoul',
        live: {
          ...defaultLiveSettings(),
          mail: {
            accountId: 'synthetic-account',
            mailboxId: 'synthetic-box',
            days: 3,
            limit: 1,
            subject: '',
            sender: '',
            unreadOnly: false,
            bodyPreview: true,
          },
        },
        interest: { keywords: [], excluded: [] },
        preferences,
      },
      async () => undefined,
    );
    const reads = { email: 0, calendar: 0 };
    const result = await runBriefingAssistant(
      {
        routineId: profile.routineId,
        prompt:
          'This is a synthetic integration test. Call search_email once with query="" and read_calendar once for 2026-09-10 to 2026-09-11. Both tools intentionally take 12 seconds. Wait for both results. Briefly report the email requested action and existing calendar event in Korean. Do not call any other tool, retry, or propose/create events or tasks.',
        history: [],
      },
      profile,
      workspace,
      {
        papers: async () => {
          throw new Error('assistant_tool_unavailable');
        },
        mail: async (_q, signal) => {
          reads.email++;
          await delay(12000, undefined, { signal });
          return {
            note: 'Synthetic single-message fixture, no real mailbox access.',
            items: [
              {
                id: 'synthetic-mail',
                kind: 'email',
                title: '[Synthetic] Review confirmation',
                text: 'Please confirm the synthetic review by September 10 at 17:00 KST.',
                source: 'Synthetic tool',
                readScope: 'mail-preview',
                publishedAt: '2026-09-09T09:00:00Z',
                details: [],
              },
            ],
          };
        },
        calendar: async (_start, _end, signal) => {
          reads.calendar++;
          await delay(12000, undefined, { signal });
          return {
            limited: false,
            events: [
              {
                id: 'synthetic-event',
                title: '[Synthetic] Research review',
                start: '2026-09-10T01:00:00Z',
                end: '2026-09-10T02:00:00Z',
                allDay: false,
                location: 'Synthetic room',
              },
            ],
          };
        },
      },
      AbortSignal.timeout(180000),
      (detail) => console.log(detail),
      (input, signal, progress, options) =>
        runRoutineAgent(input, signal, progress, {
          ...options,
          factory: (provider) => {
            const transport = createRoutineTransport(provider);
            transport.on('notification', (event: unknown) => {
              const e = event as {
                method?: string;
                params?: {
                  turn?: {
                    status?: string;
                    error?: { message?: string; codexErrorInfo?: unknown };
                  };
                };
              };
              if (e.method === 'turn/completed' && e.params?.turn?.status === 'failed') {
                const message = e.params.turn.error?.message ?? '';
                console.log(
                  JSON.stringify({
                    nativeFailure: {
                      usageLimit: /usage|quota|limit|credit/i.test(message),
                      auth: /auth|login|credential/i.test(message),
                      model: /model|reasoning/i.test(message),
                      schema: /schema/i.test(message),
                      connection: /network|connection|stream|fetch/i.test(message),
                      httpStatus: message.match(/\b[45]\d\d\b/)?.[0] ?? null,
                      errorInfo: e.params.turn.error?.codexErrorInfo ?? null,
                    },
                  }),
                );
              }
            });
            return transport;
          },
        }),
    );
    if (
      reads.email !== 1 ||
      reads.calendar !== 1 ||
      result.sources.filter((s) => s.kind === 'email').length !== 1 ||
      result.sources.filter((s) => s.kind === 'calendar').length !== 1 ||
      result.events.length ||
      result.tasks.length ||
      result.writesPerformed
    )
      throw new Error('synthetic_read_deadline_verification_failed');
    console.log(
      JSON.stringify({
        passed: true,
        provider: result.invocation,
        syntheticReads: reads,
        sourceKinds: result.sources.map((s) => s.kind),
        answerLength: result.answer.length,
        actualMailReads: 0,
        actualCalendarReads: 0,
        writes: 0,
      }),
    );
  });
} finally {
  await rm(dir, { recursive: true, force: true });
}
