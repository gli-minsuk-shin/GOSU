# Email actions prepared during summary

Installed: [0.58.81](releases/0.58.81.md). The reported old email now shows the recovered date and
12:00 in the actual installed task dialog. Full 4,182 tests / eight skips and Runtime 1,617 passed.
Actual Reminders permission/list selection is a user setup step; no personal reminder was test-created.

## Legacy deadline recovery and saved Reminders defaults (0.58.81)

Owned history reads now persist missing legacy task drafts from explicit dates in saved email
title/action/summary, before the button receives the item. This does not reread original Mail or call
AI. Numeric/Korean deadline dates use the receipt year only when no year is stated; semester numbers
are not dates. Conflicting dates/clocks, invalid dates, contradictory weekdays, unanchored years,
past yearless dates and unsupported foreign timezone labels stay unresolved. Date-only remains
date-only. Bare Korean 1–11시 without AM/PM is not turned into an arbitrary time. Notes disclose
the saved-summary basis, not verified original evidence. The existing editable confirmation remains.

Previously date-only tasks may recover absent dueAt when the recovered date agrees, preserving
their title/notes and existing event. Explicit null AI assessments and explicit null dueAt are not
overridden. Changes are owner-bound and checked against unchanged source fields before commit;
removed history is excluded. Summary text/timestamps are not changed or marked newly generated.
This supersedes the earlier requirement to manually refresh every old summary.

GOSU Settings → Briefing Lab → Apple 미리 알림 · 할 일 기본 설정 exposes connection and a default
export/list choice. It saves immediately through a guarded endpoint in the existing encrypted
task-links.v1 store. Subsequent email task dialogs reuse that choice; deleted/unwritable lists are
not silently replaced. Catalog checks do not ask for OS permission. macOS's first authorization,
or recovery after revocation, remains a user action and is never stored as a fabricated grant.
GOSU-only task creation remains possible. The defaults apply to Briefing email task export, not
unrelated project task writes or automatic background Reminders creation.

Synthetic UI confirmed legacy 2027-semester subject → receipt-year 2026-09-21 at 12:00, saved list
selection and no repeated authorization at task opening. Tests cover persistence, ambiguity,
UTC midnight boundaries, existing notes, ownership, invalid catalogs and revoked permission.
No actual personal task/reminder was created. Release/installed status: [0.58.81](releases/0.58.81.md).

## Timed task deadlines (2026-09-14, source only)

New summary output requires task `dueAt` (offset ISO instant or null) and `timeZone` in addition to
the date-only `dueDate`. Stored old summaries accept absent fields without inventing a time. A timed
deadline must have an evidence-backed date matching its instant in the supplied routine timezone.
Calendar start/end/allDay/timezone are reused unchanged; task date and optional time are editable
with deterministic timezone conversion, never another model call at the buttons. Date-only stays
date-only. Ambiguous events stay unresolved rather than receiving a made-up duration.

Desktop local tasks persist optional `dueAt` and show the local datetime in card/list deadline labels.
Exact-payload idempotency includes the instant. Reminders export receives it and writes Gregorian UTC
year/month/day/hour/minute/second with an explicit timezone; date-only export remains unchanged.
Changing/clearing a date in the existing task editor clears stale timed metadata; other edits preserve it.
The project Sync payload still supports date-only deadlines; this new instant is local GOSU metadata
and the explicit Reminders export, not a new server Sync contract. Notification scheduling is unchanged.
Older app schemas do not recognize the new task field: back up before install; do not downgrade a
workspace containing timed tasks without a compatibility migration. Existing summaries are not bulk
reanalyzed; an explicit summary refresh can populate missing fields from the original email.

Synthetic live Luna/low summary: one invocation produced distinct 13:00–14:00 event and 15:30 task
deadline with Asia/Seoul offsets. No personal source or Calendar/Reminders item was read or written.
Native helper compilation passed; actual phone delivery remains unverified. Installation is pending.
Final gates: `pnpm check` passed with 4,139 tests and eight existing environment skips; typecheck,
lint, format, contracts and production builds passed. Agent Runtime 1,534 passed (119 + 816 + 545 + 54).
An initial concurrent runtime run hit the existing 603-record history test's five-second timeout;
the final sequential named gate passed without changing or skipping that test. Focused UI/storage
tests cover UTC date boundaries, exact event endpoints, nullable/invalid times, user edits/clearing,
modal reopening, encrypted history reload, local task restart and time-sensitive idempotency.

## Body recovery follow-up (2026-09-14, source only)

The native reader checkpoints all selected message previews before optional Message-ID and raw
source duplicate-proof reads. A stalled optional lookup no longer prevents later preview attempts.
Empty Mail content is unavailable, not a successfully read body. Individual content calls can still
time out; this does not claim a complete mailbox synchronization or attachment/OCR reader.

Explicit history refresh does not reuse metadata-only receipts when saved scope requests bodies,
or receipts from a different saved Mail scope. It reacquires original sources inside the current
approved scope. If the body remains unavailable, it keeps the saved summary and does not invoke AI
to produce another subject-only summary. Ownership, changed settings and private AI approval errors
now have distinct explanations; no grant, OS permission or user setting is widened automatically.

The screenshot alone does not establish which permission check failed in the installed app.
Real target-mail recovery and installed verification remain pending; synthetic native-script and
service regressions verify the changes independently. The previously signed app predates this fix
and must be rebuilt before installation.
Validation: Briefing full suite 878 passed (129 files, no skips), Agent Runtime 1,529 passed
(115 + 815 + 545 + 54), typecheck/lint/format/production build passed, docs regression 2 passed.
Native-script tests use synthetic Mail objects, not the user's mailbox or a live LLM call.

0.58.75 candidate; see [task boundaries](BRIEFING_TASKS_AND_LIGHTWEIGHT_MODELS.md) and
[release status](releases/0.58.75.md).

New email-only summary output requires `preparedActions` with nullable `event` and `task`. The
existing summary-model invocation prepares both alongside the summary, with source quotes, deadline
quote, notice and timezone. Dates are anchored to receipt time, not button-click time. Unsupported or
ambiguous actions stay null. Event range/timezone and exact normalized source quotes are validated;
task deadlines require deadline evidence. This is extraction, not proof every semantic inference is
correct, and it never performs a write during summarization.

Prepared fields travel through insight/cache and encrypted briefing history; old records omit them
and remain readable. New summary output has eight fields rather than seven. Paper output does not
inherit email-only fields. Existing summaries are not bulk regenerated or overwritten to backfill
these drafts. An explicit summary refresh can prepare them with the normal source/AI permissions.

Email action buttons no longer call `/todo/draft` or `/mail/event-draft`. A saved task opens immediately
after destination options are read; a saved event opens after existing calendar preferences are read.
No repeated LLM call is made. Old task summaries allow manual title/notes and leave deadline empty;
old/ambiguous event summaries report the missing draft instead of inventing today's event. The legacy
draft endpoints remain available to explicit callers; they are not used by these buttons.

Current write behavior retains the existing editable confirmation UI and server approval/idempotency
checks. The user was asked whether to keep this confirmation or save immediately to default targets;
no new automatic destination choice or background creation is inferred without that answer.

Reminders mirroring defaults on only when authorization and a writable list are available. Without
authorization, the editor permits GOSU-only personal/project tasks. Explicit mirroring still requires
Apple permission and a writable list. Denied authorization preserves user edits and switches the editor
to a visibly GOSU-only save, not a hidden Apple write. Existing partial-success receipts and exact-payload
deduplication remain. No macOS permission, Keychain ACL or existing connection setting is bypassed.

Regression covers no extra model calls, optional project, disabled unauthorized export, local save,
denial/edit preservation, reopening, duplicate submission, source evidence, event ranges, schema output,
and encrypted history restart. One live synthetic Luna/low summary produced correct, distinct meeting
and submission dates in one invocation. No real mail/task/calendar/reminder was read or written by that
smoke. Full gates, visual inspection and installed status are recorded separately in the release note.
