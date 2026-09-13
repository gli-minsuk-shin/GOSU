import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmailBriefingDisclosure, PaperBriefingDisclosure } from './briefing-insight-card';
import { BriefingBottomCollapse, collapseReadingBlock } from './briefing-disclosure-collapse';
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
