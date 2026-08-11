import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  HERMES_ACP_APPROVAL_MAX_PENDING_PER_SESSION,
  HermesAcpApprovalEventSchema,
  HermesAcpApprovalListSchema,
  HermesAcpApprovalRequestSchema,
  type HermesAcpApprovalDecision,
  type HermesAcpApprovalEvent,
  type HermesAcpApprovalRequest,
  type HermesAcpApprovalResolution,
} from '../shared/hermes-acp-approval-contracts';

export type HermesAcpPermissionOption = Readonly<{
  optionId: string;
  kind: string;
  name: string;
}>;

export type HermesAcpPermissionOutcome =
  Readonly<{ outcome: 'selected'; optionId: string }> | Readonly<{ outcome: 'cancelled' }>;

type PendingApproval = Readonly<{
  request: HermesAcpApprovalRequest;
  optionIdByDecision: ReadonlyMap<HermesAcpApprovalDecision, string>;
  resolve: (outcome: HermesAcpPermissionOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}>;

const APPROVAL_TTL_MS = 55_000;

function displayText(value: unknown, maximum: number, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const normalized = value
    .replace(/[\p{Cc}\p{Cs}\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized.slice(0, maximum) || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnsafeMultilineCharacter(character: string) {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    codePoint <= 0x08 ||
    codePoint === 0x0b ||
    codePoint === 0x0c ||
    (codePoint >= 0x0e && codePoint <= 0x1f) ||
    codePoint === 0x7f ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function containsUnsafeMultilineCharacter(value: string) {
  return [...value].some(isUnsafeMultilineCharacter);
}

function boundedMultilineDisplay(value: string, maximum: number) {
  let result = '';
  for (const character of value) {
    const next = isUnsafeMultilineCharacter(character) ? '\ufffd' : character;
    if (result.length + next.length > maximum) break;
    result += next;
  }
  return result;
}

function commandPreview(toolCall: Record<string, unknown>) {
  // The ACP transport deliberately removes raw tool payloads before this boundary. Hermes may
  // provide a human-readable text block for the approval dialog. Execution approval must remain
  // bound to the complete, semantics-preserving preview: never collapse newlines or silently cut
  // a suffix that the user has not reviewed.
  if (typeof toolCall.displayText !== 'string') return undefined;
  if (
    toolCall.displayText.trim().length === 0 ||
    toolCall.displayTextTruncated !== false ||
    toolCall.displayTextUnsafe !== false ||
    toolCall.displayText.length > 2_048 ||
    containsUnsafeMultilineCharacter(toolCall.displayText)
  ) {
    return null;
  }
  return toolCall.displayText;
}

function editPreview(toolCall: Record<string, unknown>) {
  if (!isRecord(toolCall.editPreview)) return undefined;
  const preview = toolCall.editPreview;
  if (typeof preview.path !== 'string' || typeof preview.newText !== 'string') return undefined;
  const sanitizeMultiline = (value: string, maximum: number) =>
    boundedMultilineDisplay(value, maximum);
  const oldText = typeof preview.oldText === 'string' ? preview.oldText : null;
  const pathUnsafe = [...preview.path].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      codePoint === 0x7f ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
  return {
    path: preview.path,
    pathTruncated: preview.pathTruncated !== false || preview.path.length > 1_024,
    pathUnsafe: preview.pathUnsafe !== false || pathUnsafe,
    oldText: oldText === null ? null : sanitizeMultiline(oldText, 32 * 1_024),
    newText: sanitizeMultiline(preview.newText, 32 * 1_024),
    oldTextTruncated:
      preview.oldTextTruncated !== false || (oldText !== null && oldText.length > 32 * 1_024),
    newTextTruncated: preview.newTextTruncated !== false || preview.newText.length > 32 * 1_024,
    oldTextUnsafe:
      preview.oldTextUnsafe !== false ||
      (oldText !== null && containsUnsafeMultilineCharacter(oldText)),
    newTextUnsafe:
      preview.newTextUnsafe !== false || containsUnsafeMultilineCharacter(preview.newText),
  };
}

function optionMap(options: readonly HermesAcpPermissionOption[]) {
  const mapped = new Map<HermesAcpApprovalDecision, string>();
  const allowOnce = options.find(
    (option) => option.kind === 'allow_once' || option.optionId === 'allow_once',
  );
  if (allowOnce) mapped.set('allow_once', allowOnce.optionId);
  const allowSession = options.find(
    (option) =>
      option.optionId === 'allow_session' ||
      ((option.kind === 'allow_always' || option.kind === 'allow_session') &&
        /session|always/iu.test(option.name)),
  );
  if (allowSession) mapped.set('allow_session', allowSession.optionId);
  mapped.set('deny', '');
  return mapped;
}

export class HermesAcpApprovalService extends EventEmitter {
  private readonly pending = new Map<string, PendingApproval>();

  request(input: {
    projectId: string;
    sessionId: string;
    acpSessionId: string;
    options: readonly HermesAcpPermissionOption[];
    toolCall: unknown;
  }): Promise<HermesAcpPermissionOutcome> {
    const scopedCount = [...this.pending.values()].filter(
      ({ request }) =>
        request.projectId === input.projectId && request.sessionId === input.sessionId,
    ).length;
    if (scopedCount >= HERMES_ACP_APPROVAL_MAX_PENDING_PER_SESSION) {
      return Promise.resolve({ outcome: 'cancelled' });
    }
    const toolCall = isRecord(input.toolCall) ? input.toolCall : {};
    const mappedOptions = optionMap(input.options);
    const normalizedKind = displayText(toolCall.kind, 64, 'other')
      .toLowerCase()
      .replace(/[^a-z0-9._-]/gu, '_');
    const safeKind = /^[a-z][a-z0-9._-]*$/u.test(normalizedKind) ? normalizedKind : 'other';
    const preview = commandPreview(toolCall);
    const proposedEdit = editPreview(toolCall);
    // An edit without an exact bounded before/after preview is not an informed approval.
    if (
      safeKind === 'edit' &&
      (!proposedEdit ||
        proposedEdit.pathTruncated ||
        proposedEdit.pathUnsafe ||
        proposedEdit.oldTextTruncated ||
        proposedEdit.newTextTruncated ||
        proposedEdit.oldTextUnsafe ||
        proposedEdit.newTextUnsafe)
    ) {
      return Promise.resolve({ outcome: 'cancelled' });
    }
    // Execute requests without an exact, bounded, semantics-preserving preview are not approvable.
    if (safeKind === 'execute' && (preview === undefined || preview === null)) {
      return Promise.resolve({ outcome: 'cancelled' });
    }
    const createdAt = new Date();
    const request = HermesAcpApprovalRequestSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      projectId: input.projectId,
      sessionId: input.sessionId,
      acpSessionId: displayText(input.acpSessionId, 256, 'hermes-session'),
      toolCallId: displayText(toolCall.toolCallId, 256, `hermes-tool-${randomUUID()}`),
      title: displayText(toolCall.title, 160, 'Hermes agent operation'),
      kind: safeKind,
      safeSummary: {
        text: displayText(
          toolCall.title,
          2_000,
          'Hermes requests permission to continue this agent operation.',
        ),
        ...(preview ? { commandPreview: preview } : {}),
      },
      ...(proposedEdit ? { editPreview: proposedEdit } : {}),
      options: [...mappedOptions.keys()],
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + APPROVAL_TTL_MS).toISOString(),
    });

    return new Promise<HermesAcpPermissionOutcome>((resolve) => {
      const timer = setTimeout(() => this.finish(request.id, 'expired'), APPROVAL_TTL_MS);
      timer.unref?.();
      this.pending.set(request.id, { request, optionIdByDecision: mappedOptions, resolve, timer });
      this.emitEvent({ type: 'approval.requested', request });
    });
  }

  list(projectId: string, sessionId: string) {
    return HermesAcpApprovalListSchema.parse(
      [...this.pending.values()]
        .map(({ request }) => request)
        .filter((request) => request.projectId === projectId && request.sessionId === sessionId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  resolve(approvalId: string, decision: HermesAcpApprovalDecision) {
    const pending = this.pending.get(approvalId);
    if (!pending) throw new Error('hermes_acp_approval_not_found');
    if (!pending.optionIdByDecision.has(decision)) {
      throw new Error('hermes_acp_approval_decision_not_offered');
    }
    const resolution: HermesAcpApprovalResolution =
      decision === 'allow_once'
        ? 'allowed_once'
        : decision === 'allow_session'
          ? 'allowed_session'
          : 'denied';
    this.finish(approvalId, resolution, decision);
    return { outcome: decision === 'deny' ? ('denied' as const) : ('allowed' as const) };
  }

  cancelAcpSession(projectId: string, sessionId: string, acpSessionId: string) {
    const ids = [...this.pending.values()]
      .filter(
        ({ request }) =>
          request.projectId === projectId &&
          request.sessionId === sessionId &&
          request.acpSessionId === acpSessionId,
      )
      .map(({ request }) => request.id);
    for (const id of ids) this.finish(id, 'cancelled');
    return ids.length;
  }

  cancelAll() {
    const ids = [...this.pending.keys()];
    for (const id of ids) this.finish(id, 'cancelled');
    return ids.length;
  }

  private finish(
    approvalId: string,
    resolution: HermesAcpApprovalResolution,
    decision: HermesAcpApprovalDecision = 'deny',
  ) {
    const pending = this.pending.get(approvalId);
    if (!pending) return;
    this.pending.delete(approvalId);
    clearTimeout(pending.timer);
    const optionId = pending.optionIdByDecision.get(decision);
    pending.resolve(
      decision !== 'deny' && optionId
        ? { outcome: 'selected', optionId }
        : { outcome: 'cancelled' },
    );
    this.emitEvent({
      type: 'approval.resolved',
      approvalId,
      projectId: pending.request.projectId,
      sessionId: pending.request.sessionId,
      acpSessionId: pending.request.acpSessionId,
      toolCallId: pending.request.toolCallId,
      resolution,
      resolvedAt: new Date().toISOString(),
    });
  }

  private emitEvent(event: HermesAcpApprovalEvent) {
    this.emit('event', HermesAcpApprovalEventSchema.parse(event));
  }
}
