import { z } from 'zod';

export const HERMES_ACP_APPROVAL_TITLE_MAX_LENGTH = 160;
export const HERMES_ACP_APPROVAL_KIND_MAX_LENGTH = 64;
export const HERMES_ACP_APPROVAL_SUMMARY_MAX_LENGTH = 2_000;
export const HERMES_ACP_APPROVAL_COMMAND_PREVIEW_MAX_LENGTH = 2_048;
export const HERMES_ACP_APPROVAL_OPAQUE_ID_MAX_LENGTH = 256;
export const HERMES_ACP_APPROVAL_EDIT_PATH_MAX_LENGTH = 1_024;
export const HERMES_ACP_APPROVAL_EDIT_TEXT_MAX_LENGTH = 32 * 1_024;
export const HERMES_ACP_APPROVAL_MAX_PENDING_PER_SESSION = 16;
export const HERMES_ACP_APPROVAL_MAX_TTL_MS = 5 * 60_000;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const unsafeDisplayCharacterPattern = /[\p{Cc}\p{Cs}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

function safeDisplayTextSchema(maximum: number) {
  return z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), 'Leading or trailing whitespace is not allowed')
    .refine(
      (value) => !unsafeDisplayCharacterPattern.test(value),
      'Control, surrogate, and bidirectional override characters are not allowed',
    );
}

function containsUnsafeMultilineCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
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
    ) {
      return true;
    }
  }
  return false;
}

function safeMultilineTextSchema(maximum: number) {
  return z
    .string()
    .max(maximum)
    .refine(
      (value) => !containsUnsafeMultilineCharacter(value),
      'Unsafe control, surrogate, or bidirectional override characters are not allowed',
    );
}

const opaqueIdSchema = safeDisplayTextSchema(HERMES_ACP_APPROVAL_OPAQUE_ID_MAX_LENGTH);

export const HermesAcpApprovalDecisionSchema = z.enum(['allow_once', 'allow_session', 'deny']);

export type HermesAcpApprovalDecision = z.infer<typeof HermesAcpApprovalDecisionSchema>;

export const HermesAcpApprovalResolutionSchema = z.enum([
  'allowed_once',
  'allowed_session',
  'denied',
  'expired',
  'cancelled',
]);

export type HermesAcpApprovalResolution = z.infer<typeof HermesAcpApprovalResolutionSchema>;

export const HermesAcpApprovalSafeSummarySchema = z
  .object({
    text: safeDisplayTextSchema(HERMES_ACP_APPROVAL_SUMMARY_MAX_LENGTH),
    commandPreview: safeMultilineTextSchema(
      HERMES_ACP_APPROVAL_COMMAND_PREVIEW_MAX_LENGTH,
    ).optional(),
  })
  .strict();

export const HermesAcpApprovalEditPreviewSchema = z
  .object({
    path: safeDisplayTextSchema(HERMES_ACP_APPROVAL_EDIT_PATH_MAX_LENGTH),
    pathTruncated: z.literal(false),
    pathUnsafe: z.literal(false),
    oldText: safeMultilineTextSchema(HERMES_ACP_APPROVAL_EDIT_TEXT_MAX_LENGTH).nullable(),
    newText: safeMultilineTextSchema(HERMES_ACP_APPROVAL_EDIT_TEXT_MAX_LENGTH),
    oldTextTruncated: z.boolean(),
    newTextTruncated: z.boolean(),
    oldTextUnsafe: z.literal(false),
    newTextUnsafe: z.literal(false),
  })
  .strict();

export type HermesAcpApprovalSafeSummary = z.infer<typeof HermesAcpApprovalSafeSummarySchema>;

const approvalOptionsSchema = z
  .array(HermesAcpApprovalDecisionSchema)
  .min(1)
  .max(HermesAcpApprovalDecisionSchema.options.length)
  .refine((options) => new Set(options).size === options.length, 'Duplicate approval options')
  .refine((options) => options.includes('deny'), 'A deny option is required');

export const HermesAcpApprovalRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    sessionId: uuidSchema,
    acpSessionId: opaqueIdSchema,
    toolCallId: opaqueIdSchema,
    title: safeDisplayTextSchema(HERMES_ACP_APPROVAL_TITLE_MAX_LENGTH),
    kind: safeDisplayTextSchema(HERMES_ACP_APPROVAL_KIND_MAX_LENGTH).regex(
      /^[a-z][a-z0-9._-]*$/u,
      'Approval kind must be a safe lowercase token',
    ),
    safeSummary: HermesAcpApprovalSafeSummarySchema,
    editPreview: HermesAcpApprovalEditPreviewSchema.optional(),
    options: approvalOptionsSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const createdAt = Date.parse(request.createdAt);
    const expiresAt = Date.parse(request.expiresAt);
    if (expiresAt <= createdAt) {
      context.addIssue({
        code: 'custom',
        message: 'Approval expiry must be after creation',
        path: ['expiresAt'],
      });
      return;
    }
    if (expiresAt - createdAt > HERMES_ACP_APPROVAL_MAX_TTL_MS) {
      context.addIssue({
        code: 'custom',
        message: 'Approval lifetime exceeds the maximum',
        path: ['expiresAt'],
      });
    }
  });

export type HermesAcpApprovalRequest = z.infer<typeof HermesAcpApprovalRequestSchema>;

export const HermesAcpApprovalListSchema = z
  .array(HermesAcpApprovalRequestSchema)
  .max(HERMES_ACP_APPROVAL_MAX_PENDING_PER_SESSION);

export type HermesAcpApprovalList = z.infer<typeof HermesAcpApprovalListSchema>;

export const ListPendingHermesAcpApprovalsInputSchema = z
  .object({
    projectId: uuidSchema,
    sessionId: uuidSchema,
  })
  .strict();

export type ListPendingHermesAcpApprovalsInput = z.infer<
  typeof ListPendingHermesAcpApprovalsInputSchema
>;

export const ResolveHermesAcpApprovalInputSchema = z
  .object({
    approvalId: uuidSchema,
    decision: HermesAcpApprovalDecisionSchema,
  })
  .strict();

export type ResolveHermesAcpApprovalInput = z.infer<typeof ResolveHermesAcpApprovalInputSchema>;

const HermesAcpApprovalResolvedEventSchema = z
  .object({
    type: z.literal('approval.resolved'),
    approvalId: uuidSchema,
    projectId: uuidSchema,
    sessionId: uuidSchema,
    acpSessionId: opaqueIdSchema,
    toolCallId: opaqueIdSchema,
    resolution: HermesAcpApprovalResolutionSchema,
    resolvedAt: timestampSchema,
  })
  .strict();

export const HermesAcpApprovalEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('approval.requested'),
      request: HermesAcpApprovalRequestSchema,
    })
    .strict(),
  HermesAcpApprovalResolvedEventSchema,
]);

export type HermesAcpApprovalEvent = z.infer<typeof HermesAcpApprovalEventSchema>;
