# Sidebar AI activity

2026-09-15 candidate. See [icon design](SIDEBAR_ICON_DESIGN.md) and
[chat continuity](CHAT_EXECUTION_CONTINUITY.md).

An 11px four-point star sits beside the existing 18px/22px icon geometry without moving labels.
Running uses a slowly drawn outline; a successful unread result uses a gently twinkling filled star.
Opening/clicking the destination acknowledges completion, never cancels running work. Collapsed
projects/groups aggregate descendant activity; expanded folders show the marker on the destination
instead of repeating it on the folder row. Running takes precedence over a completed result while
other work in the same scope is pending. A completion marker means at least one successful unread
result, not that every concurrent task succeeded. Failure/cancellation alone never produces a sparkle.
Reduced-motion uses static outline/filled stars. Theme colors, hit targets and icon size are retained.

Project Chat and Critical Review use Main's turn events and restored active-turn snapshots, with
review sessions routed to Review. Model Copilot, reconstruction, pseudocode normalization and Python
generation report actual promise outcomes. Global assistant, manual briefing/paper refresh and paper
save report their lifecycles. An embedded read-only generation monitor continues polling existing
briefing status while controls are hidden; it never starts/resumes a job. Repeated status-read failure
clears an unconfirmed marker rather than fabricating completion. Lecture generation/chat and project
evaluation/literature AI use their existing native calls, preserving original return/error behavior.

Frame messages contain only type, workload, opaque run ID and phase. The desktop accepts only the
exact retained contentWindow and origin and binds Model Lab to the host-owned project. Child-supplied
project IDs/content are rejected; frame workload allowlists remain narrow. Reload clears stale markers
for that producer only and requests a metadata-only resynchronization of active work. A Briefing frame
reload cannot erase a native paper-save operation in the same destination. Native renderer-local project reports
have a separate bounded scope path; none of these decorative events grants permissions or triggers AI.

Status is transient renderer state, not a replacement for saved notifications/history. Loading old
completed history does not manufacture a new completion. Existing cancellation, provider policies,
timeout and retention remain unchanged. No raw model content, tokens, source paths or prompts are
sent through the activity channel.

Real-render synthetic sidebar QA covered running→completed→acknowledged, light/dark and 280/332px
widths. No live account/task/LLM invocation was triggered in that preview. See the release record for
full tests and installed state; synthetic preview is not an installed-app verification.
