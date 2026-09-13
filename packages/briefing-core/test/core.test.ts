import { describe, expect, it } from 'vitest';
import {
  generateFixtureRun,
  isPublicHttpsUrl,
  parseBriefingWorkspace,
  rankEvidence,
  validateRoutine,
} from '../src/index.js';
import type {
  BriefingEvidence,
  BriefingRoutine,
  BriefingWorkspace,
  InterestProfile,
} from '../src/types.js';

const now = '2026-09-08T10:00:00.000Z';
function routine(): BriefingRoutine {
  return {
    id: 'research',
    name: 'Research',
    kind: 'personal',
    state: 'draft',
    schedule: {
      frequency: 'daily',
      interval: 1,
      anchorDate: '2026-09-08',
      timeZone: 'Asia/Seoul',
      times: ['08:00'],
      weekdays: [],
      monthDay: 1,
    },
    interest: {
      keywords: [{ term: 'optimization', weight: 5, synonyms: ['최적화'] }],
      excluded: [],
    },
    sources: [
      { id: 'papers', label: 'Paper fixtures', kind: 'papers', origin: 'fixture' },
      { id: 'todo', label: 'Task fixtures', kind: 'todo', origin: 'fixture' },
    ],
    countries: [],
    createdAt: now,
    updatedAt: now,
  };
}
function evidence(patch: Partial<BriefingEvidence> = {}): BriefingEvidence {
  return {
    id: 'paper-1',
    sourceId: 'papers',
    kind: 'papers',
    title: 'Optimization',
    abstract: 'optimization method',
    summary: 'Synthetic fixture summary, not an LLM answer.',
    publishedAt: now,
    readScope: 'fixture',
    ...patch,
  };
}
const input = { id: 'run-1', scheduledFor: now, completedAt: now };
function workspace(): BriefingWorkspace {
  const current = routine();
  return {
    schemaVersion: 1,
    routines: [current],
    runs: [generateFixtureRun(current, [evidence()], input)],
    selectedRoutineId: current.id,
  };
}

describe('deterministic research relevance', () => {
  it('weights title matches 3x abstract matches and counts a keyword once per field', () => {
    const interest = routine().interest;
    const values = rankEvidence(
      [
        evidence({ id: 'abstract', title: 'Method', abstract: 'optimization optimization' }),
        evidence({ id: 'title', title: 'Optimization optimization', abstract: '' }),
      ],
      interest,
    );
    expect(values.map(({ evidence: item, score }) => [item.id, score])).toEqual([
      ['title', 15],
      ['abstract', 5],
    ]);
  });
  it('prioritizes relevance above newer publication times', () => {
    const values = rankEvidence(
      [
        evidence({
          id: 'new',
          title: 'Astronomy',
          abstract: '',
          publishedAt: '2026-09-09T00:00:00Z',
        }),
        evidence({ id: 'old', publishedAt: '2020-01-01T00:00:00Z' }),
      ],
      routine().interest,
    );
    expect(values[0]?.evidence.id).toBe('old');
  });
  it('matches approved Korean synonyms while retaining canonical keyword reasons', () => {
    const values = rankEvidence(
      [evidence({ title: '최적화를 활용한 모델', abstract: '' })],
      routine().interest,
    );
    expect(values[0]).toMatchObject({ score: 15, matchedKeywords: ['optimization'] });
  });
  it('does not match AI inside training or unrelated substrings', () => {
    const interest: InterestProfile = {
      keywords: [{ term: 'AI', weight: 5, synonyms: [] }],
      excluded: [],
    };
    expect(
      rankEvidence([evidence({ title: 'Training', abstract: 'plain claim' })], interest)[0]?.score,
    ).toBe(0);
    expect(rankEvidence([evidence({ title: 'AI-based', abstract: '' })], interest)[0]?.score).toBe(
      15,
    );
  });
  it('removes excluded topics and breaks ties by publication time then stable ID', () => {
    const interest = { ...routine().interest, excluded: ['astronomy'] };
    const source = [
      evidence({ id: 'b' }),
      evidence({ id: 'a' }),
      evidence({ id: 'new', publishedAt: '2026-09-09T00:00:00Z' }),
      evidence({ id: 'excluded', abstract: 'optimization astronomy' }),
    ];
    expect(rankEvidence(source, interest).map(({ evidence: item }) => item.id)).toEqual([
      'new',
      'a',
      'b',
    ]);
    expect(rankEvidence([...source].reverse(), interest)).toEqual(rankEvidence(source, interest));
  });
  it('does not rank against summary text or unapproved synonyms', () => {
    expect(
      rankEvidence(
        [evidence({ title: 'Method', abstract: '', summary: 'optimization' })],
        routine().interest,
      )[0]?.score,
    ).toBe(0);
  });
});

describe('fixture run engine', () => {
  it('filters unselected and wrong-kind evidence and requires explicit task deadlines, including overdue', () => {
    const run = generateFixtureRun(
      routine(),
      [
        evidence(),
        evidence({ id: 'foreign', sourceId: 'other' }),
        evidence({ id: 'wrong-kind', sourceId: 'papers', kind: 'funding' }),
        evidence({ id: 'no-deadline', sourceId: 'todo', kind: 'todo' }),
        evidence({ id: 'overdue', sourceId: 'todo', kind: 'todo', deadline: '2026-01-01' }),
      ],
      input,
    );
    expect(run.items.map(({ evidence: item }) => item.id)).toEqual(['overdue', 'paper-1']);
    expect(run.progress.map(({ count }) => count)).toEqual([2, 2, 2, 2]);
    expect(run.mode).toBe('fixture');
  });
  it('deduplicates exact IDs and shared source URLs before ranking', () => {
    const run = generateFixtureRun(
      routine(),
      [
        evidence({
          id: 'old',
          url: 'https://arxiv.org/abs/1234?utm_source=sample',
          publishedAt: '2026-08-01T00:00:00Z',
        }),
        evidence({ id: 'new', url: 'https://arxiv.org/abs/1234' }),
        evidence({
          id: 'new',
          url: 'https://arxiv.org/abs/other',
          publishedAt: '2026-07-01T00:00:00Z',
        }),
      ],
      input,
    );
    expect(run.items).toHaveLength(1);
    expect(run.items[0]?.evidence.id).toBe('new');
    expect(run.progress.map(({ count }) => count)).toEqual([3, 1, 1, 1]);
    expect(run.sourceResults[0]?.count).toBe(3);
  });
  it('keeps separate routines independent, including shared fixture source delivery', () => {
    const first = generateFixtureRun(routine(), [evidence()], input);
    const second = generateFixtureRun({ ...routine(), id: 'other', name: 'Other' }, [evidence()], {
      ...input,
      id: 'run-2',
    });
    expect(first.items).toEqual(second.items);
    expect(first.routineId).not.toBe(second.routineId);
    expect(first.items).not.toBe(second.items);
    expect(first.scheduleSnapshot).not.toBe(second.scheduleSnapshot);
  });
  it('normalizes accepted source identities and selects equal-date duplicates deterministically', () => {
    const current = { ...routine(), sources: [{ ...routine().sources[0]!, id: ' papers ' }] };
    const candidates = [
      evidence({ title: 'Optimization Z' }),
      evidence({ title: 'Optimization A' }),
    ];
    const run = generateFixtureRun(current, candidates, input);
    expect(run.items).toHaveLength(1);
    expect(run.sourceResults[0]?.sourceId).toBe('papers');
    expect(generateFixtureRun(current, [...candidates].reverse(), input)).toEqual(run);
  });
  it('preserves previous schedule, interest and evidence snapshots after caller edits', () => {
    const current = routine();
    const source = evidence();
    const run = generateFixtureRun(current, [source], input);
    Reflect.set(current.schedule, 'timeZone', 'UTC');
    Reflect.set(current.interest.keywords[0]!, 'weight', 1);
    Reflect.set(source, 'title', 'Modified');
    expect(run.scheduleSnapshot.timeZone).toBe('Asia/Seoul');
    expect(run.interestSnapshot.keywords[0]?.weight).toBe(5);
    expect(run.items[0]?.evidence.title).toBe('Optimization');
  });
  it.each(['draft', 'paused', 'enabled'] as const)(
    'allows only explicitly invoked manual fixture runs while routine state is %s',
    (state) => {
      expect(generateFixtureRun({ ...routine(), state }, [evidence()], input).status).toBe('ready');
    },
  );
  it('marks user sources unsupported without fetching even if a fixture source ID is reused', () => {
    const current = {
      ...routine(),
      sources: [
        { ...routine().sources[0]!, origin: 'user' as const, url: 'https://arxiv.org/list/cs/new' },
      ],
    };
    const run = generateFixtureRun(current, [evidence()], input);
    expect(run.status).toBe('failed');
    expect(run.items).toEqual([]);
    expect(run.sourceResults).toEqual([
      { sourceId: 'papers', label: 'Paper fixtures', status: 'unsupported', count: 0 },
    ]);
  });
  it('reports partial for mixed sources and failed for no selected source', () => {
    const current = routine();
    expect(
      generateFixtureRun(
        {
          ...current,
          sources: [
            ...current.sources,
            { id: 'user', kind: 'papers', origin: 'user', label: 'Manual source' },
          ],
        },
        [evidence()],
        input,
      ).status,
    ).toBe('partial');
    expect(
      generateFixtureRun(
        { ...current, sources: [], interest: { keywords: [], excluded: [] } },
        [evidence()],
        input,
      ).status,
    ).toBe('failed');
  });
  it('filters funding countries without mixing personal evidence', () => {
    const current: BriefingRoutine = {
      ...routine(),
      kind: 'funding',
      countries: ['KR'],
      sources: [
        { id: 'kr', kind: 'funding', label: 'KR fixture', origin: 'fixture', country: 'KR' },
        { id: 'us', kind: 'funding', label: 'US fixture', origin: 'fixture', country: 'US' },
      ],
    };
    const run = generateFixtureRun(
      current,
      [
        evidence({ id: 'kr-one', sourceId: 'kr', kind: 'funding' }),
        evidence({ id: 'us-one', sourceId: 'us', kind: 'funding' }),
        evidence(),
      ],
      input,
    );
    expect(run.items.map(({ evidence: item }) => item.id)).toEqual(['kr-one']);
  });
});

describe('strict bounded briefing workspace validation', () => {
  it('persists custom and intentionally empty suggested questions while rejecting empty/duplicate/oversized entries', () => {
    for (const suggestedQuestions of [['My own question'], []]) {
      const value = { ...workspace(), routines: [{ ...routine(), suggestedQuestions }] };
      expect(
        parseBriefingWorkspace(JSON.parse(JSON.stringify(value)))?.routines[0]?.suggestedQuestions,
      ).toEqual(suggestedQuestions);
    }
    for (const suggestedQuestions of [
      [''],
      ['same', 'same'],
      ['x'.repeat(301)],
      Array.from({ length: 13 }, (_, i) => String(i)),
    ])
      expect(validateRoutine({ ...routine(), suggestedQuestions }).length).toBeGreaterThan(0);
    expect(validateRoutine(routine())).toEqual([]);
  });
  it('round-trips generated fixture data and accepts empty initial history or no routines', () => {
    expect(parseBriefingWorkspace(workspace())).toEqual(workspace());
    expect(parseBriefingWorkspace({ ...workspace(), runs: [] })).not.toBeNull();
    expect(
      parseBriefingWorkspace({ schemaVersion: 1, routines: [], runs: [], selectedRoutineId: '' }),
    ).not.toBeNull();
    expect(
      validateRoutine({ ...routine(), sources: [], interest: { keywords: [], excluded: [] } }),
    ).toEqual([]);
  });
  it('preserves historical evidence after a source or routine is removed', () => {
    const old = workspace();
    expect(
      parseBriefingWorkspace({ ...old, routines: [{ ...old.routines[0]!, sources: [] }] }),
    ).not.toBeNull();
    expect(parseBriefingWorkspace({ ...old, routines: [], selectedRoutineId: '' })).not.toBeNull();
  });
  it.each([
    'https://localhost/source',
    'https://127.0.0.1/source',
    'https://10.1.1.1/source',
    'https://2130706433/source',
    'https://[::1]/source',
    'https://host.local/source',
    'https://user:pass@example.com/source',
    'http://example.com/source',
    'javascript:alert(1)',
    'not a url',
  ])('rejects unsafe or malformed source URL %s', (url) => {
    expect(isPublicHttpsUrl(url)).toBe(false);
    expect(
      validateRoutine({ ...routine(), sources: [{ ...routine().sources[0]!, url }] }).length,
    ).toBeGreaterThan(0);
  });
  it('accepts public official source URLs without claiming connectivity', () => {
    expect(isPublicHttpsUrl('https://www.iris.go.kr/contents/retrieveBsnsAncmListView.do')).toBe(
      true,
    );
  });
  it.each([
    'token',
    'api_key',
    'key',
    'password',
    'authorization',
    'access_token',
    'code',
    '%61pi_key',
  ])('rejects persisted credential query parameter %s', (parameter) => {
    expect(isPublicHttpsUrl(`https://example.com/funding?${parameter}=sensitive-value`)).toBe(
      false,
    );
  });
  it('rejects OAuth credentials in URL fragments while allowing ordinary public search queries', () => {
    expect(isPublicHttpsUrl('https://example.com/funding#access_token=secret')).toBe(false);
    expect(isPublicHttpsUrl('https://example.com/funding?q=optimization#announcements')).toBe(true);
  });
  it('rejects duplicate IDs, missing selection, cross-kind sources and unknown fields', () => {
    const value = workspace();
    expect(
      parseBriefingWorkspace({ ...value, routines: [value.routines[0], value.routines[0]] }),
    ).toBeNull();
    expect(parseBriefingWorkspace({ ...value, selectedRoutineId: 'missing' })).toBeNull();
    expect(parseBriefingWorkspace({ ...value, rawCredentials: 'forbidden' })).toBeNull();
    expect(
      validateRoutine({
        ...routine(),
        sources: [{ id: 'wrong', kind: 'funding', label: 'Funding', origin: 'fixture' }],
      }).length,
    ).toBeGreaterThan(0);
  });
  it('rejects fabricated progress counts, foreign source items, hidden IDs and false ready status', () => {
    const value = workspace();
    const run = value.runs[0]!;
    expect(
      parseBriefingWorkspace({ ...value, runs: [{ ...run, hiddenItemIds: ['missing'] }] }),
    ).toBeNull();
    expect(parseBriefingWorkspace({ ...value, runs: [{ ...run, sourceResults: [] }] })).toBeNull();
    expect(
      parseBriefingWorkspace({
        ...value,
        runs: [{ ...run, progress: run.progress.map((entry) => ({ ...entry, count: 0 })) }],
      }),
    ).toBeNull();
    expect(parseBriefingWorkspace({ ...value, runs: [{ ...run, status: 'failed' }] })).toBeNull();
  });
  it('rejects malformed dates, timezone, oversized names and keyword weights', () => {
    expect(validateRoutine({ ...routine(), name: 'x'.repeat(161) }).length).toBeGreaterThan(0);
    expect(
      validateRoutine({
        ...routine(),
        schedule: { ...routine().schedule, anchorDate: '2026-02-29' },
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validateRoutine({
        ...routine(),
        interest: { keywords: [{ term: 'test', weight: 6, synonyms: [] }], excluded: [] },
      }).length,
    ).toBeGreaterThan(0);
    expect(() => generateFixtureRun(routine(), [], { ...input, completedAt: 'tomorrow' })).toThrow(
      'Invalid fixture run',
    );
  });
});
