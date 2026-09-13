# Model references across GOSU chats

2026-09-14 source candidate [0.58.49](releases/0.58.49.md). Extends the
[project Model Lab host](MODEL_LAB_DESKTOP.md) and [global assistant](GLOBAL_ASSISTANT.md).

## User flow

Each model row and the active model heading have two labeled icon buttons. Project Chat is
available in hosted GOSU; the internal Model Lab discussion button also works standalone.
The local button selects that model, opens the copilot and focuses its composer without sending
a question or discarding the saved conversation. Its chip shows the model name and content revision.
Buttons do not interrupt an active model generation/chat or hand off an unapplied proposal.

The Project Chat button flushes hosted storage before posting only model ID/revision to its parent.
The parent checks the exact iframe source/origin and active project/view. Main re-resolves that
saved model, verifies identity and creates or reuses a model-bound project session. A late reply
must not navigate away from a different view chosen while loading. Ordinary chat drafts are not
overwritten. The model chip and reference survive reopening and updates.

## Evidence identity and persistence

`project_chat_sessions.model_lab_reference_json` is an additive nullable immutable column.
The reference stores model ID, revision, display name, version and normalized pseudocode SHA-256;
the browser cannot supply an authoritative name/hash or model body. Branches inherit the reference.
Existing conversations and model workspaces are not reset. A missing/deleted revision or changed
hash fails explicitly rather than silently referring to a similarly named model.

References pin the root model revision. Nested models have their own revision histories and are
read separately from the catalog; this is not an immutable snapshot of every transitive dependency.
Unsaved drafts and generated Python artifacts are not automatically copied into Project Chat.

## Shared read surface

Main owns a model reader over the existing project workspace and model/revision transcript archive.
It never accepts filesystem paths or creates seed models while reading. Catalog pages contain up
to 12 active models with saved revision numbers. `model`, `pseudocode` and `conversation` return
bounded text and `nextOffset` for continuation; character offsets differ from catalog model indices.
Invalid saved histories, missing models and unavailable projects are errors, not empty success.

Project Chat receives `read_model_lab` only for its own project. The prompt identifies the pinned
reference as untrusted evidence and requests its actual source before describing its details.
Reads of that pinned model automatically bind its revision/hash. Other explicitly selected saved
models in the same project remain readable for comparison. Critical Review direction mode can use
these reads; manuscript-only review retains its artifact-only boundary.

The global AI assistant receives the same read capability through its app-owned project bridge,
using exact active project IDs and the existing `projectRead` plus private-AI/provider approvals.
It can inspect saved models and Model Lab conversations across approved projects on demand.
This does not grant OS-wide filesystem access, activate disabled private processing or share one
project's conversations with other Project Chat sessions automatically. No model writes, training,
remote shell or new account permission is implied by this read surface.

Conversation reads prefer the existing original archive (up to its existing 5,000-record/32 MB
limits). If absent, only retained UI history is read and explicitly labeled legacy/partial; drafts
and attachment bytes are excluded. No archive is created, compacted or modified by these reads.
Historical assistant hypotheses are not proof of current model state or completed experiments.
Current app rendering/typing stays local; no LLM is called merely by clicking a reference button.

## Verification

Reader, host persistence, source/origin validation, pinned-session reuse, callback scope/hash,
private-AI gating, corrupt/trashed/missing evidence, archive paging and save-failure regressions
cover the feature. Native SQLCipher smoke checks stored reference restoration. Exact gates,
visual and installation status are recorded in the release note.
