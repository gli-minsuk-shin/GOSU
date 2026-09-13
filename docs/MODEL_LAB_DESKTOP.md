# Project Model Lab in GOSU

2026-09-14: [Model references](MODEL_REFERENCES.md) add saved-model reference buttons and a scoped
read bridge for Project Chat and the approved global assistant; conversations remain independently owned.

2026-09-14: [Model Lab context parity](MODEL_LAB_CONTEXT.md) supersedes the AI-history limits below.
The latest-200 browser snapshot is now only a UI cache; a separate scoped backend transcript and
checkpoint preserve AI context, and the shared token meter restores valid telemetry across updates.
See [0.58.41](releases/0.58.41.md) for verification and installed status.

GOSU 0.58.2 provides one independently owned Model Lab workspace below Project chat in each project folder.
The workspace contains its own model sessions, pseudocode revisions, chat drafts, conversation
history, permanent model memories, imports, and generated Python receipts. Visited project views
stay mounted while navigating elsewhere, so changing tabs does not discard a draft or agent turn.

## Shared implementation and boundaries

The desktop package includes the production build of `apps/model-lab` and invokes the same
provider-neutral API middleware used by its Vite plugin. It does not require the standalone
port 4317 server. GOSU owns a private loopback listener on an ephemeral port. Each project receives
an unguessable capability URL through a main-frame-only IPC call. The embedded frame has no Node
integration or GOSU preload bridge. The parent CSP permits only that exact loopback origin.
Host/origin checks, project lookup, route validation, and capability-to-project binding precede
API handling. Uploaded Python is statically parsed, never executed during import.

Project workspace state is atomically saved under GOSU user data at
`model-lab/projects/<project-id>/workspace.json`. Browser storage is backed by that stable project
file rather than an ephemeral-port localStorage origin. Import diagnostics, canonical cache, and
Python artifacts resolve through an async-local project directory. Different projects cannot
join the same in-flight source build. Project chat remains a separate conversation from Model Lab.
New projects start with exactly one independent copy of the built-in **Bottleneck autoencoder**.
The default is seeded only when a workspace has never been saved. An explicitly saved empty
workspace stays empty, and subsequent imports, revisions, and deletions are never reset to defaults.
Fresh standalone browser workspaces use the same single-model default; existing standalone data
is not rewritten. The 0.58.0 initializer mistakenly inserted the same five built-in examples
into every project; these were independent copies, not shared writable models. A one-time migration
moves only unchanged automatic examples other than Bottleneck autoencoder into recoverable Trash.
An already deleted autoencoder is not restored automatically. Revisions, Python receipts,
meaningful chat/draft activity, memory, explicit import activity, and dependencies of preserved
models protect a model from this migration. Standalone browser data and caches remain untouched.

## Duplicate to another project

Use a model's actions menu, **Duplicate to project…**, choose the destination, then confirm.
The selected saved revision and its transitively referenced nested models become independent r0
models with fresh IDs and rewritten internal model references. Generated Python files are copied
only from canonical source-project artifact paths after receipt/hash verification, with new
destination-owned receipts. Unapplied drafts, conversation, permanent memory, and full revision
history are not copied. The source remains unchanged; the new root records its source provenance.

Copies are deterministic, not LLM regenerations. Request IDs make retries idempotent. A durable
destination inbox survives restarts and avoids overwriting a live target workspace with a stale
snapshot. Open target views adopt pending copies, save their workspace and receipt marker, and
then acknowledge delivery. Replayed copies never overwrite user-edited destination models.
Deleting the final active project model leaves an empty workspace; refresh does not resurrect
examples, and Trash restore remains available.

Conversation persistence is bounded to the latest 200 messages per model/revision session and
100 sessions, with an 8 MB aggregate limit. Draft saves are deferred by 500 ms while typing;
submitted messages save separately. Attachment source bytes are turn-scoped, not persisted in
conversation storage. Workspace save failures stay visible and expose Retry save. Archived/trashed
project access is governed by the project resolver; a trashed project cannot open its capability.
No experiment is launched by opening this tab or generating Python.

## Input performance

The composer owns its text state. Keystrokes update a draft ref and a deferred persistence timer,
not ModelLabApp state. The graph receives stable callbacks and is memoized. Existing Markdown/math
messages are memoized too. Enter submits only outside IME composition; Shift+Enter inserts a line.

Regression coverage checks 50 keystrokes without extra workspace/graph renders, session draft
switching, Korean IME Enter, per-project API/storage/cache isolation, durable UTF-8 writes,
concurrent writes, failed-save recovery, capability rejection, tab routing, and CSP boundaries.
The desktop build copies the same Model Lab UI and static Python analyzer into the app package;
packaged startup smoke checks both resources before reporting readiness.
