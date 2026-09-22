import { z } from 'zod';
export const ApprovalPolicySchema = z
  .object({ version: z.literal(1), reuseApprovedScopes: z.boolean() })
  .strict();
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;
export const APPROVAL_POLICY_CHANNELS = {
  get: 'gosu:approval-policy:get',
  set: 'gosu:approval-policy:set',
} as const;
