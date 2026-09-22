import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { answersFromSavedPapers } from './briefing-chat';
import { asksPaperLibraryQuestion } from './paper-summary-contract';

it('offers to save a paper analysis only when the answer read a paper that is not in the library yet', () => {
  // 2026-09-21: a question about a paper already in the library still showed "보관함에 추가할까요?".
  const saved = { kind: 'paper', saved: true };
  const fresh = { kind: 'paper' };
  expect(answersFromSavedPapers([saved])).toBe(true);
  expect(answersFromSavedPapers([saved, { kind: 'email' }, saved])).toBe(true);
  // A new paper next to a saved one keeps the offer; so does an answer with no paper source at all
  // (the question itself may name a paper the assistant only discussed).
  expect(answersFromSavedPapers([saved, fresh])).toBe(false);
  expect(answersFromSavedPapers([fresh])).toBe(false);
  expect(answersFromSavedPapers([{ kind: 'email' }])).toBe(false);
  expect(answersFromSavedPapers([])).toBe(false);
});

it('recognizes the library question the assistant asks in its own words, not quoted or ordinary text', () => {
  expect(
    asksPaperLibraryQuestion(
      '요약입니다.\n\n이 설명도 Briefing Lab 논문 요약 라이브러리에 추가할까요?',
    ),
  ).toBe(true);
  expect(asksPaperLibraryQuestion('이 분석을 논문 요약 보관함에 저장할까요？')).toBe(true);
  for (const other of [
    '이 논문은 provenance graph를 다룹니다.',
    '일정을 캘린더에 추가할까요?',
    '> 이 설명도 Briefing Lab 논문 요약 라이브러리에 추가할까요?',
    '```\n이 설명도 Briefing Lab 논문 요약 라이브러리에 추가할까요?\n```',
  ])
    expect(asksPaperLibraryQuestion(other)).toBe(false);
  // The chat shows the offer for a saved paper only when the answer asked, and then offers that paper.
  // Compared without line breaks: the formatter wraps this condition when its nesting changes.
  const chat = readFileSync(new URL('./briefing-chat.tsx', import.meta.url), 'utf8').replace(
    /\s+/gu,
    ' ',
  );
  expect(chat).toContain(
    '(asksPaperLibraryQuestion(m.text) || !answersFromSavedPapers(m.result.sources)) && (',
  );
  expect(chat).toContain('asked={asksPaperLibraryQuestion(m.text)}');
  expect(chat).toContain('(!s.saved || asksPaperLibraryQuestion(m.text))');
});
