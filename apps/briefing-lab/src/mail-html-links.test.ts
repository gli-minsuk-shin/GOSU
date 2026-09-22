import { describe, expect, it } from 'vitest';
import { htmlFromMailSource, linksFromHtml, mailLinksFromSource } from './mail-html-links';

const qp = (text: string) =>
  [...Buffer.from(text, 'utf8')]
    .map((byte) =>
      byte === 61 || byte > 126
        ? `=${byte.toString(16).toUpperCase().padStart(2, '0')}`
        : String.fromCharCode(byte),
    )
    .join('')
    // Soft line breaks, as mail clients wrap long quoted-printable lines.
    .replace(/(.{60})/g, '$1=\r\n');

const scholarHtml =
  '<div><h3><a class="gse_alrt_title" href="https://scholar.google.com/scholar_url?url=https://arxiv.org/abs/2609.12345&amp;hl=en&amp;sa=X&amp;scisig=SECRET">첫 번째 <b>연구</b> 논문</a></h3>' +
  '<div>First Author - arXiv preprint, 2026</div>' +
  '<a href="https://arxiv.org/pdf/2609.12345">[PDF] arxiv.org</a></div>';

describe('links from a raw HTML mail', () => {
  it('decodes a quoted-printable HTML part inside multipart/alternative and keeps link text and target', () => {
    const raw = [
      'From: Google Scholar Alerts <scholaralerts-noreply@google.com>',
      'Content-Type: multipart/alternative; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      '첫 번째 연구 논문',
      '--b1',
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      qp(scholarHtml),
      '--b1--',
      '',
    ].join('\r\n');
    expect(htmlFromMailSource(raw)).toBe(scholarHtml);
    expect(mailLinksFromSource(raw)).toEqual([
      {
        text: '첫 번째 연구 논문',
        href: 'https://scholar.google.com/scholar_url?url=https://arxiv.org/abs/2609.12345&hl=en&sa=X&scisig=SECRET',
      },
      { text: '[PDF] arxiv.org', href: 'https://arxiv.org/pdf/2609.12345' },
    ]);
  });

  it('finds a base64 HTML part nested in multipart/mixed and ignores text-only or oversized mail', () => {
    const raw = [
      'Content-Type: multipart/mixed;',
      '\tboundary=outer',
      '',
      '--outer',
      'Content-Type: multipart/alternative; boundary=inner',
      '',
      '--inner',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(scholarHtml)
        .toString('base64')
        .replace(/(.{76})/g, '$1\n'),
      '--inner--',
      '--outer--',
    ].join('\n');
    expect(mailLinksFromSource(raw)[0]?.text).toBe('첫 번째 연구 논문');
    expect(mailLinksFromSource('Content-Type: text/plain\n\nhttps://arxiv.org/abs/1')).toEqual([]);
    expect(htmlFromMailSource(`Content-Type: text/html\n\n${'x'.repeat(300_000)}`)).toBeNull();
  });

  it('keeps only web links, with entities decoded and duplicates removed', () => {
    expect(
      linksFromHtml(
        '<a href="mailto:x@example.test">Mail</a><a href=\'https://doi.org/10.1/A?x=1&amp;y=2\'>A&#x2019;s title</a><a href="https://doi.org/10.1/A?x=1&amp;y=2">A’s title</a><script><a href="https://evil.test">x</a></script>',
      ),
    ).toEqual([{ text: 'A’s title', href: 'https://doi.org/10.1/A?x=1&y=2' }]);
  });
});
