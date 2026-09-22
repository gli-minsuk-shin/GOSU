# Model generation deadlines and cancellation

2026-09-15 candidate. See [Python import](PYTHON_MODEL_IMPORT.md) and
[graph validation](MODEL_GRAPH_PRESENTATION.md).

The inspected failure receipt reached the local 300-second generation deadline with no candidate
returned. It was not a completed ModelIR rejected by the validator. Earlier receipts separately show
validation failures and successful generation; do not conflate those causes or infer a provider outage.

Structured graph generation now permits 15 minutes per provider call, or 30 minutes when estimated
prompt input exceeds the existing 20,000-token threshold. Short mathematical source can require long
reasoning/output, so it is no longer limited to five minutes. Codex/Claude imports, full pseudocode
normalization and Model Copilot graph compilation share this graph policy. Ordinary small structured
calls retain their two-minute budget, and native conversational reasoning has its separate existing
limit. Model/effort selection, context/token/output limits, source checks and validation are unchanged.

These are per-call bounds, not a promised completion time for the whole pipeline. Existing limited
validation repairs can add calls; a timeout does not itself trigger an automatic new call. Existing
audited cache/source reuse remains intact, and incomplete output is not installed as a graph.
Fifteen-second import heartbeats display actual elapsed time and the chosen 15/30-minute limit.

The import UI now exposes Stop for its current build. Its AbortSignal covers the fetch and backend
caller; abort checks before/after local preparation and after streamed responses prevent late output
registration. Stream readers are cancelled/released on completion or error. Shared-build cancellation
still removes only the caller, leaving another owner's joined work alone. Completed earlier imports
are preserved. Explicit cancellation is stored as a cancelled phase, not successful completion.
Leaving a model/tab is not cancellation; actual component disposal/app shutdown still aborts.

Regression tests use virtual time and a controlled child process: six-minute response accepted,
silent response terminated at fifteen minutes, immediate abort after minute six, no automatic second
process, large-input policy parity, heartbeat beyond five minutes, pre-aborted/late responses and
cancelled-history persistence. No paid long-running inference was started for these tests.
