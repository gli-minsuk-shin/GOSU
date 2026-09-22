import { expect, it } from 'vitest';
import { paperBibtexFileName, paperLibraryBibtex } from './paper-library-bibtex';
import type { SavedPaper } from './paper-library-index';
type PaperInput = {
  title: string;
  authors?: string[];
  venue?: string;
  publishedAt?: string;
  sourceUrl?: string;
};
const paper = (input: PaperInput): SavedPaper => ({
  historyId: 'h',
  savedAt: '2026-09-12T00:00:00Z',
  item: {
    id: input.title,
    title: input.title,
    summary: '',
    relevance: '',
    importance: 'medium',
    readScope: 'abstract',
    ...(input.publishedAt ? { paperPublishedAt: input.publishedAt } : {}),
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...((input.authors ?? input.venue)
      ? {
          bibliography: {
            authors: input.authors ?? [],
            source: 'test',
            ...(input.venue ? { venue: input.venue } : {}),
          },
        }
      : {}),
  },
});
const keys = (text: string) => [...text.matchAll(/^@\w+\{([^,\n]+),?$/gm)].map((m) => m[1]);
it('renders one entry with the fixed field order, two-space indent and a single trailing newline', () => {
  const { text, entryCount, incompleteCount } = paperLibraryBibtex([
    paper({
      title: 'On the Scaling of Vision Models',
      authors: ['Ana Müller', 'Bo Li'],
      venue: 'Proceedings of the Conference on Computer Vision',
      publishedAt: '2024-05-02T00:00:00Z',
      sourceUrl: 'https://arxiv.org/abs/2405.01234v2',
    }),
  ]);
  expect(text).toBe(
    [
      '@inproceedings{Muller2024Scaling,',
      '  title = {{On the Scaling of Vision Models}},',
      '  author = {Ana Müller and Bo Li},',
      '  booktitle = {Proceedings of the Conference on Computer Vision},',
      '  year = {2024},',
      '  eprint = {2405.01234},',
      '  archivePrefix = {arXiv},',
      '  url = {https://arxiv.org/abs/2405.01234v2}',
      '}',
      '',
    ].join('\n'),
  );
  expect([entryCount, incompleteCount]).toEqual([1, 0]);
});
it('strips diacritics for the key, skips stop words and falls back to Paper/nd without author or year', () => {
  expect(
    keys(
      paperLibraryBibtex([
        paper({ title: '3D vision of the world' }),
        paper({ title: 'The of and in', authors: ['Zoë  van  Dijk'] }),
        paper({
          title: 'A Study on Rényi Bounds',
          authors: ['Ana Müller'],
          publishedAt: '2024-05-02T00:00:00Z',
        }),
      ]).text,
    ),
  ).toEqual(['Dijknd', 'Muller2024Study', 'Papernd3D']);
});
it('never dates an entry from the saved or summarized date and counts incomplete entries', () => {
  const missing = paperLibraryBibtex([
    paper({ title: 'No metadata at all' }),
    paper({ title: 'Author only', authors: ['Jo Kim'] }),
    paper({ title: 'Year only', publishedAt: '2023-01-01T00:00:00Z' }),
    paper({ title: 'Both', authors: ['Jo Kim'], publishedAt: '2023-01-01T00:00:00Z' }),
  ]);
  expect([missing.entryCount, missing.incompleteCount]).toEqual([4, 3]);
  expect(missing.text).not.toContain('2026');
  expect(missing.text).toContain('  year = {2023}\n}');
  const bad = paperLibraryBibtex([paper({ title: 'Broken date', publishedAt: 'not-a-date' })]);
  expect(bad.text).not.toContain('year = ');
  expect(keys(bad.text)).toEqual(['PaperndBroken']);
});
it('gives every colliding key a suffix and leaves unique keys bare', () => {
  const { text } = paperLibraryBibtex([
    paper({ title: 'Scaling laws beta', authors: ['Ha Kim'], publishedAt: '2024-02-01T00:00:00Z' }),
    paper({
      title: 'Scaling laws alpha',
      authors: ['Jo Kim'],
      publishedAt: '2024-01-01T00:00:00Z',
    }),
    paper({
      title: 'Scaling laws gamma',
      authors: ['Su Kim'],
      publishedAt: '2024-03-01T00:00:00Z',
    }),
    paper({ title: 'Routing tricks', authors: ['Jo Kim'], publishedAt: '2024-01-01T00:00:00Z' }),
  ]);
  expect(keys(text)).toEqual([
    'Kim2024Routing',
    'Kim2024Scalinga',
    'Kim2024Scalingb',
    'Kim2024Scalingc',
  ]);
  expect(text).not.toContain('@misc{Kim2024Scaling,');
  const sameTitle = paperLibraryBibtex([
    paper({ title: 'Same', authors: ['Jo Kim'], sourceUrl: 'https://example.org/b' }),
    paper({ title: 'Same', authors: ['Jo Kim'], sourceUrl: 'https://example.org/a' }),
  ]);
  expect(keys(sameTitle.text)).toEqual(['KimndSamea', 'KimndSameb']);
  expect(sameTitle.text.indexOf('https://example.org/a')).toBeLessThan(
    sameTitle.text.indexOf('https://example.org/b'),
  );
});
it('reads arXiv eprints and DOIs from the source url and only links https sources', () => {
  const [arxivPdf, arxivHtml, doi, plain, insecure] = [
    'https://arxiv.org/pdf/2405.01234v3.pdf',
    'https://arxiv.org/html/2405.05678',
    'https://doi.org/10.1145/3580305.3599876',
    'https://example.org/papers/1',
    'http://example.org/papers/1',
  ].map((sourceUrl) => paperLibraryBibtex([paper({ title: 'Link study', sourceUrl })]).text);
  expect(arxivPdf).toContain('  eprint = {2405.01234},\n  archivePrefix = {arXiv},\n  url = {');
  expect(arxivHtml).toContain('  eprint = {2405.05678},');
  expect(doi).toContain('  doi = {10.1145/3580305.3599876},\n  url = {');
  expect(doi).not.toContain('eprint');
  expect(plain).toContain('  url = {https://example.org/papers/1}');
  expect(plain).not.toContain('doi = ');
  expect(insecure).not.toContain('url = ');
});
it('picks the entry type from the venue', () => {
  const type = (venue?: string) =>
    paperLibraryBibtex([paper({ title: 'Venue study', ...(venue ? { venue } : {}) })]).text.split(
      '{',
    )[0];
  expect(type('Advances in Neural Information Processing Systems (NeurIPS)')).toBe(
    '@inproceedings',
  );
  expect(type("ICLR'24 Workshop on Agents")).toBe('@inproceedings');
  expect(type('Nature Machine Intelligence')).toBe('@article');
  expect(type('Miracle Journal')).toBe('@article');
  expect(type()).toBe('@misc');
  expect(paperLibraryBibtex([paper({ title: 'V', venue: 'ICML2024' })]).text).toContain(
    '  booktitle = {ICML2024}',
  );
  expect(paperLibraryBibtex([paper({ title: 'V', venue: 'Nature' })]).text).toContain(
    '  journal = {Nature}',
  );
});
it('escapes BibTeX specials once and collapses whitespace inside values', () => {
  const { text } = paperLibraryBibtex([
    paper({
      title: 'Cost\t~50%  of\nA_B {x} & #1 $d ^2 \\ end',
      authors: ['Ann  O_Neil'],
      venue: 'Journal  of\tR&D',
    }),
  ]);
  expect(text).toContain(
    '  title = {{Cost \\textasciitilde{}50\\% of A\\_B \\{x\\} \\& \\#1 \\$d \\textasciicircum{}2 \\textbackslash{} end}},',
  );
  expect(text).toContain('  author = {Ann O\\_Neil},');
  expect(text).toContain('  journal = {Journal of R\\&D}');
  expect(text).not.toContain('\\textbackslash\\{\\}');
});
it('produces byte-identical output however the input is ordered, with blank lines between entries', () => {
  const papers = [
    paper({ title: 'Alpha', authors: ['Jo Kim'], publishedAt: '2024-01-01T00:00:00Z' }),
    paper({ title: 'Beta', authors: ['Ana Müller'], venue: 'NeurIPS' }),
    paper({ title: 'Gamma', sourceUrl: 'https://doi.org/10.1000/xyz123' }),
    paper({ title: 'Alpha', authors: ['Jo Kim'], publishedAt: '2024-01-01T00:00:00Z' }),
  ];
  const forward = paperLibraryBibtex(papers).text;
  expect(paperLibraryBibtex([...papers].reverse()).text).toBe(forward);
  expect(paperLibraryBibtex([papers[2]!, papers[0]!, papers[3]!, papers[1]!]).text).toBe(forward);
  expect(forward.split('\n\n')).toHaveLength(4);
  expect(forward.endsWith('}\n')).toBe(true);
  expect(forward.endsWith('}\n\n')).toBe(false);
});
it('names the file from the local calendar day', () => {
  expect(paperBibtexFileName(new Date(2026, 8, 22, 23, 59))).toBe(
    'gosu-paper-summaries-20260922.bib',
  );
  expect(paperBibtexFileName(new Date(2027, 0, 5, 0, 1))).toBe('gosu-paper-summaries-20270105.bib');
});
it('keeps identifiers verbatim so an underscore in a DOI or URL still links', () => {
  const { text } = paperLibraryBibtex([
    paper({
      title: 'Chapter with an underscore DOI',
      sourceUrl: 'https://doi.org/10.1007/978-3-030-58452-8_13',
    }),
  ]);

  expect(text).toContain('  doi = {10.1007/978-3-030-58452-8_13},');
  expect(text).toContain('  url = {https://doi.org/10.1007/978-3-030-58452-8_13}');
  expect(text).not.toContain('\\_13');
});
