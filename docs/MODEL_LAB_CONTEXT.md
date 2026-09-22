# Model Lab conversation context and native token accounting

## Graph-edit failure isolation (2026-09-14, source only)

Native chat and the subsequent full-ModelIR edit are separate calls. Previously the edit inherited
the general runner's 120-second/96-KiB output cap; its failure discarded the completed chat answer
and the renderer mapped most errors to generic connection failure. Full ModelIR schema jobs now use
the existing builder ceiling of 300 seconds/2 MiB for Codex and Claude; ordinary calls retain their
smaller ceilings. This is bounded output/time headroom, not larger automatic context or permissions.

The server emits an editing stage, validates the result and stable root ID, and keeps analysis with
an explicit edit-only failure if generation/validation fails. No invalid proposal is returned and no
graph is applied. Cancellation still aborts; it is not converted into a successful answer. Known native
completion/process/size/time errors remain distinguishable without exposing raw stderr. Stdin pipe
failure is handled and pre-aborted requests do not spawn subprocesses.

Synthetic live Astra/high: ordinary model explanation completed in about 5.8 seconds; a second
explanation plus complete five-module edit validated in about 66 seconds total. No user model or
workspace was changed. This does not prove the exact historical failure in the screenshot, whose
specific cause was lost in the generic message, or guarantee arbitrary imported models will validate.
Focused tests cover 150-KB output, bounded limits, malformed/stable-ID edits, cancellation, preserved
analysis, and safe error mapping. The new edit tests are included in the named Agent Runtime gate.
Installed app verification remains pending normal quit and a rebuilt/signed package.
Verification: full `pnpm check` 4,150 passed / eight existing environment skips; named Agent Runtime
1,545 passed (119 + 816 + 545 + 65). Final Model Lab recheck 396 passed, typecheck/lint/format and
production build passed. Docs regression 2 passed. New focused edit suite 11 passed; the existing
large-chunk build warning is unchanged. No new installed binary or private-model repair is claimed.

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

Since 0.58.143 `/new` and `/compact` are handled by `POST /api/model-copilot/context`, which takes the
answer route's conversation identity plus the action and derives the question from the action.
`/new` sets `contextStartsAt` to the number of stored records and empties the checkpoints: later turns
plan, and `search_conversation` reads, only the records after it, while every record stays in the file
and on screen above a divider. `/compact` runs `compactConversationNow` with the planning, scope,
summarizer and busy guard of a normal turn. Neither starts an answer turn or appends a message. The
renderer sends only the messages after the divider as the bootstrap conversation.

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
