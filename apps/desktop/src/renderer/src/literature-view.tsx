import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type {
  CancelLiteratureAiInput,
  DeleteLiteratureRecordInput,
  DeleteLiteratureRecordReceipt,
  LiteratureExportReceipt,
  LiteratureExportRequest,
  LiteratureDiscoveryCoverage,
  LiteratureImportReceipt,
  LiteratureImportRequest,
  LiteratureLibrary,
  LiteratureOrganizeReceipt,
  LiteratureAiCancelReceipt,
  LiteratureRecord,
  LiteratureSearchConflict,
  LiteratureSearchInput,
  LiteratureSearchReceipt,
  LiteratureSearchRun,
  LiteratureTransferFormat,
  LiteratureDiscoveryTier,
  ListLiteratureInput,
  OrganizeLiteratureInput,
  UpdateLiteratureAnnotationsInput,
} from '../../shared/literature-contracts';
import { LITERATURE_MAX_SEARCH_CONFLICT_PREVIEW } from '../../shared/literature-contracts';
import { canonicalLiteratureUrl } from '../../shared/literature-canonical-url';
import {
  EMPTY_LITERATURE_SEARCH_TAGS,
  LITERATURE_MAX_SEARCH_KEYWORD_TAGS,
  LITERATURE_MAX_SEARCH_TOPIC_TAGS,
  literatureSearchTagKey,
  parseLiteratureSearchTagText,
  type LiteratureSearchTagKind,
  type LiteratureSearchTags,
} from '../../shared/literature-search-tags';
import {
  BALANCED_LITERATURE_POLICY_ID,
  BALANCED_LITERATURE_POLICY_VERSION,
  LITERATURE_CANONICAL_MIN_AGE_YEARS,
  LITERATURE_CORE_MIN_CITATIONS,
  LITERATURE_CORE_MIN_INFLUENTIAL_CITATIONS,
  LITERATURE_CORE_MIN_RELEVANCE_SCORE,
  LITERATURE_RISING_MAX_AGE_YEARS,
  LITERATURE_RISING_MIN_CITATIONS_PER_YEAR,
  LITERATURE_RISING_MIN_INFLUENTIAL_CITATIONS,
  LITERATURE_RISING_MIN_RELEVANCE_SCORE,
} from '../../shared/literature-ranking-policy';
import type { ProjectRecord } from '../../shared/workspace-contracts';
import type {
  CreateResearchPaperNoteInput,
  ResearchPaperNoteReceipt,
} from '../../shared/research-notes-contracts';
import {
  buildLiteratureTablePage,
  buildLiteratureSearchTagOptions,
  literaturePageForRecord,
  nextLiteratureSort,
  type LiteratureSortDirection,
  type LiteratureSortKey,
  type LiteratureTableRecord,
} from './literature-table-model';
import type { SearchTargetRequest } from './search-results-model';

export interface LiteratureViewAdapter {
  list: (input: ListLiteratureInput) => Promise<LiteratureLibrary>;
  search: (input: LiteratureSearchInput) => Promise<LiteratureSearchReceipt>;
  updateAnnotations: (input: UpdateLiteratureAnnotationsInput) => Promise<LiteratureRecord>;
  deleteRecord: (input: DeleteLiteratureRecordInput) => Promise<DeleteLiteratureRecordReceipt>;
  importRecords: (input: LiteratureImportRequest) => Promise<LiteratureImportReceipt>;
  exportRecords: (input: LiteratureExportRequest) => Promise<LiteratureExportReceipt>;
  organize?: (input: OrganizeLiteratureInput) => Promise<LiteratureOrganizeReceipt>;
  cancelOrganize?: (input: CancelLiteratureAiInput) => Promise<LiteratureAiCancelReceipt>;
  createPaperNote?: (input: CreateResearchPaperNoteInput) => Promise<ResearchPaperNoteReceipt>;
}

export interface LiteratureViewRecord extends LiteratureTableRecord {
  record: LiteratureRecord;
}

export type LiteratureTableScrollCommand = 'left' | 'right' | 'top' | 'bottom';

export type LiteratureTableScrollAvailability = Readonly<{
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}>;

const NO_LITERATURE_TABLE_SCROLL: LiteratureTableScrollAvailability = {
  left: false,
  right: false,
  top: false,
  bottom: false,
};

export function literatureTableScrollAvailability(
  element: Pick<
    HTMLElement,
    'clientHeight' | 'clientWidth' | 'scrollHeight' | 'scrollLeft' | 'scrollTop' | 'scrollWidth'
  >,
): LiteratureTableScrollAvailability {
  const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
  return {
    left: element.scrollLeft > 1,
    right: element.scrollLeft < maxLeft - 1,
    top: element.scrollTop > 1,
    bottom: element.scrollTop < maxTop - 1,
  };
}

export function moveLiteratureTable(
  element: Pick<
    HTMLElement,
    | 'clientHeight'
    | 'clientWidth'
    | 'scrollHeight'
    | 'scrollLeft'
    | 'scrollTo'
    | 'scrollTop'
    | 'scrollWidth'
  >,
  command: LiteratureTableScrollCommand,
) {
  const horizontalStep = Math.max(240, Math.round(element.clientWidth * 0.8));
  const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const left =
    command === 'left'
      ? Math.max(0, element.scrollLeft - horizontalStep)
      : command === 'right'
        ? Math.min(maxLeft, element.scrollLeft + horizontalStep)
        : element.scrollLeft;
  const top = command === 'top' ? 0 : command === 'bottom' ? maxTop : element.scrollTop;
  element.scrollTo({ left, top, behavior: 'auto' });
}

export function resetLiteratureTableVerticalPosition(
  element: Pick<HTMLElement, 'scrollLeft' | 'scrollTo'>,
) {
  element.scrollTo({ left: element.scrollLeft, top: 0, behavior: 'auto' });
}

const COLUMN_LABELS: ReadonlyArray<{
  key: LiteratureSortKey;
  label: string;
}> = [
  { key: 'title', label: 'Title' },
  { key: 'importance', label: 'Last discovery layer' },
  { key: 'authors', label: 'Authors' },
  { key: 'venue', label: 'Journal / venue' },
  { key: 'year', label: 'Year' },
  { key: 'searchTags', label: 'Search tags' },
  { key: 'doi', label: 'DOI' },
  { key: 'citedBy', label: 'Cited by' },
  { key: 'type', label: 'Type' },
  { key: 'reviewStatus', label: 'Review status' },
  { key: 'source', label: 'Source' },
];

const REVIEW_STATUSES = ['unreviewed', 'screening', 'included', 'excluded', 'reviewed'] as const;
const DISCOVERY_LAYERS = [
  {
    id: 'core',
    title: 'Core & canonical',
    description: 'Eligibility-gated, high-impact query anchors and limited canonical classics.',
  },
  {
    id: 'rising',
    title: 'Rising & recent',
    description: 'Relevant recent work that also clears the estimated momentum gate.',
  },
  {
    id: 'broad',
    title: 'Broad discovery',
    description: 'Wider recall for screening beyond the obvious papers.',
  },
] as const satisfies ReadonlyArray<{
  id: LiteratureDiscoveryTier;
  title: string;
  description: string;
}>;

const DISCOVERY_LAYER_FILTERS = [
  {
    id: 'all',
    title: 'Total',
    description: 'All saved papers, including Core, Rising, Broad, and imported / unclassified.',
  },
  ...DISCOVERY_LAYERS,
] as const;

type LiteratureLayerFilter = (typeof DISCOVERY_LAYER_FILTERS)[number]['id'];
type LiteratureLayerCounts = Record<LiteratureLayerFilter | 'unclassified', number>;

function isCurrentBalancedLiteraturePolicy(discovery: NonNullable<LiteratureRecord['discovery']>) {
  return (
    discovery.policyId === BALANCED_LITERATURE_POLICY_ID &&
    discovery.policyVersion === BALANCED_LITERATURE_POLICY_VERSION
  );
}

export function literatureCorePolicyCounts(records: readonly LiteratureRecord[]) {
  return records.reduce(
    (counts, record) => {
      if (record.discovery?.tier !== 'core') return counts;
      return isCurrentBalancedLiteraturePolicy(record.discovery)
        ? { ...counts, current: counts.current + 1 }
        : { ...counts, historicalOrOther: counts.historicalOrOther + 1 };
    },
    { current: 0, historicalOrOther: 0 },
  );
}

export function literatureLayerCounts(
  records: readonly Pick<LiteratureTableRecord, 'discoveryTier'>[],
): LiteratureLayerCounts {
  return records.reduce<LiteratureLayerCounts>(
    (counts, record) => ({
      ...counts,
      [record.discoveryTier]: counts[record.discoveryTier] + 1,
    }),
    {
      all: records.length,
      core: 0,
      rising: 0,
      broad: 0,
      unclassified: 0,
    },
  );
}

function discoveryLayerTitle(tier: LiteratureDiscoveryTier | 'unclassified') {
  return DISCOVERY_LAYERS.find(({ id }) => id === tier)?.title ?? 'Imported / unclassified';
}

export function literatureCoreGateSummary(record: LiteratureRecord) {
  const discovery = record.discovery;
  if (!discovery) return 'Not classified by a discovery search';
  if (
    discovery.policyId === BALANCED_LITERATURE_POLICY_ID &&
    discovery.policyVersion < BALANCED_LITERATURE_POLICY_VERSION
  ) {
    return `Legacy policy v${discovery.policyVersion} — search again to apply v${BALANCED_LITERATURE_POLICY_VERSION}`;
  }
  if (!isCurrentBalancedLiteraturePolicy(discovery)) {
    return `Policy ${discovery.policyId} v${discovery.policyVersion} — current v${BALANCED_LITERATURE_POLICY_VERSION} Core gate is not interpreted`;
  }
  const relevance = Math.round(discovery.relevanceScore * 100);
  const citationEvidence =
    record.citationCount === null ? 'citations unavailable' : `${record.citationCount} citations`;
  const influentialEvidence =
    discovery.influentialCitationCount === null
      ? 'influential citations unavailable'
      : `${discovery.influentialCitationCount} influential`;
  const impactEvidence = `${citationEvidence} · ${influentialEvidence}`;
  if (discovery.tier === 'core') {
    return discovery.reasons.includes('established-classic')
      ? `Passed · canonical citation-lane anchor · ${impactEvidence}`
      : `Passed · relevance-lane rank ${relevance} ≥ ${Math.round(LITERATURE_CORE_MIN_RELEVANCE_SCORE * 100)} · ${impactEvidence}`;
  }
  if (discovery.reasons.includes('future-publication-year')) {
    return 'Not passed · publication year is later than this search’s reference year';
  }
  if (discovery.reasons.includes('incomplete-bibliographic-metadata')) {
    const missing = [
      record.publishedYear === null ? 'year' : null,
      record.authors.length === 0 ? 'author' : null,
      !record.doi && !record.providerRecordId ? 'DOI/provider ID' : null,
    ].filter((value): value is string => value !== null);
    return `Not passed · missing ${missing.join(', ') || 'required bibliographic metadata'}`;
  }
  if (discovery.reasons.includes('core-impact-threshold-not-met')) {
    return `Not passed · ${impactEvidence}; needs ≥${LITERATURE_CORE_MIN_CITATIONS} citations or ≥${LITERATURE_CORE_MIN_INFLUENTIAL_CITATIONS} influential`;
  }
  if (discovery.reasons.includes('core-relevance-threshold-not-met')) {
    return `Not passed · relevance-lane rank ${relevance} < ${Math.round(LITERATURE_CORE_MIN_RELEVANCE_SCORE * 100)} and no canonical route`;
  }
  return 'Eligible, but outside this search’s bounded Core maximum';
}

function literatureCoverageSummary(coverage: LiteratureDiscoveryCoverage | undefined) {
  if (!coverage) return '';
  const available = coverage.availableSignals.map(formatLabel).join(', ');
  if (coverage.degradationReasons.length === 0) {
    return ` Discovery signals: ${available}.`;
  }
  return ` Reduced signal coverage (${coverage.degradationReasons.map(formatLabel).join(', ')}); available: ${available}.`;
}

function literatureErrorCode(error: unknown) {
  return error instanceof Error ? (error.message.split(':')[0] ?? '') : '';
}

function literatureErrorMessage(error: unknown) {
  const code = literatureErrorCode(error);
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
      'The available paper identities point to different saved records. GOSU changed nothing so you can review the conflict safely.',
    literature_import_invalid:
      'That file could not be imported. Use a GOSU JSON or CSV export, or valid BibTeX.',
    literature_import_too_large:
      'That import is too large for one local operation. Split it into smaller review files.',
    literature_export_too_large:
      'This export is too large for one local operation. Filter or select fewer records.',
    literature_ai_busy: 'Another literature organization turn is already running for this project.',
    literature_ai_interrupted:
      'Stopped AI organization. No uncommitted literature annotations were applied.',
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

export function literatureSearchNotice(result: LiteratureSearchReceipt) {
  const tierCounts = result.tierCounts ?? result.run.tierCounts;
  const coverage = result.coverage ?? result.run.coverage;
  const retrieval =
    result.retrievedCount === undefined ? '' : `${result.retrievedCount} candidates screened; `;
  const layers = tierCounts
    ? ` Layers: ${tierCounts.core} core, ${tierCounts.rising} rising, ${tierCounts.broad} broad.`
    : '';
  const summary = `Deep search complete: ${retrieval}${result.foundCount} selected, ${result.newCount} added, ${result.updatedCount} updated, ${result.unchangedCount} unchanged.${layers}${literatureCoverageSummary(coverage)}`;
  if (result.conflictCount === 0) return summary;
  const conflictSummary = literatureConflictSummary(result.run.conflicts, result.conflictCount);
  const details = conflictSummary.length > 0 ? ` Skipped: ${conflictSummary}.` : '';
  return `${summary} ${result.conflictCount} ambiguous ${result.conflictCount === 1 ? 'result was' : 'results were'} skipped without changing saved papers.${details}`;
}

function literatureConflictSummary(
  conflicts: readonly LiteratureSearchConflict[],
  conflictCount: number,
) {
  const identifiers = conflicts
    .slice(0, LITERATURE_MAX_SEARCH_CONFLICT_PREVIEW)
    .map(literatureConflictIdentifier);
  if (identifiers.length === 0) return '';
  const omitted = Math.max(0, conflictCount - identifiers.length);
  return `${identifiers.join('; ')}${omitted > 0 ? `; +${omitted} more` : ''}`;
}

function literatureConflictIdentifier(conflict: LiteratureSearchConflict) {
  const identities = [
    conflict.canonicalId ? conflict.canonicalId : '',
    conflict.doi ? `DOI ${conflict.doi}` : '',
    conflict.providerRecordId && conflict.providerRecordId !== conflict.doi
      ? `${formatLabel(conflict.provider)} ${conflict.providerRecordId}`
      : '',
  ].filter(Boolean);
  return identities.length > 0
    ? identities.join(' / ')
    : `“${conflict.title.slice(0, 120)}${conflict.title.length > 120 ? '…' : ''}”`;
}

function formatLabel(value: string) {
  return value
    .replaceAll('-', ' ')
    .replaceAll('_', ' ')
    .replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase());
}

export function literatureViewRecord(record: LiteratureRecord): LiteratureViewRecord {
  return {
    id: record.id,
    title: record.title,
    canonicalUrl: canonicalLiteratureUrl(record),
    authors: record.authors,
    venue: record.containerTitle ?? '',
    year: record.publishedYear,
    searchTags: record.searchTags ?? EMPTY_LITERATURE_SEARCH_TAGS,
    sourceTopics: record.sourceTopics,
    manualTopics: record.manualAnnotations.topics,
    aiTopics: record.aiAnnotations?.topics ?? [],
    doi: record.doi ?? '',
    type: record.workType ?? '',
    citedBy: record.citationCount,
    discoveryTier: record.discovery?.tier ?? 'unclassified',
    importanceScore: record.discovery?.overallScore ?? null,
    discoveryRunId: record.discovery?.searchRunId ?? null,
    discoveryTierRank: record.discovery?.tierRank ?? null,
    discoveryClassifiedAt: record.discovery?.classifiedAt ?? null,
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

export function literatureSearchTagDraft(
  search: Pick<LiteratureSearchRun, 'searchTags'>,
): Readonly<{ topicText: string; keywordText: string }> {
  return {
    topicText: (search.searchTags?.topics ?? []).join(', '),
    keywordText: (search.searchTags?.keywords ?? []).join(', '),
  };
}

type VisibleLiteratureSearchTag = Readonly<{
  kind: LiteratureSearchTagKind;
  label: string;
  key: string;
}>;

function visibleLiteratureSearchTags(
  tags: LiteratureSearchTags,
  activeFilter: string,
  maximum = 3,
): readonly VisibleLiteratureSearchTag[] {
  const all = (['topics', 'keywords'] as const).flatMap((kind) =>
    tags[kind].map((label) => ({ kind, label, key: literatureSearchTagKey(kind, label) })),
  );
  const activeIndex = all.findIndex(({ key }) => key === activeFilter);
  if (activeIndex > 0) {
    const [active] = all.splice(activeIndex, 1);
    if (active) all.unshift(active);
  }
  return all.slice(0, maximum);
}

function searchTagKindLabel(kind: LiteratureSearchTagKind) {
  return kind === 'topics' ? 'Topic' : 'Keyword';
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
  tierFilter = 'all',
  searchTagFilter = 'all',
  sortKey,
  sortDirection,
  page,
  onSelect,
  onSort,
  onPage,
  onSearchTagFilter = () => undefined,
}: {
  records: readonly LiteratureViewRecord[];
  selectedId: string | null;
  textFilter: string;
  statusFilter: string;
  tierFilter?: string;
  searchTagFilter?: string;
  sortKey: LiteratureSortKey;
  sortDirection: LiteratureSortDirection;
  page: number;
  onSelect: (recordId: string) => void;
  onSort: (key: LiteratureSortKey) => void;
  onPage: (page: number) => void;
  onSearchTagFilter?: (filter: string) => void;
}) {
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const [scrollAvailability, setScrollAvailability] = useState(NO_LITERATURE_TABLE_SCROLL);
  const result = useMemo(
    () =>
      buildLiteratureTablePage(records, {
        text: textFilter,
        reviewStatus: statusFilter,
        discoveryTier: tierFilter,
        searchTag: searchTagFilter,
        sortKey,
        sortDirection,
        page,
      }),
    [page, records, searchTagFilter, sortDirection, sortKey, statusFilter, textFilter, tierFilter],
  );

  const updateScrollAvailability = useCallback(() => {
    const element = scrollRegionRef.current;
    const next = element ? literatureTableScrollAvailability(element) : NO_LITERATURE_TABLE_SCROLL;
    setScrollAvailability((current) =>
      current.left === next.left &&
      current.right === next.right &&
      current.top === next.top &&
      current.bottom === next.bottom
        ? current
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    const element = scrollRegionRef.current;
    if (!element) {
      setScrollAvailability(NO_LITERATURE_TABLE_SCROLL);
      return;
    }
    updateScrollAvailability();
    element.addEventListener('scroll', updateScrollAvailability, { passive: true });
    window.addEventListener('resize', updateScrollAvailability);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollAvailability);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      element.removeEventListener('scroll', updateScrollAvailability);
      window.removeEventListener('resize', updateScrollAvailability);
    };
  }, [result.page, result.rows.length, result.total, updateScrollAvailability]);

  useLayoutEffect(() => {
    const element = scrollRegionRef.current;
    if (!element) return;
    resetLiteratureTableVerticalPosition(element);
    updateScrollAvailability();
  }, [
    page,
    result.total,
    sortDirection,
    sortKey,
    statusFilter,
    textFilter,
    tierFilter,
    searchTagFilter,
    updateScrollAvailability,
  ]);

  const handleScrollCommand = (command: LiteratureTableScrollCommand) => {
    const element = scrollRegionRef.current;
    if (!element) return;
    moveLiteratureTable(element, command);
    updateScrollAvailability();
  };

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
      <p id="literature-table-scroll-help" className="sr-only">
        Scroll vertically for more papers and horizontally for additional evidence columns. When
        focused, the arrow and page keys scroll this table.
      </p>
      <div className="literature-table-navigation" aria-label="Evidence table scroll controls">
        <span>Scroll table</span>
        <div>
          <button
            type="button"
            className="ghost-button"
            aria-label="Scroll evidence columns left"
            aria-controls="literature-evidence-scroll-region"
            disabled={!scrollAvailability.left}
            onClick={() => handleScrollCommand('left')}
          >
            ← Columns
          </button>
          <button
            type="button"
            className="ghost-button"
            aria-label="Scroll evidence columns right"
            aria-controls="literature-evidence-scroll-region"
            disabled={!scrollAvailability.right}
            onClick={() => handleScrollCommand('right')}
          >
            Columns →
          </button>
          <button
            type="button"
            className="ghost-button"
            aria-label="Scroll evidence table to top"
            aria-controls="literature-evidence-scroll-region"
            disabled={!scrollAvailability.top}
            onClick={() => handleScrollCommand('top')}
          >
            Top
          </button>
          <button
            type="button"
            className="ghost-button"
            aria-label="Scroll evidence table to bottom"
            aria-controls="literature-evidence-scroll-region"
            disabled={!scrollAvailability.bottom}
            onClick={() => handleScrollCommand('bottom')}
          >
            Bottom
          </button>
        </div>
      </div>
      <div
        ref={scrollRegionRef}
        id="literature-evidence-scroll-region"
        className="literature-table-scroll"
        role="region"
        tabIndex={0}
        aria-label="Literature evidence table"
        aria-describedby="literature-table-scroll-help"
      >
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
              <tr
                id={`literature-record-${record.id}`}
                key={record.id}
                tabIndex={selectedId === record.id ? -1 : undefined}
                className={selectedId === record.id ? 'selected' : ''}
              >
                <td>
                  {record.canonicalUrl ? (
                    <a
                      className="literature-table-title canonical-link"
                      href={record.canonicalUrl}
                      aria-label={`Open canonical source for ${record.title}`}
                      onClick={(event) => {
                        event.preventDefault();
                        onSelect(record.id);
                        void window.gosu.openExternal(record.canonicalUrl!);
                      }}
                    >
                      <span>{record.title}</span>
                      <small>Canonical source ↗</small>
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="literature-table-title"
                      aria-pressed={selectedId === record.id}
                      onClick={() => onSelect(record.id)}
                    >
                      <span>{record.title}</span>
                    </button>
                  )}
                </td>
                <td>
                  <div className="literature-discovery-cell">
                    <span className={`literature-layer-chip ${record.discoveryTier}`}>
                      {discoveryLayerTitle(record.discoveryTier)}
                    </span>
                    {record.importanceScore !== null && (
                      <small>
                        {Math.round(record.importanceScore * 100)} / 100 · within search
                      </small>
                    )}
                    {record.record.discovery && (
                      <small>{literatureCoreGateSummary(record.record)}</small>
                    )}
                  </div>
                </td>
                <td>{record.authors.join(', ') || 'Unknown'}</td>
                <td>{record.venue || '—'}</td>
                <td>{record.year ?? '—'}</td>
                <td>
                  <div className="literature-topic-list literature-search-tag-list">
                    {visibleLiteratureSearchTags(record.searchTags, searchTagFilter).map((tag) => (
                      <button
                        type="button"
                        className={`literature-search-tag-chip ${tag.kind}`}
                        key={tag.key}
                        aria-label={`Filter by ${searchTagKindLabel(tag.kind).toLocaleLowerCase()} tag ${tag.label}`}
                        aria-pressed={searchTagFilter === tag.key}
                        onClick={() =>
                          onSearchTagFilter(searchTagFilter === tag.key ? 'all' : tag.key)
                        }
                      >
                        <span>{searchTagKindLabel(tag.kind)}</span>
                        {tag.label}
                      </button>
                    ))}
                    {record.searchTags.topics.length + record.searchTags.keywords.length === 0 &&
                      '—'}
                    {record.searchTags.topics.length + record.searchTags.keywords.length > 3 && (
                      <small>
                        +{record.searchTags.topics.length + record.searchTags.keywords.length - 3}
                      </small>
                    )}
                  </div>
                </td>
                <td>
                  {record.doi && record.canonicalUrl ? (
                    <a
                      className="literature-doi-link canonical-link"
                      href={record.canonicalUrl}
                      aria-label={`Open DOI ${record.doi}`}
                      onClick={(event) => {
                        event.preventDefault();
                        onSelect(record.id);
                        void window.gosu.openExternal(record.canonicalUrl!);
                      }}
                    >
                      {record.doi}
                    </a>
                  ) : (
                    record.doi || '—'
                  )}
                </td>
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

export function LiteratureDetail({
  record,
  busy,
  onSave,
  onDelete,
  onCreatePaperNote,
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
  onCreatePaperNote?: (record: LiteratureRecord) => Promise<void>;
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

  const canonicalUrl = canonicalLiteratureUrl(record);

  return (
    <section className="literature-detail-card" aria-labelledby="literature-detail-title">
      <header className="literature-detail-heading">
        <div>
          <span className="eyebrow">Selected paper</span>
          <h2 id="literature-detail-title">{record.title}</h2>
          <p>{record.authors.join(', ') || 'Unknown authors'}</p>
        </div>
        <div className="literature-detail-heading-actions">
          {onCreatePaperNote && (
            <LiteraturePaperNoteAction
              record={record}
              busy={busy}
              onCreatePaperNote={onCreatePaperNote}
            />
          )}
          {canonicalUrl && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void window.gosu.openExternal(canonicalUrl);
              }}
            >
              Open canonical source ↗
            </button>
          )}
        </div>
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

      <section className="literature-tag-sources" aria-label="Search provenance tags">
        <div>
          <strong>Search tags</strong>
          <small>Accumulated from the searches that found this paper</small>
        </div>
        {(record.searchTags?.topics.length ?? 0) + (record.searchTags?.keywords.length ?? 0) > 0 ? (
          <div className="literature-topic-list literature-search-tag-list">
            {(record.searchTags?.topics ?? []).map((label) => (
              <span className="literature-search-tag-chip topics" key={`topic:${label}`}>
                <span>Topic</span>
                {label}
              </span>
            ))}
            {(record.searchTags?.keywords ?? []).map((label) => (
              <span className="literature-search-tag-chip keywords" key={`keyword:${label}`}>
                <span>Keyword</span>
                {label}
              </span>
            ))}
          </div>
        ) : (
          <p>No search tags yet. Imported papers remain available under the Untagged filter.</p>
        )}
      </section>

      <section className="literature-tag-sources" aria-label="Source keywords">
        <div>
          <strong>Source keywords</strong>
          <small>Provider metadata; never used as a GOSU search tag</small>
        </div>
        {record.sourceTopics.length > 0 ? (
          <div className="literature-topic-list">
            {record.sourceTopics.map((topic) => (
              <span className="literature-topic-chip" key={topic}>
                {topic}
              </span>
            ))}
          </div>
        ) : (
          <p>No source keywords provided.</p>
        )}
      </section>

      {record.discovery && (
        <section className="literature-discovery-summary" aria-label="Discovery ranking">
          <div>
            <span className={`literature-layer-chip ${record.discovery.tier}`}>
              {discoveryLayerTitle(record.discovery.tier)}
            </span>
            <strong>{Math.round(record.discovery.overallScore * 100)} / 100 · within search</strong>
          </div>
          <p>
            {record.discovery.reasons.map(formatLabel).join(' · ')}. This score is only comparable
            with papers from the same search; it is a discovery ranking, not verified evidence
            quality.
          </p>
          <dl className="literature-ai-facts">
            <div>
              <dt>Relevance-lane rank (within search)</dt>
              <dd>{Math.round(record.discovery.relevanceScore * 100)}</dd>
            </div>
            <div>
              <dt>Citation authority</dt>
              <dd>{Math.round(record.discovery.authorityScore * 100)}</dd>
            </div>
            <div>
              <dt>Estimated momentum</dt>
              <dd>{Math.round(record.discovery.momentumScore * 100)}</dd>
            </div>
            <div>
              <dt>Influential citations</dt>
              <dd>{record.discovery.influentialCitationCount ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Core gate</dt>
              <dd>{literatureCoreGateSummary(record)}</dd>
            </div>
            <div>
              <dt>Highest author h-index signal</dt>
              <dd>{record.discovery.maxAuthorHIndex ?? 'Unavailable'}</dd>
            </div>
          </dl>
          <small>
            Latest matching search “{record.discovery.query}” · classified{' '}
            {new Date(record.discovery.classifiedAt).toLocaleString()} · policy{' '}
            {record.discovery.policyId} v{record.discovery.policyVersion} · metadata from{' '}
            {record.discovery.signalSources.map(formatLabel).join(' + ')} · author prominence is
            only a capped supporting signal.
          </small>
        </section>
      )}

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
            {record.aiAnnotations.topics.length > 0 && (
              <div className="literature-ai-topic-suggestions">
                <strong>AI topic suggestions</strong>
                <div className="literature-topic-list">
                  {record.aiAnnotations.topics.map((topic) => (
                    <span className="literature-topic-chip" key={topic}>
                      {topic}
                    </span>
                  ))}
                </div>
              </div>
            )}
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
          Manual review topics
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

export function LiteraturePaperNoteAction({
  record,
  busy,
  onCreatePaperNote,
}: {
  record: LiteratureRecord;
  busy: boolean;
  onCreatePaperNote: (record: LiteratureRecord) => Promise<void>;
}) {
  return (
    <button
      type="button"
      className="secondary-button"
      disabled={busy}
      title="Create a metadata-only Markdown review template in this project's Obsidian Papers folder"
      onClick={() => void onCreatePaperNote(record)}
    >
      Create Obsidian paper note
    </button>
  );
}

export function LiteratureView({
  project,
  adapter,
  aiAvailable = true,
  requestedModelId = null,
  reasoningOptionId = null,
  searchTarget = null,
  onSearchTargetHandled = () => undefined,
}: {
  project: ProjectRecord;
  adapter: LiteratureViewAdapter;
  aiAvailable?: boolean;
  requestedModelId?: string | null;
  reasoningOptionId?: string | null;
  searchTarget?: SearchTargetRequest | null;
  onSearchTargetHandled?: (requestId: number) => void;
}) {
  const [records, setRecords] = useState<readonly LiteratureRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [recentSearches, setRecentSearches] = useState<readonly LiteratureSearchRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [topicTagText, setTopicTagText] = useState('');
  const [keywordTagText, setKeywordTagText] = useState('');
  const [fromYear, setFromYear] = useState('');
  const [toYear, setToYear] = useState('');
  const [textFilter, setTextFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');
  const [searchTagFilter, setSearchTagFilter] = useState('all');
  const [sortKey, setSortKey] = useState<LiteratureSortKey>('importance');
  const [sortDirection, setSortDirection] = useState<LiteratureSortDirection>('descending');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingSearchFocus, setPendingSearchFocus] = useState<SearchTargetRequest | null>(null);
  const selected = records.find((record) => record.id === selectedId) ?? null;
  const latestSearchCoverage = recentSearches[0]?.coverage;
  const tableRecords = useMemo(() => records.map(literatureViewRecord), [records]);
  const searchTagOptions = useMemo(
    () => buildLiteratureSearchTagOptions(tableRecords),
    [tableRecords],
  );
  const topicTagOptions = searchTagOptions.filter(({ kind }) => kind === 'topics');
  const keywordTagOptions = searchTagOptions.filter(({ kind }) => kind === 'keywords');
  const untaggedCount = tableRecords.filter(
    ({ searchTags }) => searchTags.topics.length === 0 && searchTags.keywords.length === 0,
  ).length;
  const layerCounts = useMemo(() => literatureLayerCounts(tableRecords), [tableRecords]);
  const corePolicyCounts = useMemo(() => literatureCorePolicyCounts(records), [records]);
  const aiCandidates = useMemo(
    () => records.filter((record) => record.aiAnnotations === null).slice(0, 50),
    [records],
  );
  const activeSearchOptionCount = [topicTagText, keywordTagText, fromYear, toYear].filter(
    (value) => value.trim().length > 0,
  ).length;

  useEffect(() => {
    if (!searchTarget || loading) return;
    if (!records.some(({ id }) => id === searchTarget.targetId)) {
      setError(
        'The searched literature record is no longer available. Refresh Search and try again.',
      );
      onSearchTargetHandled(searchTarget.requestId);
      return;
    }
    const targetPage = literaturePageForRecord(tableRecords, searchTarget.targetId, {
      text: '',
      reviewStatus: 'all',
      discoveryTier: 'all',
      searchTag: 'all',
      sortKey,
      sortDirection,
    });
    if (targetPage === null) {
      setError('The searched paper is outside the current bounded evidence table view.');
      onSearchTargetHandled(searchTarget.requestId);
      return;
    }
    setTextFilter('');
    setStatusFilter('all');
    setTierFilter('all');
    setSearchTagFilter('all');
    setPage(targetPage);
    setSelectedId(searchTarget.targetId);
    setPendingSearchFocus(searchTarget);
  }, [loading, onSearchTargetHandled, records, searchTarget, sortDirection, sortKey, tableRecords]);

  useLayoutEffect(() => {
    if (!pendingSearchFocus) return;
    const element = document.getElementById(`literature-record-${pendingSearchFocus.targetId}`);
    if (!element) return;
    element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    element.focus({ preventScroll: true });
    onSearchTargetHandled(pendingSearchFocus.requestId);
    setPendingSearchFocus(null);
  }, [onSearchTargetHandled, page, pendingSearchFocus, selectedId]);

  useEffect(() => {
    const valid =
      searchTagFilter === 'all' ||
      (searchTagFilter === 'untagged' && untaggedCount > 0) ||
      searchTagOptions.some(({ key }) => key === searchTagFilter);
    if (valid) return;
    setSearchTagFilter('all');
    setPage(1);
  }, [searchTagFilter, searchTagOptions, untaggedCount]);

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
      if (literatureErrorCode(reason) === 'literature_ai_interrupted') {
        setNotice('Stopped AI organization. No uncommitted literature annotations were applied.');
        setError('');
      } else {
        setError(literatureErrorMessage(reason));
      }
    } finally {
      setBusy('');
    }
  };

  const cancelAiOrganization = async () => {
    if (busy !== 'organize' || !adapter.cancelOrganize) return;
    setNotice('Stopping AI organization…');
    setError('');
    try {
      const receipt = await adapter.cancelOrganize({ projectId: project.id });
      setNotice(
        receipt.cancelRequested
          ? 'Stopped AI organization. No uncommitted literature annotations were applied.'
          : 'AI organization had already finished.',
      );
    } catch (reason) {
      setError(literatureErrorMessage(reason));
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
          <strong id="literature-search-title">Search literature</strong>
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
                searchTags: {
                  topics: parseLiteratureSearchTagText(topicTagText).slice(
                    0,
                    LITERATURE_MAX_SEARCH_TOPIC_TAGS,
                  ),
                  keywords: parseLiteratureSearchTagText(keywordTagText).slice(
                    0,
                    LITERATURE_MAX_SEARCH_KEYWORD_TAGS,
                  ),
                },
                ...(start ? { fromYear: start } : {}),
                ...(end ? { toYear: end } : {}),
              });
              await refresh();
              setPage(1);
              return literatureSearchNotice(result);
            });
          }}
        >
          <label className="literature-search-query">
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
          <button
            type="submit"
            className="primary-button"
            disabled={Boolean(busy) || query.trim().length < 2}
          >
            {busy === 'search' ? 'Searching…' : records.length > 0 ? 'Search again' : 'Deep search'}
          </button>
          <details className="literature-search-options">
            <summary>
              Tags &amp; year filters
              {activeSearchOptionCount > 0 && ` · ${activeSearchOptionCount} active`}
            </summary>
            <div>
              <label className="literature-search-tag-field">
                Topic tags
                <input
                  value={topicTagText}
                  maxLength={1500}
                  placeholder="e.g. tabular foundation models, evaluation"
                  disabled={Boolean(busy)}
                  onChange={(event) => setTopicTagText(event.target.value)}
                />
              </label>
              <label className="literature-search-tag-field">
                Keyword tags
                <input
                  value={keywordTagText}
                  maxLength={3000}
                  placeholder="e.g. TabPFN, few-shot, benchmark"
                  disabled={Boolean(busy)}
                  onChange={(event) => setKeywordTagText(event.target.value)}
                />
              </label>
              <label className="literature-search-year">
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
              <label className="literature-search-year">
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
            </div>
          </details>
        </form>
        <div className="literature-search-secondary">
          <details className="literature-search-guidance">
            <summary>
              Search guidance · ranking policy v{BALANCED_LITERATURE_POLICY_VERSION}
            </summary>
            <div>
              <p className="literature-search-tag-help">
                Topic and Keyword tags accumulate on matching papers across searches. Separate tags
                with commas; leaving both fields blank uses the normalized search query as a Topic
                tag.
              </p>
              <p className="literature-search-help">
                <strong>Fixed policy v{BALANCED_LITERATURE_POLICY_VERSION}:</strong> Core is a
                maximum, never a quota. Search combines Semantic Scholar, Hugging Face Papers, and a
                resilient Crossref fallback; Hugging Face index presence never promotes a paper by
                itself. High-impact relevant papers must appear in the relevance lane with a
                within-search normalized rank score of at least{' '}
                {Math.round(LITERATURE_CORE_MIN_RELEVANCE_SCORE * 100)} and at least{' '}
                {LITERATURE_CORE_MIN_CITATIONS} citations or{' '}
                {LITERATURE_CORE_MIN_INFLUENTIAL_CITATIONS} influential citations. A limited
                canonical route uses the same impact floor, a citation lane, and age of at least{' '}
                {LITERATURE_CANONICAL_MIN_AGE_YEARS} years. Rising needs relevance of at least{' '}
                {Math.round(LITERATURE_RISING_MIN_RELEVANCE_SCORE * 100)}, publication within the
                latest {LITERATURE_RISING_MAX_AGE_YEARS + 1} calendar years, and at least{' '}
                {LITERATURE_RISING_MIN_CITATIONS_PER_YEAR} citations/year or{' '}
                {LITERATURE_RISING_MIN_INFLUENTIAL_CITATIONS} influential citation. Others remain
                Broad for screening. Venue metadata and author h-index never promote a paper by
                themselves. Existing v1 labels remain historical until that search is run again.
                Each search is additive; scores are only comparable within the same search.
              </p>
            </div>
          </details>
          {recentSearches.length > 0 && (
            <details className="literature-recent-searches">
              <summary>Recent searches</summary>
              <div aria-label="Recent literature searches">
                {recentSearches.slice(0, 6).map((search) => (
                  <button
                    type="button"
                    key={search.id}
                    disabled={Boolean(busy)}
                    title={`Reuse “${search.query}”${search.fromYear ? ` from ${search.fromYear}` : ''}${search.toYear ? ` through ${search.toYear}` : ''}${search.conflicts.length > 0 ? `; skipped ${literatureConflictSummary(search.conflicts, search.conflictCount)}` : ''}${literatureCoverageSummary(search.coverage)}`}
                    onClick={() => {
                      const tagDraft = literatureSearchTagDraft(search);
                      setQuery(search.query);
                      setTopicTagText(tagDraft.topicText);
                      setKeywordTagText(tagDraft.keywordText);
                      setFromYear(search.fromYear?.toString() ?? '');
                      setToYear(search.toYear?.toString() ?? '');
                    }}
                  >
                    {search.query}
                    {search.conflictCount > 0 ? ` · ${search.conflictCount} skipped` : ''}
                  </button>
                ))}
              </div>
            </details>
          )}
          {latestSearchCoverage && latestSearchCoverage.degradationReasons.length > 0 && (
            <details className="literature-coverage-warning" role="status">
              <summary>
                <strong>Reduced search coverage:</strong>{' '}
                {latestSearchCoverage.degradationReasons.map(formatLabel).join(', ')}
              </summary>
              <p>
                Available: {latestSearchCoverage.availableSignals.map(formatLabel).join(', ')}.
                Saved papers and manual review remain available.
              </p>
            </details>
          )}
        </div>
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
            {busy === 'organize' && adapter.cancelOrganize && (
              <button
                type="button"
                className="danger-button"
                onClick={() => void cancelAiOrganization()}
              >
                Stop AI
              </button>
            )}
          </div>
        </header>
        {(!adapter.organize || !aiAvailable) && (
          <p className="literature-ai-availability">
            <strong>AI organization:</strong>{' '}
            {adapter.organize ? 'Connect Codex to enable drafts.' : 'Unavailable in this build.'}
          </p>
        )}
        {adapter.organize && aiAvailable && (
          <p
            className="literature-ai-availability"
            title="AI drafts use metadata only and remain separate from human review notes."
          >
            <strong>AI organization:</strong> {requestedModelId ?? 'Auto · provider recommended'} ·{' '}
            {reasoningOptionId ?? 'model default'}
          </p>
        )}
        <div className="literature-layer-grid" role="group" aria-label="Discovery layer view">
          {DISCOVERY_LAYER_FILTERS.map((layer) => (
            <button
              type="button"
              key={layer.id}
              className={`literature-layer-card ${layer.id}${tierFilter === layer.id ? ' active' : ''}`}
              aria-pressed={tierFilter === layer.id}
              aria-controls="literature-evidence-table-panel"
              aria-label={`${layer.title}, ${layerCounts[layer.id]} saved papers${layer.id === 'core' && corePolicyCounts.historicalOrOther > 0 ? `, ${corePolicyCounts.current} current v${BALANCED_LITERATURE_POLICY_VERSION} and ${corePolicyCounts.historicalOrOther} historical or other policy` : ''}`}
              title={layer.description}
              onClick={() => {
                setTierFilter(layer.id);
                setPage(1);
              }}
            >
              <span>{layer.title}</span>
              <strong>{layerCounts[layer.id]}</strong>
            </button>
          ))}
        </div>
        <div className="literature-filter-bar">
          <label>
            <span>Filter evidence table</span>
            <input
              type="search"
              value={textFilter}
              placeholder="Filter title, author, tags, venue, or DOI"
              onChange={(event) => {
                setTextFilter(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            <span>Search tag</span>
            <select
              aria-label="Search tag filter"
              value={searchTagFilter}
              onChange={(event) => {
                setSearchTagFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All search tags</option>
              {topicTagOptions.length > 0 && (
                <optgroup label="Topics">
                  {topicTagOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label} ({option.count})
                    </option>
                  ))}
                </optgroup>
              )}
              {keywordTagOptions.length > 0 && (
                <optgroup label="Keywords">
                  {keywordTagOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label} ({option.count})
                    </option>
                  ))}
                </optgroup>
              )}
              {untaggedCount > 0 && <option value="untagged">Untagged ({untaggedCount})</option>}
            </select>
          </label>
          <label>
            <span>Discovery layer</span>
            <select
              aria-label="Discovery layer filter"
              value={tierFilter}
              onChange={(event) => {
                setTierFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All discovery layers</option>
              {DISCOVERY_LAYERS.map((layer) => (
                <option key={layer.id} value={layer.id}>
                  {layer.title} ({layerCounts[layer.id]})
                </option>
              ))}
              {layerCounts.unclassified > 0 && (
                <option value="unclassified">
                  Imported / unclassified ({layerCounts.unclassified})
                </option>
              )}
            </select>
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

        <div id="literature-evidence-table-panel" className="literature-evidence-table-panel">
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
              tierFilter={tierFilter}
              searchTagFilter={searchTagFilter}
              sortKey={sortKey}
              sortDirection={sortDirection}
              page={page}
              onSelect={setSelectedId}
              onSort={handleSort}
              onPage={setPage}
              onSearchTagFilter={(filter) => {
                setSearchTagFilter(filter);
                setPage(1);
              }}
            />
          )}
        </div>
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
          {...(adapter.createPaperNote
            ? {
                onCreatePaperNote: async (record: LiteratureRecord) => {
                  await run(`paper-note:${record.id}`, async () => {
                    const receipt = await adapter.createPaperNote!({
                      projectId: project.id,
                      recordId: record.id,
                    });
                    return receipt.created
                      ? `Created ${receipt.path} in this project’s Research Notes.`
                      : `${receipt.path} already exists. GOSU left your note unchanged.`;
                  });
                },
              }
            : {})}
        />
      )}
    </div>
  );
}
