import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { prioritizeBriefingItems } from './briefing-intelligence';
import { importanceFirst, PaperChatButton, PaperChatReferenceSchema } from './paper-chat-reference';
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
    'Exact paper · AI 비서에게 질문',
  );
  expect(
    PaperChatReferenceSchema.safeParse({ ...reference, sourceUrl: 'file:///secret' }).success,
  ).toBe(false);
});
