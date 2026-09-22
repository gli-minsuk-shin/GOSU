import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmailBriefingDisclosure, PaperBriefingDisclosure } from './briefing-insight-card';
import {
  BriefingBottomCollapse,
  BriefingSectionRail,
  collapseReadingBlock,
} from './briefing-disclosure-collapse';
import { act, create } from 'react-test-renderer';

it.each(['email', 'papers'] as const)(
  'places a bottom collapse button after the full %s detail',
  (kind) => {
    const html = renderToStaticMarkup(
      kind === 'email' ? (
        <EmailBriefingDisclosure title="Mail">
          <p>Last detail content</p>
        </EmailBriefingDisclosure>
      ) : (
        <PaperBriefingDisclosure title="Paper" keywords={[]}>
          <p>Last detail content</p>
        </PaperBriefingDisclosure>
      ),
    );
    const label = kind === 'email' ? '이메일 요약 접기' : '논문 요약 접기';
    expect(html).toContain(`aria-label="${label}"`);
    expect(html.indexOf('Last detail content')).toBeLessThan(html.indexOf(`aria-label="${label}"`));
    expect(html.indexOf(`aria-label="${label}"`)).toBeLessThan(html.indexOf('</details>'));
  },
);
function fixture() {
  const summary = { focus: vi.fn(), getBoundingClientRect: () => ({ top: -180 }) };
  const scroller = {
    scrollTop: 1000,
    scrollTo: vi.fn(),
    getBoundingClientRect: () => ({ top: 60 }),
  };
  const outer = { open: true },
    sibling = { open: true };
  const block = {
    open: true,
    querySelector: vi.fn(() => summary),
    closest: vi.fn(() => scroller),
    dispatchEvent: vi.fn(),
  };
  const button = { closest: vi.fn(() => block) };
  return { summary, scroller, block, button, outer, sibling };
}
it('closes only the nearest expanded block and returns focus/scroll to its title in the reading pane', () => {
  const f = fixture();
  expect(collapseReadingBlock(f.button as unknown as HTMLElement)).toBe(true);
  expect(f.block.open).toBe(false);
  expect(f.outer.open).toBe(true);
  expect(f.sibling.open).toBe(true);
  expect(f.button.closest).toHaveBeenCalledWith('details');
  expect(f.summary.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(f.block.dispatchEvent.mock.calls[0]?.[0].type).toBe('toggle');
  expect(f.scroller.scrollTo).toHaveBeenCalledWith({ top: 748, behavior: 'auto' });
  expect(collapseReadingBlock(f.button as unknown as HTMLElement)).toBe(false);
  expect(f.scroller.scrollTo).toHaveBeenCalledOnce();
});
it('does not throw or scroll another window when there is no enclosing reading pane', () => {
  const f = fixture();
  f.block.closest.mockReturnValue(null as never);
  expect(collapseReadingBlock(f.button as unknown as HTMLElement)).toBe(true);
  expect(f.scroller.scrollTo).not.toHaveBeenCalled();
  f.button.closest.mockReturnValue(null as never);
  expect(collapseReadingBlock(f.button as unknown as HTMLElement)).toBe(false);
});
it('uses a non-submitting button and prevents click bubbling into other disclosures', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const f = fixture();
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(<BriefingBottomCollapse label="논문 요약 접기" />);
    });
    const event = { currentTarget: f.button, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    await act(() => ui.root.findByType('button').props.onClick(event));
    expect(ui.root.findByType('button').props.type).toBe('button');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(f.block.open).toBe(false);
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});

it('flags an email summarized without its body and labels merged account copies as the same mail', () => {
  const account = (id: string) => ({ id, name: id, addresses: [`${id}@example.test`] });
  const html = renderToStaticMarkup(
    <EmailBriefingDisclosure
      title="Mail"
      bodyUnavailable
      mailCopies={[
        { id: 'a', title: 'Mail', receivedAt: '2026-09-17T00:00:00Z', account: account('gmail') },
        { id: 'b', title: 'Mail', receivedAt: '2026-09-17T00:00:00Z', account: account('yonsei') },
      ]}
    >
      <p>detail</p>
    </EmailBriefingDisclosure>,
  );
  expect(html).toContain('본문 미확인 · 원본 확인');
  expect(html).toContain('같은 메일 · 2개 계정 수신');
  expect(html).not.toContain('원문 일치 확인');
  expect(
    renderToStaticMarkup(
      <EmailBriefingDisclosure title="Mail">
        <p>detail</p>
      </EmailBriefingDisclosure>,
    ),
  ).not.toContain('본문 미확인');
});

it('closes an open section from its left accent bar, like the − icon', () => {
  const f = fixture();
  let ui!: ReturnType<typeof create>;
  act(() => {
    ui = create(<BriefingSectionRail label="이메일 섹션 접기" />);
  });
  const rail = ui.root.findByType('button');
  expect(rail.props['aria-label']).toBe('이메일 섹션 접기');
  expect(rail.props.className).toBe('briefing-section-rail');
  const event = {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    currentTarget: f.button,
  };
  act(() => rail.props.onClick(event));
  expect(event.preventDefault).toHaveBeenCalled();
  expect(f.block.open).toBe(false);
  expect(f.summary.focus).toHaveBeenCalled();
  const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  expect(css).toMatch(
    /\.briefing-section-rail \{[^}]*position: absolute;[^}]*left: -3px;[^}]*cursor: pointer;/,
  );
  expect(css).toContain('details.briefing-content-section:not([open]) > .briefing-section-rail');
});

it('closes an open paper from its left bar too, in the paper library and the briefing', () => {
  const html = renderToStaticMarkup(
    <PaperBriefingDisclosure title="Paper" keywords={[]}>
      <p>Paper detail</p>
    </PaperBriefingDisclosure>,
  );
  // The bar belongs to the open paper, not to its always-visible title row.
  const rail = /<button[^>]*class="briefing-section-rail briefing-item-rail"[^>]*>/.exec(html)?.[0];
  expect(rail).toContain('aria-label="이 논문 접기"');
  expect(html.indexOf(rail!)).toBeGreaterThan(html.indexOf('</summary>'));
  expect(html.indexOf(rail!)).toBeLessThan(html.indexOf('</details>'));
  const f = fixture();
  let ui!: ReturnType<typeof create>;
  act(() => {
    ui = create(<BriefingSectionRail label="이 논문 접기" className="briefing-item-rail" />);
  });
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: f.button };
  act(() => ui.root.findByType('button').props.onClick(event));
  expect(f.block.open).toBe(false);
  const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  expect(css).toMatch(/\.briefing-paper-disclosure \{[^}]*position: relative;/);
  expect(css).toMatch(
    /details\.briefing-paper-disclosure > \.briefing-item-rail \{[^}]*left: 0;[^}]*padding: 0;[^}]*border: 0;/,
  );
  expect(css).toContain('details.briefing-paper-disclosure:not([open]) > .briefing-item-rail');
});

it('closes the opened full summary text from a bar in its left gutter', () => {
  const source = readFileSync(new URL('./briefing-history-view.tsx', import.meta.url), 'utf8');
  // The bar sits inside the summary text disclosure, right after its title row.
  expect(source).toMatch(
    /<summary>전체 요약 문장 보기<\/summary>\s*<BriefingSectionRail\s+label="전체 요약 문장 접기"\s+className="briefing-narrative-rail"/u,
  );
  const f = fixture();
  let ui!: ReturnType<typeof create>;
  act(() => {
    ui = create(
      <BriefingSectionRail label="전체 요약 문장 접기" className="briefing-narrative-rail" />,
    );
  });
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: f.button };
  act(() => ui.root.findByType('button').props.onClick(event));
  expect(f.block.open).toBe(false);
  expect(f.summary.focus).toHaveBeenCalled();
  const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  expect(css).toMatch(/\.briefing-summary-narrative \{[^}]*position: relative;/);
  expect(css).toMatch(
    /details\.briefing-summary-narrative > \.briefing-narrative-rail \{[^}]*left: -12px;[^}]*padding: 0;[^}]*border: 0;/,
  );
  expect(css).toContain(
    'details.briefing-summary-narrative:not([open]) > .briefing-narrative-rail',
  );
});
