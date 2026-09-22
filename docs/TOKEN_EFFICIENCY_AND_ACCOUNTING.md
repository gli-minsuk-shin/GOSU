# Request context selection and usage accounting

Installed 2026-09-14 in [0.58.55](releases/0.58.55.md). Extends
[context capacity and accounting](CONTEXT_BUDGET_AND_USAGE.md); large native capacity stays available.

## Request projection, not history deletion

The shared selector recognizes only a narrow list of literal greetings/thanks/presence checks.
Short approvals (응/계속), task/server status questions and mixed substantive requests are not classified
as greetings. Greetings omit old conversational context without calling a compactor. Project Chat
also omits board/objective and optional memory bodies, retaining current user text, identity,
custom preferences and project rules. Assistant greeting turns omit source tool definitions when
there is no attachment or selected paper. Attachments/model references/review workflows retain their
existing Project Chat context path.

For long substantive histories, select complete user-led turns within a 32K estimated history budget:
recent turns first, relevant earlier turns, then remaining recent turns. Selected turns keep original
order; source records are unchanged. If the most-recent turn itself is too large, preserve the normal
full-context/compaction path rather than replacing it with irrelevant old content. Explicit full-history
requests use the native-capacity planner. If selected text does not fit the actual native budget,
normal compaction still applies. Effective model capacity is retained even when its reporting message
is omitted from the projection.

Projection is deliberately separate from a persisted compaction checkpoint. It never saves a selected
subset as the original archive checkpoint. Original search remains available; the prompt states when
history was omitted and directs the model to search rather than guess. AI Assistant, Project Chat and
Model Lab use the common mechanism. Model Lab retains model/revision isolation and full original files.
Configured model/reasoning choices and native context limits are not silently lowered.

Estimates still use the conservative existing estimator, not an asserted exact GPT tokenizer. A
public synthetic 160-message Project Chat fixture with the same safety/custom-rule envelope changed
from **321,235 to 10,100 estimated input tokens (96.86% less)** for a literal presence check. All 160
originals remained, with zero compaction calls. This is not a real-user bill or provider latency result.
Reproduce via `apps/briefing-lab/tools/token-diet-smoke.ts` using esbuild and Node; no LLM is called.

## Durable per-call measurements

Existing SQLCipher Project Chat usage attribution remains. Codex input/output/total counters are now
accepted when optional cache-write/reasoning counters are absent. Missing fields stay null; malformed
provided counters and inconsistent totals are rejected. Cached tokens are a subset of input, never
added again to input/output totals. Current context occupancy is not summed as billing usage.

App-owned `native-usage-ledger.v1.json` stores only invocation identity, actual resolved LLM model,
provider, workload, opaque project ID, timestamps, status and reported counters. It contains no prompt,
conversation, email, source text or credential, uses atomic 0600 writes and is independent of chat
deletion. Up to 100,000 records/80MB are supported; capacity/corruption is an error, not silent eviction.
Same invocation identity is idempotent; contradictory receipts are rejected. Unknown usage remains
unavailable and is excluded from known-token totals. Failed identified invocations retain known usage
as a partial lower bound. Pre-invocation failures without native identity cannot be attributed reliably.

The native Briefing and Model Lab engines observe real invocation/usage lifecycle. Async-local scope
labels AI Assistant, Briefing/summary, Model Lab and compaction work; Main supplies project ownership.
Project and Model Lab compaction calls are accounted separately using their actual selected model.
Querying Usage merges these receipts with existing Project Chat records without re-logging either.
The global analytics-owner sentinel is excluded from project rows; it does not create a project or
write a fictitious project into SQLCipher. AI Assistant is selectable as a workload. Project rows now
have an additional resolved-model breakdown; existing date/project/connection/model filters apply.

Usage is not an account-wide subscription balance or a currency bill. Previous uncollected usage is
not fabricated from prompt-size estimates. Caches or summaries reused without invoking an LLM do not
create a charged model call. Observer write errors do not fabricate zero usage or discard an answer;
they are reported as an accounting failure. Real billing/recall quality was not benchmarked.

## Reference principles

[OpenClaw pruning](https://docs.openclaw.ai/concepts/session-pruning) preserves originals while trimming
request context. [OpenClaw compaction](https://docs.openclaw.ai/reference/session-management-compaction/compaction)
distinguishes window capacity from observed counters.
[Hermes caching/compression](https://hermes-agent.nousresearch.com/docs/developer-guide/context-compression-and-caching)
emphasizes stable prefixes and cache invalidation when history/model identity changes. GOSU retains its
stable policy/history ordering but does not claim every projected request is a cache hit: selecting a
different historical prefix can invalidate cache. Cache-read measurements are shown, not guessed.
Anthropic API cache_control flags are not blindly injected into Codex/Claude CLI protocols. No
OpenClaw/Hermes connection, account migration or new paid API is enabled by this update.
