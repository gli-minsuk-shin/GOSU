# AI assistant attachments and message queues

Installed 0.58.35 (2026-09-13). Installation and measured gates are recorded separately in
[the release record](releases/0.58.35.md).

## Attachments

The 0.58.36 changes, included in installed [0.58.37](releases/0.58.37.md), add chat-wide file drop targets to Project Chat and AI assistant. A nested-drag
highlight indicates the target; file drop prevents browser navigation but does not send the question.
Text drags remain normal text operations. Both picker and drop reuse the same extraction/size checks,
with duplicate content excluded and drafts retained. Renderer scope changes release late results.

Electron preload resolves actual disk-backed `File` objects; a renderer cannot provide path strings
through that API. Project Chat uses its scoped attachment IPC. The Briefing iframe passes only selected
Files to its exact app-parent bridge. Main creates a bounded 60-second single-use drop ticket without
reading the file; the owned HTTP routine redeems it through the usual attachment service. No client
token or local path is returned to the iframe. Host HTML restricts frame ancestors to file/loopback
origins; parent handlers reject other sources/origins, malformed Files and hidden views.
See [Electron's native File API](https://www.electronjs.org/docs/latest/api/web-utils).

The app-owned Briefing host injects a separate instance of the existing Project Chat attachment
service, using the same native picker, supported documents/images, extraction and size validation.
Maximum five files, 20 MB per file and 50 MB combined. Original files are not modified or removed.
The server derives a synthetic scope from the authenticated client, routine and settings; renderer
paths are never accepted. Settings/ownership changes while choosing release the staged capability.
Documents are read through bounded `read_attached_file` units; selected images use native image
inputs with a model-modality check. File content is untrusted reference material, not tool authority.
Standalone browser hosts without the native picker report attachment unavailable.

Capabilities expire after the existing Project Chat staging lifetime (15 minutes) and are not
restored after process restart. A queued expired attachment fails visibly and needs reattachment;
the question is never executed silently without its file. A completed answer remains in the normal
encrypted transcript, but selected files are not a permanent document library.

## Queue and controls

Project Chat already persisted queue rows and supported editing, removal and stop-current/run-next.
AI assistant now persists up to 20 pending items per owned routine in the encrypted workspace.
Question text, opaque attachment IDs and selected paper reference are stored. Revision checks reject
stale edits/deletes. Atomic claims prevent two panes from executing one queued item. Claimed or
uncertain requests are not automatically replayed after restart. Waiting requests resume while the
retained assistant UI/app is running; this is not a new OS background scheduler.

The queue stays compact above the composer. Users can send another question while an answer runs,
edit or delete pending questions, or prioritize one by stopping the current answer. Already executed
external actions are not undone by stopping. Failed rows remain visible until explicitly removed.

## Native steering is different from stop-and-next

Codex supports text-only `turn/steer` with `expectedTurnId`; GOSU requires exact acknowledgment.
It does not start another turn or override model, tools, filesystem scope or grants. Attached-file
questions instead run as a new turn so file capabilities cannot be silently dropped. The current
Claude print-mode adapter does not expose native steer; its queue and stop/run-next remain available.

Project queue steering atomically removes an unchanged queued row and appends an audit message in
only that session before the RPC. It never edits a branch-shared original question. Accepted and
unconfirmed delivery are distinguished, with no automatic retry. Assistant steering similarly takes
the revision-checked row before sending and records the requested supplement; its transcript notes
that delivery is separately confirmed. Failed acknowledgments must not be interpreted as successful
model execution. No completed or already in-flight action is undone by steering.

Reference: [official Codex App Server protocol](https://learn.chatgpt.com/docs/app-server).

## Regression coverage

Focused tests cover queue FIFO/CAS/claims/restart/privacy, uncertain steer, distinct stop/run-next,
native picker scope cleanup, selected-file tool reads/native image inputs, UI attachment and queue
controls, Project Chat steering, and exact owned-thread RPC acknowledgment. The local SQLCipher
smoke additionally checks atomic queue take, durable receipt and branch isolation. These supplement
the existing extraction/image/security tests. The named Agent Runtime gate includes new queue tests.
Mocked provider results are not a live paid-model quality benchmark.
