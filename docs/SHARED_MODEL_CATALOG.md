# Shared model discovery and selection

Installed [0.58.34](releases/0.58.34.md) adds bounded native maximum/effective context metadata
and configured/provider/fallback provenance. Runtime usage reports override nominal limits;
see [context accounting](CONTEXT_BUDGET_AND_USAGE.md). No universal 1M entitlement is inferred.

Post-0.58.31 source: the Briefing title-bar label reads `/assistant/model/current`, which resolves
the stored assistant preferences through the same `briefingAssistant` routing policy and model
resolver as chat. It no longer labels Auto with a separately loaded provider catalog default.
Explicit pins are preserved; failures show the configured pin or Auto, never a guessed model.
Mount, window focus and response-state changes refresh this read-only metadata; no inference,
settings write or source read is initiated. The menu remains disabled during a response. Historical
message footers continue to describe their own invocation, not the next request's selection.
This source change is not yet packaged or installed. See [global assistant](GLOBAL_ASSISTANT.md).

The 2026-09-13 changes below are included in installed [0.58.30](releases/0.58.30.md).
Earlier installation-pending statements are historical; live authentication checks remain separate.

## Codex and Claude connections; retired optional providers (2026-09-13 source)

Settings → Agent replaces the optional-local-provider radios and long runtime disclaimer with
matching Codex and Claude connection cards: status, connect/reconnect, catalog refresh and
disconnect/sign-out. Codex uses the same existing handlers as Connections, including ChatGPT
sign-in. Claude reuses its existing local Claude Code subscription authentication; its sign-in
guidance is not a new embedded OAuth flow. Disconnecting Claude in GOSU does not log the local CLI
out. No credentials are copied or authentication policy relaxed. Mounting this card performs no
optional-provider discovery or login.

GOSU Main registers only Claude in the add-on registry and no longer injects Hermes delegation
into ProjectChatService. OpenClaw was detection-only; Hermes was an explicitly selected ACP
provider/delegation, not required by ordinary Codex/Claude/Briefing jobs. Preference parsing retires
only Hermes/OpenClaw to disabled; Claude and unrelated model/layout/source settings are preserved.
Explicit historical Hermes model pins are not silently sent to another provider; users must select
an available model. No active app process, system CLI, account or conversation was deleted.

Legacy adapter code, provider IDs, provenance schemas and packaged compatibility assets remain
for historical data/development tests. This is removal of app connections/discovery/delegation,
not uninstallation of third-party tools from the user's Mac or a full repository dependency purge.
Production registry filtering prevents old callers from reconnecting retired providers. The change
is source-only until an app replacement; installed 0.58.29 is unchanged.

Synthetic browser inspection verified consistent card spacing and explicit buttons without actual
authentication. Focused provider/settings/preferences regression: 48 passed. Historical records
and unavailable-provider handling are preserved; live Claude authentication was not exercised.
Final `pnpm check` passed: Desktop 2,393 passed / 8 existing environment skips, Briefing 692,
Model Lab 341. Formatting, lint, typecheck and production builds passed. Agent Runtime 665 passed
(197 Desktop + 467 Briefing + 1 Model Lab); provider connection regressions are in that named gate.

2026-09-13 source: new policies now map `briefingAssistant` to `strong`, while `briefing` remains
`fast`. Settings labels the former as the global assistant. Persisted routing and explicit pins
are preserved. See [global assistant](GLOBAL_ASSISTANT.md); the historical fast default below
describes the earlier implementation, not new-policy behavior.

## Role-based model routing (2026-09-12 source update)

Settings → Agent now offers two independent model/effort profiles, **빠른 모델** and
**고성능 모델**, plus a workload selector for each of:

- new Project Chat sessions (strong by default);
- Briefing email/paper summaries (fast by default);
- Briefing assistant chat (fast by default);
- Lecture, literature and experiment AI jobs (strong by default, Codex-only).

Each workload can use either profile or retain its existing default. Profiles initially remain
unconfigured; no provider model name or cost/latency ranking is invented. Users choose actual
available catalog models and reasoning levels. Explicit session/studio choices remain pinned;
Briefing uses a routing profile only when its routine model is Auto. Existing provider-qualified
default settings remain the fallback for unset roles. Settings labels this fallback separately.

`packages/contracts/src/model-routing.ts` defines the strict shared schema. Main owns
`model-routing.v1.json` under `app.getPath('userData')`; only model IDs, reasoning and workload
choices are stored. `model-routing:get/set` are validated through the existing trusted-renderer
IPC boundary. Writes are atomic and serialized. Missing files retain legacy behavior; corrupt
files fail visibly rather than selecting a different potentially expensive model. No settings,
permissions, credentials or conversations are copied into this file.

The app-owned Briefing host reads the saved policy for subsequent analysis/chat work, including
scheduled jobs while another app section is visible. Standalone Briefing retains its settings.
Private data is never moved to another provider by routing: a mismatch with the routine's provider
fails and asks the user to review Briefing provider/privacy settings. Hermes is not supported by
Briefing; Lecture/literature/experiment AI currently requires Codex. Both schema and UI reject
unsupported workload/provider combinations. Existing cache reuse occurs before model invocation,
so changing roles does not automatically regenerate identical saved summaries.

Project Chat does not persist a placeholder while routing loads. Lecture waits before mounting
its scoped model loader. Existing user selections are not rewritten by role changes; new work uses
the current policy. Missing catalog models/efforts stay visible and do not silently fall back.

Tests exercise independent mappings, explicit overrides, provider boundaries, corrupt/restarted
storage, delayed initial load, failed saves, the real summary execution input and cache reuse.
The synthetic browser fixture `apps/briefing-lab/tools/model-routing-visual.html` exercises the
actual Settings card without saving user preferences or making model/provider calls.
This source update is not yet included in the installed 0.58.20 app or the earlier 0.58.25 artifact.

Verification on 2026-09-12: focused Desktop tests 19 passed; focused Briefing tests 35 passed.
`pnpm check` passed formatting, generated contracts, lint, typecheck, all workspace test gates
and production builds. Desktop: 2,384 passed / 8 environment skips (MacTeX opt-in 5, Linux-only 1,
live Claude/Hermes 1 each); Briefing: 664 passed; Model Lab: 341 passed. Agent Runtime: 635 passed
(188 Desktop, 446 Briefing, 1 Model Lab). Browser QA rendered the real settings card and verified
independent model/effort selection, workload reassignment and explicit save confirmation using
synthetic model choices. No real provider invocation or user settings mutation was used in QA.

GOSU Desktop and Model Lab share provider catalog normalization, model selection, reasoning resolution,
and automatic refresh through `@gosu/contracts`. Additions to the native Codex catalog require no
model-name update in either app.

## Common implementation

- `packages/contracts/src/model-catalog.ts`: `createCodexModelCatalog`, `selectCatalogModel`,
  `selectCatalogModelFromList`, and `resolveCatalogReasoning`.
- `packages/contracts/src/model-catalog-refresh.ts`: the same mount, focus, visibility, and
  60-second refresh lifecycle. Hidden pages pause; overlapping requests coalesce; failed background
  refreshes preserve the last displayed catalog.
- `packages/integrations/src/codex-runtime-discovery.ts`: bounded version discovery for the bundled
  runtime, PATH Codex, and installed Codex/ChatGPT desktop runtimes on macOS.

Auto follows the connected provider's default. Explicit model and reasoning selections stay pinned;
missing selections are reported as unavailable. Model names and reasoning IDs are opaque, including
future values. Upgrade metadata is retained but does not silently rewrite explicit selections.
Provider-reported context size is used when supplied; missing metadata retains the conservative
128,000-token fallback and does not assert the full advertised model capacity.

Runtime discovery chooses a newer installed stable runtime within the fallback's major version.
It never downloads a runtime. Explicit executable overrides win. GOSU pins one runtime per connection,
so running turns are not interrupted; an installed runtime upgrade is adopted on the next connection.
Model availability still depends on the provider, authenticated account, and installed runtime support.
A protocol change or unavailable model can require a runtime update even though no app model list needs
editing.

## Consumers and verification

Desktop's main catalog adapter, Project Chat selection, Settings selection, and central refresh owner
consume these shared functions. Model Lab's server, Copilot picker, and Model Builder picker use the
same functions. Model Lab retains its last known catalog on temporary discovery failure rather than
inventing a current model from a hardcoded fallback.

Briefing Lab's [title-bar selector](BRIEFING_WORKSPACE.md#title-bar-model-selection-2026-09-09)
also uses the existing native provider catalog endpoint and `selectCatalogModelFromList`. It loads
on menu opening or explicit refresh rather than the Desktop focus/timer lifecycle. A narrow backend
settings patch validates model/effort availability without rewriting source permissions; unavailable
explicit pins never silently become Auto. Existing saved summaries are not regenerated by a selection.

Behavior tests cover unseen model and reasoning IDs, default changes, explicit pins, provider
isolation, catalog metadata changes, refresh cancellation and coalescing, and newer runtime selection.
The Model Lab server tests also compare its catalog with the Desktop adapter for identical wire data.

On 2026-09-07, both live app paths discovered `gpt-6-astra` as the provider default. Model Lab's rendered
picker showed GPT-6-Astra. This was a subscription CLI catalog check; no API-key integration was added.
