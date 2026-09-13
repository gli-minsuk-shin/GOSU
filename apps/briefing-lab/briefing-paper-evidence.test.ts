import { describe, it, expect } from 'vitest';
import { parsePaperHtml, scholarCandidates, loadPaperFigure } from './briefing-paper-evidence';
import sharp from 'sharp';
import type { LiveItem } from './src/live-types';
describe('paper and Scholar evidence', () => {
  it('re-encodes only source-scoped raster figures and keeps display equations ahead of inline symbols', async () => {
    const bytes = await sharp({
      create: { width: 100, height: 80, channels: 3, background: '#82a44c' },
    })
      .png()
      .toBuffer();
    const data = await loadPaperFigure(
      'https://arxiv.org/html/2609.12345v1/x1.png',
      'https://arxiv.org/html/2609.12345v1',
      new AbortController().signal,
      async () => bytes,
    );
    expect(data).toMatch(/^data:image\/webp;base64,/);
    await expect(
      loadPaperFigure(
        'https://arxiv.org/html/2609.99999v1/x1.png',
        'https://arxiv.org/html/2609.12345v1',
        new AbortController().signal,
        async () => bytes,
      ),
    ).rejects.toThrow('scope');
    const paper = parsePaperHtml(
      '<html><body><p class="ltx_p">Evidence.</p>' +
        Array.from({ length: 15 }, () => '<math alttext="x"/>').join('') +
        '<math display="block" alttext="y=x^2"/></body></html>',
      'https://arxiv.org/html/2609.12345v1',
    );
    expect(paper.equations[0]!.latex).toBe('y=x^2');
  });
  it('extracts actual math/captions and accepts only same-paper raster assets', () => {
    const html =
      '<html><body><p class="ltx_p">A source paragraph.</p><math alttext="x=y"/><figure><img src="x1.png"/><figcaption>Method overview.</figcaption></figure><figure><img src="https://evil.example/track.png"/><figcaption>Tracking.</figcaption></figure></body></html>';
    const parsed = parsePaperHtml(html, 'https://arxiv.org/html/2609.12345v1');
    expect(parsed.equations[0]!.latex).toBe('x=y');
    expect(parsed.figures).toHaveLength(1);
    expect(parsed.figures[0]!.assetUrl).toBe('https://arxiv.org/html/2609.12345v1/x1.png');
    const actualRelative = parsePaperHtml(
      html.replace('src="x1.png"', 'src="2609.12345v1/x1.png"'),
      'https://arxiv.org/html/2609.12345v1',
    );
    expect(actualRelative.figures[0]!.assetUrl).toBe('https://arxiv.org/html/2609.12345v1/x1.png');
  });
  it('parses Scholar links without fetching trackers and keeps mail provenance for consent', () => {
    const mail: LiveItem = {
      id: 'mail',
      kind: 'email',
      title: 'Google Scholar alert',
      text: 'Paper https://scholar.google.com/scholar_url?url=https%3A%2F%2Farxiv.org%2Fabs%2F2609.12345v2',
      source: 'Mail',
      readScope: 'mail-preview',
      details: ['scholaralerts-noreply@google.com'],
    };
    const result = scholarCandidates([mail]);
    expect(result[0]!.id).toBe('2609.12345');
    expect(result[0]!.privateOrigin).toBe('mail');
    expect(result[0]!.sourceUrl).toBe('https://arxiv.org/abs/2609.12345v2');
    expect(scholarCandidates([{ ...mail, readScope: 'mail-metadata' }])).toEqual([]);
    expect(scholarCandidates([{ ...mail, text: 'No resolvable paper URL' }])).toEqual([]);
  });
});
