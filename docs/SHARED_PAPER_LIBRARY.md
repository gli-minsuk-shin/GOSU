# Explicitly approved paper-analysis library

2026-09-22: [0.58.141](releases/0.58.141.md). One rule decides which links the library can read:
`verifiablePaperLink` in `src/paper-summary-contract.ts` (arXiv, DOI, OpenReview, PMLR), used by the
confirmation card and by ingestion. The card offers only such links, saves one paper per call (own
time budget, own commit, per-paper failure reasons, retry of the failed ones only) and, when the
assistant offered the library without any such link, explains which links are needed instead of
failing on click. Before, one report or search link in an answer failed the save of every real paper
beside it. Project Chat's policy tells the model to link each discussed paper in an accepted form
from a tool result or web search and never to invent one. The saved-papers view exports BibTeX
(`src/paper-library-bibtex.ts`, browser download, verbatim `doi`/`url`/`eprint`). The desktop
Literature view lists the verified papers through `gosu:paper-summary:list` and imports chosen ones
through `gosu:paper-summary:import-to-literature`; Main reads the sealed library again, so the
renderer names papers by id only. The library still has no project field.

2026-09-14: [0.58.78](releases/0.58.78.md) adds a source-link icon beside each live/saved paper title,
including collapsed cards. It opens the exact saved HTTPS URL separately without toggling the card
or invoking AI. Missing links stay explicitly unavailable; multi-paper legacy records are not assigned
an arbitrary first paper URL. Paper summaries has its own desktop sidebar row below Briefing Lab.

## Assistant conversational save — 2026-09-14, installed 0.58.40

Binary installation is complete; native UI/live user-paper saves are still unverified because GOSU
window discovery timed out during startup. See the release record before claiming live success.

The AI assistant now has a narrowly enabled `save_paper_summary` operation. It is supplied only when
the current user's explicit approval matches a library offer in the **owned server conversation**.
Client-provided history, quoted assent, unapproved requests and ambiguous calendar/settings approvals
do not enable it. A server-owned optional pending-action flag retains ambiguity across reopening;
legacy records still load and additionally use conservative text checks. Bare assent applies only to the immediately preceding offer; explicit paper-library
requests may resolve the latest offer within eight retained messages. Queued replies and messages carrying new attachments do not inherit a save
approval from a potentially different preceding discussion; ask again as a direct reply after the
intended analysis completes. Only currently discovered paper
IDs whose title/URL occurs in that approved discussion can be saved. The old statement below that
save is never an agent tool is superseded by this host-authorized route; no unrestricted save tool exists.

This fixes the no-card case: an attached-PDF discussion can lack public links, and restored chat entries
do not retain transient frontend result objects. After approval the assistant resolves the discussed
titles through public search, then uses the existing library's verified summary ingestion, with the
configured Briefing summary model. It does not save the conversation text or filename as a paper.
The user does not need a second save-button click. Missing/ambiguous identities remain unsaved.
This is public-source identification from the PDF discussion, not persistent attachment-byte ingestion;
if no supported public source can supply the paper, source access remains a blocker.

Ingestion retains exact saved-version reuse. An arXiv API failure can use the general public lookup
and verified article HTML/PDF; DOI and PMLR page URLs and title-resolved OpenReview records are supported.
Insufficient abstract/original evidence fails rather than fabricating a summary. Five sections,
bibliography, source scope, selected equations/figures and summary timestamps remain stored.
Original PDF citation URLs retain a separate canonical paper URL for UI save actions.

There is one in-turn save attempt per discovered identity (including uncertain failures), a 12-paper
bound, and permission/ownership/cancellation revalidation before storage commit. Library storage
remains immutable/idempotent and encrypted. Only host receipts populate `savedPapers`, refresh the
library, suppress the redundant save offer and append a durable save confirmation to the transcript.
Without a receipt, the answer explicitly says saving is not confirmed. These changes apply to the
Briefing/global AI assistant; Project Chat retains its existing explicit UI save route.

Tests cover linkless/restored discussion approval, forged client history, wrong/undiscovered papers,
repeat saves, revoked permission before commit, source fallback and summary-role routing, and UI
library refresh. No user paper or live LLM was saved during QA. See
[0.58.40](releases/0.58.40.md) for exact gates and installed status.

Installed [0.58.33](releases/0.58.33.md) includes the verified ingestion and selection deletion below.
Earlier pending wording describes development time; no real paper was saved/deleted for release QA.

## Verified paper ingestion and selection deletion (post-0.58.32 source)

This supersedes the old conversation-copy contract below. A linkless paper-topic question or
save-offer marker no longer produces a save candidate. The shared library's production save path
does not copy the chat answer: it resolves each arXiv identity against source metadata, optionally
reads the existing bounded HTML evidence, and runs the existing five-section paper analyzer.
Unsupported URLs (including DOI/publisher URLs without this resolver), invalid metadata, rate
limits and incomplete summaries fail instead of creating a guessed paper. arXiv abstract-only
fallback remains explicitly labeled; this is not a claim of full PDF access. No live source or paid
model calls were used for implementation verification.

GOSU Main and the Briefing host provide the current model-routing callback. Ingestion reads the
saved default Briefing routine's model preferences, applies the `briefing` usage (normally fast),
and preserves explicit pins/provider boundaries. It does not use the assistant response/model as
summary content. Standalone consumers without a routing callback use saved Briefing preferences.
The question saved with a new paper is source-derived; the user's private conversational question
and answer are not copied. The common storage entry point also covers GOSU and Model Lab callers.

Verified records contain the real title, source/version, available bibliography/date, five sections,
importance/keywords, selected equations/figures and actual summary timestamp/digests. Cached verified
versions are reused before source/model calls. An unversioned request can reuse the previously saved
version; this is not a claim that it is the latest arXiv revision. Immutable verified IDs depend on the
canonical version URL, so concurrent publication cannot create duplicate versions. Legacy records
remain readable and are not automatically deleted or relabeled as verified. Record byte ceiling is
2 MB to accommodate the bounded saved figure data. The explicit save UI discloses source/model work.

The library now offers per-item checkboxes, selection of up to 100 filtered results, and confirmed
selection deletion. The backend resolves exact visible history/item identities and denies foreign
routine access and duplicate targets. Shared records move to an encrypted `.trash` filename (not
permanently unlinked); routine summaries get persistent library-only tombstones. Original briefings
and paper sources remain intact. Library searches and assistant library retrieval omit removed
records. Restore UI is not implemented; encrypted trash/original briefing data remain recoverable.
This does not delete historical chat references or all copies of a paper from every briefing.

Focused coverage exercises verified metadata vs conversation titles, summary-role routing,
five-section output, exact-version reuse, unsupported/search-page rejection, encrypted shared trash,
routine tombstone persistence/ownership, and checkbox-confirm-delete behavior. These regressions
are included in the named Agent Runtime gate. Synthetic UI inspection verified compact controls and
selected-state alignment. This change is not yet packaged/installed; the installed app is 0.58.32.

Implemented in source and active Briefing Preview: 2026-09-10. GOSU Desktop 0.58.11 is packaged;
replacement of installed 0.58.10 awaits the user's restart approval.

See the [0.58.11 release status](releases/0.58.11.md) and [Briefing workspace](BRIEFING_WORKSPACE.md).

## Interaction contract

- Completed paper-related answers in Project Chat, Model Lab chat and Briefing Chat display a
  **논문 요약 보관함에 추가할까요?** card. It offers **보관함에 추가** and **나중에**; merely rendering
  an answer or an invitation never writes a record. Interrupted/failed Project Chat and Model Lab
  error messages do not become successful-analysis offers.
- The shared GOSU research policy v2 requires a non-authorizing paper-offer marker for substantive
  paper follow-ups. Explicit paper terms/URLs provide a UI fallback when a model omits the marker.
  This is topic recognition, not proof of a paper's factual claims or a perfect semantic classifier.
- The latest offer accepts a narrowly recognized affirmative user reply, including **넣어줘**.
  When another event/task/edit approval could be confused with it, a bare yes is not accepted;
  the explicit library action or an unambiguous library-save sentence is required. Source text,
  quoted approvals and previous assistant output do not authorize a write.
- Saving copies the current analysis into this Mac user's shared GOSU/Briefing paper-analysis
  collection, as disclosed on the confirmation card. There is no source reread or LLM call.
  A saving lock prevents repeated clicks. Only a host receipt shows success; an uncertain request
  offers an idempotent retry, not a claim that nothing was written.
- Whole conversational analyses, including comparisons or focused follow-ups, are preserved as
  `chat-analysis`. They are not fabricated into a full five-section paper review. Existing paper
  summary templates and automatic briefing-batch history remain unchanged. A copied analysis is
  distinct from a fresh original-paper read and may retain its original limitations.

## Host and storage boundaries

- `apps/briefing-lab/paper-summary-library.ts` is reused by GOSU Main, the Model Lab backend and the
  Briefing backend. Storage is below `Library/Application Support/GOSU/briefing-lab/approved-paper-summaries`.
  The existing macOS Keychain helper supplies the AES-256-GCM key; keys never enter a renderer,
  command argument or plaintext key file. Empty library reads do not create a key.
- Each exact analysis has a content-derived ID and a separate immutable encrypted file. Atomic
  create-only publication prevents two app processes from replacing each other's accepted copies.
  Repeated identical saves return the existing receipt. Different analyses of the same paper are
  retained as distinct records, not silently overwritten. This is exact-analysis idempotency,
  not semantic paper-title deduplication.
- Input is bounded, origin is host-assigned, HTTPS references are checked and never fetched during
  save. Symlink/non-regular/oversized files fail closed. No original routine/history/archive file is
  rewritten by the shared store. A short concurrent publication window is retried locally.
- New writes stop at the nominal 1,000-record quota; a bounded read allowance tolerates small
  simultaneous-writer overshoot instead of hiding accepted records. No automatic pruning occurs.
  Long analyses are limited to 64,000 characters and encrypted records to 512,000 bytes.
- GOSU uses its trusted Main IPC handler. Model Lab requires same-origin loopback POST, plus the
  existing project capability when embedded. Briefing uses its existing session/Origin boundary.
  Save is a human UI endpoint, never an agent dynamic tool. It requires explicit confirmation.
- The shared collection is deliberately local-user/cross-app, not routine-owned: only analyses
  explicitly copied by the user enter it. Original private Mail/Calendar and routine history keep
  their separate owner/scope checks. This is not a remote sync service or an OS-process isolation
  guarantee against a compromised local user account.

## Retrieval and display

- The paper session combines its existing approved routine summaries with the explicit shared
  copies, newest saved first. Search still covers the original analysis text. Focus and a local
  save-completion event refresh the listing without AI work. Shared-store read errors do not hide
  otherwise readable routine summaries.
- A chat copy shows the analysis text and actual save time; when the original analysis timestamp
  was not recorded, it is not invented. It has no bogus source refresh or routine-feedback action.
  Those controls remain unchanged for normal generated paper summaries.
- Briefing's saved-paper tools can read the shared analyses only with existing private-AI approval
  and no pending per-request confirmation. The model is told these are historical AI interpretations.
  Long copied detail is bounded to 18,000 characters with an explicit truncation marker. The current
  owner/profile and cancellation are checked before returning content.
- GOSU's generic project-chat tools do not gain unrestricted cross-project library read access from
  this save action. The explicit shared data endpoint and future read integration must preserve
  private/provider boundaries; creating a local copy is not permission to read unrelated projects.

## Validation status

Focused tests cover confirmation, decline/failure, idempotency, simultaneous writers, encrypted
restart, unsafe links, GOSU IPC, same-origin Model Lab POST, backend library visibility and private-AI
retrieval. Tests use synthetic text and temporary stores, not user papers or real Keychain access.
Full gates, build/package receipts and installed UI status are recorded in the release note.
`pnpm check` and `pnpm test:agent-runtime` passed. Synthetic browser QA verified the confirmation
card, typed affirmative reply, saved state and immediate library refresh. No live user analysis
was saved for verification. Turbo cache inputs explicitly include the cross-app shared modules.
