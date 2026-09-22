# Workspace shortcuts and notification center

2026-09-14: [0.58.76 candidate](releases/0.58.76.md) confines notification jumps to the Briefing
pane. Never use scrollIntoView for an embedded history record: it can scroll the iframe document
and leave a blank area below the shifted shell. Navigation resets only owned document/host offsets,
waits for layout, and applies each notification request once. History refreshes do not pull the
reader back; ordinary tab scroll restoration must not overwrite an explicit notification target.

GOSU 0.58.8 places Search, Tasks and a notification bell above the Projects heading.
Search and Tasks retain their existing global destinations and no longer appear twice in
the lower Workspace navigation. Icons have accessible names, tooltips and active states.

## Notification sources

- Incomplete tasks with an explicit date: overdue, due today, tomorrow, or within seven days.
  Completed/archived tasks and archived/trashed/unknown projects are excluded. Locally hidden
  active projects remain included.
- New Project Chat completion/failure/interruption events observed by this desktop instance.
  Historical conversations are not retroactively turned into alerts. A completed response
  in the currently selected, focused chat is initially read; background completions and
  failures remain unread.
- Existing actionable workspace/server/provider warnings, a Research Notes rename warning,
  and pending approval requests. Unconfigured optional services and ordinary future-sync
  backlog do not create alerts.

From 0.58.43 the inbox also projects approved Calendar events and saved Briefing completion
metadata (see below). It remains an in-app inbox, not a macOS notification daemon. No new
OS notification permission, cron, background wake-up or notification-only LLM call is introduced.
Missing note permission does not block normal chat.

## Read and navigation behavior

The badge counts currently available, non-hidden unread items; it is absent at zero and
shows `99+` above 99. The popup provides Unread/All, mark read/unread, mark all read, hide
and restore hidden notifications. Reading an alert never completes/deletes a task, changes
a chat message or approves an operation.

A task alert navigates to the exact current task in the global To-do list using the existing
focus/highlight route. Stale dates, resolved tasks and unavailable projects are rechecked.
A chat alert opens its owning project/session. Existing warning destinations remain scoped.

Task reminders are deduplicated by project/task/date/urgency phase. A changed date or a new
phase (upcoming, tomorrow, today, overdue) can be unread again; an overdue task does not
accumulate one duplicate per minute/day. Date-only deadlines remain date-only and use the
Mac's local calendar, with calendar-day arithmetic rather than 24-hour elapsed assumptions.
The clock refreshes each minute, on focus/visibility changes, on new chat events, and when
opening the bell.

## Presentation, privacy and bounds

The native HTML popover top layer prevents clipping by the transformed/scrolling sidebar.
It supports Escape, light dismissal, focus return and independent bounded scrolling.
It closes and is disabled while an existing SSH/Hermes approval dialog requires attention;
the inbox cannot grant permission or replace that dialog.

Read/hidden receipts and at most 100 chat-event metadata records are stored locally.
No task title, note content, reply body, error text, file content or credential is copied
into this store. Chat-event display is limited to the last 30 days. Receipt storage is
bounded to 20,000 identifiers and a four-million-character serialization limit. Warning
identity uses a UI fingerprint, not a security/audit hash. Persistence errors are visible
without blocking chat, navigation or task work.

Current deadlines and active warnings are projections of available workspace state, not
a historical archive of every resolved warning. Existing task/project/chat records remain
the source of truth.

## Regression gates

- Unit tests cover deadline windows, date/phase changes, task/project exclusion, idempotent
  read/hide/restore, large badge counts, scoped chat events, retention, privacy and navigation.
- Interactive tests cover the bell, filters, all-read, focus, suppression, loading and Korean.
- `pnpm --filter @gosu/desktop smoke:notifications:mac` uses only isolated synthetic tasks/events
  to verify the real popover, clipping, scrolling, persistence and navigation at 220/332px
  sidebar widths in light/dark themes.
- The sidebar visual gate verifies Search/Tasks placement and the shared icon family.
- The Agent Runtime gate includes notification source/read-state regression coverage.

## Calendar and Briefing integration — 0.58.43

The trusted desktop main frame polls `briefing-lab:notifications` every 15 seconds and on focus /
inbox refresh. The native host starts without requiring the Briefing iframe to be opened; only already
configured schedules run. There is no public HTTP notification endpoint. In-flight reads coalesce;
Calendar reads cache for 60 seconds, invalidate after Calendar writes, and stop after a 15-second
timeout. Unmount clears the renderer timer. Closed-app reminders are not implemented.

Calendar reads require an owned, approved routine with calendarRead and selected IDs. Per-request
approval scopes do not prompt from background polling. Missing access becomes an inbox settings
warning, not an implicit permission grant. Native queries use chunks of at most 30 selected calendars,
an eight-day query range and a 500-event bound. Revocation is rechecked after async reads. Canceled
and ended events are excluded. Upcoming, tomorrow, today, configured-alarm-window and ongoing phases
deduplicate by occurrence and phase; a later phase can become unread again. All-day dates use the
event timezone; timed display uses local time. Notes, attendees and location are not returned.

Successful daily-generation completion stores one metadata receipt per generation UUID in the
encrypted Briefing workspace (max 200, inbox shows 30 days). It links the owned routine and saved run.
Email counts use the exact newly discovered keys for this generation, after existing conservative
verified-copy deduplication, not all messages in the mailbox or all items accumulated today. A second
empty refresh reports zero new items even when timestamps are equal. High importance is taken only
from saved summaries; unclassified/failed/disabled are explicit, never silently classified as low.
Counting adds no Mail reads or LLM calls. Failed/canceled generations do not issue a ready receipt;
partial saved generations identify incomplete sources. Receipt-save failure does not erase a briefing.
Deleted runs/routines no longer produce alerts. No email subject, body or account enters the receipt.

Calendar alerts open the exact occurrence in its owning routine; Briefing alerts open and focus the
exact saved run, clearing the history search filter. Missing/deleted runs show an unavailable notice.
Read/hide only affects the existing local inbox receipt, never Mail read state or a Calendar/task write.

The new optional `briefingNotifications` field migrates on normal encrypted-store writes. Older strict
workspace readers may reject that field: rollback requires compatibility review and a protected
pre-update backup, never deleting the user workspace. See [0.58.43](releases/0.58.43.md) for actual
tests, packaging and installed/live-verification status.
