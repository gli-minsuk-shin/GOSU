import { it, expect, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { act, create } from 'react-test-renderer';
import { ApprovalPolicyStore } from '../src/main/approval-policy-store';
import { ApprovalPolicySchema } from '../src/shared/approval-policy';
import { ApprovalPolicySettings } from '../src/renderer/src/approval-policy-settings';
it('defaults to scope reuse only after loading, persists opt-out and per-scope revocation across restarts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gosu-approval-policy-'));
  try {
    const path = join(dir, 'policy.json');
    const store = new ApprovalPolicyStore(path);
    expect(store.enabled()).toBe(false);
    await store.load();
    expect(store.enabled()).toBe(true);
    const id = '11111111-1111-4111-8111-111111111111';
    await store.revokeScope(id);
    expect(store.enabled(id)).toBe(false);
    expect(store.enabled('other')).toBe(true);
    const reopened = new ApprovalPolicyStore(path);
    await reopened.load();
    expect(reopened.enabled(id)).toBe(false);
    await reopened.set({ version: 1, reuseApprovedScopes: false });
    const final = new ApprovalPolicyStore(path);
    await final.load();
    expect(final.enabled()).toBe(false);
    await final.set({ version: 1, reuseApprovedScopes: true });
    const off = final.set({ version: 1, reuseApprovedScopes: false });
    const revoke = final.revokeScope('22222222-2222-4222-8222-222222222222');
    await Promise.all([off, revoke]);
    expect(final.enabled()).toBe(false);
    await writeFile(path, 'broken');
    await expect(final.load()).rejects.toThrow('approval_policy_unreadable');
    expect(final.enabled()).toBe(false);
    expect(
      ApprovalPolicySchema.safeParse({ version: 1, reuseApprovedScopes: true, newRoot: '/' })
        .success,
    ).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('shows the app-wide preference, saves once, and retains the old value on failed save', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const set = vi.fn().mockRejectedValue(new Error('save failed'));
  vi.stubGlobal('window', {
    gosu: {
      briefingLab: {
        getApprovalPolicy: async () => ({ version: 1, reuseApprovedScopes: true }),
        setApprovalPolicy: set,
      },
    },
  });
  let ui: ReturnType<typeof create>;
  try {
    await act(async () => {
      ui = create(<ApprovalPolicySettings />);
    });
    const checkbox = ui!.root.findByType('input');
    expect(checkbox.props.checked).toBe(true);
    await act(async () => {
      await checkbox.props.onChange({ target: { checked: false } });
    });
    expect(set).toHaveBeenCalledOnce();
    expect(ui!.root.findByType('input').props.checked).toBe(true);
    expect(ui!.root.findByProps({ role: 'alert' }).children.join('')).toContain(
      '저장하지 못했습니다',
    );
    await act(async () => ui!.unmount());
  } finally {
    vi.unstubAllGlobals();
  }
});
