import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexModelCatalog } from '@gosu/contracts';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { briefingClientContext } from './briefing-client-context';
import { saveBriefingModelSelection } from './briefing-model-settings';
import { modelSelection } from './src/briefing-model-selection';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const owner = <T>(f: () => T) => briefingClientContext.run('a'.repeat(64), f);
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'briefing-model-settings-'));
  dirs.push(dir);
  const store = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 1));
  const profile = await owner(() =>
    store.save(
      {
        routineId: 'r',
        name: 'Fixture',
        timeZone: 'Asia/Seoul',
        interest: { keywords: [], excluded: [] },
        live: {
          ...defaultLiveSettings(),
          mail: {
            accountId: 'a',
            mailboxId: 'b',
            days: 3,
            limit: 10,
            subject: '',
            sender: '',
            unreadOnly: true,
            bodyPreview: true,
          },
        },
        preferences: {
          ...defaultAssistantPreferences(),
          mailRead: true,
          mailAi: true,
          calendarRead: true,
          calendarIds: ['cal'],
        },
      },
      async () => undefined,
    ),
  );
  const descriptor = createCodexModelCatalog([
    {
      id: 'future',
      model: 'future',
      displayName: 'Future model',
      isDefault: true,
      supportedReasoningEfforts: [{ reasoningEffort: 'deep' }],
    },
  ]).models[0]!;
  const resolve = vi.fn(async (prefs: typeof profile.preferences) => ({
    ...descriptor,
    providerId: prefs.providerId,
  }));
  const consent = vi.fn(async () => undefined);
  const signal = new AbortController().signal;
  const input = {
    routineId: 'r',
    selection: { providerId: 'codex', modelId: 'future', reasoning: 'deep' },
    expectedSelection: modelSelection(profile.preferences),
  };
  return { store, profile, resolve, consent, signal, input };
}
it('updates only model/reasoning without prompting or changing source permissions', async () => {
  const f = await fixture();
  await owner(() => saveBriefingModelSelection(f.input, f.store, f.resolve, f.consent, f.signal));
  const next = (await f.store.profile('r'))!;
  expect(next.preferences).toEqual({ ...f.profile.preferences, ...f.input.selection });
  expect(next.live.mail).toEqual(f.profile.live.mail);
  expect(next.interest).toEqual(f.profile.interest);
  expect(next.approvedScope).toBe(f.profile.approvedScope);
  expect(f.consent).not.toHaveBeenCalled();
});
it('uses the existing explicit approval boundary when changing the private-AI provider', async () => {
  const f = await fixture();
  f.consent.mockRejectedValueOnce(new Error('denied'));
  const input = { ...f.input, selection: { ...f.input.selection, providerId: 'claude-code' } };
  await expect(
    owner(() => saveBriefingModelSelection(input, f.store, f.resolve, f.consent, f.signal)),
  ).rejects.toThrow('denied');
  expect((await f.store.profile('r'))!.preferences.providerId).toBe('codex');
  await owner(() => saveBriefingModelSelection(input, f.store, f.resolve, f.consent, f.signal));
  expect((await f.store.profile('r'))!.preferences.providerId).toBe('claude-code');
  expect(f.consent).toHaveBeenCalledTimes(2);
});
it('rejects foreign browsers, injected permissions, stale selections and unavailable reasoning', async () => {
  const f = await fixture();
  await expect(
    briefingClientContext.run('b'.repeat(64), () =>
      saveBriefingModelSelection(f.input, f.store, f.resolve, f.consent, f.signal),
    ),
  ).rejects.toThrow('client_required');
  await expect(
    owner(() =>
      saveBriefingModelSelection(
        { ...f.input, selection: { ...f.input.selection, mailAi: false } },
        f.store,
        f.resolve,
        f.consent,
        f.signal,
      ),
    ),
  ).rejects.toThrow();
  await expect(
    owner(() =>
      saveBriefingModelSelection(
        { ...f.input, expectedSelection: f.input.selection },
        f.store,
        f.resolve,
        f.consent,
        f.signal,
      ),
    ),
  ).rejects.toThrow('model_selection_stale');
  await expect(
    owner(() =>
      saveBriefingModelSelection(
        { ...f.input, selection: { ...f.input.selection, reasoning: 'not-supported' } },
        f.store,
        f.resolve,
        f.consent,
        f.signal,
      ),
    ),
  ).rejects.toThrow('reasoning_unavailable');
  expect(await f.store.profile('r')).toEqual(f.profile);
});
it('does not overwrite a concurrent permission revocation while model discovery is pending', async () => {
  const f = await fixture();
  f.resolve.mockImplementationOnce(async () => {
    const { approvedScope: _a, owners: _o, updatedAt: _t, ...data } = f.profile;
    await f.store.save(
      { ...data, preferences: { ...data.preferences, mailAi: false } },
      async () => undefined,
    );
    return {
      ...createCodexModelCatalog([
        { id: 'future', model: 'future', displayName: 'Future', isDefault: true },
      ]).models[0]!,
      providerId: 'codex' as const,
      reasoningOptions: [{ id: 'deep', label: 'Deep', isDefault: true }],
    };
  });
  await expect(
    owner(() => saveBriefingModelSelection(f.input, f.store, f.resolve, f.consent, f.signal)),
  ).rejects.toThrow('settings_changed');
  expect((await f.store.profile('r'))!.preferences.mailAi).toBe(false);
});
it('rechecks cancellation and active work immediately before committing', async () => {
  const f = await fixture();
  await expect(
    owner(() =>
      saveBriefingModelSelection(f.input, f.store, f.resolve, f.consent, f.signal, () => {
        throw new Error('assistant_model_busy');
      }),
    ),
  ).rejects.toThrow('model_busy');
  const c = new AbortController();
  c.abort();
  await expect(
    owner(() => saveBriefingModelSelection(f.input, f.store, f.resolve, f.consent, c.signal)),
  ).rejects.toThrow('cancelled');
  expect(await f.store.profile('r')).toEqual(f.profile);
});
