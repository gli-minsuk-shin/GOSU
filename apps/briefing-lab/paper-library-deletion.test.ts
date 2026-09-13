import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { briefingClientContext } from './briefing-client-context';
import type { SavedPaper } from './src/paper-library-index';
it('persists only selected routine-library removals across restart and denies nonowners', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'paper-library-delete-'));
  const make = () => new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 3));
  const owner = <T>(fn: () => T) => briefingClientContext.run('a'.repeat(64), fn);
  try {
    const store = make();
    const profile = await owner(() =>
      store.save(
        {
          routineId: 'r',
          name: 'fixture',
          timeZone: 'Asia/Seoul',
          live: defaultLiveSettings(),
          interest: { keywords: [], excluded: [] },
          preferences: defaultAssistantPreferences(),
        },
        async () => undefined,
      ),
    );
    const papers = ['one', 'two'].map((id) => ({
      historyId: id,
      savedAt: '2026-09-13T00:00:00Z',
      item: {
        id,
        title: id,
        kind: 'papers',
        readScope: 'abstract',
        summary: 'saved',
        importance: 'low',
        relevance: '',
        sourceUrl: `https://arxiv.org/abs/2609.0000${id === 'one' ? 1 : 2}v1`,
      },
    })) as SavedPaper[];
    await expect(store.removeLibraryPapers(profile, papers)).rejects.toThrow();
    await owner(() => store.removeLibraryPapers(profile, [papers[0]!]));
    expect(await make().visibleLibraryPapers('r', papers)).toEqual([papers[1]]);
    expect(await make().visibleLibraryPapers('other', papers)).toEqual(papers);
    expect(await make().profile('r')).toEqual(profile);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
