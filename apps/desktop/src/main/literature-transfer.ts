import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  LITERATURE_MAX_RECORDS_PER_PAGE,
  LITERATURE_MAX_TRANSFER_BYTES,
  type LiteratureRecord,
  type LiteratureReviewStatus,
} from '../shared/literature-contracts';
import { LiteratureSearchTagsSchema } from '../shared/literature-search-tags';

export const LITERATURE_TRANSFER_SCHEMA_VERSION = 2;
export const LITERATURE_TRANSFER_MAX_RECORDS = LITERATURE_MAX_RECORDS_PER_PAGE;
export const LITERATURE_TRANSFER_MAX_INPUT_BYTES = LITERATURE_MAX_TRANSFER_BYTES;
export const LITERATURE_TRANSFER_MAX_OUTPUT_BYTES = LITERATURE_MAX_TRANSFER_BYTES;

export type LiteratureTransferErrorCode =
  'literature_import_invalid' | 'literature_import_too_large' | 'literature_export_too_large';

export class LiteratureTransferError extends Error {
  constructor(readonly code: LiteratureTransferErrorCode) {
    super(code);
    this.name = 'LiteratureTransferError';
  }
}

const reviewStatuses = [
  'unreviewed',
  'screening',
  'included',
  'excluded',
  'reviewed',
] as const satisfies readonly LiteratureReviewStatus[];
const safeText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine((value) => !value.includes('\0'), 'NUL characters are not allowed');
const nonEmptyText = (maximum: number) => safeText(maximum).pipe(z.string().min(1));
const nullableText = (maximum: number) => nonEmptyText(maximum).nullable();
const stringList = (maximumItems: number, maximumLength: number) =>
  z.array(nonEmptyText(maximumLength)).max(maximumItems);
const httpsUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'https:';
  }, 'Only HTTPS source URLs are allowed');

const ManualAnnotationsSchema = z
  .object({
    topics: stringList(50, 240),
    summary: safeText(8_000),
    relevance: safeText(4_000),
  })
  .strict();

const TransferRecordSchema = z
  .object({
    title: nonEmptyText(2_000),
    authors: stringList(100, 300),
    containerTitle: nullableText(1_000),
    publishedYear: z.number().int().min(1000).max(3000).nullable(),
    workType: nullableText(120),
    doi: nullableText(512),
    sourceUrl: httpsUrlSchema.nullable(),
    sourceTopics: stringList(50, 240),
    searchTags: LiteratureSearchTagsSchema,
    citationCount: z.number().int().nonnegative().nullable(),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    citationKey: safeText(160),
    reviewStatus: z.enum(reviewStatuses),
    manualAnnotations: ManualAnnotationsSchema,
    metadataOnly: z.literal(true),
  })
  .strict();

const ImportRecordSchema = TransferRecordSchema.partial({
  containerTitle: true,
  publishedYear: true,
  workType: true,
  doi: true,
  sourceUrl: true,
  sourceTopics: true,
  searchTags: true,
  citationCount: true,
  fingerprint: true,
  citationKey: true,
  reviewStatus: true,
  manualAnnotations: true,
  metadataOnly: true,
}).extend({
  title: nonEmptyText(2_000),
  authors: stringList(100, 300).default([]),
});

const JsonEnvelopeV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('gosu.literature'),
    records: z
      .array(ImportRecordSchema.omit({ searchTags: true }))
      .max(LITERATURE_TRANSFER_MAX_RECORDS),
  })
  .strict();

const JsonEnvelopeV2Schema = z
  .object({
    schemaVersion: z.literal(LITERATURE_TRANSFER_SCHEMA_VERSION),
    kind: z.literal('gosu.literature'),
    records: z
      .array(ImportRecordSchema.required({ searchTags: true }))
      .max(LITERATURE_TRANSFER_MAX_RECORDS),
  })
  .strict();

const JsonEnvelopeSchema = z.discriminatedUnion('schemaVersion', [
  JsonEnvelopeV1Schema,
  JsonEnvelopeV2Schema,
]);

export type LiteratureTransferRecord = z.infer<typeof TransferRecordSchema>;
export type LiteratureJsonEnvelopeV1 = Readonly<{
  schemaVersion: 1;
  kind: 'gosu.literature';
  records: readonly Omit<LiteratureTransferRecord, 'searchTags'>[];
}>;
export type LiteratureJsonEnvelopeV2 = Readonly<{
  schemaVersion: 2;
  kind: 'gosu.literature';
  records: readonly LiteratureTransferRecord[];
}>;
export type LiteratureFingerprintInput = Readonly<{
  title: string;
  authors?: readonly string[] | undefined;
  publishedYear?: number | null | undefined;
  doi?: string | null | undefined;
}>;

const legacyCsvColumns = [
  'title',
  'authors',
  'container_title',
  'published_year',
  'work_type',
  'doi',
  'source_url',
  'source_topics',
  'citation_count',
  'citation_key',
  'review_status',
  'manual_topics',
  'manual_summary',
  'manual_relevance',
  'fingerprint',
  'metadata_only',
] as const;

const csvColumns = [
  ...legacyCsvColumns.slice(0, 8),
  'search_topics',
  'search_keywords',
  ...legacyCsvColumns.slice(8),
] as const;

export function normalizeDoi(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  let candidate = value.normalize('NFKC').trim();
  if (!candidate || candidate.length > 512 || hasUnsafeControl(candidate)) return null;
  candidate = candidate.replace(/^doi\s*:\s*/iu, '');
  const urlMatch = candidate.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/iu);
  if (urlMatch) candidate = urlMatch[1] ?? '';
  else candidate = candidate.replace(/^(?:dx\.)?doi\.org\//iu, '');
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  candidate = candidate.trim().toLowerCase();
  return /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/u.test(candidate) ? candidate : null;
}

export const normalizeLiteratureDoi = normalizeDoi;

// DOI and same-provider record IDs are strong identities. This deliberately coarse
// fingerprint is only a weak fallback for records that do not yet have either one.
export function literatureFingerprint(input: LiteratureFingerprintInput): string {
  const canonical = [input.title, input.authors?.[0] ?? '', input.publishedYear?.toString() ?? '']
    .join('\u001f')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export const createLiteratureFingerprint = literatureFingerprint;

export function toLiteratureTransferRecord(record: LiteratureRecord): LiteratureTransferRecord {
  const doi = normalizeDoi(record.doi);
  return TransferRecordSchema.parse({
    title: record.title,
    authors: record.authors,
    containerTitle: record.containerTitle,
    publishedYear: record.publishedYear,
    workType: record.workType,
    doi,
    sourceUrl: record.sourceUrl,
    sourceTopics: record.sourceTopics,
    searchTags: record.searchTags ?? { topics: [], keywords: [] },
    citationCount: record.citationCount,
    fingerprint: literatureFingerprint(record),
    citationKey: record.citationKey,
    reviewStatus: record.reviewStatus,
    manualAnnotations: record.manualAnnotations,
    metadataOnly: true,
  });
}

export function normalizeLiteratureTransferRecord(input: unknown): LiteratureTransferRecord {
  const parsed = ImportRecordSchema.parse(input);
  const doi = normalizeDoi(parsed.doi);
  if (parsed.doi && !doi) throw new LiteratureTransferError('literature_import_invalid');
  return TransferRecordSchema.parse({
    title: parsed.title,
    authors: parsed.authors,
    containerTitle: parsed.containerTitle ?? null,
    publishedYear: parsed.publishedYear ?? null,
    workType: parsed.workType ?? null,
    doi,
    sourceUrl: parsed.sourceUrl ?? null,
    sourceTopics: parsed.sourceTopics ?? [],
    searchTags: parsed.searchTags ?? { topics: [], keywords: [] },
    citationCount: parsed.citationCount ?? null,
    fingerprint: literatureFingerprint(parsed),
    citationKey: parsed.citationKey ?? '',
    reviewStatus: parsed.reviewStatus ?? 'unreviewed',
    manualAnnotations: parsed.manualAnnotations ?? { topics: [], summary: '', relevance: '' },
    metadataOnly: true,
  });
}

export function serializeLiteratureJson(
  records: readonly (LiteratureRecord | LiteratureTransferRecord)[],
): string {
  const envelope: LiteratureJsonEnvelopeV2 = {
    schemaVersion: LITERATURE_TRANSFER_SCHEMA_VERSION,
    kind: 'gosu.literature',
    records: normalizeAndSortRecords(records, 'literature_export_too_large'),
  };
  return assertOutputBound(`${JSON.stringify(envelope, null, 2)}\n`);
}

export function parseLiteratureJson(content: string): LiteratureTransferRecord[] {
  assertInputBound(content);
  try {
    const parsed: unknown = JSON.parse(stripByteOrderMark(content));
    if (hasOversizedRecordsArray(parsed)) {
      throw new LiteratureTransferError('literature_import_too_large');
    }
    const envelope = JsonEnvelopeSchema.parse(parsed);
    return normalizeAndSortRecords(
      envelope.records.map(normalizeLiteratureTransferRecord),
      'literature_import_too_large',
    );
  } catch (error) {
    if (error instanceof LiteratureTransferError) throw error;
    throw new LiteratureTransferError('literature_import_invalid');
  }
}

export function serializeLiteratureCsv(
  records: readonly (LiteratureRecord | LiteratureTransferRecord)[],
): string {
  const lines = [csvColumns.join(',')];
  for (const record of normalizeAndSortRecords(records, 'literature_export_too_large')) {
    lines.push(
      [
        record.title,
        JSON.stringify(record.authors),
        record.containerTitle ?? '',
        record.publishedYear?.toString() ?? '',
        record.workType ?? '',
        record.doi ?? '',
        record.sourceUrl ?? '',
        JSON.stringify(record.sourceTopics),
        JSON.stringify(record.searchTags.topics),
        JSON.stringify(record.searchTags.keywords),
        record.citationCount?.toString() ?? '',
        record.citationKey,
        record.reviewStatus,
        JSON.stringify(record.manualAnnotations.topics),
        record.manualAnnotations.summary,
        record.manualAnnotations.relevance,
        record.fingerprint,
        'true',
      ]
        .map(encodeCsvCell)
        .join(','),
    );
  }
  return assertOutputBound(`${lines.join('\n')}\n`);
}

export function parseLiteratureCsv(content: string): LiteratureTransferRecord[] {
  assertInputBound(content);
  try {
    const rows = parseCsvRows(stripByteOrderMark(content));
    if (rows.length === 0) return [];
    const header = rows[0]?.map((value) => value.trim().toLowerCase()) ?? [];
    const columns = matchesCsvHeader(header, csvColumns)
      ? csvColumns
      : matchesCsvHeader(header, legacyCsvColumns)
        ? legacyCsvColumns
        : null;
    if (columns === null) {
      throw new LiteratureTransferError('literature_import_invalid');
    }
    if (rows.length - 1 > LITERATURE_TRANSFER_MAX_RECORDS) {
      throw new LiteratureTransferError('literature_import_too_large');
    }
    const records = rows
      .slice(1)
      .filter((row) => row.some((value) => value.trim() !== ''))
      .map((row) => {
        if (row.length !== columns.length) {
          throw new LiteratureTransferError('literature_import_invalid');
        }
        const values = Object.fromEntries(
          columns.map((column, index) => [column, unprotectCsvCell(row[index] ?? '')]),
        );
        return normalizeLiteratureTransferRecord({
          title: values.title,
          authors: parseListCell(values.authors),
          containerTitle: emptyToNull(values.container_title),
          publishedYear: parseNullableInteger(values.published_year),
          workType: emptyToNull(values.work_type),
          doi: emptyToNull(values.doi),
          sourceUrl: emptyToNull(values.source_url),
          sourceTopics: parseListCell(values.source_topics),
          searchTags: {
            topics: parseListCell(values.search_topics),
            keywords: parseListCell(values.search_keywords),
          },
          citationCount: parseNullableInteger(values.citation_count),
          citationKey: values.citation_key,
          reviewStatus: values.review_status || 'unreviewed',
          manualAnnotations: {
            topics: parseListCell(values.manual_topics),
            summary: values.manual_summary ?? '',
            relevance: values.manual_relevance ?? '',
          },
          fingerprint: values.fingerprint || undefined,
          metadataOnly: values.metadata_only === '' || values.metadata_only === 'true',
        });
      });
    return normalizeAndSortRecords(records, 'literature_import_too_large');
  } catch (error) {
    if (error instanceof LiteratureTransferError) throw error;
    throw new LiteratureTransferError('literature_import_invalid');
  }
}

export function protectCsvCell(value: string): string {
  return /^'?[\p{White_Space}]*[=+\-@]/u.test(value) ? `'${value}` : value;
}

export function unprotectCsvCell(value: string): string {
  return /^''?[\p{White_Space}]*[=+\-@]/u.test(value) ? value.slice(1) : value;
}

export function compareLiteratureTransferRecords(
  left: LiteratureTransferRecord,
  right: LiteratureTransferRecord,
): number {
  return stableTransferRecordKey(left).localeCompare(stableTransferRecordKey(right));
}

function normalizeAndSortRecords(
  records: readonly (LiteratureRecord | LiteratureTransferRecord | unknown)[],
  overflowCode: Extract<
    LiteratureTransferErrorCode,
    'literature_import_too_large' | 'literature_export_too_large'
  >,
): LiteratureTransferRecord[] {
  if (records.length > LITERATURE_TRANSFER_MAX_RECORDS) {
    throw new LiteratureTransferError(overflowCode);
  }
  return records
    .map((record) =>
      isLiteratureRecord(record)
        ? toLiteratureTransferRecord(record)
        : normalizeLiteratureTransferRecord(record),
    )
    .sort(compareLiteratureTransferRecords);
}

function isLiteratureRecord(value: unknown): value is LiteratureRecord {
  return (
    typeof value === 'object' && value !== null && 'projectId' in value && 'aiAnnotations' in value
  );
}

function hasOversizedRecordsArray(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'records' in value &&
    Array.isArray(value.records) &&
    value.records.length > LITERATURE_TRANSFER_MAX_RECORDS
  );
}

function stableTransferRecordKey(record: LiteratureTransferRecord): string {
  return JSON.stringify([
    record.fingerprint,
    record.citationKey,
    record.title,
    record.authors,
    record.publishedYear,
    record.doi,
    record.containerTitle,
    record.workType,
    record.sourceUrl,
    record.sourceTopics,
    record.searchTags.topics,
    record.searchTags.keywords,
    record.citationCount,
    record.reviewStatus,
    record.manualAnnotations.topics,
    record.manualAnnotations.summary,
    record.manualAnnotations.relevance,
  ]);
}

function hasUnsafeControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function matchesCsvHeader(header: readonly string[], expected: readonly string[]): boolean {
  return (
    header.length === expected.length && header.every((value, index) => value === expected[index])
  );
}

function assertInputBound(content: string): void {
  if (Buffer.byteLength(content, 'utf8') > LITERATURE_TRANSFER_MAX_INPUT_BYTES) {
    throw new LiteratureTransferError('literature_import_too_large');
  }
}

function assertOutputBound(content: string): string {
  if (Buffer.byteLength(content, 'utf8') > LITERATURE_TRANSFER_MAX_OUTPUT_BYTES) {
    throw new LiteratureTransferError('literature_export_too_large');
  }
  return content;
}

function stripByteOrderMark(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function encodeCsvCell(value: string): string {
  const protectedValue = protectCsvCell(value);
  return `"${protectedValue.replace(/"/gu, '""')}"`;
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell.length === 0) quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length > LITERATURE_TRANSFER_MAX_RECORDS + 1) {
        throw new LiteratureTransferError('literature_import_too_large');
      }
    } else cell += character;
  }
  if (quoted) throw new LiteratureTransferError('literature_import_invalid');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseListCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new LiteratureTransferError('literature_import_invalid');
    }
    return parsed;
  }
  return trimmed
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNullableInteger(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  if (!/^\d+$/u.test(value.trim())) throw new LiteratureTransferError('literature_import_invalid');
  return Number(value);
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}
