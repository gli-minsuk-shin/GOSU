import { describe, expect, it } from 'vitest';

import { canonicalLiteratureUrl } from '../src/shared/literature-canonical-url';

describe('canonical literature URL', () => {
  it('prefers a valid DOI over arXiv and provider URLs', () => {
    expect(
      canonicalLiteratureUrl({
        doi: '10.1000/GOSU.1',
        canonicalId: 'arxiv:2608.01234',
        sourceUrl: 'https://www.semanticscholar.org/paper/fixture',
      }),
    ).toBe('https://doi.org/10.1000/GOSU.1');
  });

  it('uses a versionless arXiv abstract page when DOI is absent or invalid', () => {
    expect(
      canonicalLiteratureUrl({
        doi: 'not a DOI',
        canonicalId: 'arxiv:2608.01234v3',
        sourceUrl: 'https://huggingface.co/papers/2608.01234',
      }),
    ).toBe('https://arxiv.org/abs/2608.01234');
    expect(
      canonicalLiteratureUrl({
        doi: null,
        canonicalId: 'arxiv:cs.AI/0123456',
        sourceUrl: null,
      }),
    ).toBe('https://arxiv.org/abs/cs.AI/0123456');
  });

  it('falls back only to credential-free HTTPS provider URLs', () => {
    expect(
      canonicalLiteratureUrl({
        doi: null,
        canonicalId: null,
        sourceUrl: 'https://example.org/paper?id=fixture',
      }),
    ).toBe('https://example.org/paper?id=fixture');
    for (const sourceUrl of [
      'http://example.org/paper',
      'javascript:alert(1)',
      'https://user:secret@example.org/paper',
      'not a URL',
    ]) {
      expect(canonicalLiteratureUrl({ doi: null, canonicalId: null, sourceUrl })).toBeNull();
    }
  });
});
