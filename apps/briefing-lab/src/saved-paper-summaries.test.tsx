import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SavedPaperSummaries } from './saved-paper-summaries';
import { sourceRequest } from './live-client';
import { refreshBriefingSummary } from './briefing-analysis-client';
import { BriefingHistoryItem } from './briefing-history-view';
import { readFileSync } from 'node:fs';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
vi.mock('./briefing-analysis-client', () => ({ refreshBriefingSummary: vi.fn() }));
let ui: ReactTestRenderer;
const tagPapers = [
  ['p1', 'Language study', 'LLM'],
  ['p2', 'Image study', 'Diffusion models'],
  ['p3', 'Statistics study', 'Bayesian inference'],
].map(([id, title, tag]) => ({
  historyId: 'h',
  savedAt: '2026-09-09T00:00:00Z',
  item: { id, title, kind: 'papers', summary: 'Saved result', readScope: 'abstract', tags: [tag] },
}));
async function mountTags() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({ papers: tagPapers, feedback: {} });
  await act(() => {
    ui = create(<SavedPaperSummaries routineId="r" />);
  });
}
const shownIds = () => ui.root.findAllByType(BriefingHistoryItem).map((n) => n.props.item.id);
it('deletes only selected papers after confirmation and refreshes without inference', async () => {
  await mountTags();
  await act(() =>
    ui.root
      .findByProps({ 'aria-label': 'Language study 선택' })
      .props.onChange({ target: { checked: true } }),
  );
  const clickText = async (label: string) =>
    act(() =>
      ui.root
        .findAllByType('button')
        .find((b) => b.children.join('').includes(label))!
        .props.onClick(),
    );
  await clickText('선택 삭제');
  expect(ui.root.findByProps({ role: 'alertdialog' })).toBeTruthy();
  expect(sourceRequest).toHaveBeenCalledOnce();
  vi.mocked(sourceRequest).mockImplementation(async (path) =>
    path === '/papers/saved/delete' ? { deleted: 1 } : { papers: tagPapers.slice(1), feedback: {} },
  );
  await clickText('삭제 확인');
  expect(
    vi.mocked(sourceRequest).mock.calls.find((c) => c[0] === '/papers/saved/delete')?.[1],
  ).toEqual({
    routineId: 'r',
    confirmed: true,
    targets: [{ historyId: tagPapers[0]!.historyId, itemId: 'p1' }],
  });
  expect(shownIds()).toEqual(['p2', 'p3']);
  expect(refreshBriefingSummary).not.toHaveBeenCalled();
});
it('filters the whole library by separate summary/publication periods without source or LLM calls and clears only dates', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const papers = tagPapers.map((p, n) => ({
    ...p,
    item: {
      ...p.item,
      paperPublishedAt: n === 2 ? undefined : `2026-08-${n ? '20' : '10'}T00:00:00Z`,
      provenance: {
        version: 1,
        sourceDigest: 'a'.repeat(64),
        contextDigest: 'b'.repeat(64),
        summarizedAt: `2026-09-${n ? '09' : '10'}T00:00:00Z`,
        reused: true,
      },
    },
  }));
  vi.mocked(sourceRequest).mockResolvedValue({ papers, feedback: {} });
  await act(() => {
    ui = create(<SavedPaperSummaries routineId="r" />);
  });
  const change = async (label: string, value: string) =>
    act(() => ui.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } }));
  expect(ui.root.findAllByProps({ type: 'date' })).toHaveLength(4);
  await change('요약일 시작일', '2026-09-10');
  expect(shownIds()).toEqual(['p1']);
  await change('최초 공개일 시작일', '2026-08-15');
  expect(shownIds()).toEqual([]);
  await change('요약일 시작일', '');
  expect(shownIds()).toEqual(['p2']);
  await change('저장 논문 검색', 'study');
  await act(() =>
    ui.root
      .findAllByType('button')
      .find((b) => b.children.includes('기간 초기화'))!
      .props.onClick(),
  );
  expect(shownIds()).toEqual(['p1', 'p2', 'p3']);
  expect(ui.root.findByProps({ 'aria-label': '저장 논문 검색' }).props.value).toBe('study');
  expect(sourceRequest).toHaveBeenCalledOnce();
  expect(refreshBriefingSummary).not.toHaveBeenCalled();
});
const toggleTag = async (tag: string) => {
  const input = ui.root.findByProps({ 'aria-label': `태그: ${tag}` });
  await act(() => input.props.onChange({ target: { checked: !input.props.checked } }));
};
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('selects multiple tags in a checkbox panel with OR matching, and intersects text/category filters locally', async () => {
  await mountTags();
  expect(ui.root.findAllByType('select')).toHaveLength(1);
  await act(() => ui.root.findByProps({ 'aria-label': '논문 태그 선택' }).props.onClick());
  await toggleTag('Large language models');
  expect(shownIds()).toEqual(['p1']);
  await toggleTag('Diffusion models');
  expect(shownIds()).toEqual(['p1', 'p2']);
  expect(
    ui.root
      .findAllByProps({ type: 'checkbox' })
      .filter((n) => n.props['aria-label']?.startsWith('태그:')),
  ).toHaveLength(3);
  expect(ui.root.findAllByProps({ type: 'checkbox' }).filter((n) => n.props.checked)).toHaveLength(
    2,
  );
  await act(() =>
    ui.root
      .findByProps({ 'aria-label': '저장 논문 검색' })
      .props.onChange({ target: { value: 'Image' } }),
  );
  expect(shownIds()).toEqual(['p2']);
  await act(() =>
    ui.root
      .findByProps({ 'aria-label': '자동 분류' })
      .props.onChange({ target: { value: '통계·최적화' } }),
  );
  expect(shownIds()).toEqual([]);
  expect(sourceRequest).toHaveBeenCalledTimes(1);
  expect(refreshBriefingSummary).not.toHaveBeenCalled();
});
it('searches existing tag aliases without clearing hidden selections, and supports remove/clear/close', async () => {
  await mountTags();
  const trigger = () => ui.root.findByProps({ 'aria-label': '논문 태그 선택' });
  await act(() => trigger().props.onClick());
  await toggleTag('Diffusion models');
  await act(() =>
    ui.root.findByProps({ 'aria-label': '태그 검색' }).props.onChange({ target: { value: 'LLM' } }),
  );
  expect(
    ui.root
      .findAllByProps({ type: 'checkbox' })
      .filter((n) => n.props['aria-label']?.startsWith('태그:')),
  ).toHaveLength(1);
  await toggleTag('Large language models');
  expect(shownIds()).toEqual(['p1', 'p2']);
  const preventDefault = vi.fn();
  await act(() =>
    ui.root
      .findByProps({ className: 'briefing-paper-tag-filter' })
      .props.onKeyDown({ key: 'Escape', preventDefault }),
  );
  expect(trigger().props['aria-expanded']).toBe(false);
  expect(shownIds()).toEqual(['p1', 'p2']);
  await act(() =>
    ui.root.findByProps({ 'aria-label': 'Diffusion models 태그 해제' }).props.onClick(),
  );
  expect(shownIds()).toEqual(['p1']);
  await act(() => ui.root.findByProps({ 'aria-label': '선택한 태그 모두 해제' }).props.onClick());
  expect(shownIds()).toEqual(['p1', 'p2', 'p3']);
  await act(() => trigger().props.onClick());
  expect(ui.root.findByProps({ 'aria-label': '태그 검색' }).props.value).toBe('');
  expect(ui.root.findAllByProps({ type: 'checkbox' }).every((n) => !n.props.checked)).toBe(true);
});
it('keeps selection chips outside the anchored grid panel and shows a bounded rectangular layout', async () => {
  await mountTags();
  await act(() => ui.root.findByProps({ 'aria-label': '논문 태그 선택' }).props.onClick());
  await toggleTag('Large language models');
  expect(
    ui.root
      .findByProps({ className: 'briefing-paper-filters' })
      .findAllByProps({ 'aria-label': '선택한 태그' }),
  ).toHaveLength(0);
  expect(ui.root.findByProps({ 'aria-label': '선택한 태그' })).toBeTruthy();
  await act(() =>
    ui.root
      .findByProps({ 'aria-label': '태그 검색' })
      .props.onChange({ target: { value: 'no-existing-tag' } }),
  );
  expect(JSON.stringify(ui.toJSON())).toContain('검색한 태그가 없습니다.');
  expect(shownIds()).toEqual(['p1']);
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  expect(css).toMatch(/\.briefing-paper-tag-panel\s*\{[^}]*border-radius: 0;/);
  expect(css).toMatch(
    /\.briefing-paper-tag-grid\s*\{[^}]*grid-template-columns: repeat\(auto-fit,[^}]*max-height:[^}]*overflow-y: auto;/,
  );
  expect(css).toContain(".briefing-paper-tag-option[data-selected='true']");
});
it('resets the visible page when tags change without limiting search to the first 30 papers', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const papers = Array.from({ length: 65 }, (_, index) => ({
    ...tagPapers[0],
    item: {
      ...tagPapers[0]!.item,
      id: `p${index}`,
      tags: [index < 31 ? 'LLM' : 'Diffusion models'],
    },
  }));
  vi.mocked(sourceRequest).mockResolvedValue({ papers, feedback: {} });
  await act(() => {
    ui = create(<SavedPaperSummaries routineId="r" />);
  });
  await act(() =>
    ui.root
      .findAllByType('button')
      .find((n) => n.children.join('').includes('논문 더 보기'))!
      .props.onClick(),
  );
  expect(shownIds()).toHaveLength(60);
  await act(() => ui.root.findByProps({ 'aria-label': '논문 태그 선택' }).props.onClick());
  await toggleTag('Diffusion models');
  expect(shownIds()).toHaveLength(30);
  expect(shownIds()[0]).toBe('p31');
  expect(JSON.stringify(ui.toJSON())).toContain('34');
  expect(sourceRequest).toHaveBeenCalledTimes(1);
});
it('shows saved papers and their original date without source/LLM work; only the explicit icon forces a refresh', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const item = {
    id: 'p',
    title: 'Cached paper',
    equations: [{ latex: 'x^2', explanation: 'Stored equation' }],
    figures: [
      {
        id: 'f',
        caption: 'Stored figure',
        assetUrl: 'https://arxiv.org/html/2609.00001v1/figure.webp',
        imageData: 'data:image/webp;base64,UklGRg==',
      },
    ],
    kind: 'papers',
    summary: 'Saved result',
    readScope: 'abstract',
    importance: 'high',
    relevance: '',
    provenance: {
      version: 1,
      sourceDigest: 'a'.repeat(64),
      contextDigest: 'b'.repeat(64),
      summarizedAt: '2026-09-08T00:00:00Z',
      reused: true,
    },
  };
  vi.mocked(sourceRequest).mockResolvedValue({
    papers: [{ historyId: 'h', savedAt: '2026-09-09T00:00:00Z', item }],
    feedback: {},
  });
  await act(() => {
    ui = create(<SavedPaperSummaries routineId="r" />);
  });
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/papers/saved']);
  expect(refreshBriefingSummary).not.toHaveBeenCalled();
  expect(ui.root.findByType('time').props.dateTime).toBe(item.provenance.summarizedAt);
  expect(ui.root.findByType('img').props.src).toBe(item.figures[0]!.imageData);
  expect(JSON.stringify(ui.toJSON())).toContain('katex');
  expect(ui.root.findByType('details').props.open).toBeUndefined();
  await act(() =>
    ui.root
      .findByProps({ 'aria-label': '저장 논문 검색' })
      .props.onChange({ target: { value: 'missing-term' } }),
  );
  expect(ui.root.findAllByType('details')).toHaveLength(0);
  expect(JSON.stringify(ui.toJSON())).toContain('검색 조건에 맞는');
  await act(() =>
    ui.root
      .findByProps({ 'aria-label': '저장 논문 검색' })
      .props.onChange({ target: { value: 'Saved result' } }),
  );
  expect(ui.root.findAllByType('details')).toHaveLength(1);
  expect(sourceRequest).toHaveBeenCalledTimes(1);
  vi.mocked(refreshBriefingSummary).mockRejectedValueOnce(new Error('arXiv 제한 · 기존 요약 유지'));
  await act(async () =>
    ui.root.findByProps({ 'aria-label': '원문 다시 확인하고 재요약' }).props.onClick(),
  );
  expect(refreshBriefingSummary).toHaveBeenCalledWith(
    { routineId: 'r', historyId: 'h', itemId: 'p' },
    expect.any(AbortSignal),
    expect.any(Function),
  );
  expect(JSON.stringify(ui.toJSON())).toContain('Saved result');
  expect(JSON.stringify(ui.toJSON())).toContain('기존 요약 유지');
  vi.mocked(refreshBriefingSummary).mockResolvedValueOnce({ historyId: null } as Awaited<
    ReturnType<typeof refreshBriefingSummary>
  >);
  await act(async () =>
    ui.root.findByProps({ 'aria-label': '원문 다시 확인하고 재요약' }).props.onClick(),
  );
  expect(JSON.stringify(ui.toJSON())).toContain('새 요약을 저장하지 못해 이전 요약을 유지합니다');
  expect(sourceRequest).toHaveBeenCalledTimes(1);
  expect(ui.root.findByType('time').props.dateTime).toBe(item.provenance.summarizedAt);
});
