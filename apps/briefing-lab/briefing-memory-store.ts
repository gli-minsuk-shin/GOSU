import { isCredentialMail } from './briefing-credential-mail';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { InterestProfile } from '@gosu/briefing-core';
import {
  BriefingMemoryEntrySchema,
  relatedBriefingMemory,
  type BriefingInsight,
} from './src/briefing-intelligence';
import type { LiveItem } from './src/live-types';
import { systemBriefingKey } from './briefing-system-key';
import { assignPaperTags, buildPaperTagCatalog, paperTagKey } from './src/paper-tags';
import { senderAddress } from './src/briefing-guidance';
/** Preferred and avoided keywords, senders and sender domains each keep this many entries. */
export const FEEDBACK_PROFILE_LIMIT = 24;
/** Personal webmail: a shared domain says nothing about an institution. */
const PERSONAL_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'naver.com',
  'daum.net',
  'hanmail.net',
  'kakao.com',
  'nate.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
]);
export const StoredMemoryEntrySchema = BriefingMemoryEntrySchema.extend({
  origin: z.enum(['automatic', 'feedback', 'reviewed']),
  private: z.boolean(),
  sourceUrl: z.string().optional(),
  feedbackDecision: z.enum(['important', 'not-interested']).optional(),
  feedbackItemKind: z.enum(['papers', 'email']).optional(),
  feedbackTitle: z.string().max(1000).optional(),
  feedbackKeywords: z.array(z.string().max(120)).max(12).optional(),
});
export type StoredMemoryEntry = z.infer<typeof StoredMemoryEntrySchema>;
export type FeedbackDecision = 'important' | 'not-interested';
const StoreSchema = z
  .object({
    version: z.literal(2),
    revision: z.number().int().nonnegative(),
    feedbackProfileRevisions: z.record(z.string(), z.number().int().nonnegative()).default({}),
    entries: z.array(StoredMemoryEntrySchema).max(1000),
    dismissed: z.array(z.string().max(512)).max(1000),
  })
  .strict();
type State = z.infer<typeof StoreSchema>;
const empty = (): State => ({
  version: 2,
  revision: 0,
  feedbackProfileRevisions: {},
  entries: [],
  dismissed: [],
});
// Automatic summary writes must not invalidate preference-dependent caches. Ignore timestamps/IDs
// so repeating the same vote is a no-op, but include reviewed/deleted/imported feedback changes.
function feedbackFingerprints(entries: StoredMemoryEntry[]) {
  const routines = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.kind !== 'feedback' && entry.origin !== 'feedback') continue;
    const { id: _id, createdAt: _at, ...value } = StoredMemoryEntrySchema.parse(entry);
    const values = routines.get(entry.routineId) ?? [];
    values.push(
      JSON.stringify(
        Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
      ),
    );
    routines.set(entry.routineId, values);
  }
  return new Map([...routines].map(([id, values]) => [id, JSON.stringify(values.sort())]));
}
const identity = (entry: { routineId: string; sourceId: string; kind: string }) =>
  JSON.stringify([entry.routineId, entry.kind, entry.sourceId]);
export const secretPattern =
  /(?:-----BEGIN [\w ]*PRIVATE KEY-----|\b(?:sk-[\w-]{16,}|Bearer\s+[\w.-]{20,})|(?:password|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S{8,})/i;
export class BriefingMemoryStore {
  readonly directory: string;
  private key: Buffer | undefined;
  private keyLoading: Promise<Buffer> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    directory = join(homedir(), 'Library', 'Application Support', 'GOSU', 'briefing-lab'),
    private readonly loadKey: (directory: string) => Promise<Buffer> = systemBriefingKey,
  ) {
    this.directory = directory;
  }
  private async cryptoKey() {
    if (this.key) return this.key;
    if (!this.keyLoading)
      this.keyLoading = this.loadKey(this.directory)
        .then((key) => {
          this.key = key;
          return key;
        })
        .finally(() => {
          this.keyLoading = undefined;
        });
    return this.keyLoading;
  }
  private async read(): Promise<State> {
    try {
      const directory = await lstat(this.directory);
      if (!directory.isDirectory() || directory.isSymbolicLink())
        throw new Error('briefing_memory_path_unsafe');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
      throw error;
    }
    const path = join(this.directory, 'memory.v2.enc.json');
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 12_000_000)
        throw new Error('briefing_memory_path_unsafe');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
      throw error;
    }
    try {
      const envelope = z
        .object({ version: z.literal(2), iv: z.string(), tag: z.string(), ciphertext: z.string() })
        .strict()
        .parse(JSON.parse(await readFile(path, 'utf8')));
      const decipher = createDecipheriv(
        'aes-256-gcm',
        await this.cryptoKey(),
        Buffer.from(envelope.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from('gosu-briefing-memory-v2'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      return StoreSchema.parse(
        JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
            decipher.final(),
          ]).toString('utf8'),
        ),
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('briefing_memory_keychain'))
        throw error;
      throw new Error('briefing_memory_unreadable', { cause: error });
    }
  }
  private mutate<T>(
    fn: (state: State) => T,
    signal?: AbortSignal,
    beforeCommit?: () => void | Promise<void>,
  ): Promise<T> {
    const pending = this.queue.then(async () => {
      if (signal?.aborted) throw new Error('source_cancelled');
      await beforeCommit?.();
      const state = await this.read();
      const before = feedbackFingerprints(state.entries);
      const result = fn(state);
      const after = feedbackFingerprints(state.entries);
      for (const routine of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(routine) !== after.get(routine))
          state.feedbackProfileRevisions[routine] =
            (state.feedbackProfileRevisions[routine] ?? 0) + 1;
      }
      state.revision++;
      StoreSchema.parse(state);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('briefing_memory_path_unsafe');
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', await this.cryptoKey(), iv);
      cipher.setAAD(Buffer.from('gosu-briefing-memory-v2'));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(state), 'utf8'),
        cipher.final(),
      ]);
      if (signal?.aborted) throw new Error('source_cancelled');
      const temporary = join(this.directory, `memory-${randomUUID()}.tmp`);
      try {
        await writeFile(
          temporary,
          JSON.stringify({
            version: 2,
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
            ciphertext: ciphertext.toString('base64'),
          }),
          { mode: 0o600, flag: 'wx' },
        );
        if (signal?.aborted) throw new Error('source_cancelled');
        await beforeCommit?.();
        await rename(temporary, join(this.directory, 'memory.v2.enc.json'));
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      return result;
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  async status(routineId: string) {
    await this.queue;
    const state = await this.read(),
      entries = state.entries.filter((e) => e.routineId === routineId);
    return {
      state: 'ready' as const,
      count: entries.length,
      automatic: entries.filter((e) => e.origin === 'automatic').length,
      feedbackImportant: entries.filter((e) => e.feedbackDecision === 'important').length,
      feedbackNotInterested: entries.filter((e) => e.feedbackDecision === 'not-interested').length,
      revision: state.revision,
      feedbackProfileRevision: state.feedbackProfileRevisions[routineId] ?? 0,
      lastSavedAt:
        entries
          .map((e) => e.createdAt)
          .sort()
          .at(-1) ?? null,
    };
  }
  async related(routineId: string, query: string) {
    await this.queue;
    const state = await this.read();
    return relatedBriefingMemory(
      { version: 1, entries: state.entries },
      routineId,
      query,
    ) as StoredMemoryEntry[];
  }
  /**
   * `senderOf` finds the sender of a rated email by its item id in the saved briefings, so ratings
   * (including ones saved before senders were used) teach which people and institutions matter.
   */
  async feedbackProfile(
    routineId: string,
    includePrivate = true,
    senderOf?: (itemId: string) => string | undefined,
  ) {
    await this.queue;
    const state = await this.read();
    const entries = state.entries
      .filter((entry) => entry.routineId === routineId && entry.origin === 'feedback')
      .filter((entry) => includePrivate || !entry.private)
      .filter(
        (
          entry,
        ): entry is StoredMemoryEntry & {
          feedbackDecision: FeedbackDecision;
          feedbackItemKind: 'papers' | 'email';
        } => Boolean(entry.feedbackDecision && entry.feedbackItemKind),
      );
    const keywordScores = new Map<string, { term: string; score: number; count: number }>();
    const senderScores = new Map<string, number>();
    const domainScores = new Map<string, number>();
    const kindScores = { papers: 0, email: 0 };
    const tagCatalog = buildPaperTagCatalog(
      entries
        .filter((e) => e.feedbackItemKind === 'papers')
        .map((e) => ({ keywords: e.feedbackKeywords })),
    );
    for (const entry of entries) {
      const sign = entry.feedbackDecision === 'important' ? 1 : -1;
      kindScores[entry.feedbackItemKind] += sign;
      if (entry.feedbackItemKind === 'email' && senderOf) {
        const address = senderAddress(senderOf(entry.sourceId.slice('feedback:'.length)));
        if (address) {
          senderScores.set(address, (senderScores.get(address) ?? 0) + sign);
          const domain = address.slice(address.lastIndexOf('@') + 1);
          if (!PERSONAL_MAIL_DOMAINS.has(domain))
            domainScores.set(domain, (domainScores.get(domain) ?? 0) + sign);
        }
      }
      const seen = new Set<string>();
      for (const raw of entry.feedbackKeywords ?? []) {
        const term =
          entry.feedbackItemKind === 'papers'
            ? (assignPaperTags([raw], tagCatalog, false)[0] ?? raw).normalize('NFKC').trim()
            : raw.normalize('NFKC').trim();
        if (!term) continue;
        const key =
          entry.feedbackItemKind === 'papers' ? paperTagKey(term) : term.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const current = keywordScores.get(key) ?? { term, score: 0, count: 0 };
        current.score += sign;
        current.count++;
        keywordScores.set(key, current);
      }
    }
    const keywords = [...keywordScores.values()].sort(
      (a, b) => b.score - a.score || b.count - a.count || a.term.localeCompare(b.term),
    );
    const ranked = (scores: Map<string, number>, sign: 1 | -1) =>
      [...scores]
        .filter(([, score]) => score * sign > 0)
        .sort(([a, x], [b, y]) => (y - x) * sign || a.localeCompare(b))
        .slice(0, FEEDBACK_PROFILE_LIMIT)
        .map(([term, score]) => ({ term, score }));
    return {
      feedbackProfileRevision: state.feedbackProfileRevisions[routineId] ?? 0,
      total: entries.length,
      hasPrivateFeedback: entries.some((entry) => entry.private),
      important: entries.filter((entry) => entry.feedbackDecision === 'important').length,
      notInterested: entries.filter((entry) => entry.feedbackDecision === 'not-interested').length,
      kindScores,
      preferredKeywords: keywords
        .filter((entry) => entry.score > 0)
        .slice(0, FEEDBACK_PROFILE_LIMIT)
        .map(({ term, score }) => ({ term, score })),
      avoidedKeywords: keywords
        .filter((entry) => entry.score < 0)
        .slice(0, FEEDBACK_PROFILE_LIMIT)
        .map(({ term, score }) => ({ term, score })),
      preferredSenders: ranked(senderScores, 1),
      avoidedSenders: ranked(senderScores, -1),
      preferredSenderDomains: ranked(domainScores, 1),
      avoidedSenderDomains: ranked(domainScores, -1),
    };
  }
  async review(routineId: string) {
    await this.queue;
    const state = await this.read();
    return {
      revision: state.revision,
      entries: state.entries.filter((e) => e.routineId === routineId),
    };
  }
  async feedbackChoices(routineId: string, itemIds: readonly string[]) {
    await this.queue;
    const state = await this.read();
    const allowed = new Set(itemIds.map((id) => `feedback:${id}`));
    return Object.fromEntries(
      state.entries
        .filter(
          (e) =>
            e.routineId === routineId &&
            e.origin === 'feedback' &&
            allowed.has(e.sourceId) &&
            e.feedbackDecision,
        )
        .map((e) => [e.sourceId.slice('feedback:'.length), e.feedbackDecision!]),
    ) as Record<string, FeedbackDecision>;
  }
  async record(
    routineId: string,
    items: readonly LiveItem[],
    insights: BriefingInsight,
    interest: InterestProfile,
    signal: AbortSignal,
    beforeCommit?: () => void | Promise<void>,
    privateContext = false,
  ) {
    return this.mutate(
      (state) => {
        let saved = 0;
        const touched = new Set<string>();
        const now = new Date().toISOString();
        const candidates: StoredMemoryEntry[] = [
          {
            id: randomUUID(),
            routineId,
            kind: 'preference',
            text: `루틴에 설정된 연구 관심사: ${interest.keywords.map((k) => k.term).join(', ')}. 제외: ${interest.excluded.join(', ')}`.slice(
              0,
              4000,
            ),
            sourceId: 'routine-interest',
            createdAt: now,
            origin: 'automatic',
            private: false,
          },
        ];
        for (const insight of insights.items) {
          const item = items.find((i) => i.id === insight.id);
          if (!item) continue;
          const text =
            `AI가 정리한 이전 브리핑 · ${item.readScope} · 사실 검증 자료가 아님\n${item.title}\n${insight.summary}${item.kind === 'papers' && insight.relevance ? `\n연구 연결: ${insight.relevance}` : ''}${item.kind === 'email' ? `\n중요한 이유: ${insight.importanceReason}\n다음 행동: ${insight.action}` : ''}${insight.memorySuggestion ? `\n기억 요약: ${insight.memorySuggestion}` : ''}`.slice(
              0,
              4000,
            );
          if (secretPattern.test(text) || isCredentialMail(item)) continue;
          candidates.push({
            id: randomUUID(),
            routineId,
            kind: 'finding',
            text,
            sourceId: `analysis:${item.id}`,
            createdAt: now,
            origin: 'automatic',
            private: privateContext || item.kind === 'email' || item.privateOrigin === 'mail',
            ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
          });
        }
        for (const candidate of candidates) {
          if (secretPattern.test(candidate.text)) continue;
          const key = identity(candidate);
          if (state.dismissed.includes(key)) continue;
          const previous = state.entries.find((e) => identity(e) === key);
          if (previous?.origin === 'reviewed') continue;
          state.entries = state.entries.filter((e) => identity(e) !== key);
          state.entries.push({ ...candidate, id: previous?.id ?? candidate.id });
          touched.add(identity(candidate));
          saved++;
        }
        while (state.entries.length > 1000) {
          const at = state.entries.findIndex((e) => e.origin === 'automatic');
          if (at < 0) throw new Error('briefing_memory_limit');
          state.entries.splice(at, 1);
        }
        const retained = state.entries.filter((entry) => touched.has(identity(entry))).length;
        if (saved > 0 && retained === 0) throw new Error('briefing_memory_limit');
        saved = retained;
        return { saved, revision: state.revision + 1 };
      },
      signal,
      beforeCommit,
    );
  }
  async feedback(
    routineId: string,
    item: LiveItem,
    decision: FeedbackDecision | null,
    signal: AbortSignal,
    beforeCommit?: () => void | Promise<void>,
    keywords: readonly string[] = item.matchedKeywords ?? [],
    privateContext = false,
  ) {
    return this.mutate(
      (state) => {
        const sourceId = `feedback:${item.id}`;
        const previous = state.entries.find(
          (e) => e.routineId === routineId && e.sourceId === sourceId,
        );
        state.entries = state.entries.filter(
          (e) => !(e.routineId === routineId && e.sourceId === sourceId),
        );
        if (decision === null) return;
        state.entries.push({
          id: previous?.id ?? randomUUID(),
          routineId,
          kind: 'feedback',
          text: `사용자 피드백(개인 선호 신호, 사실 아님): ${
            decision === 'important' ? '중요함' : '관심 없음'
          } · ${item.kind === 'papers' ? '논문' : '이메일'} · ${item.title} · 키워드: ${keywords.join(', ')}`.slice(
            0,
            4000,
          ),
          sourceId,
          createdAt: new Date().toISOString(),
          origin: 'feedback',
          private:
            Boolean(previous?.private) ||
            privateContext ||
            item.kind === 'email' ||
            item.privateOrigin === 'mail',
          ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
          feedbackDecision: decision,
          feedbackItemKind: item.kind === 'email' ? 'email' : 'papers',
          feedbackTitle: item.title.slice(0, 1000),
          feedbackKeywords: keywords.slice(0, 12),
        });
        if (state.entries.length > 1000) {
          const at = state.entries.findIndex((e) => e.origin === 'automatic');
          if (at < 0) throw new Error('briefing_memory_limit');
          state.entries.splice(at, 1);
        }
      },
      signal,
      beforeCommit,
    );
  }
  async edit(
    routineId: string,
    id: string,
    revision: number,
    text: string | null,
    signal?: AbortSignal,
  ) {
    return this.mutate((state) => {
      if (state.revision !== revision) throw new Error('briefing_memory_stale');
      const entry = state.entries.find((e) => e.routineId === routineId && e.id === id);
      if (!entry) throw new Error('briefing_memory_missing');
      if (text === null) {
        state.entries = state.entries.filter((e) => e !== entry);
        state.dismissed = [...new Set([...state.dismissed, identity(entry)])].slice(-1000);
      } else {
        if (!text.trim() || text.length > 4000 || secretPattern.test(text))
          throw new Error('briefing_memory_text_invalid');
        entry.text = text.trim();
        entry.origin = 'reviewed';
        entry.private = true;
        entry.createdAt = new Date().toISOString();
      }
    }, signal);
  }
  async importEntries(
    routineId: string,
    entries: readonly z.infer<typeof BriefingMemoryEntrySchema>[],
    signal?: AbortSignal,
  ) {
    return this.mutate((state) => {
      for (const value of entries) {
        const entry = BriefingMemoryEntrySchema.parse(value);
        if (entry.routineId !== routineId || secretPattern.test(entry.text))
          throw new Error('briefing_memory_scope_invalid');
        state.entries = state.entries.filter((e) => identity(e) !== identity(entry));
        state.entries.push({ ...entry, origin: 'reviewed', private: true });
      }
      if (state.entries.length > 1000) throw new Error('briefing_memory_limit');
    }, signal);
  }
}
