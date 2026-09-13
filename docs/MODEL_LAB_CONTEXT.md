# Model Lab conversation context and native token accounting

2026-09-14 source candidate [0.58.41](releases/0.58.41.md). Uses the same
[context planner, compactor and meter](CONTEXT_BUDGET_AND_USAGE.md) as the assistant/Project Chat.
This changes Model Copilot chat and automatic revision review; ModelIR compilation, Python import,
source-evidence bounds and review-before-apply rules are not replaced with lossy conversation summaries.

## Owned originals, compacted context and existing model memory

The renderer's latest-200/100-session/8 MB chat snapshot remains a UI cache. It no longer slices
chat requests to 12/50 records for AI use. Its available conversation is offered for first-use import;
once a server archive exists, stale browser history cannot overwrite it. Previously deleted records
from the old 200-message storage limit cannot be reconstructed or invented.

The server owns a separate original transcript per project/model/version/content revision. Hosted
projects use the capability-bound project directory, not a browser-provided filesystem path. Standalone
workspaces use a durable browser workspace UUID to avoid mixing different browser workspaces with the
same model IDs. The UUID is a namespace, not an OS security boundary. Hosted identity does not depend
on that UUID. Data is in `chat-context/<scope-hash>.json` under the existing Model Lab backend directory.
Like Model Lab workspace files, this is local JSON, owner-only on creation, not the assistant's encrypted
mail storage. No new Keychain permissions are introduced.

Archives preserve up to 5,000 records, at most 100,000 characters per record and 32 MB per archive.
Capacity/corruption/cancellation fails explicitly; old records are not pruned or replaced with a
summary. Atomic replacement protects file integrity and same-process session locks prevent competing
turns from overwriting each other. Desktop is single-instance; this is not a distributed multi-writer
database. No archive-delete/export UI is added in this change. Old UI records retain valid recorded
usage; unknown metadata is not backfilled. Legacy timestamps absent from the original are unknown.

`prepareConversationContext` keeps fitting history verbatim. At pressure only an older prefix is
summarized through the same-provider summary-role model; recent messages stay exact. A checkpoint
contains the exact source-prefix digest and is scoped by project/model/revision/provider/model choice.
Model changes do not reuse another provider's checkpoint. Original records remain searchable through
the bounded read-only `search_conversation` tool, including continuation beyond the first excerpt.
Relevant existing model-lineage permanent memories are still supplied and are never reset/replaced by
this checkpoint. Graph/source evidence remains authoritative over remembered assistant hypotheses.

The stable history prefix precedes changing graph/module/request context. Current question and source
data remain separate from trusted instructions. Attachments are still current-turn bounded evidence;
their original bytes are not persisted by the transcript archive or made available as arbitrary files.

## Native execution and metrics

Model Lab reuses the same `ContextUsageMeter` and schema. It reports planned/actual capacity, current
occupancy, usable remaining after response reserve, exact/compressed/omitted history counts, native
input/output/cache/reasoning and separate compaction cost. Events are fenced to the active thread/turn;
compaction invalidates old occupancy until fresh telemetry arrives. Claude cumulative totals are not
current occupancy. Missing counters remain null. Valid final telemetry survives reload/update.

Only same-model measured capacity is reused for subsequent planning. Missing capacity uses the shared
32k conservative fallback, clearly unverified; there is no universal 1M guarantee. Native Codex adapter
capacity controls and account limits remain unchanged. Large-window tool budgets are 48, otherwise 24.
The meter covers the native chat turn; optional subsequent ModelIR edit-generation reports remain in
available-stage usage/trace and are not falsely added to current context occupancy.

Claude's registered tools now use the required `gosu_project` namespace, matching the assistant and
Desktop adapter. Only the existing graph snapshot tools and scoped conversation search are exposed.
No shell, training, project-wide filesystem or cross-project search rights are added. Native threads
are released after each question; durable context is not a claim of permanent provider CLI sessions.

## Verification scope

Regression cases cover 600-message retention, restart vs stale browser data, pressure/checkpoint reuse,
original preservation on cancellation/corruption, project/revision/standalone isolation, native capacity
reuse, thread/turn accounting and compaction invalidation, Claude namespace parity and restored metrics.
The tests are synthetic mechanism checks, not paid/live model-quality or 1M-token recall benchmarks.
See the release record for final gates, packaging, installation and native UI limitations.
