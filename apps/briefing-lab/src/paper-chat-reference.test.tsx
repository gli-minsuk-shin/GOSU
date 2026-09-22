import { expect, it } from 'vitest';
import { act, create } from 'react-test-renderer';
import { vi } from 'vitest';
import { PaperBriefingDisclosure } from './briefing-insight-card';
import { renderToStaticMarkup } from 'react-dom/server';
import { prioritizeBriefingItems } from './briefing-intelligence';
import { importanceFirst, PaperChatButton, PaperChatReferenceSchema } from './paper-chat-reference';
it('keeps the paper action in the header and repeats the same reference at the expanded bottom', async () => {
  const reference = { routineId: 'r', historyId: 'h', paperId: 'p', title: 'Exact paper' };
  const view = (
    <PaperBriefingDisclosure
      title="Exact paper"
      keywords={[]}
      chatAction={<PaperChatButton reference={reference} />}
    >
      <p>Full analysis</p>
    </PaperBriefingDisclosure>
  );
  const html = renderToStaticMarkup(view);
  expect(html.match(/briefing-paper-chat-button/g)).toHaveLength(2);
  expect(html.indexOf('briefing-paper-chat-button')).toBeLessThan(html.indexOf('</summary>'));
  expect(html.lastIndexOf('briefing-paper-chat-button')).toBeGreaterThan(
    html.indexOf('Full analysis'),
  );
  expect(html.lastIndexOf('briefing-paper-chat-button')).toBeLessThan(
    html.indexOf('논문 요약 접기'),
  );
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', { dispatchEvent });
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(view);
    });
    const buttons = ui.root.findAllByProps({ className: 'briefing-paper-chat-button' });
    for (const button of buttons) {
      const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      await act(() => button.props.onClick(event));
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
    }
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
    expect(dispatchEvent.mock.calls.map(([event]) => event.detail)).toEqual([reference, reference]);
  } finally {
    if (ui) await act(() => ui.unmount());
    vi.unstubAllGlobals();
  }
});
it('does not fabricate an AI action for a paper without an available reference', () => {
  expect(
    renderToStaticMarkup(
      <PaperBriefingDisclosure title="Paper" keywords={[]}>
        Summary
      </PaperBriefingDisclosure>,
    ),
  ).not.toContain('briefing-paper-chat-button');
});
it('sorts importance stably without mutating input and leaves unknown last', () => {
  const input = ['low', 'high', 'medium', 'high', 'uncertain'];
  expect(importanceFirst(input, (v) => v)).toEqual(['high', 'high', 'medium', 'low', 'uncertain']);
  expect(input[0]).toBe('low');
  const items = input.map((importance, index) => ({
    id: String(index),
    kind: 'papers',
    importance,
  }));
  expect(
    prioritizeBriefingItems(items, {
      overview: '',
      items: items.map((i) => ({
        ...i,
        importance: i.importance as 'high' | 'medium' | 'low' | 'uncertain',
        summary: 'x',
        relevance: '',
        importanceReason: '',
        action: '',
        evidenceQuote: 'x',
        equationIds: [],
        figureIds: [],
        memorySuggestion: null,
        readScope: 'abstract',
      })),
    }).map((i) => i.importance),
  ).toEqual(['high', 'high', 'medium', 'low', 'uncertain']);
});
it('labels the paper action and rejects arbitrary context or URL injection', () => {
  const reference = { routineId: 'r', historyId: 'h', paperId: 'p', title: 'Exact paper' };
  expect(renderToStaticMarkup(<PaperChatButton reference={reference} />)).toContain(
    'Exact paper · 논문 요약 AI에게 질문',
  );
  expect(
    PaperChatReferenceSchema.safeParse({ ...reference, sourceUrl: 'file:///secret' }).success,
  ).toBe(false);
  for (const scheme of ['javascript:alert(1)', 'data:text/html,x', 'ftp://host/p', '/etc/passwd'])
    expect(PaperChatReferenceSchema.safeParse({ ...reference, sourceUrl: scheme }).success).toBe(
      false,
    );
  // A paper's own web link is carried, because it is what names that paper's conversation.
  expect(
    PaperChatReferenceSchema.safeParse({
      ...reference,
      sourceUrl: 'https://arxiv.org/abs/2601.12345v1',
    }).success,
  ).toBe(true);
});
