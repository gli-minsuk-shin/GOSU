import type { BriefingWorkspace } from '@gosu/briefing-core';

/** A configuration scaffold, never synthetic source content or an automatic collection. */
export function initialRealWorkspace(now: string): BriefingWorkspace {
  const anchorDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
  return {
    schemaVersion: 1,
    selectedRoutineId: 'personal-research',
    routines: [
      {
        id: 'personal-research',
        name: '개인·연구 브리핑',
        kind: 'personal',
        state: 'draft',
        schedule: {
          frequency: 'daily',
          interval: 1,
          anchorDate,
          timeZone: 'Asia/Seoul',
          times: ['08:00'],
          weekdays: [1, 2, 3, 4, 5],
          monthDay: 1,
        },
        interest: { keywords: [], excluded: [] },
        sources: [],
        countries: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    runs: [],
  };
}

/** Remove only explicitly synthetic browser records; backend history and grants are separate. */
export function withoutSampleContent(workspace: BriefingWorkspace): BriefingWorkspace {
  return {
    ...workspace,
    routines: workspace.routines.map((r) => ({
      ...r,
      sources: r.sources.filter((s) => s.origin !== 'fixture'),
    })),
    runs: workspace.runs.filter((run) => run.mode !== 'fixture'),
  };
}
