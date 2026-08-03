# `@gosu/domain`

Pure domain rules shared by API command handlers, desktop offline commands, and Runner orchestration.

- `validateCampaignTransition` / `validateTrialTransition` enforce explicit state machines and treat replayed same-state events as idempotent no-ops.
- `validateJobPolicy` checks an already parsed `JobManifestV1` against cryptographic verification, the approved policy/objective snapshot, isolation rules, and remaining budget.
- `validateObjectiveImmutability` prevents an approved metric or budget from being edited in place; replacements require the next `ObjectiveVersion`.
- `checkOptimisticVersion` returns either the next version or an explicit conflict containing both current and incoming values. It never applies last-write-wins.

Callers must parse untrusted wire input with `@gosu/contracts` before applying these rules and must persist a successful state/version change and its outbox event in one database transaction.
