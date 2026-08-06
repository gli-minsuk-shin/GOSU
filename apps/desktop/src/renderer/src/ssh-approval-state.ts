import type { SshApprovalRequest } from '../../shared/ssh-contracts';

export type SshApprovalScope = Readonly<{
  projectId: string;
  sessionId: string;
}>;

export const SSH_APPROVAL_RESOLUTION_TOMBSTONE_LIMIT = 256;

function orderApprovals(requests: readonly SshApprovalRequest[]) {
  return [...requests].sort(
    (left, right) =>
      left.requestedAt.localeCompare(right.requestedAt) || left.id.localeCompare(right.id),
  );
}

export function upsertSshApproval(
  current: readonly SshApprovalRequest[],
  request: SshApprovalRequest,
) {
  return orderApprovals([...current.filter((candidate) => candidate.id !== request.id), request]);
}

export function removeSshApproval(current: readonly SshApprovalRequest[], approvalId: string) {
  return current.filter((request) => request.id !== approvalId);
}

export function shouldPresentSshApproval(
  request: SshApprovalRequest,
  scope: SshApprovalScope | null,
  resolvedApprovalIds: ReadonlySet<string>,
) {
  return (
    scope !== null &&
    request.projectId === scope.projectId &&
    request.sessionId === scope.sessionId &&
    !resolvedApprovalIds.has(request.id)
  );
}

export function enqueueVisibleSshApproval(
  current: readonly SshApprovalRequest[],
  request: SshApprovalRequest,
  scope: SshApprovalScope | null,
  resolvedApprovalIds: ReadonlySet<string>,
) {
  return shouldPresentSshApproval(request, scope, resolvedApprovalIds)
    ? upsertSshApproval(current, request)
    : current;
}

export function rememberResolvedSshApproval(
  current: ReadonlySet<string>,
  approvalId: string,
  maximum = SSH_APPROVAL_RESOLUTION_TOMBSTONE_LIMIT,
) {
  const next = new Set(current);
  next.delete(approvalId);
  next.add(approvalId);
  while (next.size > maximum) {
    const oldest = next.values().next().value as string | undefined;
    if (!oldest) break;
    next.delete(oldest);
  }
  return next;
}

export function mergeHydratedSshApprovals(
  current: readonly SshApprovalRequest[],
  hydrated: readonly SshApprovalRequest[],
  scope: SshApprovalScope,
  resolvedApprovalIds: ReadonlySet<string>,
  now = Date.now(),
) {
  const byId = new Map(
    current
      .filter(
        (request) =>
          request.projectId === scope.projectId &&
          request.sessionId === scope.sessionId &&
          !resolvedApprovalIds.has(request.id) &&
          Date.parse(request.expiresAt) > now,
      )
      .map((request) => [request.id, request]),
  );
  for (const request of hydrated) {
    if (
      request.projectId !== scope.projectId ||
      request.sessionId !== scope.sessionId ||
      resolvedApprovalIds.has(request.id) ||
      Date.parse(request.expiresAt) <= now
    ) {
      continue;
    }
    byId.set(request.id, request);
  }
  return orderApprovals([...byId.values()]);
}
