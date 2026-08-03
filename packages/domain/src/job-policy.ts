import type {
  BudgetUsage,
  CampaignState,
  ExperimentBudget,
  JobManifestV1,
  JobPolicyV1,
  ObjectiveVersion,
  PrimaryMetric,
} from '@gosu/contracts';

import type { DomainIssue, DomainValidationResult } from './validation.js';
import { validationResult } from './validation.js';

export interface JobPolicyContext {
  readonly approvedObjective: ObjectiveVersion;
  readonly budgetUsage: BudgetUsage;
  readonly policy: JobPolicyV1;
  /** Result from the cryptographic verifier over the canonical manifest bytes. */
  readonly signatureVerification: {
    readonly valid: boolean;
    readonly manifestHash: JobManifestV1['manifestHash'];
    readonly keyId: string;
  };
}

const DOCKER_SOCKET_PATHS = new Set([
  '/var/run/docker.sock',
  '/run/docker.sock',
  '/var/run/podman/podman.sock',
  '/run/podman/podman.sock',
]);

const SHELL_EXECUTABLES = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

function issue(code: string, message: string, path: string): DomainIssue {
  return { code, message, path };
}

function normalizedExecutable(executable: string): string {
  const components = executable.split('/');
  return components.at(-1)?.toLowerCase() ?? executable.toLowerCase();
}

function isSocketPath(value: string): boolean {
  const normalized = value.trim().replace(/\/+$/, '').toLowerCase();
  return (
    DOCKER_SOCKET_PATHS.has(normalized) ||
    normalized.endsWith('/docker.sock') ||
    normalized.endsWith('/podman.sock') ||
    normalized.endsWith('/containerd.sock')
  );
}

function metricFingerprint(metric: PrimaryMetric): string {
  return JSON.stringify({
    key: metric.key,
    displayName: metric.displayName,
    direction: metric.direction,
    unit: metric.unit,
    aggregation: metric.aggregation,
    evaluatorHash: metric.evaluatorHash,
    datasetHash: metric.datasetHash,
    holdoutHash: metric.holdoutHash,
    baseline: metric.baseline,
    target: metric.target,
  });
}

function budgetFingerprint(budget: ExperimentBudget): string {
  return JSON.stringify({
    maxTrials: budget.maxTrials,
    maxConcurrentTrials: budget.maxConcurrentTrials,
    maxWallTimeSeconds: budget.maxWallTimeSeconds,
    maxGpuHours: budget.maxGpuHours,
    maxFailures: budget.maxFailures,
  });
}

function validateManifestIsolation(manifest: JobManifestV1): DomainIssue[] {
  const issues: DomainIssue[] = [];

  if (manifest.execution.privileged) {
    issues.push(
      issue(
        'privileged_execution_forbidden',
        'Privileged containers are forbidden',
        'execution.privileged',
      ),
    );
  }
  if (!manifest.execution.readOnlyRootFilesystem) {
    issues.push(
      issue(
        'writable_root_filesystem_forbidden',
        'The container root filesystem must be read-only',
        'execution.readOnlyRootFilesystem',
      ),
    );
  }
  if (!manifest.execution.noNewPrivileges) {
    issues.push(
      issue(
        'new_privileges_forbidden',
        'no-new-privileges must be enabled',
        'execution.noNewPrivileges',
      ),
    );
  }
  if (manifest.execution.capabilities.add.length > 0) {
    issues.push(
      issue(
        'added_capabilities_forbidden',
        'Linux capabilities cannot be added to a workload',
        'execution.capabilities.add',
      ),
    );
  }
  if (!manifest.execution.capabilities.drop.includes('ALL')) {
    issues.push(
      issue(
        'capabilities_must_be_dropped',
        'All inherited Linux capabilities must be dropped',
        'execution.capabilities.drop',
      ),
    );
  }

  if (manifest.network.mode === 'none' && manifest.network.allowedHosts.length > 0) {
    issues.push(
      issue(
        'network_default_deny_violation',
        'A network-disabled workload cannot declare allowed hosts',
        'network.allowedHosts',
      ),
    );
  }

  manifest.mounts.forEach((mount, index) => {
    if (mount.kind === 'host') {
      issues.push(
        issue('host_mount_forbidden', 'Direct host mounts are forbidden', `mounts.${index}.kind`),
      );
    }
    if (isSocketPath(mount.containerPath) || isSocketPath(mount.sourceRef)) {
      issues.push(
        issue(
          'container_socket_mount_forbidden',
          'Container engine sockets cannot be mounted into a workload',
          `mounts.${index}`,
        ),
      );
    }
    if (mount.kind === 'dataset' && !mount.readOnly) {
      issues.push(
        issue(
          'writable_dataset_mount_forbidden',
          'Dataset mounts must be read-only',
          `mounts.${index}.readOnly`,
        ),
      );
    }
  });

  if (
    SHELL_EXECUTABLES.has(normalizedExecutable(manifest.command.executable)) &&
    manifest.command.args.some((argument) => argument === '-c')
  ) {
    issues.push(
      issue(
        'raw_shell_command_forbidden',
        'Inline shell commands are forbidden; use an executable and argument array',
        'command',
      ),
    );
  }

  return issues;
}

function validateApprovedPolicy(
  manifest: JobManifestV1,
  policy: JobPolicyV1,
  signatureVerification: JobPolicyContext['signatureVerification'],
): DomainIssue[] {
  const issues: DomainIssue[] = [];

  if (!signatureVerification.valid) {
    issues.push(
      issue(
        'manifest_signature_not_verified',
        'The manifest signature must be cryptographically verified before leasing',
        'signature',
      ),
    );
  }
  if (
    signatureVerification.manifestHash !== manifest.manifestHash ||
    signatureVerification.keyId !== manifest.signature.keyId
  ) {
    issues.push(
      issue(
        'manifest_signature_scope_mismatch',
        'The verified hash and key must match this manifest',
        'manifestHash',
      ),
    );
  }

  if (manifest.policyVersion !== policy.policyVersion) {
    issues.push(
      issue(
        'policy_version_mismatch',
        'The manifest policy version is not the approved version',
        'policyVersion',
      ),
    );
  }
  if (manifest.policyHash !== policy.policyHash) {
    issues.push(
      issue('policy_hash_mismatch', 'The manifest policy hash is not approved', 'policyHash'),
    );
  }
  if (!policy.allowedSigningKeyIds.includes(manifest.signature.keyId)) {
    issues.push(
      issue(
        'untrusted_signing_key',
        'The manifest signing key is not trusted by this policy',
        'signature.keyId',
      ),
    );
  }
  if (!policy.allowedImageDigests.includes(manifest.image.digest)) {
    issues.push(
      issue(
        'image_digest_not_allowed',
        'The container image digest is not approved',
        'image.digest',
      ),
    );
  }
  if (manifest.timeoutSeconds > policy.maxJobTimeoutSeconds) {
    issues.push(
      issue(
        'job_timeout_exceeds_policy',
        'The job timeout exceeds the approved per-job limit',
        'timeoutSeconds',
      ),
    );
  }

  manifest.network.allowedHosts.forEach((host, index) => {
    if (!policy.allowedNetworkHosts.includes(host)) {
      issues.push(
        issue(
          'network_host_not_allowed',
          `Network host ${host} is not approved`,
          `network.allowedHosts.${index}`,
        ),
      );
    }
  });

  manifest.secretRefs.forEach((secret, index) => {
    if (!policy.allowedSecretRefs.includes(secret.ref)) {
      issues.push(
        issue(
          'secret_ref_not_allowed',
          `Secret reference ${secret.ref} is not approved`,
          `secretRefs.${index}.ref`,
        ),
      );
    }
  });

  return issues;
}

function validateObjectiveSnapshot(
  manifest: JobManifestV1,
  approvedObjective: ObjectiveVersion,
): DomainIssue[] {
  const issues: DomainIssue[] = [];

  if (
    manifest.objective.objectiveVersionId !== approvedObjective.objectiveVersionId ||
    manifest.objective.version !== approvedObjective.version
  ) {
    issues.push(
      issue(
        'objective_version_mismatch',
        'The job must use the explicitly approved objective version',
        'objective.objectiveVersionId',
      ),
    );
  }
  if (
    metricFingerprint(manifest.objective.primaryMetric) !==
    metricFingerprint(approvedObjective.primaryMetric)
  ) {
    issues.push(
      issue(
        'primary_metric_immutable',
        'The primary metric, evaluator, and dataset are immutable for an approved objective',
        'objective.primaryMetric',
      ),
    );
  }
  if (
    budgetFingerprint(manifest.objective.budget) !== budgetFingerprint(approvedObjective.budget)
  ) {
    issues.push(
      issue(
        'budget_immutable',
        'The campaign budget is immutable for an approved objective',
        'objective.budget',
      ),
    );
  }

  return issues;
}

function validateRemainingBudget(
  manifest: JobManifestV1,
  budget: ExperimentBudget,
  usage: BudgetUsage,
): DomainIssue[] {
  const issues: DomainIssue[] = [];

  if (usage.trialsStarted >= budget.maxTrials) {
    issues.push(
      issue(
        'trial_budget_exhausted',
        'The maximum number of trials has been reached',
        'objective.budget.maxTrials',
      ),
    );
  }
  if (usage.activeTrials >= budget.maxConcurrentTrials) {
    issues.push(
      issue(
        'concurrency_budget_exhausted',
        'The maximum number of concurrent trials has been reached',
        'objective.budget.maxConcurrentTrials',
      ),
    );
  }
  if (usage.wallTimeSeconds + manifest.timeoutSeconds > budget.maxWallTimeSeconds) {
    issues.push(
      issue(
        'wall_time_budget_exceeded',
        'The requested timeout exceeds the remaining wall-time budget',
        'timeoutSeconds',
      ),
    );
  }

  const reservedGpuHours = (manifest.resources.gpuCount * manifest.timeoutSeconds) / 3_600;
  if (usage.gpuHours + reservedGpuHours > budget.maxGpuHours) {
    issues.push(
      issue(
        'gpu_budget_exceeded',
        'The requested resources exceed the remaining GPU-hour budget',
        'resources.gpuCount',
      ),
    );
  }

  const failuresExhausted =
    budget.maxFailures === 0 ? usage.failures > 0 : usage.failures >= budget.maxFailures;
  if (failuresExhausted) {
    issues.push(
      issue(
        'failure_budget_exhausted',
        'The failure budget has been exhausted',
        'objective.budget.maxFailures',
      ),
    );
  }

  return issues;
}

/** Validates a parsed manifest against immutable approval and runner policy. */
export function validateJobPolicy(
  manifest: JobManifestV1,
  context: JobPolicyContext,
): DomainValidationResult {
  return validationResult([
    ...validateManifestIsolation(manifest),
    ...validateApprovedPolicy(manifest, context.policy, context.signatureVerification),
    ...validateObjectiveSnapshot(manifest, context.approvedObjective),
    ...validateRemainingBudget(manifest, context.approvedObjective.budget, context.budgetUsage),
  ]);
}

const OBJECTIVE_LOCKED_STATES = new Set<CampaignState>([
  'awaiting_approval',
  'active',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

/**
 * An approved objective may not be edited in place. Callers must create a new
 * ObjectiveVersion and put the campaign through approval again.
 */
export function validateObjectiveImmutability(
  current: ObjectiveVersion,
  proposed: ObjectiveVersion,
  campaignState: CampaignState,
): DomainValidationResult {
  const issues: DomainIssue[] = [];
  if (current.projectId !== proposed.projectId) {
    issues.push(
      issue(
        'objective_project_immutable',
        'An objective version cannot move between projects',
        'projectId',
      ),
    );
  }

  if (!OBJECTIVE_LOCKED_STATES.has(campaignState)) {
    return validationResult(issues);
  }

  const editsSameVersion =
    current.objectiveVersionId === proposed.objectiveVersionId &&
    current.version === proposed.version;

  if (
    editsSameVersion &&
    metricFingerprint(current.primaryMetric) !== metricFingerprint(proposed.primaryMetric)
  ) {
    issues.push(
      issue(
        'primary_metric_immutable',
        'Create and reapprove a new objective version to change the metric',
        'primaryMetric',
      ),
    );
  }
  if (
    editsSameVersion &&
    budgetFingerprint(current.budget) !== budgetFingerprint(proposed.budget)
  ) {
    issues.push(
      issue(
        'budget_immutable',
        'Create and reapprove a new objective version to change the budget',
        'budget',
      ),
    );
  }
  if (editsSameVersion && current.goal !== proposed.goal) {
    issues.push(
      issue(
        'objective_goal_immutable',
        'Create and reapprove a new objective version to change the goal',
        'goal',
      ),
    );
  }
  if (
    editsSameVersion &&
    JSON.stringify(current.guardrails) !== JSON.stringify(proposed.guardrails)
  ) {
    issues.push(
      issue(
        'objective_guardrails_immutable',
        'Create and reapprove a new objective version to change guardrails',
        'guardrails',
      ),
    );
  }
  if (
    editsSameVersion &&
    JSON.stringify(current.stopPolicy) !== JSON.stringify(proposed.stopPolicy)
  ) {
    issues.push(
      issue(
        'objective_stop_policy_immutable',
        'Create and reapprove a new objective version to change the stop policy',
        'stopPolicy',
      ),
    );
  }
  if (
    editsSameVersion &&
    (current.createdBy !== proposed.createdBy || current.createdAt !== proposed.createdAt)
  ) {
    issues.push(
      issue(
        'objective_provenance_immutable',
        'Objective version provenance cannot be edited',
        'createdAt',
      ),
    );
  }

  if (!editsSameVersion) {
    if (proposed.objectiveVersionId === current.objectiveVersionId) {
      issues.push(
        issue(
          'new_objective_version_id_required',
          'A replacement objective must have a new objectiveVersionId',
          'objectiveVersionId',
        ),
      );
    }
    if (proposed.version !== current.version + 1) {
      issues.push(
        issue(
          'objective_version_must_increment',
          'A replacement objective version must increment by exactly one',
          'version',
        ),
      );
    }
  }

  return validationResult(issues);
}
