# Briefing Lab — Routine AI prototype

Status: standalone with GOSU-native LLM routine design and manual live Apple Mail/Open-Meteo/arXiv
source adapters. See [live source setup and boundaries](BRIEFING_LIVE_SOURCES.md). The existing
sample/history tab remains fixture-only. There is no operating-system scheduler or live Calendar,
task/funding bridge or encrypted private briefing archive yet. Optional source-backed LLM summaries,
automatic backend memory, Scholar alert candidates and visual weather are implemented; see
[Briefing intelligence](BRIEFING_INTELLIGENCE.md).

## Start and verify

- Start: `pnpm briefing-lab:dev`
- Local UI: `http://127.0.0.1:4318`
- Stable built UI/API (no HMR): build, then `pnpm --filter @gosu/briefing-lab preview`.
  Do not run preview and dev simultaneously on the same port. Static file hosting alone
  does not supply the native agent API.
- Required gate: `pnpm briefing-lab:check`, then `pnpm format:check`.
- macOS visual gate: `pnpm --filter @gosu/briefing-lab smoke:visual:mac` (isolated fixture).
- CI also discovers both new workspace packages through the existing Turbo test/build gates.
- `pnpm test:agent-runtime` also runs the routine native-engine, proposal and local-host
  boundary regression tests. Unit tests mock providers; they never spend subscription quota.

Briefing Lab remains standalone. Desktop 0.58.10 adds only a reviewed project-context JSON export
for connecting Project Chat working-memory snapshots; it does not embed Briefing Lab.

## Create a routine with the GOSU LLM engine

Choose **AI로 새 루틴 → GOSU 엔진 연결**, select a Model and Reasoning, and describe the
desired time, research interests and sources. The source/validation progress is observable,
and the returned receipt names the actual resolved provider/model/reasoning. Stop cancels
the active native request; there is no background retry or provider fallback.

The browser sends the current request, at most six recent messages, and the last unapplied
proposal. It does not read existing projects, mailbox bodies, private files or credentials.
Conversations are ephemeral to the open Copilot pane; reviewed routines use the existing
browser-local routine store. Review the proposal and next five times before clicking
**검토한 루틴 추가**. A follow-up can revise the unapplied proposal. A newer request invalidates
the old apply action, even if the new request fails. Each accepted proposal creates a new
host-identified `draft`; existing routines are not overwritten and schedules are not activated.

### Shared engine, domain-specific tools

- Codex uses the actual Desktop `CodexAppServer` and `resolveGosuCodexHome()`, with GOSU's
  existing subscription identity and live provider-owned model/reasoning catalog. API-key
  account types are rejected before inference.
- Claude uses the actual Desktop `ClaudeCodeProjectChatAdapter`, including its authenticated
  subscription check, model mapping, supported reasoning, native system boundary and scoped
  MCP bridge. The Briefing app contains no duplicate Claude model list.
  Its tools are registered in the adapter's required `gosu_project` namespace. A real MCP
  bridge registration test guards this contract; mock-only transport tests are insufficient.
- The stable instruction prefix is the shared `assembleResearchAgentInstructions` policy;
  GOSU's saved response-language preference is read at request start.
- Available tools are `list_briefing_sources` and `validate_routine_proposal` only. The native
  provider can iterate these tools in a single turn; 12 calls and three minutes are the limits.
  Each turn owns a temporary directory, provider thread and cancellation scope. Final output
  is schema-validated and independently checked by the scheduling core, regardless of tools used.
- This reuses GOSU's engine, not all Project Chat permissions, context or memories. Routine
  design does not need repository, shell, mail, filesystem-write or arbitrary web tools.

The Vite dev/preview host accepts only loopback port 4318 with matching Host and same-origin
browser metadata, followed by a per-process capability header for catalog/inference routes.
Bodies are capped at 128 KB, at most three host requests run concurrently, responses are
non-cacheable NDJSON, and disconnect/server shutdown aborts active turns. Error responses do
not expose raw provider output or credentials. No API key is copied or fallback account selected.

Native auth status/catalog detection does not guarantee that an OAuth token is still usable
for inference. A `claude_code_auth_required` turn failure is preserved as an actionable
re-login message, not mislabeled as invalid routine data. On 2026-09-08, GPT-6-Astra / medium
completed the browser live test (source inspection, proposal validation and correct weekly
schedule). Claude's real MCP bridge initialized, but its inference returned auth-required;
successful Claude inference still requires the user's re-login. No test routine was saved.

## Included

- Independent personal/research and funding routines, initially saved as drafts.
- Editable schedule, weighted research keywords and synonyms, exclusion keywords, source
  subscriptions, manual funding countries, and custom public HTTPS source URLs.
- Next five delivery-time previews: daily or N-day intervals, weekly/N-week intervals with
  weekdays, multiple times per day, monthly/N-month intervals, month-end clamping, and IANA
  timezone handling. The scheduling core includes missed-occurrence coalescing as a pure
  function; no browser/OS task is installed.
- Manual fixture runs, source outcomes, deterministic keyword relevance ranking, selected
  routine history, and per-run card hiding.
- Run snapshots preserve the settings used at execution. Later settings/source changes do
  not silently rewrite prior results.
- Deleting a routine retains its previous results in read-only archived-run navigation.
- Collapsible/resizable navigation and details panes, independent scrolling, and responsive
  layouts using current GOSU light-theme colors and typography.
- Bounded browser-local persistence with validation and visible storage-error handling.

## Grouped briefings and display order

The briefing opens as a category overview, not a mixed relevance-sorted card feed. Each
category shows its visible item count and up to two leading headlines. Click a category
tile or section header to expand its cards; **모두 펼치기 / 모두 접기** controls all sections.
Wide content panes show the compact sections in two columns; expanded sections occupy the
full width, while narrow panes keep a single column. The category tiles also jump to and open
the selected section without changing stored settings.
Emails, papers, deadline-bearing tasks, weather and other source kinds remain separate.
Relevance order is preserved within each section, without re-scoring or changing run receipts.
Hidden cards are excluded from counts and headline previews; an all-hidden section remains
discoverable with its hidden count and the existing restore action.

In **루틴 설정 → 브리핑 표시 순서**, drag rows or use the accessible up/down controls, then
save. `sectionOrder` is a routine-local display preference, also used for existing results
of that routine. Unsubscribed kinds keep their chosen position and appear when data exists.
The default is weather → email → papers → tasks → calendar → AI news → news → conference
deadlines → funding. Personal and funding routines remain separate.

New runs retain `sectionOrderSnapshot` for read-only archived routine history. Display-order
changes do not mutate these snapshots or ranked item arrays. Older saved routines/runs that
lack these optional fields use the default order; no reset or data migration is required.
Duplicate/unknown section kinds are rejected by storage validation.

## Truth and safety boundaries

Every item in the sample/history tab is synthetic and labelled as a sample. Publication times and deadlines in those
items are test data, not real announcements. Links on funding samples lead to example
official directories, not verified individual calls. The catalog is not live country search.

`enabled` is a preview configuration state only. Opening, refreshing, or saving does not
start scheduled work. The manual run button processes fixtures, never email, a real GOSU
task, private files, network content, or an LLM. The separate AI routine-design and live-summary actions
invokes the selected native subscription. It consumes that subscription's quota; Briefing Lab
adds no API-key billing path. Account-level optional extra-usage billing remains governed by
the user's provider settings, not a guarantee made by this app.

Custom sources are stored as user-provided and reported unsupported during fixture runs.
They are never fetched or promoted to official/verified sources. URL validation is syntactic
and rejects credentials and obvious local addresses; actual DNS/redirect SSRF protection is
required in the later secure fetch host before enabling network collection.

The browser store contains routine settings (including user/AI-designed research interests)
and synthetic results; it is not an encrypted private-data store. Corrupt saved data is
preserved, editing becomes temporary, and only an
explicit reset replaces it. Quota/blocked-storage errors remain visible. Up to 100 recent
runs are retained. Reset affects only this prototype's storage key, never GOSU or source data.

Actual source results are isolated in the separate live view and are not persisted in fixture
history. Cities, paper filters and input-only mail configuration are saved on each routine;
mail grants and raw mail content remain ephemeral. Completed summaries and optional preference feedback
are saved automatically in a separate encrypted backend store, with macOS Keychain key management.
The legacy browser vault is preserved for optional migration. See the live source and intelligence
documents for retention/security details. Automatic memory does not require an additional LLM call.

Fresh paper summaries use a fixed five-section output contract: research question, strengths,
weaknesses/limitations, methods/assumptions, and reported results. Each section is rendered as
source-grounded Markdown with inline/block KaTeX support; selected source equations and validated
same-paper figures are shown in the expanded paper detail. Older saved summaries remain readable
without being silently reconstructed.

Important/not-interested feedback is an encrypted, editable preference layer. It stores bounded
metadata, aggregates keyword and source-kind tendencies, and gives the next summarizer a separate
personalization profile rather than mixing preference with source evidence. The default private
request policy is always allow within the reviewed scope; a per-request confirmation setting remains
available, while OS permissions and Calendar writes keep their own safety boundaries.

Countries are user-selected filters, not inferred location or funding eligibility.
Relevance is a keyword/title/abstract score, not scientific quality or funding suitability.

## Next slices

1. Extend manual arXiv/Open-Meteo/Apple Mail reads to funding adapters, country discovery,
   freshness-aware history and additional publisher paper evidence.
2. Extend reviewed snapshot memory to a production-authenticated project bridge and reviewed edits of
   existing routines. Native summaries and manual encrypted interest memory are now implemented.
3. Scoped Apple Mail/Calendar/GOSU task adapters, Keychain-backed encrypted persistence,
   location consent and private notifications.
4. Native scheduling, preparation/publication phases, leases, cancellation, retry budgets,
   sleep/restart catch-up and packaged opt-in checks.

See [the full design](BRIEFING_LAB_PLAN.md) for the intended final product.
