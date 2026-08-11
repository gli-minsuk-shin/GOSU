# ADR 0004: Pluggable manuscript collaboration engine

- Status: Accepted
- Date: 2026-08-11
- Owners: Manuscript, Review & Approval, Integration Hub, AI Gateway

## Context

GOSU는 먼저 공식 Overleaf Git bridge로 공동저자가 Overleaf 웹에서 만든 revision을 가져오되,
장기적으로는 local 또는 cloud에서 자체 LaTeX editor·compile·presence·comment·realtime merge engine을
제공할 수 있어야 한다. Project Chat, Review, Reference와 Manuscript 화면이 Overleaf URL, `master`, Git
token 또는 provider별 revision 의미를 직접 소유하면 나중에 engine을 교체할 때 모든 consumer를 다시
작성해야 한다.

Overleaf 웹의 동시 편집은 Git이 아니라 Overleaf 내부 realtime engine이 소유한다. 공식 Git integration은
그 상태를 단일 선형 Git revision으로 노출하는 checkpoint bridge이며 범용 realtime API가 아니다. 따라서
Overleaf Git을 자동 양방향 sync처럼 사용하거나 GOSU와 Overleaf를 동시에 write authority로 두면 conflict,
stale push, comment·Track Changes 손실 위험이 생긴다.

## Decision

### 1. Portable core와 provider-private edge를 분리한다

`packages/contracts`는 다음 provider-neutral v1 계약을 소유한다.

- `ManuscriptWorkspaceDescriptorV1`: opaque provider ID, workspace 종류, collaboration model, 실제 capability
- `ManuscriptWorkspaceBindingV1`: project·manuscript·provider identity, capability snapshot, authority, version
- `ManuscriptCheckpointV1`: provider/GOSU revision, cursor, root TeX document, lineage, actor, 관찰 시각
- `ManuscriptSyncAnchorV1`과 `ManuscriptSyncState`: 공통 revision 관계와 명시적 상태
- `ManuscriptSyncAttemptV1`: 후속 durable scheduler가 사용할 versioned attempt shape

portable binding과 checkpoint에는 URL, token, filesystem path, provider workspace locator, 원고 본문과 raw
diff를 넣지 않는다. provider-private 연결 정보는 `bindingId`로 연결된 adapter 전용 저장소에 둔다.

`packages/integrations`의 `ManuscriptWorkspaceAdapter`와 registry가 inspect, checkpoint fetch/publish와
adapter-private artifact 확인·정리를 정의한다. capability를 선언하고 실제 interaction-mode operation을
구현하지 않거나, 선언하지 않은 operation을 제공하면 registry construction이 실패한다. 현재 boolean
capability는 provider fact일 뿐 presence, comment, tracked changes, compile 또는 editor operation이 실제로
호출 가능하다는 뜻이 아니다. 이 기능들은 후속 versioned port가 생긴 뒤에만 consumer에 노출한다.

Provider onboarding은 아직 완전히 schema-driven하지 않다. 현재 Overleaf URL·token form과 private DB
transaction은 Desktop의 Overleaf connector가 소유한다. 새 local/cloud provider를 추가할 때 core checkpoint
consumer는 유지하지만 해당 provider의 onboarding panel, credential/configuration persistence와 adapter를
추가해야 한다. “새 provider를 consumer 변경 없이 설치”하는 plugin surface는 후속 범위다.

### 2. 현재 vertical slice는 existing Overleaf project의 inbound checkpoint만 지원한다

등록된 `overleaf_git` descriptor는 다음만 선언한다.

- 기존 official HTTPS Overleaf Git project 연결
- Overleaf 웹을 외부 realtime editor로 열기
- remote `master` HEAD 확인
- 사용자가 요청한 exact revision의 manual checkpoint fetch

GOSU는 fetch 전에 reviewed revision이 그대로인지 다시 확인하고, root TeX document가 그 revision의 regular
Git blob인지 검증한다. 받은 commit은 binding별 isolated bare mirror의 immutable GOSU ref로 보관하고 기존
Repository worktree에 merge·rebase·checkout하지 않는다. 같은 provider revision의 재시도는 checkpoint
metadata를 중복 생성하지 않으며, 로컬 artifact가 사라졌다면 같은 revision을 다시 받아 복구한다.

현재 checkpoint capture는 검증된 Git object와 provenance receipt를 보관하는 transport 단계다. capture한
exact revision에 한해 Project Chat의 bounded file list·UTF-8 chunk read와 Manuscript의 local MacTeX
preview compile을 요청할 수 있다. capture receipt 자체는 local mirror·source tree·compiler·sandbox
preflight가 아니며 실제 tool operation이 checkpoint를 다시 검증하고 실패를 별도 반환한다. 이는 live Overleaf edit를 읽거나
source를 GOSU draft branch로 import·diff하거나 review candidate로 승격하는 행위가 아니다. 따라서 UI도
`sync` 또는 `review proposal`이 아니라 `inbound checkpoint capture`와 `local preview`로 표시한다.

기존 immutable ZIP/Open-in-Overleaf helper는 별도 legacy bootstrap path로 유지한다. 현재 adapter는
`bootstrap_export`를 선언하거나 구현하지 않는다. 기존 Overleaf project로 push, background polling,
force operation, GitHub PR 생성, Overleaf server-side compile/PDF fetch, comment·Track Changes round-trip과
undocumented realtime protocol은
현재 범위가 아니다.

### 3. Link는 authority handoff가 아니다

현재 연결은 binding의 `authority`를 `gosu`로 유지한다. 공동저자는 Overleaf 웹에서 편집할 수 있지만 GOSU가
가져온 revision은 향후 import review의 입력이 될 수 있는 transport checkpoint이지, 아직 검토 가능한
proposal이나 GOSU/GitHub 원고를 대체하는 authority가 아니다. UI는 이 경계를 표시하며 자동 import,
merge나 publish를 실행하지 않는다.

후속 explicit handoff command가 구현되면 다음 상태를 별도 승인과 함께 적용한다.

1. `GOSU draft`: GOSU/GitHub approved revision이 draft authority다.
2. `Provider collaboration`: 사람의 승인으로 provider가 working authority가 되고 GOSU 변경은 proposal만
   만든다.
3. `Import review`: provider checkpoint를 compile·citation·diff gate 뒤 별도 branch/review로 가져온다.
4. `Publish window`: exact reviewed base에서만 조건부 publish한다.

그 전까지 provider authority, automatic conflict resolution 또는 bidirectional sync를 표시하지 않는다.

### 4. Revision identity와 source-content 증명을 구분한다

현재 Overleaf adapter의 `revisionEnvelopeDigest`는 provider ID, fetched commit OID와 tree OID를 묶은 SHA-256
identity envelope다. 이것은 provider revision이 바뀌었는지 확인하는 provenance 값이지 canonical LaTeX
source bytes의 content hash가 아니다.

Native engine migration이나 outbound publish를 추가하기 전에는 deterministic archive/tree serialization,
compile input set과 source-content digest를 별도 계약으로 정의하고 양쪽 import 결과를 검증해야 한다.

### 5. Secret, local artifact와 삭제 경계를 지킨다

- Renderer는 Git, Keychain, filesystem에 직접 접근하지 않고 고정된 typed IPC만 호출한다.
- Overleaf personal Git token은 GOSU 전용 user-data 파일에 Electron `safeStorage`로 암호화해 보관한다.
  macOS에서는 암호화 key가 Keychain으로 보호된다. 공유 `git-osxkeychain` entry를 읽거나 덮어쓰거나
  삭제하지 않는다. 각 연결은 overwrite되지 않는 immutable credential reference를 갖는다. 네트워크 Git
  child에는 redirect를 끈 상태에서 검증된 exact Overleaf project URL로 scope한 HTTP authorization config와
  child 전용 environment로만 전달하며 token을 process argument, SQLCipher, portable contract, URL, 영구 Git
  config, log, telemetry 또는 Hosted Sync에 저장하지 않는다.
- remote URL과 workspace ID는 adapter-private SQLCipher row에만 저장한다.
- bare mirror는 `userData/manuscript-workspaces/<binding UUID>` 아래에서만 만든다. binding UUID가 아닌 path는
  거부한다.
- source list/read/materialize는 pin된 commit·tree·revision envelope·root를 다시 검증하고
  symlink·gitlink·traversal·control character·`.git`·secret/key 의심 경로·Unicode/case collision을
  거부한다. Project Chat은 상대 경로와 최대 24,000자 text chunk만 받고 URL, token, local
  mirror path를 받지 않는다. 원고 본문은 자동 context가 아니라 explicit tool 결과다. exact materialization은
  `git archive` 대신 isolated `git cat-file --batch`로 blob을 읽고 declared size·type·Git blob hash를
  재검증해 `.gitattributes`의 `export-ignore`·`export-subst`가 source를 누락·변형하지 못하게 한다. 이전 버전
  crash 뒤 남은 strict `.gosu-archive-<UUID>` real directory만 startup migration cleanup이 제거하며
  symlink·file·lookalike·non-binding path는 보존한다.
- prototype PDF compile은 검증된 checkpoint만 일회성 directory에 materialize하고 macOS
  `sandbox-exec`에서 사용자가 고른 pdfLaTeX·XeLaTeX·LuaLaTeX 하나만 fixed `latexmk` argv로 실행하고
  fallback하지 않는다. 이 선택은 Overleaf compiler 설정을 읽은 값이 아니며 실제 engine·version을 provenance에
  기록한다. network deny, `-no-shell-escape`, captured source·MacTeX·system font/runtime만 허용하는 OS read
  allowlist, TeX `openin_any=p`, output/home-only write boundary, 120초 timeout, 192 MiB generated
  staging·50,000-entry·compiler-output·PDF-size budget을 적용한다. PDF magic·SHA-256 검증 후에만 bounded base64를
  typed IPC로 Renderer에 전달해 decoded-image·canvas pixel/dimension budget을 적용한 PDF.js canvas로 표시하고,
  한 번에 한 preview만 보유하며 absolute path·`file://`·temporary source를 노출하지 않는다.
  timeout·resource/output overflow·앱 종료에는 detached process group 전체를 종료하며 정상
  success/failure cleanup이 끝나지 못한 strict `.compile-XXXXXX` staging은 다음 startup에서 symlink와
  lookalike를 건드리지 않고 정리한다. 현재 MacTeX는 prototype dependency이며 Overleaf의 compiler·TeX Live
  설정과 일치함을 보장하지 않는다.
- fetch는 shallow exact-revision request를 사용하고 binding별 보관 mirror가 256 MiB 또는 전체 manuscript
  mirror가 1 GiB를 넘으면 checkpoint를 pin하지 않는다. 이는 retained-size guardrail이며 fetch 중 순간 disk
  사용량에 대한 OS-level hard quota는 아니다. fetch 뒤 validation이나 quota gate가 실패하면 pin되지 않은
  incoming ref의 reflog와 unreachable object를 즉시 prune한다.
- Empty Trash transaction은 manuscript metadata를 지우기 전에 binding/provider를 durable artifact-purge
  queue에 기록한다. adapter가 exact binding directory를 지운 뒤에만 queue row를 완료한다. 실패 row는 앱
  시작과 다음 Trash 정리에서 cursor pagination으로 재시도하고 다른 provider row를 막지 않는다.

disconnect와 permanent Trash는 credential reference도 별도 durable cleanup queue에 먼저 기록한다. 같은
provider credential을 참조하는 enabled binding이 하나라도 있으면 보존하고, 마지막 reference가 사라진 뒤
GOSU 소유 ciphertext를 지운 경우에만 ACK한다. legacy shared credential은 GOSU 소유권을 증명할 수 없으므로
`legacy-unowned` recovery marker로 처리해 외부 Git client의 entry를 삭제하지 않는다.

새 token은 동일 Overleaf workspace ID 단위 exclusive section에서 새 immutable reference와 `.pending`
marker로 staged한다. remote 검증 또는 binding transaction이 실패하면 그 새 reference만 rollback하므로 기존
정상 credential을 덮어쓰지 않는다. DB commit 뒤 marker 정리 전에 앱이 종료되면 다음 시작에서 SQLCipher가
실제로 참조하는 pending credential은 commit하고, 참조하지 않는 pending ciphertext는 제거한다. connect,
inspect, fetch와 credential cleanup은 project가 달라도 같은 provider/workspace lock을 공유한다.

### 6. 동시성 보장은 현재 범위를 정확히 표시한다

현재 Desktop service는 project별 in-process exclusive queue, optimistic binding version과
`(bindingId, providerRevision)` unique checkpoint receipt로 한 앱 process 안의 중복 metadata를 막는다.
stale observed revision은 `blocked`로 기록하고 임의 fallback하지 않는다.

`ManuscriptSyncAttemptV1`, idempotency key와 fencing token shape는 정의됐지만 durable attempt table,
cross-process lease, crash reconciliation과 publish scheduler는 아직 연결되지 않았다. 이를 구현하기 전에는
crash-safe fencing 또는 unattended sync를 보장한다고 표시하지 않는다.

### 7. Native engine도 같은 checkpoint boundary를 구현한다

후속 `gosu_local_latex`와 `gosu_cloud_collaboration` adapter는 같은 binding, checkpoint와 anchor를 사용하고,
향후 versioned review provenance port가 이 lineage를 참조한다.

- Local adapter: CodeMirror, local source store, Tectonic sandbox, PDF preview, single-user/offline editing
- Cloud adapter: operation log 또는 CRDT/OT, presence, comments, ACL, durable websocket recovery, isolated compile
- 두 adapter 모두 immutable checkpoint를 만들어 Review, Reference, Project Chat과 Git bridge에 전달

Provider 전환은 URL 교체가 아니라 migration command다. 기존 provider checkpoint, deterministic source
digest와 root document를 고정한 뒤 새 provider import를 compile·hash 검증한다. review provenance port가
추가된 뒤에는 승인·review lineage도 migration input으로 고정한다. 성공 전에는 기존 binding과 authority를
유지하고 두 provider를 동시에 write authority로 두지 않는다.

## Implemented now

- provider-neutral schemas, generated JSON Schema, capability-honest adapter registry와 sync-state derivation
- 한 project 안의 여러 manuscript identity와 manuscript 전체를 잇는 checkpoint lineage
- Overleaf Git private binding, GOSU-private `safeStorage` credential, status 확인과 manual inbound capture
- exact remote revision·regular root document·전체 reachable object 검증, immutable local mirror와 duplicate
  receipt recovery
- pin된 checkpoint의 exact blob materialization, bounded file list·text chunk를 Project Chat에 제공하는
  read-only manuscript tool
- local MacTeX를 사용한 read-allowlisted·network-denied·no-shell-escape·fixed-argv prototype compile,
  bounded typed IPC와 resource-bounded PDF.js canvas preview
- manuscript title·root TeX optimistic edit, project switch request-generation guard, bounded friendly errors와
  최소 창 geometry smoke
- permanent project deletion의 durable provider-artifact cleanup queue와 reference-aware credential cleanup queue
- immutable staged credential reference·startup reconciliation, exact-URL scoped Git authorization,
  remote·workspace·credential identity tuple 검증, provider-wide workspace lock, 실패·timeout fetch object prune,
  cross-table manuscript identity trigger와 binding/aggregate retained mirror quota

## Deferred work

- schema-driven provider onboarding/plugin installation
- LaTeX editor, bundled Tectonic production compile, durable PDF artifact와 review/citation UI
- explicit authority handoff, provider collaboration lock와 publish window
- source-content digest, migration command와 rollback fixture
- durable sync-attempt state machine, lease/fencing, crash reconciliation와 background scheduling
- provider-neutral source artifact materialize/read/export port와 canonical source digest
- versioned editor, compile, presence, comment, tracked-change와 realtime recovery ports
- schema-driven generic provider presentation/configuration storage와 staged multi-binding authority migration
- strict fetch-time OS disk quota
- Overleaf-to-GitHub review branch/PR, outbound conditional publish와 review metadata gate
- local/cloud native collaboration adapter

## Alternatives considered

### Overleaf를 Manuscript module에 직접 구현

초기 구현은 빠르지만 Overleaf branch, URL, token과 제한이 Project Chat·Review·UI 전체로 번진다. 자체
local/cloud engine으로 전환할 때 모든 consumer를 다시 작성해야 하므로 거절했다.

### Git을 realtime collaboration engine으로 사용

Git은 reviewable checkpoint와 audit에는 적합하지만 keystroke-level concurrent editing, presence와 comment
merge를 제공하지 않는다. Git은 명시적인 checkpoint transport로만 사용한다.

### Overleaf의 비공개 realtime protocol 사용

공식 지원 계약이 아니고 browser session, 내부 schema와 서비스 업데이트에 의존한다. credential 노출과
document corruption 위험이 있어 거절했다.

### 처음부터 자체 realtime engine 구현

장기 방향과 일치하지만 text convergence, presence, offline recovery, compile isolation, comments와 access
control까지 한 번에 구현해야 한다. 먼저 portable checkpoint 경계와 Overleaf adapter로 workflow를 검증한
뒤 독립 engine을 추가한다.

## Consequences

장점:

- Overleaf를 지금 사용할 수 있으면서 manuscript identity와 checkpoint provenance를 자체 engine으로 옮길 수
  있고, 후속 review provenance port가 같은 lineage를 재사용할 수 있다.
- provider-specific Git·credential·URL이 portable manuscript contract와 Hosted payload에 들어가지 않는다.
- 외부 revision은 자동 overwrite가 아니라 아직 import되지 않은 immutable transport checkpoint다.
- provider 장애가 Repository, Board와 Research Notes를 막지 않도록 기능 경계를 유지한다.

비용과 한계:

- Overleaf Git integration은 realtime이 아니며 Overleaf 계정 plan과 rate limit을 따른다.
- v1은 기존 project의 inbound checkpoint만 지원하고 공동편집 authority를 관리하지 않는다.
- comments와 Track Changes를 checkpoint로 완전 복제하지 않는다.
- native local/cloud engine에는 별도 editor persistence, compile sandbox와 collaboration transport가 필요하다.

## Rollout and rollback

1. portable contract, registry와 manual inbound checkpoint vertical slice를 배포한다.
2. LaTeX compile·citation·secret scan과 review candidate UI를 추가한다.
3. durable attempt/lease/fencing과 explicit authority handoff를 구현한다.
4. 검토된 exact base에서만 outbound publish window를 추가한다.
5. deterministic migration contract를 통과한 local/cloud native adapter를 opt-in으로 노출한다.

Adapter 장애나 rollout 실패 시 binding을 disable하고 GOSU/GitHub draft와 legacy ZIP bootstrap을 계속
사용한다. 기존 Git revision과 Research Notes는 수정하지 않는다.

## Verification

현재 gate:

- generated schema drift, portable binding의 secret/provider-locator 거부
- descriptor와 interaction-mode operation 일치, fake local checkpoint provider의 동일 port 등록
- official credential-free HTTPS URL, immutable GOSU-private encrypted credential, exact-URL scoped authorization,
  workspace-bound credential 검증, 검증 실패 rollback과 startup pending reconciliation
- stale revision, missing root/reachable object, duplicate/out-of-order fetch와 missing local artifact recovery
- exact captured source list/read의 cross-project·stale checkpoint·binary·unsafe tree 거부, bounded chunk와 private locator
  non-disclosure
- exact checkpoint만 compile, fixed sandbox argv/network·shell-escape 금지, compiler unavailable·compile error·invalid/
  oversized PDF 경계, PDF.js preview에 absolute path non-disclosure
- no push/merge/rebase/force command, failed-fetch prune, binding별 256 MiB·전체 1 GiB retained mirror limit
- project switch·최소 창 UI, typed IPC allowlist와 bounded error mapping
- SQLCipher close/reopen, cross-table identity trigger, project purge cascade, durable filesystem/credential cleanup
  queue와 shared-reference 보존

후속 gate:

- durable attempt restart, lease expiry, cancel/complete race와 fencing
- explicit authority handoff, dual-master prevention, bundled compiler/citation/secret review gate와 durable artifact receipt
- deterministic source-content hash와 provider migration rollback
- strict fetch-time disk quota
- outbound publish의 exact remote base, idempotency와 review metadata protection
