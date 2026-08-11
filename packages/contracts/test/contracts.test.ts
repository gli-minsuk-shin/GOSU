import { readFile, readdir } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  JobManifestV1Schema,
  ManuscriptCheckpointV1Schema,
  ManuscriptWorkspaceBindingV1Schema,
  ManuscriptWorkspaceDescriptorV1Schema,
  ModelDescriptorSchema,
  ObjectiveSnapshotSchema,
  ObjectiveVersionSchema,
  PrimaryMetricSchema,
  RunnerEventMessageV1Schema,
  contractJsonSchema,
} from '../src/index.js';
import { CONTRACT_BUNDLE_FILE, renderContractSchemaArtifacts } from '../src/generation.js';

function collectReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectReferences);
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    key === '$ref' && typeof child === 'string' ? [child] : collectReferences(child),
  );
}

function jsonPointerExists(document: unknown, reference: string): boolean {
  if (!reference.startsWith('#/')) {
    return false;
  }

  let current: unknown = document;
  for (const encodedToken of reference.slice(2).split('/')) {
    const token = encodedToken.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || typeof current !== 'object' || !(token in current)) {
      return false;
    }
    current = (current as Record<string, unknown>)[token];
  }
  return true;
}

describe('contract schemas', () => {
  it('requires a target before target-based stopping without breaking target-optional snapshots', () => {
    const primaryMetric = {
      key: 'validation_loss',
      displayName: 'Validation loss',
      direction: 'minimize',
      unit: null,
      aggregation: 'minimum',
      evaluatorHash: 'sha256:evaluator',
      datasetHash: 'sha256:dataset',
      holdoutHash: null,
      baseline: null,
      target: null,
    } as const;
    const budget = {
      maxTrials: 10,
      maxConcurrentTrials: 1,
      maxWallTimeSeconds: 3_600,
      maxGpuHours: 0,
      maxFailures: 3,
    } as const;
    const objective = {
      schemaVersion: 1,
      objectiveVersionId: 'objective-optional-target',
      projectId: 'project-optional-target',
      version: 1,
      goal: 'Measure reproducible progress without a target threshold.',
      primaryMetric,
      guardrails: [],
      budget,
      stopPolicy: {
        stopWhenTargetReached: false,
        guardrailAction: 'pause',
        maxConsecutiveNoImprovement: null,
      },
      createdBy: 'researcher-1',
      createdAt: '2026-08-11T00:00:00.000Z',
    } as const;

    expect(PrimaryMetricSchema.safeParse(primaryMetric).success).toBe(true);
    expect(
      ObjectiveSnapshotSchema.safeParse({
        objectiveVersionId: objective.objectiveVersionId,
        version: objective.version,
        primaryMetric,
        budget,
      }).success,
    ).toBe(true);
    expect(ObjectiveVersionSchema.safeParse(objective).success).toBe(true);
    expect(
      ObjectiveVersionSchema.safeParse({
        ...objective,
        stopPolicy: { ...objective.stopPolicy, stopWhenTargetReached: true },
      }).success,
    ).toBe(false);
    expect(
      ObjectiveVersionSchema.safeParse({
        ...objective,
        primaryMetric: { ...primaryMetric, target: 0 },
        stopPolicy: { ...objective.stopPolicy, stopWhenTargetReached: true },
      }).success,
    ).toBe(true);
  });

  it('accepts provider-discovered opaque model identifiers', () => {
    const discoveredModelId = `provider-discovered-${Date.now()}`;
    const descriptor = ModelDescriptorSchema.parse({
      schemaVersion: 1,
      providerId: 'fixture-provider',
      modelId: discoveredModelId,
      displayName: 'Provider discovered model',
      catalogVersion: 'catalog-42',
      isDefault: true,
      modalities: ['text'],
      reasoningOptions: [],
    });

    expect(descriptor.modelId).toBe(discoveredModelId);
  });

  it('defines the project-scoped runner event transport and summary metrics', () => {
    const message = RunnerEventMessageV1Schema.parse({
      type: 'runner.event',
      projectId: 'project-vision',
      runnerId: 'runner-test',
      event: {
        schemaVersion: 1,
        eventId: 'event-1',
        runnerId: 'runner-test',
        campaignId: 'campaign-1',
        trialId: 'trial-1',
        attemptId: 'attempt-1',
        sequence: 7,
        occurredAt: '2026-08-03T01:02:03.000Z',
        kind: 'metric',
        metricKey: 'validation_accuracy',
        value: 0.91,
        step: 100,
        isSummary: true,
      },
    });

    expect(message.projectId).toBe('project-vision');
    expect(message.event).toMatchObject({ sequence: 7, isSummary: true });
    expect(() =>
      RunnerEventMessageV1Schema.parse({ ...message, runnerId: 'different-runner' }),
    ).toThrow();
  });

  it('keeps manuscript workspace identity provider-neutral and payload-free', () => {
    const capabilities = {
      schemaVersion: 1,
      interactionModes: ['checkpoint_pull', 'external_realtime_editor'],
      revisionTopology: 'linear',
      conditionalPublish: false,
      providerHistory: true,
      presence: false,
      comments: false,
      trackChanges: false,
      serverCompile: false,
      reviewMetadataRoundTrip: 'unsupported',
    } as const;
    const descriptor = ManuscriptWorkspaceDescriptorV1Schema.parse({
      schemaVersion: 1,
      providerId: 'provider-discovered-at-runtime',
      displayName: 'Provider discovered at runtime',
      workspaceKind: 'remote_git_checkpoint',
      collaborationModel: 'checkpoint',
      capabilities,
      unsupportedMetadata: ['comments', 'track_changes'],
      limitations: ['manual_checkpoint_only'],
    });
    const binding = ManuscriptWorkspaceBindingV1Schema.parse({
      schemaVersion: 1,
      bindingId: 'binding-1',
      projectId: 'project-1',
      manuscriptId: 'manuscript-1',
      providerId: descriptor.providerId,
      capabilitiesSnapshot: descriptor.capabilities,
      authority: 'provider',
      enabled: true,
      version: 1,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    });

    expect(binding.providerId).toBe('provider-discovered-at-runtime');
    expect(Object.keys(binding)).not.toEqual(
      expect.arrayContaining([
        'url',
        'token',
        'credential',
        'branch',
        'filesystemPath',
        'providerWorkspaceRef',
        'connectionRef',
      ]),
    );
    expect(() =>
      ManuscriptWorkspaceBindingV1Schema.parse({ ...binding, token: 'must-not-cross-contract' }),
    ).toThrow();
  });

  it('records immutable manuscript checkpoint provenance without source payloads', () => {
    const checkpoint = ManuscriptCheckpointV1Schema.parse({
      schemaVersion: 1,
      checkpointId: 'checkpoint-1',
      bindingId: 'binding-1',
      projectId: 'project-1',
      manuscriptId: 'manuscript-1',
      providerId: 'native-provider',
      direction: 'fetch',
      sourceAuthority: 'provider',
      sourceRevision: 'provider-revision-1',
      gosuRevision: 'gosu-revision-1',
      providerRevision: 'provider-revision-1',
      cursor: 'opaque-cursor-1',
      revisionEnvelopeDigest: `sha256:${'a'.repeat(64)}`,
      rootDocument: 'paper/main.tex',
      baseCheckpointId: null,
      actorId: 'actor-1',
      observedAt: '2026-08-11T00:00:00.000Z',
    });

    expect(checkpoint.rootDocument).toBe('paper/main.tex');
    expect(() =>
      ManuscriptCheckpointV1Schema.parse({ ...checkpoint, source: '\\documentclass{article}' }),
    ).toThrow();
    expect(() =>
      ManuscriptCheckpointV1Schema.parse({ ...checkpoint, rootDocument: '../outside.tex' }),
    ).toThrow();
  });

  it('rejects secret-like parameter values and command arguments in manifests', () => {
    const baseManifest = {
      schemaVersion: 1,
      jobId: 'job-1',
      campaignId: 'campaign-1',
      trialId: 'trial-1',
      attemptId: 'attempt-1',
      issuedAt: '2026-08-03T01:02:03.000Z',
      codeSha: `sha256:${'a'.repeat(64)}`,
      image: { reference: 'python:3.12', digest: `sha256:${'b'.repeat(64)}` },
      command: { executable: 'python3', args: ['train.py'] },
      parameters: { learningRate: 0.01 },
      seed: 7,
      resources: { cpuCores: 1, memoryMiB: 512, gpuCount: 0, gpuMemoryMiB: null },
      network: { mode: 'none', allowedHosts: [] },
      mounts: [
        {
          kind: 'workspace',
          sourceRef: 'job-source',
          containerPath: '/workspace',
          readOnly: false,
        },
      ],
      secretRefs: [],
      execution: {
        privileged: false,
        readOnlyRootFilesystem: true,
        noNewPrivileges: true,
        runAsUser: 1000,
        runAsGroup: 1000,
        capabilities: { drop: ['ALL'], add: [] },
      },
      timeoutSeconds: 60,
      objective: {
        objectiveVersionId: 'objective-1',
        version: 1,
        primaryMetric: {
          key: 'accuracy',
          displayName: 'Accuracy',
          direction: 'maximize',
          unit: null,
          aggregation: 'last',
          evaluatorHash: `sha256:${'c'.repeat(64)}`,
          datasetHash: `sha256:${'d'.repeat(64)}`,
          holdoutHash: null,
          baseline: null,
          target: null,
        },
        budget: {
          maxTrials: 10,
          maxConcurrentTrials: 1,
          maxWallTimeSeconds: 3600,
          maxGpuHours: 0,
          maxFailures: 2,
        },
      },
      policyVersion: 1,
      policyHash: 'local-policy-v1',
      manifestHash: `sha256:${'e'.repeat(64)}`,
      signature: { algorithm: 'ed25519', keyId: 'key-1', value: 'x'.repeat(64) },
    } as const;

    expect(
      JobManifestV1Schema.safeParse({
        ...baseManifest,
        parameters: { optimizer: { api_token: 'not-serialized-here' } },
      }).success,
    ).toBe(false);
    expect(
      JobManifestV1Schema.safeParse({
        ...baseManifest,
        command: { executable: 'python3', args: ['train.py', '--api-key=not-here'] },
      }).success,
    ).toBe(false);
  });

  it('exports named JSON Schemas', () => {
    const schema = contractJsonSchema('JobManifestV1');

    expect(schema).toHaveProperty('$schema');
    expect(JSON.stringify(schema)).toContain('JobManifestV1');
  });

  it('keeps committed schemas byte-for-byte aligned with Zod sources', async () => {
    const generatedDirectory = new URL('../generated/json-schema/', import.meta.url);
    const expected = await renderContractSchemaArtifacts();
    const expectedFiles = Object.keys(expected).sort();
    const actualFiles = (await readdir(generatedDirectory))
      .filter((file) => file.endsWith('.json'))
      .sort();

    expect(actualFiles).toEqual(expectedFiles);
    for (const [file, contents] of Object.entries(expected)) {
      await expect(readFile(new URL(file, generatedDirectory), 'utf8')).resolves.toBe(contents);
    }
  });

  it('produces a self-contained bundle with resolvable local references', async () => {
    const artifacts = await renderContractSchemaArtifacts();
    const bundle = JSON.parse(artifacts[CONTRACT_BUNDLE_FILE] ?? 'null') as unknown;
    const references = collectReferences(bundle);

    expect(references.length).toBeGreaterThan(0);
    expect(references.every((reference) => jsonPointerExists(bundle, reference))).toBe(true);
  });
});
