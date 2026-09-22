import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SavedPaperSummaries } from './saved-paper-summaries';
import { sourceRequest } from './live-client';
import { refreshBriefingSummary } from './briefing-analysis-client';
import { BriefingHistoryItem } from './briefing-history-view';
import { BriefingChat } from './briefing-chat';
import { initialRealWorkspace } from './workspace-defaults';
import { paperConversationKey } from './paper-identity';
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
  // The tag filter is a checkbox panel, not a dropdown. Naming the selects says that, and says
  // which ones are meant to be there, instead of counting them.
  expect(ui.root.findAllByType('select').map((n) => n.props['aria-label'])).toEqual([
    '자동 분류',
    '논문 정렬 기준',
  ]);
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
it("asks for a paper's own conversation instead of rendering one under the list", async () => {
  // The conversation lives in the right-hand pane now, in the AI 비서's slot. This screen's job is
  // to name the paper; rendering the chat here is what buried it under every card.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = initialRealWorkspace('2026-09-10T00:00:00Z').routines[0]!;
  const discussed = {
    ...tagPapers[0]!,
    item: { ...tagPapers[0]!.item, sourceUrl: 'https://arxiv.org/abs/2601.00001v1' },
    conversation: { turns: 2, lastAskedAt: '2026-09-22T01:00:00.000Z', lastQuestion: '가정은?' },
  };
  vi.mocked(sourceRequest).mockResolvedValue({ papers: [discussed, tagPapers[1]], feedback: {} });
  const onOpenChat = vi.fn();
  await act(() => {
    ui = create(
      <SavedPaperSummaries routineId={routine.id} routine={routine} onOpenChat={onOpenChat} />,
      { createNodeMock: (e) => (e.type === 'textarea' ? { focus: vi.fn() } : null) },
    );
  });
  const openButtons = () =>
    ui.root
      .findAllByProps({ className: 'briefing-paper-open-chat' })
      .filter((n) => n.props.onClick);

  // Each row offers its own conversation, and nothing is asked for until one is chosen.
  expect(openButtons()).toHaveLength(2);
  expect(onOpenChat).not.toHaveBeenCalled();

  await act(() => openButtons()[0]!.props.onClick());

  // The paper is named in full, including the link its conversation is keyed by.
  expect(onOpenChat).toHaveBeenCalledWith({
    routineId: routine.id,
    historyId: 'h',
    paperId: 'p1',
    title: 'Language study',
    sourceUrl: 'https://arxiv.org/abs/2601.00001v1',
  });
  // This screen owns no chat at all, so nothing here can mix with the AI 비서's.
  expect(ui.root.findAllByType(BriefingChat)).toHaveLength(0);
});

it('forwards the paper a card asked about, even when this screen mounts for it', async () => {
  // Pressing 「AI 질문」 on a paper card navigates here and asks for that paper in the same pass, so
  // this screen mounts and receives `openPaper` together.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = initialRealWorkspace('2026-09-10T00:00:00Z').routines[0]!;
  vi.mocked(sourceRequest).mockResolvedValue({ papers: tagPapers, feedback: {} });
  const asked = {
    routineId: routine.id,
    historyId: 'h',
    paperId: 'p2',
    title: 'Image study',
  };
  const onOpenChat = vi.fn();
  const onOpenedPaper = vi.fn();
  await act(() => {
    ui = create(
      <SavedPaperSummaries
        routineId={routine.id}
        routine={routine}
        openPaper={asked}
        onOpenChat={onOpenChat}
        onOpenedPaper={onOpenedPaper}
      />,
      { createNodeMock: (e) => (e.type === 'textarea' ? { focus: vi.fn() } : null) },
    );
  });

  expect(onOpenChat).toHaveBeenCalledWith(asked);
  expect(onOpenedPaper).toHaveBeenCalledOnce();

  // The request is consumed, so re-rendering without it never asks a second time.
  await act(() =>
    ui.update(
      <SavedPaperSummaries
        routineId={routine.id}
        routine={routine}
        onOpenChat={onOpenChat}
        onOpenedPaper={onOpenedPaper}
      />,
    ),
  );
  expect(onOpenChat).toHaveBeenCalledOnce();
});

it('asks for one conversation per paper, whichever of the two buttons requests it', async () => {
  // The row's 「AI 질의응답」 carried the paper's link and the card's own 「AI 질문」 did not. A paper
  // held by a briefing rather than the library is keyed by that link, so the same paper answered to
  // two different conversations depending on which button was pressed, and the questions asked
  // through one were nowhere to be seen from the other.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = initialRealWorkspace('2026-09-10T00:00:00Z').routines[0]!;
  const fromBriefing = {
    ...tagPapers[0]!,
    historyId: 'briefing-run-1',
    item: { ...tagPapers[0]!.item, sourceUrl: 'https://arxiv.org/abs/2601.00001v1' },
  };
  vi.mocked(sourceRequest).mockResolvedValue({ papers: [fromBriefing], feedback: {} });
  const onOpenChat = vi.fn();
  await act(() => {
    ui = create(
      <SavedPaperSummaries routineId={routine.id} routine={routine} onOpenChat={onOpenChat} />,
      { createNodeMock: (e) => (e.type === 'textarea' ? { focus: vi.fn() } : null) },
    );
  });

  const card = ui.root.findByType(BriefingHistoryItem).props.paperReference;
  await act(() =>
    ui.root
      .findAllByProps({ className: 'briefing-paper-open-chat' })
      .filter((n) => n.props.onClick)[0]!
      .props.onClick(),
  );
  const row = onOpenChat.mock.calls[0]![0];

  expect(paperConversationKey(row)).toBe('arxiv:2601.00001v1');
  expect(paperConversationKey(card)).toBe(paperConversationKey(row));
});

it('marks a paper the 논문 요약 AI was asked about on the card itself, not only in its tool strip', async () => {
  // A small counter in the row's tool strip is easy to miss in a library of a hundred cards. The
  // card now carries the mark beside its title and its box takes a different border, so a paper
  // that has been discussed is findable at a glance.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = initialRealWorkspace('2026-09-10T00:00:00Z').routines[0]!;
  const discussed = {
    ...tagPapers[0]!,
    conversation: { turns: 2, lastAskedAt: '2026-09-22T01:00:00.000Z', lastQuestion: '가정은?' },
  };
  vi.mocked(sourceRequest).mockResolvedValue({ papers: [discussed, tagPapers[1]], feedback: {} });
  await act(() => {
    ui = create(<SavedPaperSummaries routineId={routine.id} routine={routine} />, {
      createNodeMock: (e) => (e.type === 'textarea' ? { focus: vi.fn() } : null),
    });
  });

  // Exactly the discussed paper is flagged, and it is the one that was discussed.
  const flagged = ui.root.findAllByType(BriefingHistoryItem).filter((n) => n.props.askedAi);
  expect(flagged).toHaveLength(1);
  expect(flagged[0]!.props.item.id).toBe('p1');

  // The flag reaches the card's own box, so the border can change with it.
  const marked = ui.root
    .findAllByType('article')
    .filter((n) => String(n.props.className).includes('is-asked-ai'));
  expect(marked).toHaveLength(1);
  // ...and a mark sits beside the title, where the eye already goes.
  expect(ui.root.findAllByProps({ className: 'briefing-asked-ai-badge' })).toHaveLength(1);

  // Inside .briefing-reading-list every card gives up its own border, radius and shadow -- the list
  // draws one box and separates cards with a divider. A rule of the same specificity loaded later
  // therefore paints nothing, which is exactly what the first attempt did: the class was on the
  // element and the screen looked identical. The marker must out-specify that rule.
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const marker =
    /\.briefing-reading-list > \.briefing-card\.briefing-insight-card\.is-asked-ai[^}]*\{([^}]*)\}/u.exec(
      css,
    );
  expect(marker?.[1]).toContain('inset 3px 0 0');
  // Blue, not green: the page's own surfaces are green-tinted, so a green mark was the one colour
  // that could not stand out. Reported by the user after it shipped green.
  const bar = /inset 3px 0 0 (#[0-9a-f]{6})/u.exec(marker?.[1] ?? '')?.[1] ?? '';
  const channels = (hex: string) =>
    [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const [red, green, blue] = channels(bar);
  expect(blue).toBeGreaterThan(green!);
  expect(blue).toBeGreaterThan(red!);
});

it('filters the library to the papers the 논문 요약 AI was asked about, together with the other filters', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const discussed = {
    ...tagPapers[0]!,
    conversation: {
      updatedAt: '2026-09-22T01:00:00.000Z',
      turns: 3,
      entries: [
        {
          askedAt: '2026-09-22T01:00:00.000Z',
          question: '가정이 왜 필요해?',
          answer: '식별을 위해.',
        },
      ],
    },
  };
  const alsoDiscussed = {
    ...tagPapers[1]!,
    conversation: {
      updatedAt: '2026-09-22T02:00:00.000Z',
      turns: 1,
      entries: [{ askedAt: '2026-09-22T02:00:00.000Z', question: '한계는?', answer: '' }],
    },
  };
  vi.mocked(sourceRequest).mockResolvedValue({
    papers: [discussed, alsoDiscussed, tagPapers[2]],
    feedback: {},
  });
  await act(() => {
    ui = create(<SavedPaperSummaries routineId="r" />);
  });
  const toggle = () => ui.root.findByProps({ className: 'briefing-paper-asked-filter' });

  // Off by default, and the count says how many papers have a conversation.
  expect(shownIds()).toEqual(['p1', 'p2', 'p3']);
  expect(toggle().children.join('')).toContain('(2)');
  expect(toggle().props['aria-pressed']).toBe(false);

  await act(() => toggle().props.onClick());
  expect(shownIds()).toEqual(['p1', 'p2']);
  expect(
    ui.root.findByProps({ className: 'briefing-paper-asked-filter selected' }).props[
      'aria-pressed'
    ],
  ).toBe(true);

  // It intersects the text search rather than replacing it.
  await act(() =>
    ui.root
      .findByProps({ 'aria-label': '저장 논문 검색' })
      .props.onChange({ target: { value: 'Image' } }),
  );
  expect(shownIds()).toEqual(['p2']);
  await act(() =>
    ui.root
      .findByProps({ 'aria-label': '저장 논문 검색' })
      .props.onChange({ target: { value: 'Statistics' } }),
  );
  expect(shownIds()).toEqual([]);

  // A discussed paper is marked in the list with how many turns it had.
  await act(() =>
    ui.root
      .findByProps({ 'aria-label': '저장 논문 검색' })
      .props.onChange({ target: { value: '' } }),
  );
  expect(
    ui.root
      .findAllByProps({ className: 'briefing-paper-asked-mark' })
      .map((n) => n.props['aria-label']),
  ).toEqual(['AI 질의응답 3회', 'AI 질의응답 1회']);

  // Turning it off restores the whole library, and nothing called a source or a model.
  await act(() =>
    ui.root.findByProps({ className: 'briefing-paper-asked-filter selected' }).props.onClick(),
  );
  expect(shownIds()).toEqual(['p1', 'p2', 'p3']);
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
  // A paper nobody has opened builds no body: no figure, no typeset maths. That is the whole point
  // of deferring it -- thirty of these cards used to lay out about 8,900 tags before the reader had
  // opened one, and 242 of each card's 296 were this.
  expect(ui.root.findByType('details').props.open).toBeUndefined();
  expect(ui.root.findAllByType('img')).toHaveLength(0);
  expect(JSON.stringify(ui.toJSON())).not.toContain('katex');

  // Opening it builds the body, and everything the reader came for is there.
  await act(() => ui.root.findByType('details').props.onToggle({ currentTarget: { open: true } }));
  expect(ui.root.findByType('time').props.dateTime).toBe(item.provenance.summarizedAt);
  expect(ui.root.findByType('img').props.src).toBe(item.figures[0]!.imageData);
  expect(JSON.stringify(ui.toJSON())).toContain('katex');
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
    'papers',
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
it('exports the visible papers, then only the selected one, as a .bib download with no extra source call', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    papers: tagPapers.map((p, index) =>
      index
        ? p
        : {
            ...p,
            item: {
              ...p.item,
              sourceUrl: 'https://arxiv.org/abs/2405.01234v1',
              paperPublishedAt: '2024-05-02T00:00:00Z',
              bibliography: { authors: ['Ana Müller', 'Bo Li'], source: 'arXiv' },
            },
          },
    ),
    feedback: {},
  });
  await act(() => {
    ui = create(<SavedPaperSummaries routineId="r" />);
  });
  const blobs: Blob[] = [];
  const revoked: string[] = [];
  class UrlStub extends URL {
    static override createObjectURL = (blob: Blob) => `blob:${blobs.push(blob)}`;
    static override revokeObjectURL = (url: string) => void revoked.push(url);
  }
  const anchor = { href: '', download: '', click: vi.fn() };
  vi.stubGlobal('URL', UrlStub);
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor) });
  const exportButton = () =>
    ui.root.findAllByType('button').find((b) => b.children.join('').includes('BibTeX 내보내기'))!;
  expect(exportButton().children.join('')).toBe('BibTeX 내보내기 (3)');
  await act(() =>
    ui.root
      .findByProps({ 'aria-label': 'Language study 선택' })
      .props.onChange({ target: { checked: true } }),
  );
  expect(exportButton().children.join('')).toBe('BibTeX 내보내기 (1)');
  await act(() => exportButton().props.onClick());
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.href).toBe('blob:1');
  expect(anchor.download).toMatch(/^gosu-paper-summaries-\d{8}\.bib$/);
  expect(blobs[0]!.type).toBe('application/x-bibtex');
  expect(await blobs[0]!.text()).toBe(
    [
      '@misc{Muller2024Language,',
      '  title = {{Language study}},',
      '  author = {Ana Müller and Bo Li},',
      '  year = {2024},',
      '  eprint = {2405.01234},',
      '  archivePrefix = {arXiv},',
      '  url = {https://arxiv.org/abs/2405.01234v1}',
      '}',
      '',
    ].join('\n'),
  );
  const notice = () =>
    ui.root
      .findAllByProps({ role: 'status' })
      .find((n) => n.children.join('').includes('BibTeX 파일로 내보냈습니다'));
  expect(notice()?.children.join('')).toBe('1편을 BibTeX 파일로 내보냈습니다.');
  await act(() =>
    ui.root
      .findAllByType('button')
      .find((b) => b.children.join('').includes('선택 해제'))!
      .props.onClick(),
  );
  await act(() => exportButton().props.onClick());
  expect(await blobs[1]!.text()).toContain('@misc{PaperndImage,');
  expect(notice()?.children.join('')).toBe(
    '3편을 BibTeX 파일로 내보냈습니다. 이 중 2편은 저자나 연도 정보가 없습니다.',
  );
  expect(revoked).toEqual([]);
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/papers/saved']);
  expect(refreshBriefingSummary).not.toHaveBeenCalled();
});
