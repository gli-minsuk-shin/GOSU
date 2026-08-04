import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ProjectChatMarkdown,
  safeProjectChatMarkdownUrl,
} from '../src/renderer/src/project-chat-markdown';

function render(source: string) {
  return renderToStaticMarkup(<ProjectChatMarkdown source={source} />);
}

describe('Project Chat Markdown', () => {
  it('renders single-dollar inline math and double-dollar display math with MathML', () => {
    const html = render(`Mass and energy satisfy $E = mc^2$.

$$
\\mathcal{L}(\\theta) = \\sum_{i=1}^{n} \\ell_i(\\theta)
$$`);

    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML"');
    expect(html).toContain('<annotation encoding="application/x-tex">E = mc^2</annotation>');
    expect(html).toContain('\\mathcal{L}(\\theta)');
  });

  it('keeps escaped or unmatched dollars as text and malformed TeX visible without throwing', () => {
    const html = render(String.raw`The budget is \$20. Invalid: $\notacommand{$`);
    const unmatched = render('An unmatched $ remains text.');

    expect(html).toContain('The budget is $20.');
    expect(unmatched).toContain('An unmatched $ remains text.');
    expect(unmatched).not.toContain('class="katex"');
    expect(html).toContain('katex-error');
    expect(html).toContain('\\notacommand');
  });

  it('drops raw HTML, blocks remote images, and never emits unsafe links', () => {
    const html = render(`<script>alert('script')</script>
<img src="https://evil.example/tracker.png" onerror="alert('image')">

![tracker](https://evil.example/tracker.png)
[unsafe](javascript:alert('link'))
$\\href{javascript:alert(1)}{unsafe-math-link}$`);

    expect(html).toContain('Remote image blocked: tracker');
    expect(html).toContain('project-chat-markdown-link-blocked');
    expect(html).not.toMatch(/<(?:script|img)\b/i);
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('href="');
    expect(html).toContain('\\href{javascript:alert(1)}{unsafe-math-link}');
  });

  it('keeps exact HTTPS links for the fixed external-open handler', () => {
    const html = render('[paper](https://example.org/paper)');

    expect(html).toContain('<a href="https://example.org/paper" rel="noreferrer">paper</a>');
    expect(safeProjectChatMarkdownUrl('https://example.org/paper')).toBe(
      'https://example.org/paper',
    );
    expect(safeProjectChatMarkdownUrl('http://example.org')).toBe('');
    expect(safeProjectChatMarkdownUrl('javascript:alert(1)')).toBe('');
    expect(safeProjectChatMarkdownUrl('data:text/html,unsafe')).toBe('');
    expect(safeProjectChatMarkdownUrl('file:///tmp/private')).toBe('');
    expect(safeProjectChatMarkdownUrl('/relative/private')).toBe('');
    expect(safeProjectChatMarkdownUrl('#local-anchor')).toBe('');
  });

  it('preserves intentional single newlines in visible chat paragraphs', () => {
    const html = render('first line\nsecond line');
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(html).toContain('<p>first line\nsecond line</p>');
    expect(styles).toMatch(/\.message-copy p,\s*\.message-copy li\s*\{\s*white-space: pre-wrap;/u);
  });
});
