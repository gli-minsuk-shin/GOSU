import { readFile, readdir } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  JobManifestV1Schema,
  ModelDescriptorSchema,
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
