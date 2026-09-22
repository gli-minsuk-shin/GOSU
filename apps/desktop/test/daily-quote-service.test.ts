import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DailyQuoteService,
  localDateKey,
  type DailyQuoteGenerator,
} from '../src/main/daily-quote-service';
import {
  DAILY_QUOTE_MAX_ENTRIES,
  DAILY_QUOTE_REFRESH_LIMIT,
  type DailyQuoteFile,
} from '../src/shared/daily-quote-contracts';

describe('daily quote service', () => {
  let directory = '';
  let path = '';
  let now = new Date(2026, 8, 22, 9, 0, 0);
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gosu-daily-quote-'));
    path = join(directory, 'daily-quote.v1.json');
    now = new Date(2026, 8, 22, 9, 0, 0);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function service(generate: DailyQuoteGenerator | null, language: () => 'ko' | 'en' = () => 'ko') {
    return new DailyQuoteService({ path, language, generator: () => generate, now: () => now });
  }
  const settled = (quotes: DailyQuoteService) => quotes.idle();

  it('shows a built-in line at once, then the line the model wrote, and keeps it for the day', async () => {
    const generate = vi.fn(async () => ({
      text: '마감은 영감의 어머니다.',
      author: null,
      tone: 'humor' as const,
      subject: 'everyday life' as const,
    }));
    const quotes = service(generate);

    const first = await quotes.today();
    expect(first).toMatchObject({
      date: '2026-09-22',
      language: 'ko',
      source: 'builtin',
      pending: true,
    });
    await settled(quotes);
    const second = await quotes.today();

    expect(second).toEqual({
      date: '2026-09-22',
      language: 'ko',
      text: '마감은 영감의 어머니다.',
      author: null,
      tone: 'humor',
      source: 'model',
      failure: null,
      pending: false,
      createdAt: new Date(now).toISOString(),
      subject: 'everyday life',
      refreshesUsed: 0,
      refreshLimit: DAILY_QUOTE_REFRESH_LIMIT,
      capped: false,
    });
    await quotes.today();
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await service(generate).today()).toEqual(second);
  });

  it('hands the model the last ten quotes of that language and writes a new one the next day', async () => {
    const seen: string[][] = [];
    let counter = 0;
    const generate = vi.fn(async (input: { recent: readonly { text: string }[] }) => {
      seen.push(input.recent.map(({ text }) => text));
      counter += 1;
      return {
        text: `오늘의 새 문장 ${counter}번입니다.`,
        author: null,
        tone: 'humor' as const,
        subject: 'everyday life' as const,
      };
    });
    const quotes = service(generate);
    for (let day = 0; day < 13; day += 1) {
      now = new Date(2026, 8, 1 + day, 9, 0, 0);
      await quotes.today();
      await settled(quotes);
    }

    expect(generate).toHaveBeenCalledTimes(13);
    expect(seen[12]).toHaveLength(10);
    expect(seen[12]?.[0]).toBe('오늘의 새 문장 12번입니다.');
    expect(seen[12]).not.toContain('오늘의 새 문장 2번입니다.');
  });

  it('keeps separate lines per language', async () => {
    let language: 'ko' | 'en' = 'ko';
    const generate = vi.fn(async (input: { language: 'ko' | 'en' }) =>
      input.language === 'ko'
        ? {
            text: '한국어 문장입니다.',
            author: null,
            tone: 'humor' as const,
            subject: 'everyday life' as const,
          }
        : {
            text: 'An English line.',
            author: null,
            tone: 'humor' as const,
            subject: 'everyday life' as const,
          },
    );
    const quotes = service(generate, () => language);
    await quotes.today();
    await settled(quotes);
    language = 'en';
    await quotes.today();
    await settled(quotes);

    expect((await quotes.today()).text).toBe('An English line.');
    language = 'ko';
    expect((await quotes.today()).text).toBe('한국어 문장입니다.');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('keeps the built-in line with the reason when the model fails, and tries again only after three hours', async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error('routine_timeout'))
      .mockResolvedValueOnce({
        text: '다시 성공한 문장입니다.',
        author: null,
        tone: 'humor',
        subject: 'everyday life',
      });
    const quotes = service(generate);

    await quotes.today();
    await settled(quotes);
    const failed = await quotes.today();
    expect(failed).toMatchObject({ source: 'builtin', failure: 'routine_timeout', pending: false });
    await settled(quotes);
    expect(generate).toHaveBeenCalledTimes(1);

    now = new Date(2026, 8, 22, 12, 30, 0);
    await quotes.today();
    await settled(quotes);
    expect((await quotes.today()).text).toBe('다시 성공한 문장입니다.');
  });

  it('does not ask a model at all when no model is assigned to lightweight tasks', async () => {
    const quotes = service(null);

    expect(await quotes.today()).toMatchObject({
      source: 'builtin',
      failure: 'daily_quote_model_unassigned',
      pending: false,
    });
  });

  it('never breaks the title bar over a damaged file, and leaves that file alone', async () => {
    await writeFile(path, '{broken');
    const generate = vi.fn(async () => ({
      text: '문장입니다 하나.',
      author: null,
      tone: 'humor' as const,
      subject: 'everyday life' as const,
    }));
    const quotes = service(generate);

    expect(await quotes.today()).toMatchObject({
      source: 'builtin',
      failure: 'daily_quote_store_unreadable',
      pending: false,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(await readFile(path, 'utf8')).toBe('{broken');
  });

  it('refreshes on request: a new line now, the old one kept, and neither repeated', async () => {
    let counter = 0;
    const seen: string[][] = [];
    const generate = vi.fn(async (input: { recent: readonly { text: string }[] }) => {
      seen.push(input.recent.map(({ text }) => text));
      counter += 1;
      return {
        text: `${counter}번째 문장입니다.`,
        author: null,
        tone: 'humor' as const,
        subject: 'everyday life' as const,
      };
    });
    const quotes = service(generate);
    await quotes.today();
    await settled(quotes);
    expect((await quotes.today()).text).toBe('1번째 문장입니다.');

    now = new Date(2026, 8, 22, 9, 5, 0);
    const started = await quotes.refresh();
    expect(started).toMatchObject({ pending: true, refreshesUsed: 1, capped: false });
    // The line that is showing stays until the new one is written; nothing blinks.
    expect(started.text).toBe('1번째 문장입니다.');
    await settled(quotes);

    const after = await quotes.today();
    expect(after).toMatchObject({
      text: '2번째 문장입니다.',
      source: 'model',
      pending: false,
      refreshesUsed: 1,
    });
    expect(after.createdAt).toBe(new Date(now).toISOString());
    // Today's earlier line is part of what the model must not repeat, and is still stored.
    expect(seen.at(-1)).toEqual(['1번째 문장입니다.']);
    const file = JSON.parse(await readFile(path, 'utf8')) as DailyQuoteFile;
    expect(file.entries.map((entry) => entry.text)).toEqual([
      '2번째 문장입니다.',
      '1번째 문장입니다.',
    ]);
    expect((await quotes.history()).entries.map((entry) => entry.text)).toEqual([
      '2번째 문장입니다.',
      '1번째 문장입니다.',
    ]);
  });

  it('gives the model a subject the kept history has not used, and records what it wrote about', async () => {
    const subjects: string[][] = [];
    let counter = 0;
    const generate = vi.fn(async (input: { usedSubjects: readonly string[]; written: number }) => {
      subjects.push([...input.usedSubjects]);
      counter += 1;
      return {
        text: `${counter}번째 문장입니다.`,
        author: null,
        tone: 'humor' as const,
        // The model answers with the subject it actually used, from the fixed list.
        subject: counter === 1 ? ('food and drink' as const) : ('travel and coming home' as const),
      };
    });
    const quotes = service(generate);
    await quotes.today();
    await settled(quotes);

    // The first call has nothing to avoid; the subject it reported is stored with the line.
    expect(subjects[0]).toEqual([]);
    expect(await quotes.today()).toMatchObject({ subject: 'food and drink' });

    now = new Date(2026, 8, 22, 10, 0, 0);
    await quotes.refresh();
    await settled(quotes);

    // The refresh is told what the history already covered, so it cannot repeat that subject.
    expect(subjects[1]).toEqual(['food and drink']);
    expect(await quotes.today()).toMatchObject({ subject: 'travel and coming home' });

    now = new Date(2026, 8, 22, 10, 5, 0);
    await quotes.refresh();
    await settled(quotes);
    expect(subjects[2]).toEqual(['travel and coming home', 'food and drink']);
  });

  it('refuses the eleventh quote of a day without asking a model, across restarts', async () => {
    let counter = 0;
    const generate = vi.fn(async () => {
      counter += 1;
      return {
        text: `${counter}번째 문장입니다.`,
        author: null,
        tone: 'humor' as const,
        subject: 'everyday life' as const,
      };
    });
    const quotes = service(generate);
    await quotes.today();
    await settled(quotes);

    for (let attempt = 0; attempt < DAILY_QUOTE_REFRESH_LIMIT; attempt += 1) {
      now = new Date(2026, 8, 22, 10, attempt, 0);
      await quotes.refresh();
      await settled(quotes);
    }
    const spent = generate.mock.calls.length;
    expect(spent).toBe(DAILY_QUOTE_REFRESH_LIMIT + 1);
    expect(await quotes.today()).toMatchObject({
      refreshesUsed: DAILY_QUOTE_REFRESH_LIMIT,
      refreshLimit: DAILY_QUOTE_REFRESH_LIMIT,
      capped: true,
    });

    now = new Date(2026, 8, 22, 11, 0, 0);
    const refused = await service(generate).refresh();
    expect(refused.capped).toBe(true);
    expect(generate).toHaveBeenCalledTimes(spent);

    // The next day starts over.
    now = new Date(2026, 8, 23, 9, 0, 0);
    const tomorrow = service(generate);
    expect(await tomorrow.today()).toMatchObject({ refreshesUsed: 0, capped: false });
    await settled(tomorrow);
  });

  it('keeps the line that is showing when a refresh fails, and still spends one of the day’s ten', async () => {
    let fail = false;
    const generate = vi.fn(async () => {
      if (fail) throw new Error('routine_timeout');
      return {
        text: '처음 쓴 문장입니다.',
        author: null,
        tone: 'humor' as const,
        subject: 'everyday life' as const,
      };
    });
    const quotes = service(generate);
    await quotes.today();
    await settled(quotes);

    fail = true;
    now = new Date(2026, 8, 22, 9, 30, 0);
    await quotes.refresh();
    await settled(quotes);

    const after = await quotes.today();
    expect(after).toMatchObject({
      text: '처음 쓴 문장입니다.',
      source: 'model',
      failure: 'routine_timeout',
      refreshesUsed: 1,
    });
    const file = JSON.parse(await readFile(path, 'utf8')) as DailyQuoteFile;
    expect(file.entries).toHaveLength(1);
  });

  it('reads a history written before refreshes existed, ordering it by the day it belongs to', async () => {
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        entries: [
          {
            date: '2026-09-21',
            language: 'ko',
            text: '어제의 문장입니다.',
            author: '아무개',
            tone: 'wisdom',
            source: 'model',
            failure: null,
            attemptedAt: null,
          },
          {
            date: '2026-09-20',
            language: 'ko',
            text: '그제의 문장입니다.',
            author: null,
            tone: 'humor',
            source: 'model',
            failure: null,
            attemptedAt: null,
          },
        ],
      }),
      'utf8',
    );

    const history = await service(null).history();

    expect(history.entries.map(({ text, createdAt }) => [text, createdAt])).toEqual([
      ['어제의 문장입니다.', '2026-09-21T00:00:00.000Z'],
      ['그제의 문장입니다.', '2026-09-20T00:00:00.000Z'],
    ]);
    expect(history.entries[0]).not.toHaveProperty('failure');
  });

  it('keeps at most the stored maximum of entries', async () => {
    const generate = vi.fn(async (input: { date: string }) => ({
      text: `문장 ${input.date} 입니다.`,
      author: null,
      tone: 'humor' as const,
      subject: 'everyday life' as const,
    }));
    const quotes = service(generate);
    for (let day = 0; day < DAILY_QUOTE_MAX_ENTRIES + 10; day += 1) {
      now = new Date(2026, 0, 1 + day, 9, 0, 0);
      await quotes.today();
      await settled(quotes);
    }

    const file = JSON.parse(await readFile(path, 'utf8')) as DailyQuoteFile;
    expect(file.entries).toHaveLength(DAILY_QUOTE_MAX_ENTRIES);
    expect(file.entries[0]?.date).toBe(localDateKey(now));
  });
});
