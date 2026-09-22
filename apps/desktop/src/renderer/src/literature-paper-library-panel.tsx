import { uiText, useUiText } from '@gosu/ui/language';
import { useEffect, useMemo, useState } from 'react';

import {
  literatureQueryTerms,
  literatureTermMatchCount,
  requiredLiteratureTermMatches,
} from '../../shared/literature-query';
import {
  PAPER_LIBRARY_MAX_IMPORT,
  type ImportPaperSummariesReceipt,
  type PaperLibraryEntry,
  type PaperLibraryList,
} from '../../shared/paper-library-contracts';

export type RankedPaperLibraryEntry = Readonly<{
  entry: PaperLibraryEntry;
  related: boolean;
  alreadySaved: boolean;
}>;

function entryText(entry: PaperLibraryEntry) {
  return [entry.title, entry.summary, ...entry.keywords, ...entry.tags, entry.venue ?? ''].join(
    ' ',
  );
}

/**
 * Saved papers that mention what this project is about come first. "About" is whatever the view
 * already knows without a model: the project name, its recent searches and its search tags.
 */
export function rankPaperLibraryEntries(
  entries: readonly PaperLibraryEntry[],
  options: Readonly<{ relevanceText: string; knownUrls: ReadonlySet<string>; filterText: string }>,
): RankedPaperLibraryEntry[] {
  const terms = literatureQueryTerms(options.relevanceText);
  const required = requiredLiteratureTermMatches(terms.length);
  const needles = options.filterText.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return entries
    .filter((entry) => {
      if (needles.length === 0) return true;
      const haystack = `${entryText(entry)} ${entry.authors.join(' ')}`.toLocaleLowerCase();
      return needles.every((needle) => haystack.includes(needle));
    })
    .map((entry) => {
      const score = literatureTermMatchCount(entryText(entry), terms);
      return {
        entry,
        score,
        related: required > 0 && score >= required,
        alreadySaved: options.knownUrls.has(entry.sourceUrl),
      };
    })
    .sort(
      (left, right) =>
        Number(right.related) - Number(left.related) ||
        (left.related ? right.score - left.score : 0) ||
        right.entry.savedAt.localeCompare(left.entry.savedAt),
    )
    .map(({ entry, related, alreadySaved }) => ({ entry, related, alreadySaved }));
}

function libraryErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    paper_library_unavailable:
      'The paper summary library could not be read. Check that the macOS keychain is unlocked, then try again.',
    invalid_paper_library_input: 'Choose between 1 and 50 papers.',
    literature_record_limit_reached:
      'This project already has 500 active papers. Remove a paper before adding more; this operation changed nothing.',
    literature_project_unavailable:
      'This project is archived or in the trash, so nothing was added.',
  };
  return uiText(
    messages[code] ?? 'The papers could not be added. Nothing in the evidence table was changed.',
  );
}

export function LiteraturePaperLibraryPanel({
  relevanceText,
  knownUrls,
  list,
  importPapers,
  onImported,
  onClose,
}: {
  relevanceText: string;
  knownUrls: ReadonlySet<string>;
  list: () => Promise<PaperLibraryList>;
  importPapers: (paperIds: string[]) => Promise<ImportPaperSummariesReceipt>;
  onImported: (receipt: ImportPaperSummariesReceipt) => void;
  onClose: () => void;
}) {
  useUiText();
  const [library, setLibrary] = useState<PaperLibraryList | null>(null);
  const [error, setError] = useState('');
  // A failed import keeps the list and the selection; only a failed read replaces the list.
  const [importError, setImportError] = useState('');
  const [filterText, setFilterText] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    list().then(
      (next) => active && setLibrary(next),
      (reason: unknown) => active && setError(libraryErrorMessage(reason)),
    );
    return () => {
      active = false;
    };
  }, [list]);

  const ranked = useMemo(
    () => rankPaperLibraryEntries(library?.entries ?? [], { relevanceText, knownUrls, filterText }),
    [library, relevanceText, knownUrls, filterText],
  );
  const relatedCount = useMemo(
    () =>
      rankPaperLibraryEntries(library?.entries ?? [], {
        relevanceText,
        knownUrls,
        filterText: '',
      }).filter(({ related }) => related).length,
    [library, relevanceText, knownUrls],
  );
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < PAPER_LIBRARY_MAX_IMPORT) next.add(id);
      return next;
    });

  return (
    <section className="literature-paper-library" aria-label={uiText('Add from paper summaries')}>
      <header>
        <strong>{uiText('Add from paper summaries')}</strong>
        {library && (
          <span>
            {uiText('{total} saved · {related} related to this project', {
              total: library.entries.length,
              related: relatedCount,
            })}
          </span>
        )}
        <button type="button" className="ghost-button" onClick={onClose}>
          {uiText('Close')}
        </button>
      </header>
      {error ? (
        <p className="literature-paper-library-note" role="alert">
          {error}
        </p>
      ) : !library ? (
        <p className="literature-paper-library-note" role="status">
          {uiText('Reading the paper summary library…')}
        </p>
      ) : library.entries.length === 0 ? (
        <p className="literature-paper-library-note">
          {uiText(
            'No verified paper is saved in the paper summary library yet. Save papers from Briefing Lab or a chat first.',
          )}
        </p>
      ) : (
        <>
          <div className="literature-paper-library-tools">
            <input
              type="search"
              value={filterText}
              aria-label={uiText('Filter saved papers')}
              placeholder={uiText('Filter by title, author, or keyword')}
              onChange={(event) => setFilterText(event.target.value)}
            />
            <button
              type="button"
              className="secondary-button"
              disabled={busy || relatedCount === 0}
              onClick={() =>
                setSelected(
                  new Set(
                    ranked
                      .filter(({ related, alreadySaved }) => related && !alreadySaved)
                      .slice(0, PAPER_LIBRARY_MAX_IMPORT)
                      .map(({ entry }) => entry.id),
                  ),
                )
              }
            >
              {uiText('Select related')}
            </button>
          </div>
          {ranked.length === 0 ? (
            <p className="literature-paper-library-note">
              {uiText('No saved paper matches this filter.')}
            </p>
          ) : (
            <ol>
              {ranked.map(({ entry, related, alreadySaved }) => (
                <li key={entry.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(entry.id)}
                      disabled={busy || alreadySaved}
                      onChange={() => toggle(entry.id)}
                    />
                    <span className="literature-paper-library-title">{entry.title}</span>
                    <small>
                      {[
                        entry.authors.slice(0, 3).join(', ') +
                          (entry.authors.length > 3 ? ' …' : ''),
                        entry.year ?? '',
                        entry.venue ?? '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                    {alreadySaved ? (
                      <em>{uiText('Already in table')}</em>
                    ) : related ? (
                      <em className="related">{uiText('Related')}</em>
                    ) : null}
                  </label>
                </li>
              ))}
            </ol>
          )}
          {library.unverifiedCount > 0 && (
            <p className="literature-paper-library-note">
              {uiText('{count} saved analyses have no verified paper and cannot be imported.', {
                count: library.unverifiedCount,
              })}
            </p>
          )}
          <footer>
            <button
              type="button"
              className="primary-button"
              disabled={busy || selected.size === 0}
              onClick={() => {
                setBusy(true);
                setImportError('');
                importPapers([...selected]).then(
                  (receipt) => {
                    setBusy(false);
                    setSelected(new Set());
                    onImported(receipt);
                  },
                  (reason: unknown) => {
                    setBusy(false);
                    setImportError(libraryErrorMessage(reason));
                  },
                );
              }}
            >
              {busy ? uiText('Adding…') : uiText('Add {count} selected', { count: selected.size })}
            </button>
            {importError && <small role="alert">{importError}</small>}
            {selected.size === PAPER_LIBRARY_MAX_IMPORT && (
              <small>
                {uiText('You can add at most {max} papers at once.', {
                  max: PAPER_LIBRARY_MAX_IMPORT,
                })}
              </small>
            )}
          </footer>
        </>
      )}
    </section>
  );
}
