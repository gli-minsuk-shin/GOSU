import { HERMES_ACP_APPROVAL_CHANNELS } from '../shared/hermes-acp-approval-channels';
import {
  ListPendingHermesAcpApprovalsInputSchema,
  ResolveHermesAcpApprovalInputSchema,
} from '../shared/hermes-acp-approval-contracts';
import type { HermesAcpApprovalService } from './hermes-acp-approval-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerHermesAcpApprovalIpc(
  register: RegisterHandler,
  approvals: HermesAcpApprovalService,
) {
  register(HERMES_ACP_APPROVAL_CHANNELS.listPendingApprovals, (value) => {
    const input = ListPendingHermesAcpApprovalsInputSchema.parse(value);
    return approvals.list(input.projectId, input.sessionId);
  });
  register(HERMES_ACP_APPROVAL_CHANNELS.resolveApproval, (value) => {
    const input = ResolveHermesAcpApprovalInputSchema.parse(value);
    return approvals.resolve(input.approvalId, input.decision);
  });
}
