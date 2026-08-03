import type { BudgetUsage, JobManifestV1, JobPolicyV1, ObjectiveVersion } from '@gosu/contracts';

const IMAGE_DIGEST = `sha256:${'a'.repeat(64)}`;

export function objectiveFixture(): ObjectiveVersion {
  return {
    schemaVersion: 1,
    objectiveVersionId: 'objective-v1',
    projectId: 'project-1',
    version: 1,
    goal: 'Improve the held-out evaluation score',
    primaryMetric: {
      key: 'quality_score',
      displayName: 'Quality score',
      direction: 'maximize',
      unit: null,
      aggregation: 'mean',
      evaluatorHash: 'evaluator:abcd1234',
      datasetHash: 'dataset:abcd1234',
      holdoutHash: 'holdout:abcd1234',
      baseline: 0.5,
      target: 0.8,
    },
    guardrails: [],
    budget: {
      maxTrials: 10,
      maxConcurrentTrials: 2,
      maxWallTimeSeconds: 36_000,
      maxGpuHours: 10,
      maxFailures: 3,
    },
    stopPolicy: {
      stopWhenTargetReached: true,
      guardrailAction: 'pause',
      maxConsecutiveNoImprovement: 5,
    },
    createdBy: 'researcher-1',
    createdAt: '2026-08-03T01:00:00.000Z',
  };
}

export function manifestFixture(): JobManifestV1 {
  const objective = objectiveFixture();

  return {
    schemaVersion: 1,
    jobId: 'job-1',
    campaignId: 'campaign-1',
    trialId: 'trial-1',
    attemptId: 'attempt-1',
    issuedAt: '2026-08-03T01:01:00.000Z',
    codeSha: 'git:abcdef0123456789',
    image: {
      reference: 'registry.example/research@sha256:fixture',
      digest: IMAGE_DIGEST,
    },
    command: {
      executable: '/workspace/train',
      args: ['--config', '/workspace/config.json'],
    },
    parameters: { learningRate: 0.01, optimizer: 'adaptive' },
    seed: 42,
    resources: {
      cpuCores: 2,
      memoryMiB: 4_096,
      gpuCount: 1,
      gpuMemoryMiB: 16_384,
    },
    network: { mode: 'none', allowedHosts: [] },
    mounts: [
      {
        kind: 'dataset',
        sourceRef: 'dataset-version-1',
        containerPath: '/data',
        readOnly: true,
      },
      {
        kind: 'workspace',
        sourceRef: 'workspace-trial-1',
        containerPath: '/workspace',
        readOnly: false,
      },
    ],
    secretRefs: [],
    execution: {
      privileged: false,
      readOnlyRootFilesystem: true,
      noNewPrivileges: true,
      runAsUser: 10_000,
      runAsGroup: 10_000,
      capabilities: { drop: ['ALL'], add: [] },
    },
    timeoutSeconds: 3_600,
    objective: {
      objectiveVersionId: objective.objectiveVersionId,
      version: objective.version,
      primaryMetric: objective.primaryMetric,
      budget: objective.budget,
    },
    policyVersion: 1,
    policyHash: 'policy:abcdef01',
    manifestHash: `sha256:${'b'.repeat(64)}`,
    signature: {
      algorithm: 'ed25519',
      keyId: 'runner-key-1',
      value: 'fixture-signature-value-that-is-long-enough',
    },
  };
}

export function policyFixture(): JobPolicyV1 {
  return {
    schemaVersion: 1,
    policyVersion: 1,
    policyHash: 'policy:abcdef01',
    allowedSigningKeyIds: ['runner-key-1'],
    allowedImageDigests: [IMAGE_DIGEST],
    allowedNetworkHosts: [],
    allowedSecretRefs: [],
    maxJobTimeoutSeconds: 7_200,
  };
}

export function budgetUsageFixture(): BudgetUsage {
  return {
    trialsStarted: 1,
    activeTrials: 0,
    wallTimeSeconds: 1_000,
    gpuHours: 0.5,
    failures: 0,
  };
}
