import { LITERATURE_MAX_RECORDS_PER_PAGE } from '../../shared/literature-contracts';
import {
  literatureSearchTagKey,
  type LiteratureSearchTagKind,
  type LiteratureSearchTags,
} from '../../shared/literature-search-tags';

export const LITERATURE_PAGE_SIZE = 25;
export const MAX_VISIBLE_LITERATURE_RECORDS = LITERATURE_MAX_RECORDS_PER_PAGE;

export type LiteratureSortKey =
  | 'title'
  | 'authors'
  | 'venue'
  | 'year'
  | 'searchTags'
  | 'aiKeywords'
  | 'doi'
  | 'type'
  | 'citedBy'
  | 'importance'
  | 'reviewStatus'
  | 'source';

export type LiteratureSortDirection = 'ascending' | 'descending';

export const LITERATURE_COLUMN_WIDTH_STORAGE_KEY = 'gosu.literature.column-widths.v1';
export const LITERATURE_COLUMN_RESIZE_STEP = 16;

export interface LiteratureColumnWidthDefinition {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

export const LITERATURE_COLUMN_WIDTH_DEFINITIONS: Readonly<
  Record<LiteratureSortKey, LiteratureColumnWidthDefinition>
> = {
  title: { defaultWidth: 190, minWidth: 160, maxWidth: 720 },
  importance: { defaultWidth: 180, minWidth: 150, maxWidth: 620 },
  authors: { defaultWidth: 150, minWidth: 120, maxWidth: 620 },
  venue: { defaultWidth: 125, minWidth: 100, maxWidth: 520 },
  year: { defaultWidth: 70, minWidth: 64, maxWidth: 180 },
  searchTags: { defaultWidth: 150, minWidth: 120, maxWidth: 620 },
  aiKeywords: { defaultWidth: 160, minWidth: 120, maxWidth: 620 },
  doi: { defaultWidth: 135, minWidth: 110, maxWidth: 520 },
  citedBy: { defaultWidth: 75, minWidth: 68, maxWidth: 220 },
  type: { defaultWidth: 90, minWidth: 76, maxWidth: 320 },
  reviewStatus: { defaultWidth: 105, minWidth: 96, maxWidth: 320 },
  source: { defaultWidth: 90, minWidth: 76, maxWidth: 320 },
};

export type LiteratureColumnWidths = Readonly<Record<LiteratureSortKey, number>>;

const LITERATURE_COLUMN_KEYS = Object.freeze(
  Object.keys(LITERATURE_COLUMN_WIDTH_DEFINITIONS) as LiteratureSortKey[],
);

export const DEFAULT_LITERATURE_COLUMN_WIDTHS: LiteratureColumnWidths = Object.freeze(
  Object.fromEntries(
    LITERATURE_COLUMN_KEYS.map((key) => [
      key,
      LITERATURE_COLUMN_WIDTH_DEFINITIONS[key].defaultWidth,
    ]),
  ) as Record<LiteratureSortKey, number>,
);

export function clampLiteratureColumnWidth(key: LiteratureSortKey, width: number) {
  const definition = LITERATURE_COLUMN_WIDTH_DEFINITIONS[key];
  if (!Number.isFinite(width)) return definition.defaultWidth;
  return Math.max(definition.minWidth, Math.min(definition.maxWidth, Math.round(width)));
}

export function normalizeLiteratureColumnWidths(value: unknown): LiteratureColumnWidths {
  const candidate =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return Object.freeze(
    Object.fromEntries(
      LITERATURE_COLUMN_KEYS.map((key) => {
        const width = candidate[key];
        return [
          key,
          typeof width === 'number'
            ? clampLiteratureColumnWidth(key, width)
            : LITERATURE_COLUMN_WIDTH_DEFINITIONS[key].defaultWidth,
        ];
      }),
    ) as Record<LiteratureSortKey, number>,
  );
}

export function parseLiteratureColumnWidths(serialized: string | null): LiteratureColumnWidths {
  if (!serialized) return DEFAULT_LITERATURE_COLUMN_WIDTHS;
  try {
    return normalizeLiteratureColumnWidths(JSON.parse(serialized));
  } catch {
    return DEFAULT_LITERATURE_COLUMN_WIDTHS;
  }
}

export function resizeLiteratureColumn(
  widths: LiteratureColumnWidths,
  key: LiteratureSortKey,
  nextWidth: number,
): LiteratureColumnWidths {
  const width = clampLiteratureColumnWidth(key, nextWidth);
  if (widths[key] === width) return widths;
  return Object.freeze({ ...widths, [key]: width });
}

export function literatureTableWidth(widths: LiteratureColumnWidths) {
  return LITERATURE_COLUMN_KEYS.reduce((total, key) => total + widths[key], 0);
}

export function hasCustomLiteratureColumnWidths(widths: LiteratureColumnWidths) {
  return LITERATURE_COLUMN_KEYS.some(
    (key) => widths[key] !== LITERATURE_COLUMN_WIDTH_DEFINITIONS[key].defaultWidth,
  );
}

export interface LiteratureTableRecord {
  id: string;
  title: string;
  canonicalUrl: string | null;
  authors: readonly string[];
  venue: string;
  year: number | null;
  searchTags: LiteratureSearchTags;
  sourceTopics: readonly string[];
  manualTopics: readonly string[];
  aiTopics: readonly string[];
  aiKeywords?: readonly string[];
  doi: string;
  type: string;
  citedBy: number | null;
  discoveryTier: 'core' | 'rising' | 'broad' | 'unclassified';
  importanceScore: number | null;
  discoveryRunId: string | null;
  discoveryTierRank: number | null;
  discoveryClassifiedAt: string | null;
  reviewStatus: string;
  source: string;
}

export interface LiteratureTableQuery {
  text: string;
  reviewStatus: string;
  discoveryTier?: string;
  searchTag?: string;
  sortKey: LiteratureSortKey;
  sortDirection: LiteratureSortDirection;
  page: number;
  pageSize?: number;
}

export interface LiteratureSearchTagOption {
  key: string;
  kind: LiteratureSearchTagKind;
  label: string;
  count: number;
}

export interface LiteratureTablePage<RecordType extends LiteratureTableRecord> {
  rows: readonly RecordType[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

const compareText = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });

const DISCOVERY_TIER_PRIORITY: Readonly<Record<LiteratureTableRecord['discoveryTier'], number>> = {
  unclassified: 0,
  broad: 1,
  rising: 2,
  core: 3,
};

function discoveryTimestamp(record: LiteratureTableRecord) {
  if (!record.discoveryClassifiedAt) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(record.discoveryClassifiedAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function compareDiscoveryImportance(left: LiteratureTableRecord, right: LiteratureTableRecord) {
  const leftTimestamp = discoveryTimestamp(left);
  const rightTimestamp = discoveryTimestamp(right);
  const classifiedAt =
    leftTimestamp === rightTimestamp ? 0 : leftTimestamp < rightTimestamp ? -1 : 1;
  if (classifiedAt !== 0) return classifiedAt;

  const sameSearch = left.discoveryRunId !== null && left.discoveryRunId === right.discoveryRunId;
  if (!sameSearch) return 0;

  const tier =
    DISCOVERY_TIER_PRIORITY[left.discoveryTier] - DISCOVERY_TIER_PRIORITY[right.discoveryTier];
  if (tier !== 0) return tier;

  const leftRank = left.discoveryTierRank;
  const rightRank = right.discoveryTierRank;
  if (leftRank === rightRank) return 0;
  if (leftRank === null) return -1;
  if (rightRank === null) return 1;
  return rightRank - leftRank;
}

function sortValue(
  record: LiteratureTableRecord,
  key: Exclude<LiteratureSortKey, 'importance'>,
): string | number {
  switch (key) {
    case 'authors':
      return record.authors.join(' ');
    case 'venue':
      return record.venue;
    case 'year':
      return record.year ?? -1;
    case 'searchTags':
      return [...record.searchTags.topics, ...record.searchTags.keywords].join(' ');
    case 'aiKeywords':
      return (record.aiKeywords ?? []).join(' ');
    case 'doi':
      return record.doi;
    case 'citedBy':
      return record.citedBy ?? -1;
    case 'reviewStatus':
      return record.reviewStatus;
    case 'source':
      return record.source;
    case 'type':
      return record.type;
    case 'title':
      return record.title;
  }
}

function matchesText(record: LiteratureTableRecord, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [
    record.title,
    record.authors.join(' '),
    record.venue,
    record.searchTags.topics.join(' '),
    record.searchTags.keywords.join(' '),
    record.sourceTopics.join(' '),
    record.manualTopics.join(' '),
    record.aiTopics.join(' '),
    (record.aiKeywords ?? []).join(' '),
    record.doi,
    record.type,
    record.source,
  ].some((value) => value.toLocaleLowerCase().includes(needle));
}

export function literatureRecordMatchesSearchTag(
  record: LiteratureTableRecord,
  filter: string | undefined,
) {
  if (!filter || filter === 'all') return true;
  if (filter === 'untagged') {
    return record.searchTags.topics.length === 0 && record.searchTags.keywords.length === 0;
  }
  return (['topics', 'keywords'] as const).some((kind) =>
    record.searchTags[kind].some((label) => literatureSearchTagKey(kind, label) === filter),
  );
}

export function buildLiteratureSearchTagOptions(
  records: readonly LiteratureTableRecord[],
): readonly LiteratureSearchTagOption[] {
  const options = new Map<string, LiteratureSearchTagOption>();
  for (const record of records) {
    const countedForRecord = new Set<string>();
    for (const kind of ['topics', 'keywords'] as const) {
      for (const label of record.searchTags[kind]) {
        const key = literatureSearchTagKey(kind, label);
        if (countedForRecord.has(key)) continue;
        countedForRecord.add(key);
        const current = options.get(key);
        options.set(key, {
          key,
          kind,
          label: current?.label ?? label,
          count: (current?.count ?? 0) + 1,
        });
      }
    }
  }
  return [...options.values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'topics' ? -1 : 1;
    return compareText(left.label, right.label);
  });
}

export function buildLiteratureTablePage<RecordType extends LiteratureTableRecord>(
  records: readonly RecordType[],
  query: LiteratureTableQuery,
): LiteratureTablePage<RecordType> {
  const pageSize = Math.max(1, Math.min(query.pageSize ?? LITERATURE_PAGE_SIZE, 100));
  const filtered = records
    .slice(0, MAX_VISIBLE_LITERATURE_RECORDS)
    .filter(
      (record) =>
        matchesText(record, query.text) &&
        ((query.discoveryTier ?? 'all') === 'all' ||
          record.discoveryTier === query.discoveryTier) &&
        literatureRecordMatchesSearchTag(record, query.searchTag) &&
        (query.reviewStatus === 'all' || record.reviewStatus === query.reviewStatus),
    )
    .map((record, index) => ({ record, index }));

  filtered.sort((left, right) => {
    const compared = (() => {
      if (query.sortKey === 'importance') {
        return compareDiscoveryImportance(left.record, right.record);
      }
      const leftValue = sortValue(left.record, query.sortKey);
      const rightValue = sortValue(right.record, query.sortKey);
      return typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : compareText(String(leftValue), String(rightValue));
    })();
    const directed = query.sortDirection === 'ascending' ? compared : -compared;
    return directed === 0 ? left.index - right.index : directed;
  });

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page), pageCount);
  const start = (page - 1) * pageSize;

  return {
    rows: filtered.slice(start, start + pageSize).map(({ record }) => record),
    total,
    page,
    pageCount,
    pageSize,
  };
}

export function literaturePageForRecord<RecordType extends LiteratureTableRecord>(
  records: readonly RecordType[],
  recordId: string,
  query: Omit<LiteratureTableQuery, 'page'>,
) {
  const first = buildLiteratureTablePage(records, { ...query, page: 1 });
  if (first.rows.some(({ id }) => id === recordId)) return 1;
  for (let page = 2; page <= first.pageCount; page += 1) {
    if (
      buildLiteratureTablePage(records, { ...query, page }).rows.some(({ id }) => id === recordId)
    ) {
      return page;
    }
  }
  return null;
}

export function nextLiteratureSort(
  currentKey: LiteratureSortKey,
  currentDirection: LiteratureSortDirection,
  requestedKey: LiteratureSortKey,
): Pick<LiteratureTableQuery, 'sortKey' | 'sortDirection'> {
  if (currentKey !== requestedKey) {
    return {
      sortKey: requestedKey,
      sortDirection:
        requestedKey === 'year' || requestedKey === 'citedBy' || requestedKey === 'importance'
          ? 'descending'
          : 'ascending',
    };
  }
  return {
    sortKey: requestedKey,
    sortDirection: currentDirection === 'ascending' ? 'descending' : 'ascending',
  };
}
