import { describe, expect, it } from 'vitest';

import { HERMES_ACP_APPROVAL_CHANNELS } from '../src/shared/hermes-acp-approval-channels';
import {
  HERMES_ACP_APPROVAL_COMMAND_PREVIEW_MAX_LENGTH,
  HERMES_ACP_APPROVAL_MAX_PENDING_PER_SESSION,
  HERMES_ACP_APPROVAL_MAX_TTL_MS,
  HERMES_ACP_APPROVAL_SUMMARY_MAX_LENGTH,
  HermesAcpApprovalEventSchema,
  HermesAcpApprovalListSchema,
  HermesAcpApprovalRequestSchema,
  ListPendingHermesAcpApprovalsInputSchema,
  ResolveHermesAcpApprovalInputSchema,
  type HermesAcpApprovalRequest,
} from '../src/shared/hermes-acp-approval-contracts';

const request: HermesAcpApprovalRequest = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  sessionId: '33333333-3333-4333-8333-333333333333',
  acpSessionId: 'acp-session-opaque-fixture',
  toolCallId: 'tool-call-opaque-fixture',
  title: 'Run a project test',
  kind: 'execute',
  safeSummary: {
    text: 'Run the selected test target inside the active project workspace.',
    commandPreview: 'pnpm test --filter project-fixture',
  },
  options: ['allow_once', 'allow_session', 'deny'],
  createdAt: '2026-08-11T08:00:00.000Z',
  expiresAt: '2026-08-11T08:05:00.000Z',
};

describe('Hermes ACP approval contracts', () => {
  it('accepts a bounded project- and session-scoped request', () => {
    expect(HermesAcpApprovalRequestSchema.parse(request)).toEqual(request);
    expect(
      ListPendingHermesAcpApprovalsInputSchema.parse({
        projectId: request.projectId,
        sessionId: request.sessionId,
      }),
    ).toEqual({ projectId: request.projectId, sessionId: request.sessionId });
  });

  it('rejects raw tool payloads and output at every strict boundary', () => {
    expect(
      HermesAcpApprovalRequestSchema.safeParse({
        ...request,
        rawInput: { command: 'print secret environment' },
      }).success,
    ).toBe(false);
    expect(
      HermesAcpApprovalRequestSchema.safeParse({
        ...request,
        safeSummary: {
          ...request.safeSummary,
          rawOutput: 'private tool output',
        },
      }).success,
    ).toBe(false);
  });

  it('bounds display text, command previews, and opaque transport identifiers', () => {
    expect(
      HermesAcpApprovalRequestSchema.safeParse({
        ...request,
        safeSummary: { text: 'a'.repeat(HERMES_ACP_APPROVAL_SUMMARY_MAX_LENGTH + 1) },
      }).success,
    ).toBe(false);
    expect(
      HermesAcpApprovalRequestSchema.safeParse({
        ...request,
        safeSummary: {
          text: request.safeSummary.text,
          commandPreview: 'x'.repeat(HERMES_ACP_APPROVAL_COMMAND_PREVIEW_MAX_LENGTH + 1),
        },
      }).success,
    ).toBe(false);
    expect(
      HermesAcpApprovalRequestSchema.safeParse({
        ...request,
        acpSessionId: 'acp-session\nspoofed',
      }).success,
    ).toBe(false);
    expect(
      HermesAcpApprovalRequestSchema.safeParse({
        ...request,
        title: 'Safe title\u202eexe',
      }).success,
    ).toBe(false);
  });

  it('limits decisions to the three supported values and always requires deny', () => {
    expect(
      ResolveHermesAcpApprovalInputSchema.parse({
        approvalId: request.id,
        decision: 'allow_session',
      }),
    ).toEqual({ approvalId: request.id, decision: 'allow_session' });
    expect(
      ResolveHermesAcpApprovalInputSchema.safeParse({
        approvalId: request.id,
        decision: 'allow_always',
      }).success,
    ).toBe(false);
    expect(
      HermesAcpApprovalRequestSchema.safeParse({
        ...request,
        options: ['allow_once', 'allow_session'],
      }).success,
    ).toBe(false);
    expect(
      HermesAcpApprovalRequestSchema.safeParse({
        ...request,
        options: ['allow_once', 'deny', 'deny'],
      }).success,
    ).toBe(false);
  });

  it('requires a short positive approval lifetime', () => {
    expect(
      HermesAcpApprovalRequestSchema.safeParse({
        ...request,
        expiresAt: request.createdAt,
      }).success,
    ).toBe(false);
    expect(
      HermesAcpApprovalRequestSchema.safeParse({
        ...request,
        expiresAt: new Date(
          Date.parse(request.createdAt) + HERMES_ACP_APPROVAL_MAX_TTL_MS + 1,
        ).toISOString(),
      }).success,
    ).toBe(false);
  });

  it('bounds pending lists and validates requested and resolved events', () => {
    expect(
      HermesAcpApprovalListSchema.safeParse(
        Array.from({ length: HERMES_ACP_APPROVAL_MAX_PENDING_PER_SESSION + 1 }, () => request),
      ).success,
    ).toBe(false);
    expect(HermesAcpApprovalEventSchema.parse({ type: 'approval.requested', request })).toEqual({
      type: 'approval.requested',
      request,
    });
    expect(
      HermesAcpApprovalEventSchema.parse({
        type: 'approval.resolved',
        approvalId: request.id,
        projectId: request.projectId,
        sessionId: request.sessionId,
        acpSessionId: request.acpSessionId,
        toolCallId: request.toolCallId,
        resolution: 'allowed_session',
        resolvedAt: '2026-08-11T08:00:30.000Z',
      }),
    ).toMatchObject({ type: 'approval.resolved', resolution: 'allowed_session' });
  });

  it('uses separate fixed invoke and event channel names', () => {
    expect(HERMES_ACP_APPROVAL_CHANNELS).toEqual({
      listPendingApprovals: 'gosu:hermes-acp:list-pending-approvals',
      resolveApproval: 'gosu:hermes-acp:resolve-approval',
      event: 'gosu:hermes-acp:approval-event',
    });
    expect(new Set(Object.values(HERMES_ACP_APPROVAL_CHANNELS)).size).toBe(3);
  });
});
