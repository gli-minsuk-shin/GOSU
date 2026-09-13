# Optional Research Notes in Project Chat

GOSU 0.58.6 continues Project Chat automatically when Research Notes are absent,
unavailable, unapproved, or bound to a stale folder. There is no extra "continue without
notes" confirmation. Model selection, attachment, project lifecycle, and provider errors
still retain their normal validation.

## Per-turn capability

Main resolves the previously saved project grant before constructing the tool session.
It validates the exact descriptor identity and binding before and after an ownership
check. The check is bounded to 1,500 ms; failure or timeout disables Notes only for that
turn. The saved profile is never rewritten, broadened, reauthorized, or repaired.

- Unavailable: no note tools or automatic Markdown saves; continue with available context.
- Read-only: authorized reads remain available; no automatic Markdown creation.
- Create: existing authorized reads and create-only saves remain available.
- Empty authorized folder: an empty list is a valid result, not a failed chat.

Queued messages resolve their capability when they actually begin, not when queued.
A later turn may use the original grant again if that exact binding becomes valid.
A different folder still requires explicit authorization. Read/save-time security checks
remain in place for revocations or folder changes during a turn.

## Model and UI behavior

The shared prompt reports the resolved Notes capability. When creation is unavailable,
the model must return `researchNote.disposition=none`, answer in the visible conversation,
and not wait for authorization. It should mention unavailable note content only when the
answer actually depends on it. Older conversation and project memory remain available,
but neither grants current file access nor proves current file contents.

The renderer shows a nonblocking Notes status while keeping Send and Enter available.
Explicit grant/revoke controls remain available. If the model nevertheless proposes a
save without permission, Main still refuses the write while preserving the answer.

## Regression coverage

The Agent Runtime CI gate includes the Notes capability helper and interactive Send/Enter
tests. Service tests cover missing/rejected/changed grants, read/write denial, empty folders,
queued-turn revalidation, and recovery of the original read-only binding without profile
mutation. Prompt/runtime tests cover unavailable/read-only/create and legacy-reviewer rules.

Required commands: `pnpm test:agent-runtime`, Desktop full tests, affected UI tests,
typecheck, lint, formatting check, production build, and packaged startup smoke.
