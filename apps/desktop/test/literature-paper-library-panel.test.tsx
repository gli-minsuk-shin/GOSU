import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LiteraturePaperLibraryPanel,
  rankPaperLibraryEntries,
} from '../src/renderer/src/literature-paper-library-panel';
import type { PaperLibraryEntry } from '../src/shared/paper-library-contracts';

const entry = (overrides: Partial<PaperLibraryEntry> & { id: string }): PaperLibraryEntry => ({
  title: 'A paper',
  authors: ['Ada Researcher'],
  venue: null,
  year: 2024,
  sourceUrl: `https://arxiv.org/abs/2401.${overrides.id
    .slice(0, 5)
    .replace(/[^0-9]/gu, '1')
    .padEnd(5, '0')}`,
  savedAt: '2026-09-01T00:00:00.000Z',
  summary: '',
  keywords: [],
  tags: [],
  ...overrides,
});
const tabpfn = entry({
  id: '1'.repeat(64),
  title: 'TabPFN: A Transformer That Solves Small Tabular Classification Problems',
  keywords: ['TabPFN', 'in-context learning'],
  sourceUrl: 'https://arxiv.org/abs/2207.01848',
  savedAt: '2026-08-01T00:00:00.000Z',
});
const lasso = entry({
  id: '2'.repeat(64),
  title: 'Sparse inverse covariance estimation with the graphical lasso',
  sourceUrl: 'https://doi.org/10.1093/biostatistics/kxm045',
  savedAt: '2026-08-10T00:00:00.000Z',
});
const unrelated = entry({
  id: '3'.repeat(64),
  title: 'Soil moisture retrieval over farmland',
  savedAt: '2026-09-15T00:00:00.000Z',
});

function text(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(text).join('');
}

describe('paper summary library panel', () => {
  beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
  afterEach(() => vi.unstubAllGlobals());

  it('puts papers that mention the project topics first and marks the ones already in the table', () => {
    const ranked = rankPaperLibraryEntries([unrelated, lasso, tabpfn], {
      relevanceText:
        'Class Expansion for TFM · TabPFN class expansion · graphical lasso covariance',
      knownUrls: new Set(['https://doi.org/10.1093/biostatistics/kxm045']),
      filterText: '',
    });

    expect(ranked.map(({ entry: item }) => item.id)).toEqual([lasso.id, tabpfn.id, unrelated.id]);
    expect(ranked.map(({ related }) => related)).toEqual([true, true, false]);
    expect(ranked.map(({ alreadySaved }) => alreadySaved)).toEqual([true, false, false]);
    expect(
      rankPaperLibraryEntries([unrelated, lasso, tabpfn], {
        relevanceText: '',
        knownUrls: new Set(),
        filterText: 'hollmann tabpfn',
      }).map(({ entry: item }) => item.id),
    ).toEqual([]);
    expect(
      rankPaperLibraryEntries([unrelated, lasso, tabpfn], {
        relevanceText: '',
        knownUrls: new Set(),
        filterText: 'LASSO',
      }).map(({ entry: item }) => item.id),
    ).toEqual([lasso.id]);
  });

  it('selects the related papers in one click, imports them by id and reports the result', async () => {
    const importPapers = vi.fn(async () => ({
      projectId: 'p',
      importedCount: 1,
      alreadySavedCount: 0,
      missingCount: 0,
    }));
    const onImported = vi.fn();
    let ui!: ReturnType<typeof create>;
    await act(async () => {
      ui = create(
        <LiteraturePaperLibraryPanel
          relevanceText="TabPFN class expansion graphical lasso"
          knownUrls={new Set(['https://doi.org/10.1093/biostatistics/kxm045'])}
          list={async () => ({ entries: [unrelated, lasso, tabpfn], unverifiedCount: 2 })}
          importPapers={importPapers}
          onImported={onImported}
          onClose={() => undefined}
        />,
      );
    });
    const button = (label: string) =>
      ui.root.findAllByType('button').find((item) => text(item).startsWith(label))!;

    expect(text(ui.root)).toContain('3 saved · 2 related to this project');
    expect(text(ui.root)).toContain('2 saved analyses have no verified paper');
    expect(button('Add 0 selected').props.disabled).toBe(true);
    await act(async () => button('Select related').props.onClick());
    // The related paper that is already in the table cannot be selected again.
    expect(button('Add 1 selected').props.disabled).toBe(false);
    await act(async () => button('Add 1 selected').props.onClick());

    expect(importPapers).toHaveBeenCalledExactlyOnceWith([tabpfn.id]);
    expect(onImported).toHaveBeenCalledExactlyOnceWith({
      projectId: 'p',
      importedCount: 1,
      alreadySavedCount: 0,
      missingCount: 0,
    });
  });

  it('explains a locked or unreadable library instead of showing an empty list', async () => {
    let ui!: ReturnType<typeof create>;
    await act(async () => {
      ui = create(
        <LiteraturePaperLibraryPanel
          relevanceText=""
          knownUrls={new Set()}
          list={async () => {
            throw new Error('paper_library_unavailable');
          }}
          importPapers={vi.fn()}
          onImported={vi.fn()}
          onClose={() => undefined}
        />,
      );
    });

    expect(ui.root.findByProps({ role: 'alert' }).children.join('')).toContain(
      'The paper summary library could not be read',
    );
  });
});
