# Global GOSU assistant

## Configurable app-local shortcut — 0.58.62 candidate

On macOS the native View menu opens the retained AI assistant with Command+Shift+Space by default.
Settings → 단축키 records and saves another modified key combination, or restores the default.
Main validates the fixed IPC request and persists the value in userData/assistant-shortcut.v1.json;
include this file in future state backups if present. Saving rebuilds the menu immediately.
The preload buffers early navigation, and repeated shortcut requests increment existing navigation
revision so the composer refocuses without clearing messages. Existing recommendation behavior stays.
This is app-local, not a system-wide/background shortcut. OS-reserved combinations may take precedence.
Focused tests cover persistence, malformed keys, native menu action and early/repeated IPC delivery.

2026-09-14 source: [Model references](MODEL_REFERENCES.md) add `read_model_lab` for model structure,
pseudocode and model/revision chat history across approved active projects. Existing project-read
and private-AI/provider approval gates remain; model writes/training are not part of this reader.

## Recommendation dismissal — source candidate 0.58.44

Opening/reopening the AI assistant shows the configured recommendation list alongside restored history.
This explicitly supersedes 0.58.42's collapsed-on-restoration presentation below; transcript restoration
and all permission/context boundaries stay unchanged. Input clicks, typing, outside pointer presses
and loss of iframe/window focus dismiss only recommendations. Automatic composer focus on opening does
not dismiss them. The recommendation icon can reopen the list; pointer presses inside the list or on
that toggle are excluded so a suggestion still submits once without a second Enter or click race.
Slow history restoration does not reopen a list already dismissed. Drafts/messages are untouched and
listeners are removed when hidden or unmounted. See [0.58.44](releases/0.58.44.md) for validation.

## Restart display continuity — source candidate 0.58.42

The earlier disk-persistence implementation stored messages but selected them for display using the
entire current permission/provider digest, including mail query settings. Changing that digest could
make an existing conversation look empty without deleting its stored records. `conversationDisplay`
now returns all preserved scopes for the same owned routine, chronologically. It is local UI only:
model input, original-text search, checkpoints and write approval continue to use the scope-restricted
`conversation` method. A notice distinguishes older-scope display from permission to resend it to AI.
Cross-routine and unowned-client reads stay denied. No migration, deletion or auto-execution is performed.

Profile updates preserve original ordering, keeping the desktop bootstrap's primary routine stable.
The UI waits for restoration before showing any welcome and leaves recommendations collapsed when
messages exist, including reopen/remount. The icon remains available to open recommendations manually.
Failure is still explicit and does not wipe storage. Process-token rotation does not change the
persistent client identity under normal storage; browser-data clearing or lost credentials is not
silently bypassed. Those cases still require restoring the authorized connection.
Transient network, process-token and busy errors retry only the read-only restoration, at most three
attempts. Permission errors/cancellation never trigger automatic retries or re-execution of chat/actions.

See [0.58.42](releases/0.58.42.md) for gates and installation status. Previously pruned or never-saved
records cannot be reconstructed. This supersedes the earlier display-only scope restriction below,
not its private AI/provider boundaries.

Installed 0.58.35 adds [native file attachments and a durable editable queue](CHAT_ATTACHMENTS_AND_QUEUE.md).
Codex text steering is separate from stopping the current turn; Claude retains queue/run-next.

Installed [0.58.34](releases/0.58.34.md) replaces the earlier six-message next-turn limit with
[token-budgeted server context and checkpoints](CONTEXT_BUDGET_AND_USAGE.md). Raw conversations
and scope boundaries remain; descriptions of the six-message limit below are historical.

Installed [0.58.33](releases/0.58.33.md) includes the durable conversation implementation below.
Earlier not-installed wording describes development time; live persistence verification remains
distinct from synthetic regression coverage.

## Durable conversation storage (post-0.58.32 source, not installed)

Chat previously survived only pane hiding/navigation, not process restart. The server now commits
each question before inference and each completed answer before returning success to the UI.
Messages (role, text, timestamp and invocation metadata) live in the existing authenticated encrypted
workspace outside the app bundle. No plaintext localStorage copy or new encryption key is created.
Existing personalization memory, paper summaries and settings are unchanged. The optional defaulted
`conversations` field reads older workspace files without clearing them. Older binaries with a strict
workspace schema cannot read the new field: do not roll back across this change without a compatible
reader or preserving the new encrypted file. App updates must not replace user data.

On remount, the owned routine's conversation is restored before sending is enabled. The existing
six-message bounded next-turn context uses restored messages, while the UI displays the whole stored
conversation. This does not claim unlimited model recall or automatic summarization of all past chats.
Routine/provider/permission-scope separation prevents silently forwarding an old private conversation
under a different scope. Old scoped records are retained, not deleted. Model/effort changes alone do
not change the storage scope. Draft text remains page-local; unsent drafts are not durable messages.

Restoration is read-only: no model/source/action execution, automatic retry of interrupted requests,
or restoration of executable old proposals. Unanswered saved questions stay visible. A load failure
blocks sending and offers explicit retry; answer-save failure returns the answer with a warning,
without re-executing it. Store limits reject writes atomically instead of evicting previous chats.
Messages already lost before this feature cannot be reconstructed from nonexistent storage.

Coverage includes encrypted fresh-instance readback, denied client/scope, corruption preservation,
server question/answer commits, save-failure warnings, full UI remount and next-turn context,
and restoration failure/retry. The durable store regression is part of the named Agent Runtime gate.
See [storage implementation](../apps/briefing-lab/briefing-workspace-store.ts) and
[release procedure](RELEASE_RUNBOOK.md).

Included in installed [0.58.30](releases/0.58.30.md). Installation-pending statements below describe
development-time status. The installed header/shortcut were observed; live project dispatch was not run.

Source implementation, 2026-09-13. Installed GOSU remains 0.58.29 until a separate verified
replacement. See [Briefing workspace](BRIEFING_WORKSPACE.md) and
[model routing](SHARED_MODEL_CATALOG.md). No real project, permission or model setting was changed
during development verification.

## Entry point and retained conversation

Post-0.58.31 source fix: embedded History's open chat now stays in the workspace grid,
stretching from the same top to bottom edges as the briefing pane. The standalone narrow-screen
`top: 126px` fixed overlay must not leak into GOSU's headerless iframe. Its existing width
splitter remains visible; global assistant navigation still uses the full canvas. A focused CSS
regression covers the embedded override. Synthetic production-component browser inspection
confirmed both History's full-height sidebar and the global canvas at 1280×720, without live
source or model calls. This change is not yet packaged or installed.

Installed in [0.58.31](releases/0.58.31.md): explicit `is-global-assistant` React presentation state and a dedicated scoped
stylesheet separate the full-size canvas from Briefing's narrow fixed overlay. The host tags its
assistant viewport and constrains the iframe through a one-row grid. The canvas fills the available
space, while messages/composer use a bounded reading measure. User bubbles align right, replies
left; the composer is at least 128px high and remains outside the scrollable message log. Welcome
suggestions use two columns with a viewport-aware height cap. Ordinary sidebar styling is untouched.
Switching between History and global chat retains the same pane and unsent draft, with no request
on navigation. This is presentation-only and does not introduce disk-persistent chat history.

The first workspace shortcut is an outlined chat/spark SVG, before Search and Notifications.
It navigates the existing global Briefing iframe to `assistant`, not a new iframe or Project Chat.
The same retained routine chat is displayed in a full-width reading pane. Existing draft/messages
and in-flight work survive navigation; this does not add restart-persistent chat transcripts.
The existing parent/source/origin checks apply. Global-mode CSS removes narrow-window fixed-overlay
offsets and places the assistant in grid column one. Other Briefing views keep their prior layout.

## Project boundary

Main injects `createGlobalAssistantProjects` into the app-owned Briefing host. Standalone Briefing
does not register these tools. The existing owner/profile/provider and private-AI checks are required;
this does not grant access to an external provider or activate disabled private processing.
The optional `projectRead` preference defaults to disabled for old profiles. Enabling it in
Briefing settings requires native scope approval naming all active projects; it is included in
the approved-scope digest. Existing Mail/private-AI grants alone do not confer project access.
Private-AI transmission must also be enabled. Declining the expanded scope retains old settings.

- `list_projects`: up to 100 active project names and canonical IDs; excludes trash/archive.
- `read_project`: project-specific memory and recent three sessions, six messages per session,
  1,800 characters per excerpt, with existing memory-text redaction. A bounded session catalog
  allows an exact older session to be selected. Limits and historical status are disclosed;
  running flags and old messages are not completion proof. Tasks use the existing scoped Todo tool.
- `remember_project_context`: a short project-only decision, never the whole multi-project chat.
  Native confirmation shows target and exact note. Existing SQLCipher project permanent-memory
  storage, sensitive/promptware filtering, per-project capacity and retrieval rules are reused.
  This is available to that project's subsequent chat context, not other projects' context.
  Sharing is explicit/confirmed, not automatic replication of every assistant utterance.
- `request_project_work`: a user-requested, project-specific task, with native target/text
  confirmation, dispatched to the most recently updated Project Chat session (default session
  when absent). The existing ProjectChatService runs its normal provider, queue and permissions.
  A submission receipt is not completion; failed/uncertain sends are not automatically retried.

Write tools require a successful exact-project read in that assistant turn. Same-turn duplicate
write attempts are rejected even after an uncertain result. The native bridge rechecks cancellation
and active-project existence after consent. Approved memory storage and work dispatch are counted
in `writesPerformed`; Calendar/task proposals are not silently executed by this change.

Project Chat adapters do not receive the global project bridge. Their existing project scope is
unchanged. The global assistant reads project conversations on demand, rather than copying them
into other projects or exporting all transcripts on every question. Shared notes are user-reviewed
interpretations, not authoritative source facts or new permissions. No general shell, mail-send,
arbitrary file access, unrestricted Calendar mutation or cross-project grant was added.

## Models

The new-policy default maps the assistant to `strong` and email/paper summaries to `fast`.
Settings → Agent retains independent model/provider/reasoning choices and workload mapping.
Existing persisted routing and explicit routine model pins are preserved, not migrated silently.
Unset profiles fall back as before; no model is invented or claimed cheaper/faster without evidence.
Private-provider mismatch remains an error requiring explicit review. Summaries still reuse caches.

## Verification

Focused coverage checks first-icon ordering, retained iframe navigation, scoped project reads,
memory database target/filtering, approved single-project dispatch, denied/late-cancelled/deleted
targets, private-AI requirements and duplicate-write prevention. The named Agent Runtime gate
includes `global-assistant-projects.test.ts` plus the existing assistant regressions.
Synthetic browser QA uses production Sidebar and BriefingApp components with fixture-only
source/provider responses; no live account reads or paid model calls. It caught and corrected
both grid-column and narrow-screen overlay offsets. Installed UI/live project dispatch is unverified.

Final gates: `pnpm check` passed. Desktop 2,391 passed / 8 existing environment skips; Briefing
692 passed; Briefing Core 116 passed; Model Lab 341 passed. Formatting, generated contracts, lint,
typecheck and production builds passed. The named Agent Runtime gate passed 663 tests
(195 Desktop + 467 Briefing + 1 Model Lab). The unrelated process-group shutdown test had one timing
failure in the initial full run; its isolated rerun and final full suite passed without production
changes to that subsystem. Maintenance-document checks passed and Markdown mirrors were verified.
