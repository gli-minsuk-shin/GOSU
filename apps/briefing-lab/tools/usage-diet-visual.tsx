import { createRoot } from 'react-dom/client';
import { UsageView } from '../../desktop/src/renderer/src/usage-view';
import type { ModelUsageAnalyticsReport } from '../../desktop/src/shared/model-usage-contracts';
import '../../desktop/src/renderer/src/styles.css';
const now = new Date().toISOString(),
  p1 = '11111111-1111-4111-8111-111111111111',
  p2 = '22222222-2222-4222-8222-222222222222';
const agg = (input: number, output: number, cache: number, calls = 1) => ({
  tokens: {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    cachedReadTokens: cache,
    cachedWriteTokens: null,
    reasoningOutputTokens: null,
  },
  turnCount: calls,
  exactTurnCount: calls,
  partialTurnCount: 0,
  unavailableTurnCount: 0,
});
const connection = {
  connectionKey: 'codex:synthetic',
  connectionLabel: '합성 검증',
  providerId: 'codex',
  upstreamProviderId: null,
};
const data: ModelUsageAnalyticsReport = {
  schemaVersion: 1,
  generatedAt: now,
  trackingStartedAt: '2026-09-01T00:00:00Z',
  localOnly: true,
  rangeCoverage: 'complete',
  range: {
    period: 'day',
    anchorDate: '2026-09-14',
    timeZone: 'Asia/Seoul',
    fromInclusive: '2026-09-13T15:00:00Z',
    toExclusive: '2026-09-14T15:00:00Z',
  },
  totals: agg(12000, 1500, 9300, 4),
  series: [],
  byProject: [
    { ...agg(4000, 700, 2800, 2), projectId: p1, projectName: '연구 프로젝트 A' },
    { ...agg(2000, 200, 1500), projectId: p2, projectName: '연구 프로젝트 B' },
  ],
  byConnection: [{ ...connection, ...agg(12000, 1500, 9300, 4) }],
  byModel: [
    { ...connection, ...agg(11000, 1300, 8500, 3), resolvedModelId: 'gpt-6-astra' },
    { ...connection, ...agg(1000, 200, 800), resolvedModelId: 'gpt-5.6-luna' },
  ],
  byWorkload: [
    { ...agg(6000, 600, 5000), workloadKind: 'briefing_assistant' },
    { ...agg(6000, 900, 4300, 3), workloadKind: 'project_chat' },
  ],
  // Parts that add up to both `byModel` and `byWorkload`, so the distribution prices every feature.
  byWorkloadModel: [
    {
      ...connection,
      ...agg(6000, 600, 5000),
      workloadKind: 'briefing_assistant',
      resolvedModelId: 'gpt-6-astra',
    },
    {
      ...connection,
      ...agg(5000, 700, 3500, 2),
      workloadKind: 'project_chat',
      resolvedModelId: 'gpt-6-astra',
    },
    {
      ...connection,
      ...agg(1000, 200, 800),
      workloadKind: 'project_chat',
      resolvedModelId: 'gpt-5.6-luna',
    },
  ],
  byProjectModel: [
    {
      ...connection,
      ...agg(3000, 500, 2000),
      projectId: p1,
      projectName: '연구 프로젝트 A',
      resolvedModelId: 'gpt-6-astra',
    },
    {
      ...connection,
      ...agg(1000, 200, 800),
      projectId: p1,
      projectName: '연구 프로젝트 A',
      resolvedModelId: 'gpt-5.6-luna',
    },
    {
      ...connection,
      ...agg(2000, 200, 1500),
      projectId: p2,
      projectName: '연구 프로젝트 B',
      resolvedModelId: 'gpt-6-astra',
    },
  ],
  lectureGenerations: { items: [], total: 0, offset: 0, limit: 25, snapshotAt: now },
};
const projects = [p1, p2].map((id, i) => ({
  id,
  name: `연구 프로젝트 ${i ? 'B' : 'A'}`,
  slug: `synthetic-${i}`,
  version: 1,
  createdAt: now,
  updatedAt: now,
}));
createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 1150, margin: '12px auto', padding: 16 }}>
    <p>합성 사용량 화면 · 실제 호출/청구 없음</p>
    <UsageView
      adapter={{ query: async () => data }}
      projects={projects}
      initialReport={data}
      initialBreakdown="projects"
    />
  </main>,
);
