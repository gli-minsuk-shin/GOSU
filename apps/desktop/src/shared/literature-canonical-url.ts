import type { LiteratureRecord } from './literature-contracts';

export type LiteratureCanonicalUrlInput = Pick<
  LiteratureRecord,
  'doi' | 'canonicalId' | 'sourceUrl'
>;

const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/iu;
const ARXIV_ID_PATTERN = /^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})$/iu;

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function safeHttpsUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      url.hostname === '' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function doiResolverUrl(value: string | null | undefined) {
  if (!value) return null;
  const doi = value.trim().replace(/^doi:\s*/iu, '');
  if (!DOI_PATTERN.test(doi) || hasControlCharacter(doi)) return null;
  const url = new URL('https://doi.org/');
  url.pathname = `/${doi}`;
  return safeHttpsUrl(url.href);
}

function arxivAbstractUrl(value: string | null | undefined) {
  if (!value) return null;
  const canonicalId = value.trim();
  if (!/^arxiv:/iu.test(canonicalId)) return null;
  const arxivId = canonicalId
    .slice(canonicalId.indexOf(':') + 1)
    .trim()
    .replace(/v\d+$/iu, '');
  if (!ARXIV_ID_PATTERN.test(arxivId)) return null;
  const url = new URL('https://arxiv.org/');
  url.pathname = `/abs/${arxivId}`;
  return safeHttpsUrl(url.href);
}

/**
 * Returns a public HTTPS landing page without trusting provider markup.
 * DOI is the strongest cross-provider identity, followed by a normalized arXiv ID and then the
 * provider's validated source URL.
 */
export function canonicalLiteratureUrl(record: LiteratureCanonicalUrlInput): string | null {
  return (
    doiResolverUrl(record.doi) ??
    arxivAbstractUrl(record.canonicalId) ??
    safeHttpsUrl(record.sourceUrl)
  );
}
