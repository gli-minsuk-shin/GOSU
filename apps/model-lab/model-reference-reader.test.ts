import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createModelLabReader } from './model-reference-reader';
import { ModelChatContextStore } from './model-chat-context';
import {
  initialModelPseudocodeWorkspace,
  serializeModelPseudocodeWorkspace,
  MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
} from './src/model-pseudocode';
import { residualClassifier } from './src/sample-models';
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'gosu-model-reference-'));
  dirs.push(root);
  const work = initialModelPseudocodeWorkspace([residualClassifier]);
  const state: Record<string, string> = {
    [MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]: serializeModelPseudocodeWorkspace(work),
  };
  const projects = new Set([a]);
  const archive = new ModelChatContextStore(join(root, a, 'chat-context'));
  const read = createModelLabReader({
    storage: async () => state,
    activeProject: async (id) => projects.has(id),
    archive: () => archive,
  });
  return { root, state, work, archive, read, projects };
}
it('reads the exact saved model and pseudocode, exposes revisions and creates no conversation archive', async () => {
  const { read, root } = await setup();
  const catalog = await read(a, {});
  expect(catalog.models).toHaveLength(1);
  const ref = catalog.models![0]!;
  expect(ref.name).toBe(residualClassifier.name);
  expect(ref.revisions).toEqual([0]);
  const result = await read(a, {
    section: 'pseudocode',
    modelId: ref.modelId,
    revision: 0,
    expectedSha256: ref.contentSha256,
  });
  expect(result.reference).toMatchObject({ contentSha256: ref.contentSha256 });
  expect(result.text).toContain(ref.modelId);
  expect(await readdir(root)).toEqual([]);
  await expect(
    read(a, {
      section: 'model',
      modelId: ref.modelId,
      revision: 0,
      expectedSha256: '0'.repeat(64),
    }),
  ).rejects.toThrow('reference_changed');
});
it('rejects unavailable projects, revisions, traversal-like project identifiers and injected fields', async () => {
  const { read } = await setup();
  await expect(read(b, {})).rejects.toThrow('project_unavailable');
  await expect(read('../private', {})).rejects.toThrow();
  await expect(
    read(a, { section: 'model', modelId: residualClassifier.id, revision: 99 }),
  ).rejects.toThrow('revision_unavailable');
  await expect(read(a, { section: 'model' })).rejects.toThrow();
  await expect(read(a, { path: '/private' } as never)).rejects.toThrow();
});
it('does not resurrect trashed models or turn invalid stored histories into zero results', async () => {
  const { read, state, work } = await setup();
  state[MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY] = serializeModelPseudocodeWorkspace({
    ...work,
    trashedModelIds: [residualClassifier.id],
  });
  expect((await read(a, {})).models).toEqual([]);
  await expect(read(a, { section: 'model', modelId: residualClassifier.id })).rejects.toThrow(
    'model_unavailable',
  );
  state[MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY] = JSON.stringify({
    schemaVersion: 1,
    histories: { broken: [{}] },
  });
  await expect(read(a, {})).rejects.toThrow('workspace_invalid');
});
it('returns no seeded models for a never-saved workspace', async () => {
  const { read, state } = await setup();
  delete state[MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY];
  expect((await read(a, {})).models).toEqual([]);
});
it('reads original model chat in bounded pages without altering its archive or using stale UI text', async () => {
  const { read, state, archive } = await setup();
  const ref = (await read(a, {})).models![0]!;
  const key = [ref.modelId, ref.version, 0, 'hosted-legacy'] as const;
  await archive.session(
    key,
    [{ role: 'user', body: 'evidence '.repeat(5000), createdAt: '2026-09-14T00:00:00Z' }],
    new AbortController().signal,
    async () => undefined,
  );
  state['gosu.model-lab.chat-sessions.v1'] = JSON.stringify({
    [JSON.stringify(key.slice(0, 3))]: {
      messages: [{ role: 'user', body: 'STALE UI', createdAt: 'old' }],
      draft: 'UNSENT DRAFT',
    },
  });
  const before = await archive.read(key);
  const first = await read(a, { section: 'conversation', modelId: ref.modelId, revision: 0 });
  expect(first.historySource).toBe('archive');
  expect(first.text).toHaveLength(16000);
  expect(first.nextOffset).toBe(16000);
  expect(first.text).not.toContain('STALE UI');
  const next = await read(a, {
    section: 'conversation',
    modelId: ref.modelId,
    revision: 0,
    offset: first.nextOffset!,
  });
  expect(next.nextOffset).toBe(32000);
  expect(await archive.read(key)).toEqual(before);
});
it('labels legacy UI-only history, excludes drafts, and distinguishes no conversation', async () => {
  const { read, state } = await setup();
  const ref = (await read(a, {})).models![0]!;
  expect((await read(a, { section: 'conversation', modelId: ref.modelId })).historySource).toBe(
    'none',
  );
  state['gosu.model-lab.chat-sessions.v1'] = JSON.stringify({
    [JSON.stringify([ref.modelId, ref.version, 0])]: {
      messages: [
        {
          role: 'assistant',
          body: 'A hypothesis, not a result.',
          createdAt: '2026-09-14T00:00:00Z',
        },
      ],
      draft: 'PRIVATE UNSENT',
    },
  });
  const result = await read(a, { section: 'conversation', modelId: ref.modelId });
  expect(result.historySource).toBe('legacy-ui-cache');
  expect(result.note).toContain('pruned');
  expect(result.text).toContain('hypothesis');
  expect(result.text).not.toContain('PRIVATE UNSENT');
  await expect(
    read(a, { section: 'conversation', modelId: ref.modelId, offset: 39999999 }),
  ).rejects.toThrow('offset_invalid');
});
