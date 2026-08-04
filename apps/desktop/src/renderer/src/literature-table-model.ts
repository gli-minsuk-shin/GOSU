import { LITERATURE_MAX_RECORDS_PER_PAGE } from '../../shared/literature-contracts';

export const LITERATURE_PAGE_SIZE = 25;
export const MAX_VISIBLE_LITERATURE_RECORDS = LITERATURE_MAX_RECORDS_PER_PAGE;

export type LiteratureSortKey =
  | 'title'
  | 'authors'
  | 'venue'
  | 'year'
  | 'topics'
  | 'doi'
  | 'type'
  | 'citedBy'
  | 'reviewStatus'
  | 'source';

export type LiteratureSortDirection = 'ascending' | 'descending';

export interface LiteratureTableRecord {
  id: string;
  title: string;
  authors: readonly string[];
  venue: string;
  year: number | null;
  topics: readonly string[];
  doi: string;
  type: string;
  citedBy: number | null;
  reviewStatus: string;
  source: string;
}

export interface LiteratureTableQuery {
  text: string;
  reviewStatus: string;
  sortKey: LiteratureSortKey;
  sortDirection: LiteratureSortDirection;
  page: number;
  pageSize?: number;
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

function sortValue(record: LiteratureTableRecord, key: LiteratureSortKey): string | number {
  switch (key) {
    case 'authors':
      return record.authors.join(' ');
    case 'venue':
      return record.venue;
    case 'year':
      return record.year ?? -1;
    case 'topics':
      return record.topics.join(' ');
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
    record.topics.join(' '),
    record.doi,
    record.type,
    record.source,
  ].some((value) => value.toLocaleLowerCase().includes(needle));
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
        (query.reviewStatus === 'all' || record.reviewStatus === query.reviewStatus),
    )
    .map((record, index) => ({ record, index }));

  filtered.sort((left, right) => {
    const leftValue = sortValue(left.record, query.sortKey);
    const rightValue = sortValue(right.record, query.sortKey);
    const compared =
      typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : compareText(String(leftValue), String(rightValue));
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

export function nextLiteratureSort(
  currentKey: LiteratureSortKey,
  currentDirection: LiteratureSortDirection,
  requestedKey: LiteratureSortKey,
): Pick<LiteratureTableQuery, 'sortKey' | 'sortDirection'> {
  if (currentKey !== requestedKey) {
    return {
      sortKey: requestedKey,
      sortDirection:
        requestedKey === 'year' || requestedKey === 'citedBy' ? 'descending' : 'ascending',
    };
  }
  return {
    sortKey: requestedKey,
    sortDirection: currentDirection === 'ascending' ? 'descending' : 'ascending',
  };
}
