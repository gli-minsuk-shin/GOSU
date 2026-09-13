// Opt-in real CLI smoke. Synthetic routine + public arXiv only; no account or calendar reads.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { defaultLiveSettings, defaultAssistantPreferences } from '@gosu/briefing-core';
import { BriefingWorkspaceStore } from '../briefing-workspace-store';
import { briefingClientContext } from '../briefing-client-context';
import { runBriefingAssistant, assistantModel } from '../briefing-assistant';
import { searchPapers } from '../live-public-sources';
const dir = await mkdtemp(join(tmpdir(), 'briefing-agent-live-'));
try {
  await briefingClientContext.run(randomBytes(32).toString('hex'), async () => {
    const workspace = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 6)),
      preferences = defaultAssistantPreferences();
    const model = await assistantModel(preferences);
    preferences.modelId = model.modelId;
    preferences.reasoning = model.reasoningOptions.find((o) => o.id === 'medium')?.id ?? null;
    const profile = await workspace.save(
      {
        routineId: 'public-agent-smoke',
        name: 'Public verification fixture',
        timeZone: 'Asia/Seoul',
        live: defaultLiveSettings(),
        interest: { keywords: [{ term: 'optimization', weight: 5, synonyms: [] }], excluded: [] },
        preferences,
      },
      async () => undefined,
    );
    let searches = 0;
    const result = await runBriefingAssistant(
      {
        routineId: profile.routineId,
        prompt:
          'Call search_papers once for optimization, then briefly summarize one returned paper in Korean. Do not propose events or tasks. Do not read mail, calendar or history.',
        history: [],
      },
      profile,
      workspace,
      {
        papers: async (query, signal) => {
          searches++;
          return searchPapers(
            { keywords: [{ term: query, weight: 5, synonyms: [] }], excluded: [] },
            { enabled: true, days: 30, limit: 2, author: '', scholarAlerts: false },
            signal,
          );
        },
        mail: async () => {
          throw new Error('assistant_private_ai_required');
        },
        calendar: async () => {
          throw new Error('assistant_private_ai_required');
        },
      },
      AbortSignal.timeout(180000),
      (detail) => console.log(detail),
    );
    if (
      !searches ||
      !result.sources.length ||
      result.events.length ||
      result.tasks.length ||
      result.writesPerformed !== 0
    )
      throw new Error('agent_live_verification_failed');
    console.log(
      JSON.stringify({
        passed: true,
        searches,
        provider: result.invocation,
        sourceCount: result.sources.length,
        calendarWrites: 0,
        mailReads: 0,
        answerLength: result.answer.length,
      }),
    );
  });
} finally {
  await rm(dir, { recursive: true, force: true });
}
