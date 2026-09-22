# Reuse existing GOSU-approved scopes

2026-09-14 source candidate [0.58.54](releases/0.58.54.md). See the
[maintenance guide](MAINTENANCE_GUIDE.md) and [SSH ADR](adr/0001-project-scoped-ssh-remote-work.md).

Settings → AI settings includes 작업 승인 / 이미 승인한 범위는 다시 묻지 않기. The app-owned
`approval-policy.v1.json` preference defaults on when first initialized and persists atomically
outside the installed bundle. Uninitialized/unreadable policy fails closed. Switching it off returns
to existing per-source policies, not revocation of an explicitly trusted grant. No LLM can change it.

- Briefing's exact approved profile can reuse its confirmation across Mail/Calendar/private-AI
  operations that already use `requiresPerRequestConfirmation`. Ownership and exact scope digest
  checks remain mandatory. Changing accounts, calendars, allowed source scope still requires approval.
  Standalone Briefing has no global override and retains its own policy.
- SSH typed workspace work uses the common broker across Project Chat, Model Lab integrations and
  delegated work. A currently granted workspace for an explicitly named standard user may reuse
  approval without a per-command dialog. The connection must not have changed after the grant was
  approved (connection.updatedAt ≤ grant.updatedAt). Existing project/root/operation/command limits
  are unchanged. Binding/version and policy are checked again immediately before transport.
- Reused SSH execution is bounded, cancellable and audited before execution using policyVersion=2;
  failure to store the audit prevents execution. No raw command output is newly persisted.
  Concurrent grant/profile changes still cancel or reject pending work.
- Root or unknown-user/alias targets are NOT automatically made trusted. Root requires its existing
  explicit trusted-workspace risk approvals. Diagnostics grants are not promoted to workspace access.
  “Standard” means explicitly named non-root SSH user, not a proven OS-level sandbox or UID check.
- Per-grant trusted-access revocation also durably blocks global reuse for that grant and cancels
  pending work. Explicitly enabling the existing trusted-access switch can reauthorize that grant.
  Removing a grant/account and switching projects never grant access to an unrelated resource.
- Experiment log viewing can use this same approved workspace scope, rather than opening an
  invisible chat approval; its existing exact log identity/hash checks remain.

This is not a raw-shell/full-disk permission, OS Automation/Calendar/Keychain bypass, new external
account grant, or blanket consent to send/delete/publish. Domain action confirmations and
content-specific approvals remain separate. Existing data and individual connection records are
not rewritten by migration. The global preference overrides only redundant per-request checks in
currently approved scopes; it does not infer approval from arbitrary chat text or source content.

Implementation: [policy store](../apps/desktop/src/main/approval-policy-store.ts),
[SSH broker](../apps/desktop/src/main/ssh-connection-service.ts),
[Briefing store](../apps/briefing-lab/briefing-workspace-store.ts),
[settings](../apps/desktop/src/renderer/src/approval-policy-settings.tsx).
