# ADR 0003: Workspace-level multi-project Lecture Studio

- Status: Accepted
- Date: 2026-08-06
- Last updated: 2026-08-17
- Owners: Lecture, Manuscript, Reference & Literature, Experiment Orchestration, Obsidian Knowledge, AI Gateway, Integration Hub

## Context

강의나 research talk는 한 project의 산출물만 요약하는 작업이 아니다. 여러 논문과 재현·개선 실험을
함께 비교하고, 동일 개념의 근거와 반례를 한 흐름으로 구성해야 한다. 따라서 project folder 안의
`Lecture slides` placeholder는 다음 요구를 충족하지 못한다.

- 여러 active project의 captured Manuscript, Literature와 Experiment evidence를 동시에 선택
- 사용자가 선택한 `.tex/.md/.pdf` snapshot과 Overleaf Git checkpoint를 같은 evidence flow에 추가
- 일반 lecture와 10/20/30/50분 research talk 구분
- Project Chat의 목표·권한·history를 오염시키지 않는 전용 수정 대화
- 생성 결과를 사용자가 선택한 한 project의 Obsidian Research Notes에 계속 보존
- 어느 source version과 실제 Codex model로 각 revision을 만들었는지 재현 가능한 provenance

Literature는 현재 metadata 중심이고 Experiment는 수동·local-live summary가 포함될 수 있다. Manuscript는
사용자가 capture한 exact LaTeX checkpoint만 읽을 수 있다. 추가 local PDF도 selectable text만 추출한다.
따라서 Lecture Studio가 검증하지 않은 published paper full text, PDF figure/scan/layout, live·저장 전
Overleaf edit나 원격 trial의 존재를 암시해서는 안 된다.

## Decision

### 1. Project 밖의 workspace module

Lecture Studio는 project navigation의 child tab이 아니라 Workspace 전역 section이다. 한 studio는 최대
12개의 active source project, 선택한 Literature record·Experiment idea·captured Manuscript/Overleaf checkpoint,
최대 12개의 local `.tex/.md/.pdf` snapshot, presentation kind, 선택적인
talk duration, notes/slides page target, detail level, `adaptive|custom` notes/slides structure, 추가 생성 지시,
그리고 정확히 하나의 `outputProjectId`를 소유한다. 출력 project는 source project 중 하나여야
하며 해당 project의 Research Notes binding이 ready여야 한다.

새 studio의 source/output 후보는 active project만 보여준다. 기존 studio의 artifact preview는 archived
project를 포함한 workspace snapshot에서 output project 이름을 resolve해 과거 저장 위치의 가독성을 유지한다.

Studio list는 제목·상태·현재 revision 같은 bounded summary만 반환한다. 메시지와 document revision은
사용자가 고른 studio의 detail query로만 불러온다. candidate IPC는 project별 offset/limit page만 반환한다.
현재 source port는 project당 최대 Literature record 500개와 Experiment idea 500개의 bounded set 전체를
메모리에서 읽어 정렬·slice하므로 storage-level cursor paging은 아니다. 더 큰 repository를 지원할 때 source
port를 cursor query로 확장해야 한다.

### 2. Source selection과 frozen provenance

Lecture Studio는 다른 module의 table을 Renderer에서 직접 읽지 않는다. Main의 source port가 selected ID를
authoritative Literature·Experiment repository와 Manuscript service에서 다시 조회한다. 후보 첫 화면과 생성 시점 모두 다음
경계를 적용한다.

- Literature 기본 후보는 사람이 `included` 또는 `reviewed`로 분류한 record다.
- frozen source에는 record version, annotation version, review status, bibliographic metadata,
  manual/AI topic tag와 `metadataOnly: true`를 기록한다.
- Experiment source에는 idea version, parent lineage, outcome, result summary와 Objective/evaluator/dataset/
  holdout hash가 포함된 bounded metric snapshot을 기록한다.
- Manuscript는 current binding의 exact captured checkpoint가 있을 때만 선택 가능하다. 생성 시 checkpoint를
  다시 검증하고 safe UTF-8 `.tex`·`.bib` file 전체를 deterministic path 순서와 bounded chunk로 읽어 full-file
  SHA-256과 총 문자 수를 계산한다. prompt에는 root-first bounded exact extract만 제공하며 v2 manifest에는
  `contentComplete`, extraction policy version, manuscript/file version과 full-file SHA-256,
  checkpoint/provider revision, revision-envelope digest를 고정한다. extract만 포함되면 전체 원문을 읽었다고
  주장하지 않는다.
  이후 provider revision, compiled PDF와 binary figure는 포함하지 않는다.
- local `.tex/.md/.markdown/.pdf`는 Main native dialog에서만 선택한다. Renderer에는 local/managed path나
  bytes를 반환하지 않는다. file별 20 MiB, 전체 50 MiB, 최대 12개를 app-owned `0700/0600` copy로 고정한다.
  TeX·Markdown은 strict UTF-8 exact text를 file별 40,000자/전체 80,000자 한도에서 추출하고, PDF는 최대
  500 page의 selectable text만 page label과 함께 추출한다. scan, figure, equation-as-image와 layout은
  unavailable로 명시한다. 생성 시 copy의 byte length·SHA-256, frozen extraction content hash와 strict
  policy를 검증해 v3 manifest에 `[F#]` label, completeness와 함께 고정한다. per-install safeStorage key의
  versioned HMAC envelope가 managed manifest를 인증하므로 미래 PDF.js/문구 변경으로 과거 snapshot을 다시
  해석하지 않으면서 변조는 fail-closed로 거부한다.
- file source는 Main-generated `sourceSetId`의 1시간 staging set으로 시작한다. 같은 set의 mutation은 keyed
  FIFO queue로 직렬화하고 claim lease를 사용해 동시 append 유실·budget 우회·중복 claim을 차단한다. create가 Main-generated Studio
  ID로 선택 copy를 claim하고 manifest preflight와 SQLCipher create까지 성공한 뒤 staging을 폐기한다. 실패
  시 claimed copy를 rollback한다. rollback file cleanup도 실패하면 orphan은 startup reconciliation에 남기지만
  process-local claim lease는 즉시 해제해 같은 staging set을 현재 session에서 재시도할 수 있다. 취소·project
  변경·unmount와 bounded startup expiry cleanup이 orphan staging을
  정리한다. recoverable Trash 동안 Studio copy를 보존하고 permanent Lecture purge 뒤에만 그 managed copy를
  제거한다. SQL purge 뒤 filesystem 정리가 실패하면 다음 startup이 active·trashed Studio identity와 exact
  managed manifest를 대조해 orphan Studio/claim directory를 bounded reconciliation한다. 사용자의 원본 file은
  건드리지 않는다.
- revision이 있는 Lecture assistant의 한 edit에는 `.tex/.md/.markdown/.pdf`를 최대 5개 첨부할 수 있다.
  Renderer는 Studio ID와 opaque attachment ID만 보내고 Main이 output project와 lifecycle/version을 다시
  검증한다. picker 뒤 상태가 바뀌면 새 copy를 폐기하며 snapshot/release는 같은 keyed queue에서 직렬화한다.
  send는 bytes·source SHA·extraction SHA가 일치하는 frozen snapshot만 사용하고 lease를 갱신한다. 성공 revision은
  v4 manifest에 `[A1]…[A5]` bounded content와 hash를 보존하며, SQL commit 뒤에만 staged original을 consume한다.
  실패·cancel은 staging을 보존해 같은 ID로 retry할 수 있고 다음 edit에는 자동 상속하지 않는다. 성공 user
  message에는 path/body/Studio ID 없는 bounded filename·format·hash receipt만 남는다. 다음 edit prompt는 이전
  `[A#]` 인용·Sources mapping과 과거 chat의 attachment label을 중립화해 ordinal 재사용이 evidence를 바꾸지 못하게 한다.
- Overleaf Git URL은 새로운 live-source path를 만들지 않고 Manuscript의 create/connect/fetch-checkpoint
  boundary를 재사용한다. personal token은 Settings fixed IPC에서만 입력되고 Lecture import
  contract에는 token field가 없다. 새 link는 Settings token의 immutable·workspace-bound encrypted snapshot을
  받으며, Settings 교체·삭제는 향후 link에만 영향을 준다. 삭제는 Overleaf token revoke가 아니다.
  URL/token을 receipt·Lecture manifest·Renderer persistence에 복사하지 않는다. imported checkpoint는
  일반 `[M#]` source이고 이후 live edit는
  다시 capture하기 전까지 반영하지 않는다.
- candidate picker는 현재 page의 idea ID만 SQL window query로 조회해 idea별 최신 metric 1개와 total count를
  받는다. generation은 선택한 idea ID만 다시 조회해 최신 64개를 오름차순으로 고정하므로 project 전체
  metric history를 IPC나 prompt로 가져오지 않는다.
- 매 revision은 자기 source manifest와 SHA-256을 append-only로 보존한다. 다음 revision에서 source가
  바뀌더라도 이전 manifest는 수정하지 않는다.

이 manifest는 교육용 synthesis의 provenance이다. Captured manuscript source를 읽었다는 사실은 표시할 수
있지만 published-paper evidence verification이나 systematic review를 대체하지 않는다.

### 3. Lecture와 timed talk

`lecture`는 재사용 가능한 lecture notes와 teaching deck을 만든다. `talk`는 10, 20, 30, 50분 중 하나를
필수로 선택하고 duration별 bounded slide budget을 적용한다. 생성 전에 notes page target, compiled slide
page count, detail level, notes/slides structure와 최대 6,000자의 추가 지시를 선택할 수 있고 SQLCipher
configuration에 보존한다.

Settings의 application-local `Lecture defaults`는 새 Studio에 복사할 structure를 편집한다. `adaptive`는
selected source에 맞춰 section 이름과 개념 순서를 정한다. `custom`은 1~12개의 ordered row를 두며 row마다
`notes-and-slides|notes-only` coverage를 선택한다. notes는 모든 row를 순서대로 다루고 slides는 shared row만
같은 상대 순서로 압축한다. section 이름은 trim·NFC 뒤 최대 80자, case-insensitive unique plain text여야 하며
hidden/control character, bracket·brace·angle-bracket markup, reserved `Title|Title slide|Sources used`를
거부한다. 적어도 한 row는 두 문서가 공유해야 한다. optional `Load GOSU outline`은 bounded starter row를
불러올 뿐 system policy가 아니다.

이 structure는 content flow만 정한다. Studio/document title과 slide title page, inline evidence label 규칙,
frozen source manifest provenance, article/Beamer preamble·wrapper, 허용 LaTeX grammar, validation과 compile은
GOSU가 잠가 관리한다. custom structure는 `Sources used`를 section row로 소유하거나 표시 여부를 결정하지
않는다. visible final `Sources used` list는 새 draft에 기본 포함하지만 Lecture Assistant에 보낸 최신 명시적 사용자
요청으로 생략하거나 다시 표시할 수 있다. current draft에서 이미 생략한 상태는 명시적인 복원 요청 전까지
유지한다. 표시 여부와 무관하게 inline evidence label은 frozen manifest에 존재해야 하며, list가 보일 때는 사용한
모든 label에 대응하는 source entry를 완전히 제공해야 한다. 새 Studio는 생성 시점의 Settings structure를 full
generation brief로 한 번 snapshot하고, Settings의 후속 변경은 기존 Studio나 revision에 소급 적용되지 않는다. legacy
`generation_brief_json`에 structure field가 없으면 다른 generation control을 보존한 채 explicit `adaptive`로
normalize한다. structure와 generation brief는 unknown key를 거부하는 strict schema이고 normalized full
brief JSON은 최대 14,000자로 제한한다.

생성 후에도 Studio의 compact `Edit options`에서 notes target, slides target, detail, structure, 추가 지시의
다섯 field 전체를 수정할 수 있다. `Load Settings default`는 현재 default를 draft로 명시적으로 copy한 뒤 Save를
요구한다. update는
`expectedVersion`으로 fence하고 `draft|ready|failed`이면서 active attempt와 Trash 상태가 아닐 때만
brief·version·`updatedAt`을 원자적으로 바꾼다. 동일한 normalized 값은 version을 올리지 않는 no-op이며,
저장된 값은 다음 generation/retry와 Lecture chat edit부터 적용한다. 기존 immutable revision, frozen source
manifest와 artifact에는 소급 적용하지 않는다.
notes와 slides는 항상 완전한 canonical LaTeX replacement pair다. notes는 GOSU가 소유한 article preamble,
slides는 고정 Beamer preamble과 title frame을 사용하고 model은 allowlisted body만 반환한다.
두 exact document가 모두 sandboxed XeLaTeX acceptance compile을 통과한 뒤에만 Research Notes artifact와
SQLCipher revision을 commit한다. 한쪽이라도 컴파일되지 않으면 기존 revision을 유지하고 새 파일을 공개하지
않는다.

전용 Lecture chat의 user/assistant message는 Lecture-owned SQLCipher table에 저장한다. Project Chat session,
queue, profile, tool grant와 message history는 읽거나 수정하지 않는다. 수정 요청 하나가 성공할 때마다 새
immutable revision을 만들고 과거 revision을 덮어쓰지 않는다.
한-turn 첨부가 있는 user message는 strict `attachments_json` receipt를 함께 저장한다. bounded extracted text는
모델에 전달된 성공 revision의 v4 provenance로 남고 original path/file은 남지 않는다. assistant message나
중복 attachment ID는 이 field를 가질 수 없다.

일반 desktop layout은 접을 수 있는 Studio session rail, 항상 중앙에 남는 document preview, 접을 수 있는
오른쪽 Lecture assistant rail의 3열이다. 사용자는 notes·slides·PDF를 보면서 오른쪽 chat으로 수정하며 rail
visibility만 localStorage preference로 보존한다. resizable Projects rail 때문에 실제 Lecture content 폭이
좁아지면 container query가 assistant와 session list를 edge control이 남는 overlay drawer로 바꿔 preview와
복원 control을 보존한다. 생성 form과 assistant rail은 live provider catalog의 opaque
model ID 및 그 model의 native reasoning option을 선택한다. model 변경 시 reasoning preference를 초기화하고,
사라진 selection은 임의 fallback하지 않는다. local preference와 별개로 실제 invocation은 revision/message에
계속 저장한다.

Settings의 application-local AI default는 provider `Auto`와 opaque native reasoning ID `high`로 시작한다.
저장된 model preference가 없는 새 Studio는 이 pair를 한 번 복사하고 이후 Studio별 picker가 독립적으로
소유한다. Settings 변경은 기존 Studio, 생성 중 attempt, revision/message provenance를 바꾸지 않는다.
effective provider-default model이 `high`를 광고하지 않거나 저장된 ID가 catalog에서 사라지면 더 낮은
reasoning으로 조용히 바꾸지 않고 생성 전에 명시적 재선택을 요구한다. reasoning option 목록과 label은 계속
live `model/list`만 사용한다.

현재 revision의 center preview는 canonical LaTeX source와 ephemeral local PDF를 전환한다. preview compile은
revision content hash와 고정 GOSU document envelope를 검증한 뒤 macOS sandbox에서 XeLaTeX를
no-shell-escape·network deny·resource budget으로 실행한다. 검증된 PDF bytes만 typed IPC와 PDF.js continuous
page viewer로 전달하며 canonical Research Notes artifact는 `.tex`다. 사용자는 같은 화면의 Lecture 전용
chat으로 수정 지시를 보내고 새 revision의 LaTeX/PDF를 다시 확인한다. schema v1의 기존 Markdown revision은
읽기와 legacy compile 호환만 유지한다.

현재 revision은 LaTeX/PDF export, default application open, Finder reveal을 제공한다. Renderer는 절대
path나 bytes를 제출하지 않고 exact studio/revision/kind/artifact hash와 requested format fence만 보낸다. Main은 LaTeX action
전에 Vault binding·ownership·file identity·artifact SHA를 재검증하고, PDF action은 DB revision을 다시
sandbox compile해 PDF magic·size·SHA를 검증한다. export는 save dialog와 atomic write를 사용한다. PDF default
open과 PDF-tab Finder reveal은 app-owned bounded cache의 derived copy를 만들고 Finder는 그 exact PDF를
선택한다. source tab의 Finder reveal만 canonical `.tex` 또는 legacy `.md`를 선택한다. absolute path는 IPC
receipt에 포함하지 않고, PDF cache reveal receipt의 project-relative source path는 `null`이다. PDF copy는
canonical Lecture artifact가 아니다. derived PDF cache는 7일 TTL, 최대 12개와 총 128 MiB quota를 함께 적용한다.

아직 전송하지 않은 studio별 draft는 DesktopApp이 소유한 renderer-session volatile map에만 둔다. Lecture
view가 tab 전환으로 unmount/remount되어도 같은 앱 session에서는 복원하지만, 앱 종료 시 폐기하며 SQLCipher,
localStorage, Hosted Sync 또는 telemetry에 기록하지 않는다.

### 4. Bounded Codex generation과 evidence gate

Electron Main만 local Codex App Server를 호출한다. Studio turn은 web search, shell, filesystem, Apps/MCP와
dynamic tool을 모두 비활성화하고, source manifest·현재 draft·최근 Lecture chat·generation brief·현재
request만 untrusted prompt data로 전달한다. 실제 requested/resolved model과 reasoning invocation을 revision에
기록하며 model이 사라져도 임의 fallback하지 않는다. 생성 attempt의 timeout은 transport connection과
분리한다. initial turn과 필요한
경우의 한 correction turn은 matching progress마다 갱신되는 새 3분 idle timer를 각각 가지며, 두 turn은 같은
30분 absolute hard deadline을 공유한다. timeout과 terminal failure, 실제 Codex start/transport unavailable을
서로 다른 typed error로 표시한다.
각 `runTurn` control-plane request는 App Server의 별도 최대 30초 request bound를 가지며, Main은 응답 직후
공유 hard deadline과 cancel state를 다시 검사해 늦게 도착한 turn을 승인하거나 저장하지 않는다.
Main은 generation 중 source 준비, model 시작·draft/activity, validator, 한 번의 correction, 두 PDF compile,
revision 저장을 나타내는 고정 phase event만 Renderer에 보낸다. event에는 studio/attempt identity, 단조 증가
sequence와 시작·발생 timestamp만 있고 raw notification, reasoning, source/output text, provider message,
thread/turn ID, path나 credential은 없다. model activity는 최대 5초에 한 번으로 제한하며 Renderer는 같은 연속
phase를 합쳐 경과 시간과 최근 12개 activity만 표시한다. live progress event 자체는 ephemeral이다. 별도의
content-free attempt row에는 semantic phase의 첫 시각, requested/resolved model identity, initial·correction의
고정 validation category와 notes/slides별 reason·token 개수, terminal code만 bounded하게 저장한다. 임의 token
문자열, raw notification, prompt/source/output, provider message, compiler stderr, thread/turn ID와 path는
SQLCipher·Renderer·Hosted Sync·telemetry에 저장하지 않는다.

직렬화된 prompt는 최대 360,000자, source manifest는 최대 120,000자로 제한한다. captured source 전체는
chunk로 hash/length를 검증하되 prompt/manifest content에는 policy와 completeness가 표시된 deterministic exact
extract를 넣는다. 이 bounded manifest, 현재 notes/slides와 이번 user request는 모델이 실제로 보는 값과 저장되는
provenance가 같아야 하므로 그 이후에는 자르지 않는다. 이 authoritative context가 한도를 넘으면 `lecture_context_too_large`로 Codex 호출 전에
fail closed한다. 최근 12개 성공 chat message만 별도 bounded history로 축약할 수 있고, 잘린 history에는
명시적인 marker를 넣는다. 실패·취소·restart로 중단된 요청은 `failed|interrupted`로 원자적으로 기록하고 이후
prompt history에서 제외한다. Main은 structured response를 저장하기 전에 다음을 검증한다.

- visible final `Sources used` list는 새 draft에 기본 포함한다. 현재 요청과 최근 Studio chat에서 Lecture Assistant에
  보낸 가장 최신의 명시적 사용자 지시가 생략·복원 mode를 결정하고, current draft에서 이미 생략했으면 명시적
  복원 지시 전까지 생략을 유지한다. GOSU는 어느 mode에서도 title/frame document wrapper를 소유한다.
- notes/slides의 inline `[P#]`, `[E#]`, `[M#]`, `[F#]` 또는 `[A#]` evidence label과 substantive frame별 label은
  항상 필수이고 모든 인용 label은 frozen source manifest에 존재해야 한다. revision은 그 provenance를 보존한다.
- `Sources used` list가 보일 때는 사용한 모든 label에 대응하는 source entry를 완전히 제공해야 한다.
- 임의 citation syntax, raw HTML/Markdown structure, document wrapper, raw TeX comment, 외부 file/network
  command와 allowlist 밖 command/environment를 거부한다.
- timed talk의 slide count가 선택한 duration budget 안에 있다.

authoring policy v6는 위 visibility contract와 JSON body string의 모든 LaTeX backslash를 `\\`로 encode하는
transport contract를 함께 고정한다. 새 generated body에서 U+0008·U+000C로 decode된 raw `\b`·`\f`만
literal backslash prefix로 복원한 뒤 전체 validator를 다시
통과시키고, TAB·CR 또는 `\n...` command로 해석될 수 있는 모호한 line break는
`ambiguous_json_backslash_escape`로 fail closed한다. 기존 canonical artifact에는 이 transport normalization을
적용하지 않는다. validator grammar는 고정 preamble이 실제 load한 AMS matrix/alignment,
`samepage|subequations|alignat`, command math delimiter, `arg`, `longmapsto`, notes-only `qedhere`,
`operatorname*`, `binom`, `mid`, `\|`, `Vert`, `langle`, `rangle`, `pmod`, `nonumber`, `intertext` 계열 수학 command,
안전한 table·booktabs layout과
Beamer `columns|column`을 포함하는 bounded dialect다. developer instruction은 prose의 `%|#|&|_` escape,
raw `~` 금지, balanced delimiter/environment와 source-defined macro의 primitive expansion을 명시하므로 모델
contract와 validator가 같은 문법을 말한다. HTML 검사는 math context를 구분해 정상 부등호 `<|>`를 tag로
오인하지 않고 math 밖의 실제 tag·comment만 거부한다. 새 slide는 한 frame이 정확히 한 PDF page가 되도록
optional frame argument, overlay specification·command와 `allowframebreaks`를 길이·줄바꿈과 무관하게
거부하되, 이전 release에서 commit된 canonical overlay artifact는 read/export compatibility를 유지한다.

첫 candidate가 JSON parse, exact schema, bounded LaTeX grammar, citation mapping 또는 slide count에서
거부되면 같은 Codex thread에 safe category와 고정 교정 지시만 보내 complete pair를 최대 한 번 다시 생성한다.
LaTeX grammar 거부는 notes/slides별 고정 reason ID와 엄격히 정규화·중복 제거한 최대 32개 command 또는
environment token 예시만 전달한다. raw candidate·임의 parser message·source text·path는 prompt나
persistence에 다시 넣지 않고 initial turn의 frozen manifest, current draft와 generation brief를 그대로 사용한다.
두 subturn은 위 absolute hard deadline을 공유하고 correction은 새 idle timer를 가진다.
거부된 candidate는 compile, Research Notes staging 또는 SQL revision에 진입하지 않는다. correction도 실패하면
`response_json|response_schema|latex_grammar|citation_mapping|slide_count`에 대응하는 bounded public error code만
노출하며 raw model output이나 parser detail은 저장·표시하지 않는다. 성공하면 최종 승인 turn의 actual model
invocation만 revision provenance에 기록한다.

고정 developer instruction에는 versioned authoring policy를 둔다. 이 policy는 generation brief의 custom
instruction, revision request, 이전 chat, draft와 source manifest보다 높은 instruction 계층이며 이 untrusted
data가 policy를 변경하거나 해제할 수 없다. policy는 notes/slides가 공통 outline·용어·notation·assumption·
equation·citation·conclusion을 유지하고, 각 substantive slide가 notes의 대응 근거를 가지도록 요구한다.
정의·가정·domain·quantifier·dimension/shape·unit·boundary condition을 필요한 위치에 명시하며, 근거가 없는
theorem/proof/derivation/equation/result를 만들지 않는다. source에 없는 proof step은 일반 지식으로 메우지
않고 evidence gap으로 표시한다. 한쪽만 수정하라는 request도 두 LaTeX body의 complete replacement pair에
consistency update를 적용한다. 수학은 동일한 정의·기호를 쓰는 LaTeX math mode와 bounded
`equation|align|aligned|gather|matrix|cases|split|array|tabular` 환경으로 표현한다.

generation brief는 strict·bounded untrusted JSON task data로 정확히 한 번 직렬화하고 section 이름을 developer
instruction에 보간하지 않는다. `custom` section 이름은 literal topic과 order label일 뿐 instruction이 아니다.
notes는 모든 row를, slides는 `notes-and-slides` row만 상대 순서를 지켜 다루며, 어떤 row도 title, inline citation
규칙, wrapper, LaTeX policy를 변경하거나 developer policy를 opt-out할 수 없다. custom row는 `Sources used`를
예약하거나 visibility를 결정할 수 없고, visibility는 Lecture Assistant에 보낸 최신 명시적 사용자 요청으로만
생략·복원한다.

이 검사는 fabricated claim을 완전히 판별하는 사실 검증기가 아니다. metadata-only 한계를 출력에 유지하고
full text를 읽었다는 표현을 금지하는 bounded structural/evidence gate다.

### 5. SQLCipher state와 Research Notes artifact commit

Lecture module은 `lecture_studios`, `lecture_studio_messages`, `lecture_studio_revisions`와 content-free
`lecture_studio_attempts`를 소유한다. configuration과 turn start는 optimistic version과 attempt fencing을
사용하고, running attempt 생성은 Studio begin과, terminal attempt는 assistant message·revision·studio
completion 또는 failure와 한 SQLCipher transaction으로 commit한다. restart에서 실행 중이던 turn은 무인
재호출하지 않고 Studio와 attempt를 함께 bounded `application_interrupted` state로 reconciliation한다. Studio
detail은 최신 attempt 하나만 반환하며 attempt 도입 전 Studio는 `null`로 호환한다. 성공 attempt와 현재
running attempt는 보존하고, revision·message 없는 반복 실패가 DB를 무한히 키우지 않도록 각 Studio의
`failed|interrupted` attempt는 시작 시각과 row 순서 기준 최신 100건만 유지한다.
Studio/message/revision capacity는 SQL trigger와 같은 Main preflight로 turn 시작 transaction 안에서 확인해
Codex 호출 뒤 저장 실패를 막고, 한도 도달은 `lecture_capacity_reached`로 명시한다.

새 canonical LaTeX commit은 revision schema v3를 쓴다. v3는 exact notes/slides와 normalized full
`generationBriefSnapshot`, 그 canonical JSON의 SHA-256, authoring policy version과 developer-instruction
SHA-256을 append-only로 함께 저장한다. SQL read는 full brief를 strict value schema로 다시 parse하고 hash를
재계산해 mismatch 또는 네 provenance column 중 일부만 존재하는 row를 fail closed한다. 기존 schema v1
Markdown과 provenance가 없던 v2 LaTeX revision은 read/export 호환을 유지하며 현재 Settings default로
backfill하거나 수정하지 않는다. authoring policy v6 전환은 기존 v3 provenance field에 새 version/hash를 기록할
뿐 schema 또는 revision migration을 요구하지 않는다.

Studio 삭제는 recoverable lifecycle이다. `trashed_at`이 설정된 Studio는 기본 summary list와
detail/generation surface에서 제외하지만 message, revision, frozen manifest와 artifact reference는 보존한다.
Settings의 workspace-level `Trash` 화면은 Project, Lecture Studio와 deleted Board task를 type별 group으로
함께 표시하고 같은 Studio ID로 restore할 수 있다. 영구 제거는 `EMPTY LECTURE TRASH` typed phrase와 OS
confirmation을 모두 거친 별도 Lecture command만 허용하며, append-only purge receipt를 구성한 한 immediate
SQLCipher transaction에서 trashed Studio row와 owned message/revision만 cascade한다. Command는 확인 화면의
trashed Studio 전체를 `studioId`/`version`/`trashedAt` exact target fence로 고정한다.
transaction은 저장된 idempotency receipt를 먼저 찾고, receipt가 없을 때만 현재 Trash 전체 집합을 target과
비교한다. 추가·복원·version/timestamp 변경은 `lecture_trash_changed`로 fail closed하며 삭제나 receipt 기록을
전혀 하지 않는다. exact row delete도 같은 version과 Trash timestamp를 predicate로 재검증한다.
Research Notes와 exported TeX/PDF, Manuscript/Overleaf checkpoint와 selected source module의 record는 외부 연구 data이므로
purge하지 않는다. 해당 Studio용으로 Main이 만든 local external-source copy만 SQL purge 확정 뒤 제거한다.
active Studio는 100개, recoverable Trash는 1,000개로 별도 제한하고 insert trigger가 두 경계를 모두
검사한다. purge command의 UUID idempotency key가 재전송되면 저장된 append-only receipt를 반환한다.

통합 `Trash`는 Project와 Lecture의 서로 다른 transaction·lifecycle lock·confirmation·receipt를 Renderer에서
하나의 비원자적 `Empty All`로 묶지 않는다. 각 group의 영구 제거는 독립적으로 실행하고, Board task는 별도
permanent purge contract가 없으므로 이 화면에서 복원만 제공한다. trashed Project 안의 task는 Project 보존
count에 포함해 task group에 중복 표시하지 않는다. Project purge는 해당 Project를 참조하는 active 또는
trashed Lecture Studio가 남아 있으면 fail closed하고, UI는 관련 Studio를 먼저 영구 제거하거나 Project를
복원하도록 안내한다.

Codex를 호출하기 전에 Main이 output project의 Vault grant, binding과 ownership marker를 preflight한다.
생성된 notes와 slides는 `GOSU/<output project>/Lecture Notes & Slides` 아래 새 revision bundle로만
저장한다. 두 canonical `.tex`와 durable journal을 같은 hidden staging directory에 쓰고 file·directory를 fsync한
뒤 directory rename으로 한 번에 공개한다. bundle publish 전에 일반 revision folder와 분리된 project-local
hidden pending index를 fsync하고 durable round-robin cursor로 bounded scan한다. 따라서 확정 revision이
256개를 넘어도 새 pending journal이 starvation되지 않는다. 새 v3 deterministic bundle identity는
source-manifest SHA-256, generation-brief SHA-256과 authoring-policy version/SHA-256을 포함하고 pending journal은
여기에 두 file content SHA-256까지 함께 보존하며 full brief나 prompt body는 복사하지 않는다. crash
reconciliation은 pending identity와 committed SQL v3 revision의 generation/policy provenance 및 artifact
hash가 모두 일치할 때만 seal·recover한다. 하나라도
다르면 사용자 file을 보존하고 fail closed한다. provenance field가 없던 legacy journal은 호환해서 읽되 v3
identity로 backfill하지 않는다. SQL completion이 실패하면 journal과 exact SHA-256을 확인한 뒤 그 bundle
전체를 rollback한다. crash로 journal이 남으면 다음 시도에서 exact project/binding/revision/hash를 reconcile한
뒤 정리하거나 복구한다. orphan index는 exact identity가 일치할 때만 제거하며 충돌하는 사용자 file은 건드리지
않는다. 성공 뒤에는 journal을 제거하고 UI와 assistant receipt에 실제
project-relative 두 path를 표시한다.

이 방식은 SQLCipher와 filesystem 사이의 cross-store ACID transaction이라고 주장하지 않는다. 같은
revision의 반쪽 파일이나 무음 overwrite를 막는 durable journal, atomic directory publish와 exact-hash
reconciliation protocol이다. 기존 사용자 note와 이전 revision은 삭제·교체하지 않는다.

## Alternatives considered

### 각 project에 Lecture tab 유지

탐색은 단순하지만 여러 project를 선택할 때 어느 tab이 source와 output을 소유하는지 모호하고 동일한
studio를 중복 생성하게 되어 거절했다.

### Project Chat을 그대로 사용

이미 연결된 Codex harness를 재사용할 수 있지만 project-scoped context, tool grant, queue와 대화 provenance가
다른 project의 evidence와 섞인다. Codex transport는 공유하되 Lecture service와 history는 분리한다.

### 모든 source project에 결과 복제

발견성은 높지만 어느 copy가 원본인지 불명확하고 rename·부분 실패·동시 편집 복구가 복잡하다. 선택한 한
output project만 artifact를 소유하고 다른 project는 frozen source reference로 남긴다.

### 바로 PPTX/PDF만 canonical artifact로 생성

배포 가능한 결과에는 유리하지만 editable source와 재현 가능한 compiler input을 잃는다. canonical output은
Obsidian에서 편집 가능한 self-contained article/Beamer `.tex` pair로 두고 exact revision을 검토하기 위한
sandboxed local PDF preview와 명시적 PDF export를 파생한다. PPTX engine은 후속 범위다.

## Consequences

장점:

- 여러 project의 captured manuscript·paper metadata·experiment evidence와 사용자가 지정한
  `.tex/.md/.pdf`·Overleaf checkpoint를 하나의 lecture나 talk로 합성할 수 있다.
- Project Chat과 Lecture 수정 history, 권한과 failure domain이 섞이지 않는다.
- 각 revision의 source, full generation brief, authoring policy, model, artifact path와 hash를 추적하고 이전
  결과를 보존한다.
- Vault나 Codex 장애가 Kanban, Literature, Experiment와 기존 note 읽기를 막지 않는다.

비용과 한계:

- output project의 Research Notes 연결이 없으면 generation을 시작하지 않는다.
- Literature published full text와 PDF figure/layout, live/uncaptured Manuscript·Overleaf section은 source가
  아니다. 사용자가 추가한 PDF도 selectable text만 사용한다.
- duration은 slide budget이지 실제 rehearsal time 보증이 아니다.
- PPTX, theme template, presenter notes export와 공동 편집은 후속 범위다. local PDF preview는 ephemeral이고
  사용자가 명시적으로 export한 PDF만 derived durable copy가 된다.
- source 변경은 기존 revision을 재작성하지 않고 다음 revision의 새 manifest로만 반영된다.

## Verification

- global navigation과 project child navigation의 분리
- 여러 project source 선택, output-project membership과 active/trash isolation
- included/reviewed Literature 기본값, captured Manuscript 선택·`[M#]` provenance, review status·manual topic 보존, metadata-only 표시
- local `.tex/.md/.pdf` native picker, strict size/count/UTF-8/PDF-text 경계, `[F#]` provenance와 path 비노출
- Settings personal token → link별 encrypted snapshot → exact Manuscript checkpoint 연결과 URL/token 비노출
- external-source staging claim/create/discard, create 실패 rollback, expiry cleanup과 permanent-trash purge
- bounded in-memory candidate offset paging과 최신 metric tail/truncation
- summary list와 selected-studio detail payload 분리
- 10/20/30/50분 duration과 slide budget
- Settings `Lecture defaults`의 adaptive/custom ordered row·coverage validation, 새 Studio snapshot과 기존 Studio
  non-retroactivity
- notes/slides page target, detail level, structure, 추가 prompt의 legacy-adaptive·SQLCipher round-trip과
  future-only `Edit options`
- Project Chat과 분리된 message/revision persistence
- 전용 chat 옆 LaTeX/PDF 전환, exact revision hash compile과 다중-page scroll
- session/assistant rail 독립 collapse와 center preview 보존, Studio별 dynamic model/reasoning selection
- 최소 window·최대 Projects rail에서 overlay drawer 전환, 복원 control 접근성과 horizontal overflow 방지
- exact artifact fence 기반 LaTeX/PDF export·default-app open·Finder reveal과 absolute-path 비노출
- derived PDF open cache의 TTL·count·total-byte quota
- Codex tool/web denial, progress-aware idle/hard timeout, dynamic model invocation provenance와 cancel fencing
- raw HTML/Markdown/unsafe TeX, unknown citation, uncited substantive frame, default-visible/explicit
  omit·restore mode 위반과 visible `Sources used`의 incomplete mapping 거부
- v3 revision의 full generation brief/hash·authoring policy provenance, mismatched brief hash fail-closed와 v1/v2 read
  compatibility
- Vault preflight, staged bundle의 second-file/SQL failure, generation/policy/file hash를 포함한 crash journal
  reconciliation과 exact path receipt
- restart, duplicate/out-of-order completion과 optimistic version conflict
- recoverable Studio Trash·same-ID restore, active-generation rejection, typed permanent purge와
  Research Notes/TeX/PDF preservation
