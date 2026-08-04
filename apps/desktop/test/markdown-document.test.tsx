import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  MarkdownDocument,
  classifyMarkdownLink,
  extractFrontmatter,
  safeMarkdownUrl,
} from '../src/renderer/src/markdown-document';
import { MARKDOWN_MATH_LIMITS } from '../src/renderer/src/markdown-math-policy';

function renderMarkdown(
  source: string,
  vaultFiles: readonly string[] = [],
  loadVaultImages = true,
) {
  return renderToStaticMarkup(
    <MarkdownDocument
      notePath="notes/current.md"
      source={source}
      vaultFiles={vaultFiles}
      onOpenNote={vi.fn()}
      loadVaultImages={loadVaultImages}
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

  it('renders single-dollar inline math and double-dollar display math with local KaTeX', () => {
    const html = renderMarkdown(`Mass and energy satisfy $E = mc^2$.

$$
\\mathcal{L}(\\theta) = \\sum_{i=1}^{n} \\ell_i(\\theta)
$$`);

    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML"');
    expect(html).toContain('<annotation encoding="application/x-tex">E = mc^2</annotation>');
    expect(html).toContain('\\mathcal{L}(\\theta)');
  });

  it('keeps escaped and unmatched dollars as text and bounds malformed or untrusted TeX', () => {
    const malformed = renderMarkdown(String.raw`The budget is \$20. Invalid: $\notacommand{$`);
    const unmatched = renderMarkdown('An unmatched $ remains text.');
    const untrusted = renderMarkdown(String.raw`$\href{javascript:alert(1)}{unsafe}$`);
    const untrustedImage = renderMarkdown(
      String.raw`$\includegraphics{https://evil.example/tracker.png}$`,
    );

    expect(malformed).toContain('The budget is $20.');
    expect(malformed).toContain('katex-error');
    expect(malformed).toContain('\\notacommand');
    expect(unmatched).toContain('An unmatched $ remains text.');
    expect(unmatched).not.toContain('class="katex"');
    expect(untrusted).not.toContain('href="');
    expect(untrusted).toContain('\\href{javascript:alert(1)}{unsafe}');
    expect(untrustedImage).not.toContain('<img');
    expect(untrustedImage).toContain('\\includegraphics');
  });

  it('does not interpret frontmatter, inline code, or fenced code as math', () => {
    const html = renderMarkdown(
      [
        '---',
        'budget: $20',
        '---',
        'Body math: $x^2$.',
        '',
        'Inline code: `$not_math$`.',
        '',
        '```text',
        '$$',
        'not_math',
        '$$',
        '```',
      ].join('\n'),
    );

    expect(html.match(/class="katex"/g)).toHaveLength(1);
    expect(html).toContain('budget: $20');
    expect(html).toContain('<code>$not_math$</code>');
    expect(html).toContain('<code class="language-text">$$\nnot_math\n$$');
  });

  it('keeps formulas beyond the local document rendering budget visible as code', () => {
    const source = Array.from(
      { length: MARKDOWN_MATH_LIMITS.maxFormulaCount + 1 },
      (_, index) => `$x_${index}$`,
    ).join(' ');
    const html = renderMarkdown(source);

    expect(html.match(/class="katex"/g)).toHaveLength(MARKDOWN_MATH_LIMITS.maxFormulaCount);
    expect(html).toContain(`<code>$x_${MARKDOWN_MATH_LIMITS.maxFormulaCount}$</code>`);

    const overlongFormula = 'x'.repeat(MARKDOWN_MATH_LIMITS.maxCharactersPerFormula + 1);
    const overlongHtml = renderMarkdown(`$${overlongFormula}$`);
    expect(overlongHtml).not.toContain('class="katex"');
    expect(overlongHtml).toContain(`<code>$${overlongFormula}$</code>`);
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

  it('does not resolve repository Markdown images through the Obsidian Vault', () => {
    const html = renderMarkdown(
      '![private collision](secret.png)\n\nRepository math: $E = mc^2$.',
      ['secret.png'],
      false,
    );

    expect(html).toContain('Remote or unsupported image blocked: private collision');
    expect(html).not.toContain('Loading image');
    expect(html).toContain('class="katex"');
  });

  it('keeps long display math inside the Markdown reader viewport', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /\.markdown-document \.katex-display\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/su,
    );
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
