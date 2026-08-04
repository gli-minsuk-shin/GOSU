import { useEffect, useMemo, useState } from 'react';

import type {
  DeleteLiteratureRecordInput,
  DeleteLiteratureRecordReceipt,
  LiteratureExportReceipt,
  LiteratureExportRequest,
  LiteratureImportReceipt,
  LiteratureImportRequest,
  LiteratureLibrary,
  LiteratureOrganizeReceipt,
  LiteratureRecord,
  LiteratureSearchInput,
  LiteratureSearchReceipt,
  LiteratureSearchRun,
  LiteratureTransferFormat,
  ListLiteratureInput,
  OrganizeLiteratureInput,
  UpdateLiteratureAnnotationsInput,
} from '../../shared/literature-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';
import {
  buildLiteratureTablePage,
  nextLiteratureSort,
  type LiteratureSortDirection,
  type LiteratureSortKey,
  type LiteratureTableRecord,
} from './literature-table-model';

export interface LiteratureViewAdapter {
  list: (input: ListLiteratureInput) => Promise<LiteratureLibrary>;
  search: (input: LiteratureSearchInput) => Promise<LiteratureSearchReceipt>;
  updateAnnotations: (input: UpdateLiteratureAnnotationsInput) => Promise<LiteratureRecord>;
  deleteRecord: (input: DeleteLiteratureRecordInput) => Promise<DeleteLiteratureRecordReceipt>;
  importRecords: (input: LiteratureImportRequest) => Promise<LiteratureImportReceipt>;
  exportRecords: (input: LiteratureExportRequest) => Promise<LiteratureExportReceipt>;
  organize?: (input: OrganizeLiteratureInput) => Promise<LiteratureOrganizeReceipt>;
}

export interface LiteratureViewRecord extends LiteratureTableRecord {
  record: LiteratureRecord;
}

const COLUMN_LABELS: ReadonlyArray<{
  key: LiteratureSortKey;
  label: string;
}> = [
  { key: 'title', label: 'Title' },
  { key: 'authors', label: 'Authors' },
  { key: 'venue', label: 'Journal / venue' },
  { key: 'year', label: 'Year' },
  { key: 'topics', label: 'Topics' },
  { key: 'doi', label: 'DOI' },
  { key: 'citedBy', label: 'Cited by' },
  { key: 'type', label: 'Type' },
  { key: 'reviewStatus', label: 'Review status' },
  { key: 'source', label: 'Source' },
];

const REVIEW_STATUSES = ['unreviewed', 'screening', 'included', 'excluded', 'reviewed'] as const;

function literatureErrorMessage(error: unknown) {
  const code = error instanceof Error ? (error.message.split(':')[0] ?? '') : '';
  const messages: Record<string, string> = {
    literature_provider_unavailable:
      'The literature provider is unavailable. Your saved evidence table is still available.',
    literature_rate_limited:
      'The literature provider asked GOSU to slow down. Wait briefly, then search again.',
    literature_record_conflict:
      'This paper changed since you opened it. GOSU kept both versions safe; refresh before editing again.',
    literature_record_limit_reached:
      'This project already has 500 active papers. Remove a paper before adding more; this operation changed nothing.',
    literature_identity_conflict:
      'The DOI, provider ID, and metadata fingerprint point to different saved papers. GOSU changed nothing so you can review the conflict safely.',
    literature_import_invalid:
      'That file could not be imported. Use a GOSU JSON or CSV export, or valid BibTeX.',
    literature_import_too_large:
      'That import is too large for one local operation. Split it into smaller review files.',
    literature_export_too_large:
      'This export is too large for one local operation. Filter or select fewer records.',
    literature_ai_busy: 'Another literature organization turn is already running for this project.',
    literature_ai_unavailable:
      'AI organization is unavailable. Search and manual literature review remain usable.',
    literature_ai_invalid_response:
      'The linked model did not return valid structured annotations. No paper was overwritten.',
    literature_ai_conflict:
      'Some papers changed while AI organization was running. GOSU skipped the stale annotations.',
    invalid_literature_input: 'Check the search years and fields, then try again.',
    literature_unavailable:
      'The local literature library is unavailable. Board, Notes, and existing project work remain usable.',
  };
  return (
    messages[code] ??
    'The literature operation could not be completed. Saved records were not removed.'
  );
}

function formatLabel(value: string) {
  return value
    .replaceAll('-', ' ')
    .replaceAll('_', ' ')
    .replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase());
}

export function literatureViewRecord(record: LiteratureRecord): LiteratureViewRecord {
  const topics = [
    ...record.manualAnnotations.topics,
    ...(record.aiAnnotations?.topics ?? []),
    ...record.sourceTopics,
  ].filter((topic, index, all) => all.indexOf(topic) === index);
  return {
    id: record.id,
    title: record.title,
    authors: record.authors,
    venue: record.containerTitle ?? '',
    year: record.publishedYear,
    topics,
    doi: record.doi ?? '',
    type: record.workType ?? '',
    citedBy: record.citationCount,
    reviewStatus: record.reviewStatus,
    source: record.provider,
    record,
  };
}

function parseYear(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function LiteratureSortButton({
  column,
  activeKey,
  direction,
  onSort,
}: {
  column: (typeof COLUMN_LABELS)[number];
  activeKey: LiteratureSortKey;
  direction: LiteratureSortDirection;
  onSort: (key: LiteratureSortKey) => void;
}) {
  const active = activeKey === column.key;
  const ariaSort = active ? (direction === 'ascending' ? 'ascending' : 'descending') : undefined;
  return (
    <th scope="col" aria-sort={ariaSort}>
      <button
        type="button"
        className={`literature-sort-button${active ? ' active' : ''}`}
        onClick={() => onSort(column.key)}
      >
        {column.label}
        <span aria-hidden="true">{active ? (direction === 'ascending' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

export function LiteratureTable({
  records,
  selectedId,
  textFilter,
  statusFilter,
  sortKey,
  sortDirection,
  page,
  onSelect,
  onSort,
  onPage,
}: {
  records: readonly LiteratureViewRecord[];
  selectedId: string | null;
  textFilter: string;
  statusFilter: string;
  sortKey: LiteratureSortKey;
  sortDirection: LiteratureSortDirection;
  page: number;
  onSelect: (recordId: string) => void;
  onSort: (key: LiteratureSortKey) => void;
  onPage: (page: number) => void;
}) {
  const result = useMemo(
    () =>
      buildLiteratureTablePage(records, {
        text: textFilter,
        reviewStatus: statusFilter,
        sortKey,
        sortDirection,
        page,
      }),
    [page, records, sortDirection, sortKey, statusFilter, textFilter],
  );

  if (result.total === 0) {
    return (
      <div className="literature-empty">
        <div>
          <h2>{records.length === 0 ? 'No papers yet' : 'No matching papers'}</h2>
          <p>
            {records.length === 0
              ? 'Run a search or import an existing review. New searches merge into this project library.'
              : 'Clear the table filter or choose another review status.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="literature-table-scroll" tabIndex={0} aria-label="Literature table">
        <table className="literature-table">
          <thead>
            <tr>
              {COLUMN_LABELS.map((column) => (
                <LiteratureSortButton
                  key={column.key}
                  column={column}
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={onSort}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((record) => (
              <tr key={record.id} className={selectedId === record.id ? 'selected' : ''}>
                <td>
                  <button
                    type="button"
                    className="literature-table-title"
                    aria-pressed={selectedId === record.id}
                    onClick={() => onSelect(record.id)}
                  >
                    <span>{record.title}</span>
                  </button>
                </td>
                <td>{record.authors.join(', ') || 'Unknown'}</td>
                <td>{record.venue || '—'}</td>
                <td>{record.year ?? '—'}</td>
                <td>
                  <div className="literature-topic-list">
                    {record.topics.slice(0, 3).map((topic) => (
                      <span className="literature-topic-chip" key={topic}>
                        {topic}
                      </span>
                    ))}
                    {record.topics.length > 3 && <small>+{record.topics.length - 3}</small>}
                  </div>
                </td>
                <td>{record.doi || '—'}</td>
                <td>{record.citedBy ?? '—'}</td>
                <td>{formatLabel(record.type)}</td>
                <td>
                  <span className={`literature-status-chip ${record.reviewStatus}`}>
                    {formatLabel(record.reviewStatus)}
                  </span>
                </td>
                <td>{formatLabel(record.source)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="literature-pagination">
        <span>
          {result.total.toLocaleString()} matching · page {result.page} of {result.pageCount}
        </span>
        <div>
          <button
            type="button"
            className="secondary-button"
            disabled={result.page <= 1}
            onClick={() => onPage(result.page - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={result.page >= result.pageCount}
            onClick={() => onPage(result.page + 1)}
          >
            Next
          </button>
        </div>
      </footer>
    </>
  );
}

function LiteratureDetail({
  record,
  busy,
  onSave,
  onDelete,
}: {
  record: LiteratureRecord;
  busy: boolean;
  onSave: (input: {
    record: LiteratureRecord;
    manualTopics: string[];
    manualSummary: string;
    manualRelevance: string;
    reviewStatus: LiteratureRecord['reviewStatus'];
  }) => Promise<void>;
  onDelete: (record: LiteratureRecord) => Promise<void>;
}) {
  const [topics, setTopics] = useState(record.manualAnnotations.topics.join(', '));
  const [summary, setSummary] = useState(record.manualAnnotations.summary);
  const [relevance, setRelevance] = useState(record.manualAnnotations.relevance);
  const [reviewStatus, setReviewStatus] = useState(record.reviewStatus);

  useEffect(() => {
    setTopics(record.manualAnnotations.topics.join(', '));
    setSummary(record.manualAnnotations.summary);
    setRelevance(record.manualAnnotations.relevance);
    setReviewStatus(record.reviewStatus);
  }, [record]);

  return (
    <section className="literature-detail-card" aria-labelledby="literature-detail-title">
      <header className="literature-detail-heading">
        <div>
          <span className="eyebrow">Selected paper</span>
          <h2 id="literature-detail-title">{record.title}</h2>
          <p>{record.authors.join(', ') || 'Unknown authors'}</p>
        </div>
        {record.sourceUrl && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              if (record.sourceUrl) void window.gosu.openExternal(record.sourceUrl);
            }}
          >
            Open source ↗
          </button>
        )}
      </header>

      <div className="literature-detail-grid">
        <div>
          <small>Journal / venue</small>
          <strong>{record.containerTitle || 'Not provided'}</strong>
        </div>
        <div>
          <small>Published</small>
          <strong>{record.publishedYear ?? 'Unknown'}</strong>
        </div>
        <div>
          <small>DOI</small>
          <strong>{record.doi || 'Not provided'}</strong>
        </div>
        <div>
          <small>BibTeX key</small>
          <strong>{record.citationKey || 'Assigned on export'}</strong>
        </div>
        <div>
          <small>Type</small>
          <strong>{record.workType ? formatLabel(record.workType) : 'Not provided'}</strong>
        </div>
        <div>
          <small>Cited by</small>
          <strong>{record.citationCount ?? 'Not provided'}</strong>
        </div>
        <div>
          <small>Source</small>
          <strong>{formatLabel(record.provider)}</strong>
        </div>
      </div>

      {record.aiAnnotations &&
        (record.aiAnnotations.summary || record.aiAnnotations.topics.length > 0) && (
          <section className="literature-ai-summary" aria-label="AI organization">
            <span className="eyebrow">AI summary · metadata-only draft</span>
            {record.aiAnnotations.summary && <p>{record.aiAnnotations.summary}</p>}
            <dl className="literature-ai-facts">
              <div>
                <dt>Likely relevance</dt>
                <dd>{formatLabel(record.aiAnnotations.relevance)}</dd>
              </div>
              <div>
                <dt>Study type</dt>
                <dd>{record.aiAnnotations.studyType || 'Not assessable from metadata alone'}</dd>
              </div>
            </dl>
            <div className="literature-topic-list">
              {record.aiAnnotations.topics.map((topic) => (
                <span className="literature-topic-chip" key={topic}>
                  {topic}
                </span>
              ))}
            </div>
            {record.aiAnnotations.limitations.length > 0 && (
              <div className="literature-ai-limitations">
                <strong>Metadata limitations</strong>
                <ul>
                  {record.aiAnnotations.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

      <form
        className="literature-annotation-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          void onSave({
            record,
            manualTopics: topics
              .split(',')
              .map((topic) => topic.trim())
              .filter(Boolean),
            manualSummary: summary.trim(),
            manualRelevance: relevance.trim(),
            reviewStatus,
          });
        }}
      >
        <label>
          Manual topics
          <input
            value={topics}
            maxLength={1000}
            placeholder="retrieval, evaluation, robustness"
            disabled={busy}
            onChange={(event) => setTopics(event.target.value)}
          />
        </label>
        <label>
          Review status
          <select
            value={reviewStatus}
            disabled={busy}
            onChange={(event) =>
              setReviewStatus(event.target.value as LiteratureRecord['reviewStatus'])
            }
          >
            {REVIEW_STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label className="full-width">
          Manual summary
          <textarea
            value={summary}
            maxLength={8000}
            placeholder="Summarize the evidence you verified in this paper."
            disabled={busy}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
        <label className="full-width">
          Relevance to this project
          <textarea
            value={relevance}
            maxLength={4000}
            placeholder="Explain why this paper matters for the project objective."
            disabled={busy}
            onChange={(event) => setRelevance(event.target.value)}
          />
        </label>
        <div className="literature-detail-actions">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? 'Saving…' : 'Save review notes'}
          </button>
          <button
            type="button"
            className="danger-button"
            disabled={busy}
            onClick={() => void onDelete(record)}
          >
            Delete paper
          </button>
          <span className="literature-ai-availability">
            Manual review notes are kept separate from AI-generated organization.
          </span>
        </div>
      </form>
    </section>
  );
}

export function LiteratureView({
  project,
  adapter,
  aiAvailable = true,
  requestedModelId = null,
  reasoningOptionId = null,
}: {
  project: ProjectRecord;
  adapter: LiteratureViewAdapter;
  aiAvailable?: boolean;
  requestedModelId?: string | null;
  reasoningOptionId?: string | null;
}) {
  const [records, setRecords] = useState<readonly LiteratureRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [recentSearches, setRecentSearches] = useState<readonly LiteratureSearchRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [fromYear, setFromYear] = useState('');
  const [toYear, setToYear] = useState('');
  const [textFilter, setTextFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState<LiteratureSortKey>('year');
  const [sortDirection, setSortDirection] = useState<LiteratureSortDirection>('descending');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = records.find((record) => record.id === selectedId) ?? null;
  const tableRecords = useMemo(() => records.map(literatureViewRecord), [records]);
  const aiCandidates = useMemo(
    () => records.filter((record) => record.aiAnnotations === null).slice(0, 50),
    [records],
  );

  const refresh = async () => {
    const next = await adapter.list({ projectId: project.id });
    setRecords(next.records);
    setTotalRecords(next.total);
    setRecentSearches(next.recentSearches);
    setSelectedId((current) =>
      current && next.records.some((record) => record.id === current) ? current : null,
    );
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setNotice('');
    setSelectedId(null);
    void adapter
      .list({ projectId: project.id })
      .then((next) => {
        if (active) {
          setRecords(next.records);
          setTotalRecords(next.total);
          setRecentSearches(next.recentSearches);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(literatureErrorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [adapter, project.id]);

  const run = async (label: string, operation: () => Promise<string>) => {
    if (busy) return;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      const message = await operation();
      setNotice(message);
    } catch (reason) {
      setError(literatureErrorMessage(reason));
    } finally {
      setBusy('');
    }
  };

  const handleImport = async () => {
    await run('import', async () => {
      const receipt = await adapter.importRecords({ projectId: project.id });
      if (receipt.status === 'cancelled') {
        return 'Import cancelled. No literature records were changed.';
      }
      await refresh();
      return `Imported ${receipt.importedCount}, updated ${receipt.updatedCount}, skipped ${receipt.unchangedCount}. Existing DOI and source records were merged.`;
    });
  };

  const handleExport = async (format: LiteratureTransferFormat) => {
    await run(`export:${format}`, async () => {
      const receipt = await adapter.exportRecords({ projectId: project.id, format });
      return receipt.status === 'cancelled'
        ? 'Export cancelled. No file was written.'
        : `Exported ${receipt.recordCount} papers to ${receipt.fileName ?? `a ${format.toLocaleUpperCase()} file`}.`;
    });
  };

  const handleSort = (requestedKey: LiteratureSortKey) => {
    const next = nextLiteratureSort(sortKey, sortDirection, requestedKey);
    setSortKey(next.sortKey);
    setSortDirection(next.sortDirection);
    setPage(1);
  };

  return (
    <div className="literature-workspace">
      <section className="literature-search-card" aria-labelledby="literature-search-title">
        <header className="literature-library-heading">
          <strong id="literature-search-title">Search and continue this review</strong>
          <span>New results merge into this project’s existing evidence table.</span>
        </header>
        <form
          className="literature-search-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || query.trim().length < 2) return;
            void run('search', async () => {
              const start = parseYear(fromYear);
              const end = parseYear(toYear);
              if (start && end && start > end) throw new Error('invalid_literature_input');
              const result = await adapter.search({
                projectId: project.id,
                query: query.trim(),
                ...(start ? { fromYear: start } : {}),
                ...(end ? { toYear: end } : {}),
              });
              await refresh();
              setPage(1);
              return `Search complete: ${result.foundCount} found, ${result.newCount} added, ${result.updatedCount} updated, ${result.unchangedCount} unchanged.`;
            });
          }}
        >
          <label>
            Research question or keywords
            <input
              value={query}
              minLength={2}
              maxLength={500}
              placeholder="e.g. retrieval augmented generation evaluation"
              disabled={Boolean(busy)}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            From year
            <input
              type="number"
              inputMode="numeric"
              min="1000"
              max="3000"
              value={fromYear}
              placeholder="Any"
              disabled={Boolean(busy)}
              onChange={(event) => setFromYear(event.target.value)}
            />
          </label>
          <label>
            To year
            <input
              type="number"
              inputMode="numeric"
              min="1000"
              max="3000"
              value={toYear}
              placeholder="Any"
              disabled={Boolean(busy)}
              onChange={(event) => setToYear(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={Boolean(busy) || query.trim().length < 2}
          >
            {busy === 'search'
              ? 'Searching…'
              : records.length > 0
                ? 'Search again'
                : 'Search papers'}
          </button>
        </form>
        <p className="literature-search-help">
          <strong>Continual review:</strong> each search is additive. Matching DOI or provider
          records update in place instead of creating duplicate rows.
        </p>
        {recentSearches.length > 0 && (
          <div className="literature-recent-searches" aria-label="Recent literature searches">
            <span>Recent</span>
            {recentSearches.slice(0, 6).map((search) => (
              <button
                type="button"
                key={search.id}
                disabled={Boolean(busy)}
                title={`Reuse “${search.query}”${search.fromYear ? ` from ${search.fromYear}` : ''}${search.toYear ? ` through ${search.toYear}` : ''}`}
                onClick={() => {
                  setQuery(search.query);
                  setFromYear(search.fromYear?.toString() ?? '');
                  setToYear(search.toYear?.toString() ?? '');
                }}
              >
                {search.query}
              </button>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div className="notice error" role="alert">
          <span>{error}</span>
          <button type="button" className="ghost-button" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button type="button" className="ghost-button" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </div>
      )}

      <section className="literature-library-card" aria-labelledby="literature-library-title">
        <header className="literature-library-toolbar">
          <div className="literature-library-heading">
            <strong id="literature-library-title">Evidence table</strong>
            <span>
              {totalRecords.toLocaleString()} saved in this project
              {totalRecords > records.length ? ` · ${records.length} loaded` : ''}
            </span>
          </div>
          <div className="literature-library-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={Boolean(busy)}
              onClick={() => void handleImport()}
            >
              Import
            </button>
            {(['json', 'csv', 'bibtex'] as const).map((format) => (
              <button
                type="button"
                className="secondary-button"
                key={format}
                disabled={Boolean(busy) || records.length === 0}
                onClick={() => void handleExport(format)}
              >
                Export {format === 'bibtex' ? 'BibTeX' : format.toLocaleUpperCase()}
              </button>
            ))}
            <button
              type="button"
              className="secondary-button"
              disabled={
                Boolean(busy) || aiCandidates.length === 0 || !adapter.organize || !aiAvailable
              }
              title={
                adapter.organize && aiAvailable && aiCandidates.length > 0
                  ? `Organize the next ${aiCandidates.length} papers without an AI draft using the linked model`
                  : adapter.organize && aiAvailable
                    ? 'Every loaded paper already has an AI organization draft'
                    : adapter.organize
                      ? 'Connect and sign in to Codex before organizing literature'
                      : 'AI organization is not available until a typed local provider is connected'
              }
              onClick={() => {
                const organize = adapter.organize;
                if (!organize || !aiAvailable) return;
                const recordIds = aiCandidates.map(({ id }) => id);
                void run('organize', async () => {
                  const result = await organize({
                    projectId: project.id,
                    recordIds,
                    requestedModelId,
                    reasoningOptionId,
                  });
                  await refresh();
                  return `AI organization updated ${result.updatedCount} papers and skipped ${result.skippedCount}. Review the metadata-only drafts before using them.`;
                });
              }}
            >
              {busy === 'organize'
                ? 'Organizing…'
                : aiCandidates.length > 0
                  ? `Organize next ${aiCandidates.length}`
                  : 'AI drafts complete'}
            </button>
          </div>
        </header>
        {(!adapter.organize || !aiAvailable) && (
          <p className="literature-ai-availability">
            {adapter.organize
              ? 'Connect and sign in to Codex to organize metadata into draft topics, summaries, and relevance.'
              : 'AI organization is disabled in this build.'}{' '}
            Search, manual review, import, and export stay fully usable without the model provider.
          </p>
        )}
        {adapter.organize && aiAvailable && (
          <p className="literature-ai-availability">
            Uses the linked selection: {requestedModelId ?? 'Auto · provider recommended'} ·
            reasoning {reasoningOptionId ?? 'model default'}. AI drafts use metadata only and remain
            separate from human review notes.
          </p>
        )}
        <div className="literature-filter-bar">
          <label>
            <span>Filter evidence table</span>
            <input
              type="search"
              value={textFilter}
              placeholder="Filter title, author, topic, venue, or DOI"
              onChange={(event) => {
                setTextFilter(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            <span>Review status</span>
            <select
              aria-label="Review status filter"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All review statuses</option>
              {REVIEW_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatLabel(status)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <div className="literature-loading" role="status">
            Opening this project’s literature library…
          </div>
        ) : (
          <LiteratureTable
            records={tableRecords}
            selectedId={selectedId}
            textFilter={textFilter}
            statusFilter={statusFilter}
            sortKey={sortKey}
            sortDirection={sortDirection}
            page={page}
            onSelect={setSelectedId}
            onSort={handleSort}
            onPage={setPage}
          />
        )}
      </section>

      {selected && (
        <LiteratureDetail
          key={`${selected.id}:${selected.version}:${selected.annotationVersion}`}
          record={selected}
          busy={Boolean(busy)}
          onSave={async (input) => {
            await run(`update:${input.record.id}`, async () => {
              const updated = await adapter.updateAnnotations({
                projectId: project.id,
                recordId: input.record.id,
                expectedVersion: input.record.version,
                expectedAnnotationVersion: input.record.annotationVersion,
                manualTopics: input.manualTopics,
                manualSummary: input.manualSummary,
                manualRelevance: input.manualRelevance,
                reviewStatus: input.reviewStatus,
              });
              setRecords((current) =>
                current.map((record) => (record.id === updated.id ? updated : record)),
              );
              return 'Saved the manual literature review annotations.';
            });
          }}
          onDelete={async (record) => {
            if (
              !window.confirm(
                `Delete “${record.title}” from this project's Literature table? This does not delete the source paper or repository files.`,
              )
            ) {
              return;
            }
            await run(`delete:${record.id}`, async () => {
              await adapter.deleteRecord({
                projectId: project.id,
                recordId: record.id,
                expectedVersion: record.version,
              });
              setRecords((current) => current.filter(({ id }) => id !== record.id));
              setTotalRecords((current) => Math.max(0, current - 1));
              setSelectedId(null);
              return 'Deleted the paper from this project’s Literature table.';
            });
          }}
        />
      )}
    </div>
  );
}
