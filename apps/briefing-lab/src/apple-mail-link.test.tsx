import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import { appleMailMessageUrl, safeAppleMailUrl, AppleMailLink } from './apple-mail-link';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn(async () => ({ status: 'requested' })) }));
afterEach(() => vi.clearAllMocks());

describe('original-message navigation', () => {
  it('uses an external-window arrow rather than another envelope, with a distinct cool-blue treatment', () => {
    const html = renderToStaticMarkup(
      <AppleMailLink
        url={appleMailMessageUrl('id@example.test')}
        target={{ routineId: 'r', historyId: 'h', itemId: 'm' }}
      />,
    );
    expect(html).toContain('data-mail-icon="open-in-app"');
    expect(html).toContain('M14 3h7v7M10 14 21 3');
    expect(html).not.toContain('M3 7l9 6');
    const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
    const button = css.match(/\.briefing-insight-card \.briefing-mail-open\s*\{[^}]*\}/)?.[0] ?? '';
    expect(button).toContain('color: #4b6f8c');
    expect(button).toContain('background: #f0f5f9');
  });
  it('slightly enlarges the glyph without changing the title-row button footprint', () => {
    const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
    const icon = css.match(/\.briefing-mail-open svg\s*\{[^}]*\}/)?.[0] ?? '';
    const button = css.match(/\.briefing-insight-card \.briefing-mail-open\s*\{[^}]*\}/)?.[0] ?? '';
    expect(icon).toMatch(/width: 20px;[^}]*height: 20px;/);
    expect(button).toMatch(/width: 26px;[^}]*height: 26px;[^}]*padding: 3px;/);
  });
  it('encodes the original Message-ID, not a subject, recipient or compose URL', () => {
    expect(appleMailMessageUrl('<original+id@example.test>')).toBe(
      'message://%3Coriginal%2Bid%40example.test%3E',
    );
    expect(appleMailMessageUrl('original+id@example.test')).toBe(
      appleMailMessageUrl('<original+id@example.test>'),
    );
    expect(safeAppleMailUrl(appleMailMessageUrl('id?x#y@example.test'))).toBe(
      'message://%3Cid%3Fx%23y%40example.test%3E',
    );
  });
  it.each([
    '',
    '123',
    '<broken@example.test',
    'id\r\n@example.test',
    'id@example.test>junk',
    'mailto:a@example.test',
    'javascript:alert(1)',
    'https://example.test',
  ])('rejects malformed or foreign targets: %s', (value) => {
    expect(safeAppleMailUrl(value)).toBeUndefined();
  });
  it('uses a user-clicked local request, not browser protocol navigation, without expanding the email or duplicating the request', async () => {
    let ui!: ReturnType<typeof create>;
    const target = { routineId: 'r', historyId: 'h', itemId: 'm' };
    await act(() => {
      ui = create(<AppleMailLink url={appleMailMessageUrl('id@example.test')} target={target} />);
    });
    expect(sourceRequest).not.toHaveBeenCalled();
    const link = ui.root.findByType('button');
    const event = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    await act(async () => {
      await Promise.all([link.props.onClick(event), link.props.onClick(event)]);
    });
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(link.props.href).toBeUndefined();
    expect(sourceRequest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sourceRequest).mock.calls[0]!.slice(0, 2)).toEqual(['/mail/open', target]);
    expect(JSON.stringify(ui.toJSON())).toContain('열기 요청을 전달했습니다');
    await act(() => ui.unmount());
    const missing = renderToStaticMarkup(<AppleMailLink />);
    expect(missing).toContain('disabled');
    expect(missing).not.toContain('href=');
  });
  it('keeps unsupported targets disabled and exposes a failed handoff without a browser fallback', async () => {
    const target = { routineId: 'r', historyId: 'h', itemId: 'm' };
    expect(
      renderToStaticMarkup(<AppleMailLink url="mailto:a@example.test" target={target} />),
    ).toContain('disabled');
    expect(
      renderToStaticMarkup(<AppleMailLink url={appleMailMessageUrl('id@example.test')} />),
    ).toContain('disabled');
    vi.mocked(sourceRequest).mockRejectedValueOnce(new Error('Mail 열기 실패'));
    let ui!: ReturnType<typeof create>;
    await act(() => {
      ui = create(<AppleMailLink url={appleMailMessageUrl('id@example.test')} target={target} />);
    });
    await act(async () =>
      ui.root
        .findByType('button')
        .props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() }),
    );
    expect(ui.root.findByProps({ role: 'alert' }).children.join('')).toContain('Mail 열기 실패');
    expect(ui.root.findAllByType('a')).toHaveLength(0);
    await act(() => ui.unmount());
  });
});
