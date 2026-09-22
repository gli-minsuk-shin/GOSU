# Lightweight jobs and explicit task export

2026-09-14 source follow-up: [timed prepared deadlines](EMAIL_PREPARED_ACTIONS.md) supersede the
date-only limitation below for new email summaries. Optional local task `dueAt` survives restart and
is exported to Apple Reminders with timed date components. Existing date-only records remain valid;
buttons use saved fields, not a new AI draft. Legacy explicit draft endpoints remain date-only.

2026-09-14: [0.58.75 prepared email actions](EMAIL_PREPARED_ACTIONS.md) supersede the button-time
AI drafting described below. New summaries prepare actions in the summary call; buttons reuse them.
Without Apple authorization the UI defaults to GOSU-only task saving, not blocked mirroring.
Legacy explicit draft endpoints retain the lightweight model path. Installation is tracked separately.

See [Briefing workspace](BRIEFING_WORKSPACE.md), [model catalog](SHARED_MODEL_CATALOG.md),
and [installed release 0.58.65](releases/0.58.65.md).

## Lightweight model role

Model routing adds optional `lightweight` and `usage.lightweightTasks` fields. Existing policies
load unchanged; other fast/strong roles and explicit chat pins remain. Only the dedicated lightweight
job path overrides a chat pin when that workload has a configured role. A missing selection preserves
the existing behavior, and provider changes still require existing private-AI permission.
Email event and task drafting use this path. Confirmed task persistence below makes no LLM call.

The connected catalog included gpt-5.3-codex-spark with low reasoning. One synthetic calendar-draft
test took 4.748 seconds and extracted the correct replacement appointment, compared with the earlier
10.331-second Luna/medium sample. This is not a controlled latency SLA or a cost benchmark.
[Official OpenAI Docs](https://learn.chatgpt.com/docs/agent-configuration/speed) distinguishes Spark
from Fast mode: Spark is a separate less-capable, faster model with its own usage limits. No Fast-mode
credit setting is changed. Keep scientific chat on the user's existing roles. New installs do not
silently select a provider/model unavailable in their own catalog.

## User-reviewed task creation

Email cards show Add task beside Create event. The editable modal uses a tool-free lightweight AI job
to extract an actionable title, concise notes and supported deadline from the displayed email summary.
It passes the receipt date and routine timezone for relative dates/omitted years, requires exact evidence
excerpts, and distinguishes task deadlines from background/event dates. Missing deadlines remain empty;
ambiguous tasks or failed AI output disable saving rather than silently copying the subject. Date-only
storage remains: an explicit deadline clock time is retained in notes with a notice, not a timed alarm.
The user can choose an active GOSU project or leave it empty for a personal task, plus optional due
date, notes and a writable Reminders list. AI and catalog preparation run concurrently; like Calendar,
the editor opens only after preparation succeeds, not as an empty modal during AI inference.
Prepared drafts and user edits survive modal reopening and Reminders authorization without another AI
call; unsuccessful drafting can be retried from the source button. AI work requires owned/approved
routine and private-AI scope, rechecked after inference. Existing-task AI read permission is not needed
to extract a new task from an email. It neither requests OS permission nor creates tasks/reminders.
Reminders export defaults on but can be disabled. No task is written until explicit submission.
The server verifies current routine ownership and approval for direct reviewed UI actions; the
Main-owned task bridge validates any selected project again. AI tools that read existing tasks still
require `todoRead`; these UI endpoints do not grant it. The embedded frame can request only fixed
options/authorize/create
actions, not arbitrary native code. The parent validates frame identity/origin before refreshing tasks.

## Persistence and partial failure

`task-links.v1.enc.json` in the existing Briefing encrypted-data directory records stable task IDs,
exact-payload digests and local creation checkpoints. It uses the existing authenticated sealed store;
no title/body is copied into plaintext storage. Include this file in future backups. Records are not
silently pruned when the 10,000-intent bound is reached.

The local workspace accepts a trusted explicit UUID only through the internal call, preventing a
duplicate task across retry/acknowledgement loss. Source identity plus exact full payload matching
reuses a task after restart; title-only matches or different email identities never merge.
Changed, archived or missing destinations fail closed.
Before exporting an existing task, its content must still match the reviewed request. Lost local
acknowledgements are checked against durable workspace state.

The native helper uses `gosu://briefing-task/<task-id>` as the Reminders correlation URL and searches
only the chosen list before creating. This URL is an idempotency marker, not an implemented mobile
GOSU navigation feature. Incomplete reads never create. A failed/uncertain Reminders result is reported
separately from the already-saved GOSU task; explicit retry checks for an existing reminder first.
Two-system writes are not an atomic transaction. No automatic retry of uncertain native writes.

## Personal task ownership (0.58.68 candidate)

Personal tasks use `projectId: null` in the encrypted local workspace; no project record is created.
Global To-do uses a display-only personal group, supports edit/complete/archive/restore, and includes
these tasks in Briefing and deadline notifications. Project chat/search remain project-scoped.
Local personal writes skip the project-only Sync outbox while preserving existing pending operations.
The real SQLCipher smoke checks persistence and unchanged pending counts. Apple Reminders is still
the separate, reviewed phone-sync path. Old binaries reject null ownership: do not downgrade after
creating personal tasks without an appropriate state backup/compatibility migration.

## Apple permission and phone boundary

Reminders is a separate EventKit capability from Calendar. Catalog lookup does not request access;
only the explicit Allow button invokes `requestFullAccessToReminders`. The existing signed helper
gets the required Reminders usage-description keys without changing Calendar grants or OS policies.
macOS exposes full Reminders access; GOSU limits item reads/writes here to the selected list.

The feature adds tasks to both places once; subsequent edits/completion/deletion are independent.
iPhone visibility requires the same Apple Account and enabled iCloud Reminders; a local list is not
a phone-sync guarantee. See [Apple setup guidance](https://support.apple.com/en-ie/guide/icloud/mmbf52194b5a/icloud)
and [EventKit authorization](<https://developer.apple.com/documentation/eventkit/ekeventstore/requestfullaccesstoreminders(completion:)>).
No actual personal reminder/task was created for development verification.
