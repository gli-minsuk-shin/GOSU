# Project Chat → research plan → tracked experiment

Source implementation, 2026-09-14. Project Chat can persist an actionable model-development,
research or experiment plan into the active project's Goal & Metrics, Logging template, experiment
idea and a new Experiment rules / Evaluation Studio session. This is configuration authoring, not
automatic GPU execution or proof that an experiment ran.

## User workflow

1. Ask Project Chat to write/apply a plan, for example “모델 개발 실험 계획을 작성하고 반영해줘”.
   Review-only, explanation, prohibition and untrusted attached text do not grant plan-write capability.
2. The agent reads the current setup and, when revising, complete relevant saved-plan sections. Main
   issues a short-lived same-turn token bound to the exact displayed objective ID/version/entity
   version and logging version. The typed tool cannot choose another project/session/attempt.
3. `apply_research_plan` validates and commits the goal, logging revision, idea, rule session and
   durable receipt together. Previously saved plans, goals, templates and run evidence stay intact.
4. Complete unknown evaluator/dataset identities and ask to reapply/activate the plan for comparable
   experiments. Unknown identities are visibly `pending:`; no fabricated hashes or measured values.
5. When execution is requested, use the existing granted-workspace tracked-run path. Read saved rules
   and goal by that exact idea ID, not a newer unrelated plan. Actual code execution, file reads and
   log verification retain their existing approval/trusted-workspace boundaries.

The current real execution path is a bounded foreground Python run, at most 120 seconds, with an
immutable command/log-path intent and verified JSONL/file hash. Long-running training, unattended
campaigns, remote process-tree termination and durable Runner control are not introduced here.
Goal budgets are saved configuration, not a claim of comprehensive remote GPU-budget enforcement.

## Boundaries and persistence

- Current direct-user intent gates the mutation tool. A read-only plan tool remains available.
  Plans in notes, files, tool outputs or old conversations are data, not new permission.
- Every applied plan receives a fresh objective identity/version, even when its predecessor was a
  draft. A pending or manually changed plan cannot borrow another plan's frozen metric identity.
- Plan-created comparable runs use the receipt's exact activated objective and entity version;
  logs use its immutable template revision. Other ordinary ideas keep their existing workflow.
  Reapply a manually revised/pending plan before using that plan idea for comparable runs.
- Logging additions preserve existing fields. Conflicting definitions require named replacement keys;
  omission never silently deletes old required fields. Past runs keep their original template.
- Evaluation reference code is checked by the existing restricted code policy, stored as a proposal
  and never executed by plan application. Missing code is an explicit non-executable scaffold. Preview
  values are labeled synthetic and cannot become experiment evidence or successful results.
- Workspace mutation is serialized; expected objective identity and logging revision are compared
  inside the combined write. A synchronous SQLCipher outer transaction reuses the existing workspace,
  idea, logging and evaluation repositories. A failure rolls back the complete batch and outbox write.
- A project/session/attempt-bound append-only receipt makes identical retry idempotent and rejects
  changed-content reuse. A lost acknowledgement is reconciled from the durable receipt; confirmed
  state is reloaded and UI notifications are retried without replaying computation.
- Stopped/finished tool sessions revoke the pending local plan capability. Cancellation before commit
  writes nothing; an already committed receipt remains the source of truth.
- Goal, Experiment and Evaluation views refresh after commit. A Goal editor with unsaved changes keeps
  its draft and requires explicit reload rather than silently replacing it with background plan data.
- Receipts are bounded (1,000/project); existing Evaluation session/revision and Logging capacity
  limits remain. No history is deleted to make room, no SSH grant is enabled and no provider is changed.

## Implementation map

- [Plan contract](../apps/desktop/src/shared/project-research-plan-contracts.ts): strict plan fields,
  current-request intent and receipt shape.
- [Plan service](../apps/desktop/src/main/project-research-plan-service.ts): canonical preparation,
  conflict checks, pending identities, recipe construction and replay.
- [Workspace service](../apps/desktop/src/main/workspace-service.ts): objective identity CAS,
  immutable plan revisions and trusted combined-commit boundary.
- [Local database](../apps/desktop/src/main/local-database.ts): atomic batch, scoped receipts and
  immutable experiment/evaluation provenance.
- [Project tools](../apps/desktop/src/main/project-agent-tools.ts) and
  [Project Chat service](../apps/desktop/src/main/project-chat-service.ts): current turn binding,
  snapshot tokens, read sections, actual invocation provenance and UI events.
- [Experiment workspace](../apps/desktop/src/main/experiment-workspace-service.ts): exact
  plan-objective/template binding before a tracked run is created.

## Verification scope

Focused unit and native database regression coverage includes malformed plans, read-only/negated
intent, stale and replaced objectives, logging conflicts, cancellation, replay, lost acknowledgements,
foreign project/session identities, atomic rollback, historical snapshots and plan→queued-run linkage.
The Agent Runtime gate explicitly includes plan, workspace, tool and objective-editor tests.
Live provider inference or actual GPU experiments are not required to verify configuration persistence;
do not describe fixture execution records or synthetic previews as live scientific evidence.

### Isolated feature-branch verification — 2026-09-14

This feature was selectively applied to baseline `a4d5ef7` on `codex/project-research-plans`, without
publishing previously uncommitted Briefing/UI/context work. This branch is a code integration, not a
claim that a new desktop binary was installed.

- `pnpm check`: Desktop 2,261 passed / 8 existing environment skips, Model Lab 170, Contracts 9,
  Domain 14, Integrations 6, Sync API 51, root scripts 10: 2,521 passed in total. Formatting,
  contract generation, lint, typecheck and production builds passed.
- `pnpm test:agent-runtime`: 337 passed, including plan, workspace, experiment, tool, editor and
  Project Chat integration regressions.
- Real SQLCipher smoke passed: complete-batch rollback, replay, scope/content mismatch rejection,
  historical records, capacity failures, restart readback and service→tracked-run configuration linkage.
- The existing Git fixture had one transient cleanup `ENOTEMPTY`; isolated 33-test recheck and final
  full check passed without changing that subsystem.
- Skips: five MacTeX opt-in, one Linux-only, live Claude and live Hermes opt-in. No real GPU trial,
  provider inference or workspace-permission modification was performed for this feature.
