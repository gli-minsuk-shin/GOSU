# Project Chat tool activity

GOSU 0.58.5 shows observed Project Chat tool execution details instead of repeating
generic tool names. This is an execution log, not a stream of private model reasoning.

## Visible details

- Friendly operation names distinguish project summary, Board, and Goal & Metrics reads.
- Safe request metadata identifies a note, relative file path, search query, or read range.
- Completion metadata shows actual returned counts, truncation, and a bounded failure code.
- Host timestamps provide elapsed duration. Legacy events without timing never invent it.
- A tool start and its result update one expandable row, keyed by project/session/turn/call.
- Unknown result status is labelled "Result received", not success or "Receipt reviewed".
- Incomplete calls after the response ends show "Result not received", not "Running".

Codex and Claude Code use the same allowlisted metadata formatter. Older providers/events
remain compatible, but details are displayed only when they are actually supplied.

## Scope and bounds

The collapsed view shows up to six calls, with an option to show all retained calls.
The state retains at most 40 calls (up to 80 lifecycle events). Unfinished calls take
priority, followed by recent completed calls; the selected calls remain chronological.
If the bound is exceeded by unfinished calls alone, the oldest unfinished calls are kept.

After a response, "Latest tool activity" remains available in that Project Chat session
until the next response starts. It is volatile renderer state: it is not saved across app
restart, injected into LLM prompts, or added to permanent memory.

Duplicate lifecycle notifications are merged. Late events cannot reopen a finished turn,
overwrite another session, or replace the current turn with an older turn.

## Privacy and behavior

Only validated, explicitly allowed request/result fields enter progress events.
Raw tool output, note bodies, credentials, absolute local paths, URLs, commands, arbitrary
error messages, and provider reasoning are not copied into these activity summaries.
Secret-like target/query strings are omitted rather than shown partially.
Known safe broker error codes are allowed; unrecognized failures remain generic.

This update does not change tool permissions, Research Notes grants, tool execution,
timeouts, model selection, or retry policy. It adds no LLM calls for narration.

## Regression gates

- `pnpm test:agent-runtime` includes tool metadata, lifecycle/state, and UI regression tests.
- Desktop full tests, typecheck, lint, formatting, and production build are required.
- `pnpm --filter @gosu/desktop smoke:project-tool-activity:mac` renders an isolated fixture
  in English/Korean, light/dark themes, and 400/900px chat widths. It checks lifecycle
  merging, expansion, overflow, and renderer/CSP errors without real account/provider calls.
