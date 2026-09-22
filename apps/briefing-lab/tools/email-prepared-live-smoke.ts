import { analyzeBriefing } from '../briefing-analysis';
import { createRoutineTransport, runRoutineWithGosuLanguage } from '../briefing-native';
if (!process.argv.includes('--live'))
  throw Error(
    'Explicit --live required: one synthetic email summary call, no Mail/Calendar/Reminders access.',
  );
const engine = createRoutineTransport('codex');
const model = await engine
  .catalog()
  .then((c) => {
    const m = c.models.find((m) => m.modelId === 'gpt-5.6-luna');
    if (!m) throw Error('Smoke model unavailable');
    return m;
  })
  .finally(() => engine.dispose());
const text =
  '2026년 9월 20일 오후 3시 30분까지 검토 자료를 제출해주세요. 회의는 2026년 10월 6일 오후 1시부터 2시까지 본관 301호에서 진행합니다.';
let calls = 0;
const result = await analyzeBriefing(
  {
    routineId: 'synthetic',
    receiptId: '11111111-1111-4111-8111-111111111111',
    itemIds: ['m'],
    providerId: 'codex',
    modelId: model.modelId,
    reasoning: 'low',
    includeMail: true,
    memory: [],
  },
  [
    {
      id: 'm',
      kind: 'email',
      title: '합성 자료 제출 및 회의 안내',
      text,
      source: 'Synthetic only',
      readScope: 'mail-preview',
      details: [],
      publishedAt: '2026-09-14T00:00:00Z',
    },
  ],
  { keywords: [], excluded: [] },
  AbortSignal.timeout(90000),
  () => undefined,
  (...args) => {
    calls++;
    return runRoutineWithGosuLanguage(...args);
  },
);
const actions = result.items[0]?.preparedActions;
console.log(JSON.stringify({ model: model.modelId, calls, actions }));
if (
  calls !== 1 ||
  actions?.task?.dueDate !== '2026-09-20' ||
  Date.parse(actions?.task?.dueAt ?? '') !== Date.parse('2026-09-20T06:30:00Z') ||
  Date.parse(actions?.event?.start ?? '') !== Date.parse('2026-10-06T04:00:00Z') ||
  Date.parse(actions?.event?.end ?? '') !== Date.parse('2026-10-06T05:00:00Z')
)
  throw Error('Prepared actions did not match the synthetic source in one call');
