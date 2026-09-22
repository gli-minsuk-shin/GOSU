import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
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
