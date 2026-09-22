import type { SavedPaper } from './paper-library-index';
/** Reference managers re-import the same library: the same papers must export byte-identical text. */
const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'on',
  'for',
  'and',
  'in',
  'to',
  'with',
  'via',
  'from',
  'by',
  'is',
  'are',
]);
const CONFERENCE_WORDS = new Set([
  'conference',
  'proceedings',
  'workshop',
  'symposium',
  'neurips',
  'nips',
  'icml',
  'iclr',
  'cvpr',
  'iccv',
  'eccv',
  'aaai',
  'ijcai',
  'acl',
  'emnlp',
  'naacl',
  'kdd',
  'aistats',
  'uai',
  'colt',
]);
const BIBTEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '%': '\\%',
  '&': '\\&',
  '#': '\\#',
  _: '\\_',
  $: '\\$',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};
const ARXIV_PATH =
  /^\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}|[A-Za-z][A-Za-z.-]*\/\d{7})(?:v\d+)?(?:\.pdf)?$/;
const collapse = (value: string) => value.replace(/\s+/g, ' ').trim();
const escapeBibtex = (value: string) =>
  collapse(value).replace(/[\\{}%&#_$~^]/g, (character) => BIBTEX_ESCAPES[character] ?? character);
/** Braces would unbalance the entry and whitespace cannot be part of an identifier. */
const verbatimBibtex = (value: string) => value.replace(/[\s{}]/g, '');
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const asciiLetters = (value: string) => value.normalize('NFKD').replace(/[^A-Za-z]/g, '');
const asciiWord = (value: string) => value.normalize('NFKD').replace(/[^A-Za-z0-9]/g, '');
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Only the source's own publication date may date an entry; saving or summarizing never does. */
function publicationYear(item: SavedPaper['item']) {
  const value = item.paperPublishedAt;
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return /^(\d{4})-/.exec(value)?.[1] ?? '';
}
function familyName(authors: readonly string[]) {
  const parts = collapse(authors[0] ?? '').split(' ');
  return capitalize(asciiLetters(parts.at(-1) ?? ''));
}
function titleWord(title: string) {
  for (const word of collapse(title).split(' ')) {
    const letters = asciiWord(word);
    if (letters && !TITLE_STOP_WORDS.has(letters.toLowerCase())) return capitalize(letters);
  }
  return '';
}
const isConferenceVenue = (venue: string) =>
  venue
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => CONFERENCE_WORDS.has(word));
type Identifiers = { eprint: string; archivePrefix: string; doi: string; url: string };
function decodePath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}
function identifierFields(sourceUrl: string | undefined): Identifiers {
  const none: Identifiers = { eprint: '', archivePrefix: '', doi: '', url: '' };
  if (!sourceUrl) return none;
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return none;
  }
  if (parsed.protocol !== 'https:') return none;
  const base: Identifiers = { ...none, url: sourceUrl };
  if (parsed.hostname === 'arxiv.org') {
    const eprint = ARXIV_PATH.exec(parsed.pathname)?.[1];
    if (eprint) return { ...base, eprint, archivePrefix: 'arXiv' };
  }
  if (parsed.hostname === 'doi.org') {
    const doi = decodePath(parsed.pathname.slice(1));
    if (/^10\.\d{4,9}\/\S+$/.test(doi)) return { ...base, doi };
  }
  return base;
}
type PreparedEntry = {
  key: string;
  base: string;
  type: string;
  fields: [string, string][];
  sortTitle: string;
  sortUrl: string;
  incomplete: boolean;
};
function prepareEntry(paper: SavedPaper): PreparedEntry {
  const item = paper.item;
  const authors = (item.bibliography?.authors ?? []).map(collapse).filter(Boolean);
  const year = publicationYear(item);
  const venue = collapse(item.bibliography?.venue ?? '');
  const conference = isConferenceVenue(venue);
  const identifiers = identifierFields(item.sourceUrl);
  const fields: [string, string][] = [];
  const title = escapeBibtex(item.title);
  if (title) fields.push(['title', `{{${title}}}`]);
  const author = authors.map(escapeBibtex).filter(Boolean).join(' and ');
  if (author) fields.push(['author', `{${author}}`]);
  if (venue) fields.push([conference ? 'booktitle' : 'journal', `{${escapeBibtex(venue)}}`]);
  if (year) fields.push(['year', `{${year}}`]);
  // Identifiers are verbatim fields: styles wrap them in \url{} or \doi{}, where an escaped
  // underscore ("10.1007/978-3-030-58452-8\_13") prints a backslash and breaks the link.
  for (const [name, value] of [
    ['eprint', identifiers.eprint],
    ['archivePrefix', identifiers.archivePrefix],
    ['doi', identifiers.doi],
    ['url', identifiers.url],
  ] as const)
    if (value) fields.push([name, `{${verbatimBibtex(value)}}`]);
  return {
    key: '',
    base: `${familyName(authors) || 'Paper'}${year || 'nd'}${titleWord(item.title)}`,
    type: venue ? (conference ? 'inproceedings' : 'article') : 'misc',
    fields,
    sortTitle: collapse(item.title),
    sortUrl: item.sourceUrl ?? '',
    incomplete: !authors.length || !year,
  };
}
/** Colliding keys all take a suffix, so no entry silently changes key when a neighbour is added. */
function keySuffix(index: number) {
  let remaining = index,
    suffix = '';
  do {
    suffix = String.fromCharCode(97 + (remaining % 26)) + suffix;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return suffix;
}
function renderEntry(entry: PreparedEntry) {
  const body = entry.fields
    .map(
      ([name, value], index) => `  ${name} = ${value}${index < entry.fields.length - 1 ? ',' : ''}`,
    )
    .join('\n');
  return body ? `@${entry.type}{${entry.key},\n${body}\n}` : `@${entry.type}{${entry.key}\n}`;
}
export function paperLibraryBibtex(papers: readonly SavedPaper[]): {
  text: string;
  entryCount: number;
  incompleteCount: number;
} {
  const entries = papers.map(prepareEntry);
  const groups = new Map<string, PreparedEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.base);
    if (group) group.push(entry);
    else groups.set(entry.base, [entry]);
  }
  for (const [base, group] of groups) {
    group.sort((a, b) => compare(a.sortTitle, b.sortTitle) || compare(a.sortUrl, b.sortUrl));
    for (const [index, entry] of group.entries())
      entry.key = group.length > 1 ? `${base}${keySuffix(index)}` : base;
  }
  entries.sort(
    (a, b) =>
      compare(a.key, b.key) || compare(a.sortTitle, b.sortTitle) || compare(a.sortUrl, b.sortUrl),
  );
  return {
    text: `${entries.map(renderEntry).join('\n\n')}\n`,
    entryCount: entries.length,
    incompleteCount: entries.filter((entry) => entry.incomplete).length,
  };
}
export function paperBibtexFileName(now: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `gosu-paper-summaries-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.bib`;
}
