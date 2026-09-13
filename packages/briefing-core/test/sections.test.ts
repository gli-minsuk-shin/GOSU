import { describe, expect, it } from 'vitest';
import {
  briefingSectionOrder,
  groupBriefingSections,
  moveBriefingSection,
} from '../src/sections.js';
import { generateFixtureRun } from '../src/engine.js';
import { parseBriefingWorkspace, validateRoutine } from '../src/schema.js';
import type { BriefingEvidence, BriefingRoutine } from '../src/types.js';

const now = '2026-09-08T00:00:00.000Z';
const routine: BriefingRoutine = {
  id: 'r',
  name: 'Morning',
  kind: 'personal',
  state: 'draft',
  createdAt: now,
  updatedAt: now,
  countries: [],
  interest: { keywords: [{ term: 'research', weight: 5, synonyms: [] }], excluded: [] },
  schedule: {
    frequency: 'daily',
    interval: 1,
    anchorDate: '2026-09-08',
    timeZone: 'Asia/Seoul',
    times: ['08:00'],
    weekdays: [],
    monthDay: 1,
  },
  sources: [
    { id: 'email', kind: 'email', label: 'Email', origin: 'fixture' },
    { id: 'papers', kind: 'papers', label: 'Papers', origin: 'fixture' },
    { id: 'weather', kind: 'weather', label: 'Weather', origin: 'fixture' },
  ],
};
const evidence: BriefingEvidence[] = [
  {
    id: 'p1',
    sourceId: 'papers',
    kind: 'papers',
    title: 'research',
    abstract: '',
    summary: 'p1',
    publishedAt: now,
    readScope: 'fixture',
  },
  {
    id: 'p2',
    sourceId: 'papers',
    kind: 'papers',
    title: 'Other paper',
    abstract: '',
    summary: 'p2',
    publishedAt: now,
    readScope: 'fixture',
  },
  {
    id: 'e',
    sourceId: 'email',
    kind: 'email',
    title: 'Email',
    abstract: '',
    summary: 'e',
    publishedAt: now,
    readScope: 'fixture',
  },
  {
    id: 'w',
    sourceId: 'weather',
    kind: 'weather',
    title: 'Weather',
    abstract: '',
    summary: 'w',
    publishedAt: now,
    readScope: 'fixture',
  },
];
const makeRun = (input = routine) =>
  generateFixtureRun(input, evidence, { id: 'run', scheduledFor: now, completedAt: now });
describe('Briefing sections and persistent order', () => {
  it('groups by category in chosen order, preserving within-category ranking and original receipts', () => {
    const run = makeRun();
    const original = JSON.stringify(run);
    const groups = groupBriefingSections(run, ['email', 'weather', 'papers']);
    expect(groups.map((group) => group.kind)).toEqual(['email', 'weather', 'papers']);
    expect(groups[2]!.items.map((item) => item.evidence.id)).toEqual(['p1', 'p2']);
    expect(JSON.stringify(run)).toBe(original);
  });
  it('keeps hidden categories discoverable and excludes hidden counts/items from summaries', () => {
    const groups = groupBriefingSections({ ...makeRun(), hiddenItemIds: ['p1', 'p2'] });
    expect(groups.find((group) => group.kind === 'papers')).toEqual({
      kind: 'papers',
      items: [],
      hiddenCount: 2,
    });
    expect(groups.reduce((total, group) => total + group.items.length, 0)).toBe(2);
  });
  it('snapshots order for archived runs and permits current display preference overrides', () => {
    const run = makeRun({ ...routine, sectionOrder: ['papers', 'email', 'weather'] });
    expect(groupBriefingSections(run).map((group) => group.kind)).toEqual([
      'papers',
      'email',
      'weather',
    ]);
    expect(
      groupBriefingSections(run, ['weather', 'email', 'papers']).map((group) => group.kind),
    ).toEqual(['weather', 'email', 'papers']);
    expect(run.sectionOrderSnapshot?.[0]).toBe('papers');
  });
  it('loads old stores without order fields and appends newly selected categories predictably', () => {
    const { sectionOrderSnapshot: _snapshot, ...legacyRun } = makeRun();
    const parsed = parseBriefingWorkspace({
      schemaVersion: 1,
      routines: [routine],
      runs: [legacyRun],
      selectedRoutineId: 'r',
    });
    expect(parsed).not.toBeNull();
    expect(groupBriefingSections(parsed!.runs[0]!).map((group) => group.kind)).toEqual([
      'weather',
      'email',
      'papers',
    ]);
    expect(briefingSectionOrder(['papers']).slice(0, 3)).toEqual(['papers', 'weather', 'email']);
  });
  it('moves in both directions without duplicates and rejects corrupt stored preferences', () => {
    const moved = moveBriefingSection(['weather', 'email', 'papers'], 'papers', 'weather');
    expect(moved.slice(0, 3)).toEqual(['papers', 'weather', 'email']);
    expect(moveBriefingSection(moved, 'papers', 'email').slice(0, 3)).toEqual([
      'weather',
      'email',
      'papers',
    ]);
    expect(new Set(moved).size).toBe(9);
    expect(validateRoutine({ ...routine, sectionOrder: ['email', 'email'] })).not.toEqual([]);
    expect(
      parseBriefingWorkspace({
        schemaVersion: 1,
        routines: [{ ...routine, sectionOrder: ['invalid'] }],
        runs: [],
        selectedRoutineId: 'r',
      }),
    ).toBeNull();
  });
});
