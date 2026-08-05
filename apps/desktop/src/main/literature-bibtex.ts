import type { LiteratureRecord } from '../shared/literature-contracts';
import {
  LITERATURE_TRANSFER_MAX_INPUT_BYTES,
  LITERATURE_TRANSFER_MAX_OUTPUT_BYTES,
  LITERATURE_TRANSFER_MAX_RECORDS,
  LiteratureTransferError,
  compareLiteratureTransferRecords,
  literatureFingerprint,
  normalizeDoi,
  normalizeLiteratureTransferRecord,
  toLiteratureTransferRecord,
  type LiteratureFingerprintInput,
  type LiteratureTransferRecord,
} from './literature-transfer';

const ignoredTitleWords = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'the', 'to', 'with']);

export type CitationKeyInput = LiteratureFingerprintInput &
  Readonly<{ citationKey?: string | null | undefined }>;

type ParsedBibtexEntry = Readonly<{
  type: string;
  key: string;
  fields: Readonly<Record<string, string>>;
}>;

export function createCitationKey(input: CitationKeyInput): string {
  const existing = sanitizeCitationKey(input.citationKey ?? '');
  if (existing) return existing;

  const firstAuthor = input.authors?.[0] ?? '';
  const author = asciiWords(authorFamilyName(firstAuthor)).at(-1) ?? 'Anon';
  const year = input.publishedYear?.toString() ?? 'Nd';
  const titleWords = asciiWords(input.title);
  const titleWord =
    titleWords.find((word) => !ignoredTitleWords.has(word.toLocaleLowerCase('en-US'))) ??
    titleWords[0] ??
    'Work';
  const generated = `${capitalize(author)}${year}${capitalize(titleWord)}`;
  return sanitizeCitationKey(generated) || `Work${literatureFingerprint(input).slice(0, 10)}`;
}

export const createLiteratureCitationKey = createCitationKey;

export function serializeLiteratureBibtex(
  records: readonly (LiteratureRecord | LiteratureTransferRecord)[],
): string {
  if (records.length > LITERATURE_TRANSFER_MAX_RECORDS) {
    throw new LiteratureTransferError('literature_export_too_large');
  }

  const normalized = records
    .map((record) =>
      isLiteratureRecord(record)
        ? toLiteratureTransferRecord(record)
        : normalizeLiteratureTransferRecord(record),
    )
    .sort(compareLiteratureTransferRecords);
  const allocatedKeys = allocateCitationKeys(normalized);
  const entries = normalized.map((record, index) =>
    serializeEntry(record, allocatedKeys[index] ?? 'Work'),
  );
  const output = entries.length === 0 ? '' : `${entries.join('\n\n')}\n`;
  if (Buffer.byteLength(output, 'utf8') > LITERATURE_TRANSFER_MAX_OUTPUT_BYTES) {
    throw new LiteratureTransferError('literature_export_too_large');
  }
  return output;
}

export function parseLiteratureBibtex(content: string): LiteratureTransferRecord[] {
  if (Buffer.byteLength(content, 'utf8') > LITERATURE_TRANSFER_MAX_INPUT_BYTES) {
    throw new LiteratureTransferError('literature_import_too_large');
  }
  try {
    const entries = parseEntries(stripByteOrderMark(content));
    if (entries.length > LITERATURE_TRANSFER_MAX_RECORDS) {
      throw new LiteratureTransferError('literature_import_too_large');
    }
    return entries.map(entryToTransferRecord).sort(compareLiteratureTransferRecords);
  } catch (error) {
    if (error instanceof LiteratureTransferError) throw error;
    throw new LiteratureTransferError('literature_import_invalid');
  }
}

function serializeEntry(record: LiteratureTransferRecord, citationKey: string): string {
  const fields: Array<readonly [string, string | null]> = [
    ['title', record.title],
    ['author', record.authors.join(' and ') || null],
    [containerField(record.workType), record.containerTitle],
    ['year', record.publishedYear?.toString() ?? null],
    ['doi', record.doi],
    ['url', record.sourceUrl],
    ['keywords', record.sourceTopics.join(', ') || null],
    ['gosusearchtopics', serializeSearchTagList(record.searchTags.topics)],
    ['gosusearchkeywords', serializeSearchTagList(record.searchTags.keywords)],
    ['citationcount', record.citationCount?.toString() ?? null],
    ['gosuworktype', record.workType],
    ['gosureviewstatus', record.reviewStatus],
    ['gosumanualtopics', record.manualAnnotations.topics.join(', ') || null],
    ['gosumanualsummary', record.manualAnnotations.summary || null],
    ['gosumanualrelevance', record.manualAnnotations.relevance || null],
    ['gosufingerprint', record.fingerprint],
    ['metadataonly', 'true'],
  ];
  const serializedFields = fields
    .filter((field): field is readonly [string, string] => field[1] !== null)
    .map(([name, value]) => `  ${name} = {${escapeBibtexValue(value)}},`);
  return `@${entryType(record.workType)}{${citationKey},\n${serializedFields.join('\n')}\n}`;
}

function entryToTransferRecord(entry: ParsedBibtexEntry): LiteratureTransferRecord {
  const title = requiredField(entry, 'title');
  const authors = splitAuthors(entry.fields.author ?? '');
  const publishedYear = parseOptionalInteger(entry.fields.year);
  const doi = emptyToNull(entry.fields.doi);
  const workType = emptyToNull(entry.fields.gosuworktype) ?? bibTypeToWorkType(entry.type);
  const fingerprint = literatureFingerprint({ title, authors, publishedYear, doi });
  return normalizeLiteratureTransferRecord({
    title,
    authors,
    containerTitle: emptyToNull(
      entry.fields.journal ?? entry.fields.booktitle ?? entry.fields.publisher,
    ),
    publishedYear,
    workType,
    doi,
    sourceUrl: emptyToNull(entry.fields.url),
    sourceTopics: splitTerms(entry.fields.keywords ?? ''),
    searchTags: {
      topics: parseSearchTagList(entry.fields.gosusearchtopics ?? ''),
      keywords: parseSearchTagList(entry.fields.gosusearchkeywords ?? ''),
    },
    citationCount: parseOptionalInteger(entry.fields.citationcount),
    fingerprint,
    citationKey:
      sanitizeCitationKey(entry.key) || createCitationKey({ title, authors, publishedYear, doi }),
    reviewStatus: parseReviewStatus(entry.fields.gosureviewstatus),
    manualAnnotations: {
      topics: splitTerms(entry.fields.gosumanualtopics ?? ''),
      summary: entry.fields.gosumanualsummary ?? '',
      relevance: entry.fields.gosumanualrelevance ?? '',
    },
    metadataOnly: true,
  });
}

function allocateCitationKeys(records: readonly LiteratureTransferRecord[]): string[] {
  const used = new Map<string, number>();
  return records.map((record) => {
    const base = createCitationKey(record);
    const occurrence = used.get(base) ?? 0;
    used.set(base, occurrence + 1);
    if (occurrence === 0) return base;
    const suffix = alphabeticSuffix(occurrence);
    return `${base.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
  });
}

function alphabeticSuffix(index: number): string {
  let value = index;
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(97 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return suffix;
}

function parseEntries(content: string): ParsedBibtexEntry[] {
  const entries: ParsedBibtexEntry[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    cursor = skipBibtexTrivia(content, cursor);
    if (cursor >= content.length) break;
    if (content[cursor] !== '@') throw new Error('Unexpected BibTeX content');
    cursor += 1;
    const typeResult = readIdentifier(content, cursor);
    const type = typeResult.value.toLowerCase();
    cursor = skipBibtexTrivia(content, typeResult.cursor);
    const opening = content[cursor];
    if (opening !== '{' && opening !== '(') throw new Error('Missing entry delimiter');
    const closing = opening === '{' ? '}' : ')';
    cursor += 1;

    if (type === 'comment' || type === 'preamble' || type === 'string') {
      cursor = skipSpecialEntry(content, cursor, opening, closing);
      continue;
    }

    const keyEnd = findUnescaped(content, ',', cursor);
    if (keyEnd < 0) throw new Error('Missing citation key delimiter');
    const key = content.slice(cursor, keyEnd).trim();
    cursor = keyEnd + 1;
    const fields: Record<string, string> = {};
    let entryClosed = false;

    while (cursor < content.length) {
      cursor = skipWhitespaceCommentsAndCommas(content, cursor);
      if (content[cursor] === closing) {
        cursor += 1;
        entryClosed = true;
        break;
      }
      const fieldResult = readIdentifier(content, cursor);
      const fieldName = fieldResult.value.toLowerCase();
      cursor = skipBibtexTrivia(content, fieldResult.cursor);
      if (content[cursor] !== '=') throw new Error('Missing field assignment');
      cursor = skipBibtexTrivia(content, cursor + 1);
      const valueResult = readBibtexValue(content, cursor, closing);
      if (Object.hasOwn(fields, fieldName)) throw new Error('Duplicate BibTeX field');
      fields[fieldName] = valueResult.value;
      cursor = valueResult.cursor;
    }
    if (!entryClosed || !key) throw new Error('Invalid BibTeX entry');
    entries.push({ type, key, fields });
  }
  return entries;
}

function readBibtexValue(
  content: string,
  start: number,
  entryClosing: string,
): Readonly<{ value: string; cursor: number }> {
  const opening = content[start];
  if (opening === '{') {
    return rejectMacroConcatenation(content, readDelimitedValue(content, start + 1, '{', '}'));
  }
  if (opening === '"') {
    return rejectMacroConcatenation(content, readDelimitedValue(content, start + 1, '"', '"'));
  }
  let cursor = start;
  while (cursor < content.length && content[cursor] !== ',' && content[cursor] !== entryClosing) {
    cursor += 1;
  }
  const value = content.slice(start, cursor).trim();
  if (!value || value.includes('#')) throw new Error('Unsupported BibTeX value');
  return { value, cursor };
}

function rejectMacroConcatenation(
  content: string,
  result: Readonly<{ value: string; cursor: number }>,
): Readonly<{ value: string; cursor: number }> {
  const next = skipBibtexTrivia(content, result.cursor);
  if (content[next] === '#') throw new Error('BibTeX macro concatenation is not supported');
  return result;
}

function skipSpecialEntry(
  content: string,
  start: number,
  opening: string,
  closing: string,
): number {
  let cursor = start;
  let outerDepth = 1;
  let braceDepth = 0;
  let quoted = false;
  let lineComment = false;
  let escaped = false;
  while (cursor < content.length) {
    const character = content[cursor] ?? '';
    if (lineComment) {
      if (character === '\n' || character === '\r') lineComment = false;
      cursor += 1;
      continue;
    }
    if (escaped) {
      escaped = false;
      cursor += 1;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      cursor += 1;
      continue;
    }
    if (!quoted && character === '%') {
      lineComment = true;
      cursor += 1;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      cursor += 1;
      continue;
    }
    if (!quoted) {
      if (opening === '{') {
        if (character === opening) outerDepth += 1;
        else if (character === closing) outerDepth -= 1;
      } else if (character === '{') braceDepth += 1;
      else if (character === '}') {
        if (braceDepth === 0) throw new Error('Unbalanced BibTeX special entry');
        braceDepth -= 1;
      } else if (braceDepth === 0 && character === opening) outerDepth += 1;
      else if (braceDepth === 0 && character === closing) outerDepth -= 1;
      if (outerDepth === 0) return cursor + 1;
    }
    cursor += 1;
  }
  throw new Error('Unterminated BibTeX special entry');
}

function readDelimitedValue(
  content: string,
  start: number,
  opening: string,
  closing: string,
): Readonly<{ value: string; cursor: number }> {
  let cursor = start;
  let depth = opening === '{' ? 1 : 0;
  let value = '';
  let escaped = false;
  while (cursor < content.length) {
    const character = content[cursor] ?? '';
    if (escaped) {
      value += character;
      escaped = false;
      cursor += 1;
      continue;
    }
    if (character === '\\') {
      value += character;
      escaped = true;
      cursor += 1;
      continue;
    }
    if (opening === '{' && character === '{') depth += 1;
    if (character === closing) {
      if (opening === '{') {
        depth -= 1;
        if (depth === 0) return { value: unescapeBibtexValue(value), cursor: cursor + 1 };
      } else {
        return { value: unescapeBibtexValue(value), cursor: cursor + 1 };
      }
    }
    value += character;
    cursor += 1;
  }
  throw new Error('Unterminated BibTeX value');
}

function readIdentifier(
  content: string,
  start: number,
): Readonly<{ value: string; cursor: number }> {
  let cursor = start;
  while (cursor < content.length && /[A-Za-z0-9_-]/u.test(content[cursor] ?? '')) cursor += 1;
  if (cursor === start) throw new Error('Missing identifier');
  return { value: content.slice(start, cursor), cursor };
}

function requiredField(entry: ParsedBibtexEntry, name: string): string {
  const value = entry.fields[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function splitAuthors(value: string): string[] {
  return value
    .split(/\s+and\s+/iu)
    .map((author) => author.trim())
    .filter(Boolean);
}

function splitTerms(value: string): string[] {
  return value
    .split(/[;,]/u)
    .map((term) => term.trim())
    .filter(Boolean);
}

function serializeSearchTagList(values: readonly string[]): string | null {
  return values.length === 0 ? null : JSON.stringify(values);
}

function parseSearchTagList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith('[')) return splitTerms(trimmed);
  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Expected a search-tag list');
  }
  return parsed;
}

function parseOptionalInteger(value: string | undefined): number | null {
  if (!value || value.trim() === '') return null;
  if (!/^\d+$/u.test(value.trim())) throw new Error('Expected an integer');
  return Number(value);
}

function parseReviewStatus(value: string | undefined): LiteratureTransferRecord['reviewStatus'] {
  if (
    value === 'unreviewed' ||
    value === 'screening' ||
    value === 'included' ||
    value === 'excluded' ||
    value === 'reviewed'
  ) {
    return value;
  }
  return 'unreviewed';
}

function entryType(workType: string | null): string {
  const normalized = workType?.toLowerCase() ?? '';
  if (normalized.includes('journal')) return 'article';
  if (normalized.includes('proceeding') || normalized.includes('conference'))
    return 'inproceedings';
  if (normalized === 'book') return 'book';
  if (normalized.includes('chapter')) return 'incollection';
  if (normalized.includes('thesis')) return 'phdthesis';
  if (normalized.includes('report')) return 'techreport';
  return 'misc';
}

function bibTypeToWorkType(type: string): string {
  if (type === 'article') return 'journal-article';
  if (type === 'inproceedings' || type === 'conference') return 'proceedings-article';
  if (type === 'incollection') return 'book-chapter';
  if (type === 'phdthesis' || type === 'mastersthesis') return 'thesis';
  if (type === 'techreport') return 'report';
  return type;
}

function containerField(workType: string | null): string {
  const type = entryType(workType);
  if (type === 'article') return 'journal';
  if (type === 'inproceedings' || type === 'incollection') return 'booktitle';
  return 'publisher';
}

function escapeBibtexValue(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\\{}#$%&_~^]/gu, (character) => {
      if (character === '\\') return '{\\textbackslash}';
      if (character === '~') return '{\\textasciitilde}';
      if (character === '^') return '{\\textasciicircum}';
      return `\\${character}`;
    })
    .replace(/\s+/gu, ' ')
    .trim();
}

function unescapeBibtexValue(value: string): string {
  return value
    .replace(/\{\\textbackslash\}/gu, '\\')
    .replace(/\{\\textasciitilde\}/gu, '~')
    .replace(/\{\\textasciicircum\}/gu, '^')
    .replace(/\\([{}#$%&_])/gu, '$1')
    .trim();
}

function sanitizeCitationKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^A-Za-z0-9_:.+/-]/gu, '')
    .replace(/^[-./]+/u, '')
    .slice(0, 160);
}

function asciiWords(value: string): string[] {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .match(/[A-Za-z0-9]+/gu) ?? []
  );
}

function authorFamilyName(value: string): string {
  const comma = value.indexOf(',');
  return comma >= 0 ? value.slice(0, comma) : value;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function skipBibtexTrivia(content: string, start: number): number {
  let cursor = start;
  while (cursor < content.length) {
    if (/\s/u.test(content[cursor] ?? '')) {
      cursor += 1;
      continue;
    }
    if (content[cursor] !== '%') break;
    while (cursor < content.length && content[cursor] !== '\n' && content[cursor] !== '\r') {
      cursor += 1;
    }
  }
  return cursor;
}

function skipWhitespaceCommentsAndCommas(content: string, start: number): number {
  let cursor = start;
  while (cursor < content.length) {
    const afterTrivia = skipBibtexTrivia(content, cursor);
    if (afterTrivia !== cursor) {
      cursor = afterTrivia;
      continue;
    }
    if (content[cursor] !== ',') break;
    cursor += 1;
  }
  return cursor;
}

function findUnescaped(content: string, character: string, start: number): number {
  let escaped = false;
  for (let cursor = start; cursor < content.length; cursor += 1) {
    const candidate = content[cursor] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (candidate === '\\') {
      escaped = true;
      continue;
    }
    if (candidate === character) return cursor;
  }
  return -1;
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function stripByteOrderMark(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function isLiteratureRecord(
  value: LiteratureRecord | LiteratureTransferRecord,
): value is LiteratureRecord {
  return 'projectId' in value;
}

export const normalizeBibtexDoi = normalizeDoi;
