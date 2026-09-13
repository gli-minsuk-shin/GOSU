# Shared research-agent harness

2026-09-14: [Model Lab context parity](MODEL_LAB_CONTEXT.md) adds shared history budgeting,
same-provider pressure compaction, owned original search and the common usage meter. It also fixes
Model Lab's Claude `gosu_project` registration. [0.58.41](releases/0.58.41.md) is a verified candidate,
not yet installed; live Claude inference remains unverified. This supersedes the old mismatch below.

2026-09-10: shared policy v2 adds a mandatory, non-authorizing paper-save offer for conversational
paper analyses and follow-ups. Project Chat, Model Lab chat and Briefing Chat use the same human
confirmation UI and create-only encrypted library; no save tool is exposed to the model. See
[the storage/permission contract](SHARED_PAPER_LIBRARY.md) and [0.58.11 deployment status](releases/0.58.11.md).

Maintenance note (2026-09-09): shared adapter reuse does not prove tool-protocol parity in
every consumer. The remaining Model Lab Claude namespace mismatch is tracked in
[the maintenance guide](MAINTENANCE_GUIDE.md#알려진-제한과-후속-보수). Briefing Lab has its own
provider-appropriate registration and real MCP bridge contract regression. Do not treat the
historical verification section below as successful current Claude live inference.

GOSU Desktop and Model Lab use the same native Codex App Server and Claude Code provider adapters.
Model Lab chat no longer launches a new print-mode CLI for each JSON-selected tool step. A single
native turn can inspect a module, follow connections, observe receipts, and return the final answer.
The old scripted step loop remains available as a compatibility/test utility and is not the production
Model Lab chat route.

## Shared code and prompt boundaries

- `packages/contracts/src/research-agent-harness.ts` defines the stable
  `gosu.research-agent.policy` instruction prefix and its version.
- Desktop's prompt assembler records that policy in harness provenance. Project-specific SSH,
  experiment, Research Notes, approval, and review-mode contracts remain domain instructions.
- Model Lab uses the same policy for Copilot, Model Builder, pseudocode normalization, narrative
  reconciliation, and Python artifact generation. The final schemas differ with the task.
- Native Model Lab chat sends developer instructions separately from the user question, model seed,
  recent conversation, retrieved model-lineage memory, and attached evidence.
- Both apps use the shared context-budget and permanent-memory contracts. The exact current question
  remains in the user input. Imported or remembered content never expands permissions.

## Native execution

`apps/model-lab/model-lab-native-agent.ts` reuses the Desktop Codex and Claude adapters and dispatches
six registered read-only graph tools plus an owned-session conversation search when available.
Native callbacks carry actual receipts and progress. Model Lab
returns a validated answer plus an optional requested edit description; graph changes still go
through the existing reviewed ModelIR proposal path. Python generation and model import remain bounded
structured compilation jobs, not unrestricted repository execution.

Codex's code-mode orchestration process must be enabled for current native dynamic tools. Threads
activate it only when GOSU registers dynamic tools. Shell, browser, computer, plugin, and other native
capabilities remain scoped by the existing GOSU configuration and callback ownership checks. Turning
off the orchestration host can otherwise let the model attempt tools that never reach GOSU.

`resolveGosuCodexHome()` shares the existing GOSU login and config scope between Desktop and Model Lab.
Standalone discovery checks only the existence of auth.json in the current GOSU and legacy
@gosu/desktop application-data paths. It does not copy credentials. Explicit paths retain precedence.
This avoids inheriting unrelated MCP servers from the user's general CLI configuration.

Claude uses the original native system prompt plus the GOSU application boundary. Within a retained
adapter thread, a completed exact session UUID can be resumed explicitly. Failed, interrupted, or
unconfirmed UUIDs are not reused. Explicit image attachments use native stream-json input rather than
granted filesystem tools. Authentication and timeout failures are reduced to safe actionable codes.

## Session and evidence limits

The shared application-language preference now controls new natural-language output after an
explicit 한국어/English selection. Native developer boundaries, queued turns, delegated callbacks,
and Model Lab generation/cache paths snapshot the same preference. Code, formulas, identifiers and
historical artifacts are preserved. See [Application language](APPLICATION_LANGUAGE.md).

The application lifecycle still releases each user-question provider thread after completion. Thus
this update does not claim cross-question native transcript continuity identical to a long-lived CLI
session. Cross-question context is maintained by GOSU's session history, working memory, and relevant
permanent memory; Model Lab uses its model-lineage history and permanent memory. The native Claude
resume capability is available for retained adapter threads, not a promise that the current UI keeps
every provider thread open. Account access and reasoning settings remain provider-owned.

Model Lab tools inspect supplied ModelIR snapshots; they do not execute model code, train it, or prove
that a gradient flowed. Runtime claims still require an observed receipt.

## Verification on 2026-09-07

A synthetic Astra question called inspect_module, then trace_connections upstream, and returned the
correct projection dimensions and equation with two successful native receipts. This used one native
provider turn. The same test question on the previous scripted path reported 49,111 input tokens;
the native path reported 28,682. This is one smoke comparison, not a general quality or cost benchmark.

The real Claude smoke reached an expired OAuth token (401), so live Claude inference and continuation
were not verified. Mocked adapter tests cover native session IDs, generic result schemas, image input,
auth failures, scope checks, and cleanup. Model Lab displays a specific reauthentication message.

Final test gates: Desktop 2,186 passed, 8 environment-dependent skips; Model Lab 238 passed;
contracts 40 passed; integrations 19 passed; Agent Runtime 46 passed. The skipped Desktop checks require
MacTeX opt-in, Linux-specific behavior, or live external Claude/Hermes opt-in. Typecheck, lint, and
production builds are required for the affected packages.
