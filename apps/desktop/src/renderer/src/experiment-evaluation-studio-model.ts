import type {
  ExperimentEvaluationListSnapshot,
  ExperimentEvaluationSessionDetail,
} from '../../shared/experiment-evaluation-contracts';
import type { ExperimentLoggingCustomField } from '../../shared/experiment-workspace-contracts';

function sameLoggingField(
  current: ExperimentLoggingCustomField,
  suggested: ExperimentLoggingCustomField,
) {
  return (
    current.key === suggested.key &&
    current.label === suggested.label &&
    current.type === suggested.type &&
    current.category === suggested.category &&
    current.unit === suggested.unit &&
    [...current.requiredAt].sort().join('|') === [...suggested.requiredAt].sort().join('|')
  );
}

export function buildEvaluationLoggingReview(
  currentFields: readonly ExperimentLoggingCustomField[],
  suggestedFields: readonly ExperimentLoggingCustomField[],
  replaceConflicts: boolean,
) {
  const currentByKey = new Map(currentFields.map((field) => [field.key, field]));
  const added: ExperimentLoggingCustomField[] = [];
  const unchanged: ExperimentLoggingCustomField[] = [];
  const conflicts: Array<{
    current: ExperimentLoggingCustomField;
    suggested: ExperimentLoggingCustomField;
  }> = [];

  for (const suggested of suggestedFields) {
    const current = currentByKey.get(suggested.key);
    if (!current) added.push(suggested);
    else if (sameLoggingField(current, suggested)) unchanged.push(suggested);
    else conflicts.push({ current, suggested });
  }

  const mergedByKey = new Map(currentFields.map((field) => [field.key, field]));
  for (const field of added) mergedByKey.set(field.key, field);
  if (replaceConflicts) {
    for (const { suggested } of conflicts) mergedByKey.set(suggested.key, suggested);
  }

  return {
    added,
    unchanged,
    conflicts,
    mergedFields: [...mergedByKey.values()],
    changeCount: added.length + (replaceConflicts ? conflicts.length : 0),
  } as const;
}

export function isCurrentEvaluationOperation(activeProjectId: string, operationProjectId: string) {
  return activeProjectId === operationProjectId;
}

export function isCurrentEvaluationRequest(
  activeProjectId: string,
  requestProjectId: string,
  requestId: number,
  latestRequestId: number,
) {
  return activeProjectId === requestProjectId && requestId === latestRequestId;
}

export function currentEvaluationSnapshot(
  snapshot: ExperimentEvaluationListSnapshot | null,
  projectId: string,
) {
  return snapshot?.projectId === projectId ? snapshot : null;
}

export function currentEvaluationDetail(
  detail: ExperimentEvaluationSessionDetail | null,
  projectId: string,
  selectedSessionId: string | null,
) {
  return detail?.session.projectId === projectId && detail.session.id === selectedSessionId
    ? detail
    : null;
}
