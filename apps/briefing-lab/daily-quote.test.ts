import { describe, expect, it, vi } from 'vitest';
import {
  DAILY_QUOTE_SUBJECTS,
  builtInDailyQuote,
  dailyQuoteKey,
  dailyQuoteSubject,
  writeDailyQuote,
  type DailyQuote,
} from './daily-quote';

const selection = {
  providerId: 'claude-code' as const,
  modelId: 'claude-code:sonnet-5',
  reasoning: 'off',
};
const answer = (value: unknown) =>
  vi.fn(async () => ({ answer: JSON.stringify(value), proposal: null }));
const recent: Pick<DailyQuote, 'text' | 'author' | 'tone'>[] = [
  { text: '가장 좋은 논문은 끝낸 논문이다.', author: null, tone: 'humor' },
  {
    text: 'All models are wrong, but some are useful.',
    author: 'George E. P. Box',
    tone: 'wisdom',
  },
];

describe('daily quote job', () => {
  it('asks a tool-less structured question with the recent quotes and returns a clean one-liner', async () => {
    const run = answer({
      text: '  "마감은 영감의 어머니다."  ',
      author: null,
      tone: 'humor',
      subject: 'work and research',
    });

    const quote = await writeDailyQuote(
      { language: 'ko', date: '2026-09-22', recent },
      selection,
      new AbortController().signal,
      run as never,
    );

    expect(quote).toEqual({
      text: '마감은 영감의 어머니다.',
      author: null,
      tone: 'humor',
      subject: 'work and research',
    });
    const [request, , , options] = run.mock.calls[0] as unknown as [
      Record<string, unknown>,
      unknown,
      unknown,
      {
        timeoutMs: number;
        structuredJob: { instructions: string; prompt: string; tools?: unknown };
      },
    ];
    expect(request).toMatchObject({ ...selection, history: [], previousProposal: null });
    expect(options.structuredJob.tools).toBeUndefined();
    expect(options.timeoutMs).toBeLessThanOrEqual(60_000);
    expect(options.structuredJob.instructions).toContain('Korean');
    expect(options.structuredJob.instructions).toContain('author to null');
    // The reader is a researcher, so work is the one subject that has to be held back.
    expect(options.structuredJob.instructions).toContain('one day in three');
    expect(JSON.parse(options.structuredJob.prompt)).toEqual({
      date: '2026-09-22',
      language: 'ko',
      suggestedSubject: dailyQuoteSubject('2026-09-22'),
      subjects: [...DAILY_QUOTE_SUBJECTS],
      avoidSubjects: [],
      recentQuotes: recent.map(({ text, author }) => ({ text, author })),
    });
    // A refresh asks for another subject, and the model is told not to reuse the recent shapes.
    expect(options.structuredJob.instructions).toContain('their sentence shape');
  });

  it('suggests a different subject each day and asks about work only now and then', () => {
    const days = Array.from({ length: 60 }, (_, offset) =>
      new Date(Date.UTC(2026, 8, 22) + offset * 86_400_000).toISOString().slice(0, 10),
    );
    const subjects = days.map((date) => dailyQuoteSubject(date));

    expect(new Set(subjects).size).toBe(DAILY_QUOTE_SUBJECTS.length);
    expect(subjects.every((subject, index) => index === 0 || subject !== subjects[index - 1])).toBe(
      true,
    );
    expect(subjects.filter((subject) => subject === 'work and research').length * 3).toBeLessThan(
      subjects.length,
    );
    // The same day always suggests the same subject.
    expect(dailyQuoteSubject('2026-09-22')).toBe(dailyQuoteSubject('2026-09-22'));
  });

  it('moves the subject on with every line written that day, not only with the date', () => {
    const date = '2026-09-22';
    const first = dailyQuoteSubject(date);
    const eight = Array.from({ length: 8 }, (_, written) => dailyQuoteSubject(date, written));

    // A day's refreshes used to share one subject, which produced eight variations of one joke.
    expect(eight[0]).toBe(first);
    expect(new Set(eight).size).toBe(8);
    // Deterministic: the same day and the same count always suggest the same subject.
    expect(dailyQuoteSubject(date, 3)).toBe(eight[3]);
    // A count past the list wraps instead of failing.
    expect(DAILY_QUOTE_SUBJECTS).toContain(
      dailyQuoteSubject(date, DAILY_QUOTE_SUBJECTS.length + 2),
    );
    for (const odd of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])
      expect(DAILY_QUOTE_SUBJECTS).toContain(dailyQuoteSubject(date, odd));
  });

  it('keeps built-in lines about life, not only about the lab', () => {
    const lab =
      /논문|실험실|심사위원|코딩|최적화|모델|thesis|lab|reviewer|coding|optimization|models|cache|machine/iu;
    for (const language of ['ko', 'en'] as const) {
      const pool = Array.from({ length: 400 }, (_, offset) =>
        builtInDailyQuote(
          language,
          new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10),
          [],
        ),
      );
      const distinct = [...new Map(pool.map((quote) => [quote.text, quote])).values()];
      expect(distinct.length).toBeGreaterThanOrEqual(20);
      expect(distinct.filter((quote) => !lab.test(quote.text)).length * 2).toBeGreaterThan(
        distinct.length,
      );
    }
  });

  it('refuses a repeat, the wrong language, a line break and an overlong line', async () => {
    const signal = new AbortController().signal;
    const attempt = (value: unknown, language: 'ko' | 'en' = 'ko') =>
      writeDailyQuote(
        { language, date: '2026-09-22', recent },
        selection,
        signal,
        answer(value) as never,
      );

    await expect(
      attempt({
        text: '가장 좋은 논문은, 끝낸 논문이다!',
        author: null,
        tone: 'humor',
        subject: 'everyday life',
      }),
    ).rejects.toThrow('daily_quote_repeated');
    await expect(
      attempt({
        text: 'Deadlines are the mother of inspiration.',
        author: null,
        tone: 'humor',
        subject: 'everyday life',
      }),
    ).rejects.toThrow('daily_quote_wrong_language');
    await expect(
      attempt(
        { text: '마감은 영감의 어머니다.', author: null, tone: 'humor', subject: 'everyday life' },
        'en',
      ),
    ).rejects.toThrow('daily_quote_wrong_language');
    await expect(
      attempt({
        text: `첫 줄
둘째 줄입니다`,
        author: null,
        tone: 'humor',
        subject: 'everyday life',
      }),
    ).rejects.toThrow('daily_quote_invalid');
    await expect(
      attempt({ text: '가'.repeat(120), author: null, tone: 'humor', subject: 'everyday life' }),
    ).rejects.toThrow('daily_quote_invalid');
  });

  it('has a built-in quote for every day in both languages that avoids the recent ones', () => {
    const seen = new Set<string>();
    for (let day = 1; day <= 28; day += 1) {
      const date = `2026-09-${String(day).padStart(2, '0')}`;
      const korean = builtInDailyQuote('ko', date, []);
      const english = builtInDailyQuote('en', date, []);
      expect(/[가-힣]/u.test(korean.text)).toBe(true);
      expect(/[가-힣]/u.test(english.text)).toBe(false);
      seen.add(korean.text);
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
    const first = builtInDailyQuote('ko', '2026-09-22', []);
    expect(builtInDailyQuote('ko', '2026-09-22', [])).toEqual(first);
    expect(builtInDailyQuote('ko', '2026-09-22', [first]).text).not.toBe(first.text);
  });

  it('treats punctuation, case and spacing as the same quote', () => {
    expect(dailyQuoteKey('  All models are wrong,  but some are USEFUL. ')).toBe(
      dailyQuoteKey('all models are wrong but some are useful'),
    );
  });
});
