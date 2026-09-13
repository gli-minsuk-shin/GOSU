import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { bottleneckAutoencoder, sampleModels, residualClassifier } from './sample-models';
import {
  initialModelPseudocodeWorkspace,
  serializeModelPseudocodeWorkspace,
  MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
  appendModelPseudocodeRevision,
} from './model-pseudocode';
import {
  migrateProjectModelSeeds,
  projectModelLabInitialWorkspace,
  PROJECT_MODEL_SCOPE_KEY,
  defaultProjectModelWorkspace,
  keepOnlyBottleneckAutoencoder,
} from './project-model-workspace';
import { ModelLabApp, moveModelSessionToTrash } from './model-lab-app';

afterEach(() => vi.unstubAllGlobals());
const initial = () => initialModelPseudocodeWorkspace(sampleModels);
const storage = (workspace = initial()) => ({
  [MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]: serializeModelPseudocodeWorkspace(workspace),
});
describe('project-owned model initialization', () => {
  it('starts fresh projects with exactly one independent Bottleneck autoencoder', () => {
    const first = projectModelLabInitialWorkspace(null);
    const second = projectModelLabInitialWorkspace(null);
    expect(first.models.map((model) => model.name)).toEqual(['Bottleneck autoencoder']);
    expect(first.activeModelId).toBe(bottleneckAutoencoder.id);
    expect(first.models[0]).not.toBe(second.models[0]);
    expect(first.models[0]!.modules[0]).not.toBe(second.models[0]!.modules[0]);
    Reflect.set(first.models[0]!.modules[0]!, 'name', 'Changed in one project');
    expect(second.models[0]!.modules[0]!.name).toBe(bottleneckAutoencoder.modules[0]!.name);
    expect(first.histories[bottleneckAutoencoder.id]![0]!.label).toBe('Default model');
    expect(
      projectModelLabInitialWorkspace(
        serializeModelPseudocodeWorkspace(initialModelPseudocodeWorkspace([])),
      ).activeModelId,
    ).toBe('');
  });
  it('moves only untouched automatic examples to recoverable Trash exactly once', () => {
    const original = storage();
    const before = JSON.stringify(original);
    const migrated = migrateProjectModelSeeds(original);
    expect(migrated.movedIds.sort()).toEqual(
      sampleModels
        .filter((model) => model.id !== bottleneckAutoencoder.id)
        .map((model) => model.id)
        .sort(),
    );
    const restored = projectModelLabInitialWorkspace(
      migrated.storage[MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]!,
    );
    expect(restored.activeModelId).toBe(bottleneckAutoencoder.id);
    expect(restored.models).toHaveLength(sampleModels.length);
    expect(restored.trashedModelIds).toHaveLength(sampleModels.length - 1);
    expect(migrateProjectModelSeeds(migrated.storage).movedIds).toEqual([]);
    expect(JSON.stringify(original)).toBe(before);
  });
  it('preserves edited models, substantive conversations, and their nested dependencies', () => {
    const base = initial();
    const id = residualClassifier.id;
    const updated = {
      ...base,
      histories: {
        ...base.histories,
        [id]: appendModelPseudocodeRevision(base.histories[id]!, {
          parentRevision: 0,
          model: { ...residualClassifier, name: 'My edited architecture' },
          pseudocode: base.histories[id]![0]!.pseudocode,
        }),
      },
    };
    const tropic = sampleModels.find((model) => model.id.startsWith('tropic-'))!;
    const source = {
      ...storage(updated),
      'gosu.model-lab.chat-sessions.v1': JSON.stringify({
        chat: {
          draft: '',
          messages: [{ id: 'user-1', modelId: tropic.id, role: 'user', body: 'Keep my changes' }],
        },
      }),
    };
    const migrated = migrateProjectModelSeeds(source);
    expect(migrated.movedIds).not.toContain(id);
    expect(migrated.movedIds).not.toContain(tropic.id);
    expect(migrated.movedIds).not.toContain('sparkvsk-learned-warm-path-20260822');
  });
  it('keeps an empty active set after deleting the last project model, without resurrecting seeds', () => {
    const base = defaultProjectModelWorkspace();
    const transition = moveModelSessionToTrash(
      base.models,
      [],
      bottleneckAutoencoder.id,
      bottleneckAutoencoder.id,
      true,
    );
    expect(transition.moved).toBe(true);
    expect(transition.activeModelId).toBe('');
    const restored = projectModelLabInitialWorkspace(
      serializeModelPseudocodeWorkspace({ ...base, ...transition }),
    );
    expect(restored.trashedModelIds).toEqual([bottleneckAutoencoder.id]);
    expect(restored.activeModelId).toBe('');
  });
  it('renders an importable empty project, not a placeholder graph or a chat about fake evidence', () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const host = {
      projectId,
      projectName: 'Empty project',
      basePath: `/s/${'a'.repeat(64)}/${projectId}/`,
      storage: {
        [PROJECT_MODEL_SCOPE_KEY]: '1',
        [MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]: serializeModelPseudocodeWorkspace(
          initialModelPseudocodeWorkspace([]),
        ),
      },
    };
    vi.stubGlobal('document', {
      getElementById: (id: string) =>
        id === 'gosu-model-lab-host' ? { textContent: JSON.stringify(host) } : null,
    });
    vi.stubGlobal('window', {
      innerWidth: 1400,
      matchMedia: () => ({ matches: false }),
      localStorage: { getItem: () => null },
      dispatchEvent: () => true,
    });
    const html = renderToStaticMarkup(<ModelLabApp />);
    expect(html).toContain('No models in this project yet');
    expect(html).toContain('New / Import model');
    expect(html).not.toContain('data-testid="model-graph"');
    expect(html).not.toContain('Message GOSU Model Copilot');
  });
  it('initializes a missing host workspace once, without overwriting an existing workspace', () => {
    const initialized = migrateProjectModelSeeds({});
    const parsed = projectModelLabInitialWorkspace(
      initialized.storage[MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]!,
    );
    expect(parsed.models.map((model) => model.id)).toEqual([bottleneckAutoencoder.id]);
    expect(migrateProjectModelSeeds(initialized.storage).storage).toBe(initialized.storage);
    const existing = storage(
      initialModelPseudocodeWorkspace([{ ...residualClassifier, id: 'my-model' }]),
    );
    const migrated = migrateProjectModelSeeds(existing);
    expect(
      projectModelLabInitialWorkspace(
        migrated.storage[MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]!,
      ).models.map((model) => model.id),
    ).toEqual(['my-model']);
  });
  it('explicit cleanup moves every other model to Trash while preserving all revisions and artifacts', () => {
    const before = initial();
    const history = before.histories[bottleneckAutoencoder.id];
    const cleaned = keepOnlyBottleneckAutoencoder(before);
    expect(cleaned.movedIds).toHaveLength(4);
    expect(
      cleaned.workspace.models
        .filter((model) => !cleaned.workspace.trashedModelIds.includes(model.id))
        .map((model) => model.id),
    ).toEqual([bottleneckAutoencoder.id]);
    expect(cleaned.workspace.histories).toBe(before.histories);
    expect(cleaned.workspace.histories[bottleneckAutoencoder.id]).toBe(history);
    expect(keepOnlyBottleneckAutoencoder(cleaned.workspace).movedIds).toEqual([]);
    expect(() =>
      keepOnlyBottleneckAutoencoder(initialModelPseudocodeWorkspace([residualClassifier])),
    ).toThrow('safely');
  });
});
