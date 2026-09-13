import { mkdtemp, readFile, rm, lstat, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, it, expect } from 'vitest';
import { BriefingMemoryStore } from './briefing-memory-store';
import { createCipheriv, randomBytes } from 'node:crypto';
const directories: string[] = [];
it('counts equivalent paper tag spellings once per vote without rewriting original feedback', async () => {
  const f = await fixture(),
    signal = new AbortController().signal;
  await f.store.feedback('r', source, 'important', signal, undefined, [
    'LLM',
    'large language models',
  ]);
  await f.store.feedback('r', { ...source, id: 'second' }, 'not-interested', signal, undefined, [
    '대규모 언어 모델',
  ]);
  const p = await f.store.feedbackProfile('r', false);
  expect(p.total).toBe(2);
  expect(p.preferredKeywords).toEqual([]);
  expect(p.avoidedKeywords).toEqual([]);
  expect((await f.store.review('r')).entries[0]?.feedbackKeywords).toEqual([
    'LLM',
    'large language models',
  ]);
});
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
const source = {
  id: 'paper',
  kind: 'papers' as const,
  title: 'Optimization paper',
  text: 'Source evidence',
  source: 'arXiv',
  readScope: 'abstract' as const,
  details: [],
};
const insight = {
  overview: 'Overview',
  items: [
    {
      id: 'paper',
      summary: 'A compact convergence summary',
      importance: 'high' as const,
      importanceReason: 'relevance',
      relevance: 'Optimization research',
      action: 'Read',
      evidenceQuote: 'Source evidence',
      equationIds: [],
      figureIds: [],
      memorySuggestion: 'A useful method',
    },
  ],
};
const interest = { keywords: [{ term: 'optimization', weight: 5, synonyms: [] }], excluded: [] };
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'gosu-briefing-memory-test-'));
  directories.push(dir);
  const key = async () => Buffer.alloc(32, 7);
  return { dir, key, store: new BriefingMemoryStore(dir, key) };
}
it('never downgrades private historical feedback when the same paper is rated from a public live result', async () => {
  const { store } = await fixture();
  const signal = new AbortController().signal;
  await store.feedback(
    'r',
    source,
    'important',
    signal,
    undefined,
    ['private context keyword'],
    true,
  );
  await store.feedback('r', source, 'not-interested', signal);
  expect((await store.review('r')).entries[0]!.private).toBe(true);
  expect((await store.feedbackProfile('r', false)).total).toBe(0);
});
it('versions feedback per routine without invalidating cache for automatic memory or identical votes', async () => {
  const { store, dir, key } = await fixture();
  const signal = new AbortController().signal;
  expect((await store.feedbackProfile('r')).feedbackProfileRevision).toBe(0);
  await store.feedback('r', source, 'important', signal);
  expect((await store.feedbackProfile('r')).feedbackProfileRevision).toBe(1);
  await store.record('r', [source], insight, interest, signal);
  await store.feedback('r', source, 'important', signal);
  await store.feedback('other', source, 'important', signal);
  expect((await store.feedbackProfile('r')).feedbackProfileRevision).toBe(1);
  await store.feedback('r', source, 'not-interested', signal);
  expect((await store.feedbackProfile('r')).feedbackProfileRevision).toBe(2);
  const review = await store.review('r');
  const entry = review.entries.find((e) => e.kind === 'feedback')!;
  await store.edit('r', entry.id, review.revision, 'Reviewed preference');
  expect((await store.feedbackProfile('r')).feedbackProfileRevision).toBe(3);
  await store.edit('r', entry.id, (await store.review('r')).revision, null);
  expect(
    (await new BriefingMemoryStore(dir, key).feedbackProfile('r')).feedbackProfileRevision,
  ).toBe(4);
  expect((await store.feedbackProfile('other')).feedbackProfileRevision).toBe(1);
});
it('loads legacy encrypted memory without resetting entries and initializes its feedback revision', async () => {
  const f = await fixture();
  await f.store.feedback('r', source, 'important', new AbortController().signal);
  const review = await f.store.review('r');
  const old = { version: 2, revision: review.revision, entries: review.entries, dismissed: [] };
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', await f.key(), iv);
  cipher.setAAD(Buffer.from('gosu-briefing-memory-v2'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(old)), cipher.final()]);
  await writeFile(
    join(f.dir, 'memory.v2.enc.json'),
    JSON.stringify({
      version: 2,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }),
  );
  const reopened = new BriefingMemoryStore(f.dir, f.key);
  expect((await reopened.feedbackProfile('r')).feedbackProfileRevision).toBe(0);
  expect((await reopened.review('r')).entries).toEqual(review.entries);
  await reopened.feedback('r', source, 'not-interested', new AbortController().signal);
  expect((await reopened.feedbackProfile('r')).feedbackProfileRevision).toBe(1);
});
it('remembers email decisions/actions without adding a forced research-connection sentence', async () => {
  const { store } = await fixture();
  await store.record(
    'r',
    [{ ...source, kind: 'email', readScope: 'mail-preview' }],
    insight,
    interest,
    new AbortController().signal,
  );
  const entries = await store.related('r', 'optimization');
  expect(entries.find((e) => e.kind === 'finding')?.text).not.toContain('연구 연결:');
  expect(entries.find((e) => e.kind === 'finding')?.text).toContain('Read');
});
it('retains private taint when a public-paper summary used private context', async () => {
  const { store } = await fixture();
  await store.record(
    'r',
    [source],
    insight,
    interest,
    new AbortController().signal,
    undefined,
    true,
  );
  const entries = await store.related('r', 'optimization');
  expect(entries.find((e) => e.kind === 'finding')?.private).toBe(true);
});
it('automatically stores summaries encrypted on the backend, reopens them, scopes retrieval and deduplicates later analyses', async () => {
  const f = await fixture();
  await f.store.record('r', [source], insight, interest, new AbortController().signal);
  const raw = await readFile(join(f.dir, 'memory.v2.enc.json'), 'utf8');
  expect(raw).not.toContain('convergence');
  expect((await lstat(join(f.dir, 'memory.v2.enc.json'))).mode & 0o777).toBe(0o600);
  const reopened = new BriefingMemoryStore(f.dir, f.key);
  expect(
    (await reopened.related('r', 'optimization')).some((e) => e.text.includes('convergence')),
  ).toBe(true);
  expect(await reopened.related('other', 'optimization')).toEqual([]);
  await reopened.record('r', [source], insight, interest, new AbortController().signal);
  expect((await reopened.status('r')).count).toBe(2);
});
it('serializes concurrent feedback, preserves manual corrections, and does not resurrect deleted automatic memories', async () => {
  const f = await fixture();
  await f.store.record('r', [source], insight, interest, new AbortController().signal);
  const review = await f.store.review('r'),
    entry = review.entries.find((e) => e.kind === 'finding')!;
  await f.store.edit('r', entry.id, review.revision, 'User corrected context');
  await f.store.record('r', [source], insight, interest, new AbortController().signal);
  expect((await f.store.review('r')).entries.find((e) => e.id === entry.id)!.text).toBe(
    'User corrected context',
  );
  await expect(f.store.edit('r', entry.id, review.revision, 'stale edit')).rejects.toThrow('stale');
  await Promise.all([
    f.store.feedback('r', source, 'important', new AbortController().signal),
    f.store.feedback(
      'other',
      { ...source, id: 'other' },
      'not-interested',
      new AbortController().signal,
    ),
  ]);
  const current = await f.store.review('r');
  await f.store.edit('r', entry.id, current.revision, null);
  await f.store.record('r', [source], insight, interest, new AbortController().signal);
  expect((await f.store.review('r')).entries.some((e) => e.id === entry.id)).toBe(false);
  expect((await f.store.review('other')).entries).toHaveLength(1);
});
it('stores structured feedback as a bounded preference profile without treating public paper feedback as private', async () => {
  const { store } = await fixture();
  await store.feedback(
    'r',
    { ...source, matchedKeywords: ['optimization', 'diffusion'] },
    'important',
    new AbortController().signal,
    undefined,
    ['diffusion models'],
  );
  await store.feedback(
    'r',
    { ...source, id: 'paper-2', matchedKeywords: ['optimization', 'classification'] },
    'not-interested',
    new AbortController().signal,
    undefined,
    ['classification'],
  );
  const profile = await store.feedbackProfile('r');
  expect(profile).toMatchObject({
    total: 2,
    important: 1,
    notInterested: 1,
    kindScores: { papers: 0, email: 0 },
  });
  expect(profile.preferredKeywords).toEqual([{ term: 'Diffusion models', score: 1 }]);
  expect(profile.avoidedKeywords).toEqual([{ term: 'classification', score: -1 }]);
  const feedback = (await store.review('r')).entries.filter((entry) => entry.origin === 'feedback');
  expect(feedback[0]).toMatchObject({
    private: false,
    feedbackDecision: 'important',
    feedbackItemKind: 'papers',
    feedbackKeywords: ['diffusion models'],
  });
});
it('preserves unreadable ciphertext, refuses symlinks and does not save cancelled or OTP messages', async () => {
  const f = await fixture();
  await f.store.record('r', [source], insight, interest, new AbortController().signal);
  const file = join(f.dir, 'memory.v2.enc.json'),
    before = await readFile(file, 'utf8');
  const bad = new BriefingMemoryStore(f.dir, async () => Buffer.alloc(32, 9));
  await expect(bad.status('r')).rejects.toThrow('unreadable');
  expect(await readFile(file, 'utf8')).toBe(before);
  const c = new AbortController();
  c.abort();
  await expect(f.store.record('r', [source], insight, interest, c.signal)).rejects.toThrow(
    'cancelled',
  );
  await f.store.record(
    'private',
    [{ ...source, kind: 'email', title: 'Your verification code' }],
    insight,
    interest,
    new AbortController().signal,
  );
  expect((await f.store.review('private')).entries.some((e) => e.kind === 'finding')).toBe(false);
  const link = join(f.dir, 'link');
  await symlink(f.dir, link);
  await expect(new BriefingMemoryStore(link, f.key).status('r')).rejects.toThrow('unsafe');
  await writeFile(file, 'corrupt');
  await expect(
    f.store.record('r', [source], insight, interest, new AbortController().signal),
  ).rejects.toThrow('unreadable');
  expect(await readFile(file, 'utf8')).toBe('corrupt');
});
it('rechecks private permission immediately before committing and preserves the previous file when revoked', async () => {
  const f = await fixture();
  await f.store.record('r', [source], insight, interest, new AbortController().signal);
  const path = join(f.dir, 'memory.v2.enc.json'),
    before = await readFile(path, 'utf8');
  let checks = 0;
  await expect(
    f.store.record('r', [source], insight, interest, new AbortController().signal, () => {
      if (++checks === 2) throw new Error('mail_scope_required');
    }),
  ).rejects.toThrow('scope_required');
  expect(await readFile(path, 'utf8')).toBe(before);
});
