import type { CampaignState, TrialState } from '@gosu/contracts';

import type { DomainIssue, DomainValidationResult } from './validation.js';

export interface TransitionValidationSuccess<State extends string> {
  readonly ok: true;
  readonly from: State;
  readonly to: State;
  readonly noOp: boolean;
}

export interface TransitionValidationFailure<State extends string> {
  readonly ok: false;
  readonly from: State;
  readonly to: State;
  readonly issues: readonly DomainIssue[];
}

export type TransitionValidationResult<State extends string> =
  TransitionValidationSuccess<State> | TransitionValidationFailure<State>;

export const CAMPAIGN_TRANSITIONS = {
  draft: ['awaiting_approval', 'cancelled'],
  awaiting_approval: ['draft', 'active', 'cancelled'],
  active: ['paused', 'completed', 'failed', 'cancelled'],
  paused: ['active', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
} as const satisfies Readonly<Record<CampaignState, readonly CampaignState[]>>;

export const TRIAL_TRANSITIONS = {
  pending: ['leased', 'cancelled'],
  leased: ['running', 'cancelled', 'lost'],
  running: ['succeeded', 'failed', 'pruned', 'cancelled', 'lost'],
  succeeded: [],
  failed: [],
  pruned: [],
  cancelled: [],
  // Reconciliation may prove that a lost attempt was still running or had
  // already reached a terminal state. It must never return directly to a queue.
  lost: ['running', 'succeeded', 'failed', 'pruned', 'cancelled'],
} as const satisfies Readonly<Record<TrialState, readonly TrialState[]>>;

function validateTransition<State extends string>(
  kind: 'campaign' | 'trial',
  transitions: Readonly<Record<State, readonly State[]>>,
  from: State,
  to: State,
): TransitionValidationResult<State> {
  if (from === to) {
    return { ok: true, from, to, noOp: true };
  }

  if (transitions[from].includes(to)) {
    return { ok: true, from, to, noOp: false };
  }

  return {
    ok: false,
    from,
    to,
    issues: [
      {
        code: `invalid_${kind}_transition`,
        message: `Cannot transition ${kind} from ${from} to ${to}`,
        path: 'state',
      },
    ],
  };
}

export function validateCampaignTransition(
  from: CampaignState,
  to: CampaignState,
): TransitionValidationResult<CampaignState> {
  return validateTransition('campaign', CAMPAIGN_TRANSITIONS, from, to);
}

export function validateTrialTransition(
  from: TrialState,
  to: TrialState,
): TransitionValidationResult<TrialState> {
  return validateTransition('trial', TRIAL_TRANSITIONS, from, to);
}

export function canTransitionCampaign(from: CampaignState, to: CampaignState): boolean {
  return validateCampaignTransition(from, to).ok;
}

export function canTransitionTrial(from: TrialState, to: TrialState): boolean {
  return validateTrialTransition(from, to).ok;
}

export function asDomainValidationResult<State extends string>(
  result: TransitionValidationResult<State>,
): DomainValidationResult {
  return result.ok ? { ok: true } : { ok: false, issues: result.issues };
}
