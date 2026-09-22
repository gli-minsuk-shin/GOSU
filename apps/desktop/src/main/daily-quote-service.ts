import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  builtInDailyQuote,
  type DailyQuote,
  type DailyQuoteLanguage,
} from '../../../briefing-lab/daily-quote';
import {
  DAILY_QUOTE_HISTORY_LIMIT,
  DAILY_QUOTE_MAX_ENTRIES,
  DAILY_QUOTE_REFRESH_LIMIT,
  DailyQuoteFileSchema,
  DailyQuoteHistorySchema,
  DailyQuoteViewSchema,
  type DailyQuoteEntry,
  type DailyQuoteFile,
  type DailyQuoteHistory,
  type DailyQuoteView,
} from '../shared/daily-quote-contracts';

const RETRY_AFTER_MS = 3 * 60 * 60_000;
const RECENT_QUOTES = 10;

export type DailyQuoteGenerator = (
  input: Readonly<{
    language: DailyQuoteLanguage;
    date: string;
    recent: readonly Pick<DailyQuote, 'text' | 'author'>[];
    /** Lines already written for this day, so each refresh is nudged to another subject. */
    written: number;
    /** Subjects the kept history already used, so a new line takes one it has not. */
    usedSubjects: readonly string[];
  }>,
  signal: AbortSignal,
) => Promise<DailyQuote>;

/** The user's own calendar day, not UTC: the quote changes at local midnight. */
export function localDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function failureCode(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return /^[a-z_]{3,64}$/u.test(message) ? message : 'daily_quote_failed';
}

/** How many of the newest lines are read for their subject, so a new one can take a free one. */
const RECENT_SUBJECTS = 13;

/** Lines written before refreshes existed have no `createdAt`; the day they belong to orders them. */
function writtenAt(entry: DailyQuoteEntry) {
  return entry.createdAt ?? entry.attemptedAt ?? `${entry.date}T00:00:00.000Z`;
}

/** Newest first, so the first entry of a day and language is the one the title bar shows. */
function byNewest(left: DailyQuoteEntry, right: DailyQuoteEntry) {
  return writtenAt(right).localeCompare(writtenAt(left)) || right.date.localeCompare(left.date);
}

/**
 * One quote per local day and language for the title bar, plus the ones the reader asked for by
 * hand. `today()` never throws and never waits for a model: it answers with what it has (a
 * built-in line until the model's line exists) and writes the model's line in the background. A
 * failure keeps the built-in line for the day, with its reason, and is retried after three hours.
 * `refresh()` writes one more line now, at most `DAILY_QUOTE_REFRESH_LIMIT` times a day; every
 * line that was ever shown stays in the file and is readable through `history()`.
 */
export class DailyQuoteService {
  private writing: Promise<unknown> = Promise.resolve();
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly options: Readonly<{
      path: string;
      language: () => DailyQuoteLanguage;
      /**
       * Asked on every call, because the model comes from Settings → Agent and can change while
       * GOSU runs. null: no model is assigned to lightweight tasks, so no model is asked.
       */
      generator: () => DailyQuoteGenerator | null | Promise<DailyQuoteGenerator | null>;
      now?: () => Date;
    }>,
  ) {}

  /** Resolves once no quote is being written; for tests and shutdown. */
  async idle() {
    await Promise.allSettled([...this.running.values()]);
    await this.writing.catch(() => undefined);
  }

  /**
   * Every line still stored, newest first, with the time it was written. Local display only: the
   * text came from a model, so it is never looked up in the message catalog.
   */
  async history(): Promise<DailyQuoteHistory> {
    let file: DailyQuoteFile;
    try {
      file = await this.read();
    } catch {
      return { entries: [] };
    }
    return DailyQuoteHistorySchema.parse({
      entries: [...file.entries]
        .sort(byNewest)
        .slice(0, DAILY_QUOTE_HISTORY_LIMIT)
        .map(({ attemptedAt: _attemptedAt, failure: _failure, ...entry }) => ({
          ...entry,
          createdAt: writtenAt(entry as DailyQuoteEntry),
        })),
    });
  }

  /**
   * One more line, now, because the reader asked. The attempt is counted before the model is
   * called, so a failed one also spends part of the day's allowance and GOSU cannot be made to
   * hammer the model. Past the allowance nothing is asked and the view says so; a failure leaves
   * the line that is showing in place instead of replacing it with a built-in one.
   */
  async refresh(): Promise<DailyQuoteView> {
    const now = (this.options.now ?? (() => new Date()))();
    const date = localDateKey(now);
    const language = this.options.language();
    const current = await this.today();
    if (current.capped || current.pending) return current;
    let file: DailyQuoteFile;
    try {
      file = await this.read();
    } catch {
      return current;
    }
    const generator = await Promise.resolve()
      .then(() => this.options.generator())
      .catch(() => null);
    if (!generator) return { ...current, failure: 'daily_quote_model_unassigned' };
    const key = `${date}:${language}`;
    if (this.running.has(key)) return { ...current, pending: true };
    await this.countRefresh(date).catch(() => undefined);
    const entry = this.entryOf(file, date, language);
    const run = this.write(generator, entry ?? this.fallback(date, language, [], null, null), {
      recent: this.recentOf(file, language),
      now,
      append: true,
      written: this.writtenOn(file, date, language),
      usedSubjects: this.usedSubjectsOf(file, language),
    }).finally(() => this.running.delete(key));
    this.running.set(key, run);
    const used = (await this.read().catch(() => file)).refreshes?.find(
      (item) => item.date === date,
    );
    return {
      ...current,
      pending: true,
      refreshesUsed: used?.count ?? current.refreshesUsed + 1,
      capped: (used?.count ?? current.refreshesUsed + 1) >= DAILY_QUOTE_REFRESH_LIMIT,
    };
  }

  async today(): Promise<DailyQuoteView> {
    const now = (this.options.now ?? (() => new Date()))();
    const date = localDateKey(now);
    const language = this.options.language();
    let file: DailyQuoteFile;
    try {
      file = await this.read();
    } catch {
      // A damaged file is left for the user to look at; the chrome still gets a line.
      return this.view(
        this.fallback(date, language, [], 'daily_quote_store_unreadable', now),
        false,
        0,
      );
    }
    const recent = this.recentOf(file, language);
    let entry = this.entryOf(file, date, language);
    // Reading the settings must not break the chrome either: no generator, built-in line.
    const generator = await Promise.resolve()
      .then(() => this.options.generator())
      .catch(() => null);
    if (!entry) {
      entry = this.fallback(
        date,
        language,
        recent,
        generator ? null : 'daily_quote_model_unassigned',
        null,
      );
      await this.save(entry).catch(() => undefined);
    }
    const key = `${date}:${language}`;
    const refreshesUsed = file.refreshes?.find((item) => item.date === date)?.count ?? 0;
    const retryDue =
      entry.source === 'builtin' &&
      (entry.attemptedAt === null ||
        now.getTime() - Date.parse(entry.attemptedAt) >= RETRY_AFTER_MS);
    if (generator && retryDue && !this.running.has(key)) {
      const run = this.write(generator, entry, {
        recent,
        now,
        written: this.writtenOn(file, date, language),
        usedSubjects: this.usedSubjectsOf(file, language),
      }).finally(() => this.running.delete(key));
      this.running.set(key, run);
    }
    return this.view(entry, this.running.has(key), refreshesUsed);
  }

  /** The line a day and language currently shows: the newest one written for it. */
  private entryOf(file: DailyQuoteFile, date: string, language: DailyQuoteLanguage) {
    return [...file.entries]
      .sort(byNewest)
      .find((item) => item.date === date && item.language === language);
  }

  /** The subjects the kept history already used, newest first, for the model to avoid. */
  private usedSubjectsOf(file: DailyQuoteFile, language: DailyQuoteLanguage) {
    return [...file.entries]
      .filter((entry) => entry.language === language)
      .sort(byNewest)
      .slice(0, RECENT_SUBJECTS)
      .map((entry) => entry.subject)
      .filter((subject): subject is string => typeof subject === 'string');
  }

  /** How many lines this day and language already hold, counting the built-in one it starts with. */
  private writtenOn(file: DailyQuoteFile, date: string, language: DailyQuoteLanguage) {
    return file.entries.filter((item) => item.date === date && item.language === language).length;
  }

  /** What the model must not repeat: the latest lines of that language, today's included. */
  private recentOf(file: DailyQuoteFile, language: DailyQuoteLanguage) {
    return [...file.entries]
      .filter((entry) => entry.language === language)
      .sort(byNewest)
      .slice(0, RECENT_QUOTES);
  }

  private async write(
    generate: DailyQuoteGenerator,
    current: DailyQuoteEntry,
    options: Readonly<{
      recent: readonly DailyQuoteEntry[];
      now: Date;
      append?: boolean;
      written?: number;
      usedSubjects?: readonly string[];
    }>,
  ) {
    const attemptedAt = options.now.toISOString();
    try {
      const quote = await generate(
        {
          language: current.language,
          date: current.date,
          recent: options.recent,
          written: options.written ?? 0,
          usedSubjects: options.usedSubjects ?? [],
        },
        AbortSignal.timeout(90_000),
      );
      await this.save(
        {
          ...current,
          ...quote,
          source: 'model',
          failure: null,
          attemptedAt,
          createdAt: attemptedAt,
        },
        options.append === true,
      );
    } catch (error) {
      // A failed refresh must not push the line that is showing out of the way, nor drop the
      // day's earlier lines: only that line's reason changes.
      if (options.append) {
        const failure = failureCode(error);
        await this.mutate((file) => ({
          ...file,
          entries: file.entries.map((item) =>
            writtenAt(item) === writtenAt(current) ? { ...item, failure } : item,
          ),
        })).catch(() => undefined);
        return;
      }
      await this.save({ ...current, failure: failureCode(error), attemptedAt }).catch(
        () => undefined,
      );
    }
  }

  /** Counts one hand-asked quote for `date`, keeping the last sixty days. */
  private countRefresh(date: string) {
    return this.mutate((file) => {
      const others = (file.refreshes ?? []).filter((item) => item.date !== date);
      const used = (file.refreshes ?? []).find((item) => item.date === date)?.count ?? 0;
      return {
        ...file,
        refreshes: [{ date, count: Math.min(1000, used + 1) }, ...others]
          .sort((left, right) => right.date.localeCompare(left.date))
          .slice(0, 60),
      };
    });
  }

  private fallback(
    date: string,
    language: DailyQuoteLanguage,
    recent: readonly Pick<DailyQuote, 'text'>[],
    failure: string | null,
    attemptedAt: Date | null,
  ): DailyQuoteEntry {
    return {
      date,
      language,
      ...builtInDailyQuote(language, date, recent),
      source: 'builtin',
      failure,
      attemptedAt: attemptedAt ? attemptedAt.toISOString() : null,
    };
  }

  private view(entry: DailyQuoteEntry, pending: boolean, refreshesUsed: number): DailyQuoteView {
    const { attemptedAt: _attemptedAt, ...visible } = entry;
    return DailyQuoteViewSchema.parse({
      ...visible,
      createdAt: writtenAt(entry),
      pending,
      refreshesUsed,
      refreshLimit: DAILY_QUOTE_REFRESH_LIMIT,
      capped: refreshesUsed >= DAILY_QUOTE_REFRESH_LIMIT,
    });
  }

  private async read(): Promise<DailyQuoteFile> {
    try {
      return DailyQuoteFileSchema.parse(JSON.parse(await readFile(this.options.path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: [] };
      throw new Error('daily_quote_store_unreadable', { cause: error });
    }
  }

  /**
   * `append` keeps the day's earlier lines, so a refreshed quote does not erase the one it
   * replaces; without it the day's line is rewritten in place, as it always was.
   */
  private save(entry: DailyQuoteEntry, append = false) {
    return this.mutate((file) => {
      const kept = append
        ? file.entries.filter((item) => writtenAt(item) !== writtenAt(entry))
        : file.entries.filter(
            (item) => !(item.date === entry.date && item.language === entry.language),
          );
      return {
        ...file,
        entries: [entry, ...kept].sort(byNewest).slice(0, DAILY_QUOTE_MAX_ENTRIES),
      };
    });
  }

  /** One writer at a time: read, change, write a whole new file atomically. */
  private mutate(change: (file: DailyQuoteFile) => DailyQuoteFile) {
    const operation = this.writing
      .catch(() => undefined)
      .then(async () => {
        const next = DailyQuoteFileSchema.parse(change(await this.read()));
        await mkdir(dirname(this.options.path), { recursive: true, mode: 0o700 });
        const temporary = `${this.options.path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
          await rename(temporary, this.options.path);
        } finally {
          await rm(temporary, { force: true });
        }
      });
    this.writing = operation;
    return operation;
  }
}
