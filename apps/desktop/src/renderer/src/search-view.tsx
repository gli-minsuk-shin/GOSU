import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import type {
  SearchCategory,
  SearchHit,
  SearchInput,
  SearchResponse,
  SearchScope,
} from '../../shared/search-contracts';
import {
  SEARCH_CATEGORY_LABELS,
  searchCategoryCount,
  searchResultCount,
  visibleSearchGroups,
} from './search-results-model';
import { describeError } from './ui-primitives';

export interface SearchViewAdapter {
  search(input: SearchInput): Promise<SearchResponse>;
}

export function shouldAcceptSearchResponse(
  currentGeneration: number,
  requestGeneration: number,
  currentScopeKey: string,
  requestScopeKey: string,
) {
  return currentGeneration === requestGeneration && currentScopeKey === requestScopeKey;
}

export function SearchView({
  adapter,
  scope,
  scopeLabel,
  initialQuery = '',
  compact = false,
  onOpen,
}: {
  adapter: SearchViewAdapter;
  scope: SearchScope;
  scopeLabel: string;
  initialQuery?: string;
  compact?: boolean;
  onOpen: (hit: SearchHit) => void;
}) {
  const searchInputId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [activeCategory, setActiveCategory] = useState<SearchCategory | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopeKey = scope.kind === 'project' ? `project:${scope.projectId}` : 'global';
  const currentScopeKeyRef = useRef(scopeKey);
  const requestGenerationRef = useRef(0);
  currentScopeKeyRef.current = scopeKey;
  useEffect(() => {
    requestGenerationRef.current += 1;
    setResponse(null);
    setActiveCategory('all');
    setBusy(false);
    setError(null);
  }, [scope.kind, scope.kind === 'project' ? scope.projectId : 'global']);

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    const requested = query.trim();
    if (!requested || busy) return;
    const requestGeneration = requestGenerationRef.current + 1;
    const requestScopeKey = scopeKey;
    requestGenerationRef.current = requestGeneration;
    setBusy(true);
    setError(null);
    try {
      const next = await adapter.search({
        query: requested,
        scope,
        ...(compact ? { categories: ['research-notes'] as const } : {}),
        limitPerCategory: compact ? 12 : 20,
      });
      if (
        shouldAcceptSearchResponse(
          requestGenerationRef.current,
          requestGeneration,
          currentScopeKeyRef.current,
          requestScopeKey,
        )
      ) {
        setResponse(next);
      }
    } catch (failure) {
      if (
        shouldAcceptSearchResponse(
          requestGenerationRef.current,
          requestGeneration,
          currentScopeKeyRef.current,
          requestScopeKey,
        )
      ) {
        setError(describeError(failure));
      }
    } finally {
      if (
        shouldAcceptSearchResponse(
          requestGenerationRef.current,
          requestGeneration,
          currentScopeKeyRef.current,
          requestScopeKey,
        )
      ) {
        setBusy(false);
      }
    }
  };

  const groups = visibleSearchGroups(response, activeCategory);
  return (
    <section className={`search-view${compact ? ' compact' : ''}`} aria-label="Workspace search">
      <form className="search-form" role="search" onSubmit={(event) => void runSearch(event)}>
        <label htmlFor={searchInputId}>
          {compact ? 'Search Research Notes' : `Search ${scopeLabel}`}
        </label>
        <div className="search-form-controls">
          <input
            id={searchInputId}
            type="search"
            value={query}
            autoComplete="off"
            placeholder={
              compact ? 'Title, path, content, or tag' : 'Keyword, paper, metric, task, or file'
            }
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="primary-button" disabled={busy || !query.trim()}>
            {busy ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>
      {error && <div className="notice error">{error}</div>}
      {response && (
        <>
          <nav className="search-category-tabs" aria-label="Search result categories">
            <button
              type="button"
              className={activeCategory === 'all' ? 'active' : ''}
              aria-pressed={activeCategory === 'all'}
              onClick={() => setActiveCategory('all')}
            >
              All <span>{searchResultCount(response)}</span>
            </button>
            {response.groups.map((group) => (
              <button
                type="button"
                key={group.category}
                className={activeCategory === group.category ? 'active' : ''}
                aria-pressed={activeCategory === group.category}
                onClick={() => setActiveCategory(group.category)}
              >
                {SEARCH_CATEGORY_LABELS[group.category]}{' '}
                <span>{searchCategoryCount(response, group.category)}</span>
              </button>
            ))}
          </nav>
          <div className="search-results" aria-live="polite">
            {searchResultCount(response) === 0 && (
              <p className="search-empty">No local results for “{response.query}”.</p>
            )}
            {groups.map((group) => (
              <section className="search-result-group" key={group.category}>
                <header>
                  <h2>{SEARCH_CATEGORY_LABELS[group.category]}</h2>
                  <span>
                    {group.items.length}
                    {group.truncated ? '+' : ''}
                  </span>
                </header>
                {(group.unavailableReason || group.incomplete) && (
                  <p className="search-source-warning">
                    {group.unavailableReason ??
                      'Some local results could not be validated. Available matches are still shown.'}
                  </p>
                )}
                {group.items.map((hit) => (
                  <button
                    type="button"
                    className="search-result-row"
                    key={hit.id}
                    onClick={() => onOpen(hit)}
                  >
                    <span className="search-result-project">{hit.projectName}</span>
                    <strong>{hit.title}</strong>
                    <p>{hit.snippet || hit.matchedFields.join(', ')}</p>
                    <small>
                      {SEARCH_CATEGORY_LABELS[hit.category]}
                      {hit.updatedAt ? ` · ${new Date(hit.updatedAt).toLocaleString()}` : ''}
                    </small>
                  </button>
                ))}
              </section>
            ))}
          </div>
        </>
      )}
      {!response && !busy && !compact && (
        <p className="search-empty">Enter a keyword to search every non-trashed project.</p>
      )}
    </section>
  );
}
