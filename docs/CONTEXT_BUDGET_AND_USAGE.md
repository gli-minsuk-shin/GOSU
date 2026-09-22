# Native context capacity and assistant token accounting

2026-09-14 follow-up: [request selection and accounting](TOKEN_EFFICIENCY_AND_ACCOUNTING.md)
supersedes the all-history-by-default policy for greetings and long ordinary requests. Original
history, explicit full-history access, native capacity and compaction are preserved. It also wires
native assistant/model-lab counters into the Usage page and repairs optional-counter validation.

## Explicit extension versus detected limits — candidate 0.58.45

The [Astra specification](https://developers.openai.com/api/docs/models/gpt-6-astra) still states
1,050,000 tokens (checked 2026-09-14). GOSU now always requests that documented extension for the exact
Astra identity, even when native metadata advertises a smaller maximum. It uses documented
[`model_context_window` and `model_auto_compact_token_limit`](https://learn.chatgpt.com/docs/config-file/config-reference)
per thread, never edits the user's global Codex config or provider catalog. This is a request, not a
provider entitlement override. Other models use their own detected windows, not a universal 1M value.

The fresh bounded native cache reader also extracts `context_window` when maximum metadata is absent,
and matches exact model IDs before native wire aliases. Model/list still determines available models;
no model name is inferred. Catalog metadata separates default, native maximum, requested window and
effective request headroom. Unknown/stale data uses a labeled safe fallback. First-turn preparation
stays within the detected transport envelope until runtime telemetry confirms expansion.
Native auto-compaction also stays below that detected envelope while the larger request is unconfirmed;
raising a requested maximum must not disable timely compaction on a smaller effective connection.

The common meter now shows requested, detected maximum, default and actual execution window separately
in its existing collapsed details. It is shared by AI Assistant, Project Chat and Model Lab. A stable
context-configuration fingerprint scopes learned limits: after model/capacity configuration changes,
old observations no longer pin the new session to the previous smaller window. Matching new runtime
reports may increase or decrease subsequent budgets. No transcript or checkpoint is deleted.

Two short synthetic transport probes used no private files/tools. The final probe requested 1,050,000,
but the current Codex connection still reported **828,400 effective tokens**, with native maximum
872,000 and 95% headroom. It consumed 7,256 input / 5 output (0 cached input), not 1M input tokens.
Thus **actual 1M execution remains unavailable on the tested transport**; do not label the request as
successful capacity expansion. Do not forge metadata, bypass provider limits, migrate authentication or
switch to separately billed APIs without user direction. Future provider/runtime capacity changes are
rediscovered and used automatically through the shared catalog and live telemetry.

The API page documents higher long-context rates above 272K input; subscription accounting can differ.
Capacity is not usage, and this small probe does not establish long-context recall or reasoning quality.
See [0.58.45](releases/0.58.45.md) for gates, artifact and installed-status evidence. It supersedes the
older native-maximum-first request selection below, not its privacy and conservative-planning rules.

## Model Lab parity — candidate 0.58.41

[Model Lab context and usage](MODEL_LAB_CONTEXT.md) now reuse the same planner, compactor, original
search and meter. The AI archive is independent from its 200-message UI cache. Native counters,
same-provider compaction boundaries, model/revision isolation and existing model memory are preserved.
See [0.58.41](releases/0.58.41.md) for gates and the normal-app-shutdown installation blocker.

## Project Chat parity — installed 0.58.37

[0.58.37](releases/0.58.37.md) passed all gates and was installed with previous data preserved.
The new meter was confirmed in the native Project Chat UI; the measured-value expanded UI used
synthetic data. Earlier messages without this telemetry remain unknown, not estimated retroactively.

Earlier Project Chat budget expansion did not remove the storage snapshot's **250-message** ceiling.
The backend now has a separate scoped context reader (up to the latest 5,000 complete historical
messages), while the renderer snapshot remains at 250 for responsiveness. Original-text search can
query older retained messages in the exact current project/session and page a selected message.
This is not cross-project search or a claim of unlimited verbatim model recall.

Known-window prompt assembly redistributes unused project-context allocation to exact history,
instead of rigidly leaving it outside the previous 42% slice. Character guards scale with the token
budget up to 8M characters; the estimated total must still fit the reserved native input budget.
Unknown-window fallbacks remain conservative. Prompt provenance v7 retains readers for v1–v6.
The stable history prefix precedes volatile project state in the request envelope, improving cache
reuse opportunity without claiming that every request is cached or free.

Project Chat reuses `prepareConversationContext` and `compactConversation` from the assistant.
No compaction call when text fits. At pressure, summarize only the older prefix and keep the recent
tail exact. Use the configured summary-role model only when it has the same provider; otherwise use
the current selected model. This never enables Hermes/OpenClaw or transmits history to another provider.
Checkpoint scope covers project, session, provider and profile revision, with an exact prefix digest.
SQLCipher `project_chat_context_state` stores the checkpoint and latest context accounting outside the
app bundle. Original messages are untouched. Cancellation during preparation aborts the compactor
before an answer turn is started. Preparation failure keeps original data; compaction is additional
model work, not a free capacity increase.

Since 0.58.143 the reader can ask for the same compaction with `/compact`, and start an empty context
with `/new`, in Project Chat, the assistant chat and Model Assistant. `compactConversationNow` is the
same engine without the pressure check: it keeps the latest four messages exact, extends a valid
checkpoint and calls no model when nothing older is left. It uses the same summary model, usage kind,
checkpoint store and stale guard, so the next turn finds the checkpoint. In Project Chat it is the
`compactSession` IPC command, which runs only while the session is idle, is cancelled by the same Stop
control as a turn's own preparation, and returns expected failures as a bounded reason instead of
throwing. A command is recognized only when the whole message is the command and is never sent to a
model or stored. See [0.58.143](releases/0.58.143.md).

Both chats render the same collapsed-by-default `ContextUsageMeter`: native current occupancy vs
capacity, usable remaining after response reserve, source of the limit, original/compacted/omitted
message counts, cumulative input/output, cached input, reasoning and compaction-call usage. Native
events are fenced to the owned active thread/turn. Compaction invalidates stale occupancy; Claude
cumulative totals are not mislabeled as current occupancy. Final telemetry persists across restart;
historical unknown counters stay unknown. UI model changes do not retrofit counters into old replies.

Focused tests cover 600-message retention without compaction, pressure/checkpoint reuse and scope
change, original source preservation, 240 long messages fitting a verified 1M budget, live accounting
and compaction invalidation, preparation cancellation and UI component reuse. SQLCipher smoke proves
310 backend messages vs 250 UI records, old-message search isolation and checkpoint/usage restart.
These are mechanism regressions, not a measured scientific-intelligence or 1M-token-recall benchmark.
See the release record for actual gates and installation status.

Installed on 2026-09-13 in [0.58.34](releases/0.58.34.md). See
[shared harness](SHARED_RESEARCH_HARNESS.md) and [assistant storage](GLOBAL_ASSISTANT.md).

## Capacity is not a universal 1M entitlement

The [Astra model page](https://developers.openai.com/api/docs/models/gpt-6-astra) documents
1,050,000 tokens. This is not proof that a particular subscription transport exposes the whole
API window. GOSU's native cache currently advertises default 272,000, maximum 872,000 and effective
95% for this connection. One short synthetic live call reported **828,400 effective context**,
7,286 input, 15 output, zero cached input and 7,301 last-context tokens, completing in 5,772ms.
No private source content or tool access was used. This is a transport check, not a 1M-token recall
or scientific-quality benchmark, and future runtime/account values may change.

The Codex adapter reads only a bounded, fresh `models_cache.json` from its existing isolated GOSU
home. It extracts model identity, maximum window and effective percentage, never instructions or
auth data. Available models are still discovered through `model/list`. Native maximums are requested
per thread; the configured auto-compaction threshold leaves headroom. Missing native maximums keep
provider metadata or a visibly labeled fallback. Astra alone has a documented extended-request
fallback; unknown model families are not guessed. Runtime-reported effective windows take priority
in the UI and subsequent same-model conversation planning.

Claude usage can carry a matching `modelUsage.contextWindow`; another model's entry is not borrowed.
Missing data remains unknown. Existing CLI auth, model arguments, account restrictions and credit
opt-ins are unchanged. Claude totals aggregate tool rounds and are not treated as current occupancy.
Claude live inference was not exercised for this change.

## Context assembly and durable compaction

The assistant browser sends only the current request. The server reads the owned, encrypted
conversation and budgets its complete history rather than slicing six messages or each message at
12,000 characters. It reserves output, tool and safety capacity. Current instructions and the user
question remain distinct from untrusted historical text. Project Chat also removes the 40/80-message
ceiling for known windows and expands its bounded history budget; unknown-window safety fallback,
project isolation and permission checks remain in place.

When history fits, it is kept verbatim without a compression call. At pressure, older records are
summarized using the configured Briefing summary model through the existing same-provider boundary;
recent records stay verbatim. A scope-checked encrypted checkpoint stores the source-prefix digest
and summary. Commit validates that prefix again; failures preserve raw messages and the previous
checkpoint. A summary is lossy historical reference, never an authorization or authoritative source.
`search_conversation` can find full preserved text and page beyond the first excerpt for exact
formulas/IDs. Full original user/assistant messages remain on disk. This does not persist hidden
reasoning or claim cross-question native CLI-session equivalence.

The serialized request keeps the history prefix before volatile request metadata to improve cache
opportunity. Compaction is episodic, not unconditional every-turn rewriting. Native runtimes retain
their own in-turn tool/compaction handling; GOSU does not split native tool-call/result pairs.
Assistant tool rounds stay bounded (24, or 48 for large advertised windows); routine design remains
at 12. Grants, native shell restrictions and duplicate-write safeguards are unchanged.

## Display semantics

The composer has a collapsed-by-default meter. It separates current/initial-estimated context,
output reserve, original/compacted/omitted message counts, cumulative reply input/output, cached input,
reasoning output, and additional compaction calls. Estimates use the existing conservative text
estimator, not a claim of exact tokenization. Reported missing fields are never converted to zero.
Codex last-context counters are not confused with cumulative totals. A compaction event invalidates
stale occupancy until another report arrives. Stream events are matched to the owned thread/turn.
Metrics persist with completed answers and are restored as historical request information. They are
not a subscription balance or a bill; earlier replies without metrics are not backfilled with guesses.

## Reference patterns and verification

- [OpenAI Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference): per-model
  context and auto-compaction controls, without widening native capabilities.
- [Claude model configuration](https://code.claude.com/docs/en/model-config) and
  [SDK ModelUsage](https://code.claude.com/docs/en/agent-sdk/typescript#modelusage): runtime/account
  distinctions and per-model capacity rather than guessed occupancy from summed usage.
- [OpenClaw compaction](https://docs.openclaw.ai/reference/session-management-compaction/compaction):
  preserve transcripts and distinguish tracked counters from capacity.
- [Hermes micro-compaction](https://github.com/NousResearch/hermes-agent/blob/main/docs/micro-compaction.md):
  avoid breaking the cache prefix on every turn; compression is extra model work, not free capacity.

No OpenClaw/Hermes connection is enabled. Regression coverage checks 200-message retention without
compression, pressure/checkpoint reuse and corruption fencing, original-text retrieval, server-side
history assembly, native counters and compaction invalidation, scoped metadata reads, Claude model
matching, and compact meter semantics. The native transport probe above is the only live inference;
unit/synthetic cases do not prove general reasoning quality or a guaranteed latency/cost improvement.
