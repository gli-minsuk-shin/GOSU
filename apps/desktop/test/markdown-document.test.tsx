import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  MarkdownDocument,
  classifyMarkdownLink,
  extractFrontmatter,
  safeMarkdownUrl,
} from '../src/renderer/src/markdown-document';

function renderMarkdown(source: string, vaultFiles: readonly string[] = []) {
  return renderToStaticMarkup(
    <MarkdownDocument
      notePath="notes/current.md"
      source={source}
      vaultFiles={vaultFiles}
      onOpenNote={vi.fn()}
    />,
  );
}

describe('rendered Markdown document', () => {
  it('renders CommonMark, GFM, fenced code, and read-only frontmatter semantically', () => {
    const html = renderMarkdown(`---
title: Reproducible study
tags:
  - ml
---
# Experiment report

This is **important** and ~~obsolete~~.

- first result
- second result

> Human review is required.

| Trial | Score |
| --- | ---: |
| baseline | 0.81 |

- [x] Baseline reproduced

Evidence is linked to a footnote.[^1]

[^1]: Verified evidence.

\`\`\`ts
const score = 0.81;
\`\`\`
`);

    expect(html).toContain('<details class="note-properties"><summary>Properties</summary>');
    expect(html).toContain('title: Reproducible study');
    expect(html).toContain('<h1>Experiment report</h1>');
    expect(html).toContain('<strong>important</strong>');
    expect(html).toContain('<del>obsolete</del>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<table>');
    expect(html).toContain('<input type="checkbox" disabled="" checked=""/>');
    expect(html).toContain('<sup>');
    expect(html).toContain('Verified evidence.');
    expect(html).toContain('<code class="language-ts">const score = 0.81;');
  });

  it('drops raw HTML and does not expose active attributes or remote images', () => {
    const html = renderMarkdown(`# Safe

<script>alert('script')</script>
<iframe src="https://evil.example/frame">frame</iframe>
<style>body { display: none }</style>
<img src="https://evil.example/tracker.png" onerror="alert('image')">
<div onclick="alert('click')">raw container</div>

![remote tracker](https://evil.example/tracker.png)
`);

    expect(html).toContain('<h1>Safe</h1>');
    expect(html).toContain('Remote or unsupported image blocked: remote tracker');
    expect(html).not.toMatch(/<(?:script|iframe|style|img)\b/i);
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('raw container');
  });

  it('turns prose wiki-links into note links without rewriting inline or fenced code', () => {
    const html = renderMarkdown(
      `Open [[Target|Readable alias]].

Inline code stays \`[[Inline]]\`.

\`\`\`md
[[Fence]]
\`\`\`
`,
      ['Target.md', 'Inline.md', 'Fence.md'],
    );

    expect(html.match(/class="vault-note-link"/g)).toHaveLength(1);
    expect(html).toContain('>Readable alias</a>');
    expect(html).toContain('<code>[[Inline]]</code>');
    expect(html).toContain('<code class="language-md">[[Fence]]');
  });

  it('keeps ambiguous wiki-links non-actionable', () => {
    const html = renderMarkdown('See [[Paper]].', ['area-a/Paper.md', 'area-b/Paper.md']);

    expect(html).toContain('class="blocked-markdown-link missing-note"');
    expect(html).not.toContain('class="vault-note-link"');
  });
});

describe('Markdown link policy', () => {
  const vaultFiles = ['Target.md', 'notes/Related.md'];

  it('allows an exact HTTPS destination and resolvable vault Markdown notes', () => {
    expect(
      classifyMarkdownLink('notes/current.md', 'https://example.org/paper', vaultFiles),
    ).toEqual({
      kind: 'external',
      url: 'https://example.org/paper',
    });
    expect(classifyMarkdownLink('notes/current.md', './Related.md#result', vaultFiles)).toEqual({
      kind: 'note',
      path: 'notes/Related.md',
    });
    expect(classifyMarkdownLink('notes/current.md', '../Target.md', vaultFiles)).toEqual({
      kind: 'note',
      path: 'Target.md',
    });
  });

  it('blocks unsafe schemes, protocol-relative links, traversal, and missing notes', () => {
    for (const href of [
      'http://example.org',
      'javascript:alert(1)',
      'data:text/html,unsafe',
      'file:///tmp/note.md',
      '//example.org/paper',
      '../../outside.md',
    ]) {
      expect(classifyMarkdownLink('notes/current.md', href, vaultFiles)).toMatchObject({
        kind: 'blocked',
      });
    }
    expect(classifyMarkdownLink('notes/current.md', './Missing.md', vaultFiles)).toEqual({
      kind: 'blocked',
      reason: 'missing-note',
    });
  });

  it('passes only internal relative URLs and HTTPS through the renderer transform', () => {
    expect(safeMarkdownUrl('https://example.org/paper')).toBe('https://example.org/paper');
    expect(safeMarkdownUrl('./figure.png')).toBe('./figure.png');
    expect(safeMarkdownUrl('gosu-wiki:Target')).toBe('gosu-wiki:Target');

    for (const href of [
      'http://example.org',
      'javascript:alert(1)',
      'data:image/png;base64,abc',
      'file:///tmp/figure.png',
      '//example.org/figure.png',
    ]) {
      expect(safeMarkdownUrl(href)).toBe('');
    }
  });

  it('extracts bounded frontmatter while leaving ordinary documents alone', () => {
    expect(extractFrontmatter('---\ntitle: Test\n---\n# Body')).toBe('title: Test');
    expect(extractFrontmatter('# Body')).toBeNull();
  });
});
