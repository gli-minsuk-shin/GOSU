import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import {
  BriefingWorkspaceStore,
  isPapersPageScope,
  paperConversationScope,
  paperTurns,
} from './briefing-workspace-store';
import { briefingClientContext } from './briefing-client-context';
import { conversationDigest } from './briefing-context';
it('retains the same client identity across page/backend restart while refreshing the process token', async () => {
  const saved = new Map<string, string>();
  let processToken = 'a'.repeat(64);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url, options) =>
        new Response(
          JSON.stringify({
            token: processToken,
            clientToken: options.headers['X-Gosu-Client-Token'],
          }),
        ),
    ),
  );
  try {
    vi.resetModules();
    const first = await (
      await import('./src/briefing-client-session')
    ).briefingHeaders(new AbortController().signal);
    processToken = 'b'.repeat(64);
    vi.resetModules();
    const restarted = await (
      await import('./src/briefing-client-session')
    ).briefingHeaders(new AbortController().signal);
    expect(restarted['X-Gosu-Client-Token']).toBe(first['X-Gosu-Client-Token']);
    expect(restarted['X-Gosu-Routine-Token']).not.toBe(first['X-Gosu-Routine-Token']);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('restores encrypted conversations on a new store instance, preserving order, scope and unrelated preferences', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gosu-conversation-'));
  const owner = <T>(fn: () => T) => briefingClientContext.run('a'.repeat(64), fn);
  const make = () => new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7));
  try {
    const first = make();
    const profile = await owner(() =>
      first.save(
        {
          routineId: 'r',
          name: 'fixture',
          timeZone: 'Asia/Seoul',
          live: defaultLiveSettings(),
          interest: { keywords: [], excluded: [] },
          preferences: defaultAssistantPreferences(),
        },
        async () => undefined,
      ),
    );
    const messages = [
      {
        role: 'user' as const,
        text: 'Remember fixture context',
        createdAt: '2026-09-13T00:00:00Z',
      },
      {
        role: 'assistant' as const,
        text: 'Preserved response',
        createdAt: '2026-09-13T00:00:01Z',
        invocation: { providerId: 'codex', model: 'fixture-model', reasoning: 'high' },
      },
    ];
    await owner(() => first.appendConversation(profile, messages[0]!));
    await owner(() => first.appendConversation(profile, messages[1]!));
    const restarted = make();
    expect(await owner(() => restarted.conversation(profile))).toEqual(messages);
    expect((await restarted.profile('r'))?.preferences).toEqual(profile.preferences);
    await expect(restarted.conversation(profile)).rejects.toThrow('assistant_settings_changed');
    await expect(
      owner(() =>
        restarted.conversation({
          ...profile,
          preferences: { ...profile.preferences, providerId: 'claude-code' },
        }),
      ),
    ).rejects.toThrow('assistant_settings_changed');
    const file = join(dir, 'workspace.v1.enc.json');
    const checkpoint = {
      through: messages.length,
      digest: conversationDigest(messages),
      summary: 'Untrusted historical summary',
      createdAt: '2026-09-13T00:00:02Z',
    };
    await owner(() => restarted.saveConversationCheckpoint(profile, checkpoint));
    expect(await owner(() => make().conversationCheckpoint(profile))).toEqual(checkpoint);
    expect(await owner(() => make().conversation(profile))).toEqual(messages);
    const { approvedScope: _approved, updatedAt: _updated, owners: _owners, ...settings } = profile;
    const changed = await owner(() =>
      restarted.save(
        { ...settings, preferences: { ...settings.preferences, providerId: 'claude-code' } },
        async () => undefined,
      ),
    );
    // An owner can view their previous chat locally without transmitting it under new permissions.
    expect(await owner(() => make().conversation(changed))).toEqual([]);
    expect(await owner(() => make().conversationDisplay(changed))).toEqual({
      messages,
      otherScopeMessages: messages.length,
    });
    await expect(make().conversationDisplay(changed)).rejects.toThrow('assistant_settings_changed');
    await owner(() => restarted.save({ ...settings, routineId: 'second' }, async () => undefined));
    await owner(() => restarted.save({ ...settings }, async () => undefined));
    expect((await make().desktopConfiguration()).selectedRoutineId).toBe('r');
    await expect(
      owner(() =>
        restarted.saveConversationCheckpoint(profile, { ...checkpoint, digest: 'b'.repeat(64) }),
      ),
    ).rejects.toThrow('assistant_compaction_stale');
    const ciphertext = await readFile(file, 'utf8');
    expect(ciphertext).not.toContain('Remember fixture context');
    await writeFile(file, '{corrupted');
    await expect(owner(() => make().conversation(profile))).rejects.toThrow(
      'briefing_memory_unreadable',
    );
    expect(await readFile(file, 'utf8')).toBe('{corrupted');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('/new starts an empty model context but keeps every record for the screen and for search', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gosu-conversation-new-'));
  const owner = <T>(fn: () => T) => briefingClientContext.run('a'.repeat(64), fn);
  const make = () => new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7));
  try {
    const store = make();
    const profile = await owner(() =>
      store.save(
        {
          routineId: 'r',
          name: 'fixture',
          timeZone: 'Asia/Seoul',
          live: defaultLiveSettings(),
          interest: { keywords: [], excluded: [] },
          preferences: defaultAssistantPreferences(),
        },
        async () => undefined,
      ),
    );
    // Nothing to set aside yet: the command reports that instead of drawing an empty divider.
    expect(await owner(() => store.startNewConversationContext(profile))).toEqual({
      started: false,
      contextStartedAt: '',
      setAside: 0,
    });
    const before = [
      { role: 'user' as const, text: 'old question', createdAt: '2026-09-13T00:00:00Z' },
      { role: 'assistant' as const, text: 'old answer', createdAt: '2026-09-13T00:00:01Z' },
    ];
    for (const message of before) await owner(() => store.appendConversation(profile, message));
    await owner(() =>
      store.saveConversationCheckpoint(profile, {
        through: 2,
        digest: conversationDigest(before),
        summary: 'summary of the old context',
        createdAt: '2026-09-13T00:00:02Z',
      }),
    );
    const started = await owner(() => store.startNewConversationContext(profile));
    expect(started).toMatchObject({ started: true, setAside: 2 });
    expect(Number.isFinite(Date.parse(started.contextStartedAt))).toBe(true);
    // A second /new on an already empty context changes nothing and keeps the first divider.
    expect(await owner(() => store.startNewConversationContext(profile))).toEqual({
      started: false,
      contextStartedAt: started.contextStartedAt,
      setAside: 0,
    });
    const restarted = make();
    expect(await owner(() => restarted.conversation(profile))).toEqual([]);
    // The old summary described the context that ended; it must not come back under the new one.
    expect(await owner(() => restarted.conversationCheckpoint(profile))).toBeUndefined();
    expect((await owner(() => restarted.conversationDisplay(profile))).messages).toEqual(before);
    const after = [
      { role: 'user' as const, text: 'new question', createdAt: new Date().toISOString() },
      { role: 'assistant' as const, text: 'new answer', createdAt: new Date().toISOString() },
    ];
    for (const message of after) await owner(() => restarted.appendConversation(profile, message));
    expect(await owner(() => restarted.conversation(profile))).toEqual(after);
    expect(await owner(() => restarted.conversationDisplay(profile))).toEqual({
      messages: [...before, ...after],
      otherScopeMessages: 0,
      contextStartedAt: started.contextStartedAt,
    });
    // Checkpoints count from the start of the current context, exactly like the model's list.
    const checkpoint = {
      through: 2,
      digest: conversationDigest(after),
      summary: 'summary of the new context',
      createdAt: new Date().toISOString(),
    };
    await owner(() => restarted.saveConversationCheckpoint(profile, checkpoint));
    expect(await owner(() => make().conversationCheckpoint(profile))).toEqual(checkpoint);
    await expect(
      owner(() =>
        restarted.saveConversationCheckpoint(profile, {
          ...checkpoint,
          digest: conversationDigest(before),
        }),
      ),
    ).rejects.toThrow('assistant_compaction_stale');
    await expect(restarted.startNewConversationContext(profile)).rejects.toThrow(
      'assistant_settings_changed',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('keeps one 논문 요약 conversation for the page while still recording which paper each turn was about', async () => {
  // One thread per paper made a conversation hard to find again and tedious to keep up: asking about
  // a second paper abandoned the first. 논문 요약 now holds a single conversation for the page, and a
  // paper is something a turn carries rather than something that forks the transcript. What must not
  // change is that it is still not the AI 비서's thread, and that the list still knows which papers
  // have been discussed -- the card's mark, the 「AI 질의응답」 filter and the index the other three
  // chats read all hang off that.
  const dir = await mkdtemp(join(tmpdir(), 'papers-page-conversation-'));
  try {
    const owner = <T>(fn: () => T) => briefingClientContext.run('a'.repeat(64), fn);
    const store = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 5));
    const settings = {
      routineId: 'r',
      name: 'fixture',
      timeZone: 'Asia/Seoul',
      live: defaultLiveSettings(),
      interest: { keywords: [], excluded: [] },
      preferences: defaultAssistantPreferences(),
    };
    const profile = await owner(() => store.save(settings, async () => undefined));
    const first = 'arxiv:2601.12345v1';
    const second = 'arxiv:2601.99999v1';
    const at = (n: number) => `2026-09-22T00:0${n}:00.000Z`;

    await owner(() =>
      store.appendConversation(profile, { role: 'user', text: '메일 요약', createdAt: at(0) }),
    );
    await owner(() =>
      store.appendConversation(
        profile,
        { role: 'user', text: '이 논문은?', createdAt: at(1) },
        { paperKey: first },
      ),
    );
    await owner(() =>
      store.appendConversation(
        profile,
        { role: 'user', text: '저 논문은?', createdAt: at(2) },
        { paperKey: second },
      ),
    );

    // One thread holds both turns, in order. Which paper was asked about no longer picks a thread.
    expect(
      (await owner(() => store.conversation(profile, { paperKey: first }))).map((m) => m.text),
    ).toEqual(['이 논문은?', '저 논문은?']);
    expect(
      (await owner(() => store.conversation(profile, { paperKey: second }))).map((m) => m.text),
    ).toEqual(['이 논문은?', '저 논문은?']);

    // And it is still not the assistant's, which is the whole point of the separation.
    expect((await owner(() => store.conversation(profile))).map((m) => m.text)).toEqual([
      '메일 요약',
    ]);

    // Both papers still read as discussed, each with its own turn.
    expect(
      await owner(() => store.paperConversationCounts(profile, [first, second, 'arxiv:other'])),
    ).toEqual({
      [first]: { turns: 1, lastAskedAt: at(1), lastQuestion: '이 논문은?' },
      [second]: { turns: 1, lastAskedAt: at(2), lastQuestion: '저 논문은?' },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('reads a paper\u2019s turns from both shapes, so conversations written before the page held one still count', async () => {
  // Real installs already hold conversations written one thread per paper. Moving 논문 요약 to a
  // single page conversation must not make them stop counting or stop appearing in the index the
  // other three chats read. They are the user's records: read, never rewritten and never merged
  // into the page transcript.
  const paperScope = (profileScope: string, key: string) =>
    paperConversationScope(profileScope, key);
  const old = 'arxiv:2601.11111v1';
  const fresh = 'arxiv:2601.22222v1';
  const at = (n: number) => `2026-09-22T00:0${n}:00.000Z`;
  const stored = [
    // The old shape: the scope names the paper and the turns carry nothing.
    {
      scope: paperScope('profile', old),
      messages: [
        { role: 'user' as const, text: '예전 질문', createdAt: at(1) },
        { role: 'assistant' as const, text: '예전 답', createdAt: at(2) },
      ],
    },
    // The page transcript: one thread, each turn naming its own paper.
    {
      scope: 'profile:paper:page',
      messages: [
        { role: 'user' as const, text: '새 질문', createdAt: at(3), paperKey: fresh },
        { role: 'user' as const, text: '다른 논문 질문', createdAt: at(4), paperKey: old },
      ],
    },
    // The assistant's own thread never belongs to either.
    {
      scope: 'profile',
      messages: [{ role: 'user' as const, text: '메일 요약', createdAt: at(5) }],
    },
  ];

  expect(isPapersPageScope('profile:paper:page')).toBe(true);
  expect(isPapersPageScope(paperScope('profile', old))).toBe(false);
  expect(isPapersPageScope('profile')).toBe(false);

  // The old paper is read from both shapes at once, in time order.
  expect(paperTurns(stored, old).map((m) => m.text)).toEqual([
    '예전 질문',
    '예전 답',
    '다른 논문 질문',
  ]);
  // A paper asked about only after the change reads only its own turn, not the whole page.
  expect(paperTurns(stored, fresh).map((m) => m.text)).toEqual(['새 질문']);
  // A paper never discussed reads nothing, and the assistant's turns never leak in.
  expect(paperTurns(stored, 'arxiv:never')).toEqual([]);
});

it('keeps a turn asked with no paper attached in the 논문 요약 conversation, not the AI 비서\u2019s', async () => {
  // Now that the page holds one conversation, a follow-up can be asked without attaching anything
  // -- "그럼 두 번째 논문은?" belongs to the page's transcript. The old signature could not say that:
  // a turn with no paper key was the assistant's by definition, so an unattached question would have
  // landed in the AI 비서's thread, which is the exact mixing this whole line of work removed.
  const dir = await mkdtemp(join(tmpdir(), 'unattached-paper-turn-'));
  try {
    const owner = <T>(fn: () => T) => briefingClientContext.run('a'.repeat(64), fn);
    const store = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 5));
    const settings = {
      routineId: 'r',
      name: 'fixture',
      timeZone: 'Asia/Seoul',
      live: defaultLiveSettings(),
      interest: { keywords: [], excluded: [] },
      preferences: defaultAssistantPreferences(),
    };
    const profile = await owner(() => store.save(settings, async () => undefined));
    const paper = 'arxiv:2601.12345v1';
    const at = (n: number) => `2026-09-22T00:0${n}:00.000Z`;

    await owner(() =>
      store.appendConversation(profile, { role: 'user', text: '메일 요약', createdAt: at(0) }),
    );
    await owner(() =>
      store.appendConversation(
        profile,
        { role: 'user', text: '이 논문은?', createdAt: at(1) },
        { paperKey: paper },
      ),
    );
    await owner(() =>
      store.appendConversation(
        profile,
        { role: 'user', text: '그럼 두 번째는?', createdAt: at(2) },
        {},
      ),
    );

    // The page transcript holds both of its turns, attached or not.
    expect((await owner(() => store.conversation(profile, {}))).map((m) => m.text)).toEqual([
      '이 논문은?',
      '그럼 두 번째는?',
    ]);
    // The assistant keeps only its own.
    expect((await owner(() => store.conversation(profile))).map((m) => m.text)).toEqual([
      '메일 요약',
    ]);
    // An unattached turn is about no paper, so it inflates no paper's count.
    expect(await owner(() => store.paperConversationCounts(profile, [paper]))).toEqual({
      [paper]: { turns: 1, lastAskedAt: at(1), lastQuestion: '이 논문은?' },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('keeps 논문 요약 AI and the AI 비서 in separate transcripts, each across permission changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'paper-conversation-'));
  try {
    const owner = <T>(fn: () => T) => briefingClientContext.run('a'.repeat(64), fn);
    const make = () => new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 5));
    const store = make();
    const settings = {
      routineId: 'r',
      name: 'fixture',
      timeZone: 'Asia/Seoul',
      live: defaultLiveSettings(),
      interest: { keywords: [], excluded: [] },
      preferences: defaultAssistantPreferences(),
    };
    const profile = await owner(() => store.save(settings, async () => undefined));
    const paper = 'arxiv:2601.12345v1';
    const at = (n: number) => `2026-09-22T00:0${n}:00.000Z`;

    await owner(() =>
      store.appendConversation(profile, { role: 'user', text: '메일 요약', createdAt: at(0) }),
    );
    await owner(() =>
      store.appendConversation(
        profile,
        { role: 'user', text: '이 논문은?', createdAt: at(1) },
        { paperKey: paper },
      ),
    );

    // Each side sees only its own, and the model is given only its own.
    expect((await owner(() => store.conversation(profile))).map((m) => m.text)).toEqual([
      '메일 요약',
    ]);
    expect(
      (await owner(() => store.conversation(profile, { paperKey: paper }))).map((m) => m.text),
    ).toEqual(['이 논문은?']);
    expect(
      (await owner(() => store.conversationDisplay(profile))).messages.map((m) => m.text),
    ).toEqual(['메일 요약']);
    expect(
      (await owner(() => store.conversationDisplay(profile, { paperKey: paper }))).messages.map(
        (m) => m.text,
      ),
    ).toEqual(['이 논문은?']);

    // Counting for the 논문 요약 list reads the paper's own thread, and knows nothing of the other.
    expect(
      await owner(() => store.paperConversationCounts(profile, [paper, 'arxiv:other'])),
    ).toEqual({
      [paper]: { turns: 1, lastAskedAt: at(1), lastQuestion: '이 논문은?' },
    });

    // A permission change starts a new context for both, and each still shows only its own history.
    const changed = await owner(() =>
      store.save(
        { ...settings, preferences: { ...settings.preferences, providerId: 'claude-code' } },
        async () => undefined,
      ),
    );
    await owner(() =>
      store.appendConversation(
        changed,
        { role: 'user', text: '다음 질문', createdAt: at(2) },
        { paperKey: paper },
      ),
    );
    const display = await owner(() => make().conversationDisplay(changed, { paperKey: paper }));
    expect(display.messages.map((m) => m.text)).toEqual(['이 논문은?', '다음 질문']);
    expect(display.otherScopeMessages).toBe(1);
    expect(
      (await owner(() => make().conversationDisplay(changed))).messages.map((m) => m.text),
    ).toEqual(['메일 요약']);
    // The count spans the permission change too, so it does not reset under the user.
    expect(
      (await owner(() => make().paperConversationCounts(changed, [paper])))[paper]?.turns,
    ).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
