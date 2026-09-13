import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectModelTransferStore } from './project-model-transfer-store';
import { modelPythonArtifactPaths } from './model-copilot-server';
import {
  residualClassifier,
  tropicLambdaPathCompiler,
  sparkvskLearnedWarmPath,
} from './src/sample-models';
import {
  initialModelPseudocodeWorkspace,
  serializeModelPseudocodeWorkspace,
  MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
  type ModelPseudocodeWorkspace,
} from './src/model-pseudocode';
import {
  mergeProjectModelCopies,
  PROJECT_MODEL_RECEIVED_COPIES_KEY,
} from './src/project-model-transfer';
import { projectModelLabInitialWorkspace } from './src/project-model-workspace';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(source = initialModelPseudocodeWorkspace([residualClassifier])) {
  const root = await mkdtemp(join(tmpdir(), 'gosu-model-copy-test-'));
  roots.push(root);
  const workspaces: Record<string, Record<string, string>> = {
    [a]: {
      [MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]: serializeModelPseudocodeWorkspace(source),
      'gosu.model-lab.chat-sessions.v1': 'PRIVATE CONVERSATION',
    },
    [b]: {
      [MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]: serializeModelPseudocodeWorkspace(
        initialModelPseudocodeWorkspace([]),
      ),
    },
  };
  const projects = [
    { id: a, name: 'Alpha' },
    { id: b, name: 'Beta' },
  ];
  const options = {
    root,
    readStorage: async (id: string) => workspaces[id]!,
    resolveProject: async (id: string) => projects.find((project) => project.id === id) ?? null,
    listProjects: async () => projects,
  };
  return { root, workspaces, source, store: new ProjectModelTransferStore(options), options };
}
const request = (modelId = residualClassifier.id) => ({
  targetProjectId: b,
  sourceModelId: modelId,
  sourceRevision: 0,
  requestId: randomUUID(),
});
describe('independent cross-project model copies', () => {
  it('copies a validated revision with fresh IDs, without changing source or copying conversations', async () => {
    const { store, workspaces } = await fixture();
    const before = workspaces[a]![MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY];
    const copy = await store.create(a, request());
    expect(copy.entries).toHaveLength(1);
    expect(copy.rootModelId).not.toBe(residualClassifier.id);
    expect(workspaces[a]![MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]).toBe(before);
    expect(JSON.stringify(copy)).not.toContain('PRIVATE CONVERSATION');
    const merged = mergeProjectModelCopies(initialModelPseudocodeWorkspace([]), [copy]);
    expect(merged.activeModelId).toBe(copy.rootModelId);
    expect(merged.models).toHaveLength(1);
    const altered = {
      ...merged,
      histories: {
        ...merged.histories,
        [copy.rootModelId]: [
          { ...merged.histories[copy.rootModelId]![0]!, label: 'User edited copy' },
        ],
      },
    };
    expect(mergeProjectModelCopies(altered, [copy]).histories[copy.rootModelId]![0]!.label).toBe(
      'User edited copy',
    );
    expect(workspaces[a]![MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]).toBe(before);
  });
  it('copies nested dependencies once and rewrites links only inside the destination bundle', async () => {
    const { store } = await fixture(
      initialModelPseudocodeWorkspace([tropicLambdaPathCompiler, sparkvskLearnedWarmPath]),
    );
    const copy = await store.create(a, request(tropicLambdaPathCompiler.id));
    expect(copy.entries).toHaveLength(2);
    const linked = copy.entries![0]!.model.modules.find((module) => module.subgraph)!;
    expect(copy.modelIds).toContain(linked.subgraph!.modelId);
    expect(linked.subgraph!.modelId).not.toBe(sparkvskLearnedWarmPath.id);
    expect(
      mergeProjectModelCopies(initialModelPseudocodeWorkspace([]), [copy]).models,
    ).toHaveLength(2);
  });
  it('persists pending copies across restart and makes retries idempotent', async () => {
    const { store, options } = await fixture();
    const input = request();
    const [first, second] = await Promise.all([store.create(a, input), store.create(a, input)]);
    expect(first.rootModelId).toBe(second.rootModelId);
    const restarted = new ProjectModelTransferStore(options);
    expect(await restarted.pending(b)).toHaveLength(1);
    expect((await restarted.create(a, input)).rootModelId).toBe(first.rootModelId);
    await expect(store.create(a, { ...input, sourceRevision: 1 })).rejects.toThrow('conflict');
  });
  it('does not acknowledge delivery before the receiver durably records it', async () => {
    const { store, workspaces } = await fixture();
    const copy = await store.create(a, request());
    await expect(store.acknowledge(b, copy.id)).rejects.toThrow('has not saved');
    workspaces[b]![PROJECT_MODEL_RECEIVED_COPIES_KEY] = JSON.stringify([copy.id]);
    await store.acknowledge(b, copy.id);
    expect(await store.pending(b)).toEqual([]);
    await expect(store.acknowledge(a, copy.id)).rejects.toThrow('not found');
  });
  it('rejects invalid, same-project, missing-model and unavailable-target copy requests', async () => {
    const { store } = await fixture();
    await expect(store.create(a, { ...request(), targetProjectId: a })).rejects.toThrow();
    await expect(store.create(a, { ...request(), targetProjectId: '../escape' })).rejects.toThrow();
    await expect(store.create(a, request('missing'))).rejects.toThrow('Save');
    await expect(store.create(a, { ...request(), targetProjectId: randomUUID() })).rejects.toThrow(
      'available',
    );
  });
  it('copies generated Python bytes into destination-owned paths after hash verification', async () => {
    const state = initialModelPseudocodeWorkspace([residualClassifier]);
    const setup = await fixture(state);
    const paths = modelPythonArtifactPaths(
      join(setup.root, a, 'artifacts'),
      residualClassifier.id,
      0,
    );
    const source = 'class Model:\n    pass\n';
    const sourceSha256 = createHash('sha256').update(source).digest('hex');
    const receipt = {
      schemaVersion: 1 as const,
      modelId: residualClassifier.id,
      revision: 0,
      filename: 'model.py' as const,
      entrypoint: 'Model',
      framework: 'PyTorch' as const,
      implementationStatus: 'scaffold' as const,
      dependencies: [],
      generatedAt: new Date().toISOString(),
      sourceSha256,
      absolutePath: '/untrusted/not-used.py',
      manifestPath: '/untrusted/not-used.json',
      generator: 'fixture',
    };
    await mkdir(paths.directory, { recursive: true });
    await writeFile(paths.sourcePath, source);
    await writeFile(paths.manifestPath, JSON.stringify({ receipt, summary: 'fixture', trace: [] }));
    const updated: ModelPseudocodeWorkspace = {
      ...state,
      histories: {
        ...state.histories,
        [residualClassifier.id]: [
          { ...state.histories[residualClassifier.id]![0]!, pythonArtifact: receipt },
        ],
      },
    };
    setup.workspaces[a]![MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY] =
      serializeModelPseudocodeWorkspace(updated);
    const copy = await setup.store.create(a, request());
    const copied = copy.entries![0]!.pythonArtifact!;
    expect(copied.modelId).toBe(copy.rootModelId);
    expect(copied.absolutePath).toContain(join(setup.root, b, 'artifacts'));
    expect(await readFile(copied.absolutePath, 'utf8')).toBe(source);
    const merged = mergeProjectModelCopies(initialModelPseudocodeWorkspace([]), [copy]);
    const restored = projectModelLabInitialWorkspace(serializeModelPseudocodeWorkspace(merged));
    expect(restored.histories[copy.rootModelId]![0]!.pythonArtifact?.absolutePath).toBe(
      copied.absolutePath,
    );
    await writeFile(paths.sourcePath, 'tampered');
    await expect(setup.store.create(a, request())).rejects.toThrow('verification failed');
  });
});
