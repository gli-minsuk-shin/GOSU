# Briefing workspace: assistant, automatic summaries and Apple Calendar

2026-09-14 [0.58.78 candidate](releases/0.58.78.md): the desktop sidebar shows Briefing Lab and
Paper summaries as independent sibling destinations. Briefing Lab opens personal history directly;
the nested group and routine-management entry are removed, while settings/routine data remain.
Paper titles expose their saved source URL before expansion; unavailable links are not guessed.

2026-09-14 [0.58.77 candidate](releases/0.58.77.md): the idle header no longer repeats completed
job details, source errors or the next-run timestamp. Running progress/cancellation and actionable
request/settings failures remain. Schedule storage and source status in the Briefing body are unchanged.
The [0.58.75 prepared-action path](EMAIL_PREPARED_ACTIONS.md) supersedes button-time email drafting
described below; legacy explicit draft endpoints remain separate.

2026-09-14: generation header actions share one right-aligned row, including Collapse All.
The responsive 420px progress column is reserved independently of disclosure contents, so opening
details does not change button positions or spread Collapse All away from generation controls.
The details use a minmax(0,1fr) track; narrow headers wrap without horizontal overflow.
This is layout-only and does not change scheduling, generation, cancellation or stored data.

2026-09-14 email event drafts use `/mail/event-draft`, a tool-free structured job on the routed
briefing model. The old first-date regex is no longer used to populate the editor. The displayed
email summary is treated as untrusted evidence (not silently called original mail). The job chooses
the confirmed actionable appointment, prefills title/start/end/location/notes, and discloses missing
duration or inferred year. Unresolved dates/ambiguous events fail with a question instead of today
defaults. The server rechecks ownership, private-AI provider permission and Calendar scope before/
after inference, validates evidence quote/timezone/range, and never writes an event at this step.

2026-09-14: daily updates retain weather but refresh the approved today/tomorrow Calendar window
on every generation. The old `hasCalendar` skip discarded newly created events until the next day.
Successful reads replace the current daily agenda (including an empty result after deletion);
failed reads retain the previous agenda and report the error. Older daily histories, Calendar
permissions, email/paper summary deduplication and weather data are unchanged.

2026-09-14 [0.58.52 candidate](releases/0.58.52.md): email lists and email highlights are ordered
by existing importance buckets, then actual receipt time descending. Summary/cache timestamps do
not reorder emails; missing dates sort last within their bucket. Stored `mailSender` comes only
from the source header, not the LLM. Sender → receiving account and receipt time share the existing
compact metadata row, with truncation/tooltips for long labels. Stored histories without a sender
can explicitly recover one exact message's header through `/mail/read-sender`; this preserves
read status and does not read bodies or call the LLM. Recovery uses the same current-owner,
approved-account, native/RFC-ID guards and cancellation checks as the bounded Mail status reader.
Recovered metadata is encrypted and does not overwrite a previously recorded sender. Merely
opening History does not trigger bulk Mail queries. Old records without resolvable provenance
remain explicitly unknown. The earlier statements below about live-only sender display are historical.

The 2026-09-13 changes below are included in installed [0.58.30](releases/0.58.30.md).
Earlier source-only statements describe development-time status; see the release for verification limits.

## Saved papers survive empty or failed refreshes (2026-09-13 source)

Discovery/analysis eligibility is separate from saved History visibility. The previous
`visiblePaperKeys` selection hid older same-day summaries when a new collection returned no items,
including arXiv rate limiting. The History grouping now keeps all already-saved items in each
retained run, deduplicated as before. Old persisted empty selections are ignored on render, so no
data migration or source read is needed to display those summaries again. Collection no longer
writes this visibility hint; the optional schema field remains readable for legacy records.

Same-day updates retain the original paper summary, timestamp, source identity, equations/figures
and item actions. New papers append once; old items do not regain a New badge. New-item discovery
still excludes already summarized exact identities/versions before analysis, and explicit refresh
remains opt-in. No fuzzy paper matching, archive-wide copying into every new day, resurrection of
deleted runs or permission expansion is added. Earlier days remain in their own retained History.

A failed/empty paper query with saved cards shows a short saved-summary notice alongside the new
query error/status. Failed discovery is not an assertion of zero new papers. Rendering old cards
does not call arXiv or an LLM; pressing Generate can still check for genuinely new sources.

Four regression cases failed before the repair. Focused History/generation: 30 passed afterward.
The production generation test covers first successful save, second arXiv rate-limit failure,
encrypted-store reopening, identical retained paper payload, no repeated analysis, and no old New
badge. The same-day fresh-paper case retains both old and newly added summaries. Synthetic browser
inspection confirmed the old paper highlight/card remains next to the failed-query notice.
Full `pnpm check` passed: Briefing 696; Desktop 2,393 / 8 existing environment skips; Model Lab 341;
formatting, lint, typecheck and production builds passed. Agent Runtime 666 passed (197 + 468 + 1).
No user data or installed app was changed; installed 0.58.29 still requires replacement.

## Importance ordering and selected-paper chat (2026-09-13 source)

Paper lists in History and the saved library now order high, medium, low, then unknown; equal
importance retains the existing newest-summary ordering. Live paper ranking also puts unknown
after low. Email ordering and daily run boundaries are unchanged. This supersedes the paper-only
part of the older newest-first contract below; no stored dates or summaries are rewritten.

Summarized paper cards offer an AI-question action next to importance/keywords, independent of
the disclosure. It opens the retained routine chat, focuses the composer and attaches a removable
title chip. Selection alone makes no inference or source request. The reference persists across
turns until replaced/removed; existing chat history is retained. Strict bounded reference metadata
contains routine/history/paper IDs and a display title, never a caller-supplied fetch URL or summary.
The server rejects cross-routine references and instructs the assistant to read the exact saved
record first. Live cards without batch IDs resolve the newest exact paper ID in the approved library;
similar titles are not substitutes. Missing/deleted/private records retain existing access failures.

`read_saved_paper` can use `to=original` when original evidence is needed. It resolves the stored
record through the same private/ownership checks, then uses the existing bounded arXiv HTML reader
and public-source URL restrictions, with cancellation and post-read revocation checks. Unsupported
or unavailable originals return explicit unavailable status, never a stored AI summary labelled as
original text. HTML excerpts are not complete PDF reads. No paywall bypass, arbitrary publisher
fetch, re-summary generation or settings change is introduced.

Synthetic production-component browser QA confirmed separate AI buttons, unchanged collapsed cards,
focused input, selected-paper chip and its removal. No private source or paid inference was used.
This source update is not installed in the existing GOSU 0.58.29 binary.
Validation: full `pnpm check` passed (Briefing 689; Desktop 2,386 passed / 8 existing environment
skips; Model Lab 341), including formatting, lint, typecheck and production builds. Agent Runtime
655 passed (190 + 464 + 1). Coverage checks ranking, exact reference transmission across turns and
removal, saved detail lookup, supported/unavailable original responses and denied private reads.

## Saved-paper exclusion before the limit (0.58.28)

Persisted Briefing collection loads exact summarized paper keys before discovery and passes them
to the arXiv parser. Ranking still uses the same bounded response and research filters, but saved
versions are removed before the configured count is applied. Raw XML caches are re-filtered with
the current key set, so saving a summary does not require another request to reveal the next item.
No pagination/query widening or saved-summary regeneration is added. Scholar extraction/merging
and the final duplicate check remain in place. Ordinary non-persisted paper searches keep their
original semantics. Failed results, even without an error string, are described as unverified.
Tests cover both fresh and cached responses and the actual service's saved-key handoff.

## Historical false-zero diagnosis (2026-09-12)

The old production arXiv search requested up to `min(60, limit * 3)` candidates, but `parseArxiv`
trimmed its ranked result to `limit` before `newPaperResults` excluded saved summaries. A full
shortlist of saved papers can therefore hide unsummarized candidates in that same response.
A read-only live audit with the current settings returned 30 relevant candidates: the selected
10 were already summarized, while the remaining 20 were not. Thus the displayed zero does not
establish that no unsummarized papers exist. It also does not establish full-text availability
or the number of new papers on the entire Internet.

`paper-discovery-audit.ts` compares a shortlist against the complete bounded candidate response.
`tools/paper-discovery-audit.ts` performs one public request using the stored research filters,
reads saved summary identities, and outputs counts/statuses only. It does not read new private
mail, call an LLM, mutate settings or regenerate summaries. Failures are unverified, not zero.
Five new diagnostic/reproduction cases in `new-paper-results.test.ts` cover premature truncation,
genuine in-window zero, transport/rate-limit failure (including absent error text), versioned
identity and unsummarized records. These tests diagnose the existing behavior; the production
selection order was not changed in that diagnosis-only request; 0.58.28 above implements the repair.

The proposed repair is to exclude saved exact identities before applying the display limit,
within the same bounded response, without a wider query or automatic regeneration of saved work.
Google Scholar remains limited to the selected mail window and messages actually returned;
enabled extraction and parser unit tests alone do not certify full coverage of all alert mail.

Verification: related public-source/dedup/Scholar tests 25 passed; full Briefing suite 678 passed;
Agent Runtime 651 passed (190 + 460 + 1). `pnpm check` passed formatting, contracts, lint,
typecheck, all workspace gates and production builds; Desktop 2,386 passed with the existing
8 environment skips. No installed app or user configuration change was made for this diagnosis.

## Visible embedded consent (0.58.27)

Embedded settings/private-source approval uses a native sheet attached to the GOSU Main window.
The host restores/shows/focuses its window, retains Cancel as default, and passes the request's
AbortSignal to the dialog. Cancellation, a missing host window or a late response after abort
never grants access. The consent function is injected by Main, not configurable by iframe input.
Standalone Preview retains its existing native confirmation. This replaces the detached
90-second script dialog for embedded GOSU, not macOS TCC/Keychain consent or the private-AI checks.
Installed UI confirmation and persisted Mail-reading activation were observed; no mail sending,
deletion, OS trust broadening or blanket approval bypass was added.

## Four-source generation regression tests (2026-09-12)

`apps/briefing-lab/briefing-generation.test.ts` now includes nine source-pipeline regression
cases in addition to seven existing scheduler/ownership tests. It exercises the real generation,
source orchestration, Calendar adapter, Mail scope/ingestion, encrypted history, grouping and
server-rendered History components. Only native Mail/Calendar, public providers and the LLM
boundary are fixtures. Unexpected network calls fail; every state file uses a temporary directory
and injected test key. No real Keychain, accounts, permissions, messages or calendar events change.

- Fully configured weather, Calendar, email and paper sources must produce actual data, not just
  a completed job: exact weather values and three-hour graph/zero-rain bar, scoped two-day Calendar
  range and event ID/time, email recipient account/time/content summary, and all five paper fields.
  Reopening the encrypted store must retain the same combined run and render the data.
- Same-day repeats reuse the original weather/agenda and do not repeat AI summaries. New mail and
  papers append once; old paper summaries stay stored but do not repeat in the fresh paper feed.
- No city, disabled Mail reading and no new papers are tested separately as omitted/empty data,
  never used as evidence that all four sources succeeded. These tests do not silently enable them
  or change the existing completion wording; the current user configuration remains untouched.
- Each of the four source failures preserves other successful sources and sets a job warning.
  LLM failure retains collected weather/agenda. Disabled Calendar/AI-mail permissions prevent the
  corresponding native read/LLM transfer while other sources continue.

The existing `pnpm test:agent-runtime` gate already includes this file, so the new cases run in CI.
Focused: 16 passed. Full `pnpm check`: Briefing 673 passed, Desktop 2,384 passed / 8 existing
environment skips (MacTeX 5, Linux-only 1, live Claude/Hermes 1 each), Model Lab 341 passed;
formatting, contracts, lint, typecheck and production builds passed. Agent Runtime: 644 passed
(188 Desktop + 455 Briefing + 1 Model Lab). Mocked LLM/native tests do not certify live source
availability, macOS permission state or the scientific quality of a real model response.

## Direct Calendar actions and conflict identity (0.58.24 candidate)

- Manual Create/Save/Delete clicks execute prepare+apply immediately, without a second frontend
  review step. Delete always uses the observed original event fields. Double clicks are locked;
  an uncertain apply result requires reloading current Calendar rather than silently retrying.
- Sync-only modifiedAt changes no longer invalidate fingerprints. The native helper compares
  the remaining fields before mutation, including after any native confirmation; real content
  changes still stop execution. Recurring changes remain limited to this occurrence.
- The helper omits its extra native review only for a direct UI call from a certificate-signed
  parent at `/Applications/GOSU.app`, validated against the installed app's designated requirement.
  AI/default requests, CLI and untrusted/ad-hoc parents retain review. OS access permission is
  still separate and never auto-granted. Stable-signing setup and signed-build live verification
  are required before claiming the direct path deployed. Helper OS identity retention also needs
  verification on that signed build; it is not inferred from source tests.

## Preserve settings and signing continuity (0.58.23 candidate)

This supersedes the older empty-starter automatic recovery rule. Any existing current or legacy
settings key is authoritative during bootstrap, including a deliberately empty/default-looking
workspace. Corrupt/unreadable storage is not a fresh install. Only an actual first-use workspace
without saved keys auto-imports server configuration. Explicit restore updates an in-memory draft;
normal user Save remains required to persist it. Updates never enable Mail/body/Calendar options.

OS access is separate from selected calendars. Installed ad-hoc code identifies itself by cdhash,
which changes per build. The release continuity gate blocks that update path and verifies a stable
certificate-based designated requirement before routine replacement. A reviewed one-time signing
migration still needs OS consent; the gate does not grant/reset TCC or edit Keychain ACLs.
Reference: [Apple TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements).

## Email content independent of importance (0.58.22 candidate)

- Email generation explicitly summarizes who/what and concrete available details before assessing
  priority. Unknown importance belongs in its separate fields and never replaces content. Missing
  bodies must be disclosed, not invented from metadata.
- A high-precision boilerplate guard rejects known priority-only summaries through the existing
  one-correction validation flow. It is not a universal semantic-quality classifier. Concrete
  summaries with uncertainty remain valid; paper analysis and exact-quote checks are unchanged.
- Priority-only cached email summaries are not reused. Latest such entries are readmitted to the
  ordinary bounded ingestion plan and excluded from completed daily keys, so the next authorized
  collection can repair them. Latest corrected content stops that repair loop even if an older
  bad entry remains in History. Good summaries and existing read/AI scope are preserved.

## New-event writable destination (0.58.21 candidate)

The editor previously retained a nonempty first calendar ID even if it was a read-only holiday
subscription. For creates only, catalog loading now retains a valid allowed writable selection or
chooses the first writable allowed calendar. It never selects outside configured IDs or changes an
existing event's calendar. Submit is disabled while loading or without a writable destination,
and handler validation runs before prepare. OS confirmation and backend scope checks are unchanged.
Installed 0.58.20 also showed an OS Calendar access-required error. Inline reauthorization now
invokes the existing authorize route only on a user click, then reloads events/catalog without
resetting selections or the editor draft. The embedded privacy shortcut is frame/origin checked
and opens only the fixed Calendar OS panel. No permission is auto-granted.

## Rechecking old delivery candidates and within-run papers (0.58.20)

- Current installed UI was inspected again: 0.58.17 is responsive and was collecting a Briefing;
  0.58.19 mail screening was not deployed. Do not confuse source tests with installed behavior.
- Existing completed summaries normally bypass body reads. A same-Message-ID group across two
  currently selected accounts is now only a recheck candidate, never equality proof. With body
  reading enabled, its IDs are temporarily removed from the ordinary exclusion plan. Existing
  mailbox/date/count limits remain enforced; a candidate outside that bounded scan may not be read.
- A saved attempt marker avoids retrying inconclusive source checks every run. Successful proof
  retains every original delivery identity. Within a displayed run, an old row is hidden only if
  a verified group covers its exact ID/title/account/receipt time. No stored History is deleted.
  Matching prior preview/context digests can reuse the old summary for the same ID while adding
  newly verified identity metadata; changed observed inputs still require analysis.
- Papers now screen duplicates within the incoming batch and displayed run, not only against past
  summaries. Only exact source identity/version matches collapse. Title-only matches, unresolved
  versions and different explicit arXiv versions remain separate. Past runs remain historical records.

## Mail scheduling and verified delivery groups (0.58.19 candidate)

- A date-bearing deadline/event summary offers Calendar creation outside the email disclosure.
  The existing Calendar editor asks whether to register and exposes date/time, place and Notes;
  existing prepare/apply/native consent remains mandatory. Opening the review performs no write.
  Date-only candidates are all-day. An omitted year uses the receipt year, never today's year;
  timed candidates explicitly disclose their provisional one-hour duration. Invalid dates and
  relative-only/unsupported dates get no inferred button. This is a review draft from a summary,
  not proof that the original email or its interpreted date is correct.
- Only body-preview-authorized reads can produce duplicate proof. The fixed native reader skips
  attachments, multipart MIME, missing source/Message-ID, mismatched IDs and originals above
  262,144 characters. It compares complete single-part raw source after removing only known
  delivery/signature headers, retaining authored headers and every body character. SHA-256 of the
  canonical original and preview, plus length and title, must match across different accounts.
  Raw source is transient in the native process; only fingerprints leave it, not raw MIME/attachments.
  A stalled verification retains earlier body/metadata checkpoints; unknown equality stays separate.
- Verified copies are merged before AI analysis and within one displayed History run. Receiving
  accounts remain listed; primary read-state/original-link actions are explicitly representative.
  All copy identities are encrypted with the summary and excluded after successful summary on
  later ingestion. Past runs remain intact. Old records without proof are not retroactively merged.
- Verified originals can reuse summaries across account IDs only with matching source/context
  digests and existing private-access guards. Unverified mail retains the old exact-ID cache rule.
  This intentionally has false negatives for attachments/multipart/oversized mail; it does not
  claim universal MIME equivalence or sender authenticity.

## Item destinations and Back (0.58.17)

History uses separate DOM `jumpId` anchors from 0.58.18; the native `id` must not be replaced
while preparing display events. The installed 0.58.17 needs that follow-up correction.

- Embedded agenda titles are explicit links: Calendar uses native event ID plus occurrence start,
  tasks use canonical task ID. Parent checks exact frame/origin and bounded typed payload, then
  navigates the retained frame to Calendar or opens the current task in global To-do list.
- Calendar retrieves the target month through existing approved sources and opens only the exact
  returned ID/start occurrence. Task targets use current active-project tasks, independent of list
  filters. Missing/deleted/archived/inaccessible targets report unavailable rather than matching a
  similar title. Navigation does not write events/tasks or widen permissions.
- New calendar snapshots retain optional IDs; old snapshots without IDs remain readable, but do
  not receive a guessed direct link. No private live backfill is triggered.
- Titlebar Back keeps up to 30 local session destinations: surface, project, workspace tab,
  selected chat session, settings category and Briefing subview. Back does not push itself onto
  the stack. It is not undo, persistent browser history or a promise to restore unsaved forms.
- Briefing History stays mounted when opening Calendar; internal scroll positions are restored
  on return. Leaving the iframe for tasks keeps its History and scroll state intact.

## Inline navigation and saved connection reapproval (0.58.16 candidate)

- GOSU Briefing Lab expands History, saved papers and routine management under its main sidebar
  row. The embedded left sidebar is hidden in every view; the existing right AI chat stays intact.
  Parent navigation still validates frame/origin and retains the same iframe.
- Bootstrap now persists a recovered configuration in existing browser storage. It does not copy
  tokens or grants and still preserves customized workspaces. On embedded mount, a read-only
  status check offers direct reapproval only when an existing active server profile needs it.
- The reconnect endpoint accepts only routine ID, reloads the server's saved profile, and invokes
  existing native consent before ownership/scope approval. It never accepts a replacement scope
  from the browser. Cancellation or concurrent profile edits prevent commit. Valid approval is
  reused without prompting. No account/mailbox/calendar selection must be repeated for this path.
- macOS TCC is separate: ad-hoc signed updates can still prompt at the OS level. This update does
  not bypass OS permissions, modify Keychain ACLs or promise stable signing/notarization.

## GOSU settings and connection recovery (2026-09-11, 0.58.14)

- GOSU Settings contains a Briefing Lab category. Its content is the same retained global frame,
  not another iframe/client. Internal Briefing/Calendar settings actions route to that category.
  Parent/child messages remain source+origin checked; settings navigation never performs writes.
- Inspection found the installed frame using a persisted empty starter (zero Mail accounts,
  Calendar read off), while the encrypted server configuration still had Mail and three selected
  calendars enabled. Presence of a localStorage key alone had suppressed bootstrap recovery.
  Recovery now allows only an empty default starter; configured/multiple/customized workspaces stay
  intact. Explicit restore in the GOSU category loads a draft; Settings save/native approval remains
  required. No owner tokens or grants are copied, and old saved records are not overwritten.
- The packaged GOSU plist declares NSAppleEventsUsageDescription and calendar full/legacy access
  reasons, plus the Apple Events automation entitlement. These enable legitimate permission
  requests, not automatic TCC approval. Existing denials may still require the user's macOS setting.
  Fixed-target buttons open Automation/Calendar privacy panels through trusted main-frame IPC.
  No tccutil reset, ACL editing, password entry or permission bypass is performed.
- References: [Apple Events usage key](https://developer.apple.com/documentation/bundleresources/information-property-list/nsappleeventsusagedescription),
  [Calendar full-access usage key](https://developer.apple.com/documentation/bundleresources/information-property-list/nscalendarsfullaccessusagedescription).
  Verification and installed status: [0.58.14](releases/0.58.14.md).

## Combined agenda and GOSU todos (2026-09-11, 0.58.13)

- Embedded GOSU supplies a read-only task reader from its canonical workspace snapshot. It omits
  completed/archived tasks and trashed/archived projects; returns at most 200 incomplete tasks
  with title, project, status, priority and due date, not descriptions. No task writes are exposed.
- Optional `todoRead` is off for existing profiles. Enabling it changes the approved scope and
  requires native Settings approval. AI `read_todos` additionally requires private-AI permission;
  guards recheck scope after the read. Standalone returns an explicit unavailable message instead
  of inventing tasks. Existing Calendar permissions do not silently grant To-do access.
- Generation refreshes encrypted private task snapshots on each update even when the day's
  calendar/weather is retained. Empty reads remove completed tasks from the new snapshot; failure
  retains prior data with an error notice. Historical snapshots do not claim live completion state.
- The existing agenda disclosure combines green Calendar rows and purple, labelled To-do rows
  in today/tomorrow columns. It displays at most six overdue/upcoming/undated tasks with compact
  project/status/deadline metadata. The existing full To-do list remains the management surface.
  The combined section collapses together and shows an incomplete-task count in its compact header.
- Synthetic browser QA inspected the shared two-column layout. No actual task/Calendar reads,
  private AI calls or task completion were performed. Version 0.58.13 is now installed with its
  compact sidebar verified; live source grants remain user-controlled. See [0.58.13](releases/0.58.13.md).

## Shared GOSU integration (2026-09-11, 0.58.12)

The initial 0.58.12 approval delay is historical; 0.58.13 main UI/sidebar is verified.
See the release record before claiming live private-source verification.

- Global Calendar, To-do list and Briefing Lab entries sit above Projects. Search/notifications
  remain in the shortcut row. To-do list uses existing GOSU Tasks data; Model Lab stays per project.
- Desktop bundles the Briefing UI and lazily owns one loopback listener on port 4318. A busy port
  fails closed, never adopting an unknown listener. Quit standalone Preview before opening the
  embedded workspace. Scheduling starts only after listening, not during build/Main import.
- One sandboxed frame stays mounted across navigation and project changes. Trusted main-frame IPC
  opens it; it has no Node/GOSU preload. Parent CSP allows exact lab origins. HTTPS popups use the
  existing external-link handler. Validated parent messages only switch Calendar/History.
- Calendar hides Briefing's inner navigation/topbar for space. Re-clicking a global entry restores
  that view even after visiting inner settings. The Briefing frame is global, never per-project.
- Existing encrypted history/archive/memory/Calendar configuration stay in their original location.
  Initial bootstrap copies server profile configuration, not owners/tokens/private records. New
  client access still requires Settings save/native consent. Existing iframe localStorage and
  standalone browser storage are not overwritten. Browser-only layout/custom-question preferences
  cannot all be reconstructed from server profiles. This does not grant every GOSU chat unrestricted
  private-data access. See [0.58.12 verification/install status](releases/0.58.12.md).

Implementation: 2026-09-09, standalone Briefing Lab at `http://127.0.0.1:4318/`.
This does not replace `/Applications/GOSU.app`, schedule background runs, or write GOSU tasks.
User-selected integration: Apple Calendar accounts already registered on this Mac.

## New papers only in refreshed briefings (2026-09-11)

The latest-only **display** rule here is superseded by the 2026-09-13 saved-paper retention contract
above. The exact-identity exclusion from new analysis remains in effect.

- Persisted source collection filters out papers already summarized in the same routine's retained
  History/archive, across day boundaries. Identity uses the existing versioned paper key, never
  fuzzy titles. New versions and unresolved different identities remain eligible. Explicit raw
  reads (`persistSnapshot=false`), saved-library viewing and manual refresh still work.
  This is a local post-discovery filter: it avoids repeated enrichment/summary/display, not the
  public discovery request itself. Shared-chat records without matching source identities are not
  promised deduplicated by title. No mailbox/permission expansion is introduced.
- Optional snapshot `visiblePaperKeys` records the latest collection's unseen paper selection.
  Daily updates replace only that selection, so older same-day papers no longer fill the refreshed
  list or its highlights. Original history records and full paper archive are untouched. Legacy
  snapshots without the field retain their historical layout. Emails are not filtered by this
  selection; their existing Mail ingestion/deduplication policy is unchanged.
- A persisted source notice states how many new papers were found, or no new papers **within the
  queried scope**. Source failure remains failure/unknown, not an empty-success claim. Existing
  New badges remain; generation completion now reports added email/paper summary counts separately
  in the app. This does not enable OS notifications or new background schedules.
- Synthetic browser QA showed zero paper cards and the no-new-paper notice for the latest fixture,
  while the previous day's papers and existing email remain. Tests cover cross-day exclusion,
  new versions, failure notices, archive retention, explicit raw reads, daily view selection and
  typed completion counts. No private source access, real generation or deletion was used.
- Final gates: Briefing 610/610 (91 files); Agent Runtime 179 Desktop + 418 Briefing + 1 Model
  Lab = 598/598; typecheck/lint/format/build and documentation 2/2 passed. Assets:
  `index-o934ubOM.js` / `index-DuNVj9vj.css`. Preview restarted after checking no external TCP
  activity and only an esbuild child; browser loopback connections were present. Stored settings
  and history are preserved; previous in-process receipts expire. No forced browser refresh.

## Preserve saved paper equations and figures (2026-09-11)

- Removed the first-three-paper enrichment gate from an explicitly selected analysis batch.
  Every uncached selected paper now goes through the existing bounded source enrichment path;
  cache hits still bypass source reads. Figure download quota is per paper (two selected figures),
  not three images shared by the whole batch. Existing same-paper URL/image validation, source
  limits, selected equation/figure IDs, permissions and cancellation remain unchanged.
- PaperArchive no longer invokes the 3MB image-cache eviction helper. Saved image bytes stay
  with their captions/equations in encrypted storage across reopening. This is bounded storage:
  the existing sealed-file 32MB ceiling still atomically rejects an oversized new save, preserving
  the previous file; it does not promise unlimited storage or silently drop existing media.
  The cache helper remains available/tested but is no longer the library retention policy.
- A same-version, same-private-scope text-only refresh keeps previous equations/figures; a matching
  figure ID+asset URL keeps its previous image if the new read lacks bytes. Different paper versions
  and private scopes are not merged. Source-unavailable/abstract-only papers may still lack media;
  selected evidence is not every equation/figure in the full paper. Shared-chat Markdown external
  images are not converted into saved assets by this change.
- Regression verifies the fourth paper's equation/image, encrypted reopen of eight 400KB image
  records beyond the old library budget, text-only refresh preservation, and cache reuse with no
  extra source/image/model calls. SavedPaperSummaries renders stored KaTeX and data-image sources.
  Full Briefing 604/604 (90 files), Runtime 179 Desktop + 413 Briefing + 1 Model Lab = 593/593;
  typecheck/lint/format/build passed. No private-paper backfill or paid inference was performed.
  Previously absent/evicted source media is not claimed recovered; it requires available local
  evidence or an explicit source re-read. Existing stored summaries are not bulk regenerated.
- Preview was restarted after confirming no external TCP activity and only an esbuild child;
  stored data was preserved, ephemeral receipts expire. Assets remain `index-DH1Wkj7y.js` /
  `index-DuNVj9vj.css` (backend-only changes). Maintenance documentation tests: 2/2.

## Newest summary ordering and paper bibliography (2026-09-11)

- History email/paper lists sort by original `provenance.summarizedAt` descending, falling back
  to addedAt then owning batch creation time when unknown. Importance and New acknowledgement
  no longer reorder these lists. Cached summaries retain their original summary date. The upper
  AI highlights still use importance; daily run and section grouping are preserved.
- Paper disclosure titles include source-provided first-publication date and venue. Expanded
  content begins with authors. New optional `bibliography` fields carry bounded authors, venue
  and source through LiveItem and encrypted History/archive. Same-identity/private-scope earlier
  bibliography is retained when a later save omits it; legacy records remain readable.
- arXiv Atom authors and journal_ref populate the metadata. Without journal_ref the label is
  arXiv preprint, not an invented journal. Recognized Scholar citation lines provide author text
  and venue/year explicitly labelled **알림 기재**. Unknown date/venue/authors stay **미확인**;
  mail arrival is never substituted for paper publication. No automatic legacy backfill, arbitrary
  publisher fetch or extra LLM call is introduced. Existing parser bounds still apply.
- Synthetic UI QA inspected an inline date/proceedings byline and authors after expansion.
  Tests cover latest-low before older-high for email/papers, immutable sorting, unknown metadata,
  author/venue extraction and bibliography persistence across cache reuse/restart.
  Full Briefing 602/602 (90 files), Runtime 179 Desktop + 411 Briefing + 1 Model Lab = 591/591;
  typecheck/lint/format/build passed. Assets: `index-DH1Wkj7y.js` / `index-DuNVj9vj.css`.
  No private Mail/Calendar or paid inference was used in verification.
- Preview was restarted after confirming only an esbuild child and no external TCP activity.
  Existing settings/history were not reset; ephemeral receipts expire. Documentation tests: 2/2.

## Always-visible mail filters and reviewed AI settings drafts (2026-09-11)

- Mail common filters are a labelled section with heading, not a details/summary toggle. Connected
  accounts show day/count/subject/sender/unread/preview fields without another expand action.
- The assistant has `propose_settings`, a no-write tool accepting a strict bounded JSON query
  containing mailDays (1–30), mailLimit (1–100), paperDays (1–3650), paperLimit (1–30).
  It returns a host-validated `settingsProposal` alongside the answer, not a model claim that
  settings were saved. Empty, unknown, permission/account/schedule fields and invalid ranges fail.
  A mail proposal requires a connected mail scope. Existing Calendar reviewed-event actions remain.
- Chat renders an explicitly unsaved offer. **설정에서 검토하기** opens a routine-scoped local
  settings draft with only those fields changed. Other accounts, permissions, schedules and
  filters stay intact; the original routine is immutable. The existing Settings save endpoint
  and its normal ownership/approval checks are still required. Saving clears the pending offer
  draft state. This is NOT arbitrary settings administration or direct chat-based auto-save.
- Synthetic UI verification followed a mail 10-day/100-item offer into settings, observed values
  10/100 and a SECTION with no closed details ancestor. Disconnected-mail review was disabled.
  No real model, mail read, setting save, schedule enable or Calendar write was used for QA.
- Tests: full Briefing 596/596 (89 files); named Agent Runtime 179 Desktop + 408 Briefing +
  1 Model Lab = 588/588. Typecheck/lint/format/build passed. Coverage includes no-write tool
  proposals, unsupported-field rejection, immutable draft construction and preserved mail filters.
  Assets: `index-_f_wPPy_.js` / `index-BVP54DqY.css`.
- Preview was restarted after verifying only its esbuild child and no external TCP activity.
  Stored settings/history remain intact; old in-process receipts expire. Documentation tests: 2/2.

## Compact importance icons (2026-09-11)

- `ImportanceIcon` replaces visible importance-level text in email metadata, paper disclosures
  and live/history AI-summary highlights. Three/two/one filled bars mean high/medium/low,
  paired with amber/blue/muted green colors. Unknown/pending use a question mark, never low.
  A native title tooltip and `role=img` accessible label preserve the Korean meaning; the badge
  is not a button and does not modify preferences. Existing thumbs-up/down feedback is unchanged.
- Paper priority now appears alongside keywords while collapsed; the redundant expanded-only
  text row is removed. Underlying AI ratings, sort order, importance explanations, saved data,
  original-mail links and read controls are unchanged. No new inference or backend change.
- Synthetic browser QA inspected email, paper high/medium/low rows and summary badges with
  consistent 26px boxes and distinct colors/shapes. Unit tests cover filled-bar counts, tooltips,
  accessible labels and uncertainty; the paper disclosure regression checks the collapsed icon.
  Focused 28/28; full Briefing 586/586 (88 files); typecheck/lint/format/build passed.
  Assets: `index-BoMYP9Gy.js` / `index-ps5otfoZ.css`. Preview serves updated static files without
  restarting jobs or forcing user-browser refresh. No actual Mail/Calendar/model call was used.

## Visible generation progress (2026-09-11)

2026-09-13 source update: running progress defaults to a closed native disclosure. Its compact
summary retains stage, saved/total count when known, elapsed time and a chevron. Expanding reveals
the existing scoped progress bar, backend detail, remaining count and timing caveat. Native keyboard
disclosure semantics and visible focus are retained; polling does not reset the open state, and the
existing job-ID key resets a new job to closed. Stop controls and terminal errors remain outside the
disclosure. No source, model, scheduling, storage or permission behavior changes. Synthetic production
component rendering was inspected in both states (approximately 38px collapsed at 812px viewport).
Focused progress tests: 4 passed. Full `pnpm check` passed; installed 0.58.29 is not yet replaced with
this source update. The visual fixture does not access private accounts or call an LLM.

- Running generation displays a compact header panel: current backend detail, stage, locally
  ticking elapsed time and summary-stage completed/total/remaining counts. Source/calendar work
  uses indeterminate progress, never fabricated percentages or ETA. The determinate bar covers
  selected AI-summary items only, not the entire generation. Counts advance after a batch returns
  a saved History ID; cache reuse counts as processed/saved work, not a new LLM invocation.
- GenerationStatus adds optional `progress` with collect/calendar/summarize/finalize stage and
  completed/nullable-total numbers. Legacy stored jobs remain valid. Existing source checks,
  cancellation, scopes, selected-item limits and summary caching are unchanged. Stage updates are
  in-process; the existing initial/final job persistence still applies. Restart interrupts a job,
  not resumes it. Reopening the UI during an active server job uses its original startedAt.
- Controls poll the read-only job status every two seconds with overlap prevention; the elapsed
  timer runs locally once per second and is removed with the running panel. Polling performs no
  Mail/Calendar/LLM work. Terminal errors/partial-success warnings remain visible, and the panel
  disappears at terminal status. Expected remaining time is explicitly unknown, not predicted.
- Header buttons retain their 34px aligned row; the progress panel and title align from the top.
  Synthetic running fixture visually showed 6/10 saved, four remaining and 1m15s elapsed;
  all three icons retained y=62px and 34px height. No private source or paid inference was used.
- Validation: full Briefing 581/581 (87 files); Agent Runtime 179 Desktop + 398 Briefing +
  1 Model Lab = 578/578. Typecheck/lint/format/build passed. Regression coverage includes actual
  generation stage/count publication, legacy schema, indeterminate work, elapsed clock without
  extra requests, two-second status polling and hiding the panel on completion. Assets:
  `index-BereLe-X.js` / `index-QfVbeTjH.css`.
- Preview was restarted after checking its only child was esbuild and no external TCP connection
  was active. Saved settings/history were preserved; old in-process receipts expire on restart.
  Maintenance-documentation tests passed 2/2.

## Stable header icon alignment with generation status (2026-09-11)

- Header actions align to `flex-start`, not the vertical center of the generation controls plus
  their status/error rows. Collapse uses the same 34px square as generate/stop. Progress and next
  scheduled time stay below the first control row; scheduling and collapse behavior are unchanged.
- Synthetic browser reproduction after selecting four hours: collapse y=72.52px/height=32px,
  generate y=62px/height=34px. Afterward both are y=62px/height=34px with the interval off or on.
  The fixture-only `?generation-running=1` start response exposes stop; all three buttons share
  y=62px/height=34px. Screenshots were inspected at 812px and 1280px viewport widths. No real
  schedule was enabled or briefing generated; native Mail/Calendar/model services were not used.
- Regression failed before the fix; focused layout 4/4; full Briefing 577/577 (86 files),
  typecheck/lint/format/build passed. Assets: `index-Cyb2g0wt.js` / `index-D8pQYcQd.css`.
  Frontend-only update; backend and user-browser state remain running without forced refresh.

## Matching compact weather/agenda bottom controls (2026-09-11)

- History weather/agenda body wrappers share 8px bottom padding and zero bottom margin.
  Agenda previously added its 16px outer bottom margin to the common 16px body padding.
  Their direct bottom-collapse controls no longer stack a 10px margin on the grid gap;
  the grid gap is 8px and the weather card's extra bottom margin is removed.
  Button hit areas, source content, upper content spacing and other email/paper controls remain.
- Synthetic browser measurements: weather/calendar button-to-section-bottom distances were
  17/33px and are now both 9px including the 1px border. Content-to-footer-divider gaps are
  both 8px in both stored fixture runs. Visually checked the weather chart and agenda footer;
  individual bottom buttons close the correct section with zero remaining body height.
  No personal Mail/Calendar access or history mutation was used.
- A CSS regression failed before the fix. Focused layout/disclosure tests 8/8; full Briefing
  576/576 (86 files); typecheck, lint, formatting and production build passed. Assets:
  `index-BEINbb_7.js` / `index-Dzfhs0qN.css`. Frontend-only: no backend restart or forced
  user-browser refresh, preserving active jobs, receipts and page-memory chat.

## Conservative advertising exclusion from paper candidates (2026-09-11)

- Scholar extraction checks individual linked entries with `briefing-paper-ad-filter.ts` before
  deduplication/candidate limits. Exclusion requires an explicit leading advertising label,
  purchase call-to-action and concrete price/discount evidence together. Missing or ambiguous
  evidence passes. Academic language, supported scholarly/publisher links and citation-only
  entries are retained, including conference/webinar announcements and research about advertising.
  This intentionally favors false negatives; it is not proof of commercial intent or a promise
  of zero false positives. Unknown layouts/unlabelled promotions can still pass.
- A mixed digest is not discarded because its subject/footer contains advertising language.
  Original emails remain in the email section; existing stored summaries, Mail read state and
  feedback are untouched. This filter is for new email-derived paper candidates, not a general
  inbox spam filter. It adds no Mail read, HTTP request, LLM call, grant or learned preference.
  Collection notes explain conservative exclusion and original-mail preservation.
- Synthetic regression coverage: clear Korean/English ads, incomplete signals, academic and
  ambiguous announcements, protected arXiv/DOI links, HTML mixed entries, citation-only entries,
  input immutability and ads not exhausting the 12-candidate limit. Service integration keeps
  the original email and existing private-AI gates. No private inbox or paid inference was used.
- Validation: focused parser/filter 24/24; full Briefing 575/575 (86 files); named Agent Runtime
  179 Desktop + 392 Briefing + 1 Model Lab = 572/572. Typecheck, lint, formatting and production
  build passed. No installed GOSU app replacement or historical-data cleanup is part of this change.
- The standalone Preview was restarted for this backend change after verifying its only child
  was esbuild and there were no active external TCP connections. Saved settings/history were
  preserved; in-process source receipts expire on restart. Maintenance documentation tests: 2/2.

## Equal-height calendar month weeks (2026-09-11)

- `CalendarView` keeps `height="100%"` and applies `fixedWeekCount: true`,
  `dayMaxEvents: true`, and `moreLinkClick: 'popover'` only to `dayGridMonth`.
  Content no longer stretches busy weeks; overflow remains accessible through `+N 개`.
  Week/day views, source queries, event records and reviewed calendar writes are unchanged.
- `calendar-layout.test.tsx` first failed against the previous props, then passed with the
  month-specific contract and all 14 input events retained. The synthetic visual fixture uses
  `?calendar-density=1` with mixed all-day/timed events and uneven weekly event counts.
  Rendered week heights changed from 61/38/130/38/84/359px to 90/90/90/90/90/89px
  (one-pixel rounding). September/October navigation and week/day transitions were checked;
  the busy-day popover exposed all 14 events. No private calendar data or write was used.
- The development console reports a React `inert` empty-string attribute warning; it does not
  prevent calendar rendering or popover interaction. This change does not claim warning-free UI.
- Validation: focused test 1/1; Briefing Lab full suite 556/556 across 85 files;
  typecheck, lint, package formatting check and production build passed. Production assets:
  `index-BIEp_Ork.js` / `index-B8BeCtR0.css`. Backend scheduling and existing browser state
  are not restarted or cleared for this frontend-only change.

## Separate paper summary/publication date search (2026-09-11)

- The paper library has independent **요약일** and **최초 공개일** start/end fields. Either range
  can be open-ended; both endpoints are inclusive Korean calendar days (`Asia/Seoul`). The two
  ranges intersect each other and the existing text/category/tag filters. Filtering covers the
  full loaded library before pagination, resets the visible page, and invokes no source or LLM.
  **기간 초기화** clears only dates, preserving other search conditions. Invalid/reversed calendar
  ranges produce a readable validation message.
- Summary filtering uses only the recorded `provenance.summarizedAt`, not save/archive time,
  classification time, cache retrieval time or the date embedded in an arXiv identifier. Legacy
  summaries and shared chat analyses without an original summary timestamp remain undated.
  Missing dates are counted, remain visible with no corresponding range, and are excluded only
  when filtering by their missing date. No invented date or implicit source backfill is used.
- Workspace paper items now optionally retain `paperPublishedAt`, normalized from the source's
  valid publication timestamp. For arXiv this is the feed's `published`, not `updated` or collection
  time. Scholar-alert arrival dates are not substituted. The field survives encrypted History/
  archive/cache reuse and is preserved from the same exact paper identity and privacy scope if a
  later refresh omits it. New known dates appear separately from summary dates in the compact footer.
  Adding this field does not regenerate summaries, change their provenance timestamps or invalidate
  scientific classification. Older stored papers missing publication metadata remain unrecorded
  until a normal authorized source lookup/save provides it; no bulk arXiv backfill was performed.
- Tests cover independent/intersected day ranges, timezone boundaries, unknown dates, invalid
  periods, clearing, no extra inference, publication/summary separation and encrypted cache/restart
  persistence. Focused **30/30**, full Briefing **555/555**, named Agent Runtime **179 Desktop +
  373 Briefing + 1 Model Lab = 553/553**, typecheck/lint/package formatting/production build passed.
  Browser QA used synthetic papers, confirming publication filtering, combined ranges and distinct
  footer dates with zero console errors. No actual paper, private summary or paid model was read
  for this verification. Assets: `index-qdVOzPVC.js`, `index-B8BeCtR0.css`.
- The idle Preview was restarted after verifying no active connection or inference child, and
  port 4318 served the new assets. Existing settings, history and summaries were not removed;
  process-local receipts expire normally. Maintenance-document tests **2/2** passed.

## Direct chat sidebar and configurable suggestions (2026-09-10)

- Removed the global topbar AI-assistant button. Both the right rail's arrow and its vertical AI
  label now open chat directly, including after closing the routine copilot; they no longer reveal
  the routine overview as an intermediate step. The chat starts at 380px, and user resizing is
  retained on subsequent close/open cycles.
- Open/reopen shows recommended questions and focuses the existing composer with `preventScroll`.
  Background briefing updates, model replies and suggestion edits do not steal focus. The existing
  retained per-routine panes keep messages, draft, scroll position and in-flight answers across
  sidebar toggles, Calendar/paper/History navigation and daily briefing updates. Source/provider/
  permission-context changes retain their cancellation/isolation boundary. This is page-lifetime
  retention, not new disk-backed chat storage: full reload/app termination still clears the chat.
- Routine settings now contain **AI 비서 추천 질문**, with an add input and delete icon on each
  row. Changes apply with the existing **설정 저장** button. Up to 12 unique nonempty questions,
  each at most 300 characters, are validated in the core workspace schema. The optional root routine
  field `suggestedQuestions` is ordinary browser configuration, not a private-AI permission or an
  instruction sent automatically to a provider. Missing legacy fields use the five defaults;
  an intentionally empty array stays empty. Questions execute only on explicit suggestion clicks.
- The question field is excluded from the retained chat reset key and from the existing backend
  settings payload, so editing suggestions alone does not replace the conversation or broaden
  backend source/model access. Do not downgrade an active workspace to older strict-schema UI
  writers after adding this field. No private chat transcript is copied into localStorage or docs.
- Synthetic browser QA confirmed no topbar button, automatic composer focus, two messages and
  an unsent draft surviving close/open, Calendar/History navigation, a generated briefing update,
  and saving an edited suggestion list. The saved custom question appeared on reopening; the
  removed default did not. Browser console errors were zero. No real sources, paid inference,
  private settings changes, user-browser reload or backend restart were used for this UI change.
- Final gates: Core **116/116**, Briefing **549/549**, named Agent Runtime **179 Desktop +
  367 Briefing + 1 Model Lab = 547/547**. Both affected packages passed typecheck/lint/formatting
  and build; maintenance-document checks **2/2** passed. Preview serves `index-BLDDPdQ4.js` and
  `index-Cf3pgpye.css` without restarting the backend or interrupting active jobs.

## Composer-corner shortcuts (2026-09-10)

- The assistant's **추천 질문** and **권한 설정** controls moved from the routine/context header
  into the lower-left corner of the message input box. Both use 28px icon-only buttons with 18px
  SVGs, native hover titles and accessible labels: a lightbulb for suggestions and a shield/sliders
  icon for permissions. The suggestion icon is highlighted and exposes `aria-expanded` while open.
- Suggestions now toggle from the same icon; closing returns focus to the existing composer.
  The panel's existing close control and one-click suggestion submission remain. Permission access
  calls the same settings navigation callback; opening it does not save/grant permissions.
  Both shortcuts are `type=button`, never implicit form submissions. Composer bottom padding
  reserves room for the controls; resizing, Enter/Shift+Enter/IME behavior and send/stop are preserved.
- Regression coverage checks input-box placement, removal of header buttons, icon labels/titles,
  toggling, unchanged draft and no inference on shortcut clicks. Focused chat tests **7/7**;
  full Briefing **546/546**, named Agent Runtime **179 Desktop + 364 Briefing + 1 Model Lab =
  544/544**; typecheck, lint, package formatting and production build passed. Synthetic browser QA
  confirmed the 28px controls inside the border, draft retention, settings navigation and zero errors.
  Assets: `index-Y4V5laiz.js`, `index-BcnjlL-E.css`. Frontend-only; Preview is not restarted and no
  real Mail/Calendar/model call, permission change or forced user-browser refresh was performed.

## Compact collapsed source geometry (2026-09-10)

- Closed source sections explicitly use block layout, zero internal grid gap and auto/zero-min
  height. Their direct non-summary children use `display: none`, so a hidden forecast/body cannot
  retain layout geometry through the native details content box. History grids align to the start
  and size rows to actual content; whole-run `content-visibility: auto` and its remembered/1000px
  intrinsic placeholder were removed. Correct collapse geometry takes precedence over that
  offscreen layout optimization; no histories or source data are removed.
- Collapsed headers use a 44px minimum hit area, 8px vertical padding, compact 14px headings and
  inline weather/agenda previews, with a stable 23px expand glyph. The source border makes the
  measured single-row total **46px**. Long city names truncate with a tooltip; narrow panes can
  wrap instead of clipping required weather/agenda information. Source counts and New badges
  remain. Expanded charts/details and the always-visible AI assistant summary are unchanged.
- In the current synthetic desktop before-state, closed weather/calendar/email/paper measured
  **73/89/56/56px**; native closed-body boxes still reported nonzero geometry. After the fix all
  four measured **46px**, including the offscreen second run, with hidden-body height **0px**.
  Reopening weather restored its chart and measured **428px**, then closing restored the compact
  row. The much taller historical frame in the user's screenshot was not reproduced verbatim in
  the current fixture; these guards remove both reserved height and grid-gap retention paths.
  Browser inspection confirmed retained temperature/rain/agenda information and zero console errors.
- Focused regressions **5/5**, full Briefing **545/545** (82 files), named Agent Runtime
  **179 Desktop + 363 Briefing + 1 Model Lab = 543/543**; typecheck, lint, package formatting and
  production build passed. Assets: `index-DjF2KOHv.js`, `index-J-k0utFT.css`. This is frontend-only;
  the Preview backend is not restarted, preserving running jobs/receipts. No native source read,
  paid inference, real schedule change or user-browser refresh was performed for verification.

## One-click daily updates and hourly generation (2026-09-10)

2026-09-14 follow-up [0.58.56](releases/0.58.56.md): intervals are not erased when startup or scheduler
checks fail. Transient errors retry the local eligibility check after one minute; real scope/owner
changes pause dispatch and keep the selected hours visible. Only explicit Off clears the interval.
The v2 scheduler digest binds the routine and approved source/provider permissions, not the list of
already authorized client windows, UI preferences or model choice. Existing exact legacy profiles
can migrate when approved owners were only appended; unknown/changed legacy profiles stay paused.
Source reads/inference/saves retain a separate full run-configuration digest to reject mid-run edits.
The effective global approved-scope policy can satisfy unattended confirmation, but cannot grant a
new account or bypass OS permissions. Initial status loading never looks like a stored Off value.
Existing encrypted `generation.v1.enc.json`, next due time and coalesced restart behavior remain.
This supersedes the older "select the interval again after any model change" description below.
If an older build already erased a period, its value cannot be guessed from zero; do not re-enable
an explicitly disabled schedule or invent a former interval without evidence.

- The personal History title bar now has an accessible **브리핑 생성** document/plus icon.
  It starts backend collection and summary processing directly, without switching to the live tab
  or requiring another collect click. Progress and stop controls remain in the header; History
  reloads on new saved batches without remounting chat or resetting disclosure state.
- **자동 브리핑** offers off / 1 / 2 / 4 / 6 / 12 / 24 hours. Selecting a nonzero interval explicitly
  enables recurring collection and selected-provider AI usage for that owned routine. Existing
  routines remain off until a user selects an interval; no real schedule was enabled during QA.
  This replaces neither the separate legacy schedule-calculation preview nor OS startup settings.
- `BriefingGeneration` runs inside the local Briefing server, including with the browser closed.
  The Mac must be awake and the server running. Timer wiring starts only on the actual Vite dev/
  Preview HTTP server's listening lifecycle, not during builds, module imports or unit tests.
  A 30-second due check claims the next execution before dispatch. Missed intervals coalesce into
  one run after waking/restarting; there is no catch-up burst. Manual generation resets the next
  due time when a schedule is enabled. One active job per routine, two workspace-wide, and a
  20-minute run ceiling bound duplicate clicks, overlaps and resource use. No launchd/cron job,
  wake-from-sleep request, remote scheduler or new Codex automation is installed.
- `BriefingGenerationStore` persists intervals, next due time and safe job metadata in
  `generation.v1.enc.json`, using the existing authenticated/atomic/Keychain-backed sealed-store
  boundary. Explicit enablement stores the owning browser capability encrypted, never in status
  responses, logs, browser schedule metadata or docs. It is bound to the exact routine and source/
  permission/provider profile digest and revalidated before dispatch, reads, inference and saves.
  Off clears that persisted authority and cancels the active job. Changed permission/source/model
  settings pause later scheduled execution and require selecting the interval again. Ask-each-time
  profiles cannot enable unattended runs; native OS permission boundaries remain unchanged.
- `dailyRun` atomically adopts the oldest active snapshot for the routine's current local day or
  creates a new daily run. Existing multiple legacy runs are preserved, not destructively merged.
  Subsequent generations append summary batches to that run, using exact versioned paper identity
  and message identity to skip already-added items before enrichment/analysis. The first weather
  and agenda snapshots stay unchanged all day (including an explicitly empty agenda); missing/
  failed snapshots can be filled on a later attempt. Crossing local midnight starts a new daily
  run. Existing global mail-summary exclusions and the three-message first-connection limit remain.
- Daily metadata uses optional `snapshot.daily` and item `addedAt` fields in encrypted workspace
  history. Existing summaries/dates are not rewritten; refreshing an existing daily item preserves
  its initial added time. Legacy items without this metadata do not acquire a false New marker.
  New same-day batches update the overview's priority cards; the daily run sorts by last update
  while its heading keeps the original day. A failed source is not described as a successful empty
  update, and completed batches remain readable if a later batch fails or is cancelled.
- 2026-09-12 source update: each accepted daily generation stores `snapshot.newItemsSince` on
  all existing snapshots of that routine, including older days. New badges require `addedAt`
  within that generation window as well as the optional browser acknowledgement. An empty,
  failed or cancelled collection after daily-run initialization still expires previous badges;
  rejected requests before initialization do not. Reload/restart retains the boundary. Arrival
  timestamps, summary contents, ordering and other routines remain untouched.
- Embedded Calendar cards in both History and live AI summaries now open the exact native event
  ID and occurrence start, like agenda title links. Legacy snapshots without IDs retain local
  scrolling; titles are never guessed into Calendar identities. Installed validation is pending
  the fixed-signing migration; this source change does not replace the installed app.
- Added email/paper titles and collapsed source headings show **New**; unacknowledged entries sort
  before older entries within each source while the AI overview retains priority order. **New · 확인**
  clears only currently delivered markers. Browser-local `gosu.briefing.seen-updates.v1` retains up
  to 1,000 run/time watermarks, with no message titles/bodies. Later additions remain New; this is
  independent of Apple Mail read status. If browser storage is unavailable, acknowledgement lasts
  only for the current page. Source contents/summaries remain backend-owned and encrypted.
- `/generation/start`, `/generation/status`, `/generation/cancel` and `/generation/schedule` require
  the existing same-origin/capability and routine-owner checks. No LLM gets a scheduling mutation
  tool. Deleting an active daily run cancels its generation. Stored run data survives restart;
  a persisted in-flight status is reported as interrupted, not successful or silently resumed.
- Verification uses synthetic encrypted stores, mocked providers and fake elapsed hours; no real
  mailbox, calendar, paid inference or real user schedule was used. Coverage includes direct start,
  double-click deduplication, permission invalidation, restart/catch-up, cancellation, local midnight,
  weather reuse, exact-paper deduplication, persisted additions, New acknowledgement and sorting.
  Browser QA confirmed two updates stay in the same daily package, first weather/agenda persist,
  only the second update is New after acknowledgement, and no console errors. Final gates:
  Briefing **543/543** (81 files), named Agent Runtime **179 Desktop + 361 Briefing + 1 Model Lab =
  541/541**, typecheck, lint, package formatting and production build passed. Maintenance-doc tests
  **2/2** passed. Production assets: `index-DVqNdXIo.js`, `index-B-tOJbIj.css`.
  A real multi-hour unattended/provider soak has not been performed.
- The idle Preview was restarted after verifying no active connection or inference child. Port
  4318 served the new assets; the generation status route correctly rejected an unconfigured probe
  without creating a profile, schedule or source job. Existing settings/history were not deleted,
  no user browser was force-refreshed, and ephemeral receipts expire on restart.

## Targeted assistant Mail search (2026-09-10)

- Root cause: chat collected a limited recent-mail snapshot before applying `query` locally.
  A sender/date match outside that snapshot could never be found, even inside the approved
  lookback interval. This was separate from onboarding limits and already-summarized exclusions;
  chat already omitted that ingestion plan. A regression placed a matching alert after 301 unrelated
  messages and first reproduced returning only the first three unrelated messages.
- `search_email` now accepts separate receiving `account`, `sender`, `subject`, inclusive `from`
  and exclusive `to` conditions. Date-only inputs use the routine timezone. These conditions narrow,
  never expand, the saved account/mailbox/unread/body-preview scope. Since 0.58.140 the saved
  lookback days are only the default of a search: an earlier `from` is searched as asked, through
  Mail's index only (see [0.58.140](releases/0.58.140.md)). An unknown account
  is reported as a scope mismatch, not proof the message is absent. Receiving
  addresses disambiguate identically named accounts. Existing user settings are not rewritten.
- `briefing-mail-search.ts` builds fixed literal native predicates. Targeted requests use Mail's
  `whose` filtering before the 250-candidate/result cap, with case-insensitive title/sender terms
  combined by AND; Google Scholar can match its display name or sender-address terms. There is no
  arbitrary Mail expression, shell interpolation, direct mailbox database or full-body search.
  The host independently revalidates returned metadata and the existing scope. Ordinary recent
  briefing collection retains its bounded scan and does not acquire a mailbox-wide predicate.
  Predicate semantics follow the [Apple JXA release notes](https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/Articles/OSX10-10.html).
- Native selection still has a 60-second hard process bound and bounded metadata/body checkpoints.
  Slow selection with no candidates fails rather than returning a successful empty list; previously
  collected partial data retains its coverage note. Matching results remain count-limited and do
  not imply globally newest/exhaustive results. Only opted-in previews are read after selection.
  Read flags, messages, account settings and stored summaries are not changed.
- Chat memoizes identical normalized query/filter combinations within a turn. A new sender/date/
  account query gets its own scoped read instead of reusing an unrelated sample. The request uses
  one permission/discovery setup, allows at most four distinct searches, and does not re-read a
  failed source under a different query. Revocation/cancellation guards still run before/after
  native work; completed summaries are searchable without a fresh summarization or ingestion skip.
- Verification: focused search/native/chat **18/18**, Briefing **534/534** (78 files), named Agent
  Runtime **179 Desktop + 352 Briefing + 1 Model Lab = 532/532**; typecheck, lint, package formatting
  and production build passed. New search tests are included in the named runtime gate.
  An explicitly user-authorized, one-account/one-local-day metadata-only native check found **six
  matching messages in 16.545 seconds**, uncapped and non-partial. It read **zero bodies**, created
  **zero grants**, made **zero mutations** and used **no LLM**. This verifies native retrieval, not
  a paid end-to-end assistant inference. Account identity, titles and message text were not recorded
  in maintenance docs. `tools/mail-search-live-smoke.ts` is explicit-only, not an automatic test.
- The idle Preview was restarted after confirming only its esbuild child and no active connection.
  Port 4318 responded after restart. This is a backend-only change; frontend assets remain
  `index-DiaYwy2o.js` / `index-C-VyolYY.css`. The existing chat pane need not be reloaded: request
  headers retrieve the current server capability each time. Saved settings/history are unchanged;
  ephemeral source receipts expire on restart. Maintenance-document tests **2/2** passed.

## Mail read-confirmation recovery (2026-09-10)

A reported mark-read failure displayed the generic “result unconfirmed” warning and left the
historical unread badge visible. The previous native path always executed two mailbox-wide
RFC Message-ID searches, then checked the same native object's read flag immediately after its
setter. Synthetic regressions reproduce failure with a slow/forbidden whole-mailbox search and
with a stale/delayed property readback. This identifies faulty code paths, **not proof of which
native failure occurred for the user's screenshot**; no real message was changed for diagnosis.

- Fresh collection retains an optional validated `mailNativeId` metadata hint in the source and
  encrypted summary History. It does not change summary cache identity, read scope or LLM prompts.
  The action broker accepts this hint only from its own receipt/History, checks the original
  account/path/native-ID SHA-256 against the item ID, then rechecks the exact RFC ID in Mail.
  The browser still submits only routine/item plus receipt or history ID; supplied native IDs,
  URLs or commands are rejected by the unchanged strict UI-target schema.
- Known hints go directly to the selected message. Legacy records without hints use at most
  250 native IDs / a 10-second soft scan, not `whose` over the whole mailbox twice. The locate
  process has a 30-second hard bound. If an old message has moved out of that bounded subset,
  the action refuses to guess; old/moved records may still require original-source inspection.
  Locate timeout/failure explicitly says the write was not executed instead of reporting an
  ambiguous write completion. Original account/mailbox and Message-ID verification remains.
- The setter is issued at most once per action. Verification re-resolves the exact native
  message and checks the flag up to six times, with five 200ms read-only waits. If the write's
  acknowledgement is lost/unconfirmed, the host performs one independent read-only status call;
  it does not repeat the setter. A confirmed unread result is not a success. Mark/status processes
  retain their 15-second bounds; cancellation and profile guards run before and after native work.
- `/mail/read-status` is a UI-only recovery endpoint using the same ownership, approved Mail
  scope, exact target and per-request policy checks. It never opens a message, reads its body or
  sets a flag. `/mail/mark-read` can return a typed `unconfirmed` outcome rather than a false read
  success. The UI then shows **확인 필요** and a circular **읽음 상태 다시 확인** icon, not an assertion
  that Mail is currently unread. Only a read-only check confirming unread enables another explicit
  mark click; a positive read confirmation removes the badge/action and clears stale errors.
- Confirmed read observations update mounted copies and the encrypted display timestamp. A
  bounded 256-entry page-memory cache preserves acknowledgements when the same receipt/History
  row remounts; a new native receipt uses its newly observed state instead of an old override.
  This timestamp is confirmation time, not the exact time another Mail client changed the flag.
  Persistent-history failure is still reported separately from a successful Mail read observation.
- Error copy wraps below the status controls rather than widening their single horizontal row.
  Synthetic browser QA verified unknown → read-only check → no unread/unknown badge, no action
  button, no stale error, and no accidental email expansion. Long-title/narrow-layout cases had
  no renderer errors. Mail send/delete/move, attachment/content access and LLM calls are absent
  from this operation; the read-only collection engine does not gain a write tool.

Implementation and focused tests: [native operation](../apps/briefing-lab/briefing-mail-mark-read.ts),
[native regressions](../apps/briefing-lab/briefing-mail-mark-read.test.ts),
[UI status](../apps/briefing-lab/src/mail-read-status.tsx),
[UI regressions](../apps/briefing-lab/src/mail-read-status.test.tsx), and
[owned API tests](../apps/briefing-lab/briefing-workspace-integration.test.ts).
The installed Mail scripting dictionary confirms writable `read status` and read-only native/RFC
IDs. Native behavior and failure recovery are validated with synthetic Mail objects and fake
subprocesses, not a live mailbox mutation. Actual user-account write success remains unverified
until the user deliberately activates the updated control.

Final gates: focused native/UI **17/17**, full Briefing **507/507**, named Agent Runtime
**505/505** (Desktop 179, Briefing 325, Model Lab 1), typecheck/lint/format and production build
passed; document checks **2/2** passed. Synthetic UI inspection returned zero unread/unknown
badges, zero remaining mark controls, zero stale read errors and zero expanded email disclosures
after read-only confirmation. Assets: `index-Z4v0s1fn.js` / `index-CtjhEK-k.css`.
Preview at 4318 was restarted after confirming no active native/model child or client connection;
the latest assets are served. Saved settings/History are preserved, and process-local receipts/
grants expire as usual. GOSU.app was not replaced.

## Consistent run spacing, collapsed previews and recoverable run deletion (2026-09-10)

History run containers now own a **12px grid gap** between their direct blocks. Previous
email/paper-only top margins are neutralized, so the AI summary, weather, calendar, email and
paper sections have equal spacing when open or closed. The run header keeps the date and delete
icon in stable grid columns, with the routine label below, including narrow panes.

Collapsed weather shows the saved city, condition, temperature, available hourly low/high and
maximum reported precipitation probability (including 0%). Missing values are not fabricated.
Collapsed agenda shows today/tomorrow counts and one nearest/ongoing stored event, including its
day/time or all-day label. These use the snapshot's reference date/timezone, not today's clock.
Only collapsed summaries display these previews; expanded source cards and existing navigation
remain unchanged. The AI assistant summary stays outside the global-collapse action.

Each History run and the current saved live receipt has a trash icon. A separate **이 회차 삭제**
confirmation removes the entire run from the timeline. **삭제 취소** and **삭제한 브리핑 보기 → 복원**
return it to its original date position. The disclosure explains that native Mail/Calendar,
the saved paper library and interest settings are unaffected. This is recoverable timeline
removal, **not secure erasure or disk-space reclamation**.

- `removedBriefings` is a default-empty additive field in the existing encrypted workspace. A
  marker identifies an exact routine plus server-resolved run ID, or one legacy record without
  a run ID; matching timestamps/titles are never used to choose a group. All split batches and
  its snapshot are hidden together, including late batches written with the same run ID. Old
  data is retained for restore, with no plaintext fallback or reset of settings/History.
- Strict loopback/capability POST routes are `/history/delete` (one record/run target plus
  `confirmed: true`), `/history/deleted` (routine metadata only) and `/history/restore` (exact
  deletion ID). Store mutations and trash reads require the currently owning browser/profile;
  cancellation and exact target membership are rechecked in the serialized mutation. Repeated
  delete/restore is idempotent; a fresh deletion replaces the old restore identity so a stale
  undo cannot restore a newer deletion. Profiles without established ownership must be saved/
  adopted through the existing settings approval flow before managing their retained History.
- Deletion cancels only matching routine/receipt automatic summary jobs and invalidates that
  live receipt. It neither stops unrelated jobs nor calls native Mail/Calendar writes. Client
  notifications drop only matching cached live results and reload History without remounting
  its view; undo notices, queries, other disclosure states and retained assistant chats survive.
  A late delete acknowledgement cannot clear a newer live collection.
- Normal History search and exact AI History reads omit removed runs. Saved paper records stay
  accessible through the separate paper archive/library. Local summary metadata still supports
  completed-email exclusion, so timeline cleanup does not cause the same mails to be fetched/
  summarized again. Existing personalization memory is not a forget/delete-all operation.
- Restore exposes retained snapshots/summaries again; it does not reread sources, restart a
  cancelled LLM job, or recreate an expired raw-source receipt. Trash remains available after
  reload/restart. Missing ownership, failed requests and unconfirmed receipts never masquerade
  as successful deletion; UI removal happens only after a matching server acknowledgement.

Implementation: [compact previews](../apps/briefing-lab/src/briefing-collapsed-peek.tsx),
[delete/restore UI](../apps/briefing-lab/src/briefing-history-delete.tsx),
[strict contracts](../apps/briefing-lab/src/briefing-history-removal.ts),
[store](../apps/briefing-lab/briefing-workspace-store.ts), and
[source routes](../apps/briefing-lab/live-source-service.ts).
Focused regressions cover exact grouping, foreign clients/routines, cancellation, late batches,
archive and email-exclusion retention, restart restore, stale undo, API confirmation, matching-job
cancellation, UI confirmation/failure/undo and a late delete after a newer collection.
Synthetic browser QA measured **12px/12px/12px/12px** gaps in both expanded and collapsed layouts;
weather zero-rain and agenda previews were visible. It deleted one of two runs and restored it,
with both runs returned in date order and all eight source blocks still closed. Narrow-pane
confirmation, persistent undo and no renderer errors were checked. No real user run was deleted,
and no real Mail, Calendar or paid model call was used for validation.

Final gates: full Briefing **496/496**, named Agent Runtime **494/494** (Desktop 179,
Briefing 314, Model Lab 1), typecheck/lint/format and production build passed; documentation
checks **2/2** passed. Production assets are `index-VxSmlgUv.js` / `index-DrsdMerV.css`.
Preview at 4318 was restarted after confirming no active source/model child or client connection;
the new assets are served. Existing data is preserved, while process-local source receipts/grants
expire normally on restart. GOSU.app was not replaced.

## Assistant conversation retention across pane toggles (2026-09-10)

The disappearing chat was a frontend lifecycle bug: collapsing the right sidebar removed
`BriefingChat`, clearing its messages/draft and aborting the active request. The welcome questions
then made the recreated empty pane look like the same conversation. Opened panes are now retained
by [RetainedBriefingChats](../apps/briefing-lab/src/retained-briefing-chats.tsx), keyed by the existing
routine/provider/permission context. Closing the sidebar, switching to the routine copilot and
returning to an already opened routine hide the pane instead of destroying it. Explicit `[hidden]`
CSS overrides remove inactive controls from display/accessibility without discarding their state.

- Messages, unsent composer text, paper-save confirmation state and an in-flight answer survive
  pane toggles. Closing the pane is not a Stop request. The explicit **중단** button still aborts;
  full page teardown and provider/source/permission-context changes still cancel the old request
  and reject its late result. Model-menu busy state follows the selected routine's live pane.
- Every AI-assistant opening can show recommended questions above the existing log. The adjacent
  **× / 추천 질문 닫기** hides only this panel and focuses the existing composer; **추천 질문**
  reopens it. Submitting a question hides recommendations automatically. Closing/opening either
  UI does not itself send a prompt or read Mail/Calendar. Suggestion clicks still send once through
  the existing locked/permission-scoped path; hidden panes cannot send.
- The independent message scroller keeps a reader's previous position through hiding and layout
  changes. New messages received while hidden are shown on reopening; a reader already at the end
  stays at the end. Recommendation visibility never resets the conversation or composer.
- Retention is **only within the currently loaded browser page**. This adds no localStorage,
  sessionStorage, backend conversation archive or cross-window restoration. Refresh/closing the
  page still clears chat state; previously lost chat cannot be reconstructed by this UI change.
  Existing saved Briefing History and explicitly saved paper analyses are unaffected. The last six
  same-context messages remain the bounded next-turn context, not an ever-growing model prompt.
- Different routines have separate retained panes. Same-provider model/reasoning changes retain
  the existing context key; source/provider/permission changes and routine removal unmount the
  affected pane as before. This is not permission sharing across chat contexts.

Focused [retention regressions](../apps/briefing-lab/src/briefing-chat-retention.test.tsx) first failed
on the old lifecycle and now cover collapse/reopen, recommendation dismissal, draft and next-turn
history, hidden answer completion, Stop, scope-change cancellation, routine/copilot isolation,
scroll restoration and focus. The file is included in `pnpm test:agent-runtime`.
Synthetic browser QA confirmed two messages and an unsent draft after reopening, **900px → 900px**
reading position after recommendation dismissal, composer focus, no horizontal overflow and no
renderer errors. No actual Mail/Calendar data, real LLM run or private conversation was used.

Final verification: retention **6/6**, full Briefing **486/486**, named Agent Runtime **485/485**
(Desktop 179, Briefing 305, Model Lab 1); typecheck/lint/format and production build passed.
Maintenance-document checks **2/2** passed. Preview serves `index-DIErM9Ho.js` / `index-D8mqUALp.css`
at 4318 without restarting the backend, so saved settings/history and active native receipts remain
unchanged. Refresh once to load the new UI; this update does not replace the installed GOSU.app.

## Confirmed chat-analysis saving across GOSU and Briefing (2026-09-10)

Completed paper conversations now offer a human confirmation card. Only **보관함에 추가** or a
scoped affirmative reply saves an immutable encrypted copy to the shared local analysis library;
there is no source reread or model invocation. The paper session includes those accepted copies,
and Briefing's library reader preserves private-AI permission and truncation boundaries. Existing
automatic briefing summaries, private Mail/Calendar grants and original history are unchanged.

See [shared-library contract](SHARED_PAPER_LIBRARY.md) and [GOSU 0.58.11 candidate](releases/0.58.11.md).
Briefing Preview is updated; the installed GOSU app remains 0.58.10 pending restart approval.
Full Briefing **441/441**, Model Lab **341/341**, Desktop **2368 passed + 8 environment skips**,
contracts **43/43**, named Agent Runtime **437/437**, full `pnpm check` and package verification passed.

## Luna medium email/calendar latency work (2026-09-10)

EMAIL-only generation now emits seven meaningful fields instead of 18 mixed paper/email fields;
the host restores the legacy empty fields and preserves quote/ID/scope/repair validation. Paper
generation, cache identity and saved data are unchanged. Assistant prompts define sufficient-read
stopping, read-only answers with empty proposal arrays, and exclusive Calendar end boundaries.

Actual **gpt-5.6-luna / medium** inference on fixed synthetic evidence: 18 calls, three repeats per
variant/case. Median important-mail chat fell **19.065 → 16.148 s (15.3%)**, Calendar chat
**20.142 → 12.984 s (35.5%)**, while email summary **18.953 → 19.091 s** did **not** show a speedup
despite lower output tokens. Actual OS Mail/Calendar reads and UI/cache-hit time were not measured.
See [benchmark methods, exact artifacts and caveats](BRIEFING_LATENCY_BENCHMARK.md). Full Briefing
**435/435**, named Agent Runtime **428/428**, type/lint/format/build passed. User model preferences
were not changed. The idle preview backend was restarted to load the new prompts/schema.

## Real-only production workspace; sample UI retired (2026-09-10)

- Production no longer offers sample generation, its old result tab/renderer, sample archive,
  reset button or fixture source directory. Routine Manager leads to settings or real collection.
  The separate Calendar, latest-first History and saved-paper library continue using their
  existing approved backend endpoints. Empty histories stay empty; there is no synthetic fallback.
- `workspace-defaults.ts` supplies a single empty personal configuration scaffold, without
  example keywords, fixture subscriptions or a pre-created funding demo. Opening the app never
  collects sources, infers a location, enables Mail/Calendar or starts a model/scheduled run.
  Existing routine IDs, names, interests, schedules, user-origin bookmarks and `live`/assistant
  connection choices are preserved. Existing routines are not deleted merely for having one of
  the old default names: they may own real backend history or have been customized.
- Browser settings now write `gosu.briefing-lab.workspace.v2`. If absent, the loader reads the old
  `gosu.briefing-lab.fixture-workspace.v1`, removes only `mode: fixture` runs and `origin: fixture`
  subscriptions from the working copy, and writes v2 on the next normal settings/navigation save.
  The original v1 value remains untouched as a recovery copy. An explicitly empty v2 workspace
  wins over v1; corrupt/oversized storage is not overwritten. The rendered app also excludes
  explicit fixtures when a legacy embedding supplies the workspace directly.
- This migration does not read/write the encrypted backend history, paper archive, feedback,
  cache, memory, connection grants or user Mail/Calendar content. It does not identify samples
  by guessed title strings. All live source results remain in their existing backend store.
- Routine Copilot no longer lists or materializes fixture subscriptions. Its compatibility
  `list_briefing_sources` tool returns an empty catalog, and reviewed proposals must use
  `sourceIds: []`; actual source selection/permissions remain in Settings. The prompt and UI
  explain this boundary without calling the real connections unavailable. No automatic grants,
  collection or new tools are introduced. A previously retained sample-source proposal must be
  regenerated rather than being silently accepted as a real connection.
- Isolated test fixtures and the pure fixture engine remain for regression coverage, never as
  a production fallback. The old phase-one Electron visual-smoke script targets retired sample
  UI and was not used as evidence; current UI QA uses `workspace-visual.html` with mocked routes.
  Normal mock history stayed visible, the manager/settings had no sample controls, and
  `?workspace=empty` displayed the real empty state. No user source or paid inference was used.
- Final gates: full Briefing **432/432** (61 files, `--maxWorkers=2`), named Agent Runtime
  **177 Desktop + 248 Briefing = 425/425**, typecheck/lint/format/build passed. The production
  JS contains none of the removed sample titles/actions/catalog IDs. Assets:
  `index-DdihslK7.js`, `index-DMGItzBe.css`. The preview backend was restarted only after
  confirming its sole child was esbuild and no active external connection/LLM child existed;
  persistent settings/history were not reset. Ephemeral source receipts expire on restart.

## Rectangular multi-select paper tag picker (2026-09-10)

- The independent **논문 요약** library replaces its single-tag native select with a compact
  **태그** button and a square-cornered popover. Existing tags appear in a responsive checkbox
  grid, with per-tag saved-paper counts. Green fill, border and checked boxes identify selections;
  a selected-count badge and removable tag chips remain visible after the panel closes.
- Multiple selections use **OR within tags**, intersected with the existing text search and
  category filter. No selected tag means all tags. Alias normalization and canonical tag reuse
  remain unchanged, and the single-tag helper signature remains supported for existing callers.
  This is a local view filter, not interest feedback, a vocabulary edit or saved memory update.
- The panel searches existing tag labels/aliases, preserves choices hidden by its search,
  supports individual deselection and reset, and stays open during checkbox clicks. Escape
  and its close button return focus to the trigger; outside click/focus dismisses without
  clearing selections. Native checkboxes support Tab/Space. The grid has its own bounded scroll.
  Selection chips live outside the popover anchor so choosing a tag never shifts the panel.
- Filtering searches every loaded saved paper, then renders the first 30 matches; changing tags
  resets that page limit. The existing approved routine/library scope, original summary dates,
  force-refresh behavior and encrypted store are unchanged. Filtering never calls a source/LLM
  or sends interest feedback. The assistant's existing query-only retrieval behavior is unchanged.
- Focused **19/19**, full Briefing **427/427** (60 files, `--maxWorkers=2`), typecheck, lint,
  formatting and production build passed. The named Agent Runtime compatibility gate passed
  **177 Desktop + 247 Briefing = 424/424**, and maintenance documentation tests passed **2/2**.
  Synthetic browser QA verified multi-selection,
  keyword search without losing hidden choices, Space/Escape/focus, outside click and stable
  placement. A 31-tag fixture used a 240px scrolling grid; opening the AI sidebar reflowed it
  from three columns to two without overflow. No user source data or provider calls were used.
- Production assets: `index-DCycdbO1.js`, `index-DMGItzBe.css`; the running preview served
  the new files without a backend restart or resetting settings/history/source receipts.

## History collapse-all preserves AI summaries (2026-09-10)

- The top **모두 접기** action keeps every History **AI ASSISTANT SUMMARY** visible,
  including an already-open full-summary narrative. Weather, dated today/tomorrow agenda,
  email and paper sections collapse to clickable headers with plus/minus indicators.
  Nested email/paper disclosures also close; run dates and latest-first ordering remain.
- Weather and agenda now use the same native disclosure pattern as email/paper lists, with
  bottom collapse controls. Clicking a header reopens that section; clicking an AI summary
  card reveals its section and exact item, focuses it and scrolls only the reading pane.
  No source reread, LLM call, history deletion or server mutation occurs on these actions.
- A pane-scoped collapse event updates the mounted History feed's default for subsequently
  arriving records, so async history loads do not reopen everything after collapse-all.
  Existing individual reopen actions remain independent. This is view state, not a persisted
  global preference; live source collection, permissions and assistant chat are unchanged.
- Regression coverage protects the summary exception, native toggle synchronization, late
  history arrival and existing section navigation/bottom-close behavior. Full Briefing tests
  **423/423** (60 files, `--maxWorkers=2`), typecheck, lint, formatting and production build
  passed. Synthetic two-run browser QA confirmed eight closed section bodies, both summaries
  retained, weather header reopening and exact calendar/email/paper summary-card navigation.
  No user Mail/Calendar access or paid inference was used for validation.
- Production assets: `index-Ck-1xNvV.js`, `index-BNPvHddp.css`. This UI-only build does not
  require a preview backend restart or invalidate live source receipts.

## Google Scholar alert emails in paper briefings (2026-09-10)

- **Google Scholar 알림 메일의 논문도 포함** is on when the optional saved `scholarAlerts`
  choice is absent; an explicit false remains an opt-out. The arXiv checkbox is named separately.
  This interpretation does not rewrite profiles or grant Mail/body/private-AI access. It uses the
  one existing approved Mail collection only: selected account/mailbox, lookback, subject/sender,
  unread filter, message count and preview bounds remain unchanged. There is no second inbox scan.
  Consequently alerts outside that returned scope, or beyond its truncated preview, may be missed.
- `briefing-scholar-alerts.ts` recognizes sender/title hints, not authenticated Google delivery.
  It locally extracts arXiv, DOI and supported publisher links, including offline decoding of
  Scholar redirect targets. HTML anchor text and plaintext citation rows provide candidate titles.
  When Mail's visible rich text omits hrefs, recognizable title/author/year rows can still become
  separate linkless candidates. Arbitrary unresolved whole alerts remain email, not fake papers.
  Each candidate has a bounded per-entry excerpt; tracking/unsubscribe URLs are never requested.
  No publisher or Google page scraping, raw MIME/attachment access, or URL invention is introduced.
- Candidate IDs are stable across repeated alert deliveries. Mail receipt times are not labelled
  as paper publication dates, and per-mail account/Message-ID/tracker metadata is not copied into
  each paper's science input. Selected arXiv version URLs are retained; duplicate canonical arXiv
  IDs prefer the already-collected public record. DOI/link/citation identities deduplicate repeated
  alert entries. The existing exact-input/version and private-scope cache rules continue to decide
  reuse; changed excerpts are not automatically claimed identical to a previously read full paper.
- Identified candidates join the papers section and existing automatic paper-summary/tag pipeline.
  Original alert emails remain available in the email section. Even if arXiv search fails, candidates
  from successfully read alerts remain available; the arXiv error is retained instead of claiming
  recovery of that source. Scholar-only candidates always carry `privateOrigin: mail` and require
  the existing private-AI permission. Final Mail grant/profile checks suppress late private results
  after revocation. A default-enabled checkbox cannot bypass those boundaries.
- `discoverySource: google-scholar-alert` is preserved in encrypted history and shown as
  **Google Scholar 알림** in live/history/library paper rows. New optional metadata keeps old
  records readable. If arXiv HTML enrichment fails, a Scholar candidate stays an alert excerpt;
  it is not incorrectly relabelled as a fetched abstract. Publisher/linkless entries are summarized
  only from the provided alert excerpt, with limitations, not a claim of reading the full paper.
- Tests use synthetic plaintext/HTML alerts, mock Mail/HTTP/model boundaries and temporary encrypted
  stores. Coverage includes multiple entries, absent links, stable repeated identities, trackers,
  origin persistence, public arXiv deduplication, explicit opt-out, body-preview/private-AI gates,
  late grant revocation and default UI state. Actual user Scholar emails/provider generation were
  not exercised; the parser does not promise every possible mail layout or complete mailbox coverage.
- Final gates: focused **24/24**, full Briefing **421/421** (60 files, `--maxWorkers=2`), named
  Agent Runtime **177 Desktop + 243 Briefing = 420/420**, typecheck/lint/format/build and maintenance
  tests **2/2** passed. Synthetic UI QA confirmed the Scholar source label in the paper library.
  Production assets: `index-CkqEdfb-.js`, `index-BNPvHddp.css`. The idle preview was restarted
  after checking its child process and connections. User Mail/settings/history were not reset;
  old ephemeral receipts expire normally. One read-only process check needed a retry after the
  automatic approval review timed out; it did not indicate a source or application failure.

## Controlled reusable paper tags (2026-09-10)

- Paper `keywords` are no longer promoted wholesale into the visible tag list. Optional host-owned
  `tags` metadata contains at most three short labels. Original keywords, summary/template text,
  equations, figures and generation dates remain unchanged and searchable. Library/history reads
  project legacy keywords into curated tags locally; this does not invoke arXiv/LLM or destructively
  rewrite old keyword evidence. New saves persist the curated tags in encrypted history/archive.
- `paper-tags.ts` normalizes Unicode, case, separators and selected plural forms and merges a
  conservative equivalence table (e.g. LLM/LLMs/대규모 언어 모델, diffusion-model variants).
  It never merges merely by substring/word overlap: supervised vs self-supervised and Bayesian vs
  frequentist remain different. Ambiguous ML is not automatically mapped to machine learning.
  Generic filler and long descriptive phrases remain searchable keywords, not new visible tags.
- The reusable vocabulary is derived from saved, version-deduplicated paper metadata in the
  approved routine, not a global cross-project dictionary. Existing labels are preferred and more
  frequently used matching tags come first. Each new summary may introduce at most one unmatched
  label, three tags total. A serialized save rechecks the current vocabulary, including legacy
  records, so overlapping summary batches reuse already committed labels. The catalog matcher
  caches normalized keys, and invalidates that index when a batch appends a label.
- The normal summary prompt receives up to 128 existing labels with bounded aliases and explicitly
  instructs semantic comparison/reuse, no quota filling, and a new durable topic only when an
  existing tag cannot represent it. `keywords` remains the native output field; the host generates
  `tags`. `BriefingGenerationSchema` omits host-owned tags before requiring all native properties,
  preserving provider-compatible strict output and legacy readers. There is no additional tagging
  inference call. Beyond known/surface aliases, semantic appropriateness remains model-guided,
  not a guarantee that every possible synonym is perfectly merged or every new label is correct.
- Public tag projections never use private-only vocabulary; inference may include private tags only
  under the existing private-AI/confirmation boundary, and resulting memory/history retains private
  taint. Other routines are excluded. Catalog text is untrusted metadata, not permissions/instructions.
  Tag cleanup does not invalidate scientific-summary caches or recompute historical priorities.
- Displayed tags, library filters and saved-paper assistant retrieval use the same normalization.
  Original keywords and known aliases remain searchable, including mixed queries like LLM plus
  another topic. Feedback saves use curated tags; existing paper-feedback aggregation groups known
  aliases and counts a concept once per vote without rewriting the original vote or its keyword data.
  Emails do not receive paper tags. No manual tag editor, vector index or cross-GOSU global catalog
  is implemented by this change.
- Synthetic `?tags=aliases` UI QA showed multiple English/Korean spellings consolidated into three
  standard labels, with two matching papers still found via LLM. Original dates stayed visible and
  viewing/filtering did not fetch sources or run inference. User source content was not copied into
  fixtures/docs, and no user mail or paid provider was used for validation.
- Final gates: focused **37/37**, full Briefing **411/411** (59 files, `--maxWorkers=2`), named
  Agent Runtime **177 Desktop + 230 Briefing = 407/407**, typecheck/lint/format/build and maintenance
  tests **2/2** passed. Production assets: `index-Bpm_AeTi.js`, `index-DEalj1lz.css`.
  The idle preview was restarted after checking its children/connections. Existing stored data
  were not reset; old ephemeral receipts expire normally. Curated legacy metadata appears on
  subsequent reads, while the original saved keyword arrays remain available for audit/search.

## Distinct original-Mail navigation icon (2026-09-10)

- Apple Mail opening now uses an **external-window arrow**, not another envelope. Its muted blue
  stroke and light-blue background distinguish navigation from the green envelope/check used for
  mark-read. Hover/focus also use the blue palette. The 20px glyph and 26px hit area are unchanged;
  removing the old negative top margin aligns the two controls without disturbing their nowrap group.
- The original Mail tooltip, disabled/pending behavior, source target, POST endpoint and native
  opener are unchanged. No Mail launch or mark-read action is required for this visual correction.
- A regression first failed against the envelope icon and verifies the new shape and scoped blue
  style. Synthetic browser QA checked the two icons side-by-side, confirming distinct colors and
  both SVGs fully inside their buttons. Real Mail was not opened or modified.
- Verification: focused **39/39**, full Briefing **402/402** (57 files, `--maxWorkers=2`),
  typecheck/lint/format/build and maintenance tests **2/2** passed. Production assets:
  `index-CcEGUiIb.js`, `index-DEalj1lz.css`; the preview served them without restarting its backend.

## Clear unread badge after explicit conversion (2026-09-10)

- Clicking mark-read now immediately replaces that control's unread badge with a disabled pending
  spinner, not a premature success claim. Its tooltip says **읽음 처리 중…**. Reduced-motion
  users get a static pending indicator. Failure restores unread and the action with the existing
  error; unknown native completion is never treated as confirmed.
- On acknowledged success the unread/read badge and conversion button disappear, leaving only
  a screen-reader completion status (and any persistence warning). The existing mounted-copy
  notification updates other instances of that same scoped mail identity. A stored
  `mailMarkedReadAt` also suppresses the badge when history is loaded again. Ordinary fresh
  read/unread observations without this action timestamp keep their existing display semantics.
- This only changes the UI transition: no native Mail, permission, source-identity or storage
  behavior changed. Tests first reproduced pending unread remaining and a visible read badge after
  success. Focused **26/26**, full Briefing **401/401** (57 files, `--maxWorkers=2`), typecheck and
  lint passed. Synthetic browser QA confirmed zero unread badges, read badges and conversion
  buttons in the clicked email row after success; no actual user mail was changed.
- Formatting/build and maintenance tests **2/2** passed. Production assets:
  `index-DWK2FOlX.js`, `index-CMcCqDWa.css`; the existing preview served them without a restart.

## Mark-read icon alignment repair (2026-09-10)

- Reproduced the user's screenshot geometry with synthetic titles. The broad selector
  `.briefing-insight-card details button` overrode the icon class with **6px 10px padding**.
  Its fixed 25px box therefore placed the 18px SVG 4px beyond the right border. The state wrapper's
  `flex-wrap: wrap` independently allowed the badge and mark-read action to split across lines.
- A narrowly scoped child selector now overrides that inherited padding: fixed nonshrinking
  25px border-box, zero padding/margin, centered inline-flex and block SVG. Badge and action stay
  in a single nonshrinking group; the title row may wrap as a whole on small screens. The tooltip
  grows left from the button's right edge so a trailing action no longer clips its text.
- The regression fails against the previous CSS. The existing workspace fixture accepts
  `?mail-layout=long` for synthetic long mixed-language email subjects. Browser measurements
  confirmed zero horizontal/vertical SVG center offset, icon fully inside its button, and at 400px
  width an unbroken badge/action row, tooltip inside its card and no page overflow. The temporary
  viewport override was reset. No mark-read action or real mailbox operation was invoked for QA.
- This is a CSS-only behavior correction; native marking, consent, timestamps, summaries and
  600ms hover tooltip timing are unchanged. No backend restart or data migration is needed.
- Verification: focused **37/37**, full Briefing **400/400** (57 files), typecheck/lint/format/build
  and maintenance-document tests **2/2** passed. One parallel full run hit the existing 5s timeout
  in the 603-record storage test; the entire suite then passed with `--maxWorkers=2`, without
  skipped tests or a changed timeout. Production assets: `index-lhSmcQWG.js`, `index-DxTyKBZ_.css`;
  the existing preview served the new static build without a backend restart.

## Bottom collapse controls (2026-09-10)

- Expanded email and paper details end with **이메일 요약 접기** / **논문 요약 접기**.
  Shared disclosure components cover live results, continuous history and the paper library.
  Email/paper category lists also have **목록 접기** at their bottom in live/history views.
- `BriefingBottomCollapse` closes only its nearest native disclosure, keeps its contents mounted,
  synchronizes toggle state and focuses that disclosure's visible title. It returns the main reading
  pane to the title with an immediate, scoped scroll; it does not scroll the page/sidebar or collapse
  parents, siblings or other runs. Buttons do not submit forms or trigger Mail/feedback/source work.
- Both missing footer regressions failed before implementation. Focused **39/39**, full Briefing
  **399/399** (57 files), typecheck and lint passed. Synthetic browser QA confirmed bottom placement,
  email/paper collapse, unchanged parent expansion and focus/scroll restoration (title ~12px below
  the main pane top). Original data, summaries, read status and provider work are unchanged.
- Formatting, production build and maintenance-document tests (**2/2**) also passed. Production
  assets: `index-Dr4AGf0I.js`, `index-CLy00huA.css`; the preview served the updated static build
  without restarting its backend or expiring source receipts.

## Explicit mark-as-read icon (2026-09-10)

- Live/history unread email badges now have a separate envelope-check icon when an original
  message URI and source target are available. The 25px button contains SVG only. Its **읽음으로
  변환** tooltip appears after 600ms hover; keyboard focus exposes it immediately. The click stops
  disclosure propagation, locks repeat submissions and retains unread until a verified response.
  Failure stays visible; uncertain native completion does not falsely claim nothing changed.
- POST `/mail/mark-read` accepts only routine/item plus exactly one receipt or history ID, reusing
  the strict target contract. It requires the currently owned, approved Mail-read scope (not private
  AI permission). Ask-every-time policy retains native confirmation. The server resolves its own
  canonical Message-ID, selected account/mailbox and checks cancellation/profile/target again
  before mutation. Non-mail, foreign, expired, missing, moved or changed targets fail closed.
  Concurrent writes to the same routine/item are locked. This is a user-click action, not an
  assistant tool or a new blanket write permission; the existing Mail reader remains read-only.
- `briefing-mail-mark-read.ts` has a fixed argv-only native program. First it locates RFC IDs in
  exactly one selected mailbox (bounded response, bare/bracketed forms). The host checks native
  account/path/message-ID SHA-256 against the saved item ID before allowing the second call.
  That call resolves the exact native ID, rechecks its RFC ID, sets only `readStatus = true`, then
  reads the flag back. Already-read messages are idempotent. No opening, sending, moving, deletion,
  content/attachment reads, new LLM calls or automatic retries are involved. Each native call has
  a 15-second deadline and bounded stdout/stderr; unknown completion tells the user to check Mail.
  Cancellation/revocation cannot undo an OS mutation already delivered to Mail.
- Acknowledged actions set optional `mailMarkedReadAt` on matching in-memory receipts and encrypted
  history entries, retaining the original `mailUnread` snapshot and summary content. Existing
  files without it remain readable. History-save failure returns actual read success with a visible
  persistence warning. Mounted copies receive the confirmed display update; new collections use
  fresh native observations instead of a sticky global UI override. Stored action timestamps are
  not continuous mailbox synchronization and do not change existing summary cache identity.
- The installed Mail scripting dictionary confirms writable **read status** and read-only
  **message id**. Native logic was exercised with synthetic Mail objects and mocked subprocesses,
  not by modifying user mail. Browser fixture QA verified icon-only content, tooltip layout,
  successful badge change and no accidental expansion; no console errors. Actual account/native
  write success remains unverified until a user deliberately activates the control. Existing OS
  Automation permission prompts are not bypassed or guaranteed absent.
- Verification: focused **44/44**, full Briefing **394/394** (56 files), named Agent Runtime
  **177 Desktop + 219 Briefing = 396/396**, typecheck/lint/format/build passed. The named gate
  includes native mark-read and UI regressions. Tests cover strict target requests, owned live and
  historical sources, permission denial, expired receipts, uncertain completion, exact native-ID
  matching, RFC-ID recheck, idempotent writes, subprocess timeout and mounted-copy UI updates.
  Production assets: `index-BgnAkI_R.js`, `index-BhrJyH0Q.css`. The idle preview was restarted
  after checking its children/connections; saved settings, summaries and original mail were not
  changed for deployment. Old ephemeral receipts expire on restart; saved history remains usable.

## Collapsible source blocks and priority summary cards (2026-09-10 follow-up)

- The continuous history feed retains its dates and all previous runs, but email/paper lists now
  live inside independent native disclosure blocks. Headers show counts and a visible minus/plus
  affordance. They start expanded; users can collapse a whole category without touching its stored
  content. The global **모두 접기** control closes these blocks and item details without remounting.
- Each live/saved run has **논문 바로 보기** and **이메일 바로 보기** shortcuts. A section jump
  opens its target block, focuses it and scrolls only the main reading pane. Other sections/runs
  stay as they were. Summary-card jumps additionally open the selected item. IDs include the run
  and source kind, so repeated source IDs across archived runs cannot select the wrong copy.
- History now renders `AI ASSISTANT SUMMARY` as compact actionable cards, reusing the live
  `SummaryHighlight` presentation. Up to three email and three paper highlights are selected per
  run and jointly ordered by their recorded importance (high, medium, uncertain, low); their detailed
  lists use the same ordering. This is a display-time ordering, not another AI importance decision.
  Mail cards retain receiving account/time and action; paper cards show the saved short summary.
  Calendar highlights have no invented importance score and are shown separately in time order
  (up to two in history). The full original overview remains under **전체 요약 문장 보기**.
  Live mail/paper cards now share the cross-category importance ordering and paper summary body.
- No source retrieval, model calls, cache invalidation, history/schema changes, or provider/runtime
  permission changes are performed by this UI correction. Original summaries, equations, figures,
  feedback choices, dated today/tomorrow sections and non-pruning history remain intact.
- Regression tests first failed for the missing history blocks/cards. Final focused coverage
  **25/25** and full Briefing **385/385** (54 files), typecheck and lint passed. Browser QA on the
  synthetic fixture verified card density, email category collapse, global collapse, and opening only
  the first run's paper section through its shortcut. Tests retain exact source-target assertions
  and verify high-priority papers precede low-priority mail. No user/private data or paid model was used.
- Package formatting and production build also passed; maintenance-document tests **2/2**.
  Production assets: `index-BdULLAO7.js`, `index-BOBSSrS9.css`. The existing preview served the
  updated static assets without restart, keeping source receipts and in-flight jobs intact.

## Dated agenda and non-pruning briefing history (2026-09-10 follow-up)

This section supersedes the earlier 60-run/600-record retention descriptions below.

- Every live and saved briefing starts with its year, date and creation time. The shared
  `BriefingAgendaDays` renders **오늘 일정 (date)** and **내일 일정 (date)**, including empty
  successful days. Loading/failure is not reported as an empty day. Historical labels use the
  stored agenda reference date, falling back to that briefing's collection date for legacy records;
  they never drift to the wall-clock date when reopened. The server returns and stores its agenda
  range start as `calendarReferenceAt`. Day boundaries use the routine timezone and calendar-day
  arithmetic, including year rollover and DST. Overlapping multi-day events appear on both days;
  exclusive midnight end times do not create a false next-day event or duplicate DOM target ID.
- The new-briefing screen includes the previous saved feed below the current briefing. It excludes
  the currently displayed receipt/run to avoid duplicating that run. Refreshing saved history keeps
  already-loaded records visible; changing routine scope still clears them. The old **화면 결과
  지우기** control was removed. New collections and completed batches refresh the previous feed.
- `appendHistory` no longer evicts runs, records, or old figure bytes to accept a new briefing.
  Existing same-run/batch replacement remains for completing or explicitly refreshing that batch;
  a new collection has a different run ID and does not replace an earlier run. This does not restore
  records pruned by older builds. The encrypted file retains its 32 MB safety limit and a 10,000
  record validation limit: a full store rejects the new save visibly and preserves the old file,
  rather than silently deleting history. Paper archive limits remain separate; storage is not
  unlimited and no new disk files or personal data were migrated during synthetic QA.
- `/history/list` accepts a bounded record offset and returns `nextOffset`. The continuous UI
  retrieves successive 600-record pages without requiring an extra user click, deduplicating IDs
  and rejecting invalid/repeating cursors. The exact-record AI history reader uses archive-aware
  lookup so an older retained record is not mistaken for missing solely due to a 600-record page.
  Existing private-history consent remains; cancellation and profile changes are checked before
  returning a page. Viewing history does not query sources or generate new summaries.
- Regression tests reproduced the old 61st-run eviction and missing dated headings before the fix.
  Coverage adds 603-record paging, encrypted restart, refresh without blanking prior records,
  live-new-briefing retention, historical dates, year/DST rollover and multi-day boundaries.
  UI QA uses only the isolated synthetic fixture; real mail, calendar and model calls are not used.
- Final verification: focused **20/20**, full Briefing **383/383** (54 files), named Agent Runtime
  **177 Desktop + 210 Briefing = 387/387**, typecheck/lint/format/build passed. Browser QA confirmed
  dated today/tomorrow sections and two older runs remaining after a synthetic new collection;
  no console errors. Production assets: `index-G8cA_2n1.js`, `index-CV25mFLe.css`.
  The idle standalone preview was restarted after confirming no active inference child or outbound
  connection. Stored settings/history were not deleted; ephemeral receipts expire on restart.

## Independent paper library and shared retrieval boundary (2026-09-10)

- The left navigation is now **Calendar → 개인 연구 브리핑 → 논문 요약**, including the
  collapsed icon rail. Saved-paper banners/lists are no longer mounted above live briefings.
  The ordinary newest-first briefing feed still includes the papers belonging to each run.
- The independent library uses the selected routine (an explicit selector when several exist).
  Title, URL, keyword and all five saved summary sections are searchable locally with normalized,
  case-insensitive AND terms. The initial title/keyword category rules were replaced by the
  fixed-taxonomy saved-summary classifier below. Tags retain their separate controlled vocabulary;
  category edits do not mint tags. Neither is a claim of scientifically verified categories.
  No manual-tag editor or vector search is provided.
  All retained matches are searchable; rendering starts with 30 and expands via **논문 더 보기**.
  Existing feedback, original summary dates, force-refresh icons, disclosures, math and images remain.
- `BriefingWorkspaceStore.paperArchive` separates paper retention from the 60-run history feed.
  Existing encrypted v1 files default this field to empty and remain readable; retained papers
  are unioned on read and copied into the archive before the next history-pruning write. It cannot
  recover records already pruned by an older build. Archive identity includes routine and exact
  arXiv version (legacy fallback is item ID + URL). Latest snapshots replace that same identity.
  Limit: 1,000 paper snapshots across the workspace, plus the existing 32 MB sealed-file limit;
  capacity failures are surfaced rather than silently deleting paper text. Archived image bytes
  have a separate 3-million-character budget; captions/links remain after byte eviction.
  Paper cache lookup, explicit refresh and feedback resolve archived records after feed expiry.
  New files retain AES-GCM/Keychain/atomic-write boundaries; older strict-schema executables are
  not supported readers after the archive field is written. No user storage was reset for QA.
- `briefing-knowledge.ts` supplies the same owner/routine/private-scope/revocation-checked library
  to the UI and assistant. Ask-every-time policy never silently includes private archived papers.
  `search_saved_papers` returns bounded matches; `read_saved_paper` returns the exact selected
  stored five-section summary, equations and figure captions/links, not image base64 to a model.
  Search/read never contacts arXiv or starts another summary generation. Answering in chat still
  consumes the selected assistant model's normal inference usage. The model must identify old
  summaries as historical AI interpretations, not fresh source evidence.
- `read_briefing_history` complements history search with a complete saved record's overview,
  up to 15 item summaries/actions and weather/agenda snapshot. Related analysis records carry
  `runId`; this is not a claim that one batch is an entire run. Live schedules still use the
  approved `read_calendar` operation. Calendar creation proposals remain reviewed, never silent
  writes, and historical agenda snapshots never grant event-management permission.
- **Future GOSU integration, not installed integration:** exported `BRIEFING_KNOWLEDGE_TOOLS`,
  the host-injected workspace store and source operations define reusable tool boundaries. A GOSU
  host must establish trusted ownership and explicit cross-routine/private-source grants, register
  these tools for each supported chat adapter, and route mutations through reviewed Calendar
  actions. Do not hand every chat a browser capability, filesystem/keychain access, or unconditional
  permission. Desktop Project Chat/Model Lab and `/Applications/GOSU.app` were not changed or
  connected by this standalone update. Global chat access and chat-driven edit/delete remain
  integration work; do not describe them as currently available.
- Verification uses synthetic encrypted stores and the isolated workspace fixture, not user mail,
  calendars, saved research keywords or paid inference. Regression coverage includes navigation,
  local search, archive survival after 61 runs/restart, feedback after expiry, zero-fetch cache reuse,
  saved-paper detail tools, private filtering and revocation, and complete briefing-record reads.
  Browser QA confirmed keyword/tag filtering, the five-section disclosure and rendered math with
  no console errors. Final gates: Briefing **379/379** (54 files), named Agent Runtime
  **177 Desktop + 209 Briefing = 386/386**, typecheck, lint, package formatting and production
  build passed; maintenance-document tests **2/2**. The first sandboxed full run could not bind
  localhost/Unix sockets; the unsandboxed rerun passed without skips. Two memory tests were
  updated to mock the new archive-aware lookup, retaining their original failure/injection assertions.
  Production assets: `index-NcNaeObZ.js`, `index-9PCvPZ9L.css`. The already-running preview was
  started after the backend edits and served those assets; it was not interrupted or restarted.

## Saved-summary paper classification (2026-09-10)

- Implemented: one primary field from the ten-category version-1 taxonomy in
  `src/paper-classification.ts`. It covers generative/LLM, vision, agents/RL, statistics/optimization,
  learning, systems, mathematics, science/medicine applications, human/social/policy and other.
  Legacy papers without a saved classification are **분류 대기**, not automatically **기타 연구**.
  `other` requires an explanation that no category fits or the saved evidence is insufficient.
- `paper-classification.ts` reuses the GOSU native structured-job engine and the selected model/
  reasoning, with no tools or source reads. It sends only the stored title, summary, five scientific
  sections, supplemental analysis, keywords and read scope as untrusted historical AI interpretations.
  Private preference/action fields, figures and original mail bodies are excluded. Long saved text
  is bounded and truncation is recorded; the digest covers the full untruncated classification input.
  Output must use the fixed category enum and exactly the supplied ephemeral IDs. Invalid output
  fails without a hidden retry or provider switch; the existing summary remains available.
- The production service classifies only newly generated, successfully saved Briefing paper
  summaries in batches of at most six. Cached-only summary reuse and library rendering/searching
  never start classification inference. An optional classification failure does not invalidate the
  successful summary. Chat analyses shared from GOSU/Model Lab are not silently classified at save;
  they can be classified explicitly in the library under the selected routine's AI permission.
- **분류 대기 논문 AI 분류** handles unclassified/stale items in the current filtered list;
  **다시 AI 분류** explicitly reruns non-user categories. Both use stored summaries, never arXiv.
  Sequential batches persist independently; **분류 중단** aborts the active request and keeps prior
  completed batches. Classification itself consumes selected-provider AI usage. Browsing its stored
  result consumes no further inference. No bulk classification of the user's real library was run
  during implementation; use the button in the owning browser to start it.
- Each library card has a compact category badge and **분류 수정** using only the same fixed list.
  A user edit requires no inference, is marked **사용자 지정 · 저장됨**, and is never overwritten by
  automatic or explicit bulk AI reclassification. Reason/date are available on the badge; changed
  saved text shows a stale indicator. The ordinary summary date, provenance, contents, tags and
  source-refresh control are not rewritten by category edits.
- `BriefingWorkspaceStore.paperClassifications` is separate metadata inside the existing encrypted
  version-1 workspace, defaulting to empty for older files. Limit: 10,000 records and the existing
  sealed-file byte limit; no silent eviction. Keys include routine, public/private scope and exact
  versioned paper identity, or immutable shared-analysis ID for explicitly shared records. Values
  store category/source/reason, taxonomy version, full summary digest, timestamp, revision and
  actual invocation metadata for AI results. Shared encrypted originals remain immutable.
  Do not run older strict-schema executables against workspace files written with this new field.
- `/papers/classify` and `/papers/classification/edit` accept only owned-library keys/revisions,
  never arbitrary client-supplied paper text. Recheck owner/settings/private-AI scope before inference
  and before commit. Shared chat text is conservatively private for inference; ask policy retains
  native confirmation. Routine-private library filtering remains unchanged. Serialized revision and
  digest checks prevent late AI output from overwriting manual corrections or changed summaries.
  Classification metadata is projected into the existing saved-paper search/read tools, not exposed
  as a new agent mutation capability or an unconditional global GOSU grant.
- Verification uses synthetic summaries, fake provider responses and the isolated browser fixture.
  Real-source classification accuracy/provider inference and a real-library migration have not been
  live-verified. Tests cover persistent reuse, fresh-only automatic invocation, cache-only zero calls,
  no arXiv reads, manual pinning, concurrent changes, ownership/private scope, cancellation, bounded
  inputs, fixed output schema and UI edits/batching. Final gates: Briefing **523/523** (76 files),
  named Agent Runtime **179 Desktop + 341 Briefing + 1 Model Lab = 521/521**, typecheck, lint,
  package formatting check and production build passed. Browser QA confirmed AI classification,
  manual edits surviving reclassification, category filtering and no console errors. Production
  assets: `index-DiaYwy2o.js`, `index-C-VyolYY.css`. The idle standalone Preview was restarted
  after confirming no active connection or inference child; the new assets were verified on port 4318. Settings/history were not deleted; ephemeral receipts expire on restart. Maintenance-doc
  tests **2/2** passed. Real-data inference was not performed.

## User flow

**Title-bar model selection (2026-09-09):** open the model button beside **BRIEFING AI** to choose
engine, model and reasoning, then **적용**. Choices come from the existing GOSU provider catalogs,
not another hardcoded list. The saved routine selection is used by subsequent chat and automatic
summary requests; selecting a model alone never invokes inference or regenerates cached summaries.

1. **루틴 설정**: retain the saved weather city, research keywords and mailbox filters. Configure
   **AI 비서 · 자동 요약 · Calendar** and save. Codex/Claude models and reasoning come from the
   same native adapters/catalog used by GOSU; explicit choices never silently fall back to another provider.
2. **논문 자동 AI 요약** defaults on. After **지금 실제 자료 조회**, results are processed in
   separate sequential batches of six. The execution order is **email first, then papers**: email is
   shorter and actionable, so its validated reply/deadline highlights can appear in the top briefing
   before the slower paper work begins. Email batches require both saved mail-read and private-AI
   permission. Sources and completed summaries remain visible while later batches run. The top
   assistant card reports a determinate percent, completed/total count, active range and current
   operation (for example, `50% · 이메일 1/2 · 요약 완료`). Elapsed time, resolved provider/model
   and memory warnings are also shown. Retry/cancel are explicit; failed inference is not silently
   repeated or switched to an API-key provider.
3. **메일 읽기** authorizes the selected account/mailbox/lookback/count/body-preview scope.
   **메일·일정·이 루틴의 비공개 memory를 LLM에 전달** separately authorizes private AI use.
   Save confirms initial/wider privileges once for this browser and routine, not every read/summary.
   Turning settings off stops new access and rejects late private results/commits; it cannot retract
   data already delivered to a provider. OS Mail/Calendar/Keychain permission prompts are separate.
   Deleting a routine first deactivates its persistent read/AI permissions; existing history remains.
4. **AI 비서** opens a resizable right sidebar. It can search public papers, the approved recent
   mailbox scope, saved briefing summaries, and selected calendars. It is not limited to routine
   creation. **AI로 새 루틴** retains the separate reviewed routine-proposal workflow.
5. **Apple Calendar 연결 / 목록 새로고침** requests macOS access and retrieves calendar metadata.
   Select calendars, enable Calendar reading and save settings. **Calendar** supports month/week/day,
   date navigation, current-range title/location search, selection and event details. Today/tomorrow
   agenda appears in the live briefing. No calendar is silently selected or granted by an LLM.
   The full Calendar view is an independent session opened from the **Calendar** icon above
   the parallel personal/research briefing icon in the left sidebar; it is not another source section inside
   the research briefing. The live briefing still imports its agenda highlights, and the AI assistant
   retains calendar read/proposal access.
6. New events, edits, drag/resize changes and deletions go through a reviewed draft. Drag/resize is
   immediately reverted in the calendar until approved. The immutable action is applied only after
   the user's save confirmation and a native confirmation inside the EventKit helper itself.
   Recurring events affect **this occurrence only**. Invitations with attendees, read-only calendars
   and records with truncated long content cannot be edited here. Series-rule/attendee management
   stays in Apple Calendar. Existing alarms are preserved unless the user changes their selection.
7. Chat can recommend events from email when asked, with source IDs and evidence. Missing dates are
   not guessed into saved events: the proposal requires clarification. Event proposals are not writes.
   Future Kanban/project-to-do proposals export `gosu.briefing.task-proposal.v1` JSON; they explicitly
   say **not yet created in GOSU**. No direct database adapter is implemented in this prototype.
8. **개인 연구 브리핑** opens a continuous, newest-first History feed, not a list of collapsed
   disclosures. Each run shows its overview, stored full hourly weather chart, recorded agenda,
   compact email summary rows and paper title/keyword/feedback rows; clicking an item expands its
   template/math. Related analysis batches share a collection
   `runId`; the archive retains 60 runs (up to 600 bounded records) across the local workspace. They
   are previous AI interpretations, not independent/current evidence. Chat uses at most six recent
   conversation messages and read tools for additional history; UI conversation resets on routine
   or saved-settings change to avoid resending old private context after revocation.
   Briefing AI chat uses the same GOSU native Codex/Claude adapters and structured turn boundary as
   GOSU Project Chat. Its message header, Markdown/math rendering, model/reasoning provenance and
   in-turn thinking indicator follow the GOSU chat format. Its tools remain Briefing-scoped: papers,
   approved mail, saved briefing history and Calendar; repository/shell/project tools are not
   inherited accidentally.

## Source-specific reading UX (2026-09-09 follow-up)

- Live paper summaries use `PaperBriefingDisclosure`: collapsed by default, showing
  only title, up to six core keywords and research reading priority. The title/chevron toggles the
  row; the original source link is inside the expanded detail. Long titles wrap to two lines in the
  list and remain complete in the expanded heading. Native disclosure supports keyboard activation.
  Expanding never invokes another LLM or creates memory entries. History now uses the same compact
  paper disclosure, while run overviews, weather and email summaries remain in the scroll feed.
- New paper generations include a short summary plus the required five-section template fields:
  `researchQuestion`, `strengths`, `limitations`, `methodsAndAssumptions`, and `reportedResults`.
  Each field is source-grounded Markdown and explicitly states when the available abstract/excerpt
  is insufficient. `detail` remains a bounded supplemental explanation. Inline `$...$` and block
  `$$...$$` math are rendered with KaTeX; up to four selected equations remain exact source LaTeX
  in separate vertical blocks. Up to two caption-selected figures are displayed from validated
  same-paper raster assets. Unknown, duplicate, missing or unselected equation/figure references,
  and a missing paper-template section, fail validation and use the same single correction policy.
  Do not invent formulas or figures when only an abstract is available.
- The provider and host both enforce `BriefingGenerationSchema` for fresh results. The older
  `BriefingInsightSchema` remains a backward-compatible reader. Optional richer history fields keep
  existing encrypted files readable without rewriting old summaries or sending them to a provider.
  Old keyword-less entries show missing/search-keyword information honestly; collect/summarize again
  to generate the new detailed analysis. Existing priorities are not silently recomputed.
- `item.kind` is explicit in the prompt. Paper priority is relative to research interests/project
  context. **Email importance is based on replies, deadlines, schedule changes and practical
  consequences**, not research similarity. Email-only summaries omit the research profile, project
  memories and routine-interest memory. Email relevance/detail/math/keyword fields are normalized
  empty, including the renderer's handling of legacy research-relevance fields. The general chat
  prompt uses the same source distinction. Scholar-derived items classified as papers keep paper
  analysis; the private-email permission boundary remains unchanged.
- Email memory stores importance and next action instead of an artificial research-connection
  sentence. Detailed paper prose and exact selected equations are kept in encrypted history, while
  working memory remains compact. No expanded-detail text is automatically inflated into the next
  prompt. Source quotes, private taint, consent/revocation and bounded inputs remain enforced.
- **중요함 / 관심 없음** is a persistent preference correction, not a claim about the source. The
  encrypted backend stores the decision with source kind, title, bounded AI-summary keywords, URL and
  timestamp; public-paper feedback is not marked private, while email feedback keeps the mail taint.
  The next analysis receives only a bounded aggregate profile (preferred/avoided keywords and
  paper/email direction scores) alongside evidence, so feedback can tune priority without inventing
  facts or hiding a strongly matching source. Cards show star/blocked icons and `aria-pressed` state;
  the memory panel shows aggregate important/not-interested counts and permits correction/deletion.
- AI/private request confirmation defaults to **항상 허용 · 설정한 범위** after the reviewed routine
  scope is saved. Users can choose **매번 확인** in settings; automatic jobs stop with an actionable
  message instead of opening an unattended native dialog. macOS OS permissions, Mail scope changes,
  Calendar writes and routine-scope expansion remain separate confirmations.
- Apple Mail status distinguishes the selected account/mailbox and approved saved scope from the
  short-lived in-process read grant. **메일 설정 저장됨 · 조회 시 자동 연결** means the scope is
  valid and the next permitted collection will restore the grant; it is not falsely shown as an
  active read session. Mail reading permission and LLM-transmission permission are shown separately.
- Regression files: `briefing-analysis.test.ts`, `src/briefing-insight-card.test.tsx`,
  `briefing-memory-store.test.ts`, `briefing-workspace-store.test.ts`, `briefing-assistant.test.ts`.
  Five focused tests reproduced the old behavior before the change. Actual GPT-6-Astra/medium
  inference on a synthetic paper/email pair returned four keywords, detailed paper explanation,
  three source-backed equations and a practical email reply deadline with empty research relevance.
  No personal mail was read. The opt-in smoke is `tools/source-specific-summary-live-smoke.ts`.
  Browser QA confirmed initially closed rows (~74px each at desktop width), expansion, source links,
  vertical equations and zero page overflow. Screenshots use labelled synthetic data:
  `tmp/screenshots/briefing-papers-collapsed.png`, `tmp/screenshots/briefing-paper-equations.png`.
  Final reading-UX gates: Briefing **172/172**, named Agent Runtime **177 Desktop + 94 Briefing =
  271/271**; full `pnpm check` passed (format, contracts, lint, typecheck, workspace tests, build).
  At 420px viewport width, all collapsed rows and the page had zero horizontal overflow.

## Top assistant summary and processing order

After a real collection, the main column starts with **오늘 먼저 확인할 내용**. This is a compact
assistant opinion card, not a second source archive. It combines validated email importance/action
and explicit reply deadlines with up to three selected Calendar highlights and three analyzed-paper
title/priority/keyword boxes. It never invents a schedule, email or paper. While analysis runs,
the same card contains an accessible progress bar; the
percentage is based on bounded item counts, not a token-time estimate. The underlying native LLM
stage appears as a short operation label, while private prompts and internal reasoning remain hidden.

The display order below still follows the routine's saved order (default: weather, email, papers),
but analysis order is independent and always email → papers. Email cards focus on practical action,
deadline and consequence. Paper cards stay compact until expanded; their five-section detail, source
LaTeX and selected figures are not repeated in the top summary. Saved older histories remain
readable; missing template fields show an explicit unavailable-evidence message rather than being
silently reconstructed.

Automatic summaries run as backend-owned jobs. Switching between Briefing, Calendar, Settings or
another GOSU project only aborts the browser's polling request; it does not cancel the job. Reopening
the live view starts a harmless idempotent reconnect for the same routine/receipt and receives the
current progress plus completed email/paper batches. The explicit **중단** control calls the separate
cancel endpoint. Jobs are bounded to eight concurrent in-memory runs and are cleared if the local
Briefing backend itself shuts down; they are not an unattended scheduler.

The live source collection request follows the same tab-switch rule: its component cleanup no longer
aborts an in-flight read. The parent Briefing session keeps the returned receipt/results so the live
view can be reopened while the backend stores the bounded receipt. The explicit **조회 중단** action
still aborts collection. A full backend restart expires in-process receipts, so this is session
continuity rather than durable source archiving.

Collection has its own progress indicator for the selected weather/paper/mail sources, followed by
an AI progress indicator for summary item batches. A collection source status such as “논문 실제 소스
조회 중” is therefore not presented as an LLM summary result. During AI work, the active range and
operation are updated without exposing internal reasoning. When an email batch completes, its
validated highlights appear in the top card while the next paper batch is still running.

## Architecture and maintenance map

### Paper summaries before source retrieval (2026-09-10)

- Live briefing now shows **저장된 논문 요약** before a collection, during pending paper analysis
  for matching current identities, and when paper discovery failed. `SavedPaperSummaries` reads
  only `/papers/saved`, with compact existing paper disclosures, feedback, original timestamps
  and a small ↻ action. Reading/expansion is not another arXiv or LLM request. The source failure
  remains visible instead of pretending an archived paper is a newly retrieved result.
- Generic analysis first reuses saved exact-version paper snapshots; only the explicit per-paper
  **원문 다시 확인하고 재요약** icon bypasses reuse. It is outside the disclosure, carries a cost/
  source-query tooltip, locks repeat clicks and retains the old result on retrieval or save failure.
  Email keeps its existing footer behavior. Legacy save dates are labelled as such rather than
  invented generation dates. Old relevance/priority is marked when personalization context differs.
- Inline/block math and stored figure bytes are restored locally. Available image bytes are bounded
  and optional; missing older images retain their captions and links without automatic arXiv loads.
  The [cache contract](BRIEFING_INTELLIGENCE.md#paper-first-saved-snapshots-2026-09-10) distinguishes
  version-reference snapshots from exact observed-input proof and preserves private boundaries.
- Verification: focused **42/42**, full Briefing **375/375** (54 files), Core **111/111**, named
  Agent Runtime **177 Desktop + 205 Briefing = 382/382**, typecheck/lint/format/build passed.
  Synthetic browser QA opened saved papers before collection, rendered stored math and displayed
  original dates; clicking one ↻ updated only that paper's timestamp. No horizontal overflow or
  console errors, actual arXiv/private-source queries, or native LLM calls were used in this QA.
  Production assets: `index-Br4BUUVD.js` / `index-CJ_EHGRj.css`. Existing large-bundle warning remains.
  The idle preview was restarted for the backend/cache schema changes after checking native
  children and outbound requests. Saved data remain; old in-process source receipts expire.
  No user browser reload, private-source recollection or paid native inference was forced.

### Host-managed original Mail opening (2026-09-10)

- **루틴 설정 → AI 비서 · 자동 요약 · Calendar → Apple Mail 원본 열기 확인** provides
  **항상 허용 · 원본 아이콘 클릭 시 (기본)** and **매번 확인**. Optional
  `mailOpenConfirmation` is persisted with assistant preferences; legacy omission behaves as
  always. This policy applies only to explicit original-mail navigation, independently of Mail
  reading, private AI, Calendar writes and the existing general confirmation policy. It neither
  changes browser/macOS security settings nor grants an LLM a launch tool.
- `AppleMailLink` is now a user-clicked button calling POST `/mail/open`, not an `a` navigating
  to `message://`. This moves the handoff into the trusted local application and avoids the
  browser's per-link external-protocol dialog. OS permissions, account login and Mail's own
  behavior remain independent; do not promise all system dialogs are suppressed. The 20px icon
  and 26px click area remain unchanged.
- Strict requests contain only routine/item plus exactly one receipt or history ID. The host
  requires an owned profile, resolves only an email item from the exact current receipt or saved
  history, validates its canonical stored original-message URI, and rejects missing/expired,
  foreign, non-mail or changed targets. Browser-supplied URLs, app names and approval overrides
  are forbidden. Ask mode invokes the existing native confirmation before the host rechecks the
  target and profile. Opening a known stored original does not require turning on mail-to-LLM
  permission or re-reading the mailbox.
- `openOriginalMail` uses `/usr/bin/open -b com.apple.mail <canonical-message-URI>` with an
  argument array, no shell, ignored stdout/stderr and only the normal home/path environment.
  The installed `open(1)` manual and Mail bundle ID were inspected. Native acknowledgement is
  bounded to 10 seconds; UI/server locks reject overlapping requests and there is no automatic
  retry or browser-link fallback. Cancellation cannot retract a handoff already delivered to
  Mail. A successful result means **열기 요청 전달**, not proof that the original still exists or
  that Mail displayed it. Mail may mark the message read as a result of the user's explicit click.
- Preferences remain backward-compatible without changing approved-scope digests or summary
  cache identity. Changing this UI-only policy does not reset the chat context key. New generations,
  automatic read tools, source scopes and existing summaries/feedback are unchanged.
- Verification: focused **94/94**, full Briefing **361/361** (52 files), Core **111/111**, named
  Agent Runtime **177 Desktop + 192 Briefing = 369/369**, package typecheck/lint/format/build
  passed. The native opener regression is part of the named gate. Synthetic browser QA showed
  the default setting, switching to ask, zero `message:` anchors, unchanged page URL and closed
  email detail after the host-request button; no browser dialog or console error appeared.
  Native dispatch was mocked: no actual user mail was opened, read, sent or deleted, and no
  real Message-ID handoff/OS prompt suppression is claimed verified. Production assets are
  `index-DqoHzkpA.js` / `index-D-ih3vyb.css`; the existing large-bundle warning remains.
  The idle preview was restarted after checking native children/outbound activity. Existing
  settings, summaries and feedback remain; prior in-process receipts expire. No user browser
  was forcibly reloaded, browser/OS security preference changed, or Desktop app replaced.

### Clear interest feedback and saved-state restoration (2026-09-10)

- Email and paper feedback now use outlined **thumb up / thumb down** icons labelled **관심 있음 /
  관심 없음**, replacing the bookmark-like star and crossed circle. The selected thumb is filled
  white on an olive-green positive or muted terracotta negative background with a subtle ring.
  A compact adjacent **관심 있음 · 저장됨** / **관심 없음 · 저장됨** label confirms the decision
  without adding a tall status row. The tooltip explains its effect on future recommendation
  priority. This UI wording does not rename the stored `important` / `not-interested` keys,
  rewrite prior votes, change AI importance scores or alter feedback-revision/cache semantics.
- Only successful persistence changes the selected icon. During a request both choices are
  disabled and **저장 중…** replaces the receipt; failure preserves the prior saved choice and
  exposes the existing error. Synchronous save locks reject rapid duplicate requests, clicking an
  already selected choice does not write again, and feedback clicks still prevent disclosure
  toggling. `aria-pressed`, readable labels and the textual receipt supplement color.
- History already restores server-owned votes. Live cards now restore them too via
  `/memory/feedback/choices`: strict routine/receipt inputs, unexpired matching receipt, owning
  browser profile, approved Mail scope when relevant, cancellation and post-read profile recheck.
  Only choices for that receipt's email/paper IDs are returned; no titles, bodies, arbitrary
  client-selected IDs, source reads, native confirmation expansion or LLM calls are introduced.
- `useLiveFeedback` performs one bounded lookup per current receipt set, aborts stale view reads,
  and keeps a vote saved during loading ahead of a late older lookup. Lookup failure warns without
  deleting backend entries or fabricating a saved decision. Live-view reentry restores selection
  from encrypted backend feedback, not a separate localStorage favorite list. Existing write
  approval policies remain unchanged, and no vote is submitted merely by displaying the controls.
- Verification: focused **49/49**, full Briefing **341/341** (51 files), Core **111/111**, named
  Agent Runtime **177 Desktop + 175 Briefing = 352/352**; typecheck/lint/format/build passed.
  Synthetic browser QA verified both filled colors, saved text, closed disclosures after voting,
  History-to-live restoration and a new live vote surviving History/live reentry. No actual user
  feedback, Mail, Calendar or native inference was used. Production assets:
  `index-BIzKU7uE.js` / `index-dZnHT1dW.css`; the existing large-bundle warning remains.
  Preview was restarted for the read-only restoration endpoint after checking for active native
  jobs/outbound requests. Saved settings, summaries and feedback remain; prior in-process source
  receipts expire. No actual user browser was force-refreshed or real vote changed during QA.

### Top-level collapse-all reading control (2026-09-10)

- A compact inward-chevron **모두 접기** icon sits in the fixed main title bar beside the existing
  action, above the reading scroller. It is available in personal History, live briefing and sample
  briefing, not Calendar, routine management or settings. Its native button has a tooltip, keyboard
  activation, visible focus and a screen-reader-only completion message without a new toolbar row.
- `collapseBriefingBlocks` closes every open `details` under that main scroller, including nested
  email/paper/evidence and source-group disclosures. Descendants close before ancestors; toggle
  events synchronize React-owned sample section state. The button takes focus before hiding any
  focused content and returns only the main scroller to its top. Already-closed blocks are not
  toggled; a repeated action is harmless. No document-wide query, sidebar/chat collapse, source
  collection, provider call, summary regeneration, feedback write or component remount occurs.
- Always-visible run overviews, weather and agenda are unchanged; this does not introduce another
  outer History disclosure. Individual blocks can be opened again, and assistant-summary jumps
  continue to reveal their target. Stored source order, read-state badges and summaries survive.
- Synthetic browser QA closed three expanded History items to zero, preserved an unsent chat
  draft, verified keyboard activation and reopening with rendered math, and closed five live
  disclosures including both source groups and nested evidence. The control is 32px square in
  the existing header. No personal source or LLM was used for this UI-only feature.
- Final gates: focused **35/35**, full Briefing **332/332** (49 files), Core **111/111**, named
  Agent Runtime **177 Desktop + 172 Briefing = 349/349**, typecheck/lint/format/build passed.
  A source-summary jump after collapse reopened just its email section/card, leaving nested
  evidence and other source groups closed; another collapse returned open-count to zero.
  Browser console errors and horizontal overflow were zero. Production assets:
  `index-Da6WYkWu.js` / `index-D4n2P8yG.css`. The backend was not restarted for this UI-only
  update, preserving current jobs/receipts; the existing large-bundle warning remains.

### Email read-state badges (2026-09-10)

- Collapsed and expanded email headers show a compact title-adjacent **● 읽지 않음** (blue) or
  **✓ 읽음** (neutral) badge beside the original-Mail icon. Unknown legacy state is explicitly
  **상태 미확인**, never inferred from subject/summary wording, unread-only settings or receipt
  time. Text plus symbols distinguish the states without relying only on color.
- The existing fixed Mail reader already observes `readStatus`; its host projection now also
  carries optional `mailUnread: boolean`. Pre-update live receipts can use only the exact second
  reader-metadata slot in `details` as a fallback; the typed boolean, including false, takes
  precedence. Papers cannot acquire an email state through this helper.
- `saveBriefing` stores this optional flag with the email in encrypted History and retains it
  across restart. Historical badges describe **브리핑 당시**, live badges **마지막 메일 조회 당시**
  in their accessible label/tooltip. They are snapshots, not a claim of continuous Mail sync.
  Existing histories without a flag remain unknown; no private source is re-read to backfill them.
- Each briefing's email heading offers **모두 읽음 (N)** (0.58.140): one request and one confirmation
  for the still-unread mail of that briefing; the server marks one message at a time through the
  single-message writer and answers per mail.
- The history view has a display filter, **안 읽은 메일만** (0.58.139): it keeps the mail whose saved
  state is unread and that was not marked read from GOSU since (`mailStillUnread`). It reads saved
  state only and never asks Mail again; mail with an unknown state is hidden and counted in a note;
  highlights and section counts follow the filter; it is not kept between visits. The collection
  setting **읽지 않은 메일만** is separate: it decides what a briefing collects.
- Rendering or opening a summary does not mutate Mail, fetch a source, invoke an LLM or rewrite
  saved summaries. The new flag duplicates existing observed metadata and is not added separately
  to the source digest; existing exact-detail/cache checks remain unchanged. Message links retain
  the user's explicit external-Mail handoff and its Mail-owned behavior.
- Verification: focused **47/47**, full Briefing **328/328** (48 files), Core **111/111**, named
  Agent Runtime **177 Desktop + 172 Briefing = 349/349**; typecheck/lint/format/build passed.
  Browser QA used synthetic read/unread histories: title-adjacent badges remain visible after
  disclosure expansion, carry the snapshot label, and cause no page overflow. No real Mail read,
  read-status mutation, account change or native inference was performed. Production assets:
  `index-DLmL840K.js` / `index-n52zSe9S.css`; the pre-existing large-bundle warning remains.
  The idle preview was restarted for the new optional persisted flag, preserving saved history
  and settings while expiring old in-process receipts. No user-browser reload was forced.

### One-click chat suggestions and native source deadlines (2026-09-10)

- Welcome suggestions now call the existing send path with their explicit prompt instead of only
  filling the composer. Native buttons retain keyboard support, the synchronous send lock rejects
  rapid duplicate clicks, and model-save blocking disables suggestions. All five suggestions share
  this behavior; merely opening the chat still makes no source/model request.
- Root cause of premature chat source failure: Codex dynamic tools defaulted to 10 seconds
  (Claude MCP to 30 seconds), while Mail discovery and reading each permit 60 seconds, and Calendar
  can need helper compilation before its read. `briefing-tool-policy.ts` supplies scoped overrides:
  email 150s, Calendar 210s, public papers 45s, history 30s; assistant turns have a 360s ceiling.
  The exact POST chat route has a 375s HTTP ceiling so the outer middleware does not abort it at
  the old 200s deadline; all other request budgets remain unchanged.
  Codex uses null namespace and Claude uses `gosu_project`. Routine design and zero-tool summary
  budgets are unchanged; no provider/permission fallback is added. These are upper bounds, not
  fixed waits or a guarantee that a stalled native app eventually responds.
- `runRoutineAgent` combines request, turn-lifecycle and individual delivery cancellation signals
  for the real source operation, suppresses late output, and aborts owned reads at turn cleanup or
  timeout. Assistant source registration rechecks cancellation and current approved scope after
  reads; failed/cancelled text cannot leak into returned source labels or a later tool result.
- Initially, all mail queries shared one bounded mailbox snapshot. The targeted-search fix above
  now shares identical queries only and filters specific conditions before selection. Coverage
  notes and safe stage/count progress are preserved. Recent/
  important-mail guidance requests `query=""`, then judges importance from returned evidence,
  rather than literally filtering messages for words such as “important.” No saved date, unread,
  account/mailbox, count or body-preview scope is widened. Calendar remains read-only in the tool
  loop; creation/modification still needs the existing separate reviewed action.
- Stable allowlisted errors distinguish timeout, permission denial, cancellation, bad arguments
  and unavailable sources. They never copy native stderr/private arbitrary error text. Unavailable
  or timed-out Mail/Calendar is not re-read in the same turn; the model is told not to diagnose it
  as missing permission, not to equate failure with an empty inbox, and to use other working sources.
- Verification: focused **55/55**, Briefing **321/321** (47 files), Core **111/111**, named Agent
  Runtime **177 Desktop + 172 Briefing = 349/349**; typecheck/lint/format/build passed. The new
  `briefing-chat-access.test.ts` is included in the named runtime gate. Synthetic UI verified one
  user message + one answer after a single mail or Calendar suggestion click, an empty composer,
  no extra Enter, no horizontal overflow and no console errors.
- Opt-in `tools/chat-read-deadline-live-smoke.ts` passed on actual GOSU Codex **GPT-6-Astra / low**
  with a 12-second synthetic email read and a 12-second synthetic Calendar read, one call each,
  both source kinds returned, zero real Mail/Calendar reads and zero writes. One earlier native
  attempt failed before source tools; its cause was not established, and it is not presented as a
  permission failure. No actual-user mailbox/calendar end-to-end success is claimed: separate
  user authorization was requested and remained pending during this verification.
- The idle preview was restarted for the backend changes after confirming no native AI/read child
  or outbound request was active. Existing saved settings/history remain, while old in-process
  receipts expire. Production assets: `index-DeF0PZvM.js` / `index-CXqaNOEX.css`. No user Safari
  reload, private scope change or Desktop app replacement was forced; the existing bundle-size
  warning remains.

### Restrained key-phrase emphasis (2026-09-09)

- Summary and assistant generation share `briefing-emphasis-policy.ts`: select zero to two short
  key phrases per paragraph/list item. Papers emphasize the central method, decisive assumptions/
  limitations or qualified reported results; email emphasizes requested actions, explicit deadlines
  and consequential changes; schedule explanations emphasize preparation or confirmed changes.
  Preserve uncertainty, source-title wording and exact machine/evidence fields. Emphasis does not
  establish urgency, factual correctness or new tool authority.
- `BriefingMarkdown` renders action/importance/overview fields in live, History and top summaries,
  plus Calendar proposal explanations. Its inline mode uses phrasing containers, not nested block
  paragraphs in cards/buttons. The AST presentation guard limits prose to two short (<=60 character)
  phrases per paragraph/cell, suppresses whole-paragraph and repeated emphasis within one rendered
  field, and leaves explicit source titles independent. User chat formatting, code, math and quoted
  evidence remain untouched. Existing source quote/URL safety checks and KaTeX settings remain.
- Unformatted paper summary/template fields may use exact stored AI keywords as local display
  hints, with the same limits and without adding keyword filler to already emphasized prose.
  Plain legacy email is not semantically reinterpreted by a heuristic or silently regenerated.
  Calendar agenda/history/highlight times receive structured emphasis; locations remain regular.
  Body emphasis uses 700 weight without extra color, boxes, margins or larger text.
- Formatting is render-only for saved content: no history rewrite, cache invalidation, feedback
  change, source collection or extra LLM call. Fresh generations use the new policy. This change
  does not fix the separately diagnosed Mail partial-read/chat-timeout problems.
- Verification: focused **61/61**, full Briefing **306/306** (46 files), Core **111/111**, named
  Agent Runtime **177 Desktop + 157 Briefing = 334/334**, typecheck/lint/format/build passed.
  Five new focused checks failed before renderer integration. Synthetic browser QA inspected
  collapsed/expanded email, paper template and Calendar proposal emphasis; email bold text was
  weight 700 and the normal 812px-wide viewport had no horizontal overflow. No private-source
  or native-inference call was used. Production assets: `index-UikR0jo_.js` / `index-CXqaNOEX.css`.
  Preview was restarted after checking that no native AI child or outbound source request was
  active. Stored settings/history remain; previous in-process receipts expire on restart. The
  actual Safari tab was not force-refreshed. The existing large-bundle build warning remains.

### Summary-box navigation (2026-09-09)

- Live **AI ASSISTANT SUMMARY** calendar/email/paper boxes are native keyboard-accessible buttons.
  They target the corresponding already-rendered inline agenda row or source card, rather than
  launching Mail/Calendar, changing tabs or invoking a new source/LLM request. Paper boxes include
  only analyzed items and stay compact with title, priority and up to three keywords.
- Target IDs include the view instance, source kind and exact item/occurrence ID; titles and source
  text are never interpolated into selectors. Lookup is confined to that live briefing root, so a
  repeated title or ID in another view/kind cannot take the click. Missing targets produce an
  explicit status message and are not guessed into another item.
- Navigation opens closed ancestor sections and only the item's primary disclosure, focuses its
  article without browser auto-scroll, then scrolls the main briefing pane to a 12px inset. Nested
  original-evidence disclosures remain optional. The destination gets a 2.5-second transient
  highlight; timers/marks are cleared on another jump or unmount. Reduced-motion preferences use
  immediate scrolling. No chat-pane scroll method or backend write is involved.
- Focused regression **12/12** covers exact callback identity, keyboard-capable buttons, safe ID
  encoding, nested expansion, missing targets, reduced motion and highlight cleanup. Synthetic
  browser QA verified email and paper expansion plus exact inline-calendar focus; email ended
  about 12px from the main viewport top. This is UI navigation, not a fix for the separately
  diagnosed Mail partial-read/chat-timeout issues or a new historical-source read.
- Final gates: Briefing **295/295** (45 files), named Agent Runtime **177 Desktop + 154 Briefing
  = 331/331**, typecheck/lint/format/build passed. Browser QA kept the chat scroller at **1104.5px**
  before/after a paper jump, verified Enter activation and 400×780 navigation without horizontal
  overflow. Production assets are `index-qe_0ymaT.js` / `index-ClyVF4iN.css`. The running preview
  backend is not restarted for this UI-only change, preserving its jobs/receipts. No personal
  source or LLM calls were made for QA. The existing large-bundle build warning remains.

### Title-bar model selection (2026-09-09)

- `BriefingModelMenu` lives in the right section title bar. Its popover lazily loads the existing
  provider catalogs and saved selection; shared `selectCatalogModelFromList` preserves Auto and
  explicit unavailable pins, and reasoning options come from the selected descriptor. Applying
  changes only provider/model/reasoning. Discovery/save failures do not claim a successful change
  or silently switch to another model. Choosing a different model resets draft reasoning to its
  default until an explicitly supported effort is selected.
- `/assistant/model/save` accepts only a routine ID, the new model triple and the expected previous
  triple. It requires an existing owned profile, validates current model/reasoning availability,
  and uses the existing approval flow for private-provider changes. Existing mailbox/calendar
  scopes and read/AI permissions are preserved. Stale selection, concurrent scope revocation,
  cancellation, or an automatic summary becoming active before commit reject the update. The
  encrypted workspace save has an optional expected-profile/precommit guard; other callers retain
  their existing behavior. No private grant is created by opening a model menu.
- Chat send is blocked during a model save, and model editing is disabled during that pane's active
  response. Same-provider model/reasoning changes preserve the current conversation and composer
  draft. Provider/source/permission-context changes still remount/clear the chat before another
  destination can inherit it. Open routine settings synchronize only the saved model triple,
  retaining unrelated draft edits. Per-response invocation labels remain historical provenance,
  not overwritten by the new title-bar choice.
- Synthetic browser QA changed Auto to a different model/effort, retained two previous messages
  and an unsent composer draft, and displayed the new model on the next response. No actual
  user model setting, source scope, private data or native inference was changed by this QA.
- Gates: focused **18/18**, full Briefing **279/279** (43 files), named Agent Runtime
  **177 Desktop + 152 Briefing = 329/329**, typecheck/lint/format/production build passed.
  At 400×780 the title bar remains 40px tall, the popover is 306px wide and no page horizontal
  overflow occurs. Preview was restarted for the new endpoint and its HTML checked against
  `index-DfmN05ya.js` / `index-D1Fsvvwh.css`. Stored settings/history were preserved; prior
  in-process source receipts/jobs expired. No Desktop replacement, forced Safari refresh or
  real user-provider switch was performed. The existing large-bundle build warning remains.

### Scroll-first full Briefing History (2026-09-09)

- `BriefingHistoryFeed` groups same-routine/same-`runId` records, merges split email/paper summaries
  and sorts by the stored collection timestamp descending. Runs have no outer disclosure;
  paper details are now collapsed per the later reading-controls follow-up below. One main-panel
  scroller reaches older complete runs. Search
  retains whole matching runs and uses a linear pass. `content-visibility` limits offscreen layout
  work without hiding content behind clicks. Live-source disclosure preferences are unchanged.
- Collection saves a validated snapshot of the complete hourly weather series and source
  status/count/error metadata in `workspace.v1.enc.json`, even when AI is disabled or fails.
  Raw mail bodies and even unanalysed mail titles are not copied into that snapshot. Later analysis
  records carry the same receipt UUID as `runId`, preserving each batch's feedback revision.
- The existing, permission-checked agenda read can attach displayed event title/time/location to
  that receipt. Receipt/routine matching, scope rechecks and saved-profile comparison protect this
  write. Calendar IDs, fingerprints, notes and other extra event fields are stripped. Nonempty
  agendas mark the snapshot private, retaining the private-history approval boundary.
- Opening History calls only `/history/list`: it does not recollect weather, read current calendars,
  invoke an LLM or regenerate old summaries. Weather is labelled **당시 예보**. Legacy records remain
  readable in the feed; absent historical weather is explicitly unavailable, never replaced by
  today's forecast. Legacy records without a run ID are not heuristically merged by date/title.
- Storage retains the newest 60 run groups, with a 600-record/32MB encrypted-envelope safety cap.
  Re-summarizing the exact same item set in a run replaces that batch, not its snapshot/other batches.
  UI History reads all retained records (up to 600); AI-tool/history-cache callers keep their smaller
  explicit limits and do not receive full snapshot fields in their prompt projection. Store failures
  remain visible in the live view; source retrieval is not falsely marked failed just because saving
  failed. There is no plaintext fallback or legacy-data reset.
- Verification: focused **26/26**, full Briefing Lab **218/218** (36 files), named Agent Runtime
  **177 Desktop + 116 Briefing = 293/293**. Typecheck, lint, formatting and production build passed.
  Disposable-store tests cover collection-before-analysis, batch grouping, retained run counts,
  encrypted restart, no raw-mail/calendar-note storage, revoked snapshot writes and save warnings.
  Browser QA at 1280×720 and 400×780 showed two synthetic runs in descending order, two full weather
  charts, rendered math, zero disclosure controls and zero page/main horizontal overflow. Actual
  scrolling reached the older run without expanding anything; fixture QA used no provider or personal
  source. After the preview restart, the existing Safari session opened its saved History with an
  expanded overview, no loading/error state and no new source collection or LLM request.

### Dense reading lists and email disclosure (2026-09-09 evening follow-up)

- Receiving-account/time follow-up: collapsed/live/history email rows, top email highlights and
  assistant source labels display the receiving Mail account name/address and a localized **수신**
  timestamp. This is distinct from the existing original-summary timestamp below the item. The
  account is the selected Mail account, not the sender or an inferred To/Bcc recipient. Multiple
  configured addresses are represented by the first plus an additional-address count, with the
  full list in the local tooltip. Identically named accounts remain distinguishable by address.
- The fixed Mail reader fetches only the selected account's name/configured addresses after its
  metadata checkpoint; a later stall preserves already observed message dates/account context.
  The host checks the returned raw account ID against the approved selection and exposes only
  the opaque scoped ID. Existing per-account/per-mailbox message hashes keep identical subjects
  or native message IDs from different accounts separate. This does not enable collecting every
  account or change the saved single-mailbox scope.
- Encrypted History now optionally stores `mailAccount` and `receivedAt` for email items. New
  account labels accompany source receipts/cache reuse, not model-invented metadata. Old histories
  without these fields stay readable and explicitly show missing metadata; current routine account,
  collection time or summary creation time is never substituted. No raw mail bodies are archived.
- Fresh summary/chat tool inputs carry `receivedAt` and the receiving account's name/addresses,
  excluding its opaque account ID. History search uses stored receipt time, not the history entry's
  creation time. Assistant instructions require account/time attribution and preserve uncertainty
  for legacy missing fields. Existing private-AI approval boundaries still apply; new metadata is
  not a workaround for the separately diagnosed chat-tool timeout or partial Mail collection.
- Verification: focused **52/52**, full Briefing **290/290** (44 files), named Agent Runtime
  **177 Desktop + 154 Briefing = 331/331**, typecheck/lint/format/build passed. Synthetic browser
  QA showed two identically named accounts with distinct addresses, separate received/summary
  timestamps, metadata visible while collapsed and in assistant source labels, and zero horizontal
  overflow at 400×780. No real Mail account/message or native inference was used for this QA.
  Preview was restarted for the reader/input changes and serves `index-dymmVpLf.js` /
  `index-DVXl6hqk.css`. Saved settings/history remain; previous in-process receipts/jobs expire.
  New account metadata is collected on the next source read; legacy missing values are not backfilled
  from current settings. The existing large-bundle build warning remains.

- Original-message navigation follow-up (initial browser-link implementation, superseded by the
  host-managed flow above): the collapsed email title row has a small outlined
  Mail/open icon in both live results and saved History. `mailMessageUrl` is generated only from
  Mail's actual read-only `message id` property and encoded as a canonical `message://` URL. It
  does not use the subject, hashed local item ID or `mailto:` compose action. Missing/invalid IDs
  leave a disabled, explained icon; legacy summaries are not guessed into new links. Browser/OS
  external-app confirmation may still occur, and a removed/unavailable original may not resolve.
  Clicking the link is separate from disclosure/feedback and can mark a message read in Mail under
  Mail's own behavior; merely rendering the icon performs no Mail action.
- Small sizing adjustment (2026-09-10): the original-Mail glyph is **20×20px** instead of 17×17px.
  Padding changes from 4px to 3px inside the unchanged 26×26px link/button; synthetic browser
  before/after inspection confirmed the title row remains 24px high with no horizontal overflow.
  Live and History share this CSS, including disabled legacy links. Navigation, labels and data
  access are unchanged; no Mail icon was activated for QA. Focused **33/33**, full Briefing
  **342/342** (51 files), typecheck/lint/format/build passed. Production assets are
  `index-DmyReFxV.js` / `index-DcAIADK9.css`; the backend was not restarted and existing jobs/receipts
  remain intact. The known large-bundle warning remains.
- The navigation ID is fetched after the bounded metadata scan/checkpoint, so it does not consume
  the existing 15-second candidate-selection budget. Optional lookup failure cannot discard the
  already collected metadata. A bounded private-pipe update preserves successful IDs in partial
  results; stage/count progress never contains IDs. The validated URL is optional in encrypted
  History, is excluded from LLM inputs and does not change an otherwise identical summary's cache
  identity. No mailbox/read/AI scope is widened and raw mail bodies remain unarchived.
- Assistant title typography follow-up: the shared Briefing assistant instruction requests
  Markdown bold for email subjects, research-paper titles and news/article headlines without
  inventing sources. A literal Markdown-AST renderer additionally emphasizes exact returned source
  titles in assistant prose, with longest-title/word-boundary matching and no nested bold, code or
  math rewrites. Source labels are also bold. This is formatting, not a new news retrieval tool;
  source permissions and the separate mail-chat timeout diagnosis are unchanged.
- Platform verification uses the installed Mail `Info.plist` registration for the `message`
  scheme and `Mail.sdef`'s read-only `message id` property. Synthetic UI/tests verify targets,
  enabled/legacy-disabled icons, no disclosure toggle, encrypted restart, partial checkpoints and
  title emphasis. No actual user message was opened or marked read and no native inference was
  performed for this feature's QA; a real-message OS handoff remains unverified.
- Final navigation/title gates: focused **72/72**, full Briefing **268/268** (41 files), named
  Agent Runtime **177 Desktop + 141 Briefing = 318/318**, typecheck/lint/format/build passed.
  Synthetic browser checks confirmed exact title-adjacent links, legacy-disabled state, all three
  referenced title kinds rendered as `strong`/700 weight, and zero page/main horizontal overflow
  at 400×780. Preview was restarted after checking its process/children and serves
  `index-DMEfGDUK.js` / `index-DNNBXWGa.css`. Stored settings/summaries were preserved; old
  in-process receipts/jobs expired. The actual Safari tab was not forcibly refreshed and no user's
  real message, selection, mailbox content or read status was changed during verification.

- The current email UX supersedes the earlier always-expanded email cards: both live and stored
  mail use `EmailBriefingDisclosure`, initially closed. Its header shows title, available sender
  (live receipts only), AI importance, preference icons and at most two visible lines of the saved
  AI summary. Unanalysed mail says **AI 요약 전** instead of passing raw mail off as an AI summary.
  Opening shows the complete summary, importance explanation, next action and available evidence.
  Preview prose is hidden while open to avoid repeating it above the full answer. Paper five-section
  templates, source math/figures and original links remain in their existing expanded view.
- `briefing-reading-list` gives each source section one light boundary with thin item separators.
  Removed per-item rounded frames/gaps and reduced heading, metadata and timestamp padding. Title
  text is 14px, email preview 13px, reading body remains 14px/1.8 line-height and the expanded inset
  is 14px/16px (12px on narrow screens). Local Pretendard and 30px preference hit targets remain.
  The original summary time and explicit refresh button remain outside the disclosure. Unknown
  legacy generation times, feedback/save failures and source-collection failures are not hidden.
- Native title/summary activation supports mouse and keyboard. Preference buttons still prevent
  disclosure toggles and expose selected state; no user rating is changed by opening/closing.
  This change does not invoke inference, recollect mail, change filters/permissions, or repair the
  separately diagnosed chat-tool timeout. Existing source/cache/history contracts are unchanged.
- Synthetic browser measurements at 1280px: email rows **306 → 125px** (~59% reduction), paper
  rows **143 → 100–101px** (~30% reduction). Both run groups remain in the newest-first scroll
  feed. At 400×780, two-line email previews measure ~40px, title clicks expand/collapse correctly
  and page/main horizontal overflow is zero. Selected feedback remains visible while closed.
- Verification: focused **27/27**, full Briefing **251/251** (39 files), named Agent Runtime
  **177 Desktop + 140 Briefing = 317/317**; typecheck, lint, formatting and production build passed.
  Both live and History views were checked with synthetic data. The two new disclosure regressions
  failed on the old always-expanded email renderer. Existing typography assertions now verify the
  expanded reading inset rather than requiring padding around the entire collapsed email card.
  Preview serves `index-CRZLrUlw.js` / `index-BCgMvcmN.css`; the backend is not restarted for this
  UI-only update. Existing jobs, receipts, user settings and stored summaries are not cleared.

### Reading controls and typography (2026-09-09 follow-up)

- Summary-cache follow-up: live and historical email/paper cards now have a shared 11px footer
  showing the original Korean-formatted generation date/time and **다시 요약**. It stays outside
  the paper disclosure, so neither reading the timestamp nor explicitly refreshing requires
  expansion. Pending refresh disables repeat clicks; errors retain the previous result. History
  reading/expansion alone makes no LLM request, and legacy save times are not mislabelled as known
  generation times. The general automatic-job button is **요약 다시 확인** because it keeps cache
  reuse; the per-item **다시 요약** explicitly bypasses it. See
  [exact observed-input cache](BRIEFING_INTELLIGENCE.md#exact-observed-input-reuse-and-explicit-refresh-2026-09-09-follow-up).
  Synthetic browser QA at 1280×720 and 400×780 verified separate original dates in two run groups,
  single-item refresh updating only that timestamp, papers remaining collapsed, 11px footer text
  and zero page/main horizontal overflow. No private source or LLM call was made by the fixture.
  Final gates: focused **38/38**, full Briefing **248/248** (39 files), named Agent Runtime
  **177 Desktop + 140 Briefing = 317/317**, typecheck/lint/format/production build passed with
  no skipped tests. The existing large-JavaScript-chunk build warning remains. Preview was restarted
  on port 4318 and its HTML verified against `index-BWju2WsF.js` / `index-Cb8ZBPAn.css`.
  User settings/history were preserved; old in-process receipts expired. No live personal-source
  re-collection, new native inference, Desktop replacement or forced Safari reload was performed.

- Current user choice supersedes the initial fully expanded paper History: keep runs/overviews and
  weather in one descending feed, but show only paper title, keywords/search terms and feedback
  icons until its native disclosure is opened. Research-priority details move inside the expanded
  body. Both live and historical papers use the same component and still render the five-section
  template, source math and available evidence on expansion without a new LLM call.
- Shared outlined SVG star / crossed-circle controls sit immediately after the keyword chips. Email
  controls sit in the analogous metadata row below its title, including live mail awaiting AI
  analysis. Selected controls use fill/tone plus `aria-pressed`; pending writes disable both choices.
  Click/keyboard feedback does not toggle a paper disclosure. Success is expressed by selection,
  not a new tall message row; save errors remain visible and do not falsely select the failed choice.
- Historical feedback uses `/history/feedback` with routine/history/item IDs and a decision only.
  The server resolves stored title/keywords, rejects injected metadata and foreign/missing targets,
  checks browser ownership and confirmation policy, and rechecks the saved profile at commit.
  No live receipt, new Mail read, original body or LLM call is needed. `/history/list` returns only
  choices for its retained items, restoring pressed state across views and restarts. Private taint
  is retained, including for privately influenced public papers and later live ratings; the existing
  per-routine feedback revision invalidation remains in effect.
- Standalone Briefing bundles **Pretendard Variable v1.3.9** from its
  [official repository](https://github.com/orioncactus/pretendard/tree/v1.3.9), with OFL text in
  `apps/briefing-lab/public/fonts/Pretendard-LICENSE.txt`. Font SHA-256:
  `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`.
  It loads from the app, not an external font CDN. Desktop/Model Lab presets and KaTeX fonts are
  unchanged. Reading text is 14px with 1.8 line-height; email/expanded-paper padding is 20px/22px,
  with separate paragraph/template spacing. Small screens wrap chips and keep 30px feedback targets.
- Verification: focused **41/41**, full Briefing **229/229** (36 files), named Agent Runtime
  **177 Desktop + 121 Briefing = 298/298**, typecheck, lint, formatting and production build passed.
  Synthetic browser QA confirmed ~95px desktop paper rows, no expansion on icon/Enter selection,
  expanded body padding and 25.2px line height, restored email/paper selections on History reentry,
  and zero page/main horizontal overflow at 400px width. No user feedback was altered for testing.
  The preview backend was restarted for the new History feedback route; the existing Safari
  session was refreshed and exposed the new feedback toggle controls in its saved History.
  No ratings were submitted on actual user items and no source collection/LLM call was initiated.

### Session-only sidebar (2026-09-09 follow-up)

- The sidebar no longer renders routine trees, nested settings, sample timestamps or archived-run
  lists. Its main navigation is the parallel Calendar and personal research Briefing sessions.
  `RoutineManager` is a separate main-panel destination reached by **루틴 관리** (also available
  in the collapsed sidebar). Existing routine editing, funding routines and read-only sample
  archives remain accessible there; no routine, sample, setting or real-history data is deleted.
- Initial app navigation is now History, not the sample preview. All current personal routines'
  retained real histories render in one expanded, newest-first feed. Sample data is intentionally
  not passed off as real history. **새 브리핑** starts navigation to the existing live view without
  automatically collecting sources or invoking an LLM. Creating a new routine still opens settings.
- Selecting personal Briefing again reloads saved local history and resets the main scroller to
  the newest entry. Opening the manager does not restore a sidebar tree. The original sample
  rendering/escaping/deadline tests now enter their explicit manager/preview workflow.
- Verification: focused app/history regressions **25/25**, full Briefing Lab **220/220** (36 files),
  typecheck, lint, formatting and production build passed. This is a navigation/UI-only change;
  storage, source access, native runtime and consent contracts are unchanged. Browser fixture QA
  confirmed two descending runs in one feed, zero sidebar trees, zero disclosure controls, and
  zero page/main overflow at 400px width. Scrolling reached 6850.5px; selecting personal Briefing
  returned to the newest heading at the top (subpixel scroll remainder 0.5px). No console errors.
  The existing Safari preview was refreshed to the new default History and session-only sidebar;
  the backend was not restarted, preserving any ongoing source/summary jobs. Subsequent user
  navigation to live Briefing retained the simplified sidebar.

### Calendar space recovery (2026-09-09)

- Removed the global source/fixture usage-notice strip. Sample buttons, cards and empty-state
  descriptions still identify synthetic data; errors and permission controls remain visible.
- Calendar omits the unrelated routine heading and routine tabs. Its own compact Apple Calendar
  heading, search, refresh and new-event controls remain. Other routine views retain their tabs.
- A flex-sized calendar frame fills the remaining main-panel height without the former 500px/420px
  minima. Main padding is 6px/8px; FullCalendar v7's supported `headerToolbarClass` and
  `toolbarTitleClass` hooks reduce the date-navigation bar, avoiding hashed theme-class selectors.
  Narrow containers wrap controls without changing calendar data, permissions or write review.
- Browser verification with synthetic events: at 1280×720, calendar height increased from about
  485px to 609px and the date grid starts about 150px higher. Month/week/day switching worked;
  400×780 had zero page/main horizontal overflow and no browser console errors.
- The production build was reloaded in the existing Safari session: the notice/routine chrome was
  absent, compact Calendar controls rendered and the existing authorized calendar returned 51 events.
  No events or permissions were modified. The running backend was not restarted for this UI-only update.
- Focused regressions **26/26**, full Briefing Lab **204/204** (35 files), typecheck, lint, formatting
  and production build passed. The existing large-bundle build warning remains. This is a UI-only
  update; no provider, runtime, source-collection or permission behavior was changed.

| Concern                                      | Implementation                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| Shared settings schema                       | `packages/briefing-core/src/live-settings.ts`                                     |
| Compact shell and independent chat scroll    | `src/briefing-app.tsx`, `src/workspace.css`                                       |
| Automatic batch execution / result merge     | `src/automatic-summary.tsx`, `src/workspace-client.ts`                            |
| Native assistant read-tool loop              | `briefing-assistant.ts`, `briefing-native.ts`                                     |
| Persistent approvals and history             | `briefing-workspace-store.ts`, `sealed-state-store.ts`                            |
| Browser capability binding                   | `briefing-client-context.ts`, `src/briefing-client-session.ts`                    |
| Source receipt/permission enforcement        | `live-source-service.ts`, `live-mail.ts`                                          |
| Calendar transport / observed-event receipts | `calendar-native.ts`, `calendar-service.ts`                                       |
| Calendar UI / time-zone conversion / review  | `src/calendar-view.tsx`, `src/calendar-dates.ts`, `src/calendar-event-editor.tsx` |

Paths without a package prefix are relative to `apps/briefing-lab/`.

Summary calls retain their zero-tool mode and quote/source-ID checks. General chat uses the same
native GOSU engine with exactly four domain read tools: `search_papers`, `search_email`,
`search_briefing_history`, `read_calendar`. There are no calendar write, shell or arbitrary file
tools in that loop. Up to 12 calls per turn; tool inputs/outputs and retrieved text are bounded.
Tool progress exposes short operation labels, not internal reasoning. Returned source links are
host receipts, not LLM-invented URLs. Calendar/task proposal source IDs must match receipts.

`POST /sources/assistant/settings/save` is the persistent authorization boundary. Settings are not
granted by routine JSON alone. `/assistant/auto-analyze` resolves the saved model and validates the
source receipt; `/assistant/chat` requires the owning browser. `/calendar/prepare` writes only a
pending local action. `/calendar/apply` claims the action atomically, validates scope/fingerprint,
then invokes EventKit. Repeated successful action IDs return the existing receipt. Uncertain
writes stay non-retryable pending fresh inspection; do not automatically replay them.

## Storage and security boundaries

- Existing `memory.v2.enc.json` is preserved. New settings/history/actions live in the sibling
  `workspace.v1.enc.json` under `~/Library/Application Support/GOSU/briefing-lab/`.
  AES-256-GCM, Keychain-backed key, mode-0600 atomic files; no plaintext fallback. Browser settings
  metadata still uses the existing local workspace store; raw source bodies are not archived.
- Persistent permission records contain hashes of random per-browser capabilities, exact source
  scope and provider. A spoofed Host/Origin plus freshly obtained process token does not inherit
  an approved browser's private rights. Scope/provider widening or adopting an existing profile in
  another browser requires native approval. Revocation is rechecked before inference and saving.
- Public summaries influenced by private memory are themselves marked private. Obvious credentials
  and authentication-mail content are excluded from durable memory/history by conservative heuristics.
  This is **not guaranteed PII redaction**. Approved private processing still uses the selected
  provider's servers and CLI retention policy; subscription quota can be consumed.
- This is a single-user local prototype, not a production security boundary against malware running
  as the same macOS user, browser XSS, stolen browser storage, or concurrent backend processes.
  The Calendar helper needs full EventKit access at OS level; per-calendar restrictions are enforced
  by the application, not a per-calendar OS grant. Native confirmation protects actual helper writes,
  including direct invocation; a signed isolated broker and hardened distribution remain necessary.
- EventKit helper targets macOS 14+, is compiled with installed Apple Command Line Tools and ad-hoc
  signed. Build caches are versioned by source hash; an updated helper can require renewed OS access.
  Production should bundle a consistently signed/notarized helper, not compile on end-user machines.
- Notification delivery is via Apple Calendar alarms and the user's OS notification configuration.
  This is not a new always-running GOSU notification scheduler. Opt-in interval generation now runs
  while the Briefing server is active as described above; OS background startup/delivery, arbitrary
  recurrence editors, invite sending and direct GOSU task/project writes remain unimplemented.

## Library choices

[FullCalendar's React interface](https://fullcalendar.io/docs/react) supplies month/week/day and
interaction behavior; installed `@fullcalendar/react` 7.1.0 uses subpath plugins/themes and
`temporal-polyfill`. Standard features use its [MIT license](https://fullcalendar.io/license).
Use the green Monarch theme and the app's shell spacing. Do not assume v6 option names remain
available in v7. Calendar day boundaries use Temporal in the routine timezone, including DST;
all-day event end dates are exclusive. EventKit uses
[full Calendar access](<https://developer.apple.com/documentation/eventkit/ekeventstore/requestfullaccesstoevents(completion:)>).

## Verification and reproduction

- Focused regressions: `briefing-workspace-store.test.ts`, `briefing-workspace-integration.test.ts`,
  `briefing-assistant.test.ts`, `calendar-service.test.ts`, `src/automatic-summary.test.tsx`,
  `src/workspace-ui.test.tsx`; native-loop, memory-taint and core-settings tests are extended.
  Tests use disposable encrypted stores, fake clocks/providers and synthetic events, never personal
  calendar mutations or hidden real mail reads.
- Named gate: `pnpm test:agent-runtime` includes the above harness/permission/UI regressions.
  Required package gates: full Core and Briefing tests, typecheck, lint, format check, production build.
- Isolated visual page: `pnpm --filter @gosu/briefing-lab exec vite --config workspace-visual.vite.ts`,
  then `http://127.0.0.1:4319/workspace-visual.html`. All source/LLM/calendar results on that page are
  visibly synthetic. It never connects to the real API or creates account events.
- Opt-in real native assistant smoke: bundle `tools/workspace-agent-live-smoke.ts` with esbuild
  (`--bundle --platform=node --format=esm --packages=external`) into
  `apps/briefing-lab/node_modules/.cache/workspace-agent-live-smoke.mjs`, then run that file with Node.
  Direct tsx execution is not supported because Desktop's source package has ESM-only dependencies.
  It searches public arXiv through native tools with a disposable public profile. No mail/calendar access.
- Live UI validation: the real saved research profile retrieved 10 arXiv papers and automatically
  summarized them in 6+4 batches, with source links and math. Main content measured 554/720 px
  (77%) after compact styles; the first visual pass caught and fixed incorrect stylesheet ordering.
  Month/week/day, review form and long chat scrolling are checked with the isolated visual fixture.
- Apple Calendar helper compiled and status returned `authorized: false`. Live personal calendar
  reads/writes are intentionally **unverified until the user grants OS access**; no personal events
  were created/deleted during development. Do not conflate mocked CRUD coverage with live verification.

Earlier workspace verification (before source-specific follow-up, 2026-09-09): Briefing **159/159**, Core **111/111**, named Agent Runtime
**177 Desktop + 86 Briefing = 263/263** passed. `pnpm check` passed format, generated contracts,
workspace lint/typecheck/tests and all production builds. Unchanged package gates were cached;
Desktop reports **2,366 passed + 8 environment skips** (five opt-in MacTeX, one Linux-only,
one live Claude and one live Hermes). Model Lab **340/340**, root **12/12** remain passed.
The opt-in real native assistant smoke passed with **GPT-6-Astra / medium**, one actual public
paper-search tool call, two source receipts, zero mail reads and zero calendar writes.

Browser checks: 1280×720 desktop and 400×780 narrow viewport, zero page/main horizontal overflow;
long-chat scroll moved from 1011 to 331.5 while the briefing scroll remained 0. The compact weather
card retains all numeric chart data in a two-column layout when space permits. Final inspected
screenshots are ignored local artifacts at `tmp/screenshots/briefing-workspace-compact.png` and
`tmp/screenshots/briefing-calendar-month.png` (synthetic sources/events are labelled). Existing real
automatic-summary history and memory were preserved. No Desktop replacement, commit or push.
