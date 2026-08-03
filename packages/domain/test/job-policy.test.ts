import type { JobManifestV1 } from '@gosu/contracts';
import { JobManifestV1Schema, ObjectiveVersionSchema } from '@gosu/contracts';
import { describe, expect, it } from 'vitest';

import { validateJobPolicy, validateObjectiveImmutability } from '../src/index.js';
import {
  budgetUsageFixture,
  manifestFixture,
  objectiveFixture,
  policyFixture,
} from './fixtures.js';

function issueCodes(result: ReturnType<typeof validateJobPolicy>): string[] {
  return result.ok ? [] : result.issues.map((entry) => entry.code);
}

function cloneManifest(): JobManifestV1 {
  return structuredClone(manifestFixture());
}

const verifiedSignature = {
  valid: true,
  manifestHash: `sha256:${'b'.repeat(64)}`,
  keyId: 'runner-key-1',
} as const;

describe('job policy', () => {
  it('accepts an isolated signed job within its approved objective and budget', () => {
    const manifest = JobManifestV1Schema.parse(manifestFixture());
    const objective = ObjectiveVersionSchema.parse(objectiveFixture());
    const result = validateJobPolicy(manifest, {
      approvedObjective: objective,
      budgetUsage: budgetUsageFixture(),
      policy: policyFixture(),
      signatureVerification: verifiedSignature,
    });

    expect(result).toEqual({ ok: true });
  });

  it('requires cryptographic signature verification before leasing', () => {
    const result = validateJobPolicy(manifestFixture(), {
      approvedObjective: objectiveFixture(),
      budgetUsage: budgetUsageFixture(),
      policy: policyFixture(),
      signatureVerification: { ...verifiedSignature, valid: false },
    });

    expect(issueCodes(result)).toContain('manifest_signature_not_verified');
  });

  it('binds signature verification to the manifest hash and signing key', () => {
    const result = validateJobPolicy(manifestFixture(), {
      approvedObjective: objectiveFixture(),
      budgetUsage: budgetUsageFixture(),
      policy: policyFixture(),
      signatureVerification: {
        valid: true,
        manifestHash: `sha256:${'c'.repeat(64)}`,
        keyId: 'different-key',
      },
    });

    expect(issueCodes(result)).toContain('manifest_signature_scope_mismatch');
  });

  it('rejects privileged execution, host mounts, and engine sockets', () => {
    const manifest = cloneManifest();
    manifest.execution.privileged = true;
    manifest.mounts.push({
      kind: 'host',
      sourceRef: '/srv/private',
      containerPath: '/host',
      readOnly: true,
    });
    manifest.mounts.push({
      kind: 'workspace',
      sourceRef: 'container-engine-socket',
      containerPath: '/var/run/docker.sock',
      readOnly: false,
    });

    const result = validateJobPolicy(manifest, {
      approvedObjective: objectiveFixture(),
      budgetUsage: budgetUsageFixture(),
      policy: policyFixture(),
      signatureVerification: verifiedSignature,
    });

    expect(issueCodes(result)).toEqual(
      expect.arrayContaining([
        'privileged_execution_forbidden',
        'host_mount_forbidden',
        'container_socket_mount_forbidden',
      ]),
    );
  });

  it('rejects metric and budget tampering in the manifest snapshot', () => {
    const manifest = cloneManifest();
    manifest.objective.primaryMetric.key = 'unapproved_metric';
    manifest.objective.budget.maxTrials += 1;

    const result = validateJobPolicy(manifest, {
      approvedObjective: objectiveFixture(),
      budgetUsage: budgetUsageFixture(),
      policy: policyFixture(),
      signatureVerification: verifiedSignature,
    });

    expect(issueCodes(result)).toEqual(
      expect.arrayContaining(['primary_metric_immutable', 'budget_immutable']),
    );
  });

  it('reserves worst-case wall time and GPU hours before leasing', () => {
    const usage = budgetUsageFixture();
    usage.wallTimeSeconds = 35_000;
    usage.gpuHours = 9.5;

    const result = validateJobPolicy(manifestFixture(), {
      approvedObjective: objectiveFixture(),
      budgetUsage: usage,
      policy: policyFixture(),
      signatureVerification: verifiedSignature,
    });

    expect(issueCodes(result)).toEqual(
      expect.arrayContaining(['wall_time_budget_exceeded', 'gpu_budget_exceeded']),
    );
  });

  it('requires a new version instead of editing an approved objective', () => {
    const current = objectiveFixture();
    const edited = structuredClone(current);
    edited.primaryMetric.direction = 'minimize';
    edited.budget.maxTrials = 20;

    const rejected = validateObjectiveImmutability(current, edited, 'active');
    expect(rejected).toMatchObject({
      ok: false,
      issues: [{ code: 'primary_metric_immutable' }, { code: 'budget_immutable' }],
    });

    const replacement = structuredClone(edited);
    replacement.objectiveVersionId = 'objective-v2';
    replacement.version = 2;
    expect(validateObjectiveImmutability(current, replacement, 'active')).toEqual({
      ok: true,
    });
  });
});
