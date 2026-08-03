import { describe, expect, it } from 'vitest';

import { validateCampaignTransition, validateTrialTransition } from '../src/index.js';

describe('campaign transitions', () => {
  it('permits the approval and activation flow', () => {
    expect(validateCampaignTransition('draft', 'awaiting_approval')).toMatchObject({
      ok: true,
      noOp: false,
    });
    expect(validateCampaignTransition('awaiting_approval', 'active')).toMatchObject({
      ok: true,
      noOp: false,
    });
  });

  it('treats replayed state events as idempotent no-ops', () => {
    expect(validateCampaignTransition('active', 'active')).toEqual({
      ok: true,
      from: 'active',
      to: 'active',
      noOp: true,
    });
  });

  it('does not reopen a terminal campaign', () => {
    expect(validateCampaignTransition('completed', 'active')).toMatchObject({
      ok: false,
      issues: [{ code: 'invalid_campaign_transition' }],
    });
  });
});

describe('trial transitions', () => {
  it('supports lease, run, and success', () => {
    expect(validateTrialTransition('pending', 'leased').ok).toBe(true);
    expect(validateTrialTransition('leased', 'running').ok).toBe(true);
    expect(validateTrialTransition('running', 'succeeded').ok).toBe(true);
  });

  it('reconciles lost attempts without returning them to the queue', () => {
    expect(validateTrialTransition('lost', 'succeeded').ok).toBe(true);
    expect(validateTrialTransition('lost', 'pending')).toMatchObject({
      ok: false,
      issues: [{ code: 'invalid_trial_transition' }],
    });
  });
});
