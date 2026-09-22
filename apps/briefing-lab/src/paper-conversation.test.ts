import { expect, it } from 'vitest';
import {
  appendPaperConversation,
  PAPER_CONVERSATION_ENTRIES,
  PAPER_CONVERSATION_ANSWER_MAX,
} from './paper-summary-contract';
import { savedLibraryPaperId } from './paper-identity';

const LIBRARY_ID = 'a'.repeat(64);

it('keeps the newest turns of a paper conversation while the total keeps counting', () => {
  let conversation = appendPaperConversation(undefined, {
    question: '이 논문의 결론은?',
    answer: '두 가정 아래에서 식별된다는 결론입니다.',
    askedAt: '2026-09-22T00:00:00.000Z',
  });
  expect(conversation).toMatchObject({ turns: 1, updatedAt: '2026-09-22T00:00:00.000Z' });

  for (let turn = 2; turn <= PAPER_CONVERSATION_ENTRIES + 5; turn += 1)
    conversation = appendPaperConversation(conversation, {
      question: `질문 ${turn}`,
      answer: `답변 ${turn}`,
      askedAt: `2026-09-22T00:${String(turn).padStart(2, '0')}:00.000Z`,
    });

  // Every turn is counted, so the row can say how much was discussed, but the kept list is bounded.
  expect(conversation.turns).toBe(PAPER_CONVERSATION_ENTRIES + 5);
  expect(conversation.entries).toHaveLength(PAPER_CONVERSATION_ENTRIES);
  expect(conversation.entries.at(-1)?.question).toBe(`질문 ${PAPER_CONVERSATION_ENTRIES + 5}`);
  expect(conversation.entries[0]?.question).toBe('질문 6');

  // A long answer is stored as an excerpt; the question is the user's own sentence and is kept.
  const long = appendPaperConversation(undefined, {
    question: '  자세히 설명해줘  ',
    answer: '가'.repeat(PAPER_CONVERSATION_ANSWER_MAX + 500),
    askedAt: '2026-09-22T02:00:00.000Z',
  });
  expect(long.entries[0]?.question).toBe('자세히 설명해줘');
  expect(long.entries[0]?.answer).toHaveLength(PAPER_CONVERSATION_ANSWER_MAX);

  // A turn that produced no answer text still records the question.
  expect(
    appendPaperConversation(undefined, {
      question: '이건?',
      answer: '',
      askedAt: '2026-09-22T03:00:00.000Z',
    }).entries[0],
  ).toMatchObject({ question: '이건?', answer: '' });

  // Nothing is recorded without a question: a blank one would produce an entry that says nothing.
  expect(() =>
    appendPaperConversation(undefined, {
      question: '   ',
      answer: '답변',
      askedAt: '2026-09-22T04:00:00.000Z',
    }),
  ).toThrow('paper_conversation_question_empty');
});

it('recognizes the library record a chat is about, and only that', () => {
  // A card in the 논문 요약 보관함 builds its chat button with an empty historyId.
  expect(savedLibraryPaperId({ historyId: '', paperId: LIBRARY_ID })).toBe(LIBRARY_ID);
  // sharedPaperView publishes the same record as 'shared:<id>'.
  expect(savedLibraryPaperId({ historyId: `shared:${LIBRARY_ID}`, paperId: LIBRARY_ID })).toBe(
    LIBRARY_ID,
  );
  // A paper from a briefing's own history is not in the library: nowhere to record a conversation.
  expect(savedLibraryPaperId({ historyId: '2026-09-22T00:00:00Z', paperId: 'discovered' })).toBe(
    null,
  );
  // Neither a short id, an uppercase one, nor a path is accepted as a record id.
  expect(savedLibraryPaperId({ historyId: '', paperId: 'abc' })).toBe(null);
  expect(savedLibraryPaperId({ historyId: '', paperId: 'A'.repeat(64) })).toBe(null);
  expect(savedLibraryPaperId({ historyId: 'shared:../../etc/passwd', paperId: '' })).toBe(null);
  expect(savedLibraryPaperId(undefined)).toBe(null);
});
