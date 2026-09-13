import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { applicationLanguageContext } from '../desktop/src/main/application-language-service';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MODEL_BUILDER_PIPELINE_VERSION,
  modelBuilderArtifactManifest,
  modelBuilderSourceDigest,
  readModelBuilderCache,
  writeModelBuilderCache,
} from './model-builder-cache';
import type { ModelBuildArtifact } from './src/model-lab-builder';
import type { ModelSpec } from './src/model-lab-schema';
import { bottleneckAutoencoder, residualClassifier } from './src/sample-models';

const pythonArtifact: ModelBuildArtifact = {
  name: 'model.py',
  mediaType: 'text/x-python',
  kind: 'python',
  encoding: 'utf8',
  content: 'class Model: pass\n',
};

const notesArtifact: ModelBuildArtifact = {
  name: 'notes.txt',
  mediaType: 'text/plain',
  kind: 'text',
  encoding: 'utf8',
  content: 'Residual model notes.\n',
};

it('partitions canonical generation caches by explicitly selected application language', () => {
  const digest = (language: 'en' | 'ko', configured: boolean) =>
    applicationLanguageContext.run({ language, configured }, () =>
      modelBuilderSourceDigest([pythonArtifact]),
    );
  expect(digest('en', false)).toBe(digest('ko', false));
  expect(digest('en', true)).not.toBe(digest('ko', true));
  expect(digest('en', true)).not.toBe(digest('en', false));
  expect(digest('ko', true)).toBe(digest('ko', true));
});

function withExplicitPorts(
  model: ModelSpec,
  sourceNames: readonly string[] = ['model.py'],
): ModelSpec {
  return {
    ...model,
    modules: model.modules.map((module, moduleIndex) => {
      const incoming = model.connections.filter((connection) => connection.target === module.id);
      const outgoing = model.connections.filter((connection) => connection.source === module.id);
      return {
        ...module,
        codeReference: sourceNames[moduleIndex % sourceNames.length]!,
        inputPorts:
          incoming.length > 0
            ? incoming.map((connection) => ({
                name: `input:${connection.id}`,
                shape: connection.shape,
                binding: 'internal' as const,
              }))
            : [{ name: 'external input', shape: module.inputShape, binding: 'external' as const }],
        outputPorts:
          outgoing.length > 0
            ? outgoing.map((connection) => ({
                name: `output:${connection.id}`,
                shape: connection.shape,
                binding: 'internal' as const,
              }))
            : [
                {
                  name: 'external output',
                  shape: module.outputShape,
                  binding: 'external' as const,
                },
              ],
      };
    }),
    connections: model.connections.map((connection) => ({
      ...connection,
      sourcePort: `output:${connection.id}`,
      targetPort: `input:${connection.id}`,
    })),
  };
}

describe('Model Builder canonical cache', () => {
  it('keys only canonical source bytes and artifact metadata, not LLM selection or upload order', () => {
    expect(modelBuilderSourceDigest([pythonArtifact, notesArtifact])).toBe(
      modelBuilderSourceDigest([notesArtifact, pythonArtifact]),
    );
    expect(
      modelBuilderSourceDigest([{ ...pythonArtifact, content: 'class Model: changed\n' }]),
    ).not.toBe(modelBuilderSourceDigest([pythonArtifact]));
    expect(MODEL_BUILDER_PIPELINE_VERSION).toContain('canonical');
  });

  it('rejects a pre-harness legacy cache that lacks exact semantic port contracts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gosu-model-builder-cache-migration-test-'));
    try {
      const sourceDigest = modelBuilderSourceDigest([notesArtifact]);
      const baseModule = {
        group: 'Fixture',
        activation: null,
        parameterCount: 0,
        codeReference: 'notes.txt',
      };
      const legacyModel = {
        schemaVersion: 1,
        id: 'legacy-lambda-branch',
        name: 'Legacy lambda branch',
        version: 'v1',
        framework: 'design-only',
        sourceLabel: 'notes.txt',
        sourceArtifacts: [{ path: 'notes.txt', verified: true }],
        summary: 'Legacy grouped branch cache fixture.',
        intent: {
          statement: 'Produce a path.',
          invariants: [],
          expectedInput: ['N', 'P'],
          expectedOutput: ['P', 'K'],
        },
        modules: [
          {
            ...baseModule,
            id: 'x',
            name: 'X',
            kind: 'input',
            stage: 0,
            lane: 0,
            inputShape: ['N', 'P'],
            outputShape: ['N', 'P'],
            transform: 'X_out = X_c',
            formula: 'X_{out}=X_c',
            explanation: 'X input.',
          },
          {
            ...baseModule,
            id: 'y',
            name: 'y',
            kind: 'input',
            stage: 0,
            lane: 1,
            inputShape: ['N', 1],
            outputShape: ['N', 1],
            transform: 'y_out = y_c',
            formula: 'y_{out}=y_c',
            explanation: 'y input.',
          },
          {
            ...baseModule,
            id: 'lambda',
            name: 'Lambda',
            kind: 'input',
            stage: 0,
            lane: 2,
            inputShape: [1, 'K'],
            outputShape: [1, 'K'],
            transform: 'lambda_out = lambda',
            formula: '\\lambda_{out}=\\lambda',
            explanation: 'Lambda input.',
          },
          {
            ...baseModule,
            id: 'statistic_embedding',
            name: 'Correlation Statistic Embedding',
            kind: 'linear',
            stage: 1,
            lane: 0,
            inputShape: ['X_c_rows', 'y_c_rows', 'lambda_rows'],
            outputShape: ['H0', 'log_lam_mean'],
            transform:
              'log_lam_mean = -mean(log(lambda))\nH_stat = X_c.T @ y_c / N\nH = Linear(1, d)(H_stat)',
            formula:
              'm_\\lambda=-\\frac1K\\sum_k\\log\\lambda_k\ns=\\frac{X_c^\\top y_c}{N}\nH_0=\\operatorname{Linear}_{1\\to2K}(s)',
            explanation: 'Grouped legacy branch.',
          },
          {
            ...baseModule,
            id: 'out',
            name: 'Output',
            kind: 'output',
            stage: 2,
            lane: 0,
            inputShape: ['P', '2K'],
            outputShape: ['P', 'K'],
            transform: 'beta = slice(H)',
            formula: '\\beta=H_{:,1:K}',
            explanation: 'Output.',
          },
        ],
        connections: [
          {
            id: 'x-stat',
            source: 'x',
            target: 'statistic_embedding',
            tensorName: 'X_c',
            shape: ['N', 'P'],
            activationNorm: 0,
          },
          {
            id: 'y-stat',
            source: 'y',
            target: 'statistic_embedding',
            tensorName: 'y_c',
            shape: ['N', 1],
            activationNorm: 0,
          },
          {
            id: 'lambda-stat',
            source: 'lambda',
            target: 'statistic_embedding',
            tensorName: 'lambda',
            shape: [1, 'K'],
            activationNorm: 0,
          },
          {
            id: 'stat-h',
            source: 'statistic_embedding',
            target: 'out',
            tensorName: 'H_0',
            shape: ['P', '2K'],
            activationNorm: 0,
          },
          {
            id: 'stat-mean',
            source: 'statistic_embedding',
            target: 'out',
            tensorName: 'log_lam_mean',
            shape: [1, 1],
            activationNorm: 0,
          },
        ],
        gradientEvidence: null,
      };
      const legacyDigest = createHash('sha256').update(JSON.stringify(legacyModel)).digest('hex');
      const directory = join(root, MODEL_BUILDER_PIPELINE_VERSION);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, `${sourceDigest}.json`),
        JSON.stringify({
          entryVersion: 1,
          pipelineVersion: MODEL_BUILDER_PIPELINE_VERSION,
          sourceDigest,
          modelIrDigest: legacyDigest,
          artifacts: modelBuilderArtifactManifest([notesArtifact]),
          model: legacyModel,
          origin: {
            providerId: 'codex',
            providerLabel: 'Codex CLI',
            modelId: 'fixture',
            reasoning: 'high',
            repairCount: 0,
            generatedAt: '2026-08-31T00:00:00.000Z',
          },
        }),
        'utf8',
      );

      const hit = await readModelBuilderCache([notesArtifact], root);

      expect(hit).toBeNull();
      expect(legacyDigest).toHaveLength(64);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('round-trips only a validated ModelIR and rejects a tampered cache digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gosu-model-builder-cache-test-'));
    try {
      const origin = {
        providerId: 'codex',
        providerLabel: 'Codex CLI',
        modelId: 'gpt-5.6-sol',
        reasoning: 'high',
        repairCount: 1,
        generatedAt: '2026-08-31T00:00:00.000Z',
      };
      const portedModel = withExplicitPorts(residualClassifier, ['model.py', 'notes.txt']);
      const portedEdge = portedModel.connections[0]!;
      const written = await writeModelBuilderCache(
        [pythonArtifact, notesArtifact],
        portedModel,
        origin,
        root,
      );
      const hit = await readModelBuilderCache([notesArtifact, pythonArtifact], root);

      expect(hit).toEqual(written);
      expect(hit?.origin).toEqual(origin);
      expect(hit?.model.id).toBe(residualClassifier.id);
      expect(hit?.model.sourceArtifacts.map((artifact) => artifact.path)).toEqual([
        'model.py',
        'notes.txt',
      ]);
      expect(hit?.modelIrDigest).toBe(written.modelIrDigest);
      expect(
        hit?.model.modules.find((module) => module.id === portedEdge.source)?.outputPorts,
      ).toEqual(portedModel.modules.find((module) => module.id === portedEdge.source)?.outputPorts);
      expect(
        hit?.model.connections.find((connection) => connection.id === portedEdge.id),
      ).toMatchObject({
        sourcePort: `output:${portedEdge.id}`,
        targetPort: `input:${portedEdge.id}`,
      });

      const secondWrite = await writeModelBuilderCache(
        [notesArtifact, pythonArtifact],
        bottleneckAutoencoder,
        { ...origin, providerId: 'claude-code', modelId: 'claude-opus-5' },
        root,
      );
      expect(secondWrite.model.id).toBe(residualClassifier.id);
      expect(secondWrite.origin.providerId).toBe('codex');

      const path = join(root, MODEL_BUILDER_PIPELINE_VERSION, `${written.sourceDigest}.json`);
      const entry = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      entry.modelIrDigest = '0'.repeat(64);
      await writeFile(path, JSON.stringify(entry), 'utf8');
      expect(await readModelBuilderCache([notesArtifact, pythonArtifact], root)).toBeNull();
      const healedWriters = await Promise.all(
        Array.from({ length: 20 }, (_value, index) =>
          writeModelBuilderCache(
            [notesArtifact, pythonArtifact],
            index % 2 === 0
              ? portedModel
              : withExplicitPorts(bottleneckAutoencoder, ['model.py', 'notes.txt']),
            index % 2 === 0
              ? origin
              : { ...origin, providerId: 'claude-code', modelId: 'claude-opus-5' },
            root,
          ),
        ),
      );
      const healed = healedWriters[0]!;
      expect(new Set(healedWriters.map((writer) => writer.modelIrDigest)).size).toBe(1);
      expect(new Set(healedWriters.map((writer) => writer.model.id)).size).toBe(1);
      expect(healed.model.id).toBe(portedModel.id);
      expect(await readModelBuilderCache([pythonArtifact, notesArtifact], root)).toMatchObject({
        modelIrDigest: healed.modelIrDigest,
        model: { id: portedModel.id },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('selects one atomic canonical winner for concurrent writes of the same source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gosu-model-builder-cache-race-test-'));
    try {
      const origin = {
        providerId: 'codex',
        providerLabel: 'Codex CLI',
        modelId: 'gpt-5.6-sol',
        reasoning: 'high',
        repairCount: 0,
        generatedAt: '2026-09-02T00:00:00.000Z',
      };
      const [left, right] = await Promise.all([
        writeModelBuilderCache(
          [pythonArtifact],
          withExplicitPorts(residualClassifier),
          origin,
          root,
        ),
        writeModelBuilderCache(
          [pythonArtifact],
          withExplicitPorts(bottleneckAutoencoder),
          { ...origin, providerId: 'claude-code', modelId: 'claude-opus-5' },
          root,
        ),
      ]);
      const winner = await readModelBuilderCache([pythonArtifact], root);

      expect(left.modelIrDigest).toBe(right.modelIrDigest);
      expect(left.model.id).toBe(right.model.id);
      expect(winner?.modelIrDigest).toBe(left.modelIrDigest);
      expect(winner?.model.id).toBe(left.model.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
