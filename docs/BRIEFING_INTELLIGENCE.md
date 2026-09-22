# Briefing intelligence implementation notes

## Interest selection toggle (0.58.82)

Live/history email and paper thumbs send explicit null when the selected choice is clicked again.
The server removes only that routine/source vote and updates the preference profile revision; stored
summaries, source content and unrelated feedback remain unchanged. Null is an idempotent clear,
not a server-side blind toggle. Subsequent selection works normally. Pending requests are locked;
failure retains the last saved selection. A local null override wins over an older in-flight choices
read. Backend choices omit cleared entries and encrypted restart preserves neutrality. Existing source
and ownership guards remain. See [release 0.58.82](releases/0.58.82.md) for installation/test results.

Implemented 2026-09-09 in standalone Briefing Lab (port 4318): optional native-LLM summaries,
reviewable encrypted Briefing memory, Scholar alert candidates, paper evidence/figures and compact
weather UI. Final package gates are recorded below; live/source tests must not be confused with
mocked regression tests.

**2026-09-10 email-generation follow-up:** EMAIL-only analysis now uses a strict seven-field
generation schema; the host supplies empty paper-template/math fields for the existing insight
and history contract. The earlier shared 18-field generation requirement below remains applicable
to paper/mixed batches, not new EMAIL-only calls. Evidence checks and one bounded correction stay
enabled. [Luna medium measurements](BRIEFING_LATENCY_BENCHMARK.md) distinguish lower output tokens
from actual latency: email summary speedup was not confirmed, while mail/calendar chat improved
on fixed synthetic inputs. This does not benchmark real OS source access or change cache validity.

**2026-09-09 workspace follow-up:** the normal UI now uses saved AI/permission settings and automatic
paper batches, not the manual connect/consent controls described in the initial flow below. See
[Briefing workspace](BRIEFING_WORKSPACE.md) for the current user flow, private-history storage,
browser-bound permissions, general assistant and Apple Calendar boundaries. Earlier verification
counts below are dated receipts, not the latest workspace gate.

**2026-09-09 source-order follow-up:** automatic analysis runs bounded email batches before paper
batches and exposes completed/total percentage, active range and operation text. The top assistant
summary presents practical email actions/deadlines and Calendar highlights; it does not copy paper
abstracts into that summary. Paper details remain behind a disclosure, while email analysis does not
force a research-interest explanation.

## User flow

1. In the saved personal/research routine, use **실제 브리핑 → 지금 실제 자료 조회**. Existing city,
   weighted keywords, exclusions and mail settings are used; test settings are not substituted.
2. **GOSU LLM 연결** discovers the same provider models/reasoning as GOSU. Select items and request
   **선택한 자료 AI 요약**. Default selection is up to six public papers, not mail.
3. **Briefing memory is automatic**: successful analyses save compact summaries/research context
   on the backend and retrieve relevant memories on later requests. No manual authoring or routine
   password entry is needed. Optional important/not-interested feedback also saves to the backend.
   Backend memory administration is intentionally hidden from the standalone Briefing UI; GOSU owns
   the future shared review/edit surface while Briefing continues to use the same backend contract.
4. Desktop 0.58.10 Project Chat details → **Export Briefing context** reviews/edits a snapshot of
   that session's working-memory entries before downloading JSON (max 3,500 characters). Import
   this JSON into the selected routine's backend Briefing memory. It is not the entire project
   DB or full conversation. New exports replace the linked project's previous snapshot. No sync.
5. Google Scholar-style email alerts need the selected mailbox, opted-in body preview, and the
   papers setting's Scholar-alert checkbox. Mail-derived candidates require the additional
   **메일·Scholar 알림 내용을 선택한 LLM에 전달하는 분석 허용** and native confirmation.

## Inference and evidence contracts

2026-09-14: recurring collection now searches Scholar alerts independently of the incremental
email summary list. The saved account/mailbox/date/filter/body-preview scope and existing grant
remain mandatory. A bounded native `scholar` predicate is applied before the result limit, with
no email-summary exclusion checkpoint; extracted papers still pass the existing paper deduplication
and private-AI permission checks. Ordinary email failure does not discard successful alert evidence.
Both reads are checked again before delivery/persistence. No original mail is changed. The older
single-read Scholar description below is superseded. Crossref candidates are now ranked by relevance
within the saved publication-date filter before the local keyword/author/exclusion checks.

- [Analysis](../apps/briefing-lab/briefing-analysis.ts) uses the same native Codex/Claude adapters,
  subscription identity, catalog and saved response language as the routine builder. It does not
  use API keys or switch providers on failure. Native provider retention policies still apply.
- Shared research policy plus a bounded domain instruction: all email/source/memory is untrusted
  data. Summary calls have **no dynamic tools** and web disabled. Routine-design tools remain
  available only to routine-design calls. No source can grant mail/shell/filesystem authority.
- Up to 15 selected items; per-routine, in-process source receipts last 10 minutes, max 12 batches.
  Unknown IDs, stale receipts, coverage mismatches and unverified source quotes/figure/equation IDs
  are rejected. This is structural/provenance validation, not proof that an LLM interpretation is
  scientifically correct. Importance is an editable preference signal, not a verified fact.
- A locally rejected final response receives at most **one** visible correction attempt using the
  same source bundle and validation code; the corrected response must pass every check again.
  Private scope/cancellation is rechecked before each native call. Authentication/transport failures
  are not retried or routed elsewhere. The parent request has a total 200-second deadline.
- Output is a short summary, the paper-only five-section template (research question, strengths,
  weaknesses/limitations, methods/assumptions and reported results), importance/reason, research
  relevance, suggested next action, exact source excerpt and optional compact memory suggestion.
  Fresh paper responses must fill every template section; insufficient evidence is stated rather
  than inferred. Inline/block Markdown math is rendered with KaTeX, while selected source equations
  are rendered as exact LaTeX blocks. Caption-selected figures are shown only from validated
  same-paper assets. Analyzed importance orders items inside the existing source section. Source
  receipts are not mutated. Unanalyzed abstracts stay collapsed.
- Every resolved paper keeps its source-metadata original URL in the clickable title and the
  **원문 열기** action, independently of LLM summaries or collapsed evidence. Preserve versioned
  arXiv URLs. Missing/unusable URLs (including unresolved Scholar alerts) display **원문 링크 미확인**;
  never generate a URL from the title or accept a model-invented link. Only credential-free HTTPS
  metadata URLs become these links. Regression: `src/briefing-insight-card.test.tsx`.
- The first three selected papers can load bounded arXiv HTML: first 90 paragraphs / 24,000 chars,
  up to 12 equations (display math first), eight figure captions. LLM selects at most four equations
  and two figures per item; at most three actual images are fetched per analysis.
- [Paper evidence](../apps/briefing-lab/briefing-paper-evidence.ts) accepts only same-paper arXiv
  raster URLs; images are bounded to 8 MB / 16M pixels, re-encoded WebP at up to 1000×600 and
  300 KB. General HTTP responses remain 2 MB. No arbitrary redirects, tracker URLs or PDF/paywall
  bypass. Figures are selected by **caption**, not claimed vision analysis. Missing HTML/images
  have explicit partial/fallback labels. A complete paper is not claimed to have been read.
- KaTeX renders source-selected equations with trust disabled and expansion limits. Markdown
  does not render raw HTML, model-generated external images or links. Source links remain explicit.
- Feedback is stored as structured preference evidence: decision, paper/email kind, bounded title,
  AI-summary keywords, source URL when public and timestamp. The backend aggregates positive/negative
  keyword and kind signals before the next analysis. The prompt labels this as a preference signal,
  never as evidence; source-grounded facts, deadlines, equations and figures still come only from
  the current receipt. Public paper feedback can personalize paper ranking without granting private
  AI access; mail feedback preserves private taint and consent boundaries.
  Historical cards now resolve feedback by stored history/item IDs via `/history/feedback`; the
  client cannot supply new titles or keywords. `/history/list` restores scoped decision states.
  Live email controls are visible even before AI succeeds. See the current
  [reading-controls contract](BRIEFING_WORKSPACE.md#reading-controls-and-typography-2026-09-09-follow-up)
  for compact paper rows, icon placement, typography and private-taint preservation.
- `confirmationPolicy` defaults to `always`. It reuses a reviewed routine scope without a native
  dialog on every request. `ask` restores per-request native confirmation; automatic background jobs
  do not show unattended dialogs and instead stop with an actionable setting message. OS automation
  grants and Calendar write confirmations are not bypassed by this preference.
- Scholar recognition is a sender/title heuristic, **not Google authenticity verification**.
  The [current alert-email contract](BRIEFING_WORKSPACE.md#google-scholar-alert-emails-in-paper-briefings-2026-09-10)
  extracts individual linked or recognizable citation-row candidates within the existing approved
  Mail preview. Arbitrary unresolved whole emails are no longer treated as single papers. The
  checkbox defaults on only when no explicit saved choice exists; it grants no additional Mail/AI
  rights. No tracker, unsubscribe or arbitrary publisher request is made.

## Memory and private-data boundaries

### Paper-first saved snapshots (2026-09-10)

- The former cache path enriched arXiv HTML before comparison and fetched selected figures again
  even on a hit. `findSavedPaper` now runs first for an owned routine and a version-bound arXiv
  paper. It requires exact item ID, title and version identity; new records additionally compare
  a SHA-256 `sourceMetadataDigest` of the un-enriched observed input. Provided full evidence must
  also match the original digest. Versionless/foreign identifiers, changed versions or observed
  metadata are not silently equated. The basis is arXiv's
  [version-specific identifier contract](https://github.com/arXiv/arxiv-docs/blob/develop/source/help/api/user-manual.md),
  not fuzzy title similarity or a claim that the current full text was downloaded/verified.
- Matching saved paper snapshots bypass HTML, figure downloads, model discovery on automatic
  cache hits and the analyzer. Summary/template/equations and available cached images are restored
  locally. An explicit `/summary/refresh` still reacquires the approved source and forces a new
  generation; failures leave the prior saved item intact. General analysis/reconnect requests use
  cache-first behavior. New-paper discovery still requires the public service.
- Paper snapshots can survive changed research-interest/feedback context without repeating the
  scientific summary. Their original context digest, generation time and per-item feedback revision
  remain intact; `personalizationStale` labels old relevance/priority as **요약 당시 기준**. A newly
  copied batch's revision must not be mistaken for the snapshot's original revision. Email's strict
  observed-input/context cache policy remains unchanged. Private taint and current access checks
  remain enforced; ask-mode private snapshots are not silently returned without confirmation.
- Provenance v1 adds optional metadata/reuse annotations. A legacy paper with an exact versioned
  reference but no original-input/time proof uses explicit snapshot provenance v2: null source/
  context digests and null `summarizedAt`, with a known save instant only when available. It is
  displayed as a prior saved interpretation, not exact-byte evidence or newly generated work.
  Existing encrypted v1 data remains readable; older binaries are not supported downgrade readers
  of newly saved v2 snapshot annotations.
- Selected host-validated WebP data can now accompany stored figure descriptors (410k characters
  per image, two per item). A 6M-character newest-first image-cache budget evicts only older image
  bytes, preserving summaries/captions/links. No HTML excerpt or raw email body is added to storage.
  Missing legacy image bytes show a caption/unavailable note, never trigger an automatic download.
  Manual analysis response buffering is bounded at 8M characters to accommodate local image reuse.
- `/papers/saved` returns at most 30 deduplicated saved versions from the existing retained History
  (60 runs / up to 600 records), requiring routine ownership and rechecking profile/cancellation.
  Private snapshots unavailable under current permission/ask policy are omitted with a notice.
  No source/provider call is made. This is not an unlimited independent paper archive.
- Tests count analyzer/HTML/image calls: repeated matching papers make zero additional calls,
  including when those source readers would fail; new version/changed metadata/explicit refresh
  still generate. Coverage includes encrypted image restart, legacy unknown dates, stale feedback
  provenance, private denial, source failure with readable saved papers, and failed refresh/save
  preserving the previous result. Current gate receipts are in the workspace follow-up below.

### Exact observed-input reuse and explicit refresh (2026-09-09 follow-up)

This original strict re-read policy remains the fallback for email and papers without a usable
version-bound snapshot. The paper-first path above supersedes its eager HTML/image acquisition.

- Summary reuse no longer accepts fuzzy title/ID matches. `briefing-summary-cache.ts` hashes the
  exact observed ID, kind, title, text, source URL/version, publication date, sender/details, read
  scope, private origin and bounded paper excerpt/equation/figure descriptors with SHA-256. A
  separate versioned context digest covers paper interests or the approved mail scope. Current
  routine, feedback revision and private-AI checks still apply. Whitespace/case changes are not
  silently normalized into equal content. Downloaded image bytes are excluded from the digest;
  source URL, caption and selected equation descriptors remain checked.
- Bounded paper evidence is acquired before matching so an abstract-only fallback cannot reuse a
  richer, changed excerpt. This may make source HTTP requests but a matching summary makes zero
  analyzer calls. Automatic jobs resolve the model catalog only for cache misses; an unavailable
  model connection does not block a verified cache hit. Candidate lookup scans all retained history
  (up to 600 records), not just the previous 30 batches.
- Each stored item carries versioned digest metadata, its original `summarizedAt`, and reuse status.
  Reused copies preserve the original timestamp through encrypted restart, history writes and
  mixed-batch UI merging. Generation timestamps are not replaced by the latest collection time.
  This stores hashes and validated outputs, not raw mail bodies or full paper excerpts. Saved
  selected equation/figure descriptors remain available for matching against current evidence;
  a previous AI summary is never presented as an exact original-source quotation.
- Equality is deliberately limited to **what the app actually read**. Mail metadata/preview and
  bounded paper HTML are not complete original-message/full-paper checksums. Missing source proof
  in legacy history prevents automatic cache reuse; existing summaries remain readable without an
  LLM, with a clearly labelled save time when the generation time is unknown. One requested fresh
  analysis establishes the new identity metadata. Scope/content/context/feedback changes remain
  cache misses, not silently reused personalized answers.
- `/summary/refresh` is an explicit single-item operation. Strict inputs accept only routine/item
  plus a live receipt or stored history ID, never client-supplied source text. It enforces browser
  ownership, saved mail/AI permissions and profile/revocation guards, bypasses summary reuse and
  invalidates completed automatic-job snapshots afterward. Concurrent refreshes or an active
  automatic job in the routine reject duplicate work.
- History refresh uses a matching current receipt or reacquires only that source within saved
  query/mailbox scope after receipts expire. It does not widen search dates/mailbox permissions,
  silently substitute another paper version, collect unrelated weather/calendar sources, or feed
  the old AI answer into generation. A missing/rate-limited source leaves the previous summary
  intact and reports the failure; successful refresh stays in the original history run.
- 0.58.83: private refresh checks saved read/AI switches separately from approval validity.
  Previously a disabled mail-read switch was misreported as missing private-provider approval;
  settings now warn when private AI is enabled but mail read is disabled.
  An owned profile with enabled permissions but an invalid approval offers native consent for
  the exact saved profile and continues after an atomic, expected-profile save. It never enables
  disabled switches, adopts foreign ownership or widens the source scope. Valid grants are reused
  without renewal. Both live-receipt and history refresh paths use this gate; decline, cancellation
  and concurrent settings edits stop before source/model work and preserve history. This repairs
  the dead-end approval recovery path, not Apple Mail delivery/body-read failures.
- Verification: focused cache/refresh/service/UI regressions **38/38**. Final package and named
  runtime gate receipts are recorded in the matching workspace follow-up. All source/provider
  inputs in this change's QA are synthetic; no personal mailbox, calendar or paid native inference
  was used to validate cache identity or refresh behavior.

### Feedback-versioned summary cache (2026-09-09)

- `BriefingMemoryStore` persists a per-routine `feedbackProfileRevisions` map in the existing
  encrypted v2 envelope. The public status and feedback snapshot expose `feedbackProfileRevision`.
  Successful mutations compare normalized feedback entries before/after: changed votes, reviewed
  feedback, removal and feedback imports increment only affected routines. Timestamps/entry IDs and
  repeated identical votes do not. Automatic summary/memory writes leave this version unchanged.
- Existing encrypted memory without the new map is read with revision zero, without resetting
  entries. New writes keep the same encryption/AAD/file boundary; an older executable whose strict
  schema lacks the added fields is not a supported downgrade reader of newly written data.
- Saved briefing history carries the revision actually used by analysis. Reuse requires an exact,
  known current revision in addition to the existing routine/source/private-scope matching. Legacy
  unversioned history remains readable but requires one fresh generation on the next requested
  summary. Feedback-read failure disables reuse and never manufactures a matching zero revision.
  An in-flight generation retains its original snapshot revision, even if feedback changes while
  it runs; the next request therefore cannot mistake it for an up-to-date personalized result.
- Completed automatic-summary jobs also compare feedback revision before reconnecting. An active
  job is not duplicated/cancelled merely because a preference changed; a later request can start a
  new job after completion. Cache invalidation itself never starts an unattended LLM request.
- Analysis filters private feedback when private-AI scope is unavailable. A public paper summary
  influenced by permitted private feedback is marked private in both memory and history, so that
  cache cannot be reused after private-AI permission is removed. Reusing a private history item
  also preserves its existing taint even when private memory is not retrieved on the current request.
- Responses include a `cache` receipt with revision, `reusedItemIds` and `generatedItemIds`.
  Client batch merging retains per-item provenance across email/paper results. The top assistant
  card shows **캐시 재사용 · LLM 호출 없음** only when all displayed items are known cache hits
  and no pending batch remains. Mixed results say **캐시 N건 재사용 · M건 새로 요약**; missing
  legacy metadata does not imply zero LLM calls. The manual analysis panel uses the same label.
  This is application-level summary reuse, not a claim about provider prompt-cache pricing.
- Regression verification: focused **37/37**, Briefing Lab **211/211** (35 files), named Agent Runtime
  **177 Desktop + 111 Briefing = 288/288**, typecheck, lint, formatting and production build passed.
  Tests use disposable encrypted stores and counted mock analyzer calls, not user mail or paid
  inference. Coverage includes same-vote stability, per-routine isolation, encrypted restart/legacy
  loading, changed/deleted feedback, in-flight changes, unreadable snapshots, private-scope cache
  rejection, completed-job invalidation and full/mixed UI labels.
- Browser QA used the isolated `tools/workspace-visual.tsx` fixture with `?cache=all` and
  `?cache=mixed`: the 1280×720 top card showed the exact no-LLM badge for four reused items and
  **캐시 1건 재사용 · 3건 새로 요약** for a mixed batch. No browser console errors were observed.
  These are synthetic rendering checks, not a live paid-provider call or a user-source cache claim.

- [Backend store](../apps/briefing-lab/briefing-memory-store.ts) automatically derives memories from
  existing, validated LLM output, without another LLM call. Source body fields/attachments are not
  archived. Automatic entries are labelled unverified AI summaries, not scientific proof.
  Credential/OTP heuristics exclude obvious sensitive entries; this is not guaranteed PII removal.
- Storage: `~/Library/Application Support/GOSU/briefing-lab/memory.v2.enc.json`, AES-256-GCM with
  random nonce/authentication tag and atomic mode-0600 file replacement. Mutations serialize within
  the one active backend. Unsafe symlink/hardlink targets and corrupt ciphertext fail without reset.
- [System key](../apps/briefing-lab/briefing-system-key.ts) generates a random key in macOS Keychain.
  No plaintext key file, browser key, command-line secret argument or API-key fallback is used.
  First use builds a local helper with installed Apple Command Line Tools; production distribution
  should ship a signed helper instead. This prototype supports macOS, not a generic cross-platform
  key store. An OS Keychain unlock/approval can still require the user; it is never bypassed.
- Latest routine interests, automatic summaries, optional feedback and reviewed project snapshots
  are routine-scoped. Retrieval is relevance/recency based, max 12 entries. Storage caps at 1,000
  entries: older automatic entries can be retired, while reviewed corrections/feedback are preserved.
  Deletions retain up to 1,000 suppression keys to avoid immediate re-creation of the same item.
  This is retrieval-based personalization, **not model retraining** or automatic factual verification.
- `/memory/status` returns only counts/revision/time. Reading contents for review requires native
  approval and grants a routine-scoped, non-sliding five-minute edit token. Edits also check the
  current revision. Automatic private email/project memory is sent to an LLM only after the existing
  native private-analysis confirmation. Public paper memories need no extra private-data prompt.
- A completed summary survives a memory-store failure: the response carries a visible memory warning.
  Failed/cancelled inference does not produce automatic memories. Updates deduplicate source items;
  automatic output cannot overwrite user-corrected entries. Private scope is rechecked before saving.
- The old [browser vault](../apps/briefing-lab/src/briefing-memory-vault.ts) is preserved unchanged.
  Its former passphrase is needed only for optional one-time migration, never normal new summaries.
  The advanced legacy pane imports the selected routine in bounded batches after native review approval.
- Collection results are ephemeral React state plus bounded in-process receipts. Automatically
  saved summaries remain in the distinct encrypted backend store after reload/server restart.
  The [scroll-first History follow-up](BRIEFING_WORKSPACE.md#scroll-first-full-briefing-history-2026-09-09)
  additionally archives bounded weather/source-status snapshots and displayed agenda highlights by
  collection run. It does not archive raw mail bodies or make historical viewing call an LLM.
  Clearing screen results does not delete memory. Provider/CLI logs have their own retention policy.
- Private read authorization, each mail read batch, and AI analysis with mail or any memory require
  a native macOS confirmation. Reading and provider transmission are separate approvals. Mail scope
  is rechecked before/after inference; revocation suppresses late results but cannot retract data
  already transmitted to a provider.
- **Prototype limitation:** Host/Origin + a per-process browser capability is not authentication
  against a malicious local process (headers can be spoofed). Native confirmation mitigates silent
  private reads/transmission; it is not a signed isolated XPC broker, per-mailbox OS sandbox grant or
  end-to-end production security. Source/routine metadata and provider quota are not fully isolated
  from malicious local clients. Do not deploy as a serious multiuser service in this state.
- Apple Automation grants app control; the implementation is read-only, not an OS-enforced
  read-only Mail permission. No sending/deletion/read-status change/attachments are implemented.

## Weather chart contract

2026-09-14 follow-up: precipitation now uses a fixed 0–100% axis with only 0/50/100%
axis ticks. Hourly numeric labels and the visible all-zero caption are removed. The shared
210px chart uses a proportional 64px probability band, independent of forecast values;
zero baseline markers and missing values remain distinct. Exact hourly values remain available
on hover, focus, or selection. The earlier compact-zero design below is superseded.

2026-09-14 [0.58.57](releases/0.58.57.md) supersedes the repeated-hourly-zero layout below. All-zero
windows show a single 예보 구간 강수확률 0% label and retain hourly baseline markers/tooltips.
The probability band is 32px instead of 92px, with a 158px chart instead of 218px. A 300px minimum
width lets narrow dry cards fit without the previous forced 670px scroller. Missing-only forecasts
use one 미제공 label, never a false zero. Mixed forecasts combine adjacent zero/missing runs without
merging across known rain or a missing-data gap; positive labels and their existing 52px proportional
scale/3px minimum remain. ResizeObserver rebinds on required-width changes, not just hour count.
No forecast values, weather permissions, API requests, saved History or AI summaries are changed.

The 2026-09-13 chart update is included in installed [0.58.30](releases/0.58.30.md).
The installation-pending sentence in the development record below is historical.

2026-09-13 source update supersedes the old 176px/18-unit precipitation layout below. The shared
Live/History chart is 218px tall and separates the temperature line from a pale-blue probability
band. Every known hour has an explicit percentage, including zero; missing probabilities show an
em dash and no bar. Positive bars use a 52px full-scale height (previously 18), with a disclosed
3px visibility floor for very small positive values. Zero retains a 2px marker on/below the baseline,
not fictitious positive rainfall. The original forecast values and source calls are unchanged.

Probability labels align on one row when space permits and stagger in two rows on denser plots.
A minimum 25px hourly slot and a contained horizontal scroller preserve readable labels on narrow
cards rather than dropping positive labels or shrinking them. ResizeObserver tracks the container;
the axis and line share the responsive plot width. Temperature gaps remain disconnected. Bars now
support focus/hover/click detail even when the corresponding temperature point is missing.

Synthetic component screenshots covered mixed 0/1/5–100% and missing values, a wide plot, and a
narrow all-zero card. Tests cover all 24 labels, a 25-hour DST day, minimum/proportional heights,
missing values and historical rendering. History now shares Live's full-width source footer,
avoiding the narrow first-column footer and tall empty grid row. Its compact layout was also
visually inspected. Focused weather/generation: 22 passed; full Briefing:
694 passed. `pnpm check` passed formatting, lint, typecheck, tests and production builds (Desktop
2,393 passed / 8 existing environment skips; Model Lab 341). No weather API/private source/LLM
call or saved settings/data change was made. Installed GOSU 0.58.29 has not been replaced.
Agent Runtime passed 665 tests (197 Desktop + 467 Briefing + 1 Model Lab).

- Question: how will temperature and rain/snow change across the selected city's local day?
- Surface: an embedded Briefing Lab application card, not a separate report/dashboard artifact.
- Evidence: Open-Meteo hourly forecast, normally 24 local-day points (up to 25 for DST), alongside temperature,
  apparent temperature, precipitation probability and weather code. These are forecast/model
  estimates, not measured personal weather observations.
- Chart: compact native SVG time-series with an olive temperature line/points and a blue
  precipitation-probability bar band sharing the same local-hour axis. Keep null temperature gaps;
  precipitation bars remain sparse when the probability is missing. Use a point/insufficient-data
  notice when fewer than two valid temperature points exist.
- Palette: olive temperature line and blue precipitation bars, neutral axes, and a compact legend.
  Icons and words distinguish rain/snow and cold/hot; do not depend on color alone. No gradient in
  marks.
- Thresholds: >=35°C / <=-10°C are application attention thresholds, not official weather alerts.
- Footprint: 176px plot height plus a compact current-condition header. Test at
  wide and 400px viewport widths with hot/rain, cold/snow, negative, missing and constant values.
- QA: inspect screenshots of the actual component and verify units, timezone/day, no clipping,
  gaps and matching hover/details values.
- Zero-value display contract: keep the same app-native SVG and 176px footprint. Each known 0%
  hour gets a thin blue baseline marker and explicitly labelled 0% text at readable horizontal
  intervals. The marker sits on/below the zero baseline, not above it as a fictitious positive
  probability. Positive values retain their proportional heights; null remains unprovided, never
  converted to zero. Use the existing olive/blue palette, test all-zero and mixed/null 24-hour
  series at wide/narrow sizes, and preserve exact hover/focus values in live and historical cards.
- Zero-value implementation/QA (2026-09-09): the shared `WeatherCard` now draws a 2-SVG-unit
  baseline marker for every 0% hour. Labels use a 26px minimum horizontal separation without
  dropping bars. Two focused regressions failed before the change; weather tests **4/4** and full
  Briefing Lab **222/222** (36 files), typecheck, lint, formatting and production build passed.
  Synthetic browser checks showed 24 zero bars with 12 labels at desktop width and 6 labels at
  400px viewport width, no overlapping labels/page overflow. Mixed data retained 12 zero bars,
  8 proportional positive bars and 4 unmarked nulls; 25%/60% heights remained 4.5/10.8 SVG units.
  Live and History use the same component. No weather API, private source or LLM was called;
  this UI-only change does not repair or alter the separate native-schema issue below.

## Validation and maintenance

### Native summary schema recovery (2026-09-09)

- User-reported email auto-summary failure was reproduced through the existing GOSU native Codex
  path with **GPT-5.6-Luna / low** and one synthetic RSVP message. No user mail, calendar, memory or
  saved settings were sent or changed. Native terminal status was `failed`, HTTP **400**, with
  `Invalid schema` and missing required field **researchQuestion**. The public wrapper converted
  that diagnostic into `routine_native_failed`, obscuring the cause in the UI.
- The pre-fix `BriefingGenerationSchema` required keywords/detail/equationExplanations but left all
  five paper-template fields optional. The schema is shared with email analysis. OpenAI's
  [Structured Outputs contract](https://developers.openai.com/api/docs/guides/structured-outputs)
  requires every object property to be listed as required (nullable values can model optional
  semantics). The request is therefore rejected before generation, independent of Mail access.
  Earlier unit/build passes did not validate this live server constraint.
- The follow-up repair makes every new-generation item property required via a separate required
  schema, while `PaperInsightSchema`/the legacy reader remain backward-compatible. Email prompts
  explicitly request empty strings for paper-only fields; host normalization enforces this without
  inventing a research framing. A recursive regression checks required keys/additionalProperties
  at every output object. A provider schema rejection now becomes `routine_output_schema_invalid`
  and a specific app-format message rather than asking users to reconnect Mail or reduce item counts.
  Raw provider diagnostics are still not passed to the UI.
- **Live recovery verified:** `tools/automatic-summary-live-smoke.ts` uses the real GOSU native
  **GPT-5.6-Luna / low** path with synthetic sources and disposable encrypted stores. Automatic jobs
  completed email first (**6 items, 86%**) and then one paper (**7/7, 100%**); all paper-template
  fields passed validation and email paper-only fields were empty. A second job reused all seven
  summaries with **zero additional analyzer calls**. No actual mailbox, calendar, user briefing
  memory/history or private research keyword was read or transmitted. User preferences were not
  changed. Claude live inference was not exercised by this smoke.
- Recovery gates: focused **38/38**, full Briefing **232/232** (36 files), named Agent Runtime
  **177 Desktop + 124 Briefing = 301/301**, typecheck/lint/format/production build passed.
  Socket-dependent tests ran outside the filesystem sandbox; none were skipped. Earlier red tests
  reproduced missing required fields, email field normalization and lost schema error classification.
- The standalone preview backend was restarted after verification. Saved Mail/AI permissions,
  user memory/history and model preferences were retained; in-process receipts/jobs expire on this
  normal restart. A fresh collection is needed instead of replaying the old failed receipt. Browser
  refresh was not forced after user control interrupted automation; the local server's current
  production asset response was checked separately.
- Reproduce only when native inference is explicitly intended: bundle the opt-in script with
  `pnpm --filter @gosu/briefing-lab exec esbuild tools/automatic-summary-live-smoke.ts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/automatic-summary-live-smoke.mjs`,
  then run `node apps/briefing-lab/node_modules/.cache/automatic-summary-live-smoke.mjs` from the
  repository root. It consumes native subscription usage for synthetic inputs, never grants real
  Mail access, logs counts/status/invocation only and cleans up its own temporary state.
- The separate arXiv warning is emitted on HTTP 429. Its displayed time is the client retry floor
  (`Retry-After` or at least two minutes), not a provider recovery promise. The UI stores that text
  as the old result and does not refresh it as time passes. Search XML cache is only two minutes and
  process-local; it is separate from feedback-versioned AI-summary reuse. The official
  [arXiv API manual](https://info.arxiv.org/help/api/user-manual.html) recommends three-second spacing
  and caching repeated queries across the daily update cycle. Official status listed export.arxiv.org
  up during diagnosis; that does not prove this user's query/IP is currently unthrottled. No saved
  private research keywords were retransmitted and no IP/host bypass or automatic retry was attempted.

- Actual public example: Open-Meteo Seoul 24-hour data and arXiv three-paper discovery.
- GPT-6-Astra / medium completed evidence-grounded analysis of arXiv 2609.05382v1, selecting two
  actual equations and two actual raster figures. No mail/private project memory was sent.
- Visual renderer uses that public result, plus explicitly labelled synthetic rain/snow/cold/hot
  scenarios. Actual components are rendered at 1000/420 px; screenshots are inspected, not just saved.
- Unit regressions cover encrypted roundtrip/password/stale writers/retention, routine separation,
  quotes/references, native zero-tool mode, private opt-in/confirmation/revocation, source-scoped
  figure decoding, LaTeX and weather missing values. The named Agent Runtime gate includes memory
  and analysis contracts. Private Mail message reads are not exercised automatically.
- Reproduce opt-in live smoke (uses subscription quota and public network, never private email):
  `pnpm --filter @gosu/briefing-lab exec esbuild tools/intelligence-live-smoke.ts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/intelligence-live-smoke.mjs`,
  then from the repo root `node apps/briefing-lab/node_modules/.cache/intelligence-live-smoke.mjs`.
- Visual smoke after the public smoke generated its ignored JSON artifact:
  `pnpm --filter @gosu/briefing-lab exec vite build --config intelligence-visual.vite.ts`, then
  `pnpm --filter @gosu/desktop exec electron ../../apps/briefing-lab/tools/intelligence-visual-smoke.cjs`.
- Full gate: `pnpm check` and `pnpm test:agent-runtime`. No live-provider calls are in CI/unit tests.
- Final counts and installed/Desktop versus standalone scope:
  [0.58.10 verification receipt](releases/0.58.10.md). Briefing 108/Core 110 and the entire workspace
  gates passed. Live browser analysis of the existing saved research profile also succeeded.
- Paper-link follow-up (2026-09-09, standalone UI only): focused renderer 6/6, full Briefing 112/112,
  typecheck/lint/format/production build passed. Five visual captures passed at 1000/420 px;
  clickable titles were inspected. No new LLM calls, mail reads or Desktop replacement were needed.
- Automatic-backend follow-up (2026-09-09): storage tests cover encrypted restart, concurrent writes,
  deduplication, routine separation, corrected/deleted memory, corruption, cancelled/revoked commits,
  and credential-like mail exclusion. Service tests verify save → reuse without browser memory,
  content-review approval, scoped edit tokens and summary preservation on storage failure.

- Source-specific briefing follow-up (2026-09-09): email-first automatic batches now expose a
  percentage/range operation status and a top calendar/email assistant summary. Paper rows show
  title/keywords/priority until expanded; fresh source-specific generations include bounded detail
  and up to four exact equation explanations. Email generations omit forced research relevance and
  focus on practical actions/deadlines. Focused Briefing package tests passed **172/172** and the
  named Agent Runtime gate passed **177 Desktop + 94 Briefing = 271/271**.
- Actual macOS Keychain smoke saved/reopened two synthetic public entries with no plaintext payload
  on disk. No user mail was read. In the actual browser, GPT-6-Astra / medium summarized one public
  paper, then displayed **기억 2개 자동 저장/갱신**. After reloading, **2개 · backend 자동 저장**
  remained and the default UI had zero password inputs. Restarting the actual backend and reloading
  the browser also restored both entries with no memory error. Optional legacy migration is separate.
- The user clarified that email reading worked and AI summaries appeared slow. No unproven mail
  connection cause is claimed fixed. Analysis now shows elapsed time/stage, preserves selected
  reasoning, and auto-selects up to six mail items only after explicit LLM-transmission opt-in.
- Final automatic-memory verification: Briefing **132/132**, named Agent Runtime **177 Desktop +
  60 Briefing** passed. `pnpm check` passed (format, generated contracts, lint, typecheck, workspace
  tests, root tests and production builds). Other suite counts: Desktop 2,366 + 8 environment skips,
  Model Lab 340, Core 110, UI 15, Contracts 42, Integrations 19, Domain 14, Sync API 51; root tests 12.
  The existing Desktop skips remain opt-in MacTeX 5, Linux-only 1, live Claude/Hermes 1 each.
  The actual backend memory file was mode **0600**. No private inbox content was used in live QA,
  no Desktop app replacement was needed, and no repository commit/push was performed.

Not implemented: automatic scheduled delivery, automatic project sync,
generic publisher/PDF figures, verified Scholar sender authentication or production mail isolation.
