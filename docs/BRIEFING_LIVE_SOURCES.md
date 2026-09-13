# Briefing Lab 실제 이메일·날씨·논문 소스

상태: 2026-09-09, 독립 Briefing Lab의 **수동 실제 조회** 구현.
기존 샘플 회차, LLM 루틴 설계, 실제 소스 조회를 분리했다. 선택적 LLM 요약·암호화 Briefing
memory·Scholar 알림·날씨 그래픽은 [Briefing intelligence](BRIEFING_INTELLIGENCE.md)에 기술한다.
자동 예약·연구과제 수집·영구 private briefing history는 미구현이며 Briefing UI는 독립 앱이다.

## 사용 방법

1. `http://127.0.0.1:4318`에서 개인·연구 루틴을 선택한다.
2. **루틴 설정 → 실제 이메일 · 날씨 · 논문 연결**에서 아래 조건을 정한다.
3. **설정 저장** 후 **실제 브리핑 → 지금 실제 자료 조회**를 누른다.

날씨는 도시 검색 후 후보를 직접 선택한다. IP/현재 위치를 추정하지 않는다.
논문 검색은 **이미 저장된 해당 루틴의 연구 키워드·가중치·동의어·제외어**를 그대로 사용한다.
검색 기간, 표시 건수와 저자만 추가로 설정한다. 별도의 테스트 프로필로 사용자 설정을 바꾸지 않는다.

**Apple Mail 계정·메일함 불러오기** 한 번으로 계정과 각 계정의 메일함 목록을 함께 가져온다.
계정을 바꾸면 해당 메일함 목록이 즉시 바뀌며 별도 메일함 조회 버튼은 없다. 목록 조회는
메일 메시지/본문 조회나 읽기 권한 승인이 아니다. 임의의 첫 계정·메일함을 자동 선택하지 않는다.

메일 계정 → 메일함 → 최근 일수/최대 건수/제목·발신자 필터/읽지 않은 메일 조건을
정하고, 읽기 허용 체크 후 **이 조건으로 메일 읽기 연결**을 누른다. 본문 미리보기는 별도 opt-in이다.
다시 설정 저장을 눌러 루틴에 반영한다. 메일을 제외하면 날씨·논문만 사용할 수 있다.
연구과제 루틴은 아직 실제 수집을 제공하지 않으며 다른 종류의 결과로 대체하지 않는다.

## 구현 위치

- Pure settings/schema: [live-settings](../packages/briefing-core/src/live-settings.ts),
  [workspace schema](../packages/briefing-core/src/schema.ts).
- Public networking: [allowlisted HTTPS](../apps/briefing-lab/live-public-http.ts).
- City/forecast/Atom parsing: [public sources](../apps/briefing-lab/live-public-sources.ts).
- Apple Mail host and fixed JXA: [mail reader](../apps/briefing-lab/live-mail.ts).
- Source execution/API: [service](../apps/briefing-lab/live-source-service.ts),
  [existing capability middleware](../apps/briefing-lab/briefing-server.ts).
- UI settings: [source settings](../apps/briefing-lab/src/live-source-settings.tsx).
- In-memory results: [live view](../apps/briefing-lab/src/live-briefing-view.tsx),
  [streaming client](../apps/briefing-lab/src/live-client.ts).

## Configurable Mail ceiling of one hundred (2026-09-10)

The reported `live.mail.limit: Invalid input` came from conflating the new default (50) with the
maximum permitted value. `DEFAULT_MAIL_LIMIT` remains **50**; independent `MAX_MAIL_LIMIT` is now
**100**. Both settings forms expose 1–100 and the shared core schema, settings API, native response
and incremental checkpoint validators accept the same ceiling. Invalid counts produce
**메일 조회 개수는 1~100 사이의 정수로 입력해주세요.**, without raw property paths in the UI;
API validation preserves that message too. Existing saved counts/approvals are not silently changed.

The native pipe byte bound grows from 4 to 8 MB to accommodate 100 bounded escaped previews;
the 60-second timeout, 250-candidate/15-second scan, per-message 4,000-character preview and
exact scope checks remain intact. Native allocations across accounts sum to the configured limit,
not that limit per account. The compatibility auto-summary batch endpoint accepts offsets through
100 (including the final batch starting at 96); generation still uses batches of six. The normal
job has room for 17 email batches plus bounded paper batches without changing model output limits.

First-connection three-message onboarding, persisted success state, completed-summary exclusion,
explicit refresh/search exceptions and existing History all remain unchanged. This is a configurable
maximum, not a guarantee the bounded scan will find 100 new messages.

Regressions cover the original 15 → 100 form save, the owned settings API and encrypted reload,
101 rejection with a readable message, first 3 → subsequent 100 with summary exclusion, native
body/link access and checkpoint recovery for 100, globally bounded multi-account reads, and a
valid 100-preview escaped response exceeding the old 4 MB ceiling. Synthetic browser QA confirmed
100 saves successfully and 101 displays the Korean error without renderer errors or clipped text.
No real Mail content, account settings or paid model calls were used for verification.

Final gates: Briefing **480/480**, core **115/115**, named Agent Runtime **479/479**
(Desktop 179, Briefing 299, Model Lab 1); typecheck/lint/format for both affected packages and
production build passed. The unchanged large-client-chunk build warning is non-blocking.
Preview was restarted after verifying no native read/model child or active client connection;
saved settings and History are preserved, while process-local grants/receipts expire as usual.
This changes standalone Briefing, not the installed GOSU.app.

## Fifty-message default, first-connection introduction and summary exclusion (2026-09-10)

This follow-up supersedes the older 20-message bounds below. New Mail connections default to
**50 total messages**, with 50 as the settings/native response ceiling. Existing saved limits and
their exact approvals are preserved: **공통 조회 조건 → 기본값 50개로 변경 → 설정 저장** is the
explicit upgrade path. Changing the default does not silently widen an existing read grant.

- A normal Briefing collection asks the encrypted workspace for a server-owned read plan. The
  first successful read of a routine's connected account is introductory. When all selected
  accounts are new, their **combined** native allocation is at most three (or a smaller configured
  limit). Later collections use the saved global limit. Newly added accounts still receive at most
  three each while established accounts share the remainder. Budgets are allocated round-robin
  before any native/body read; empty/failed allocations are not refilled by repeated reads.
  This is a maximum, not a guarantee of 50 messages or exhaustive/latest inbox coverage.
- `mailCollections` is an optional/default-empty field in the existing version-1 AES-GCM workspace.
  It records routine/account IDs and a successful-read timestamp, not raw messages. Only successful
  selected-account reads advance it; failed/cancelled reads do not. Exact profile and cancellation
  checks guard commits. Existing completed email summaries with receiving-account provenance also
  establish that an account was previously used. Reload/restart/reconnecting an already used account
  does not restart onboarding. The state is routine-scoped, not a global account-login claim.
- Exclusions are derived from **successfully saved email summaries** in that routine's retained
  History, not unread flags, a mere collection, pending/failed AI work, or paper/chat records. A key
  hashes the existing account/mailbox/native-message source ID, normalized receipt instant and
  original displayed subject. Same subjects across messages/accounts, changed IDs/times/subjects,
  and legacy records missing a stable ID or receipt date are not guessed equivalent. Unchanged
  identity metadata does not prove that a body edited in place is byte-identical; explicit refresh
  remains the way to re-check the source. No claim of full-body revalidation is made when skipping.
- The fixed JXA reader checks these keys during its bounded metadata scan and **before** Message-ID
  navigation lookup or body access. Skipped messages do not consume the result budget or reach
  a new LLM batch. The host revalidates returned scope/count and rejects a supposedly excluded
  response. Minimal identity/filter metadata still has to be inspected; “skip” does not mean zero
  Apple events for matching old messages. The exclusion set (up to the retained History's 150,000
  items) travels as SHA-256 keys over private stdin, never a huge argv, email text, log or browser
  payload. A pure fixed SHA implementation is parity-tested against Node and real macOS JXA.
- Metadata candidate checkpoints are incremental instead of retransmitting the growing list on
  every match. The bounded stdout ceiling is now 4 MB for up to fifty Unicode metadata/previews;
  the 60-second deadline, 250-candidate cap and 15-second soft scan budget remain unchanged.
  Partial previews/coverage remain explicit. Multi-account chat and refresh also allocate their
  global read limit before native reads, but explicit chat search and **다시 요약** deliberately
  bypass onboarding/exclusions, so saved messages can still be requested intentionally.
- `notice` explains the first three-message limit, the subsequent saved limit and any skipped
  count. It appears immediately above live email results and is preserved in collection snapshots
  for History, including empty results. Previous summaries/history are retained. Failed or never
  saved summaries remain eligible on the next Briefing; private permissions are not changed.

Implementation: [read planning and identities](../apps/briefing-lab/briefing-mail-ingestion.ts),
[native reader](../apps/briefing-lab/live-mail.ts),
[workspace state](../apps/briefing-lab/briefing-workspace-store.ts),
[service boundary](../apps/briefing-lab/live-source-service.ts).
Tests include real JXA **hash/stdin only** (no `Application('Mail')` call), a synthetic native Mail
object proving skipped bodies are never accessed, and sealed-store/service tests for 3 → 50,
restart, saved-summary exclusion, cancellation, revoked scope and explicit refresh.

Validation for this follow-up: full Briefing **473/473**, core **115/115**, named Agent Runtime
**473/473** (Desktop 179, Briefing 293, Model Lab 1). Both affected packages passed typecheck,
lint, formatting and production build. The macOS hash/stdin check ran and passed, not skipped;
that one platform-specific check is explicitly skipped on non-macOS CI. Synthetic browser QA
verified the two-line introductory notice directly above email History, with no text overflow or
renderer errors. No real Mail contents, account settings or paid LLM calls were used for QA.

Preview was restarted with no active Mail/model child or client connection and serves
`index-D2H6pYe0.js` / `index-CyElV3aL.css` at `http://127.0.0.1:4318/`. Existing settings/history
were preserved; ephemeral grants/receipts expire at restart. GOSU.app was not replaced.

## Routine Mail account list and multiple connections (2026-09-10)

This section supersedes the single-account settings UI described below. Routine settings now use
[Mail account list](../apps/briefing-lab/src/mail-account-list.tsx), retaining the legacy explicit
30-minute consent component for its existing callers/tests. The list shows each selected account,
its mailbox, a scoped permission badge and a remove icon. **계정 추가** lists unselected accounts;
the user must select a mailbox before adding one. **설정 저장** applies the entire draft. Removing
a connection never deletes an Apple Mail account or message. Registering a new OS account still
happens in Apple Mail settings, not by collecting passwords in Briefing.

- The legacy primary `accountId`/`mailboxId` remain valid. Optional `additionalAccounts` holds up
  to four more targets: five accounts total, one selected mailbox per account, shared date/filter/
  preview conditions. Duplicate accounts, excess targets and unexpected fields are rejected.
  `mailTargets`/`withMailTargets` preserve filters and promote a remaining account when removing
  the primary. An empty selection becomes `mail: null`; only Mail reading is switched off, leaving
  Calendar and private-history AI preferences intact. Existing histories are not removed.
- Metadata discovery additionally returns up to ten configured addresses per account, making
  identically named accounts distinguishable. Display-name/address and mailbox-name snapshots
  are saved in the routine configuration only after an edit, never treated as access authority.
  Legacy scopes without names can load the catalog explicitly. Mount/focus/30-second checks call
  only the host's `/mail/status`; discovery remains an explicit action and never reads messages.
- Badges distinguish saved policy, active short-lived read grant, read disabled, scope requiring
  save/approval, status failure, failed mailbox enumeration and a missing catalog entry. Expiry
  removes the active badge immediately. A limited catalog is not evidence an account was removed.
  Saved names and grant state are **not remote Mail synchronization or login-health verification**.
- The complete target set participates in exact workspace approval, grant validation and existing
  summary context digests. Adding an account cannot silently reuse a narrower authorization.
  Both Briefing collection and assistant `search_email` use the same approved multi-account reader.
  Existing per-turn reuse avoids repeated native reads for successive chat filters.
- At most five fixed native readers run concurrently, each retaining the existing 60-second hard
  deadline, 250-candidate/15-second soft metadata scan and configured per-mailbox result bound.
  Merged results are sorted by observed receipt time and capped to the configured **global** display
  limit (at most 20), not multiplied by account count. These bounded candidate scans are not an
  exhaustive or globally newest inbox search. Timeout/unavailable-account failures retain other
  successful results and explicitly report a partial failure; cancellation, permission, scope or
  response-integrity errors fail closed. All failed reads remain failure, not empty success.
- Receiving-account attribution and account-specific source IDs remain intact. Mark-read resolves
  the selected message's currently approved account/mailbox; removed accounts are rejected. A
  legacy message without account attribution cannot be guessed when multiple accounts are selected.

Validation: the new UI regression first failed on the old single-account component. Final full
Briefing suite **453/453**, core **114/114**; named Agent Runtime **449/449** (Desktop 179,
Briefing 269, Model Lab 1). Both affected packages passed typecheck/lint/format and production build.
Synthetic browser QA at wide and narrowed main-panel widths verified account addition/removal,
preserved remaining selection, disabled unavailable entries, readable layout, no row overflow and
no renderer errors. This turn did **not** read real Mail messages, change real account selections,
or invoke a paid LLM. Tests are not evidence of live provider availability.

Standalone Preview was restarted after confirming it had no active native read/model child or
open client connection. `http://127.0.0.1:4318/` serves `index-Nceo95HN.js` and `index-DuAW1a7y.css`.
Saved settings/history were preserved; process-local grants/receipts expire on restart and approved
policy grants are restored at the next permitted read. GOSU.app was not replaced by this update.

## Public source contracts

### Source recovery follow-up (2026-09-09)

- A screenshot and the running Safari UI showed Apple Mail timing out even after the earlier
  25 → 60 second timeout increase. That change alone did not restore collection. The earlier
  test/build receipts were not evidence of live Mail success.
- Mail now resolves individual message references in the selected mailbox, up to 250 inspected
  messages, a 15-second soft scan budget, or the configured number of matches. It no longer applies
  `whose(dateReceived)` to the entire mailbox before bounding work. Individual Apple events can
  still exceed the soft budget; the process has a 60-second hard deadline. Results are sorted only
  within the inspected subset and explicitly labelled partial; do not claim exhaustive newest-mail
  coverage. Original account, mailbox, date, sender, subject and unread filters remain enforced.
- The fixed reader sends bounded metadata checkpoints and completed preview updates through its
  private stdout pipe. A stalled body cannot discard already received metadata. Partial results
  are schema/scope checked by the host; missing bodies use `mail-metadata`, not `mail-preview`.
  User cancellation and permission revocation still discard results. Pipe data is not written to
  logs/history/Obsidian. UI progress contains only stage/count, never subjects or bodies.
- arXiv cache lookup now precedes throttling and survives minute-boundary changes within its
  two-minute TTL. A bounded 24-entry in-memory cache holds validated public XML, re-parsed for the
  caller's current filters/ranking. Sequential requests are spaced 3.1 seconds apart; identical
  pending lookups reuse the completed cache entry. HTTP 429 pauses all arXiv requests until
  `Retry-After` (at least two minutes; two minutes when absent). No retry timer or alternate IP/host
  bypass is installed. A cold cache cannot manufacture results during an upstream outage.
- Failed source collection no longer renders an empty AI summary as “100% complete”. Mail timeout
  errors identify whether account, mailbox, metadata or body access stalled.
- Live read-only diagnostics: the user's selected mailbox/date/count settings returned **3 metadata
  items in about 26 seconds**; a separate opted-in preview run returned **2 items with 2 previews in
  about 37 seconds**, with partial coverage labelled. No mail was modified, no LLM was invoked, and
  no private text was logged. A public example arXiv query returned **1 paper**, and an immediate
  repeat reused cached evidence. This does not guarantee upstream availability or complete coverage.
- Verification: Briefing Lab full suite **203/203**; named Agent Runtime gate **177/177 desktop +
  104/104 Briefing Lab**; typecheck, lint, formatting and production build passed. Socket-dependent
  tests needed execution outside the filesystem sandbox; none were skipped. The user's saved-keyword
  arXiv request was blocked by approval review before transmission, so that exact end-to-end query
  remains unverified pending user authorization. Public-example success is not a substitute for it.

2026-09-14 source candidate: [public paper recovery](PUBLIC_PAPER_RECOVERY.md) adds scoped PMLR,
OpenReview and DataCite routes, named-title lookup without briefing filters and original reading.
The original transport description below predates that candidate; see its release record for status.

Fixed routes cover Open-Meteo geocoding/forecast and arXiv query, plus tightly scoped arXiv HTML and
same-paper raster assets for optional analysis. Arbitrary source URLs are not fetched. The transport validates public
IPv4 DNS addresses and pins the selected address to the actual TLS request, while retaining hostname
certificate verification. Redirects are not followed. Requests have a 20-second bound and a 2 MB
response cap (8 MB for bounded paper raster assets). No API key, cookies, email body, or private project file is sent to these APIs.

City queries and selected city coordinates go only to Open-Meteo. Forecast current values are weather
model estimates, not claimed local sensor observations. Model time/timezone, units and missing values
are explicit. The UI attributes Open-Meteo; the public endpoint is for the non-commercial prototype.
Commercial distribution must recheck provider terms rather than assuming a free production service.

arXiv search combines literal keyword/synonym phrases, a UTC submitted-date interval and optional
author. Overlarge queries fail rather than silently dropping most of the user's interests. A
process-wide 3.1-second start interval prevents rapid arXiv repeats; no automatic retry storm is added.
The latest candidate pool is bounded to up to 60 records, then deterministically ranked by weighted
title/abstract matches and publication time. This is not a global relevance ranking of all arXiv.
DOI discovery or Crossref fallback is not silently mixed into these results.

Atom is parsed with an explicit XML parser; DTD/entity declarations, malformed feeds and invalid
source IDs are rejected. Versioned arXiv links are preserved while canonical IDs deduplicate entries.
Publication and update dates remain distinct. Original abstracts are in a collapsed evidence panel;
optional LLM summaries/importance/relevance are shown separately, with source-grounded equations/figures;
missing abstracts are labeled metadata-only. Preprint metadata is not peer-review or experiment proof.

## Apple Mail permission and privacy

Receiving-account provenance follow-up (2026-09-09): email items retain the actual `dateReceived`
instant plus a snapshot of the selected Mail account's name/configured email addresses. The reader
uses the installed Mail scripting dictionary's `email addresses` property, never a From/To/Bcc
guess. The bounded account metadata lookup occurs after the first message checkpoint, stays inside
the existing process deadline and emits no private values in stage/count progress. A returned
account ID outside the approved selected scope is rejected. The UI and encrypted summary History
distinguish received time from collection/AI-summary time, including when viewing multiple account
histories. This adds attribution, not simultaneous collection from new accounts or broader grants.

The host invokes `/usr/bin/osascript -l JavaScript` with a fixed read-only program. User strings are
JSON argv values, never source-code interpolation. It reads only account/mailbox metadata and the
explicitly selected mailbox's messages. There is no send/delete/move/attachment-open or read-status
setter, and no direct mail database/credential-file access.

The browser receives opaque account/mailbox IDs; the host resolves them to Mail's own identifiers.
Mailbox paths cannot be supplied as arbitrary script code. Authorization binds an exact routine ID
and exact filter/body-preview scope to an in-memory grant expiring after 30 minutes. Changing scope
requires another explicit authorization. Revoking aborts an active read and discards its late result.
Server restart clears grants. OS Automation approval remains a user action and is not bypassed.

### One-step discovery and visible connection status (2026-09-09)

- `mail/discover` performs one fixed JXA `discover` call: up to 30 accounts and 200 mailbox paths
  per account / depth six, with a 200k-character shared mailbox payload budget inside the existing
  1 MB/60-second reader bound. Limits and per-account errors are explicit; one failed account does
  not discard another account's mailbox list. No `messages`/content/authorize action is called.
- The UI uses this per-account catalog for immediate account switching; it never enumerates Mail
  on mount. Existing `mail/accounts` and `mail/mailboxes` endpoints remain for compatibility.
- `mail/status` checks the host's existing exact routine/scope grant **without invoking Apple Mail**.
  Saved configuration alone cannot produce a connected state. It distinguishes active, disconnected,
  expired and changed scopes and returns expiry plus known account/mailbox labels.
- A prominent green envelope/check card means **메일 읽기 연결됨 / 읽기 권한 활성**, displaying
  selected account/mailbox, lookback/count/body scope, expiry and last checked time. Blue means
  catalog ready/approval pending, not connected. Amber marks expiry or an unverified host state.
  This confirms the grant, not a successful new message fetch or remote Mail synchronization.
- **메일 설정 저장됨 · 조회 시 자동 연결** is a separate neutral state: the selected Apple Mail
  account/mailbox and approved routine scope are valid, but the short-lived in-process read grant is
  not currently active. The next permitted collection restores that grant. The card also shows Mail
  reading and LLM-transmission permission separately, so “scope configured”, “read grant active”,
  “expired/scope changed” and “disconnected” are not conflated.
- Saved scopes are checked on settings mount, window focus and every 30 seconds; a local expiry
  timer removes green at the deadline. Changing scope, revoking, server-check failure, or a stale
  response cannot leave a falsely confirmed state. Late cancelled discovery responses are ignored.
- Implementation: [Mail connection UI](../apps/briefing-lab/src/mail-connection-settings.tsx),
  [mail broker](../apps/briefing-lab/live-mail.ts), and [source API](../apps/briefing-lab/live-source-service.ts).
  Core mailbox filtering, native consent and separate LLM-transmission approval are unchanged.
- Metadata-only live smoke obtained **2 accounts / 29 mailboxes** in one `discover` invocation,
  with 0 unavailable accounts, 0 message bodies read and 0 grants created. Account/mailbox names
  and private content were not logged or saved in these docs. Connected-state visual QA uses
  clearly labelled synthetic account data, not an assistant-approved real grant.
- Verification: focused mail/API/UI **20/20**, full Briefing **122/122**, typecheck/lint/format and
  production build passed. Named Agent Runtime: Desktop **177/177** + Briefing **49/49**.
  Seven intelligence visual captures passed (including connected/prepared/loading/expired at
  1000/420px); screenshots were inspected and had no overflow or renderer errors.
- The real browser's single discovery click displayed **계정 2개 · 메일함 29개**. Account switching
  populated the cached mailbox selector without the removed mailbox-load button. Selection was
  reset afterward; no settings were saved and no real read grant or message access was requested.
  This update changes standalone Briefing only; Desktop 0.58.10 was not replaced again.
- Reproduce the explicit metadata-only live smoke with esbuild, using
  `tools/mail-discovery-live-smoke.ts` as the entry and `node_modules/.cache/mail-discovery-live-smoke.mjs`
  as output (`--bundle --platform=node --format=esm --packages=external`), then execute that built
  file from the repo root. It logs counts/action kinds only. Never run a message/authorize smoke
  automatically or use another person's mailbox as a test fixture.

The reader inspects at most 250 message references, applies the date and other scope filters to
those candidates, and returns at most 20 messages (often fewer under its time budget).
The UI reports scan/return limits and partial coverage. Metadata is sorted by receipt time within
that bounded candidate set; it does not claim an exhaustive mailbox scan. Subject and sender filters
are literal case-insensitive contains checks, not raw Mail search expressions. The host revalidates
returned time/filter/count scope before sending it to the browser.

By default only subject/sender/time/read-status metadata is returned. Opted-in body preview displays
up to 4,000 characters; Mail may internally retrieve/cache message content to satisfy that request.
GOSU does not read attachments or deliberately change read state. Collection does not send mail to
an LLM; the optional analysis action requires separate browser opt-in and native confirmation.

**The raw-collection view keeps mail titles/senders/body previews in ephemeral React state.**
They are not automatically added to localStorage, fixture history, model memory, logs, or Obsidian. Leaving the
view or reloading clears results. The user's chosen city, paper filters and opaque mail IDs/input
filters are ordinary routine configuration persisted in the existing local browser store. That
store is not an encrypted mailbox archive. Completed AI summaries now automatically become compact
backend memories in a separate AES-GCM/Keychain store; no manual memory authoring is needed.
the server also holds bounded analysis receipts for at most ten minutes. See the intelligence document.
After the separate LLM analysis approval, the selected native provider/CLI may retain prompts and
results in its own local logs/session files or service storage. The GOSU no-auto-archive rule is
**not** a guarantee of no disk/cloud retention by the provider. The private-analysis confirmation
and settings explicitly disclose this boundary.

## API, failures and cancellation

Chat follow-up (2026-09-10): the Briefing assistant now registers per-source native deadlines
instead of inheriting Codex's 10-second default. Request/turn/tool cancellation reaches the actual
reader, and late results are rechecked before source registration. The later targeted-search fix
applies sender/title/date/account conditions in Mail before the count limit; only identical queries
reuse their result within a turn. See [targeted assistant Mail search](BRIEFING_WORKSPACE.md#targeted-assistant-mail-search-2026-09-10)
for the current contract and metadata-only live verification. Partial-coverage notes and count-only
progress remain. OS denial remains distinct from source timeout; neither permissions nor mailbox
filters are widened. The initial deadline contract and synthetic/native validation receipts are in
[chat source deadlines](BRIEFING_WORKSPACE.md#one-click-chat-suggestions-and-native-source-deadlines-2026-09-10).
The bounded Mail candidate scan described above remains partial, not exhaustive inbox retrieval.

Live routes are under `/api/briefing-agent/sources/`: `cities`, `mail/accounts`, `mail/mailboxes`,
`mail/discover`, `mail/status`, `mail/authorize`, `mail/revoke`, `collect`, and `analyze`. They use the same loopback Host/Origin checks and
capability header as routine design. They require bounded POST JSON. Browser mounts do not trigger
account enumeration or collection. No LLM calls are used for raw reads. Private authorization, each
mail batch read, and analysis with mail/memory additionally need native confirmation. Header checks
are not authentication against malicious local processes; this remains a standalone prototype.

Memory routes are `memory/status` (counts only), `memory/review` (native confirmation before content),
`memory/edit`, `memory/import` (routine-scoped five-minute review capability and revision checks),
and `memory/feedback` (ties a preference to an existing source receipt). Automatic memory loading
and saving happen inside analysis, not through client-supplied source text. Private remembered
context still requires native confirmation before LLM transmission. See [memory contracts](BRIEFING_INTELLIGENCE.md).

AI-analysis UX follow-up: mail reading was reported working; the user clarified that summary execution
appeared slow, not that a specific connection error was confirmed. The UI now shows elapsed seconds,
current stage/model/reasoning and cancellation, without silently lowering reasoning. Enabling the
explicit mail-to-LLM checkbox selects up to six mail-derived items automatically. Native model,
reasoning, timeout and memory-storage errors are identified separately from mail-connection errors.

Source collection proceeds independently with streamed start/end counts. One failed source cannot
turn all other sources into a failed run. `ready`, valid `empty`, and `failed` stay distinct; no source
failure is replaced by synthetic examples. Cancel, disconnect, unmount and server shutdown stop
owned work. Raw provider errors are replaced by safe actionable messages.

## Verification and current limits

- Public network smoke: real Open-Meteo city/forecast result and arXiv 3-paper result passed.
  The explicit smoke uses public example inputs, does not save or overwrite routine configuration.
- Browser smoke: the existing saved personal/research routine queried arXiv and displayed 10 real
  papers using its existing research interests. No new test keywords were saved to that routine.
- Apple Mail: the real fixed reader enumerated **2 accounts**, reading no message bodies.
  The user still selects the intended account/mailbox and grants its scope in settings before
  message retrieval. Real mailbox contents were not read automatically across both accounts.
- Regression tests cover public URL/private DNS rejection, XML/empty/error/date/version handling,
  ranking, source failure isolation, exact/expired/revoked mail grants, fixed read-only script,
  UI no-auto-fetch, saved-profile reuse, capability boundary and settings persistence.

No automatic cron/launchd scheduler, Calendar/task bridge, funding collector, durable private inbox,
or automatic account selection is implemented. Optional summaries and reviewed memory are now
implemented separately; see [intelligence boundaries and validation](BRIEFING_INTELLIGENCE.md).

## Primary references

- [Open-Meteo forecast API](https://open-meteo.com/en/docs): forecast/model fields and attribution.
- [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api): city candidates.
- [arXiv API manual](https://info.arxiv.org/help/api/user-manual.html): Atom, literal query fields,
  submitted-date filters and ordering.
- [Apple Automation permissions](https://support.apple.com/guide/mac-help/allow-apps-to-automate-and-control-other-apps-mchl108e1718/mac): OS consent.
- Installed Mail scripting dictionary was inspected for account/mailbox/message property names;
  its existence is not treated as authorization to read a mailbox.
