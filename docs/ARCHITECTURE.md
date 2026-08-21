# GOSU 아키텍처 및 유지보수 가이드

이 문서는 GOSU의 장기적인 소프트웨어 경계와 변경 원칙을 정의한다. 현재 저장소의 실제
구현을 기준으로 작성했으며, 완성된 기능과 후속 계획을 구분한다. 제품 소개나 배포 절차보다
"어느 코드가 무엇을 소유하며, 변경이 다른 영역으로 번지지 않게 하려면 어떻게 해야 하는가"에
초점을 둔다.

## 1. 상태 표기

이 문서에서는 다음 표기를 사용한다.

- **구현됨**: 현재 기본 실행 경로에서 동작하고 자동 테스트가 있는 기능
- **기반 구현**: 계약, 정책, 저장소 어댑터 또는 UI가 있으나 제품 흐름 전체에는 연결되지 않은 기능
- **계획됨**: 목표 아키텍처에는 포함되지만 현재 코드로 실행할 수 없는 기능

GOSU는 현재 운영형 MVP의 기반 단계다. 비공개 연구 데이터, 실제 자격 증명 또는 비용이 큰
무인 실험을 맡길 수 있는 프로덕션 시스템으로 간주하면 안 된다.

## 2. 목표와 비목표

### 목표

- 연구 프로젝트, 목표·평가지표, 실험, 논문 작성·검토, 참고문헌과 노트는 project 범위에서
  연결하고, 강의 자료는 여러 project를 선택할 수 있는 workspace 범위에서 합성한다.
- 연구 원본은 가능한 한 기존 원본 시스템과 연구자의 장비에 남기는 local-first 구조를 유지한다.
- 외부 연동이나 실행기 장애가 Kanban, 로컬 문서, 다른 독립 모듈을 연쇄적으로 중단시키지 않게
  한다.
- 모든 위험한 자동화에 명시적인 계약, 예산, 승인, provenance와 되돌리기 경계를 둔다.
- 모델명과 외부 서비스의 세부 동작을 제품 도메인에 하드코딩하지 않고 provider·connector
  adapter 뒤에 둔다.
- 상태 변경은 낙관적 버전, idempotency key, lease와 fencing token으로 재시도와 중복 실행에
  견딜 수 있게 한다.

### 현재 비목표

- 연구 파일 전체를 GOSU Hosted Sync에 복제하는 것
- Windows·Linux 데스크톱, Slurm·Kubernetes 또는 wet-lab 장비 제어
- Overleaf·Obsidian·Zotero와의 자동 양방향·dual-write 동기화
- 실시간 공동 LaTeX 편집
- 보호 브랜치 병합, 근거 최종 채택 또는 외부 export를 사람 승인 없이 수행하는 것
- 현재 단계에서의 공개 인터넷 배포, 비용이 큰 무인 workload 또는 프로덕션 보안 보증

## 3. 실행 토폴로지와 신뢰 경계

```mermaid
flowchart LR
  subgraph Mac["연구자 macOS"]
    Renderer["Electron Renderer\n비권한 UI"]
    Main["Electron Main\nIPC·파일·Codex·로컬 DB"]
    LocalDB["암호화 SQLite\nworkspace snapshot·outbox·model provenance·local usage"]
    Codex["로컬 Codex App Server"]
    Vault["선택한 Obsidian Vault\nproject별 Research Notes"]
    AttachmentFiles["사용자가 선택한 local 연구 파일"]
    AttachmentCapability["ephemeral one-turn attachment capability\nMain memory·private temp·opaque IDs"]
    Git["앱 관리형 로컬 Git worktree\nfile·change·history·branch"]
    ManuscriptAdapter["Manuscript adapter registry\nprovider-neutral checkpoint port"]
    ManuscriptMirror["binding별 local bare mirror\nimmutable fetched checkpoint"]
    OpenSSH["system OpenSSH\nalias/direct target·ssh-agent"]
  end

  subgraph External["외부 research service"]
    WebSearch["Codex first-party web search\ncached 또는 live"]
    SemanticScholar["고정 Semantic Scholar Graph API\n관련성·고인용·최신 metadata"]
    HuggingFace["고정 Hugging Face Papers API\nadditive arXiv metadata"]
    Crossref["고정 Crossref works endpoint"]
    Overleaf["Overleaf website·official Git bridge\nexternal realtime UI·linear checkpoint"]
  end

  subgraph Hosted["Hosted collaboration boundary"]
    API["NestJS/Fastify Sync API"]
    Memory["현재 기본값\nin-memory store"]
    Postgres["PostgreSQL adapter·RLS\n기반 구현"]
    Relay["SSE·WebSocket relay"]
  end

  subgraph Lab["연구실 Linux"]
    Runner["Go Runner\noutbound control client"]
    Podman["rootless Podman workload"]
    Artifacts["dataset·raw log·artifact"]
    Optimizer["Python Optuna worker"]
    SshHost["사용자 등록 SSH server\nproject grant·승인된 argv"]
  end

  Renderer -->|"allowlisted IPC"| Main
  Main --> LocalDB
  Main --> Codex
  Main -->|"project-scoped read\nowned projection write"| Vault
  AttachmentFiles -->|"Main 고정 dialog·path/bytes 비노출"| Main --> AttachmentCapability --> Codex
  Main -->|"project-scoped typed Git IPC"| Git
  Main --> ManuscriptAdapter -->|"manual exact-revision fetch"| Overleaf
  ManuscriptAdapter --> ManuscriptMirror
  Codex -->|"project profile web_search"| WebSearch
  Main -->|"bounded three-lane metadata search"| SemanticScholar
  Main -->|"bounded additive metadata search"| HuggingFace
  Main -->|"bounded metadata search"| Crossref
  Main -->|"기본 Allow once 또는\nbounded trusted audit"| OpenSSH --> SshHost
  Main <-->|"readiness·향후 sync worker"| API
  API --> Memory
  API -.->|"런타임 연결 전"| Postgres
  API --> Relay
  Runner <-->|"project-scoped control·event"| Relay
  Runner --> Podman
  Podman --> Artifacts
  Runner -.-> Optimizer
```

핵심 경계는 다음과 같다.

1. Renderer는 신뢰하지 않는다. Node.js, 파일시스템, Git, SSH, Keychain, Codex 프로세스에 직접
   접근하지 못한다.
2. Hosted Sync는 협업 metadata의 원본일 수 있지만 연구 원문의 cloud mirror가 아니다.
3. Runner는 Hosted 환경에서 연산하지 않는다. 연구실이 운영하는 Linux 장비에서 outbound
   연결만 만들고, 로컬 정책이 허용한 서명 manifest만 실행한다.
4. 외부 서비스 자격 증명은 adapter 호출 시 로컬 secret provider에서 받는다. 계약, Git 이력,
   Hosted DB, event, URL 또는 로그에 값을 넣지 않는다.

## 4. 저장소 구조와 코드 소유권

| 경로                    | 소유 책임                                                                              | 현재 상태                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop`          | macOS 로컬 UI, privileged adapter, 암호화 local state, Codex·Hermes·Vault·Git·SSH 경계 | 실행 가능한 Project Chat·Kanban·Objective·Repository·Literature·Experiment Evaluation Studio·Lecture Studio·승인형 SSH slice |
| `apps/web`              | Owner·Lab 관리 경험                                                                    | demo fixture 기반의 인터랙티브 UI                                                                                            |
| `apps/sync-api`         | 인증·인가, 협업 command/query, SSE, Runner relay, Hosted persistence 경계              | memory runtime 구현, PostgreSQL 기반 구현                                                                                    |
| `apps/runner`           | manifest 검증, lease/fence, container 실행, event spool, Stop·Kill                     | 제한된 로컬 실행 경로 구현                                                                                                   |
| `packages/contracts`    | 프로세스와 언어를 넘는 versioned wire schema                                           | 구현됨                                                                                                                       |
| `packages/domain`       | I/O 없는 상태 전이, 정책, 예산·불변성, version conflict 규칙                           | 구현됨                                                                                                                       |
| `packages/integrations` | GitHub·Zotero·Obsidian·Overleaf port와 제한된 adapter                                  | 기반 구현                                                                                                                    |
| `packages/ui`           | 공통 visual token과 작은 presentational primitive                                      | 기반 구현                                                                                                                    |
| `scripts`               | local Sync 준비 확인, Desktop process supervision, 환경 진단                           | 구현됨                                                                                                                       |

### 논리 모듈 소유권

제품 모듈은 아직 모두 독립 디렉터리로 분리되어 있지 않다. 새 기능은 아래 소유권을 기준으로
배치하고, 한 모듈이 다른 모듈의 저장 테이블을 직접 읽지 않게 한다.

| 논리 모듈                    | 현재 코드 소유자                                                                                                 | 구현 수준                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity & Lab               | `apps/sync-api/src/auth.ts`, memory store, PostgreSQL schema                                                     | JWT 검증과 개발 auth 구현; Google·Apple PKCE·초대는 계획됨                                                                                                                                                                                                                                                                                                                    |
| Project Portfolio & Kanban   | Desktop workspace service, renderer portfolio navigator, Sync controller/store                                   | 다중 project folder 탐색·로컬 hide, project Archive·복원 가능한 Trash, 동일 Task의 Kanban·To-do projection, Board 설정·task metadata·filter·drag·archive 구현; Hosted 전달은 계획됨                                                                                                                                                                                           |
| Goal & Evaluation            | Desktop workspace service, contracts, domain, Sync endpoints                                                     | 로컬 draft 저장·freeze·명시적 새 version 구현; 승인·Hosted 전달은 계획됨                                                                                                                                                                                                                                                                                                      |
| Experiment Orchestration     | Desktop Experiment workspace, contracts, domain, Runner                                                          | 프로젝트별 idea lineage·검토 outcome·선택적인 target, versioned logging template, 다중 run 상태·서버·step·metric·opaque log reference, Project Chat의 추적형 foreground 실행과 summary trajectory를 SQLCipher에 구현; Runner live bridge, campaign scheduler와 완전한 optimizer 연동은 계획됨                                                                                 |
| Experiment Evaluation Studio | Desktop Evaluation service, 전용 shared contract·IPC, SQLCipher repository, protected artifact port              | step/epoch cadence·metric·policy·logging suggestion·숫자/table/plot을 독립 chat에서 proposal로 만들고 synthetic preview, human approval, immutable reusable recipe로 저장하는 local-first slice 구현; evaluator의 실제 주기 실행과 Runner result ingest는 계획됨                                                                                                              |
| Manuscript                   | Desktop Manuscript service·SQLCipher repository, shared contracts와 adapter registry                             | project별 복수 manuscript identity, provider-neutral binding/checkpoint/anchor, Overleaf Git existing-project link·HEAD 확인·manual immutable fetch·exact checkpoint text read·MacTeX sandbox compile·PDF.js preview·local mirror 정리 구현; editor·diff/review·handoff·publish는 계획됨                                                                                      |
| Review & Approval            | PostgreSQL approval schema와 Web UI 표현                                                                         | 기반 구현; 실제 review anchor·approval command는 계획됨                                                                                                                                                                                                                                                                                                                       |
| Reference & Literature       | Desktop Literature workspace와 Zotero read-only connector                                                        | Semantic Scholar 우선·Crossref fallback/supplement·Hugging Face Papers additive source의 policy-v3 3-layer discovery, arXiv canonical identity, 누적 evidence table, JSON/CSV/BibTeX transfer, provider abstract 기반 AI topic·keyword 정리와 Project Chat search 구현; Zotero 앱 연결은 계획됨                                                                               |
| Obsidian Knowledge           | Desktop Research Notes service, bounded Vault adapter, Markdown/LaTeX reader                                     | Vault root 복원·프로젝트별 owned folder·기본 note 구조·v2 공통 Markdown metadata envelope·Literature/Papers projection·Lecture canonical LaTeX artifact·durable 저장 receipt/reconciliation·안전한 rename·GFM/wiki-link/raster preview·읽기/자동 생성 분리 grant 구현                                                                                                         |
| Lecture                      | Desktop Lecture Studio service, SQLCipher storage, Research Notes artifact port, Manuscript·external-source port | 여러 project의 captured Manuscript/Overleaf checkpoint·reviewed Literature metadata·Experiment lineage·사용자 `.tex/.md/.pdf` snapshot 선택, canonical article/Beamer LaTeX 생성, app 내 paired source edit, Studio figure library, sandbox PDF compile, 독립 chat, append-only revision, recoverable Trash와 `.tex`/PDF export 구현; PPTX와 OCR·paper-figure ingest는 계획됨 |
| Usage Analytics              | Desktop model usage collector·SQLCipher ledger·Usage renderer                                                    | 이 Mac에서 provider가 보고한 Codex/Hermes turn token을 project·Lecture generation·connection·model·workload별로 일/주/월 집계; 비용 추정·과거 backfill·Hosted Sync는 하지 않음                                                                                                                                                                                                |
| AI Gateway                   | GOSU Agent Runtime, Desktop Project Chat provider router, Codex App Server와 선택형 BYO-Hermes ACP adapter       | provider-neutral durable run/node graph·bounded session working memory·context plan, 다중 chat session·session-scoped durable turn queue·최대 4개 session 병렬 turn·provider별 동적 model provenance·Codex native harness/tool 경계·Hermes ACP text/reasoning-only worker 경계·Codex→Hermes 명시적 child-node 위임·동적 branch title·Research Notes final persistence 구현    |
| Integration Hub              | Desktop Git Workspace·승인형 SSH·Manuscript connector, `packages/integrations` registry                          | GitHub HTTPS clone·bounded Git·OpenSSH grant·provider-neutral manuscript operation registry·Overleaf Git private connector 구현; schema-driven provider onboarding, GitHub App와 native LaTeX provider는 계획됨                                                                                                                                                               |
| Sync, Audit & Notification   | Sync memory store, PostgreSQL audit·outbox schema                                                                | 개발 relay 구현; production outbox publisher·Redis·notification은 계획됨                                                                                                                                                                                                                                                                                                      |

## 5. 의존성 규칙

```mermaid
flowchart TD
  Contracts["packages/contracts\nwire shape"]
  Domain["packages/domain\npure decisions"]
  Integrations["packages/integrations\nexternal adapters"]
  UI["packages/ui\npresentation primitives"]
  Desktop["apps/desktop"]
  Web["apps/web"]
  Sync["apps/sync-api"]
  Runner["apps/runner\nGo boundary"]

  Domain --> Contracts
  Integrations --> Contracts
  Desktop --> Contracts
  Sync --> Contracts
  Desktop -.-> UI
  Web -.-> UI
  Desktop -.-> Domain
  Sync -.-> Domain
  Runner -.->|"generated JSON Schema가 기준\n현재 Go mirror는 수동"| Contracts
```

다음 규칙은 기능 구현보다 우선한다.

- `packages/contracts`는 다른 GOSU workspace에 의존하지 않는다.
- `packages/domain`은 contracts만 의존하며 네트워크, 파일, DB, Electron, NestJS를 import하지 않는다.
- `packages/integrations`는 외부 API의 세부 형식을 소유한다. 앱이나 domain에 provider 응답 형식을
  노출하지 않는다.
- `packages/ui`는 도메인 command를 실행하거나 persistence를 소유하지 않는다.
- 앱은 공유 package에 의존할 수 있지만 앱끼리 source import하지 않는다. 통신은 versioned
  REST, SSE, WebSocket, IPC 또는 file/export contract를 사용한다.
- 다른 모듈의 테이블에 직접 SQL을 작성하지 않는다. 소유 모듈의 repository·port 또는 command를
  호출한다.
- domain 결정을 controller, React component, Electron IPC handler 또는 connector에 복제하지
  않는다.
- 새 외부 provider는 adapter가 필요하지만 새 모델은 필요하지 않다. 모델 ID는 opaque string으로
  유지하고 provider catalog에서 동적으로 읽는다.
- 계약을 우회하는 `any`, 임의 JSON, raw shell string 또는 암묵적 last-write-wins를 새 경계에
  도입하지 않는다.

현재 예외도 명시해야 한다. Runner의 Go manifest type은 생성물이 아니라 TypeScript schema를
수동으로 mirror한다. 따라서 contract drift test와 언어 간 fixture 검증이 필수이며, 장기적으로는
고정된 generator 또는 런타임 JSON Schema 검증으로 대체해야 한다.

## 6. 데이터 원본과 개인정보 경계

| 데이터                                                           | authoritative source                                                                                                                           | Hosted Sync 보관 정책                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 코드, GOSU draft LaTeX, 생성된 `.bib`, 재현 설정, slide          | GitHub와 앱 관리형 local worktree                                                                                                              | repository label과 향후 branch·commit·PR metadata만; 파일·diff 금지                                                                                                                                                                                                                                                                                                                                                                 |
| manuscript identity·binding·checkpoint provenance                | 프로젝트별 Desktop Manuscript SQLCipher tables; v1 authority는 `gosu`                                                                          | 현재 Hosted Sync·workspace outbox 대상이 아님; provider URL·source·raw diff·token 금지                                                                                                                                                                                                                                                                                                                                              |
| fetched Overleaf source checkpoint와 Git object                  | `userData/manuscript-workspaces/<binding UUID>`의 adapter-private bare mirror                                                                  | Hosted Sync·telemetry·Project Chat 자동 context 금지; Project Chat은 사용자가 capture한 exact checkpoint에 한해 bounded file-list/text-read tool로만 접근; permanent project 삭제 때 durable purge queue로 exact binding artifact를 제거                                                                                                                                                                                            |
| Overleaf URL·workspace ID·personal Git token                     | URL/ID는 adapter-private SQLCipher row; Settings token과 link별 snapshot은 GOSU-private `safeStorage` ciphertext                               | OS secure-storage protected; token은 Settings fixed IPC만 통과하고 Manuscript/Lecture link contract·shared Git credential·Hosted Sync·portable binding·event·log·Git config에는 금지. Settings 교체·삭제는 향후 link에만 적용되며 기존 link는 각자의 immutable snapshot을 유지함; 삭제는 Overleaf token revoke가 아님                                                                                                               |
| 프로젝트 Research Notes Markdown·Lecture LaTeX와 첨부            | 사용자의 Obsidian Vault 아래 `GOSU/<project>`; Literature 원본은 별도 SQLCipher                                                                | Vault·project 연결 상태만; 본문·절대 경로는 금지                                                                                                                                                                                                                                                                                                                                                                                    |
| 서지 metadata, collection, PDF                                   | Zotero                                                                                                                                         | 연결 상태와 선택 item ID만; PDF 금지                                                                                                                                                                                                                                                                                                                                                                                                |
| 검색 문헌 metadata, review annotation, 검색 이력                 | 프로젝트별 Desktop Literature SQLCipher tables, Project Chat search와 선택한 import file                                                       | 현재 Hosted Sync·outbox 대상이 아님; raw provider response·원문·abstract·로컬 file path·API key 금지                                                                                                                                                                                                                                                                                                                                |
| 실험 idea·logging template·run 상태·summary metric·log reference | 프로젝트별 Desktop Experiment SQLCipher tables                                                                                                 | 현재 Hosted Sync·workspace outbox 대상이 아님; exact remote root/path는 Main-only execution-origin mapping에만 암호화 저장하고 Renderer에는 숨김; raw metric·log·artifact는 저장하지 않고 검증된 opaque hash·크기·상태만 저장                                                                                                                                                                                                       |
| evaluation session·message·draft revision·승인 recipe provenance | 프로젝트별 Desktop Evaluation SQLCipher tables                                                                                                 | 현재 Hosted Sync·workspace outbox 대상이 아님; proposal과 synthetic preview는 실제 run evidence가 아니며 raw Codex payload·tool output을 저장하지 않음                                                                                                                                                                                                                                                                              |
| 승인된 evaluator code·prompt artifact                            | `userData/evaluation-profiles/<project UUID>/<profile UUID>`                                                                                   | 앱 전용 local artifact; Hosted Sync·Git·Research Notes에 자동 복사하지 않고 Renderer에는 app-relative receipt만 노출함                                                                                                                                                                                                                                                                                                              |
| dataset, raw metric·log, checkpoint, artifact                    | Linux Runner                                                                                                                                   | 원본 금지; 상태와 명시적 summary metric만                                                                                                                                                                                                                                                                                                                                                                                           |
| 프로젝트, Kanban, 보이는 대화, 승인, 감사                        | 최종 목표는 Hosted Sync; 현재 Desktop slice는 암호화 로컬 원본                                                                                 | 협업 metadata 저장 대상                                                                                                                                                                                                                                                                                                                                                                                                             |
| Codex 인증, API key, SSH material, runner secret                 | Keychain·Codex credential store·runner secret store                                                                                            | 금지                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Hermes runtime과 provider 인증                                   | exact version/source/hash runtime archive는 GOSU app resource와 userData 검증 cache; provider credential은 사용자의 local Hermes/provider 설정 | runtime bundle에는 credential·session·memory를 넣지 않고 Hosted Sync·GOSU DB·outbox·telemetry에도 복사하지 않음; primary invocation은 adapter provider·requested/resolved model과 non-secret route/transport fingerprint를 묶는 opaque catalog version만 저장함. 연결 시 credential 연속성 HMAC은 Main memory에만 있고, 검증된 provider credential은 child의 agent constructor에 직접 전달한 뒤 agent/tool import 환경에서는 제거함 |
| Hermes ACP 격리 profile                                          | local Hermes home의 `profiles/gosu-<project:session SHA-256 앞 40 hex>`                                                                        | GOSU가 model/provider와 비밀이 아닌 fail-closed config를 `0700/0600`으로 유지함; credential 값·transcript·memory·session DB는 profile에 기록하지 않음. bundled runtime archive와 hash-keyed cache는 profile data와 분리하며 현재 project 삭제와 함께 profile을 자동 제거하지 않음                                                                                                                                                   |
| Hermes ACP prompt·출력                                           | 해당 Hermes ACP process의 휘발성 agent session과 선택한 inference provider                                                                     | production native tool inventory는 비어 있고 web·delegation·shell·file·code·browser·memory·skill·MCP·GOSU mutation tool을 모두 차단함. Codex→Hermes 위임은 fresh Hermes primary turn으로 실행함. 보이는 최종 assistant 문장은 chat 정책을 따르지만 raw task/context/reply/ACP payload는 감사 table에 저장하지 않고, model·provider·catalog·agent·stop·시각만 append-only structured receipt로 SQLCipher에 저장함                    |
| Hermes ACP approval broker                                       | 현재 app process의 project/session-scoped in-memory 구현                                                                                       | future mutation-tool 연결을 위한 turn-scoped broker는 존재하지만 현재 production allowlist에는 승인 가능한 mutation tool이 없어 승인창을 만들지 않음. 예상하지 않은 permission request는 active ACP session·turn에 정확히 결합되지 않으면 거절하고 cancel·release·disconnect·shutdown 때 모두 폐기함                                                                                                                                |
| SSH connection profile                                           | 모든 local project가 공유하는 Desktop SQLCipher registry                                                                                       | Hosted Sync 금지; alias 또는 정규화된 direct host·user·port·inactive `-L`; secret·원본 command 금지; 여러 project grant가 같은 profile을 참조할 수 있음                                                                                                                                                                                                                                                                             |
| SSH remote workspace grant                                       | 프로젝트별 Desktop SQLCipher table                                                                                                             | Hosted Sync 금지; connection ID·canonical root·permission mode·선택적인 exact-version trusted policy binding만 저장                                                                                                                                                                                                                                                                                                                 |
| SSH command output                                               | 해당 Project Chat turn의 Main-process memory와 ephemeral tool result                                                                           | raw output 저장·동기화 금지; 모델이 답변에 포함한 문장만 대화 정책 적용                                                                                                                                                                                                                                                                                                                                                             |
| SSH workspace text file body                                     | 승인된 remote project root의 원본과 해당 turn의 bounded helper/result memory                                                                   | SQLCipher·Hosted Sync·outbox·telemetry·Git 자동 저장 금지; exact create/replace 내용은 기본 5분 decision window의 centered blocking approval dialog에만 휘발성 표시                                                                                                                                                                                                                                                                 |
| SSH server resource snapshot                                     | Desktop Main-process 12초 cache와 Renderer의 마지막 구조화 sample                                                                              | SQLCipher·Hosted Sync·outbox·telemetry·chat prompt 저장 금지; CPU/RAM/GPU 숫자와 bounded issue만 IPC에 노출하고 raw probe output 금지                                                                                                                                                                                                                                                                                               |
| SSH Allow-once approval request·outcome metadata                 | 현재 app process의 in-memory broker event                                                                                                      | durable audit가 아니며 SQLCipher·Hosted Sync·outbox·telemetry 저장 금지                                                                                                                                                                                                                                                                                                                                                             |
| SSH trusted auto-execution audit                                 | 프로젝트별 Desktop SQLCipher append-only table                                                                                                 | 실행 전 exact project/grant/connection/policy/turn/tool-call/operation/command hash만 기록; raw command preview·stdout/stderr·secret·Hosted Sync 금지                                                                                                                                                                                                                                                                               |
| Project Chat 첨부 연구 파일                                      | 사용자가 dialog에서 선택한 local file                                                                                                          | Codex turn에서만 bounded text 또는 image를 전달; Hermes ACP turn에는 아직 첨부를 전달하지 않음; path·원본 bytes·추출 text·정규화 image를 SQLCipher·Hosted Sync·outbox·telemetry에 저장하지 않음                                                                                                                                                                                                                                     |
| Codex web search result·tool payload                             | 해당 Codex turn의 ephemeral provider context                                                                                                   | GOSU DB·outbox에 저장하지 않음; 최종 답변의 URL·요약만 visible chat 정책 적용. Codex는 project web-search mode를 따르며 raw tool payload는 GOSU가 저장하지 않음. 이번 release의 Hermes toolset에는 web search가 없음                                                                                                                                                                                                                |
| 로컬 통합 검색 query·result                                      | 현재 Main-process query와 Renderer view state                                                                                                  | SQLCipher·Hosted Sync·outbox·telemetry에 저장하지 않음; 기존 source만 bounded read                                                                                                                                                                                                                                                                                                                                                  |
| tool payload, 파일 본문, shell 출력, raw diff                    | 로컬 실행 문맥                                                                                                                                 | 금지                                                                                                                                                                                                                                                                                                                                                                                                                                |

Hosted Sync에 저장하지 않는다는 것과 LLM에 전혀 전송하지 않는다는 것은 다르다. Research Notes는 기본적으로
Mac 안에만 남지만, 사용자가 특정 Vault를 특정 project agent에 승인한 경우 그 turn에서 agent가 실제로
list한 note의 display title·opaque ID와, 실제 read한 bounded excerpt·content SHA-256·offset·전체 문자 수가
설정된 Codex/LLM provider로 전송된다. Vault root·상대 path·전체 tool payload는 모델에 주지 않고 원본 note
file이나 raw tool payload를 자동 저장·동기화하지 않는다. 다만 모델이 이 metadata나 excerpt를 visible
answer에 인용하거나 요약하면 그 문장은 보이는 대화이므로 암호화 local DB에 저장되고 향후 Hosted Sync
대상이 될 수 있다. Research Notes와 Agent Settings 화면은 승인 전에 이 점을 명시한다. GOSU는 모든 terminal
receipt에 별도로 display title, opaque note ID 일부, content SHA-256과 excerpt 여부를 붙인다. 이 승인은
project별이며 다른 project나 새로 선택한 Vault로 자동 승계하지 않는다.

Project Chat 첨부도 같은 구분을 따른다. 사용자가 현재 project·session에서 직접 고른 연구 파일은 Main의
ephemeral one-turn capability로만 처리하며 파일 경로·원본 bytes·추출 본문·정규화 image를 durable prompt
envelope, 보이는 user message, GOSU SQLCipher, outbox 또는 telemetry에 넣지 않는다. 문서·슬라이드는 모델이
`read_turn_attachment_text`로 실제 요청한 bounded reconstruction만 provider로 전달한다. 그림은
metadata를 제거한 private temporary JPEG를 image modality가 확인된 Codex turn의 `localImage` input으로만
전달하고 terminal에서 제거한다. 전달 과정에서 bounded tool result와 image path가 mode `0700`의
ephemeral Codex SQLite runtime에 잠시 기록될 수 있지만 장기 `CODEX_HOME`·GOSU DB와 분리하고 위의
shutdown·startup cleanup 경계를 적용한다. 모델이 excerpt나 그림 분석을 visible answer에 쓰면 해당 문장은 보이는
대화 정책을 따른다. Codex first-party web search의 raw result와 tool payload도 GOSU persistence에는
들어오지 않고, 모델이 최종 답변에 쓴 URL과 설명만 보이는 대화로 남는다. provider 측 attachment·
web-search retention은 GOSU가 통제하는 local retention 경계와 별개다.

Hermes turn의 user prompt와 delegated task/context/result도 사용자가 설정한 BYO inference
provider로 전송된다. sealed ACP wrapper는 local Hermes transcript·memory persistence와 GOSU durable raw
payload 저장을 막지만, inference provider의 server-side logging·retention·training policy까지 통제하지
않는다. 연결 전에 사용자가 선택한 provider의 정책을 별도로 확인해야 한다.

`isSummary: true`인 Runner metric만 run summary projection에 들어간다. 그 외 metric point, log,
resource sample, artifact reference는 WebSocket으로 실시간 relay할 수 있지만 memory store도 값을
보존하지 않는다. 이 구분을 바꿀 때는 단순 schema 변경이 아니라 privacy·retention 설계 변경으로
취급한다.

Owner의 가시성도 tenant 범위 안에서만 적용된다. Owner는 동기화된 상태, 보이는 대화, 승인과
감사를 볼 수 있지만 다른 사용자의 secret, 로컬 Vault file 자체, repository 원문 또는 Runner 원본을
직접 읽을 권한을 얻지 않는다. 단, 사용자가 승인한 excerpt를 모델이 보이는 대화에 인용했다면 Owner가
그 동기화된 대화를 통해 인용문을 볼 수 있다는 점은 별도의 privacy 예외다.

현재 Desktop의 Project·Kanban·Objective vertical slice는 Hosted delivery worker가 연결되기 전에도
쓸 수 있도록 암호화 SQLite를 실행 원본으로 사용한다. 이는 장기적인 협업 authority를 바꾼 것이
아니다. 각 로컬 mutation은 optimistic entity version을 확인하고 workspace snapshot과 idempotent
outbox operation을 같은 transaction에 기록한다. delivery가 구현되기 전 UI의 pending 표시는
“로컬에 안전하게 대기 중”만 의미하며, 서버 반영이나 다른 사용자와의 동기화를 의미하지 않는다.

## 7. 계약과 이벤트 흐름

### 계약의 원본

- Zod source는 `packages/contracts/src`에 둔다.
- Draft-07 JSON Schema는 `packages/contracts/generated/json-schema`에 생성해 commit한다.
- 생성 파일은 직접 수정하지 않는다.
- 깨지는 변경은 기존 version을 재해석하지 말고 새 version을 만든다. 배포된 producer와 consumer가
  공존하는 기간에는 dual-read 또는 명시적인 upcaster를 둔다.
- untrusted input은 contract parse 후 domain rule을 적용하고, 그 다음 persistence·side effect를
  수행한다.

주요 공개 계약은 동적 model catalog, objective·budget, `JobManifestV1`,
`RunnerEventV1`·`RunnerEventMessageV1`, `SyncEventV1`, connector capability다.

### 협업 command 흐름

1. client는 project 범위, `expectedVersion`, idempotency key를 포함한 command를 보낸다.
2. API가 인증과 lab·project·role authorization을 수행한다.
3. Zod가 wire shape를 검증하고 domain이 상태 전이·불변성을 판단한다.
4. repository가 상태, audit와 outbox를 하나의 transaction으로 기록한다.
5. publisher가 commit된 outbox event를 전달한다.
6. client는 entity version을 확인해 local cache를 갱신한다. conflict는 덮어쓰지 않고 사용자 또는
   command-specific resolver에 반환한다.

현재 memory store는 1–3단계의 일부, idempotency, optimistic version과 in-process event emit을
구현한다. 4–5단계의 production 경로는 PostgreSQL adapter와 schema까지만 있으며 Nest runtime에는
연결되지 않았다.

### Runner event 흐름

```mermaid
sequenceDiagram
  participant API as "Sync relay"
  participant Runner as "Go Runner"
  participant Store as "Runner local store"
  participant Podman as "Rootless Podman"
  participant Viewer as "Authorized viewer"

  Runner->>API: "runner.hello with projectId"
  API-->>Runner: "runner.hello.ack"
  API->>Runner: "job.submit with signed envelope"
  Runner->>Runner: "decode, signature and policy validation"
  Runner->>Store: "accept idempotency key, lease and fence"
  Runner->>Podman: "structured run arguments"
  Runner->>Store: "append state event with durable sequence"
  Runner->>API: "RunnerEventMessageV1"
  API->>API: "authorize, deduplicate and project summary"
  API-->>Viewer: "relay accepted live event"
  API-->>Runner: "events.ack with sequence"
  Runner->>Store: "persist acknowledged sequence"
```

Runner delivery는 at-least-once다. Sync는 `projectId + runnerId + eventId` fingerprint로 exact
duplicate를 제거하고, attempt별 sequence projection에서 stale event를 거절한다. ACK는 수신한
durable sequence를 가리킨다. invalid manifest는 lineage가 없으므로 spool event를 만들지 않는다.

### Desktop Experiment trajectory 흐름

현재 Desktop `Experiments` surface는 원격 Runner가 연결되기 전에도 연구 가설, 실행 상태와 검토된 결과를
기록할 수 있는 local-first projection이다. `Overview / Runs / Logging / Idea map / Report`를 분리하고,
Runs는 여러 실행의 server label, queued/running/verifying/terminal 상태, 보고된 step, 정직한 progress, 최신 metric과
log validation을 함께 보여 준다. 전체 step 수가 오지 않으면 임의 percentage를 만들지 않는다.
현재 Project Chat의 foreground SSH 경로는 run 시작 상태를 먼저 기록하고 process 종료 뒤 검증된 JSONL의 최종
step·metric·log 상태를 반영한다. 실행 중 per-step log streaming, campaign-wide budget·guardrail·stop policy,
장기 무인 실행과 Stop/Kill은 Runner가 연결된 뒤에만 강제된다. UI는 이 경계를 명시하고 foreground path의
고정 per-run timeout을 campaign budget으로 표현하지 않는다.

Goal의 **target threshold는 선택 사항**이다. target이 `null`이면 `stopWhenTargetReached`도 false여야 한다.
아이디어 탐색, 자료 점검과 계측 준비 같은 `exploratory` run은 Objective와 primary metric 없이 만들 수 있다.
서로 비교하고 trajectory evidence로 채택하는 `comparable` run은 target 값 자체가 아니라 동결된 Objective의
primary metric, evaluator, dataset, holdout, aggregation identity가 필요하다. Renderer의 manual summary 기록도
같은 identity를 snapshot하고 `source=manual`을 Main이 고정한다.

Experiment module은 `experiment_ideas`, `experiment_metric_points`, `experiment_logging_templates`,
`experiment_runs`, execution binding·immutable execution intent와 log source mapping을 자기 SQLCipher repository에서 소유한다.
logging template은 immutable revision이다. 모든 event에 들어가는 system field는 고정하고, 사용자는 bounded
custom field의 key, label, type, category, unit과 `run-start / progress / run-end / summary` 필수 위치를 추가·삭제한다.
필수 위치로 지정한 field는 해당 lifecycle의 일부 event에 한 번만 나타나는 것이 아니라 그 lifecycle의 **모든
event record**에 있어야 한다. `progressCurrent` projection도 임의의 정수형 progress field에서 추측하지 않고
명시적인 `progress_current` field가 있을 때만 사용한다.
새 run은 생성 시 현재 template 전체와 hash를 snapshot하므로 이후 template을 바꿔도 과거 run의 요구사항은
바뀌지 않는다. Logging 화면의 JSONL은 명시적으로 example-only이며 실제 run evidence로 취급하지 않는다.

Project Chat의 remote repository 실행은 `read_experiment_setup → create_experiment_run →
execute_experiment_run` typed flow만 허용한다. 일반 SSH command tool은 read-only Git inspection으로 제한해
test, build, benchmark, training, evaluation이 required logging을 우회하지 못하게 한다. create는
project·attempt·tool call에서 유도한 deterministic trial ID를 쓰고, 같은 의미의 retry는 기존 run을 반환한다.
실행은 exact project workspace grant와 immutable template에 묶인 foreground Python harness만 허용한다. Main은
실행 전에 command·args·timeout·workspace subdirectory·log path·coverage plan·run/template/Objective snapshot과
grant·connection version, canonical root·hash, trusted policy version·hash를 canonical intent에 고정하고, 이후
retry가 다른 authority, 경로 또는 인자를 제시하면 실행하거나 검증하지 않는다. 이 origin snapshot은 project
휴지통을 비우며 active SSH grant를 제거한 뒤에도 append-only provenance로 남는다.
모델은 모든 required custom field의 lifecycle coverage를 먼저 선언해야 하고, harness는 bounded JSONL을
stdout과 지정한 server file에 byte-for-byte 동일하게 기록해야 한다.

원격 process가 끝나면 exit code·duration과 pending log reference를 먼저 `verifying` run에 저장한다. 그 다음
Main은 별도 승인된 exact file read로 전체 file을 다시 읽어 로컬에서 SHA-256과 byte 수를 계산한 뒤 sequence가 1부터
연속인지, timestamp가 단조인지, `run-start → progress* → run-end → summary*` 순서인지, lifecycle status가
모순되지 않는지, template field type과 필수 위치 및 comparable primary metric을 검증한다. malformed,
truncated, hash mismatch와 모순된 lifecycle은 `invalid`, 필수 custom field 누락은 `incomplete`다. 실패·불완전
run도 file verification을 통과하면 log source를 보존하지만, valid하게 succeeded한 comparable run만
append-only summary metric evidence를 만든다. terminal run의 metric과 log reference는 수정할 수 없다.
승인 취소나 일시적인 SSH/file-read 장애가 나면 `verifying`을 유지하고, 같은 intent의 retry는 끝난 process를
재실행하지 않은 채 exact log file 검증만 재개한다. terminal run 저장 뒤 log-source link 또는 summary metric
projection 전에 앱이 중단되어도 terminal retry가 exact file과 stored run receipt를 재검증해 누락 projection만
idempotent하게 복구한다.

raw JSONL은 server가 authoritative source이며 SQLCipher, Hosted Sync, outbox와 telemetry에 저장하지 않는다.
Runs 화면의 `Open log`는 사용자가 요청할 때마다 exact project binding으로 원격 file 전체를 다시 읽고 stored
path·SHA-256·byte 수·offset·truncation을 로컬에서 검증한 다음, 검증된 내용만 bounded page로 나눠 Renderer
memory에 전달한다. 현재 이 on-demand read는 exact workspace에 Trusted access가 켜져 있어야 하며,
원격 path와 grant ID는 UI payload에 포함하지 않는다. app 재시작 시 남아 있던 foreground `running` run은
remote outcome을 추측하거나 자동 재실행하지 않고 `lost`로 reconciliation한다. process receipt가 저장된
`verifying` run은 그대로 유지하고, 재시작 뒤에도 exact intent로 file 검증만 재개한다. terminal 상태 뒤
log-source나 summary 저장 receipt가 끊기면 같은 execute idempotency key의 retry가 stored hash를 기준으로
후속 projection을 복구한다.

composite foreign key가 idea, run, binding과 log source의 project 경계를 고정하고, idea/run 수정은 version
CAS를 사용한다. metric point는 project별 단조 sequence를 가진 append-only record이며 실패·부분 성공·불확실
결과도 삭제하지 않는다. logging template, run, binding, intent와 log source도 provenance delete guard로
보호하며, project 휴지통을 비워도 이 실험 이력은 남는다. legacy `experiment_runs`는 명시적 idempotent schema
migration과 foreign-key 검사를 통과한 뒤에만 새 status·process receipt guard를 설치한다. process receipt가
없거나 valid log가 없는 legacy `succeeded` row는 migration marker가 이미 있어도 성공으로 추정하지 않고
`lost · provenance review required`로 보수적으로 격리한다. 그 run의 append-only `runner-summary` row는
삭제하지 않지만, valid log·exit 0·duration과 run/idea/Objective/latest-metric identity가 모두 일치하는 verified
success가 아니면 trajectory, metric query와 global search에서 제외한다. 구형 execution-intent table은 별도 idempotent
migration으로 남아 있는 grant의 connection/version/canonical root/hash를 암호화 DB에 backfill하되 legacy policy
sentinel hash로 재실행을 차단한다. grant가 이미 사라져 origin을 복원할 수 없으면 원래 intent 식별자·상대 log
경로를 append-only tombstone에 남긴다. pre-authority intent에 묶인 queued/running/verifying run과 terminal
`succeeded` run은 origin 복원 여부와 무관하게 `lost`로 격리하고, 이미 실패·취소·lost인 provenance는 유지한다.
count limit과 insert는
immediate transaction 안에서 수행한다. 이 데이터는 현재
Hosted Sync와 workspace outbox에 들어가지 않는다.

Main은 성공한 변경 뒤 project-scoped `experiment.workspace.changed` event만 Renderer로 보낸다. 화면은
같은 project event를 받으면 snapshot을 다시 읽어 trajectory, idea map과 report를 갱신한다. 차트는
`objectiveId + objectiveVersion + metricKey + evaluatorHash + datasetHash + holdoutHash`가 같은 point만
한 series로 연결하고 maximize/minimize 방향에 맞는 best-so-far를 별도로 계산한다. report도 저장된 idea,
outcome과 선택한 comparable series에서만 best result, baseline 대비 개선, phase와 lineage를 계산한다.
tool call, 작성 line, GPU job처럼 현재 authoritative source가 없는 숫자를 만들지 않는다.

이 surface의 `Local live`는 같은 Mac의 저장·event 반영을 뜻한다. `Runner not connected`인 동안 manual
summary 입력이 원격 실행을 증명하지 않으며, raw learning curve·resource sample을 실시간 relay하는 기능도
아니다. 실제 Runner 연결에서는 검증된 `RunnerEventMessageV1` 중 durable summary만 위 repository port로
투영하고 raw metric·log·resource sample은 기존 retention 정책대로 memory relay에만 둬야 한다.

Project Chat의 workspace-mode foreground experiment는 이 Runner bridge를 대신하지 않는다. 현재 실행은
최대 120초의 한 turn 범위이며 durable remote worker, live stream, budget enforcement, reconnect, unattended
continuation과 remote process-tree Stop/Kill을 보장하지 않는다. 이런 장기·자동 실험은 signed manifest,
lease·fencing과 reconciliation을 가진 향후 `submit_experiment_trial` 계열 Runner control path를 통해서만
실행해야 한다.

### Desktop Experiment Evaluation Studio 흐름

`Evaluation studio`는 기존 `ExperimentWorkspaceSnapshot`에 AI chat 상태를 섞지 않는 독립 모듈이다.
Renderer는 preload의 `experimentEvaluation` facade만 사용하고 Main은 `list / detail / create-session /
send / approve / reuse-profile` 고정 IPC와 project-scoped change event만 등록한다. 입력과 출력은
`experiment-evaluation-contracts.ts`의 strict schema로 검증하며 Renderer가 임의 channel, filesystem path,
Codex tool payload를 선택할 수 없다. Main의 `ExperimentEvaluationService`만 상태를 바꾸고, 현재 Objective,
immutable logging template와 bounded recent run은 `WorkspaceService`와 `ExperimentWorkspaceService` port를
통해 읽는다. 다른 Experiment table을 UI나 Evaluation repository가 직접 조회하거나 수정하지 않는다.

```mermaid
sequenceDiagram
  participant User as "Researcher"
  participant UI as "Evaluation Studio UI"
  participant Main as "Evaluation service"
  participant AI as "Pinned Codex harness"
  participant DB as "Evaluation SQLCipher repository"
  participant Files as "Protected profile artifacts"

  User->>UI: "cadence·metric·policy·output을 대화로 설명"
  UI->>Main: "send with project/session/version"
  Main->>AI: "bounded context + strict output schema"
  AI-->>Main: "proposal + synthetic preview"
  Main->>DB: "append immutable draft revision and message"
  DB-->>UI: "reviewable draft; no experiment evidence"
  User->>UI: "Approve & save recipe"
  UI->>Main: "approve exact revision with expected version"
  Main->>Files: "atomically create evaluator.py + prompt"
  Main->>DB: "CAS session and insert immutable recipe"
  DB-->>UI: "profile receipt and reusable history"
```

Evaluation chat은 pinned Codex App Server를 별도 configuration-author harness로 사용한다. 이 harness에는
`dynamicTools: []`를 주고 web, file, SSH, shell과 GOSU mutation을 제공하지 않으며 strict structured output만
받는다. AI는 step 또는 epoch cadence, 관찰/primary metric, evaluation policy, experiment rule, logging field
suggestion, number/table/plot output, bounded Python reference code와 reusable prompt를 **proposal**로만 만든다.
target threshold와 frozen Objective는 exploratory evaluation에서 선택 사항이다. comparable evidence를
설계하려면 기존 frozen Objective identity를 참조해야 하지만, chat은 Objective를 만들거나 바꾸지 않는다.
prompt context는 storage의 newest-first run 중 최근 12개, 완료된 chat 중 최근 8개를 message당 4,000자로
제한한다. draft JSON 자체도 100,000자 aggregate budget을 넘으면 저장하지 않아 최대 크기의 유효 recipe도 다음
turn에서 다시 수정할 수 있다. JSON escaping까지 포함한 전체 prompt가 180,000자를 넘으면 오래된 message, run,
logging field 순으로 context를 줄이고 그래도 필요할 때만 request를 잘라내며, 생략 수와 truncation 여부를 payload에
명시한다.

모든 preview는 contract에서 `dataKind=synthetic-preview`, `evidence=false`로 고정하고 UI에도
`Illustrative preview · not experiment evidence`를 표시한다. preview code는 Electron에서 실행하지 않는다.
선언한 number output은 해당 metric label의 preview number를, table output은 모든 column을 포함한 preview
table을, plot output은 같은 kind와 metric series를 가진 preview plot을 반드시 포함해야 한다. 단일 preview shape와
모순되지 않도록 draft는 table과 plot output을 각각 최대 하나만 선언하며 table은 12 column, plot은 6 series까지다.
line preview는 모든 series가 8개 미만의 ordered point만 가질 때 trend line을 숨기고 exact KPI와 table을
대신 보여 준다. 화면에는 series별 최근 12개 point만 그리며 truncation을 명시한다. line·marker style과
text legend를 함께 사용해 색만으로 series를 구분하지 않는다. 이 sparse-preview 규칙은 실제 Experiment
trajectory의 frozen Objective/evaluator/dataset lineage gate를 완화하지 않는다.

SQLCipher 저장소는 다음 네 schema를 독립적으로 소유한다.

- `experiment_evaluation_sessions`: project-scoped mutable workflow head이며 version CAS로 동시 수정을 막는다.
- `experiment_evaluation_messages`: session의 bounded user/assistant history와 resolved model invocation을 저장한다.
- `experiment_evaluation_revisions`: strict draft JSON, content hash와 model provenance를 append-only로 보존한다.
- `experiment_evaluation_profiles`: 승인한 exact revision, hash, invocation과 artifact receipt를 immutable recipe로
  보존한다. `use_count`와 `last_used_at`만 갱신할 수 있으며 reuse는 recipe를 수정하지 않고 새 session을 만든다.

AI 응답을 받는 것만으로 Goal & Metrics나 Logging을 바꾸지 않는다. `Review Goal & Metrics`는 해당 화면으로
이동할 뿐이고, logging suggestion은 기존 field와 `add / unchanged / conflict` diff로 먼저 보여 준다. 같은
key의 definition 충돌은 사용자가 replacement checkbox를 별도로 승인한 경우에만 반영되며, 그 뒤에도 별도
`Apply`를 눌러야 새 immutable logging template revision이 된다. `Approve & save recipe`도 Objective/logging을
암묵적으로 적용하거나 evaluator를 실행하지 않는다.
승인은 선택한 최신 revision과 expected session version을 다시 확인한 다음에만 성공한다.

승인 시 evaluator와 prompt는
`userData/evaluation-profiles/<project UUID>/<profile UUID>/<evaluator file>` 및
`evaluation-prompt.txt`에 저장한다. UUID와 Python file name을 allowlist로 검증하고 root containment를 확인하며,
directory는 mode `0700`, file은 `0600`으로 exclusive-create한다. root/project/profile directory의
최종 component가 symlink인지 검사하고 canonical parent 경계를 다시 확인하며, evaluator·prompt·pending marker는
`O_NOFOLLOW` handle로 쓰고 `fsync`한 뒤 directory entry까지 동기화한다. 임시 directory를 완성한 뒤 rename하고 DB
profile insert/CAS가 실패하면 exact profile directory를 rollback한다. rename된 directory에는 DB commit 전까지
pending marker를 남긴다. startup reconciliation은 marker가 있는 UUID directory를 persisted profile identity와
대조해 commit된 profile이면 marker를 끝내고, DB에 없는 crash orphan이면 exact directory만 제거한다. 한 손상된
entry나 DB lookup 실패가 다른 profile reconciliation을 막지 않으며 실패 수가 남으면 Local Data readiness에
복구 미완료 상태를 표시한다.
SQLCipher의 immutable draft가 canonical source이고 이 파일들은 derived local artifact다. recipe reuse는 DB draft로
예상한 exact relative receipt, private mode와 code/prompt bytes를 다시 검증하며 외부 수정·삭제가 있으면 clone을
중단한다. 이 artifact는 아직 Git canonical source, Obsidian Research Notes 또는 Runner artifact가 아니며 앱이
반환하는 relative receipt만 Renderer에 보인다.

reference Python은 문자열 정규식만으로 신뢰하지 않는다. Main은 Python parse tree를 끝까지 검사해 syntax
error, 허용하지 않은 import, dunder access와 file/network/process/dynamic-code/deserialization identifier를
거부하고, 승인 직전과 saved recipe 재사용 때 현재 policy로 다시 검증한다. 승인 profile에는 exact
`code_policy_hash`를 기록한다. 이 검사는 위험한 proposal을 일찍 차단하는 authoring gate이지 실행 sandbox나
실행 권한이 아니다. 후속 Runner는 같은 policy hash와 source digest를 다시 확인한 뒤 non-root, read-only
rootfs, capability drop, resource quota와 network default-deny 안에서만 evaluator를 실행해야 한다.

현재 slice가 보장하는 것은 evaluation **설계·검토·재사용**까지다. 승인 recipe의 step/epoch cadence가 실제
training process를 감시하거나 evaluator를 주기 실행하지 않으며 synthetic preview를 run result로 ingest하지
않는다. 후속 Runner binding은 recipe content hash, evaluator/prompt artifact digest, frozen Objective와
immutable logging template, dataset/holdout identity, signed `JobManifestV1`, lease/fencing token과 budget을 한
execution intent에 고정해야 한다. Runner가 내보낸 evaluation result만 append-only result/event path로 받아
number/table/plot을 실제 evidence로 승격하고, duplicate/out-of-order cadence event와 reconnect를 reconcile해야
한다. 이 bridge 전에는 UI나 AI가 recipe 저장을 자동 evaluation 실행 또는 live result라고 표현하면 안 된다.

## 8. Desktop 보안 모델

현재 구현된 보안 불변식은 다음과 같다.

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`를 유지한다.
- preload는 작은 `window.gosu` API만 노출한다. arbitrary IPC channel이나 raw Electron object를
  노출하지 않는다. sandboxed preload의 runtime validator는 build 안에 묶고, production build
  검사는 `electron` 외의 external `require()`가 남으면 실패시킨다. preload가 통째로 로드되지 않아
  Renderer가 빈 화면이 되는 packaging regression을 이 경계에서 차단한다.
- Main은 sender가 현재 window의 exact main frame이며 신뢰한 production file URL 또는 설정된
  development origin인지 매 IPC 호출마다 확인한다. development origin은 명시적 port를 가진
  loopback HTTP(S)만 허용하며 packaged build는 `ELECTRON_RENDERER_URL` override를 무시한다.
- navigation과 redirect는 신뢰한 renderer URL 밖으로 나가지 못한다. 새 창은 거부하고 HTTPS
  링크만 system browser로 연다.
- macOS application menu의 `Settings…`는 payload를 받지 않는 고정 Main→Renderer event 하나만
  preload에 노출한다. generic route·channel 이름을 Renderer가 선택하게 하지 않으며, early event는
  preload가 한 번 buffer해 같은 window의 app-level Settings 화면으로 전달한다.
- packaged CSP는 script와 connection을 same-origin으로 제한하고 object·frame·base를 차단한다.
  Vite 개발 모드에서만 exact trusted origin의 inline refresh bootstrap과 HMR WebSocket을 허용한다.
- SQLite key는 random 32-byte 값이며 `safeStorage`로 봉인한다. 암호화 기능이 없으면 local DB를
  열지 않는다.
- Obsidian reader는 사용자가 고른 Vault의 현재 project root 아래 bounded Markdown만 Renderer와 agent에
  제공한다. symlink, root escape, 과도한 파일 크기·개수·깊이를 거부한다. Vault ID는 canonical root와
  root device·inode에, project grant는 별도 binding ID와 ownership marker에 묶이고 매 list/read와 managed
  write 전후에 identity를 재검사한다. `VaultAccess`는 reader와 selection을 하나의 immutable state로 완성한
  뒤 원자적으로 교체하며, 전환 중이던 accessor는 `vault_grant_stale`로 실패한다. Renderer에는 Vault-wide
  `current/read/write` bridge가 없고 project ID가 포함된 Research Notes IPC만 있다. agent read는 root나
  path를 받지 않고 active project ID, binding ID와 note ID를 Main에서 다시 해석한다. `O_NOFOLLOW`로 연
  file descriptor의 device·inode와 post-open canonical target을 읽기
  전후에 비교한다. Node의 path API만으로 ancestor 전체를 descriptor-relative하게 고정할 수는 없으므로,
  정교한 local directory-swap race를 완전히 닫으려면 후속 native `openat` traversal이 필요하다.
- Codex child는 허용된 최소 환경만 상속하고 stdio JSON-RPC로 initialize한다. GOSU 전용
  `CODEX_HOME`은 mode `0700`, 그 안에서 GOSU의 명시적인 ChatGPT/API-key login으로 만들어진
  `auth.json`은 regular non-symlink file과 mode `0600`을 요구한다. OAuth refresh token은 회전하므로
  다른 Codex 설치의 인증을 읽거나 복사하지 않는다. GOSU logout 뒤에도 개인 Codex 인증을 몰래
  재수입하지 않으며 인증정보는 Hosted Sync로 보내지 않는다. 연결 상태는 cached account/model이 아니라
  `account/read`의 credential refresh를 통과해야 `Connected`로 표시한다. system-browser login 완료 event는
  success boolean만 fixed Main→Preload→Renderer channel로 전달해 catalog를 자동 갱신하고, login ID·email·
  provider error·token은 Renderer나 local DB에 노출하지 않는다.
- Project Chat의 Codex SQLite runtime은 mode `0700` 임시 디렉터리로 분리하고 child 종료·앱 종료 시
  삭제한다. 정상 종료가 동기 삭제를 마친 뒤 child `close`에서도 한 번 더 정리해 late write를 없앤다.
  process config에서 transcript history, analytics, OTel export와 user-prompt logging을 끈다. crash 뒤
  남은 정확한 `gosu-codex-runtime-*`·`gosu-chat-image-*` 디렉터리는 symlink와 최근·유사 이름을 제외하고
  24시간 age-bound를 넘은 경우에만 다음 primary-instance 시작에서 정리한다. 실제 integration test는
  ephemeral prompt가 장기 `CODEX_HOME`에 남지 않고 임시 SQLite에만 존재했다가 cleanup되는지 검사한다.
- model picker는 paginated `model/list` 전체 결과를 사용한다. 새 catalog를 가져올 때마다 snapshot
  event를 내보내 SQLCipher에 저장하고, `turn/start` 직전에도 cached catalog를 authority로 재사용하지 않고
  provider에서 fresh catalog를 받아 explicit model·reasoning ID를 다시 검증한다. 사라진 ID는 provider
  fallback에 맡기기 전에 fail closed한다. 실제 resolved model ID와 reasoning option은 turn provenance로
  기록하며 early `model/rerouted` event도 turn 시작 응답까지 bounded buffer에 보존한다.
- agent mode picker는 pinned Codex App Server의 experimental `collaborationMode/list` 결과를 strict하게
  검증하고 opaque mode ID·표시명·추천 model/reasoning을 사용한다. GOSU가 `default`, `plan` 또는 향후
  mode 목록을 제품 enum으로 하드코딩하지 않는다. mode catalog는 canonical SHA-256으로 고정하며 prompt
  조립 뒤 catalog가 바뀌거나 mode·추천 model이 사라지면 silent fallback 없이 turn을 중단한다.
- Hermes는 release GOSU에 포함된 relocatable Python sidecar와 검토된 Hermes source를 통해서만 기본
  연결한다. runtime manifest는 package version `0.19.1`, upstream source revision
  `a4a91610b05acc75b4d76c077a5cd89c1ee066ba`, ACP/shim protocol, target OS/architecture와 모든 runtime
  file의 상대경로·byte size·executable bit·SHA-256을 고정한다. packaged Main은 `Contents/Resources`의
  manifest와 전체 file set/tree hash를 검증하고 PATH나 사용자의 mutable checkout을 검색하지 않는다.
  development build만 packaged bundle이 없을 때 기존 표준 local wrapper를 fallback으로 사용할 수 있다.
  기본 provider는 계속 Codex이며 Settings에서 Hermes를 명시적으로 선택하기 전에는 Hermes model을 Project
  Chat catalog에 넣지 않는다. Hermes turn이 실패해도 Codex로 자동 fallback하지 않는다.
- 연결 전 preflight는 manifest로 검증한 Python과 source root를 sealed shim에 전달한다. 먼저
  `pyproject.toml` package version이 정확히 `0.19.1`인지 Hermes import 없이 검사하고, 이어
  `hermes_cli`를 import해 module `__version__`도 같은지 확인한 뒤에만 config·provider·agent module을
  불러온다. 다른 version은 ACP·permission 불변식을 다시 검토해 adapter를 갱신하기 전까지 fail closed한다.
  shim은 user model-provider plugin discovery를 provider 해석 전에 봉인하고 bundled provider profile만
  허용하며 MoA·Copilot ACP 같은 meta/external-process provider와 검토하지 않은 API mode를 거절한다.
  production ACP composition은 이 legacy shim의 `check` path만 runtime/config discovery에 사용한다. 같은
  adapter file에 남은 sealed text-only `run` path와 `startThread`·`runTurn`은 현재 production composition에서
  호출되지 않고 기존 unit test만 실행하는 dormant implementation이다.
- preflight를 통과한 실제 turn은 public `hermes acp` launcher를 직접 실행하지 않는다. Electron Main은
  pinned Python을 isolated mode인 `-I -c <reviewed sealed source>`로 시작하고 Nous Research의 공식
  [ACP integration](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp) server class를
  stdio JSON-RPC/ACP v1으로 구동한다. project/session hash로 분리한 Hermes profile을 만들고 user provider
  plugin, configured MCP, rules/context file, soul·memory, YOLO·auto approval, transcript/session DB,
  checkpoint·fallback model을 차단한다. GOSU client capability는 terminal과 file callback을 제공하지 않고
  `mcpServers: []`와 `HERMES_ACP_SKIP_CONFIGURED_MCP=1`을 다시 고정한다.
- child environment는 Electron/Finder에서도 고정 bundled Python과 runtime을 찾을 수 있도록 검증된 경로만
  전달하고, HOME·locale·temporary-directory·proxy·certificate 외 app environment는 제거한다. provider와
  AWS credential 환경변수는 agent와 tool module을 import하기 전에 모두 지우고, preflight에서 선택·검증한
  inference credential만 agent constructor argument로 전달한다. `SSH_AUTH_SOCK`도 Hermes child에 넘기지
  않는다. Hermes `CredentialPool`은 exact pinned pool/provider/entry type만 read-only snapshot으로 해석하며
  refresh·rotation·write를 호출하지 않는다. 선택한 pool/provider/entry identity는 credential 값 없이 route
  fingerprint와 connection proof에 묶고, 실제 credential과 pool object는 `AIAgent` 구성 뒤 agent/tool import
  환경에서 제거한다. user/project/entrypoint plugin discovery와 configured MCP는 계속 봉인한다.
- production Hermes native tool inventory는 비어 있다. custom empty toolset을 강제하고 shell·terminal·
  process·code execution·file read/write·web·browser·memory·skill·MCP·native `delegate_task`·GOSU mutation
  tool을 이름과 toolset 양쪽에서 거절한다. 그러므로 upstream delegation transcript·summary spill·async
  completion persistence 경로도 호출되지 않는다. 이 release의 Hermes surface에는 승인 가능한 mutation이
  없어 `Allow once` dialog도 열리지 않는다. future bridge를 위한 broker 구현은 active ACP session과 exact
  turn에 묶여 있으며 예상하지 않은 permission request나 late event는 취소한다.
- Hermes catalog는 hard-coded provider model 목록 대신 현재 Hermes 설정에서 해석한 actual model을 picker
  label로 표시하고 configured inference provider는 Main-only catalog metadata에 둔다. normalized base URL,
  API mode, model/provider/requested-provider, region과 non-secret credential selection/source는 deterministic
  `routeFingerprint`에 넣고 transport와 함께 opaque catalog version에 결합한다. 실제 key/token 연속성은
  connection마다 새 random key로 만든 HMAC proof로 별도 고정하며 binding key와 proof는 Main memory와
  private child environment에만 있고 catalog·ModelInvocation·IPC·durable provenance에는 넣지 않는다. 연결
  때와 매 thread/turn/delegation 직전 route fingerprint 또는 credential proof가 달라지면 전체 Hermes
  connection을 끊고 중단한다. durable primary invocation은 `providerId=hermes`, requested/resolved model,
  catalog version, reasoning과 시각을 기록한다. Codex가 Hermes에 위임한 각 실행은 별도 append-only SQLCipher
  receipt에 invocation ID, project/session/attempt, `providerId=hermes`, `transport=acp-v1`, actual model,
  configured provider, catalog version, ACP agent name/version, stop reason과 시작·기록 시각을 남긴다. 같은
  invocation의 동일 재시도는 idempotent하고 다른 payload 재사용은 거절한다. raw task/context/reply, credential,
  route proof는 receipt에 저장하지 않는다. 새 Hermes 버전이 wrapper·agent constructor·tool 불변식을 바꾸면
  재연결을 거절한다.
- Hermes Project Chat은 text input/output와 native reasoning을 지원하지만 GOSU Board·Literature·
  Research Notes·SSH broker dynamic tool과 turn attachment는 아직 ACP에 bridge하지 않는다. 대신 Hermes가
  유효한 GOSU response envelope를 반환하면 Board action proposal과 create-only Research Notes disposition은
  기존 Main 검증·Apply/persistence gate를 그대로 통과하며, 일반 text 응답은 advice-only envelope로 감싼다.
  Literature와 Lecture 생성은 현재 Codex 전용이다. provider router는 `codex:`와 `hermes:` thread 소유권과
  disconnect를 분리하고 각 Hermes thread를 별도 ACP process로 실행하므로 같은 project의 여러 session에서
  Codex/Hermes turn을 병렬 실행할 수 있다. model/reasoning 선택은 project/session별 Renderer local
  preference로 복원한다. 저장된 scope 선택이 없는 새 session은 Settings의 Codex default model/reasoning을
  한 번 복사하며, 그 뒤 Settings 변경은 기존 session이나 queued turn을 바꾸지 않는다. ACP cwd는 Git
  worktree나 Vault가 아니라 app-private
  `project-chat-workspaces/<project UUID>`지만 현재 allowlist에는 이를 읽거나 바꾸는 file/shell tool이 없다.
  Settings에서 Hermes를 명시적으로 끄면 Main이 connection authority를
  폐기하고 새 turn을 차단하며 primary·delegation을 포함한 모든 live client process와 pending approval을
  즉시 종료한다. Codex thread는 유지되고 provider fallback은 없으며 앱 종료도 같은 tracked-client 전체를
  동기적으로 강제 종료한다. connect/preflight/turn 직전 runtime 또는 credential 검증이 실패하면 Main의
  Hermes authority와 Renderer의 provider/model 선택 상태를 즉시 무효화한다. 종료는 process group의 실제
  사망을 확인하고, 확인하지 못하면 연결 해제로 가장하지 않고 추적 상태를 유지해 다시 종료한다.
- Codex를 primary provider로 유지한 상태에서도 사용자가 Hermes에게 작업을 명시적으로 맡기면
  `delegate_to_hermes_agent` dynamic tool을 그 turn에만 추가한다. tool은 exact project/session/attempt/cwd,
  10분 timeout, turn당 최대 3회, bounded task/context/result와 AbortSignal에 묶인다. Hermes 실패를 Codex로
  대체하지 않으며 visible appendix에는 provider/model/stop reason receipt만 남기고 raw delegated task,
  context, ACP payload와 Hermes 원문 응답은 durable provenance에 저장하지 않는다. 대신 위의 bounded
  structured receipt를 assistant 결과 전달 전에 append-only로 기록하며, 이 기록이 실패하면 결과 전달도
  fail closed한다. 단순한 사용 가능 여부 질문은 현재 연결 상태를 trusted developer instruction으로 전달하고
  실제 delegation을 시작하지 않는다.
- GOSU는 Codex의 base instructions와 agent loop를 덮어쓰지 않는다. `thread/start`에는 project 권한,
  evidence 취급, Apply gate만 포함한 최소 product policy를 developer instructions로 주고,
  `turn/start.collaborationMode.settings.developer_instructions`는 `null`로 보내 Codex에 내장된 mode
  instructions를 사용한다. pinned 0.149.0 runtime에서 thread developer instructions와 collaboration-mode
  developer fragment는 별도 context layer로 유지되므로 native mode가 product policy를 제거하지 않는다.
  request-shape test는 두 layer가 동시에 전달되는지 고정한다. personality와 model verbosity도 Codex native
  setting으로 전달한다.
- Project Chat turn은 `approvalPolicy: never`, read-only sandbox, general network off, empty environments와
  empty runtime roots로 시작한다. process와 thread 양쪽에서 shell, unified exec, browser, Apps,
  plugins, MCP, image generation, multi-agent와 utility tool을 끈다. project profile의
  `webSearchMode`만 Codex first-party `web_search`를 `disabled|cached|live` 중 하나로 설정하며 기본값은
  `cached`다. 이 설정은 shell network, 임의 URL fetch, browser page control, Apps·MCP를 켜지 않는다.
  invalid mode는 thread 생성 전에 거절하고, 선택 mode는 profile과 각 attempt에 고정해 silent fallback을
  허용하지 않는다. web result와 page 내용은 untrusted evidence이며 raw search payload를 Renderer,
  Project Chat DB 또는 telemetry에 자동 전달하지 않는다. 나머지 예외는 Main이 turn마다 선언하는
  `gosu_project` namespace의 typed dynamic tool뿐이다. Board·Objective·Research Notes·SSH workspace catalog와
  정규화된 server resource snapshot 조회는 read-only다. 별도 Main broker의 workspace file operation은
  기본 mode에서 사용자 `Allow once` 뒤 bounded UTF-8 file list/read/create/expected-hash-checked atomic
  replacement를 수행하고, workspace command도 별도의 `Allow once` 뒤 Git inspection, bounded test/build
  또는 제한된 foreground Python experiment를 수행한다. exact direct-target trusted binding이
  유효하면 같은 typed validation과 capacity 제한을 유지한 채 dialog만 생략하고 append-only audit를 실행
  전에 성공시켜야 한다. create/replace와 code execution은 side effect가 가능하며 remote sandbox가 아니다. 이 예외는
  Codex sandbox 자체에 shell이나 network를 부여하지 않는다. `thread/start`
  직후 예상 밖 MCP inventory가 0이
  아니면 fail closed하고 thread를 해제한다. server-initiated command·file approval은 Main이 거절하고 그 밖의
  지원하지 않는 request에는 제한된 protocol error만 돌려준다.
- dynamic tool transport는 thread별 allowlist와 handler를 묶고 strict request envelope, namespace와
  tool 일치, 실제 `turn/start` ID binding, 중복 call ID, turn·thread 호출 수, 동시성,
  argument·result character cap과 기본 10초 timeout을 검사한다. 긴 승인이 필요한 declared tool만
  registration에 고정된 timeout override를 가질 수 있다. 현재
  `search_literature`는 discovery provider의 rate limit·fallback을 포함한 125초,
  `read_ssh_workspace_resources`는 고정 probe의 최악 시간을 포함한 40초,
  `list_ssh_workspace_files`·`read_ssh_workspace_file`·`write_ssh_workspace_file`와
  `run_ssh_workspace_command`는 모두 450초 dynamic-tool budget을 사용한다. 이는 기본 300초 approval
  decision window, 최대 120초 command execution과 transport·settlement용 30초 margin의 합이다. file helper
  execution 자체는 최대 30초지만 approval-bearing file tool도 놓친 Renderer event를 query로 복원할 시간을 포함해
  같은 450초 outer budget을 사용한다.
  attachment list/text-read는 기본 10초 transport bound를 유지하며 모델이 timeout을 늘리거나 미등록
  tool에 override를 붙일 수 없다. 조기 tool call이
  먼저 도착하면 그 turn ID로
  임시 binding한 뒤 `turn/start` 응답과 반드시 일치하는지 재검사한다. 실제 tool argument는 다시 strict
  Zod schema로 검증한다. handler 성공만으로 읽기 출처를 확정하지 않고, 검증된 tool result를 현재 Codex
  child의 stdin에 쓴 뒤 최대 1초 안에 write callback이 성공해야만 delivery를 `delivered`로 확정한다.
  write를 시작하기 전의 invalid result·handler timeout·tool revoke는 `discarded`다. write가 시작된 뒤의
  acknowledgement timeout·async write error·connection 변경·tool revoke는 이미 일부 byte가 전달됐을
  가능성을 되돌릴 수 없으므로 `uncertain`으로 정산하고 출처에는 `delivery unconfirmed`를 붙인다. App
  Server는 provider의 thread ID를 MCP inventory await 전에 동기적으로 예약하고, Project Chat router도
  active thread ID의 단일 소유권을 검사한다. provider가 기존 ID를 동시에 다시 반환해도 기존 project
  handler·Vault/attachment grant를 덮어쓰거나 unsubscribe하지 않고 두 번째 start를 거절한다.
  terminal·cancel은 thread registration과 Literature·attachment·SSH capability를 revoke하고, 늦게 끝난
  handler 결과를 채택하지 않는다. raw tool call·note/attachment body와 temporary image path는 Project
  Chat DB, Renderer, telemetry에 자동 전달하지 않는다.
  모델이 visible reply에 인용한 text는 raw payload가 아니라 보이는 대화의 privacy 정책을 따른다.
- Codex의 reasoning, command output, file diff, tool payload는 Project Chat DB나 Renderer로 전달하지
  않는다. Renderer에는 보이는 최종 답변, turn 상태, 검증된 action receipt만 보낸다.
- Project Chat profile·custom instruction·조립된 prompt provenance는 로컬 SQLCipher에만 저장한다.
  Hosted Sync, workspace outbox와 telemetry로 보내지 않으며 custom instruction도 project data와 같은
  untrusted input으로 취급한다.
- Project Chat toolbar의 `Project rules`는 project 하나에 속한 standing policy를 ordered list로
  관리한다. 최대 20개, item당 800자, 전체 8,000자이며 trim·NFC 정규화 후 case-insensitive
  중복, control·bidi·zero-width 문자를 Main에서 거절한다. add·edit·remove는 현재 profile
  version CAS로 전체 list를 새 immutable instruction revision에 저장한다. legacy profile은 빈 list로
  읽히며 Settings와 Local Notes grant 변경은 현재 list를 보존한다.
- Main은 모든 기존·신규 session turn을 조립할 때 현재 project profile의 exact rule list를
  `projectPolicyRules` JSON field로 한 번만 넣고, rule list hash·count와 profile/instruction revision을
  attempt provenance에 고정한다. rule text는 developer instruction에 문자열로 삽입하지 않는 untrusted
  project data이지만, 고정 GOSU policy가 모든 session에서 standing constraint로 적용하라고 지시한다.
  현재 요청과 materially 관련된 rule은 visible reply 첫머리에서 1-based 번호를 명시하고 exact threshold·순서·
  정의·필수 step을 project-specific primary answer로 우선해야 한다. generic 권고로 configured rule을 희석하거나
  대체할 수 없고, 호환되는 추가 조언은 optional 또는 stricter라고 구분한다. 완료 turn metadata는 실제 적용을
  과장하지 않고 prompt에 고정된 rule snapshot count만 표시한다.
  rule은 safety·authorization·evidence·tool boundary를 덮어쓰거나 permission·project scope를 늘릴
  수 없다. accepted queued turn이 있는 동안 profile 변경을 막아 queued profile version을 무효화하지
  않는다.
- Renderer의 완료 메시지는 model provenance와 `Edit & branch`·`Branch` history action을 별도 footer로
  쌓지 않고 하나의 wrapping metadata row에 둔다. 좁은 화면과 큰 글꼴에서는 한 번만 자연스럽게 줄바꿈하며,
  pointer UI는 조밀하게 유지하되 coarse-pointer 환경은 44px 최소 touch target을 보장한다.
- SSH transport profile은 모든 local project가 공유하는 SQLCipher registry가 소유하되 remote workspace
  권한은 별도 project-scoped, versioned grant로 분리한다. 하나의 profile은 여러 project의 grant가 동시에
  참조할 수 있고, 한 project도 여러 profile을 연결할 수 있는 many-to-many 구조다. profile은 기존 `~/.ssh/config` alias 또는
  정규화된 direct target 중 하나이며, grant만 connection ID·canonical root·`diagnostics|workspace` mode를
  가진다. Project Chat은 active project에 속한 grant의 opaque ID·label·mode만 볼 수 있고 Main이
  project·session·attempt·turn·tool-call과 실제 connection을 주입한다. 모델은 host·username·port·root·
  credential·private-key path를 list 결과에서 받거나 다른 project의 grant를 선택할 수 없다.
  server profile 등록은 transport 후보만 만들며 project grant나 실제 접속을 의미하지 않는다. 등록 직후와
  grant가 없는 Project Chat에는 `Grant to project` 동선을 표시하고 project-scoped form으로 즉시 이동해
  유일한 등록 server를 자동 선택한다. 사용자는 그곳에서 exact remote project root·permission mode·risk를
  별도로 확인해야 하며 UI가 이 승인 단계를 자동 통과하지 않는다. 같은 form과 기존 grant row의 명시적
  `Test server`는 transport/auth 상태만 확인하고 project grant나 command 승인을 대신하지 않는다.
- `workspace` mode의 direct target이고 SSH user가 명시적으로 확인된 `standard|root`일 때 사용자가
  project별 `Project trusted execution / Auto-run`을 켤 수 있다. standard account는 두 번의 위험 확인,
  root account는 ROOT가 remote server 전체에 영향을 줄 수 있다는 별도 ROOT 확인과
  `confirmRootTrustedWorkspaceRisk`가 필요하다. user가 생략되거나 alias라 privilege가 `unknown`인 target은
  auto-run을 허용하지 않는다. 이 mode는 기존 typed
  list/read/create/hash-checked replace와 inspect/test/build/foreground experiment allowlist에서 반복
  `Allow once`만 생략하며 raw shell, privilege, secret/key path, TTY·forwarding, host mount, grant 밖 path,
  destructive host command와 background/unattended 실행을 추가하지 않는다. trust record는 exact
  project·grant ID/version·connection ID/version·canonical root·policy version에 묶이며 grant/profile 변경,
  revoke, project/session cancel과 shutdown에 즉시 무효화된다. Main은 async audit 전에 global/per-turn slot을
  reservation해 동시 경합을 막고, append-only SQLCipher audit가 성공한 뒤 cancellation·shutdown·binding을
  다시 검사한 경우에만 runner를 시작한다. audit에는 operation과 command hash만 있고 raw preview/output은
  없다. 다만 허용된 Python·test·build는 SSH account의 OS·network 권한으로 subprocess를 실행할 수 있으므로
  typed path policy를 remote sandbox로 표현하지 않는다. 특히 root auto-run에서 launch된 repository code는
  canonical root 밖을 포함해 root account가 접근 가능한 server 전체를 읽거나 변경할 수 있다. Connections의
  active-project grant row와 Project Chat의 linked-server details에서 같은 exact project 설정을 켜고 끌 수
  있다. trusted policy v2 전의 binding은 자동 만료되어 새 경고로 다시 확인해야 한다.
- Connections surface는 global SSH registry의 등록 server card를 Runtime·Codex·project grant보다 먼저
  렌더링하며, card 안에서도 실제 server row 또는 empty state를 onboarding·import·alias 등록 form보다 먼저
  DOM에 배치한다. 이 순서는 first-glance 상태 확인과 keyboard·screen-reader 탐색을 일치시키기 위한 UI
  ordering일 뿐이며 global transport profile 등록 → project-scoped workspace grant → 기본 command별
  `Allow once` 또는 별도 trusted binding 경계를 합치거나 자동 승인하지 않는다. 기존
  import·Test·Edit·Remove와 Project Chat CTA의 grant form
  focus·신규 server preselection은 그대로 유지한다.
- 각 등록 server row는 이미 연결된 모든 active project를 badge로 표시하고, project selector의
  `Link another project`로 같은 server를 추가 project에 연결할 수 있다. 이 동작은 grant를 즉시 만들지
  않고 선택한 project의 기존 grant form을 해당 connection으로 미리 선택해 연다. 각 project grant는
  canonical remote root, `diagnostics|workspace` mode와 HIGH-RISK 확인을 독립적으로 거치고 독립적으로
  revoke된다. project Archive는 selector와 active badge에서만 숨기며 기존 grant를 삭제하지 않는다.
- server resource monitor는 Renderer나 모델이 command를 구성하는 범용 SSH API가 아니다. Main만
  `/bin/cat /proc/stat /proc/meminfo`, 짧은 local sampling interval 뒤의 `/proc/stat`, 고정된
  `/usr/bin/nvidia-smi`, `/usr/local/bin/nvidia-smi`, `/usr/local/nvidia/bin/nvidia-smi`의 bounded absolute
  allowlist를 순서대로 확인하고 첫 실행 가능한 binary에 고정
  `--query-gpu=... --format=csv,noheader,nounits` args를 붙여 non-interactive OpenSSH argv로 실행한다.
  shell·PATH lookup·모델 입력은 사용하지 않으며 executable-not-found일 때만 다음 후보로 이동한다.
  stdout/stderr는 Main에서 strict parser로 CPU utilization·logical processor 수, RAM
  used/total, GPU별 utilization·VRAM·temperature와 bounded issue로 바꾼 뒤 폐기한다. GPU가 없거나 일부
  probe가 실패해도 가능한 CPU/RAM sample은 `partial`로 유지하며 0%로 가장하지 않는다. Project Chat의
  `read_ssh_workspace_resources`도 모델이 준 opaque grant ID를 active project grant로 다시 해석한 뒤 같은
  monitor를 사용한다. 모델에는 connection label, capture 시각·상태, 정규화된 CPU/RAM/GPU 값과 bounded
  issue만 돌려주며 connection ID, host·user·port, workspace root, probe command와 raw output은 노출하지
  않는다. 모델은 `force`를 지정할 수 없고 기존 12초 cache를 공유한다. connection `Test`도 raw OpenSSH
  stderr 대신 `ready | unknown_host_key | authentication_failed | timed_out | connection_failed`의 typed
  code만 반환한다. resource issue는 local SSH client 부재, transport 실패, CPU/RAM parser 실패,
  `nvidia-smi` 실행 파일 부재, NVIDIA device 없음과 malformed probe output을 구분해 사용자가 GPU 0%와
  측정 불가를 혼동하지 않게 한다.
- resource snapshot은 connection profile identity와 generation별 12초 in-memory cache 및 in-flight
  coalescing, 전역 최대 4개 capture로 제한한다. Renderer의 local-only preference는 자동 갱신을
  `Manual / 30 seconds / 1 minute / 5 minutes / 10 minutes` 중에서 고르며 기본값은 1분이다. 자동 모드도
  Connections 또는 Project Chat이 실제로 보이고 document가 visible일 때만 동작한다. recursive timeout은
  이전 조회가 끝난 뒤 다음 주기를 예약해 느린 server 조회를 겹치지 않게 하고, document가 숨겨지면 예약을
  취소하며 다시 보일 때 한 번 즉시 갱신한다. Manual은 자동 예약과 화면 복귀 갱신을 모두 끄되 server별
  명시적 Refresh는 유지한다. 실패해도 마지막 sample을 stale로 표시하고 Board·chat·grant 상태를
  실패시키지 않는다. profile update·remove·import 변경은 진행 중인 이전 probe를 무효화하며, Renderer도
  profile generation이 바뀐 뒤 도착한 응답과 더 오래된 sample을 버린다.
  Connections와 Project Chat은 같은 snapshot state를 공유하지만 resource card의 접기 상태는 UI local
  state다. 접으면 상세 meter만 숨기고 `Server usage` 옆의 compact chip으로 CPU·RAM과 GPU utilization을
  계속 표시한다. multi-GPU는 reporting device 중 최대값을 `GPU max`로 명시하고 reporting count를 함께
  표시하며, unavailable·not-detected·stale을 0%로 가장하지 않는다. live/partial/unavailable 상태, capture
  시각과 bounded issue도 남긴다. Project Chat card는 좁은 대화 공간을 위해 기본으로 접고 Connections
  card는 기본으로 펼친다. 접기는 polling을 중단하거나 project authorization 경계를 바꾸지 않는다.
  SSH resource detail, Project Chat session rail과 Research Notes tree의 접기 방향 표시는 font glyph가 아니라
  shared `CollapseChevron` SVG를 사용한다. 19px viewport와 2.25px round stroke를 고정해 작은 caption font나
  OS font fallback에서도 화살표가 축소되지 않게 하고, 각 button의 28–32px 이상 hit area와 기존
  `aria-label`·`aria-expanded` 계약은 유지한다.
  Connections는 global registry를 볼 수 있지만 Project Chat resource list는 Main이
  active project를 다시 검증한 뒤 그 project에 grant된 connection만 반환한다. Project Chat의 server별
  `Refresh`도 project ID와 connection ID를 함께 받는 별도 IPC에서 active project와 현재 grant를 다시
  검증하고 그 server 하나만 probe한다. project 전환 뒤 이전 project snapshot은 새 chat UI에 투영하지
  않는다.
- Connections의 별도 importer는 전체 `ssh -p ... user@host -L ...` 문자열을 shell이나 LLM으로 실행하지
  않고 bounded parser로 분해한다. `ssh`, `-p`, `-l`, 하나의 destination과 loopback-only `-L`만 허용하고
  remote command, quoting·expansion, key/config/proxy/jump, reverse/dynamic forwarding, TTY와 agent forwarding
  option은 거절한다. 원본 paste 문자열은 저장하지 않고 host·optional user/port와 정규화된 `-L` plan만
  저장한다. `-L`은 UI에 inactive로 표시하며 Project Chat transport는 항상 forwarding을 지운다. 기존 alias
  form과 row는 그대로 호환한다. 사용자가 server name을 생략하면 endpoint를 복사한 이름 대신 순번이 붙은
  opaque default label을 만들어 model-visible workspace catalog가 host·user·port를 우회 노출하지 않게 한다.
- remote workspace grant는 Renderer의 현재 project를 Main에서 다시 검증한 뒤 생성·수정한다. `workspace`
  mode는 사용자가 exact remote root와 project code 실행 위험을 명시적으로 확인해야 한다. direct target의
  user가 `root`면 connection과 approval UI에 ROOT/HIGH RISK를 표시한다. root diagnostics는 file/process
  secret을 읽지 못하는 축소 allowlist만 쓰고, root workspace 실행도 일반 grant보다 안전하다고 주장하지
  않는다. root workspace 실행과 ROOT auto-run은 명시적 project grant와 별도 ROOT 경고를 요구하는
  prototype-only HIGH-RISK 예외다. auto-run을 끄면 매 operation `Allow once`로 돌아간다. hardened
  production 실행은 root SSH workspace가 아니라 non-root
  isolated Runner를 사용해야 한다. alias profile과 user를 생략한 direct target은 실제 account privilege를 확정할 수 없으므로
  `unknown`·HIGH RISK로 표시한다. alias에는 `workspace` mode grant를 허용하지 않으며, user를 생략한 direct
  target의 workspace mode도 사용자가 이 불확실성과 code-execution risk를 명시적으로 확인해야 한다. 명시적
  `root`가 아닌 unknown target이 실제 root인지 Main이 감지할 수 없다는 한계가 있으므로 auto-run은
  fail closed한다. canonical root와
  relative subdirectory 검사는 lexical policy이며 symlink·project code·build tool을 격리하는 remote
  sandbox가 아니다.
- system diagnostics와 `run_ssh_workspace_command`는 서로 다른 typed policy다. workspace tool은 exact grant,
  concrete executable, argument array, relative subdirectory와 bounded timeout을 받고 shell·inline eval,
  `sudo`·`su`·`doas`, nested SSH·transfer, TTY·forwarding·background/unattended 실행을 pre-approval에서
  fail closed한다. `diagnostics` mode는 bounded inspect만, `workspace` mode는 inspect, 작은 test/build
  allowlist와 제한된 foreground Python experiment를 허용한다. experiment는 `/usr/bin/python` 또는
  `/usr/bin/python3`, optional `-u`, workspace 안의 relative `.py` entrypoint와 bounded argument만 허용하며
  module·inline eval·stdin script·absolute path·traversal·background 실행을 거절한다. 최대 120초인 foreground
  trial일 뿐 장기·무인 실행이나 hard remote process kill을 보증하지 않는다. Git inspect는 subcommand별
  argument schema를 사용하고 fsmonitor·hook·pager config와 external diff·textconv를 Main이 exact approval
  preview 전에 비활성화한다. project test/build/experiment는 repository code를 해당 remote account 권한으로
  실행할 수 있음을 승인 UI와 trusted consent에 명시한다. 기본 mode의 command는 actual target, root/cwd,
  operation class와 exact preview를 보여 주는 centered blocking alert dialog에서 5분짜리 `Allow once`
  결정을 새로 받고 승인 후 profile·grant version을 다시 확인한다. exact trusted binding이 유효한 경우에만
  같은 typed validation 뒤 dialog 대신 durable audit-before-execute 경로를 사용한다.
  이 승인은 표시된 executable·argv·cwd에만 결합되고 entrypoint나 test/build가 읽을 repository source file
  hash에는 결합되지 않는다. 따라서 승인 뒤 launch 전 source가 바뀔 수 있으며 command approval을 immutable
  source identity 또는 재현성 증명으로 취급하면 안 된다.
  이미 시작된 profile·grant mutation queue가 끝나기 전에는 이 최종 확인과 transport 시작을 진행하지 않아
  승인과 revoke/update가 겹쳐도 이전 권한으로 실행되지 않는다. Node test는 명시적인 `node --test`만
  허용하며 일반 `node script.js`는 test로 분류하지 않는다.
- remote file access는 raw shell, `scp` 또는 모델이 만든 helper script가 아니라
  `list_ssh_workspace_files`·`read_ssh_workspace_file`·`write_ssh_workspace_file`의 typed contract다.
  세 operation 모두 explicit `workspace` mode grant가 필요하며 기본 mode에서는 매 호출 `Allow once`,
  exact trusted binding에서는 같은 validation과 audit-before-execute를 요구한다. Main이
  project·session·attempt·turn·tool-call·connection과 canonical root를 주입한다. list는 최대 200개의
  상대 regular-file 후보와 byte size만, read는 최대 16,000자의 UTF-8 chunk·full-file SHA-256·offset을
  반환한다. create는 `expectedSha256: null`일 때 대상이 없어야 하고, replace는 직전 read에서 받은
  SHA-256과 기존 file이 일치해야 한다. 승인 UI는 action, relative path, expected/new hash와
  create/replace의 exact content를 표시한다. file create/replace 승인과 그 파일을 사용하는 command 실행
  승인은 결합하지 않는다. 기본 mode에서는 각각 별도의 fresh `Allow once` request이고 trusted mode에서도
  서로 다른 operation과 command hash audit로 남는다.
- file broker의 Python program은 app에 고정된 source이며 `/usr/bin/python3 -I -S -c`로만 실행한다.
  모델 가변 데이터는 최대 64 KiB strict JSON stdin으로만 전달되고 command argv나 interpreter code가
  되지 않는다. remote helper는 root와 working directory의 `realpath`를 다시 확인하고 directory file
  descriptor, `O_NOFOLLOW`, 상대 segment 검증으로 symlink·traversal·root 이탈을 차단한다.
  `.git`·`.ssh`·`.gnupg`·`.aws`, `.env*`, credential/private-key 형태의 path, binary·NUL·
  64 KiB 초과 file을 거절한다. write는 같은 directory의 mode 0600 temporary file에 쓴 뒤 fsync하고,
  create-only hard-link 또는 기존 identity/hash 재검사 뒤 atomic replace와 directory fsync를 사용한다.
  delete·rename·chmod·parent directory 생성·binary transfer·large artifact download는 제공하지 않는다.
  이 검사는 accidental overwrite와 path escape를 막는 좁은 broker이며, SSH account나 remote kernel이
  악의적일 때의 hard sandbox 또는 모든 외부 writer와의 선형화 가능한 filesystem transaction은 아니다.
  특히 expected SHA 재검사와 final rename 사이에 unrelated process가 path를 바꿀 수 있으므로 이 동작을
  compare-and-swap 또는 serialization으로 부르지 않는다. remote mutation 뒤 receipt·transport가 실패하면
  commit outcome도 uncertain하다. agent는 같은 path를 다시 읽어 실제 SHA를 proposed content hash와
  비교하기 전에는 재시도하거나 변경되지 않았다고 주장하면 안 된다.
- `/usr/bin/ssh`는 `shell: false` argument array, POSIX token quoting, strict host-key, no TTY·forwarding·
  local command·password prompt 옵션을 사용한다. alias는 사용자의 OpenSSH config와 agent/Keychain을 쓰고,
  direct target은 `-F none`을 사용하고 importer에 제공된 경우에만 user/port를 명시해 config option을
  상속하지 않는다. 일반 command는 `-n`과 ignored stdin을 유지한다. 오직 app-owned file helper만
  `-n`을 제거하고 byte cap을 미리 검증한 exact UTF-8 JSON stdin pipe를 사용하며, stdin SHA-256도
  approved command hash에 포함한다.
  `ForkAfterAuthentication=no`와 `ControlMaster=no`를 강제해 추적 중인 child를 background transport로
  분리하지 못하게 한다. OpenSSH 자체 진단은 process별 권한 `0600` 임시 `-E` log로 격리하고 exit 255는
  이 private diagnostic으로만 분류한 뒤 log directory를 항상 삭제한다. timeout, cancel, grant/profile 삭제,
  session/turn 종료와 app shutdown은 로컬 OpenSSH child에 SIGTERM 뒤 SIGKILL을 보낼 뿐 remote process tree
  종료를 보증하지 않는다. 장기·무인 workload와 hard confinement는 Runner가 소유해야 한다.
- raw remote stdout/stderr는 Main memory에서 bounded·cropped `untrusted_remote_output` tool result로 Codex에
  전달한 뒤 폐기하며 SQLCipher, Hosted Sync, outbox와 telemetry에 저장하지 않는다. 모델이 그 결과를
  visible answer에 요약하면 그 문장만 일반 대화 보존 정책을 따른다. 기본 Allow-once approval
  request·allowed/denied/expired/cancelled event와 outcome은 현재 app process와 turn 수명의 ephemeral
  상태다. trusted auto-execution만 transport 시작 전에 project/grant/connection/policy/turn/tool-call,
  operation과 command SHA-256을 local append-only audit에 기록하며 raw preview·output은 기록하지 않는다.
  connection label 자체도 tenant secret으로 사용하지 않는다.

### Project-scoped Obsidian Research Notes 경계

Research Notes는 임의 local folder browser가 아니라 사용자가 한 번 선택한 Obsidian Vault 안에 만드는
project-scoped workspace다. Vault root의 canonical path와 device/inode identity는 Main process의
`VaultReader`가 검증하고, root 선택은 암호화 local cache에만 보존한다. Renderer에는 absolute root나
Vault 전체 file 목록을 내보내지 않으며 `current`, `read`, `readAttachment`, Literature projection과 paper
note 생성으로 제한된 typed Research Notes IPC만 제공한다.

각 active project는 SQLCipher에 저장한 64-hex `bindingId`와 Vault ID를 가지며, 기본 root는
`GOSU/<safe project name>`이다. NFKC 정규화·separator/control 제거·UTF-8 byte 제한을 통과한 이름만 쓰고,
프로젝트 root에는 숨은 `.gosu-project.json` ownership marker를 둔다. marker의 project ID, binding ID,
Vault ID가 모두 일치할 때만 다음 기본 구조를 생성하거나 읽는다.

- `Literature/Literature Review.md`
- `Papers/Papers Index.md`와 선택된 paper note
- `Experiments/Experiment Log.md`
- `Project Progress/Project Progress.md`
- `Idea Development/Idea Development.md`
- `Lecture Notes & Slides` 아래 Lecture Studio의 immutable revision pair

GOSU가 새로 만드는 모든 Research Notes Markdown은 하나의 versioned v2 frontmatter envelope를 사용한다.
예약 field는 `gosu_schema_version`, stable document ID·kind·managed flag, `created_at`, `modified_at`, 검증된
tag, project ID·이름, origin, Project Chat session ID·이름, creator ID·표시명, project-relative 관련 문서
link, credential 없는 HTTPS 관련 논문 link와 bounded provenance record다. Project Chat artifact는 Main이
실제 session title과 resolved model ID를 주입하므로 모델이 작성자·session metadata를 가장하거나 frontmatter를
본문에 삽입할 수 없다. 초기 template, Literature Review projection, paper note와 Lecture Studio revision도
같은 serializer를 거치며 managed projection을 갱신할 때 `created_at`은 보존하고 `modified_at`만 바꾼다.
현재 `creator_id`·`creator_name`은 인증된 사람 계정이 아니라 문서를 실제 생성한 technical producer identity다.
Project Chat artifact에는 resolved model ID, app-owned template·projection에는 GOSU system identity를 기록한다.
Google·Apple Identity가 구현되기 전까지 이 값을 human actor 감사 identity로 해석하지 않는다.
배열은 중복을 거절하고 caller가 준 stable order로 쓰며 custom property는 reserved key를 덮을 수 없다. 기존 사용자
Markdown과 legacy GOSU 문서는 연결만으로 rewrite하지 않아 사용자의 Git/Obsidian history를 오염시키지 않는다.

기존 사용자 folder가 같은 이름을 쓰면 덮어쓰지 않고 project ID prefix가 붙은 독립 folder를 최초
할당한다. symlink, root escape, marker 변경, file/directory 충돌과 과도하게 큰 managed file은 fail
closed한다. 일반 Vault content는 계속 read-only이며 GOSU write 권한은 ownership marker가 있는 project
root의 초기 template, 고정 Literature projection, 사용자가 명시적으로 만드는 paper note와 승인된
Project Chat의 category-scoped create-only Markdown artifact와 Lecture Studio가 명시한 output project의
revision artifact pair에만 있다. Renderer에는 generic path
write/delete/rename IPC를 제공하지 않는다.

Project Chat의 required structured final response는 `researchNote`를 `none` 또는 단일 `save` payload로
선언한다. `save`는 상대·절대 path 없이 고정 category, title과 Markdown body만 포함하며 terminal에서
모든 model tool intake를 먼저 닫은 뒤 Main이 직접 저장한다. Main은 category를 `Literature`, `Papers`, `Experiments`, `Project Progress`,
`Idea Development` 중 하나로 매핑하고 NFKC·control/separator·UTF-8 byte 제한을 적용한 file stem과
project/binding/attempt의 deterministic 16-hex artifact suffix를 만든다. write는 exclusive create이고
동일 terminal persistence retry는 생성 path와 bytes가 정확히 같을 때만 idempotent success다. 기존 user note와 managed
projection은 교체하지 않는다. active project, binding, Vault identity와 ownership marker를 write 직전과
receipt 확정 전에 다시 확인하며 exact target을 symlink-safe Vault adapter로 다시 읽어 proposed bytes와
비교한다. write 이후 project·binding·grant·ownership 또는 target 확인이 실패하면 성공으로 가장하지 않고
`commit uncertain`으로 남겨 사용자가 Research Notes를 확인하게 한다.

Main은 write 시작 전에 Markdown body나 Vault root 없이 project·session·attempt·binding·category,
deterministic artifact ID와 expected content SHA-256을 SQLCipher receipt journal에 `staged`로 기록한다.
10초의 bounded terminal wait에서 확정되지 않으면 `uncertain`과 server-owned pending appendix를 남기며
경로를 주장하지 않는다. exact path와 bytes가 확인되면 `committed-unreported`에서 assistant message와 같은
transaction으로 상대 경로를 append한 뒤 `reported`가 된다. 앱 시작과 사용자가 Vault를 다시 선택해
project binding이 ready가 된 직후 `staged|uncertain` receipt를 artifact suffix와 exact hash로 재검증한다.
연결된 folder가 실제로 사용 가능하지만 artifact가 없으면 pending 문구를 `abandoned` not-saved receipt로
원자 교체한다. 같은 process의 늦은 exact-byte 성공은 `abandoned`를 다시 promote해 not-saved 문구를 지우고
성공 경로를 정확히 한 번 붙일 수 있다. Vault offline·stale binding·hash mismatch는 absence로 오인하지 않고
다음 reconciliation을 위해 `uncertain`에 남긴다.

Literature의 authoritative source는 project별 SQLCipher table이다. 검색·import·manual review·AI metadata
정리가 commit된 뒤 `Literature Review.md`를 deterministic sort와 source digest로 다시 만든다. 이 파일은
`GOSU-MANAGED-FILE` marker가 있는 경우에만 atomic replace하며 사용자가 같은 경로에 만든 일반 Markdown은
덮어쓰지 않는다. projection 실패는 Literature commit을 rollback하지 않고 다음 진입·변경에서 재시도할
수 있으며, 같은 content면 파일을 다시 교체하지 않는다. `Papers` note는 명시적 UI action, 사람의
review/inclusion 또는 metadata-only AI 정리 시 한 번만
생성한다. 생성 뒤에는 user-owned라 GOSU가 다시 덮어쓰지 않고, full text를 읽지 않았다면
`metadata_only: true`, `full_text_reviewed: false`를 유지한다.

project rename은 workspace DB rename을 먼저 commit한 뒤 owned Obsidian folder move를 시도한다. 성공하면
marker와 display root를 갱신한다. Vault offline, destination collision, source missing 또는 ownership 변경이면
원래 folder를 그대로 두고 `rename-pending`과 bounded attention code를 저장한다. Research Notes 화면에서
상태를 설명하고 안전한 retry를 제공하며, pending 동안 agent tool grant는 비활성이다. project Archive나
Trash는 Obsidian file을 삭제하지 않는다. 같은 Vault를 다시 선택해도 기존 binding과 충돌 회피 suffix를
재사용하고, macOS에서 이름의 대소문자만 바꾸는 rename도 같은 directory identity를 확인해 처리한다.

Project Chat grant는 Vault 전체 ID가 아니라 active project의 `bindingId`에 묶인다. read grant와
`allowAgentMarkdownCreate` capability는 분리하며 기존·legacy grant의 capability 부재는 명시적으로 false다.
Main은 매 turn 전에 project·binding·Vault root identity·ownership marker를 다시 확인한다. 목록은
project-relative Markdown의 opaque ID와 title만, 읽기는 bounded excerpt만 반환한다. reusable Markdown
deliverable은 ordinary short reply·clarification·raw log·중복 Literature projection을 제외하고 별도 저장
지시 없이 structured final response의 단일 create payload로 제출한다. 성공 receipt는 relative path와
content SHA-256만 반환하고 Main이 terminal answer에
`Research Notes/<relative path>`를 append하므로 모델이 위치를 빼먹어도 사용자에게 보인다. 다른 project,
일반 Vault content, absolute path와 managed tool payload는 노출하지 않는다.

이 결정의 배경, 대안과 rollback 경계는
[`ADR 0002`](adr/0002-project-scoped-obsidian-research-notes.md)에 고정한다.

### Workspace-level Lecture Studio 경계

Lecture Studio는 project child tab이 아니라 여러 active project를 source로 선택하는 Workspace 전역 module이다.
한 studio는 source project·Literature record·Experiment idea·captured Manuscript/Overleaf checkpoint·사용자가
선택한 local `.tex/.md/.pdf` snapshot, `lecture|talk`, 선택적인
`10|20|30|50`분 duration, notes·slides page target, `concise|standard|detailed|exhaustive` detail level,
`adaptive|custom` notes·slides structure, 최대 6,000자의 추가 생성 지시와 한 `outputProjectId`를 소유한다.
output project는 source project 중 하나여야 한다. SQLCipher의 Lecture-owned schema가 generation brief를 포함한
studio configuration, 전용 user/assistant message와 append-only revision을 보존하며 Project Chat
session·queue·profile·message table을 읽거나 수정하지 않는다.

Settings의 application-local `Lecture defaults`는 새 Studio에 복사할 기본 structure와 visible document
feature를 소유한다. document feature 기본값은 workspace-wide이며 `outputProjectId`별 override를 둘 수 있다.
여러 source project를 합친 Studio도 결과를 저장하는 output project의 override 하나만 사용한다. 기본
`adaptive` mode는 선택한 source에서 개념 순서와 section 이름을 정한다. `custom` mode는 1~12개의 ordered
row를 두고 각 row가 notes와 slides 모두에 들어갈지(`notes-and-slides`), notes에만 들어갈지(`notes-only`)
선택한다. notes는 모든 row를 순서대로 다루고 slides는 `notes-and-slides` row만 같은 상대 순서의 concise
projection으로 다룬다. section 이름은 trim·NFC normalization 뒤 최대 80자이고 case-insensitive unique여야
하며 hidden/control character, bracket·brace·angle-bracket markup과 system-owned `Title|Title slide|Sources
used` 이름을 거부한다. 적어도 한 row는 notes와 slides가 공유해야 한다. custom structure는 별도 document
feature를 section row로 중복 소유하지 않는다. `includeSlideTitlePage`, `showInlineEvidenceLabels`,
`includeSourcesUsedSection`은 각각 slide title page, PDF의 inline `[P1]`류 marker, notes 끝의 visible source
list만 제어한다. 이 세 presentation feature는 workspace/project default, 새 Studio copy, 기존 Studio의
`Edit options`, 현재 Studio에 대한 명시적인 Lecture Assistant 지시로 조정할 수 있다. Assistant 지시는 현재
message만 target-aware하게 해석하고 quoted 문구의 의미를 묻는 질문은 설정 변경으로 보지 않는다. Studio
turn을 시작하는 transaction에서 full brief와 함께 저장하므로 실패 후 Retry도 같은 선택을 사용한다. 어느
표시 조합에서도 frozen source manifest provenance, claim별 evidence binding, unknown-label 거부,
preamble·wrapper·허용 LaTeX grammar와 compile은 GOSU가 계속 소유한다.
structure와 generation brief는 unknown key를 거부하는 strict schema이고 normalized full brief JSON은 최대
14,000자로 제한한다.

새 Settings default와 새 Studio write에서는 `Sources`, `References`, `Bibliography`, `Works cited`,
`Citations`, 대응하는 한국어 표현을 포함한 source-list 의미 alias를 custom content section 이름으로
거부한다. 기존 Studio와 v3 revision의 JSON/hash 호환성을 위해 historical schema 자체는 바꾸지 않으며,
pre-v7 Studio에 이미 저장된 normalized alias는 같은 이름으로 유지하거나 제거하는 update만 허용하고 새로
도입하거나 다른 alias로 바꾸는 것은 Main에서 거부한다. 생성·검증은 그 Studio가 grandfather한 exact alias만
일반 content section으로 취급하고 실제 system `Sources used` section은 언제나 별도로 식별한다.

새 Studio composer는 그 시점의 Settings structure와 `project override → workspace default`로 resolve한
document feature를 full generation brief에 한 번 snapshot하고 Main 검증 뒤
SQLCipher configuration으로 저장한다. 이후 Settings 변경은 기존 Studio나 revision을 바꾸지 않는다. legacy
`generation_brief_json`에 `structure`가 없으면 다른 field를 보존한 채 explicit `adaptive`로 읽는다. 기존
Studio에 `documentFeatures`가 없으면 title page와 inline marker는 기존 동작인 on으로 두고, Sources list는
latest canonical notes의 실제 section 상태를 이어받아 첫 다음 turn/Edit에서 explicit full brief로 저장한다.
legacy v3 revision snapshot parser는 이 optional field에 default를 materialize하지 않아 기존 JSON SHA-256을
그대로 검증한다. authoring policy v8 이상으로 만든 새 revision은 세 feature를 반드시 snapshot한다. 기존
Studio의 compact `Edit options` panel은 notes target, slides target, detail, structure, 세 document feature,
추가 지시의 full brief를 다시 제출한다. project/workspace default load는 현재 값을 editor draft로 명시적으로
복사할 뿐이며 Save가
필요하다. Main은 `expectedVersion`이 정확하고 Studio가 `draft|ready|failed`, non-trashed, non-generating일
때만 같은 SQL
transaction에서 brief·`updatedAt`·version을 갱신한다. 동일한 normalized brief는 version을 올리지 않는
no-op이다. 저장 뒤 Renderer는 detail과 version을 즉시 다시 읽으며 새 brief는 다음 initial/retry generation과
Lecture chat revision부터 적용된다. 이미 commit된 revision, frozen manifest와 artifact는 수정하지 않는다.
새 studio의 source/output 후보는 active project로 제한하지만, 기존 artifact preview는 archived project를
포함한 workspace snapshot에서 output project 이름을 resolve해 과거 저장 위치를 ID로 퇴행시키지 않는다.
전송하지 않은 studio별 chat draft는 DesktopApp이 소유한 renderer-session volatile map에만 두어 tab
unmount/remount 뒤에도 복원하되 앱 종료 시 폐기하고 SQLCipher, localStorage, Hosted Sync에 기록하지 않는다.
Lecture workspace의 session rail과 전용 assistant rail은 서로 독립적으로 접을 수 있고 그 상태만 renderer
localStorage에 저장한다. 일반 desktop 폭에서는 `session rail / document preview / assistant rail`의 3열을
유지해 notes·slides·PDF를 보면서 오른쪽 chat에 수정 지시를 입력한다. 두 rail을 접어도 center preview는
unmount하지 않으므로 현재 LaTeX source/PDF tab과 PDF page 위치를 보존한다. PDF preview가 준비되면 내부
header의 `Focus PDF`가 transient viewer-only mode를 켠다. 이 mode는 session rail, assistant rail, Studio
header, document tabs, artifact action bar와 surface banner를 숨기고 content padding을 줄여 PDF에 전체 Lecture
workspace를 할당한다. `Exit focus` 또는 Escape는 기존 rail preference, current page와 scroll을 그대로
복원하며 focus state 자체는 저장하지 않는다. 일반 PDF mode도 Studio header·tab·artifact bar와 PDF metadata
header를 compact하게 유지한다. 바깥 Projects rail은 별도로
resize되므로 Lecture surface는 viewport media query가 아니라 자기 실제 inline width를 container query로
판단한다. 980px 이하에서는 assistant, 700px 이하에서는 session list도 edge rail을 남긴 overlay drawer로
전환해 최소 window와 최대 Projects rail에서도 preview나 복원 버튼이 잘리지 않게 한다. 920px 이하의 실제
mobile viewport에서만 single-column layout으로 전환한다.

list IPC는 문서 본문 없이 bounded studio summary만 반환하고, 선택한 studio의 message와 revision은
detail IPC로 따로 hydrate한다. source candidate IPC는 project별 offset/limit page를 반환하지만, 현재 source
port는 project당 최대 Literature record 500개와 Experiment idea 500개의 bounded set 및 최대 32개
Manuscript identity를 각 module 경계에서 읽어 deterministic sort와 slice를 수행한다. 따라서 storage-level cursor paging은 아직 아니며 더 큰 repository를
지원할 때 port를 확장해야 한다. Literature의 기본 후보는 사람이 `included|reviewed`로 분류한 record다.
candidate 화면은 반환 page의 Experiment idea ID만 SQL window query에 넘겨 idea별 최신 metric 1개와 total
count만 받고, generation은 candidate page를 신뢰하지 않고 selected ID를 각 module repository에서 직접 다시
조회해 idea별 최신 64개를 오름차순으로 hydrate한다. frozen manifest에는 Literature record/annotation
version, review status, metadata-only 표시와 manual/AI topic, Experiment idea version·parent·outcome과 bounded
최신 metric tail의 Objective/evaluator/dataset/holdout lineage가 들어간다. Manuscript 후보는 current
binding의 exact captured checkpoint가 있을 때만 선택 가능하다. 생성 시 Main이 checkpoint를 다시 검증하고
deterministic path 순서의 UTF-8 `.tex`·`.bib` source 전체를 bounded chunk로 읽어 full-file SHA-256과
총 문자 수를 계산한다. model context에는 root-first deterministic bounded exact extract만 넣고 v2
manifest에는 `contentComplete`, extraction policy version, full-file SHA-256, checkpoint/provider revision과
envelope digest를 고정한다. 따라서 24,000자를 넘는 일반 논문도 한 chunk 제한으로 오판하지 않지만, extract만
제공된 경우 model과 UI는 원문 전체를 읽었다고 주장하지 않는다. serialized extract는 전체 100,000자 JSON
budget과 source manifest 120,000자 budget을 함께 지킨다. checkpoint가 없으면 Manuscript 탭에서 capture하라는
안내를 표시한다.

사용자가 `Add files`에서 고른 `.tex`, `.md`/`.markdown`, `.pdf`는 Renderer가 경로나 bytes를 받지 않는다.
Main의 native multi-select dialog가 file별 20 MiB, 전체 50 MiB, 최대 12개를 검사하고 app-owned `0700`
directory의 `0600` copy로 즉시 고정한다. TeX·Markdown은 strict UTF-8 exact text를 file별 최대 40,000자,
전체 최대 80,000자까지 보존한다. PDF는 기존 bounded PDF.js extractor로 최대 500 page의 selectable text만
page label과 함께 고정하며 scan, figure, equation-as-image와 page layout을 복원하지 않는다. 공개 card에는
absolute/managed path와 raw extract를 넣지 않는다. 생성 시 Main이 copy를 다시 열어 byte length·SHA-256을
재검증하고, strict schema·policy와 extraction content hash를 통과한 frozen extraction manifest를 v3
manifest에 full source hash, completeness와 `[F#]` label과 함께 고정한다. managed manifest는 per-install
safeStorage key의 versioned HMAC envelope로 인증하므로 path copy나 manifest 변조를 막으면서도, 향후 PDF.js
또는 안내 문구가 바뀌었다는 이유만으로 과거의 정상 snapshot을 다시 추출해 손상으로 오판하지 않는다.

file picker 단계에는 Main-generated `sourceSetId`를 쓰는 1시간짜리 staging set만 존재한다. 같은 set의
append·remove·discard·claim은 Main의 keyed FIFO mutation queue에서 직렬화하고 claim lease를 고정해 동시
추가의 last-write-wins, aggregate budget 우회와 두 Studio의 중복 claim을 막는다. Studio create는
Main-generated Studio ID 아래 선택 source를 먼저 claim하고 frozen manifest를 preflight한 뒤 SQLCipher row를
commit한다. 성공 뒤 staging set을 폐기하고, preflight·DB 실패 시 claimed copy를 제거해 같은 staging set으로
재시도할 수 있다. rollback file cleanup까지 일시 실패하면 orphan copy를 startup reconciliation에 남기되
process-local claim lease는 즉시 해제해 같은 staging set의 현재-session 재시도를 막지 않는다. 취소·output
project 변경·composer unmount는 staging set을 폐기하며 crash 잔여분은 bounded
startup cleanup으로 만료 후 정리한다. recoverable Lecture Trash 동안 claimed copy는 유지해 다음 revision을
재현하고, 영구 Lecture Trash purge 뒤에만 identity-derived Studio copy를 지운다. SQL purge 뒤 filesystem
정리가 일시 실패해도 다음 startup이 active·trashed Studio identity 전체와 managed manifest를 대조해 orphan
Studio copy와 중단된 claim directory를 bounded scan으로 재정리한다.

이미 revision이 있는 Studio의 Lecture assistant는 한 편집에만 쓰는 `.tex`, `.md`/`.markdown`, `.pdf`
첨부를 최대 5개 받는다. Renderer는 Studio ID와 Main-generated opaque attachment ID만 보내고 file path,
bytes, 추출 본문이나 project scope를 정하지 않는다. Main은 현재 Studio에서 output project를 다시 resolve한
뒤 위와 같은 authenticated `0700/0600` staging·UTF-8/PDF selectable-text extraction을 재사용하며, picker가
열린 사이 Studio version·상태가 바뀌면 새 copy를 폐기한다. send 직전 keyed source-set queue 안에서 exact
bytes·source SHA·extraction SHA를 다시 검증해 immutable in-memory snapshot을 만들고 lease를 1시간 갱신한다.
release와 snapshot은 직렬화되어 release가 먼저면 send가 fail closed하고, snapshot이 먼저면 이후 원본 copy를
지워도 active turn의 frozen evidence는 바뀌지 않는다.

첨부 snapshot은 해당 turn의 v4 source manifest에 `[A1]`부터 순서대로 들어가며 serialized manifest 전체는
기존 120,000자 한도를 지킨다. prompt에 보낸 bounded content와 revision에 저장한 content·hash가 동일하고,
assistant output의 `[A#]` 인용도 다른 source label과 같은 gate를 통과해야 한다. 성공한 SQLCipher revision
commit 뒤에만 staged original copy를 consume하고, cleanup 실패는 성공을 되돌리지 않으며 TTL cleanup이
처리한다. provider·validator·compile·artifact·DB 실패와 cancel은 copy를 보존해 같은 composer ID로 재시도할
수 있다. 다음 edit에는 자동 상속하지 않으므로 다시 첨부해야 한다. 성공 user message에는 path/body 없는
파일명·format·크기·hash receipt만 남고, bounded extracted text는 그 성공 revision의 provenance로 보존됨을
UI가 명시한다. 다음 edit의 prompt copy에서는 이전 `[A#]` 인용과 Sources mapping을 retired marker로 치환하고
과거 chat의 모든 `[A#]`도 중립화해, 새 attachment가 같은 ordinal을 받아도 이전 evidence로 오인되지 않게 한다.

Lecture composer의 Overleaf Git URL은 별도 live reader가 아니다. 기존 Manuscript module의 fixed
`create → saved-personal-token snapshot → connect → fetch checkpoint` port를 호출해 exact captured
checkpoint를 만든 뒤 일반 Manuscript `[M#]` source로 선택한다. personal token은 Settings의
고정 typed IPC에서만 입력되며 Lecture import contract은 token field를 허용하지 않는다. Main은
새 link를 만들 때 현재 Settings token의 immutable·workspace-bound `safeStorage` snapshot을 만들고,
Lecture receipt, source manifest와 Renderer persistence에 URL/token을 반환하지 않는다. Settings token을
교체하거나 삭제해도 기존 binding은 자신의 snapshot으로 계속 작동하며, 삭제는 Overleaf에서
token을 revoke하지 않는다. binding 이후
capture가 실패하면 연결 provenance를 보존해 Manuscript에서 복구하게 하며 임의 삭제하지 않는다.
Live·저장 전 Overleaf edit, provider PDF, image/binary와 이후 provider revision은 다음 checkpoint를 명시적으로
capture하기 전까지 Lecture source가 아니다.
모든 revision은 자기 manifest SHA-256을 보존하므로
이후 source 변경이 과거 deck을 소급 변경하지 않는다.

Main은 output project의 ready Research Notes binding, Vault grant와 ownership marker를 Codex 호출 전에
preflight한다. Codex App Server에는 manifest, 현재 draft, 최근 Lecture chat, generation brief와 현재 request만
주고 web, dynamic tool, shell, filesystem, Apps/MCP를 허용하지 않는다. 직렬화된 prompt는 360,000자, source
manifest는 120,000자로
제한한다. frozen manifest, 현재 notes/slides와 이번 user request는 모델이 보는 값과 저장 provenance가 항상
같아야 하므로 자르지 않는다. 이 authoritative context가 한도를 넘으면 `lecture_context_too_large`로 Codex
호출 전에 fail closed하고, 축약 가능한 최근 12개 성공 message에만 명시적 truncation marker를 적용한다.
실패·취소·앱 재시작으로 중단된 user request는 각각 `failed|interrupted`로 원자적으로 전이해 다음 prompt에서
제외한다. actual model invocation을 revision에 기록한다. generation attempt는 연결 상태와 무관한 단일 3분
wall-clock timeout을 쓰지 않는다. initial turn과 필요한 경우의 한 correction turn은 각각 현재 turn과 일치하는
Codex progress notification·invocation이 올 때마다 갱신되는 새 3분 idle deadline을 가지되, 둘은 같은 최대
30분 absolute hard deadline을 공유한다. idle/hard timeout은
`lecture_generation_timed_out`으로 고정한다. terminal `Turn.error`에서는 allowlist된
`codexErrorInfo` kind만 읽어 인증 만료·로그인 필요를 `lecture_auth_required`, 사용량 한도를
`lecture_usage_limit_exceeded`, 일시적인 provider/response-stream 장애를 `lecture_generation_interrupted`,
context/session budget을 `lecture_context_too_large`, 알 수 없는 terminal failure를
`lecture_generation_failed`로 구분한다. raw provider message와 additional details는 Renderer·Studio record·
telemetry에 넣지 않는다. 실제 App Server 시작·process transport 단절만 `lecture_codex_unavailable`로 분류해
연결 상태를 오표시하지 않는다. 인증이 필요하면 같은 revision-0 Studio를 보존한 채 system-browser sign-in과
catalog 자동 refresh 뒤 `Retry generation`으로 재사용한다.
각 `runTurn` control-plane request는 App Server의 별도 최대 30초 request bound를 가지며, Main은 응답 직후
공유 hard deadline과 cancel state를 다시 검사해 늦게 도착한 turn을 승인하거나 저장하지 않는다.
생성 중 Renderer에는 `attemptId`, 단조 증가 sequence, 시작·발생 timestamp와 GOSU가 정의한 고정 phase만
담은 strict `lecture.generation.progress` event를 보낸다. frozen source 해석, 기존 revision edit-base 로드,
bounded context 구성, model 시작, 첫 complete pair 생성 또는 기존 complete pair revision, model activity,
output 검증, 한 번의 자동 교정, 두 PDF compile, artifact staging, provenance commit을 구분하며 Renderer는
경과 시간과 최근 20개 bounded activity를 표시한다. revision chat이 작은 patch가 아니라 현재 Notes·Slides를
prompt의 `currentDraft`로 읽은 뒤 두 complete replacement body를 반환받는다는 실행 특성도 생성 화면에
명시한다. literal text 변경은 app 내 `Edit source`가 model 호출을 생략하는 경로다. model activity는 5초에
한 번 이하로 제한하고 같은 연속 phase는 UI에서 합치므로 event storm이 detail reload를 유발하지 않는다.
live event는 근사적인 상태일 뿐 model reasoning log가 아니다. 별도의
`lecture_studio_attempts` row에는 semantic phase의 첫 발생 시각, requested/resolved model identity, initial·
correction validation의 고정 category와 notes/slides별 reason, token 개수와 terminal code만 bounded하게 남긴다.
임의 token 문자열, raw Codex notification, prompt/source/output 본문, provider message, compiler stderr,
thread/turn ID와 filesystem path는 attempt row·Renderer·Hosted Sync·telemetry 어디에도 넣지 않는다.

첫 생성과 명시적인 `Generate new revision`의 structured output은 고정 JSON field의 notes/article LaTeX
body와 Beamer frame body를 반환한다. 반면 기존 canonical LaTeX revision을 대상으로 하는 Lecture Assistant
chat은 LLM을 생략하지 않고 user request와 wrapper-free current Notes·Slides body를 함께 읽되,
`reply`와 최대 24개의 localized `edits[]`만 반환한다. 각 edit는 `lecture-notes|slides`, 현재 body에서 정확히 한
번 나타나는 `find`, 그리고 `replace`로 구성하고 각 문자열은 40,000자, 전체 patch JSON은 100,000자로
제한한다. Main은 edit를 순서대로 적용하며 missing·duplicate target, no-op, 또는 큰 문서 하나를 사실상 통째로
교체하도록 한 document의 누적 affected text가 원본의 80% 이상인 patch를 거부한다. 설명만 필요한 요청은 빈
edit list를 허용한다. patch 적용 뒤에는
변경하지 않은 counterpart까지 포함한 완전한 resulting pair에 대해 기존 evidence, figure, source-list, page,
bounded LaTeX 검증과 두 PDF compile을 그대로 수행하고, 실패하면 같은 patch schema로 한 번만 자동 교정한다.
따라서 자연어 이해와 수정 판단은 LLM이 담당하지만 단순 수정 때문에 두 body를 다시 생성·전송하지 않는다.
legacy Markdown revision의 canonical migration은 예외적으로 complete pair output을 유지한다.

resulting structured document는 알려진
`[P#]|[E#]|[M#]|[F#]|[A#]` inline label, substantive frame별 evidence label, duration 또는 사용자가 명시한
compiled slide page target을 검증한다. model candidate는 marker 표시 설정과 무관하게 raw evidence label을
항상 제출한다. 검증 뒤 새 canonical wrapper v3는 이를 compiler-owned `\\gosuevidence{P1}` anchor로 바꾸며,
visible mode는 `[P1]`로, hidden mode는 빈 출력으로 render한다. 다음 edit prompt 전에는 anchor를 다시 bounded
label로 복원한다. 따라서 PDF가 visually uncited여도 claim별 binding과 frozen manifest/hash는 남는다. legacy
wrapper v1/v2는 byte-compatible하게 read/export/compile한다. `includeSourcesUsedSection`이 true이면 notes 끝 list와
완전한 label mapping을 요구하고 false이면 section을 거부한다. slide target은 항상 최종 PDF page 수다.
title page가 켜지면 content frame은 target−1, 꺼지면 target과 같으며 최소 한 content frame을 보장한다. notes
page target은 typography에 따른 근사 지시다. authoring policy v9는 이 feature contract와 JSON 안의 body,
patch `find`, patch `replace`에 있는 모든 LaTeX backslash를 `\\`로 encode하는
transport contract를 함께 고정한다. 새 generated body에서 raw `\b`·`\f`가 U+0008·U+000C로 decode된
경우에만 literal backslash prefix로 복원하고 전체
deny-by-default LaTeX validator를 다시 통과시킨다. TAB·CR 또는 `\nonumber` 같은 `\n...` command로 해석될 수
있는 모호한 line break는 `ambiguous_json_backslash_escape`로 fail closed한다. 이미 commit된 canonical body는
이 transport normalization을 거치지 않는다. bounded dialect는 고정 preamble이 실제로 제공하는 AMS
matrix/alignment, `samepage|subequations|alignat`, command math delimiter, `arg`, `longmapsto`, notes-only
`qedhere`, `operatorname*`, `binom`, `mid`, `\|`, `Vert`, `langle`, `rangle`, `pmod`, `nonumber`, `intertext` 계열
수학 command, 안전한 table·booktabs layout과
Beamer `columns|column`까지만 허용한다. prose의 `%|#|&|_`는 escape하고 raw `~`는 거부한다. source가 정의한
custom macro는 복사하지 않고 같은 의미의 허용된 primitive로 풀어 쓴다. HTML 검사는 math delimiter와 math
environment를 구분하므로 정상적인 부등호 `<|>`를 tag로 오인하지 않지만, math 밖의 실제 HTML tag·comment는
계속 거부한다. 새 slide body는 frame별 한 PDF page invariant를 위해 optional frame argument,
overlay specification·overlay command와 `allowframebreaks`를 길이·줄바꿈과 무관하게 거부한다. 이전 release가
이미 commit한 canonical overlay artifact만 read/export
compatibility를 유지한다. Markdown structure, document wrapper, raw comment, 외부 file/network command,
허용되지 않은 TeX command·환경과 다른 citation syntax는 Vault에 쓰기 전에 거부한다. 이는 metadata-only
input의 구조적 evidence gate이며 paper full-text 사실 검증이라고 주장하지 않는다.

첫 candidate가 JSON parse, exact schema, bounded LaTeX grammar, citation mapping 또는 slide count gate에서
거부되면 같은 Codex thread에서 그 safe category와 고정 교정 지시만 전달해 최대 한 번 complete pair를 다시
생성한다. LaTeX grammar 거부는 notes/slides별 고정 reason ID와 엄격히 정규화·중복 제거한 최대 32개 command 또는
environment token 예시만 correction에 추가해 source-native custom macro를 primitive로 풀도록 안내한다. raw
candidate·임의 parser message·source text·path를 correction prompt, Studio record, Renderer 또는 log에 다시
넣지 않으며 source manifest, generation brief와 current draft는 initial turn에서 고정한 값을 그대로 사용한다.
correction도 거부되면
`lecture_invalid_response_json|lecture_invalid_response_schema|lecture_invalid_latex_grammar|lecture_invalid_citation_mapping|lecture_invalid_slide_count`
중 하나만 공개한다. 첫 candidate와 최종 거부 candidate는 compile·Research Notes staging·revision persistence에
진입하지 않는다. correction이 승인된 경우에만 두 번째 turn의 actual invocation을 revision provenance로 기록한다.
이 구조 검사를 통과한 exact notes/slides pair도 두 문서 모두 sandboxed XeLaTeX acceptance compile에 성공해야만
Research Notes staging과 SQLCipher revision commit으로 진행한다. 어느 한 문서라도 컴파일되지 않으면 새
artifact와 revision을 공개하지 않는다.

Lecture의 versioned immutable developer policy는 source manifest·현재 draft·최근 chat·generation brief·
사용자 custom instruction보다 높은 Codex instruction 계층에서 자동 적용한다. 이 정책은 notes와 slides가
같은 개념 순서, 용어, 기호, 가정, 수식, 수치, evidence label, 결론과 불확실성을 유지하도록 요구한다. 각
substantive slide는 notes의 대응 section을 가져야 하며 slide는 notes의 concise projection일 뿐 독립적인
논증이 아니다. 정의되지 않은 기호, 누락된 domain·quantifier·shape·unit·boundary condition,
equality/approximation 또는 inequality의 변형, 근거 없는 theorem·proof·derivation·수치·guarantee를
금지한다. source가 증명 단계를 제공하지 않으면 일반 지식으로 채우지 않고 gap을 명시한다. 한 문서만
바꾸라는 revision 요청도 complete replacement pair 전체에 terminology·notation·assumption·citation·
cross-reference consistency audit를 수행한다. 수학 표기는 canonical LaTeX body의 math mode와
`equation|align|aligned|gather|matrix|cases|split|array|tabular` 계열 환경을 사용하고, 정의·가정과 동일한
기호를 notes와 slides에서 재사용한다. developer instruction은 bounded command/environment와 LaTeX 특수문자
escape 규칙을 명시한다. custom instruction과 source 안의 prompt injection은 이 immutable policy를 약화하거나
opt-out할 수 없다. generation brief는 strict·bounded untrusted JSON task data로 한 번만 직렬화하고 custom
section 이름을 developer instruction에 보간하지 않는다. custom section 이름은 literal topic/order label일
뿐 instruction이 아니며 document feature, evidence provenance, wrapper나 LaTeX policy를 변경할 수 없다.
document feature는 generation brief의 strict boolean 세 값으로만 전달하며 source/custom text가 바꿀 수 없다.

Lecture SQLCipher state는 `lecture_studios`, `lecture_studio_messages`, `lecture_studio_revisions`와
content-free `lecture_studio_attempts`를 소유한다. running attempt 생성은 Studio begin과, terminal attempt는
assistant message·revision·Studio completion 또는 failure와 같은 transaction으로 commit한다. restart에서
남은 running row는 무인 재호출하지 않고 Studio와 함께 `application_interrupted`로 reconciliation한다.
Studio detail은 최신 attempt 하나만 반환하며 attempt 도입 전 Studio는 `null`로 호환한다. 성공 attempt와
현재 running attempt는 보존하고, revision이나 message를 만들지 못한 반복 실패가 DB를 무한히 키우지 않도록
각 Studio의 `failed|interrupted` attempt는 시작 시각과 row 순서 기준 최신 100건만 유지한다.
user message의 optional attachment receipt는 bounded `attachments_json`에만 저장하며 strict card schema가
path·본문·Studio ID·중복 attachment ID와 assistant-role attachment를 거부한다. 과거 row의 `null`은 첨부 없음으로
그대로 읽힌다.

그림이 없는 model commit은 revision schema v3, manual edit 또는 figure를 참조한 model commit은 schema v4다.
두 schema는 exact notes/slides와 normalized full `generationBriefSnapshot`, 그 canonical JSON의 SHA-256,
authoring policy version과 developer instruction SHA-256을 append-only로 저장한다. v4는 `manual|model`
authorship와 exact referenced figure metadata를 더하며 manual일 때 invocation은 `null`, model일 때 actual
invocation은 필수다. SQL decoder는 저장 brief를 strict schema로 다시 parse하고 hash를
재계산해 mismatch나 부분 provenance를 fail closed한다. schema v1 Markdown과 provenance가 없던 v2 LaTeX
revision은 read/export 호환을 유지하지만 새 Settings 값으로 backfill하거나 다시 쓰지 않는다. authoring policy
version 변경은 새 revision provenance field에 새 version/hash를 기록할 뿐 과거 revision migration을 요구하지
않는다.

Lecture 생성과 수정은 provider `model/list`에서 발견한 opaque model ID와 해당 model의 native reasoning
option을 Studio별 UI preference로 선택한다. 저장된 선택이 없는 새 Studio는 Settings의 Codex default를 한 번
복사하고 이후에는 독립적으로 수정한다. `Auto`는 provider recommended selection을 turn 직전에 다시
resolve한다. 이 preference는 localStorage의 편의 설정일 뿐 authoritative provenance가 아니며, Main은 매
turn마다 live catalog로 ID를 검증하고 사라진 model/reasoning을 임의 fallback하지 않는다. 실제
requested/resolved model ID, catalog version과 reasoning은 각 immutable revision과 assistant message의
`ModelInvocation`에 기록한다.

notes와 slides는 `GOSU/<output project>/Lecture Notes & Slides` 아래 이전 revision을 덮어쓰지 않는 새
bundle의 `Lecture Notes.tex`와 `Slides.tex`로 저장한다. figure를 참조한 revision은 exact
`Figure-<UUID>.jpg`도 같은 bundle에 둔다. Main은 고정 preamble로 감싼 두 canonical LaTeX, optional JPEG와
durable journal을 hidden staging directory에 모두 쓰고 fsync한 뒤
directory rename으로 한 번에 공개한다. 일반 revision directory와 분리된 project-local hidden pending index를
bundle publish 전에 fsync하고 durable round-robin cursor로 bounded scan하므로, 많은 확정 revision이 새 crash
journal을 가리지 않는다. deterministic bundle identity에는 source-manifest hash, generation-brief hash와
authoring-policy version/hash를 넣고 pending journal은 여기에 두 artifact와 optional JPEG의 encoding·byte
size·content hash를 함께 보존한다. reconciliation은 이 값들이 committed SQL v3/v4 revision과 모두 일치할
때만 seal·recover하며 하나라도 다르면
사용자 file을 보존한 채 fail
closed한다. journal에는 full generation brief나 prompt를 복사하지 않는다. provenance field가 없던 legacy
journal은 호환 경로로 읽되 v3 identity로 backfill하지 않는다. SQL completion 실패 시 journal과 exact hash를
대조해 bundle 전체를 rollback하고, crash 뒤 남은 journal은 다음 시도에서 reconcile한다. orphan index는 exact
identity가 맞을 때만 정리하고
충돌하는 사용자 파일은 보존한다. 이 경계는 filesystem과 SQLCipher 사이 cross-store ACID가 아니라 atomic
directory publish와 exact-hash recovery protocol이다. 성공한 UI receipt와
Lecture assistant message에는 실제 project-relative 두 path를 붙인다. Vault·Codex 실패는 Lecture turn만
실패시키고 Board, Literature, Experiment와 기존 Research Notes read를 막지 않는다.

Lecture Studio 삭제는 hard delete가 아니라 Studio-owned `trashedAt`을 기록하는 별도 lifecycle command다.
Studio는 일반 list·detail·generate·assistant edit에서 빠지지만 같은 Studio ID, source selection, chat,
frozen manifest, immutable revision과 artifact provenance는 SQLCipher에 그대로 남는다. active generation은
Trash와 경합할 수 없고 optimistic Studio version fence가 stale action을 거부한다. Settings의
통합 `Trash` 화면의 Lecture Studios group은 같은 identity로 restore하거나, 고정 문구
`EMPTY LECTURE TRASH` 입력과 native final confirmation을 모두 거친 Studio만 영구 purge한다.
Renderer는 확인 화면에 표시된 모든 trashed Studio의 `studioId`, optimistic `version`, `trashedAt`을 정렬된
exact target fence로 함께 보낸다. Main의 immediate SQLCipher transaction은 기존 idempotency receipt를 먼저
조회한 뒤 현재 Trash 전체 집합과 target의 identity/version/timestamp가 정확히 같은지 검사한다. 확인 뒤
Studio가 추가·복원·변경되었으면 `lecture_trash_changed`로 아무 row도 지우지 않고 닫히며, exact predicate를
통과한 row만 삭제한다. 이미 commit된 idempotency key 재전송은 이후 Trash 상태와 무관하게 원 receipt를
반환한다. Permanent purge receipt에는 Studio/output-project
identity, Trash 시각과 제거된 message/revision count를 append-only로 기록한다. purge는 Lecture-owned SQL
row만 cascade하며 Research Notes, exported TeX/PDF, manuscript/Overleaf checkpoint, Literature와 Experiment는
자동 삭제하지 않는다. 다만 해당 Studio만을 위해 Main이 관리한 local external-source copy는 SQL purge receipt가
확정된 뒤 함께 제거한다. 원래 사용자가 선택한 source file은 수정하거나 삭제하지 않는다.

Settings는 Project와 Lecture lifecycle마다 별도 휴지통 menu를 만들지 않고 workspace-level `Trash` 하나에서
trashed Project, trashed Lecture Studio, deleted Board task를 type별 group으로 함께 보여준다. 각 항목은 그
화면에서 복원한다. Project와 Lecture Studio의 영구 제거는 서로 다른 lifecycle lock·transaction·typed
confirmation·idempotent receipt를 가지므로 같은 화면 안에서도 독립 command로 유지하며 Renderer가 순차
호출하는 비원자적 `Empty All`을 제공하지 않는다. Board task는 현재 독립 permanent purge contract가 없어
복원만 제공한다. trashed Project 소속 task는 Project row의 보존 count에 포함하고 task group에 중복 표시하지
않으며, Archived parent의 task는 parent를 Active로 복원하기 전까지 복원을 막는다. Project permanent purge는
대상 Project를 참조하는 active·trashed Lecture Studio가 하나라도 있으면 fail closed하므로 UI가 먼저 관련
Studio를 영구 제거하거나 Project를 복원하도록 안내한다.

활성 Studio 한도 100개와 별도로 recoverable Trash는 최대 1,000개까지 저장한다. 새 Studio insert trigger와
active→Trash transition trigger가 각각 두 경계를 검사하므로 휴지통이 활성 작업 공간을 막지 않으면서도
로컬 DB가 무제한 증가하거나 purge receipt 한도를 넘지 않는다.
동일 `idempotencyKey`로 Empty Lecture Trash command가 재전송되면 append-only receipt를 그대로 반환하고
두 번째 cascade는 실행하지 않는다.

첫 revision이 생성되면 center preview와 Project Chat과 분리된 Lecture 전용 chat을 동시에 표시한다. 전용
chat의 요청은 현재 notes와 slides의 완전한 replacement pair를 새 immutable revision으로 저장하므로 이전
revision을 덮어쓰지 않는다. center preview는 canonical LaTeX source와 local PDF를 전환할 수 있다. PDF는
exact revision의 content SHA-256과 GOSU preamble/body marker를 다시 검증한 뒤 macOS `sandbox-exec`의
MacTeX/XeLaTeX를 fixed argv, no-shell-escape, network deny, timeout·output quota로 실행해 만든 ephemeral
preview다. 검증된 PDF magic·SHA-256·32 MiB budget을 통과한 bytes만 typed IPC로 전달하고, Renderer는 공용
PDF.js continuous-page viewer의 canvas/pixel/page budget을 재사용한다. PDF는 Research Notes의 canonical
LaTeX를 대체하거나 자동 저장하지 않으며 앱 재시작 뒤 다시 compile한다. schema v1의 기존 Markdown revision은
읽기·legacy compile만 유지하고, 새 생성·수정은 항상 wrapper v3 canonical LaTeX pair다.

Lecture Assistant 수정은 `Sources used` 제거 같은 단순 요청을 포함해 LLM이 request와 current bodies를 해석한다.
다만 model은 complete replacement pair가 아니라 exact localized edit list만 반환하고 Main이 frozen draft에 이를
적용한다. 성공 결과는 정상 model invocation provenance를 가진 immutable revision으로 append하며, 변경하지 않은
document body는 byte-for-byte 보존한다. patch가 ambiguous하거나 지나치게 넓거나 resulting pair가 기존 검증과 두
PDF compile을 통과하지 못하면 artifact·revision을 전혀 commit하지 않는다.

schema v2 이상 current revision은 center preview의 `Edit source`에서 Notes와 Slides body를 app 안에서 직접
수정할 수 있다. 한 edit session은 두 body를 함께 보존하고 document tab 전환에도 draft와 cursor를 유지한다.
dirty session은 Studio별 renderer-session volatile cache에 남아 workspace 화면을 왕복하거나 Lecture view가
remount되어도 복원하고, 같은 active Studio rail 재선택은 editor를 unmount하지 않는다. cache에 dirty session이
하나라도 있으면 app close/reload에 before-unload guard를 걸지만, source draft 자체는 SQLCipher, localStorage,
Hosted Sync나 telemetry에 저장하지 않아 app process가 종료되면 폐기된다. Save 또는 명시적 Discard가 성공한
경우에만 해당 cache를 지운다.
저장은 current Studio version, base revision ID·number를 모두 fence하고 두 canonical document를 다시 조립해
evidence/source-list/figure grammar를 검증한 뒤 두 PDF를 모두 sandbox compile한다. 그 다음에만 Research Notes
bundle을 stage하고 SQLCipher에 schema v4 manual revision을 append한다. manual revision은
`authorship.kind=manual`, base revision과 실제 changed document kind를 기록하고 model invocation이나 Lecture
chat message를 만들지 않는다. 어느 단계든 실패하거나 head가 바뀌면 draft를 남기고 기존 revision·artifact를
건드리지 않는다. generation, chat turn, options update, Trash와 direct save는 같은 Studio lifecycle fence를
공유한다.

각 Studio에는 최대 5개, 정규화 결과 합계 20 MiB의 durable Figure library가 있다. Main만 native picker와
preload의 Electron `File → path` bridge에서 원본 경로를 받고, regular-file·`O_NOFOLLOW`·magic/dimension/byte
검사를 거쳐 orientation을 반영하고 metadata를 제거한 최대 2,048px·4 MiB first-frame JPEG로 정규화한다.
Renderer에는 opaque UUID, 안전한 표시 이름, 크기·dimension·SHA-256과 bounded JPEG preview만 전달하고 path는
전달하지 않는다. Finder file drop과 `Add images`는 이 same-Studio library에 추가하며 preview, cursor insert와
remove를 제공한다. 새 Studio composer는 원본을 Renderer에서 decode하지 않고 파일명·크기만 임시 표시한 뒤
Studio create 직후 Main에서 정규화하고, 그 receipt의 최신 Studio version으로 첫 generation을 시작한다. staging이
실패하거나 기존 Studio가 revision 0에서 failed 상태여도 center의 Figure library에서 다시 add/drop/preview/remove
한 뒤 첫 generation을 Retry할 수 있다. current revision이 참조하는 figure remove는 먼저 새 revision에서
reference를 제거하도록 fail closed한다. 어떤 revision도 참조하지 않은 figure는 remove transaction에서 즉시
hard-delete하고, 과거 schema v4 revision이 exact ID·SHA를 참조한 bytes만 soft-deleted retained row로 남겨 PDF
recompile과 artifact recovery를 계속 지원한다.

본문은 임의 `includegraphics`, URL, absolute/relative path, SVG·TikZ 대신 오직
`\\gosuimage{<lowercase-asset-UUID>}`만 쓸 수 있다. canonical wrapper v3가 고정 `graphicx` macro와
`Figure-<UUID>.jpg` 이름을 소유하고, validator·compiler가 reference set과 exact revision asset metadata/hash를
대조한다. compiler는 검증된 JPEG copy만 private source sandbox에 materialize한다. image가 있는 Research Notes
bundle journal v2는 두 UTF-8 `.tex`와 최대 5개 flat JPEG 각각의 encoding·byte size·SHA-256 및 asset metadata를
인증하고 한 directory로 원자 publish/reconcile한다. image가 없는 기존 two-file journal과 canonical wrapper
v1/v2는 byte-compatible하게 읽고 compile한다.

모델 generation과 Lecture Assistant revision에는 현재 active Figure library를 private `0700/0600` temporary
JPEG로 materialize해 native image input으로 전달하고, prompt에는 opaque asset metadata만 넣는다. model은
관련성이 있을 때 기존 figure를 적극 재사용하되 정확한 asset ID만 `\\gosuimage`로 배치할 수 있고, figure를
evidence source로 가장하거나 새 binary image를 만들었다고 주장할 수 없다. web·filesystem·image-generation
tool은 계속 꺼져 있다. response가 실제로 참조한 asset subset만 revision v4와 Research Notes bundle에 frozen
copy로 commit하며 성공·실패·cancel 모두 temporary input을 제거한다. 현재 slice는 사용자가 첨부한 figure의
vision-aware reuse를 지원하고, 새 그림을 합성하는 별도 image-generation capability는 포함하지 않는다.

현재 revision의 document action은 path나 bytes를 Renderer에서 받지 않고
`studioId/revisionId/revision/kind/artifactContentSha256/format` fence만 Main으로 보낸다. LaTeX
export/open/Finder는
current Vault grant, project binding, ownership marker, root/file identity와 exact artifact SHA-256을 다시 검증한
Research Notes file만 사용한다. 현재 document가 figure를 실제 참조하면 LaTeX export는 해당 `.tex`와 참조한
exact `Figure-<UUID>.jpg`만 담은 bounded ZIP bundle을 만들고, source-tab Finder action은 같은 Research Notes
bundle directory의 canonical `.tex`를 선택한다. figure-free LaTeX와 legacy Markdown export는 계속 단일 text
file이다. PDF export/open/Finder reveal은 Renderer preview bytes를 신뢰하지 않고 DB의
exact revision LaTeX를 다시 sandbox compile해 PDF magic·size·SHA를 검증한다. export는 system save dialog와
atomic file replace를 사용한다. default-app open과 PDF-tab Finder reveal은 app-owned mode-0700 cache에
mode-0600 derived PDF를 materialize하고, Finder reveal은 그 exact PDF file을 선택한다. source tab의 Finder
reveal만 canonical `.tex` 또는 legacy `.md`를 선택한다.
Renderer의 export·default-app open·Finder reveal은 36px icon-only control로 표시하되 동적 format을 포함한
accessible name과 동일한 hover tooltip을 유지한다. 세 control은 좁은 Lecture preview에서도 한 줄을 유지하고
visible text를 action receipt에만 사용하므로 문서 폭을 불필요하게 잠식하지 않는다.
derived PDF cache는 7일 TTL뿐 아니라 최대 12개·총 128 MiB LRU quota를 적용해 반복 open/reveal이 디스크를
무한히 소비하지 않게 한다.
receipt에는 status, basename과 nullable project-relative path만 반환하며 PDF cache reveal은 source path를
PDF path처럼 오해하지 않도록 relative path를 비운다. absolute path는 Renderer·telemetry·Hosted Sync에
노출하지 않는다. exported PDF는 사용자가 요청한 durable copy이지만 canonical revision이나 sync artifact가
되지는 않는다.

Studio 100개, studio별 message 2,500개와 revision 1,000개의 local capacity는 SQL trigger와 동일한 Main
preflight로 방어한다. message/revision 잔여 용량은 turn 시작 transaction에서 user/assistant pair와 다음
revision을 함께 예약하므로 비싼 Codex 호출 뒤 capacity failure가 발생하지 않는다. 한도 도달은 generic
persistence 오류로 숨기지 않고 `lecture_capacity_reached`로 반환한다.

결정의 배경과 대안은
[`ADR 0003`](adr/0003-workspace-level-lecture-studio.md)에 고정한다.

### Markdown reader 경계

Research Notes의 기본 화면은 Markdown 원문이 아니라 CommonMark와 GFM의 heading, list, table, task
list, blockquote, code block, footnote를 렌더링한다. 사용자는 같은 화면의 `Source` toggle로 원문을
확인할 수 있다. 표시 크기와 색상은 전역 Appearance 설정의 font scale·theme token을 그대로
사용한다.

왼쪽 file explorer는 Main이 이미 검증해 반환한 bounded `ResearchNotesWorkspace.files` snapshot만 Renderer에서
directory-first natural order의 tree로 만든다. 폴더는 기본적으로 접혀 있고 같은 row를 다시 누르면
열림·닫힘이 전환되며, sibling과 접힌 subtree의 기존 expansion은 보존한다. 파일 또는 Markdown
wiki-link를 열면 해당 note의 ancestor만 펼쳐 현재 파일을 드러낸다. expansion과 roving keyboard focus는
project binding별 volatile UI state라 localStorage·Hosted Sync·LLM context에 저장하지 않고 새 binding에서는
초기화한다. tree model은 absolute·dot-segment·empty component·control character·과도한 길이·non-Markdown·
file/directory 충돌 path를 normalize하지 않고 제외한다. `role="tree"`/`treeitem`, `aria-expanded`·
`aria-selected`, 방향키·Home/End navigation을 제공하며 읽는 동안에도 폴더 탐색은 유지한다. 현재 contract는
Markdown path만 제공하므로 읽을 수 있는 Markdown을 포함한 폴더만 표시하고 empty 또는 attachment-only
folder를 열거하기 위해 Main capability를 넓히지 않는다.

ready workspace의 explorer는 Vault root header 다음에 실제 folder tree를 첫 콘텐츠로 렌더링한다. 중복된
managed-folder 설명, project 검색, Vault 변경, Agent access와 privacy 설명은 기본적으로 닫힌
`Search & settings` toggle로 분리해 폴더를 보기 위해 sidebar를 먼저 scroll하지 않게 한다. folder tree와
settings body는 서로 다른 bounded scroll region을 사용하고 toggle row는 settings scroll 밖에 고정한다. settings
body의 implicit row는 `max-content`로 유지해 검색·권한 control을 압축하지 않고 바깥 body만 scroll한다. 열린
controls는 explorer 높이의 46%·420px 중 작은 값까지만 차지하며 tree에는 최소 90px을 남긴다. 닫힌 body는
명시적인 `hidden`·`display: none`으로 layout·focus navigation에서 제외한다. 열린 settings에서 Vault picker를
사용한 경우에는 disclosure를 유지해 picker 복귀 focus가 숨겨진 control에 남지 않게 한다. settings body는
project 검색을 첫 항목으로 두고 열 때마다 top으로 복귀한다. 270px explorer의 compact 검색은 viewport가 아니라
자기 container 안에서 label과 control row를 한 열로 분리하고 input·submit track을 bounded하게 배치하며, 결과 title은 wrap하고 metadata는 ellipsis로
가둔다. 860px 이하에서는 tree에 90px을 예약한 나머지 중 최대 190px까지 settings에 주어 Extra Large 글자에서도
검색 form 전체가 보이게 한다. 안전한 rename reconciliation이 필요한 경우에만 짧은 attention·Retry 행을 tree 위에 유지한다. 좁은 stacked layout의 explorer 높이는
`min(360px, 45vh)`로 두어 Extra Large 글자에서도 settings 검색 form, toggle과 기본 project folder가 초기 viewport에
남고, 전체 explorer 최소화 상태는 기존 44px strip을 그대로 사용한다.

file explorer 전체는 persistent toggle로 최소화할 수 있다. 넓은 창에서는 270px explorer가 44px 세로
restore rail로 줄고, 860px 이하의 stacked layout에서는 44px 상단 strip으로 줄어 Markdown reader가 남은
폭이나 높이를 즉시 회수한다. toggle DOM은 열림·닫힘 동안 유지하고 `aria-controls`·`aria-expanded`와
명시적인 Show/Hide label을 제공하므로 keyboard focus가 사라지지 않는다. 숨은 explorer detail은
`hidden`으로 focus·accessibility navigation에서 제외하지만 React subtree는 mounted 상태로 두어 선택 note,
Rendered/Source mode, directory expansion과 reader scroll을 초기화하지 않는다. 이 compact preference만
versioned localStorage `gosu:research-notes-layout:v1`에 저장해 project를 바꾸거나 앱을 다시 열어도 유지하며,
malformed·legacy storage는 안전한 expanded default로 복구한다. layout transition은 grid track만 180ms로
보간하고 `prefers-reduced-motion`에서는 제거한다.

Markdown은 선택한 Vault에서 왔더라도 신뢰하지 않는다. Renderer는 raw HTML을 해석하지 않고,
Markdown AST를 `rehype-sanitize` allowlist로 정리한 뒤 React element로 만든다. `script`, event
handler, `iframe`, `object`, 임의 style과 SVG는 reader DOM에 들어갈 수 없다. frontmatter는 코드를
실행하거나 Vault의 `cssclasses`를 적용하지 않고 접을 수 있는 read-only `Properties` 원문으로만
표시한다.

본문의 `$ ... $` inline 수식과 독립 줄의 `$$ ... $$` display 수식은 Project Chat과 같은
`markdown-math-policy.ts`를 통해 bundled KaTeX HTML/MathML로 렌더링한다. remark 순서는 frontmatter와
GFM 뒤에 math marker를 만들고 Obsidian wiki-link를 처리하며, rehype 단계는 untrusted tree를 먼저
sanitize한 뒤 local KaTeX를 실행한다. sanitizer는 `math-inline`·`math-display` marker만 추가로 허용하고
KaTeX는 `trust: false`, `strict: warn`, `maxExpand: 1000`, `maxSize: 20`을 사용한다. 문서 하나에서
렌더링하는 수식은 최대 256개, 수식 하나는 4,096자, 전체 TeX source는 32,768자로 제한한다. 한도를
넘은 수식은 없애지 않고 inline 또는 fenced TeX code로 보여 주며, 긴 display 수식은 reader 안에서
가로 scroll한다. 일반 prose와 긴 URL·무공백 token은 document 폭 안에서 줄바꿈하고, KaTeX의
`white-space: nowrap`으로 폭을 유지해야 하는 긴 inline 수식은 해당 수식 자체가 가로 scroll region이
된다. display 수식·code block·넓은 GFM table도 각각 자기 block 안에서 scroll하므로 바깥 Research Notes나
Repository layout을 밀어내거나 문서 끝의 전역 scrollbar에 의존하지 않는다. KaTeX CSS와 font는 앱
package에 포함되고 Appearance font scale과 theme을 상속하며 외부 network를 요청하지 않는다. `Source`
mode는 이 파이프라인을 거치지 않아 원문 delimiter를 그대로 표시한다.

Research Notes와 Repository Markdown preview는 document route에서 남은 viewport 높이를 배정받는 bounded
flex layout을 사용한다. page heading과 notice는 필요한 높이만 차지하고, `notes-layout` 또는
`repository-workspace`의 바깥 viewer에는 520px floor를 두되 그 안쪽 shrink chain은 `min-height: 0`을
유지한다. 따라서 긴 문서는 페이지 전체를 계속 늘리지 않고 `.note-reader-body` 또는
`.repository-preview`가 세로 scroll을 소유한다. code·table·수식의 가로 scroll은 계속 해당 block 안에만 머문다. 고정된
`calc(100vh - Npx)` 높이는 titlebar, error notice, Appearance font scale 변화에 취약하므로 사용하지 않는다.

active project의 Research Notes는 Project Chat과 마찬가지로 공용 `WorkspacePageHeading`과 그 안의
`New project` action을 렌더링하지 않는다. 선택한 Vault root, folder tree, 현재 note path와 Rendered/Source
mode가 document shell 안에서 필요한 context를 이미 제공하므로 `notes-layout`이 compact content inset부터
바로 시작하고 회수한 높이를 reader에 돌려준다. active project가 없거나 숨김·archive 상태에서 목적을
설명해야 하는 empty route는 기존 page heading을 유지한다. 이 최적화는 notes 전용
`desktop-content-notes` class로 적용해 Repository의 heading·padding과 document scroll chain을 바꾸지 않는다.

Workspace sidebar가 이미 현재 위치를 명시하는 Search, Connections, Settings와 workspace-level Lecture Studio도
큰 breadcrumb·H1·설명 page heading을 반복하지 않는다. 각 surface는 titlebar 아래 compact inset에서 검색 form,
등록 서버 inventory, settings category navigation 또는 Studio 3-pane workspace를 바로 시작한다. 제거한 heading의
필수 action은 없애지 않는다. Lecture의 새 Studio 생성은 항상 보이는 session rail의 `＋ New`와 rail을 접었을 때의
icon button이 소유한다. active project가 없는 project-scoped empty route처럼 기능을 이해하는 데 설명이 필요한
화면만 공용 heading을 유지한다.

Obsidian `[[note]]`, alias와 표준 상대 `.md` link는 raw text 치환이 아닌 Markdown AST 단계에서
처리한다. 따라서 inline/fenced code 안의 wiki-link 표시는 바뀌지 않는다. 대상은 현재 note 기준의
exact path를 먼저 사용하고, basename은 Vault에서 유일할 때만 해석한다. missing·ambiguous link나
Vault root 위로 벗어나는 path는 클릭할 수 없게 표시한다. heading·block fragment가 포함된 link도
note 파일까지는 해석하지만 해당 fragment로 자동 scroll하는 기능과 note transclusion은 아직
구현하지 않았다.

외부 link는 정확한 HTTPS URL만 fixed preload IPC를 통해 Main process가 system browser로 연다.
Renderer navigation과 새 창은 계속 차단한다. 외부 image는 privacy를 위해 자동 요청하지 않는다.
Vault-local PNG, JPEG, GIF, WebP, AVIF만 typed attachment IPC로 읽으며 Main process가 note 기준 경로,
root containment, symlink, 허용 확장자와 file signature, 8 MB 크기 제한을 다시 확인한다. 검증된 bytes만
base64 data URL로 Renderer에 반환하며 절대 경로와 `file://` 권한은 노출하지 않는다. SVG, PDF,
audio·video와 embedded note rendering은 후속 범위다.

Repository의 Markdown preview도 같은 sanitize·link 정책을 재사용하지만 데이터 source capability는
공유하지 않는다. 특히 repository Markdown의 상대 image가 같은 이름의 비공개 Obsidian attachment를
읽지 않도록 Vault image loader를 명시적으로 끈다. Repository-local raster preview는 별도의 bounded
Git asset IPC가 생기기 전까지 blocked placeholder로 표시한다.

### Project Chat 연구 파일 attachment 경계

Project Chat composer의 첨부는 Renderer가 임의 path나 bytes를 전달하는 범용 file API가 아니다. Main의
고정 dialog가 PDF, DOCX, PPTX, HWPX, TXT·Markdown·CSV·JSON·LaTeX와 PNG·JPEG·GIF·WebP·
TIFF·BMP·AVIF만 선택한다. Main은 `O_NOFOLLOW`로 regular file을 열고 extension별 signature·package
manifest를 다시 확인한다. 한 메시지는 최대 5개, 파일당 20 MiB, 실제 turn claim 전체 50 MiB, 문서당
최대 500 unit이고 text tool의 turn 전체 예산은 60,000자다. 이미지가 문서의 extraction 예산을 나눠
갖지 않으며 동시에 살아 있는 staged·claimed capability는 25개, 정규화 image는 20개로 제한한다.
암호화·손상·위장 형식·한도 초과·추출 실패는 path를 포함하지 않는 typed error로 끝난다.

PDF.js는 15초 timeout 안에 selectable text만 추출하며 worker fetch, WASM, image decoder, XFA와 font
rendering을 끈다. DOCX·PPTX·HWPX parser는 ZIP central directory와 각 local header의 flag·method·name·
size·offset을 교차 확인하고 local payload range의 alias·overlap을 거절한다. 선택 part는 raw inflater의 실제
output 상한, declared size, CRC-32, entry 수·크기·compression ratio·전체 expanded-byte budget을 모두
통과해야 하며 traversal·Unicode/case duplicate·symlink·encryption도 거절한다. DTD·ENTITY, 외부
relationship, unknown relationship target mode, macro와 embedded object는 읽지 않는다. bounded structural
XML scanner는 OOXML의
transitional/strict namespace와 HWPX OWPML namespace를 expanded name으로 확인하고 foreign subtree를
text·reference 후보에서 제외하므로 comment·CDATA·foreign element/attribute가 manifest, relationship,
본문을 가장할 수 없다. XML QName과 namespace prefix는 case-sensitive이고 단 하나의 optional colon만
허용하며, `xml`·`xmlns` 예약 binding을 바꿀 수 없고 attribute entity는 parser에서 정확히 한 번만
decode한다. DOCX는 root office-document
relationship과 유효한 paragraph/run·section-property
구조가 실제 참조한 body·header/footer·foot/endnote만, PPTX는 `presentation.xml`의 `sldIdLst` relationship
순서와 각 slide가 단독으로 참조한 speaker note만, HWPX는 canonical mimetype·manifest와 직접 content
spine section만 재구성한다. Word note container는 note root의 unique direct child여야 한다. slide/section
unit cap은 reconstruction 전에 적용하고 여러 slide가 같은 note part를 재사용하면 거절한다. orphan·삭제
part는 모델에 보내지 않는다. 구형 binary `.ppt`는 전체 CFB scan이
삭제·비관련 stream을 노출할 수 있어 picker와 공개 계약에서 제외하며 사용자가 `.pptx`로 export해야 한다.
이 결과는 정확한 Office layout·chart·animation을 재현하지 않는다.

그림은 signature와 decoded format을 교차 확인하고 40 megapixel·16,384 source edge를 넘으면 거절한다.
첫 animation frame만 EXIF orientation에 맞춰 최대 2,048 edge, 4 MiB 이하의 metadata-free JPEG로 만들고
투명 배경은 흰색으로 합성한다. 정규화 파일은 mode `0700` private temp directory와 mode `0600` random
filename으로만 만들며 model catalog가 image modality를 명시한 경우에만 Codex App Server의 native
`localImage` input으로 보낸다. model capability가 없거나 사라지면 text fallback을 꾸미지 않고 turn을
차단한다. image turn은 시작 때 사용한 정확한 catalog snapshot을 유지하고 모든 early/late
`model/rerouted` target을 다시 확인한다. unknown 또는 text-only target이면 dynamic tool을 revoke하고
내부 rejection event로 Project Chat의 terminal code와 image receipt를 먼저 봉인한 뒤 turn을 interrupt한다.
따라서 interrupt 확인 중 App Server 연결이 끊겨도 일반 연결 오류로 완화되지 않으며, 완료 event 역시
modality-specific failure로 고정한다. turn 시작 전 reroute buffer가 전역 상한에 닿으면 오래된 검증 기록을
버리지 않고 App Server 연결을 끊어 fail closed한다. terminal receipt 저장을 한 번 복구해야 하는 경우에도
동일한 modality error와 non-retryable 분류를 유지한다. 해당 경우 image source receipt를 폐기하고 saved
retry 없이 model을 다시 고른 뒤 재첨부하도록 한다.

descriptor와 추출 text는 `projectId + sessionId`에 묶인 15분 TTL, single-claim, Main-memory capability다.
정규화 image와 Codex의 ephemeral turn state는 사용자 데이터 저장소와 분리된 mode `0700` private temp
directory에만 잠시 존재한다. 정상 terminal·shutdown에서는 즉시 제거하고 crash 잔여물은 위 age-bounded
startup sweep이 처리한다.
모델에는 filename과 path 대신 `Attachment 1` 같은 label, opaque UUID, source SHA-256, format·unit count와
excerpt 상태만 보인다. 첨부가 있는 turn에만 `list_turn_attachments`와
`read_turn_attachment_text`가 catalog에 나타나며 read는 호출당 최대 8 unit·24,000자, turn 전체 최대
60,000자다. 모든 attachment text와 image는 untrusted evidence이고 prompt envelope나 durable user
message에 선제 삽입하지 않는다. 실제 전달된 read와 native image만 terminal source appendix에 label,
opaque ID prefix, unit range, source hash와 excerpt 상태로 남기며 raw body·filename·path는 남기지 않는다.
turn 완료·실패·cancel, startup 실패, session 전환과 app 종료는 staged/claimed capability와 temporary
image를 revoke하고 late result를 채택하지 않는다. image modality 거절 attempt에는 첨부 ID나 path를
durable retry payload로 저장하지 않으므로 saved retry를 허용하지 않는다. UI는 message text만 복원하고
image-capable model을 고른 뒤 파일을 다시 첨부해 resend하도록 안내한다.

현재 PDF OCR, Office/HWPX embedded image·chart 이해, `.ppt`·`.hwp`·`.doc` 지원, 다중 animation frame과
Zotero/Literature record의 durable full-text 연결은 없다. parser와 native image codec이 별도 utility
process가 아니라 privileged Main에 있어 timeout이 동기 CPU 정지나 native crash를 hard-isolate하지
못한다. 특히 PDF.js의 `getTextContent()`는 page text를 materialize한 뒤 60,000자 budget을 적용하므로
압축된 악성 PDF의 pre-materialization 메모리·CPU를 hard bound하지 못한다. production hardening에서는
모든 document/image parser를 killable·resource-limited utility process로 옮겨야 한다.

### Literature Discovery & Review 경계

프로젝트 folder의 `Literature`는 하나의 고정 `balanced-three-layer` discovery policy를 사용해 서지
metadata를 찾고, 결과를 해당 프로젝트의 암호화 SQLCipher evidence table에 누적한다. 검색어와 선택적인
출판 연도 범위뿐 아니라 이번 검색을 분류하는 `Topic tags`와 `Keyword tags`를 typed command로 보내며
한 번에 최대 50건을 저장한다. 두 태그 입력이 모두 비어 있으면 정규화한 검색어 하나를 Topic tag로
사용해 출처 없는 행이 생기는 것을 줄인다. 이 태그는 provider subject, 사람이 편집하는 topic, AI가 제안한
topic과 별도 provenance다. Main process의 `BalancedLiteratureProvider` port는 Semantic Scholar의
authority-aware 세 lane과 Hugging Face Papers의 additive 검색을 병렬로 시작한다. Hugging Face 결과는
arXiv paper의 추가 recall만 제공하며 Semantic Scholar 자체의 유효 결과 수와 citation·recent lane 상태를
대신하지 않는다. Semantic Scholar가 실패하거나 유효 후보를 만들지 못하면 Crossref의 세 검색 lane으로
자동 degrade하고, Semantic Scholar 결과가 요청 수보다 적거나 citation·recent 정렬 lane이 빠지면
Hugging Face가 화면 수를 채웠더라도 Crossref pool을 보강 조회한다. 세 source 후보는 canonical arXiv
identity·DOI·fingerprint로 중복을 줄인 뒤 공통 ranking한다. 보강 조회도 실패하면 이미 얻은 Semantic
Scholar·Hugging Face 결과는 버리지 않고 typed degradation reason과 함께 반환한다. 이
fallback·supplement는 저장된 table, 수동 review와 다른 프로젝트 기능을 막지 않는다. 검색 run에는
`semantic-scholar / crossref / hugging-face / combined` 중 실제 source와 사용할 수 있었던
`relevance / citation-authority / recent-momentum / author-impact / hugging-face-index` signal, 실패한
provider·lane의 typed degradation reason을 함께 기록한다. 따라서 citation·recent·author lookup 또는
Hugging Face 일부가 실패한 검색을 완전한 balanced search처럼 표시하거나 Project Chat이 숨길 수 없다.

Semantic Scholar adapter는 고정 `https://api.semanticscholar.org` origin에서 관련성 검색, citation count
내림차순 bulk 검색, 최근 4년의 publication date 내림차순 bulk 검색을 각각 수행한다. 각 lane은 정규화된
상위 100건만 ranking input으로 채택하고 canonical arXiv ID, DOI 또는 provider ID로 먼저 중복을 제거한다. paper metadata에서
title, author ID·표시명, venue, year·publication date, field, publication type, citation count,
influential citation count와 HTTPS URL만 가져오며 abstract와 full text는 요청·저장하지 않는다. 후보
paper는 세 lane을 번갈아 합치고 최대 30,000개 외부 author ID만 선형 시간으로 검사한다. first·last·other
author role마다 후보 순서 전체에서 고르게 표본을 뽑아 합계 최대 200개 ID만 batch lookup하며, h-index는
보조 신호로만 쓴다. 후보 author가 이 한도를 넘거나 응답 일부에 h-index가 없으면
`author-metrics-partial`을 기록한다. 요청은 process 전체에서 최소 1초 간격으로 직렬화하고 요청별 12초
timeout, 6 MB response 한도,
최대 30초의 bounded
`Retry-After`를 적용한다. `GOSU_SEMANTIC_SCHOLAR_API_KEY`는 전용 rate limit을 위한 선택적인 local
credential이며 Hosted Sync, SQLCipher, event, Git과 Renderer에 전달하지 않는다. key가 없어도 공개
endpoint를 시도하지만 공유 rate limit 때문에 Crossref fallback이 더 자주 사용될 수 있다.

Hugging Face adapter는 고정 `https://huggingface.co/api/papers/search` endpoint만 사용하고 query 250자,
상위 100건, 요청별 12초 timeout과 6 MB streaming response 한도를 적용한다. 응답에서는 검증 가능한
modern·legacy arXiv ID, title, author, publication year와 HTTPS paper URL만 정규화하며 highlighted summary,
abstract·full text, comment와 raw response는 저장하지 않는다. API의 upvote 값도 현재 policy-v3 ranking,
SQLCipher 또는 provenance에 사용하지 않는다. Hugging Face 후보는 citation·influential-citation 근거가
없으므로 자체적으로 Core·Rising 자격을 만들지 않고 Broad recall에만 기여한다. provider 실패는
`hugging-face-unavailable` degradation으로 격리하며 Semantic Scholar·Crossref 검색을 막지 않는다.

Crossref fallback과 supplement도 단일 relevance 결과를 그대로 저장하지 않는다. 고정
`https://api.crossref.org/v1/works`에서 relevance, `is-referenced-by-count` 내림차순, 최근 출판일
내림차순 lane을 구성해 같은 local ranker에 넣는다. 응답은 title, author, journal·venue, year, subject,
DOI, work type, citation count와 HTTPS source URL allowlist로 즉시 정규화하고 raw response와 abstract를
저장하거나 Renderer에 보내지 않는다. Crossref 요청은 public 최소 250 ms, polite pool 최소 125 ms
간격과 15초 timeout, 4 MB response 한도를 사용한다. `GOSU_CROSSREF_MAILTO`와
`GOSU_CROSSREF_USER_AGENT`는 polite-pool 식별용 선택 설정이며 credential이 아니다.

정규화된 연구 paper 후보는 policy v3에서 다음 세 layer로 한 번만 배정된다. 최대 결과 수 기준
`Core 40% / Rising 30%`는 강제 quota가 아니라 각각의 최대 상한이다. Core·Rising 자격 후보가 부족하면
빈자리를 약한 후보로 채우지 않고 Broad로 넘긴다. 이 때문에 실제 layer count는 검색마다 달라질 수 있고,
모든 후보가 gate를 통과하지 못하면 `Core 0 / Rising 0`도 정상 결과다. Core 상한의 약 25%(Core target이
있으면 최대 1건 이상)는 citation 정렬 lane에 실제로 나타나고, 최소 citation impact 기준을 넘으며, 출판 후
5년 이상 지난 고전 후보에만 예약한다.

- **Core & canonical**: year·author와 DOI, provider ID 또는 canonical arXiv ID가 있는 연구 후보 중
  relevance lane에 실제로
  나타나고 그 검색 결과 안의 정규화 rank score가 0.55 이상이며, 최소 50 citation 또는 10 influential
  citation을 가진 high-impact relevant paper만 일반 Core 후보가 된다. relevance 밖의 canonical reserve는
  같은 impact floor, citation lane과 5년 이상의 age를 모두 요구한다.
- **Rising & recent**: 같은 최소 서지 identity를 가진 최근 4개 calendar year 논문 중 relevance lane에
  실제로 나타나고 그 검색 결과 안의 정규화 rank score가 0.35 이상이며, 출판 후 경과 연수로 보정한
  citation-per-year proxy가 2 이상이거나
  influential citation이 1건 이상인 후보만 배정한다.
- **Broad discovery**: relevance 중심의 넓은 recall을 유지해 obvious result 밖의 후보를 사람이
  screening할 수 있게 한다. Core impact/relevance gate나 서지 identity가 부족한 이유도 typed reason으로
  함께 저장한다.

저자 h-index와 journal·venue 존재 여부는 이름 allowlist나 venue prestige 판정이 아니라 표시·보조
metadata일 뿐이다. 코드에 유명 학자·저널 이름을 넣지 않으며 author나 venue signal만으로 Core나
Rising이 되지 않는다. venue가 없는 주요 conference paper·preprint도 충분한 citation 근거가 있으면 Core
후보가 될 수 있지만, venue가 없고 citation 0인 paper는 Core gate를 통과할 수 없다. Rising의
`citation momentum`도 조회 시점 metadata에서 계산한 proxy이지 실시간 download, social attention,
venue quality 또는 장래 영향력의 보증이 아니다. discovery score와 layer는 읽을 순서를 돕는 ranking
metadata이며 논문의 진실성, 연구 품질 또는 evidence 채택을 판정하지 않는다.
Citation·influential-citation·author score는 현재 후보 집합의 최댓값으로 정규화하지 않고 고정된 bounded
scale을 사용한다. Core의 high-impact/classic reason에는 최소 50 citation 또는 10 influential citation,
Rising에는 최근 4년이면서 연평균 2 citation 또는 influential citation 1건이라는 absolute eligibility
floor와 실제 relevance lane 조건을 적용한다. `matchedLayers`도 동일 eligibility를 사용하므로 score만 높은
Broad paper에 Core가 붙지 않는다. 이 floor는 분야별 품질 판정이 아니라 citation 0·단순 최신성·저자
명성만으로 "고전"·"급부상" label이 생기는 것을 막는 보수적 discovery guard다.
검색 기준 연도보다 미래인 publication year는 잘못되거나 조기 등록된 metadata로 보고 Core·Rising에서
fail-closed하며 Broad에 명시적인 reason을 저장한다.

일반 Project Chat에는 top-level 사용자 메시지가 문헌 subject와 명시적인 검색·찾기·추가 action을 함께
말하고 부정 명령이 아닐 때만 `search_literature` capability를 turn-scoped catalog에 넣는다. 검색 기능이나
정책을 설명해 달라는 meta-question의 명사형 `search/검색`은 mutation 허가로 취급하지 않는다. 예를 들어
“Tabular foundation model 논문을 검색해서 Literature에 넣어줘”는 허용되지만, 단순 PDF 요약이나
“기존 Literature를 정리·리뷰해줘”, “저장된 논문에서 찾아줘”, “GOSU 안에 이미 있는 논문을 찾아줘”,
“문헌을 검색하지 마” turn에는 tool 자체가 없다. 현재 paper와 관련된 새 논문이나 project 연구 주제에
관한 외부 discovery는 명시적 search action이 있으면 계속 허용하되, saved/existing/library scope는
외부 검색 mutation으로 승격하지 않는다. 이 lexical
Main-process gate는 PDF·Research Notes·web
content 안의 prompt injection이 뒤늦게 write capability를 만들지 못하게 한다. legacy reviewer에도
mutation tool을 주지 않는다. model argument에는 project ID가 없고 Main closure가 active project를
주입·재검증한다. tool은 Renderer와 동일한 `LiteratureService`와 고정 policy-v3 3-layer 규칙을 호출하므로
대화로 검색해도 Core·Rising·Broad 선별, strong identity dedupe와 additive merge를 우회하거나 임의
weight·유명인 목록으로 바꿀 수 없다. tool argument의 짧은 Topic·Keyword tag도 같은 typed command로
전달되며 긴 질문이나 provider metadata에서 임의 tag를 꾸며내지 않는다. 삭제와 사람 annotation 수정도
허용하지 않는다.

Codex에는 `runId`, query, 그 run에 실제 적용된 Topic·Keyword tag, provider·policy ID/version, 실제 signal coverage·degradation reason,
retrieved/selected count, 세 layer count와
found/new/updated/unchanged/conflict count만 metadata-only receipt로 반환한다. 충돌이 있을 때만 사람이
식별할 수 있도록 앞의 최대 3개 후보의 ordinal·title·DOI·canonical arXiv ID·provider record ID와 생략
개수를 제한적으로
함께 반환하며, 정상 paper 목록·author·ranking signal·abstract와 raw provider payload는 보내지 않는다.
lane failure가 있어도 citation count나 publication year metadata로 관련 signal을 일부 계산할 수 있으므로
Project Chat은 실패한 provider·정렬 lane과 남아 있던 signal을 구분해 보고한다. cancel signal은
LiteratureService까지 전달되고 취소·timeout 뒤의 결과는 commit하거나 terminal reply
뒤에 채택하지 않는다.

`literature_records`, `literature_search_runs`, `literature_search_hits`,
`literature_search_conflicts`는 Workspace snapshot이나 다른 모듈의 table이 아닌 Literature 모듈 소유다.
`literature_search_runs`는 provider·policy version, retrieved/selected count와 layer별 실제 저장 count를
남기고 signal coverage, degradation reason과 그 검색에서 적용한 typed tag도 저장한다. matching record는
여러 검색의 tag를 `NFKC → 공백 정규화 → 대소문자 무시` key로 중복 제거해 누적하되 첫 표시 철자와 입력
순서를 보존한다. Topic과 Keyword는 같은 글자여도 서로 다른 종류로 유지한다. 새 tag만 추가된 refresh도
record version을 올린 `updated` 결과이지만 source 변경이 아니므로 AI draft를 무효화하거나 annotation
version을 올리지 않는다. 실패·취소된 run과 identity conflict로 보류된 후보에는 tag를 적용하지 않는다.
각 hit는 당시 layer·tier rank·score·signal
source·reason을 보존해 검색 이력을 재현할 수 있고, record에는 그 논문이 마지막으로 매칭된 검색의
discovery summary만 별도로 둔다. 따라서 다음 continual search가 같은 paper를 다른 layer로 분류해도
과거 run의 판정은 덮어쓰지 않는다. Evidence table의 기본 importance 정렬은 서로 다른 query에서 나온
상대 score를 숫자로 비교하지 않는다. `classifiedAt`이 최신인 검색을 먼저 두고, 같은 run 안에서만
Core→Rising→Broad와 tier rank를 비교한다. UI도 score를 `within search`로 표시하고 각 paper의 Core gate
통과·실패 이유와 exact v3 threshold를 보여 준다. v1·v2 결과를 조용히 재작성하지 않고 legacy label로 표시하며,
같은 검색을 다시 실행하면 matching record의 current summary만 v3로 갱신되고 과거 hit provenance는
보존된다. Core card는 현재 v3 통과 수와 legacy/other-policy 수를 분리해 오래된 citation 0 Core label을 현재
기준 통과처럼 보이지 않게 한다. `Total` quick filter는 Core·Rising·Broad와 import된 `unclassified`를 한
table에서 함께 보여 주며 DB tier enum에는 추가하지 않는다. import paper는 새 search에서 매칭되기 전까지
`unclassified`로 남는다.
모든 query와 mutation은 Main에서 active project 존재 여부를
다시 검사하고 project ID를 SQL predicate에 포함한다. 앱 재시작 중 남은 `running` search는 `failed`로
reconcile하고, 최근 검색은 query·author·journal/venue·연도·Topic·Keyword 조건을 `Search again` 입력으로
복원할 수 있다. Topic과 Keyword는 검색 provenance일 뿐 아니라 normalized provider query에도 추가하며,
author와 venue는 provider가 지원하는 structured query로 전달한 뒤 반환 metadata를 다시 확인한다.
Evidence table은 provider·manual·AI topic을 합치지 않고 검색 provenance tag만 별도 열에 표시한다. 종류가
적힌 chip을 누르면 정규화된 `종류 + 정확한 tag`로 filter하며 substring은 사용하지 않는다. filter는
Topic·Keyword·Untagged를 구분하고 상세 화면도 Search tags, Manual review topics, AI topic suggestions,
AI keywords를 서로 다른 영역으로 보여 준다. provider가 준 bounded abstract는 별도 column에 저장하고
raw provider payload나 full text로 취급하지 않는다. 검색 완료 후 연결된 AI가 있으면 아직 draft가 없는
abstract-bearing record를 최대 50건까지 자동 정리해 broad topic과 method·model·dataset·task·domain·평가
기준·named concept의 상세 keyword를 분리 저장한다. abstract가 없으면 metadata-only로 명시하며 추측한
keyword를 채우지 않는다. 자동 background scheduler는 아직
없으므로 continual review는 사용자가 같은 검색이나 새 검색을 다시 실행할 때 additive merge하는
형태다. active evidence table은 프로젝트당 500건으로 제한하고 검색·import가 한도를 넘으면 일부만
반영하지 않고 transaction 전체를 거절한다. normalized DOI, 같은 provider의 record ID와 canonical arXiv
ID가 strong identity다. arXiv identity는 `arxiv:` prefix·공식 abs/pdf URL·`.pdf`·version suffix를 제거하고
modern 또는 legacy ID 문법을 통과한 뒤 소문자 `arxiv:<id>`로 고정한다. Semantic Scholar의
`externalIds.ArXiv`와 Hugging Face paper ID가 이 identity를 공유하므로 title·author formatting과
fingerprint가 달라도 같은 project record를 찾는다. `title + 첫 저자 + 연도` metadata fingerprint는 DOI,
provider ID와 canonical ID가 모두 없는 record의 weak fallback이며, 서로 다른 strong identity가 같은
fingerprint를 공유하는 것은 허용한다. 따라서 동일 제목의 서로 다른 DOI version이나 supplementary
component를 자동 병합하지 않는다. strong candidate는 DOI·canonical ID·provider ID를 각각 조회하고 둘
이상이 서로 다른 저장 record를 가리키거나 기존 strong identity와 모순되면 임의 merge 없이 identity
conflict다. strong match가 없을 때 fingerprint가 가리키는 유일한 weak-only record만 enrichment할 수 있고,
weak candidate가 strong record와 fingerprint를 공유해도 임의 병합하지 않는다. source 우선순위는
`import < hugging-face < crossref < semantic-scholar`이며 낮은 source refresh가 높은 source identity를
되돌리지 않는다. legacy migration은 record와 conflict table에 nullable `canonical_id`를 추가하고,
unambiguous Hugging Face provider ID를 backfill하며 project별 canonical partial unique index를 만든다.
기존 row·annotation·conflict를 보존하고 이미 충돌하는 identity를 migration에서 자동 합치지 않는다.
weak fingerprint partial unique index도 DOI·provider ID·canonical ID가 모두 null인 row에만 적용하고 별도
non-unique lookup index를 유지한다. schema-v1 search run·receipt의 새 `conflictCount`는 legacy payload를
읽을 때 `0`으로 default하고, SQL migration도 기존 search row에 `conflict_count=0`을 채운다.
Semantic Scholar가 DOI·paper ID는 확인했지만 author·venue·year·topic 같은 optional metadata를 비워서
보내는 경우에도 이미 저장된 풍부한 값을 null이나 빈 배열로 지우지 않는다. 실제 metadata가 바뀌면 보존한
field를 포함해 fingerprint를 다시 계산하고 stale AI draft를 무효화하지만, 동일한 sparse refresh는 no-op으로
처리해 기존 사람 review와 AI annotation을 유지한다.
또한 같은 normalized DOI가 Semantic Scholar와 Crossref candidate pool 양쪽에 있으면 provider 우선순위만으로
한쪽 metadata를 버리지 않는다. Semantic Scholar identity를 유지하면서 더 풍부한 title·author·venue·topic,
알려진 출판 연도, 최대 citation count와 HTTPS source를 deterministic하게 합치고 새 fingerprint를 만든 뒤
ranking과 저장에 사용한다.
같은 canonical arXiv ID가 Hugging Face와 Semantic Scholar에서 발견되면 검색 순서나 metadata fingerprint가
달라도 한 record로 갱신한다. Semantic Scholar source로 승격할 때 그 응답이 생략한 기존 author·venue·year·
topic·citation·URL은 null이나 빈 배열로 지우지 않는다. 반대로 이후 낮은 우선순위의 Hugging Face refresh가
Semantic Scholar identity와 citation metadata를 되돌리지 않는다.

활성 project의 Literature route는 중복된 공통 page heading을 렌더링하지 않고 compact content padding을
사용한다. 검색 query와 실행 action뿐 아니라 author·journal/venue·subject/topic·keyword·연도 조건을 기본
표면에 두고 최근 검색과 ranking policy 전문만 닫힌 native `details`에 둔다. reduced provider coverage는 원인을 한 줄 summary로
유지하고 signal 상세만 펼친다. `Total / Core / Rising / Broad`는 설명 카드가 아니라 count가 있는 한 줄
filter tab이며 설명은 title과 accessible label에 남긴다. AI provider 상태도 한 줄로 제한해 검색·분류 chrome이
Evidence table의 초기 viewport를 밀어내지 않게 한다. 표 본문과 keyword chip은 전역 body/control font token을
사용해 다른 workspace보다 작아지지 않게 한다.

Evidence table은 page 전체를 밀어내는 unbounded grid item이 아니라 keyboard-focusable한 bounded scroll
region이다. workspace와 library card는 명시적인 `minmax(0, 1fr)` grid column을 사용해 wide table의
min-content 폭이 implicit auto track을 넓힌 뒤 parent `overflow: hidden`에 잘리는 일을 막는다. 각 column은
stable semantic key별 default/min/max pixel 폭을 가지며 header 경계의 accessible separator를 pointer로
drag하거나 keyboard의 Left/Right Arrow, Home/End로 조절할 수 있다. 조절값은 renderer-local non-secret
preference에만 저장하고 project data·sync에는 넣지 않으며, 손상되거나 알 수 없는 key는 column별 default로
복구한다. double-click은 해당 column을, `Reset column widths`는 전체 column을 기본 폭으로 되돌린다. scroll
wrapper는 부모 content track 안에서 `min-width: 0`·`width: 100%`와 `contain: inline-size`로 수축하고,
25행 page는 `clamp(520px, 68vh, 860px)`의 실제 block size 안에서 가로·세로 scroll을 모두 소유한다.
sticky column header는 이 region에 고정된다. macOS overlay scrollbar 설정과 무관한 fallback으로 표 위에
현재 geometry에서만 활성화되는 `Columns ←/→`, `Top/Bottom` control을 제공하며 ResizeObserver와 scroll
event로 각 edge 상태를 갱신한다. native wheel·trackpad와 arrow/Page key는 가로채지 않는다. 가로
overscroll만 table 안에 가두고 세로 overscroll은 바깥 page로 전달하므로 table 끝에서 아래의 paper
detail로 계속 이동할 수 있다. 이 계약은 좁은 창, 접힌 sidebar와 Extra Large 글자 크기에서도 넓은 column이
잘리거나 wheel 입력이 사라지지 않게 유지한다.
실제 Electron geometry smoke는 1,180×820 content에서 compact search card가 220px 이하인지, table이
Literature content 상단 58% 안에 시작하는지, 초기 viewport의 35% 이상과 짧은 fixture 6행 이상이 table에
보이는지 확인한 뒤 두 축 scroll offset이 모두 전진하는지도 검증한다.

Evidence table의 paper title과 DOI action은 provider가 준 임의 markup을 직접 쓰지 않고 shared
`canonicalLiteratureUrl`로 같은 landing page를 계산한다. 우선순위는 검증된 DOI의 `https://doi.org/...`,
version suffix를 제거한 canonical arXiv ID의 `https://arxiv.org/abs/...`, 마지막으로 credential 없는
HTTPS `sourceUrl`이다. 세 후보가 모두 유효하지 않으면 clickable link를 렌더링하지 않는다. title과 DOI가
같은 helper를 사용하므로 서로 다른 논문을 여는 UI drift가 없고 Electron의 normal external-link policy를
통해 system browser에서 연다.

검색 batch는 후보별 savepoint를 사용한다. DOI, canonical arXiv ID와 provider ID가 서로 다른 기존 row를 가리키는 진짜
identity conflict는 그 후보만 rollback하고 `conflict_count`를 검색 이력과 receipt에 남기며, 나머지 안전한
후보는 계속 저장한다. `literature_search_conflicts`에는 raw response 대신 ordinal, normalized title·author,
DOI·canonical ID·provider ID·fingerprint·year만 local SQLCipher에 저장한다. 즉시 notice와 recent search tooltip에서 최대
3개 식별자와 생략 개수를 보여 주므로 어떤 후보가 보류됐는지 확인할 수 있고, run list와 Project Chat
tool payload도 같은 3개 preview 상한을 적용해 이미 commit된 검색이 응답 크기 때문에 실패한 것처럼
보이지 않게 한다. 자동 merge는 하지 않는다. 반면 record
한도나 저장소 오류는 여전히 검색 transaction 전체를 거절하고, file
import의 모호한 identity도 전체 import를 fail-closed하여 사람 annotation을 잘못 연결하지 않는다. 새 검색은
기존 record를 지우지 않으며 source metadata만 갱신하고 사람의 topics·summary·relevance·review status는
보존한다. source field나 fingerprint가 실제로 바뀌면 기존 metadata에 근거한 AI draft와 provenance는
무효화해 다음 AI batch 후보로 되돌린다. 삭제는 active table에서 숨기는 soft delete이고 hard-delete
command는 제공하지 않는다.

사람의 annotation, provider source field와 AI draft는 별도 column·version으로 관리한다. 수동 편집은
record version과 annotation version을 함께 비교하고, AI batch도 각 row의 expected record version과
annotation version이 모두 일치할 때만 하나의 transaction으로 적용한다. 따라서 검색 갱신이나 사람이
수정한 record를 늦게 끝난 AI turn이 덮어쓰지 않는다. `Organize with Codex`는 AI draft가 아직 없는
다음 최대 50개 정규화 metadata만
pinned Codex App Server의 새 read-only thread에 보내며 dynamic tool, shell과 network를 주지 않는다.
manual note와 paper full text는 prompt에 포함하지 않는다. structured output은 입력 record ID를 정확히
한 번씩 반환해야 하고, model ID·reasoning option·입력 SHA-256·생성 시각·`metadataOnly: true` provenance를
저장한다. metadata만으로 알 수 없는 방법·결과·한계는 추측하지 않도록 표시하며 결과는 사람이 검토할
draft이지 verified evidence가 아니다. Codex 장애는 검색·표·수동 review·transfer를 막지 않는다.

Import와 Export는 Renderer가 path나 file body를 넘기는 범용 파일 IPC가 아니다. Main의 고정 dialog가
JSON, CSV, BibTeX 한 파일만 고르고 8 MB·500 record·regular-file·no-symlink 정책으로 같은 file handle에서
읽는다. export는 선택한 directory의 private 0600 temporary regular file에 쓰고 `fsync`한 뒤 atomic rename해
기존 파일을 부분적으로 손상시키거나 destination symlink를 따라가지 않는다. Renderer에는 basename,
건수와 export SHA-256만 돌려준다. JSON v2와 새 CSV column은 누적 search Topic·Keyword tag를 보존하고,
legacy JSON v1·기존 CSV는 빈 search tag로 안전하게 import한다. JSON/CSV는 versioned deterministic
interchange이고 CSV는 spreadsheet formula injection을 방지한다. BibTeX는 provider `keywords`와 분리된
`gosusearchtopics`·`gosusearchkeywords` custom field로 tag를 왕복한다. citation key는 안정적으로 생성하고 project 내 collision에 suffix를
붙인다. parser는 `%` line comment와 `@string`·`@preamble`·`@comment` special entry를 건너뛰지만 external
macro `#` concatenation은 지원하지 않고 명시적으로 거절한다. export에는 source metadata와 사람이 검토한
field만 포함하고 AI annotation, provider raw
ID, project ID, local version·삭제 상태는 제외한다. import는 DOI strong match를 우선하고 strong identity가
없는 candidate와 row 사이에서만 fingerprint fallback을 사용한다. strong identity가 없어서 어느 DOI
record인지 증명할 수 없는 manual review는 임의로 붙이지 않고 import 전체를 거절한다. 안전하게 일치한
manual review는 복원할 수 있지만 AI provenance를 신뢰해 가져오지 않으며 Semantic Scholar·Crossref
source를 generic import source로 강등하지 않는다. Zotero local mirror·citation insertion·PDF 확인과 background alert는 후속
adapter 범위다.

### Git Workspace 경계

Project의 `repository`에는 URL이나 SSH 주소가 아니라 검증된 `owner/repository` label만 저장한다.
이 label은 암호화 workspace snapshot과 outbox에 들어갈 수 있지만 token, credential, local path,
파일 본문과 raw diff는 들어갈 수 없다. 과거 snapshot이 임의 repository 문자열을 포함해도 agent에는
검증된 label만 보이며, 새 project 생성과 연결 command는 URL·userinfo·token 모양을 경계에서 거부한다.

Clone은 Electron Main이 `app.getPath('userData')/git-workspaces/<project UUID>` 아래에 만드는 앱 관리형
worktree만 허용한다. Project Chat의 임시 Codex workspace, Obsidian Vault나 사용자가 고른 임의 폴더를
Git root로 재사용하지 않는다. clone은 HTTPS, no-submodule, no-checkout으로 임시 sibling directory에
받고 다음 검증을 모두 통과한 뒤 atomic rename한다.

- project가 active이고 exact UUID directory를 소유하는 현재 macOS 사용자여야 한다.
- repository directory와 `.git`은 실제 directory여야 하며 symlink일 수 없다. macOS의 `/var`와
  `/private/var` 같은 신뢰한 parent alias는 canonical parent 기준으로 처리하되 project directory 자체의
  alias는 거부한다.
- `.git`의 HEAD, config, index, refs, logs, objects와 Git이 쓰는 주요 admin file은 canonical metadata
  tree 안의 regular single-link file/directory여야 한다. symlink 또는 outside hard link가 보이면 read와
  mutation을 모두 중단한다.
- object alternates, HTTP alternates, grafts, partial-clone/promisor marker와 promisor config는 허용하지
  않는다. 다른 project나 host path의 object를 같은 SHA처럼 읽거나 조회 중 lazy network fetch하는 것을
  막는다.
- `rev-parse --show-toplevel`은 canonical project root와 같아야 한다.
- `origin` URL은 정확히 하나이고 userinfo·query·fragment 없는 예상 GitHub HTTPS repository여야 한다.
  다중 URL, `pushurl`, `insteadOf`/`pushInsteadOf`, custom upload/receive pack, local `http.*`와
  `include.path/includeIf`는 network command 전에 거부한다.
- symbolic HEAD는 `refs/heads/<validated branch>`만 가리킬 수 있고 그 local branch 자체는 direct ref여야
  한다. detached HEAD는 exact object ID로만 표현하며 remote-tracking/local ref와 loose ref/reflog path의
  filesystem symlink를 거부한다.
- remote가 비어 있어 unborn default branch만 있는 경우 HEAD를 `null`로 표현하고 checkout을 생략한다.
  첫 file stage·unstage·commit 뒤 같은 workspace에서 정상 history로 전환한다.

Renderer에는 filesystem path, Node, raw Git command나 generic IPC를 노출하지 않는다. 고정 preload API는
snapshot, clone, text/Markdown preview, diff, commit detail, stage/unstage/commit, branch create/switch,
Fetch, fast-forward-only Pull, current-branch Push와 Finder reveal만 제공한다. force push, reset, clean,
discard, stash, branch 삭제, merge, rebase, submodule update와 arbitrary command는 현재 surface에 없다.

Git child는 shell 없이 고정 executable과 argv array로 실행한다. hook, fsmonitor, pager, external diff,
textconv, commit signature 표시·검증, merge signature 검증, global attributes, interactive prompt와
submodule recursion을 끄고 output·timeout·파일 수·preview 크기를 제한한다. Clone checkout과 branch
switch에도 `--no-recurse-submodules`를 명시해 repository-local `submodule.recurse`가 nested worktree를
움직이거나 그 안의 filter를 실행하지 못하게 한다. History와 commit detail은
`--no-show-signature`, Pull merge는 `--no-verify-signatures`를 다시 명시해 repository-local
`gpg.program`이 조회나 fast-forward 과정에서 실행되지 않게 한다. Network command를 포함한 모든
operational Git command는 global/system config를 기본 격리한다. Commit 직전의
`git config --get user.name/user.email`만 authorship을 얻기 위한 제한된 read로 예외 처리하고, 검증한 값을
격리된 commit argv에 다시 넣는다. 이름이나 이메일이 없거나 control character를 포함하면 commit을
중단한다. HTTPS protocol만 허용하며,
`GIT_ASKPASS`·`SSH_ASKPASS`와 `core.askPass`를 `/usr/bin/false`로 고정해 저장소 또는 parent process가
지정한 credential executable을 실행하지 않는다. macOS에서는 command-line에서 초기화한 Keychain
credential helper만 사용한다. local/worktree config가
filter, hook, alternate refs command, include 또는 외부 command를 다시 켜면 fail closed하고, stage
대상에 `filter` attribute가 있어도 실행하지 않는다. Snapshot과 diff도 status/diff 전에 같은
local/worktree config gate를 통과해야 하므로 Repository 화면을 여는 것만으로 filter command가 실행되지
않는다. 모든 child에 `--no-replace-objects`/`GIT_NO_REPLACE_OBJECTS=1`을 적용해 replace ref가 표시 SHA와
실제 history/diff/merge 대상을 바꾸지 못하게 한다. 또한
`--literal-pathspecs`와 `GIT_LITERAL_PATHSPECS=1`을 강제해 `*`, `?`, `[]`, `:(...)`가 포함된 실제 파일명을
renderer가 선택해도 다른 파일로 확장되지 않는다. symlink·submodule·binary·2 MiB 초과 파일은 tree에
표시할 수 있지만 본문을 Renderer에 반환하지 않는다. UTF-8 preview cutoff는 최대 3 byte를 backtrack해
완전한 code point에서 끝내므로 큰 정상 text를 binary로 오인하지 않는다. History는 먼저 validated
OID-only 목록을 고정하고 NUL-framed metadata가 그 순서와 정확히 일치할 때만 표시한다. Commit detail은
current HEAD에서 reachable한 commit object만 허용해 blob, tree, dangling object로 file-preview policy를
우회할 수 없다. 깨끗한 macOS에 `/usr/bin/git`을 제공하는 Apple Command Line Tools가 없으면
설치가 필요한 bounded 오류를 표시한다. pinned Git 배포와 GitHub App token lifecycle은 후속 범위다.

모든 mutation은 UI snapshot의 exact full HEAD SHA 또는 unborn `null`과 exact symbolic branch를 함께
보내며 Main에서 다시 비교한다. 같은 commit을 가리키는 다른 branch로 외부 전환했어도 stale command는
중단된다. Create Branch는 mutable HEAD 대신 그 reviewed SHA를 explicit start point로 사용한다. Commit은
snapshot의 index fingerprint를 요구하고, `write-tree` 전후 fingerprint가 같을 때 exact tree를
`commit-tree`로 만들며 local branch는 expected HEAD CAS `update-ref --no-deref`로만 이동한다. Renderer도
현재 fingerprint의 모든 staged diff를 연 뒤에만 Commit을 활성화한다. 외부 process가 index를 바꾸면
reviewed tree만 commit되거나 명시적인 stale-index 오류로 중단된다. Rename diff와 Unstage는 original과
destination literal path를 함께 처리한다.

project별 in-process queue가 index lock 경합을 막고, base가 바뀌면 자동 merge/rebase하지 않는다. Pull은
clean worktree와 exact `origin/<current branch>` upstream을 요구한다. Fetch/Pull은 remote head를 예측
불가능한 `refs/gosu/fetch/<session>/...` direct ref에 먼저 받고, 검증한 SHA를 remote-tracking ref에
`update-ref --no-deref` CAS로 반영한다. 따라서 악성 `origin/<branch>` symbolic ref가 local branch를
덮어쓸 수 없다. Pull은 network 이후 HEAD/clean 상태를 다시 확인하고 fetched exact SHA에
`merge --ff-only`만 수행하며 merge commit이나 rebase는 만들지 않는다. 일반 Fetch도 repository의
`remote.origin.fetch`를 신뢰하지 않고 tag·prune·FETCH_HEAD 기록을 끈다. Push도
검토된 exact HEAD SHA를 source로 삼아 예상 GitHub HTTPS URL의 current branch에만 보낸다. branch가
network call 중 움직여도 새 commit은 전송하지 않고 상태 경합으로 중단한다. `--no-follow-tags`,
`--signed=no`, no-submodule 옵션을 강제해 local config가 tag, push certificate 또는 submodule push로
전송 범위를 넓힐 수 없게 하며 force option은 생성하지 않는다. 성공 뒤 `origin/<branch>` tracking ref는
이전 값과 함께 atomic compare-and-swap으로만 갱신한다.

Git file tree와 raw file/diff/history는 로컬 조회 결과다. Hosted DB, workspace outbox, telemetry 또는
Project Chat context에 자동 포함하지 않는다. GitHub remote 장애나 Git 설치 실패는 Repository 화면의
bounded error로 격리하며 Kanban, Objective, Research Notes와 기존 Project Chat을 중단시키지 않는다.

### Manuscript workspace와 교체 가능한 LaTeX engine 경계

상세 결정과 구현·후속 범위는
[`ADR 0004`](adr/0004-pluggable-manuscript-collaboration-engine.md)에 고정한다. 핵심은 manuscript의
identity·checkpoint lineage와 편집 engine을 분리하고, 후속 review provenance가 이 경계를 재사용하게 하는
것이다.

```mermaid
flowchart LR
  UI["Manuscript UI"]
  IPC["typed IPC\nproject·manuscript·binding version"]
  Service["ManuscriptWorkspaceService\nidentity·lineage·exclusive queue"]
  Registry["Adapter registry\ncapability honesty"]
  OverleafPrivate["Overleaf private connector\nURL·workspace ID·safeStorage ref"]
  OverleafGit["official Overleaf Git\nexternal linear checkpoint"]
  Mirror["isolated bare mirror\nimmutable GOSU refs"]
  Source["validated checkpoint source\nbounded list·text read"]
  Compiler["macOS sandbox-exec + MacTeX\nfixed argv·no shell escape·no network"]
  Preview["PDF.js canvas preview\nephemeral typed IPC bytes"]
  Portable["portable binding·anchor·checkpoint\nno URL·token·source"]
  Future["future local/cloud LaTeX adapter"]

  UI --> IPC --> Service
  Service --> Portable
  Service --> Registry
  Registry --> OverleafPrivate --> OverleafGit
  OverleafPrivate --> Mirror
  Mirror --> Source
  Source --> Compiler --> Preview
  Future -.-> Registry
```

현재 동작 경계는 다음과 같다.

- 한 project는 최대 32개 manuscript identity를 가질 수 있고 각 manuscript에는 active binding 하나만
  둔다. disconnect된 binding과 checkpoint는 provenance를 위해 남기며 새 binding의 checkpoint도 같은
  manuscript lineage의 이전 checkpoint를 base로 잇는다. title과 root TeX path는 optimistic manuscript
  version을 사용해 연결 후에도 수정할 수 있고 stale form은 덮어쓰지 않는다.
- 새 identity의 기본 표시는 기존 개수에 따라 `Main manuscript`, `Main manuscript 2`, ...로 제안해 서로 다른
  record가 같은 제목으로 보이는 혼동을 줄인다. title이나 root path가 같다는 이유만으로 자동 병합하지 않는다.
  provider 연결과 checkpoint 이력이 모두 없는 setup-only record만 확인 dialog 뒤 삭제할 수 있으며, 한 번이라도
  연결되었거나 provenance가 생긴 record는 Renderer, service와 SQL query가 모두 삭제를 거부한다.
- portable `ManuscriptWorkspaceBindingV1`, `ManuscriptCheckpointV1`, `ManuscriptSyncAnchorV1`에는
  provider-private URL, workspace locator, token, local path, LaTeX 본문과 raw diff가 없다. Desktop의
  Overleaf connector만 private SQLCipher table과 GOSU-private encrypted credential을 읽는다.
- `ManuscriptWorkspaceAdapterRegistry`는 descriptor의 declared interaction mode와 실제 method가 맞는지
  construction 때 확인한다. `overleaf_git`는 `checkpoint_pull`과 provider website의
  `external_realtime_editor`만 선언한다. legacy ZIP bootstrap helper는 별도이며 이 adapter capability가
  아니다.
- Overleaf 연결은 authority handoff가 아니다. binding은 `authority=gosu`로 시작하고 captured revision은
  immutable transport checkpoint다. capture receipt가 생기면 Project Chat의 bounded source inspection과
  Manuscript의 local PDF compile을 요청할 수 있다. 이 상태는 로컬 mirror·source tree·MacTeX·sandbox
  preflight 성공을 뜻하지 않으며, 각 source read·compile operation이 exact checkpoint를 다시 검증하고
  실패를 별도 receipt로 반환한다. 이 기능은 source import, diff 또는 review candidate 승격이 아니다. GOSU는
  provider에 push, auto-import, auto-merge/rebase, background poll, comment·Track Changes round-trip 또는 provider
  authority 전환을 하지 않는다.
- `Check Overleaf changes`는 content를 받지 않는 read-only `ls-remote`로 exact `master` revision만 관찰한다.
  UI는 manuscript 전체의 과거 checkpoint가 아니라 현재 active binding에서 캡처한 checkpoint와만 revision을
  비교해 baseline 없음·변경 없음·새 Overleaf revision을 표시한다. Git HEAD만으로 편집자 identity, 저장 전
  realtime edit 또는 source-level merge conflict를 알 수 없으므로 `syncState=diverged`를 충돌 판정에 재사용하지
  않고, 변경을 발견해도 3-way source 비교 전에는 conflict나 conflict-free를 단정하지 않는다. Fetch는 관찰한
  revision이 바뀌지 않았는지 다시 확인하고 shallow exact-revision ref를 binding별 bare mirror로 받아
  commit/tree와 regular root `.tex` blob을 검증한다. `git fsck --connectivity-only`로 bibliography, include와
  image를 포함한 reachable object 연결성까지 통과한 뒤에만 GOSU checkpoint ref를 pin한다.
- `revisionEnvelopeDigest`는 provider ID·commit OID·tree OID의 identity envelope이지 canonical source-byte
  digest가 아니다. native migration과 publish 전에는 deterministic source artifact digest 계약을 추가해야
  한다.
- 같은 binding/provider revision은 SQLCipher unique receipt로 한 번만 기록한다. metadata가 있지만 mirror
  artifact가 없으면 adapter가 같은 revision을 다시 받아 복구한다. 최신 checkpoint는 binding 생성 시각이
  아니라 append-only SQLite row order로 manuscript 전체에서 선택한다.
- fetch command 자체의 timeout·취소·실패를 포함해 checkpoint ref로 pin하지 않은 모든 attempted fetch는
  incoming ref, reflog와 unreachable object를 즉시 prune해 retained mirror quota를 잠식하지 않게 한다.
- checkpoint source 접근은 pin된 commit/tree/envelope/root를 다시 검증하고 symlink·gitlink, traversal,
  control character, `.git`, secret/key 의심 경로, Unicode/case collision, 개별·전체 크기 한도를
  거부한다. Project Chat tool은 파일 목록과 최대 24,000자 UTF-8 chunk만 반환하고 URL, token,
  mirror path를 반환하지 않는다. 원고 본문은 자동 context가 아니며 tool을 명시적으로 호출한 turn에서만
  untrusted research content로 사용한다. materialization은 `git archive`를 사용하지 않고 isolated
  `git cat-file --batch`에서 commit의 exact blob bytes를 읽어 declared size·object type·Git blob hash를
  재검증한다. 따라서 repository `.gitattributes`의 `export-ignore`나 `export-subst`가 캡처 원문을 누락·변형하지
  않는다. 이전 버전 crash 뒤 남은 strict `.gosu-archive-<UUID>` real directory만 startup migration cleanup이
  제거하고 symlink·file·lookalike·non-binding path는 보존한다.
- PDF preview는 검증된 checkpoint를 일회성 staging directory에 materialize한 뒤 macOS
  `sandbox-exec`에서 사용자가 고른 pdfLaTeX·XeLaTeX·LuaLaTeX 하나를 silent fallback 없이 fixed
  `latexmk` argv로 실행한다. 이 선택은 Overleaf 설정에서 읽은 값이 아니며 실제 engine과 version을 preview
  provenance에 기록한다. `-no-shell-escape`, network deny, captured source·MacTeX·system font/runtime만 허용하는
  OS read allowlist, output/home에만 열린 OS write boundary, TeX `openin_any=p`, timeout, 192 MiB generated
  staging·50,000-entry·process-output·PDF size budget을 적용한다. PDF magic과 SHA-256를 검증한 후에만 bounded
  base64를 typed IPC로 Renderer에 전달하고 PDF.js canvas로 표시한다. Renderer는 decoded image와 canvas
  dimension/pixel budget을 검사하고 한 번에 한 preview만 보유한다. 다중 페이지는 고정 높이의 연속 page
  stack으로 스크롤하며 현재 page 앞뒤만 독립 canvas로 렌더링한다. 스크롤 중심으로 page counter를 갱신하고
  Previous/Next는 같은 nested viewer의 exact page 위치로 이동한다. absolute path나 `file://`를 Renderer에
  노출하지 않는다. 컴파일 직후 검증된 exact PDF는 Main-owned cache에 최대 12개·128 MiB·7일로 제한해
  보존하며, Export·default-app Open·Finder reveal은 project·manuscript·checkpoint·artifact ID·SHA-256
  fence를 모두 다시 검증한다. Renderer는 임의 path나 PDF bytes를 action IPC로 보낼 수 없고, cache prune과
  OS action은 같은 root queue에서 직렬화되어 화면에 표시된 artifact가 중간에 교체되지 않는다.
  timeout·resource/output overflow·앱 종료 때 detached process group 전체를
  종료하고 staging은 성공·실패 모두 삭제한다. crash 뒤 남은 strict `.compile-XXXXXX` directory는
  Renderer/IPC가 열리기 전 startup reconciliation이 symlink와 lookalike를 보존한 채 정리한다. 현재 prototype은 Mac에 설치된
  MacTeX를 사용하므로 Overleaf의 TeX Live 버전·compiler 설정과 일치함을 보장하지 않는다.
- SQLCipher identity trigger는 manuscript record, binding, checkpoint와 artifact-purge queue의
  project/manuscript/provider column이 JSON identity와 parent row에 일치하는지 insert/update 시 다시 검사하고,
  credential cleanup provider/ref가 enqueue 시점의 private binding row와 일치하는지도 검증한다. 서비스
  validation을 우회한 복구 데이터도 다른 project lineage나 cleanup queue에 섞일 수 없다.
- Repository provenance는 active binding이 있을 때만 lightweight validated HEAD read를 수행한다. 전체
  file/status/branch/history snapshot을 Manuscript 화면 갱신마다 다시 계산하지 않는다.

보안·수명주기 경계도 engine port의 일부다.

- Git child는 Renderer가 아니라 Main에서 shell 없이 고정 argv로 실행하고 hook, prompt, submodule,
  non-HTTPS protocol과 user config를 끈다. remote URL은 credential/userinfo/query가 없는 official Overleaf
  HTTPS project endpoint만 허용한다. 사용자가 Overleaf에서 복사한
  `https://git@git.overleaf.com/<24-hex-project-id>` 형식은 password 없는 exact `git` username인지 먼저
  검증한 뒤 userinfo 없는 canonical endpoint로 정규화한다. 다른 username, password, query와 fragment는
  거부한다. 이전 버전이 저장한 fixed `git@` URL도 private binding read 경계에서 같은 canonical endpoint로
  승격한다.
- personal Git token은 Settings 전용 fixed IPC로만 Renderer에서 Main으로 이동하고 GOSU user-data의
  Electron `safeStorage` ciphertext로 저장한다. Manuscript connect와 Lecture import의 strict contract에는
  token field가 없다. 새 link는 그 시점의 Settings token으로 overwrite되지 않는 immutable
  credential reference와 workspace-bound encrypted snapshot을 각자 받는다. Settings token의 원자적
  교체·삭제는 향후 link에만 적용되며 기존 binding snapshot을 재키화하거나 지우지 않는다.
  삭제는 GOSU의 Settings copy만 없애며 Overleaf 계정의 token을 revoke하지 않는다. macOS에서
  `safeStorage` encryption key는 Keychain으로 보호되지만 공유 `git-osxkeychain` entry는 읽거나
  덮어쓰거나 지우지 않는다. 네트워크 Git child에는 redirect를 끄고 검증된
  exact Overleaf project URL에만 scope한 HTTP authorization config와 child 전용 environment로 전달해 process
  argument에도 token을 남기지 않는다. Renderer는 저장된 token을 다시 받지 않고 SQLCipher,
  contract, logs와 Hosted Sync에는 값을 남기지 않는다. 같은 Overleaf workspace의 connect, inspect, fetch와
  credential cleanup은 GOSU project가 달라도 provider/workspace key로 직렬화한다. 저장·조회·실제 사용 때
  normalized remote URL, private workspace ID와 credential reference에 encoded된 workspace ID가 모두 같은지
  검증해 다른 official Overleaf project로 token이 전달되지 않게 한다. 새 token은 `.pending` marker와 함께
  staged되며 실패하면 새 reference만 지운다. DB commit 뒤 marker 정리 전에 앱이 종료되어도 시작 시
  SQLCipher reference와 대조해 참조된 ciphertext는 확정하고 orphan pending ciphertext는 제거한다.
- fetch는 binding별 retained mirror 256 MiB, 전체 manuscript mirror 1 GiB guardrail과 shallow request를
  사용한다. fetch 도중 순간 disk 사용을 hard-limit하는 OS quota는 아직 없으므로 production 전 추가한다.
- Empty Trash transaction은 manuscript row를 cascade하기 전에 `bindingId`, `projectId`, `providerId`를
  durable artifact-purge queue에 기록한다. adapter가 검증된 exact binding directory를 삭제한 뒤에만 queue를
  ACK한다. 실패·미설치 provider row는 남겨 앱 시작과 다음 Trash purge에서 cursor로 다시 시도하며 뒤의
  정상 provider cleanup을 굶기지 않는다.
- disconnect와 Empty Trash는 private `credentialRef`도 durable cleanup queue에 먼저 기록한다. 동일
  provider/ref를 쓰는 enabled binding이 남아 있으면 보존하고 마지막 reference가 사라진 뒤 GOSU-owned
  ciphertext 삭제가 성공한 경우에만 ACK한다. canonical legacy workspace ID는 canonical ref로 migration하고,
  소유권을 증명할 수 없는 invalid legacy marker는 shared Git credential을 건드리지 않는 no-op recovery로
  완료한다.
- 현재 동시성은 project별 Main-process queue와 optimistic version, immutable receipt 범위다. 공통
  `ManuscriptSyncAttemptV1` shape와 fencing field는 정의되어 있으나 durable attempt table, cross-process
  lease, crash reconciliation과 unattended scheduler는 아직 구현되지 않았다.

후속 local/cloud engine은 새 URL 분기를 consumer에 추가하는 방식이 아니라 같은 registry와 checkpoint
boundary를 구현한다. 다만 현재 source read·compile은 Overleaf checkpoint를 위한 Desktop port이지
완전한 provider-neutral engine contract가 아니다. canonical source digest, editor·durable compile artifact·
presence·comment·tracked-change·realtime recovery,
generic onboarding/presentation/configuration storage와 staged multi-binding migration port는 아직 없다. Local
engine은 이 port들과 함께 CodeMirror·bundled Tectonic sandbox·durable PDF artifact와 offline persistence를, Cloud engine은
operation log 또는 CRDT/OT·presence·comments·ACL·durable reconnect를 provider-private하게 소유한다. 이
port들이 생기기 전 새 provider는 adapter뿐 아니라 작은 provider-specific connector UI와 storage를 추가해야
한다. Project Chat, Review, Reference가 Overleaf semantics를 직접 알게 해서는 안 되며, engine 전환은 URL
replacement가 아니라 기존 immutable checkpoint와 deterministic content hash를 검증하는 explicit migration
command로만 수행한다.

### 현재 로컬 workspace 흐름

```mermaid
flowchart LR
  UI["React workspace UI"]
  Preload["typed preload API\nfixed channels·result envelope"]
  Guard["Main sender·frame allowlist"]
  Service["WorkspaceService\nvalidation·version rules"]
  Transaction["single SQLCipher transaction"]
  Snapshot["local_workspace_state\nversioned snapshot"]
  Outbox["sync_outbox\nidempotent operation"]
  Summary["local_workspace_outbox_status\nbounded pending summary"]

  UI --> Preload --> Guard --> Service --> Transaction
  Transaction --> Snapshot
  Transaction --> Outbox
  Transaction --> Summary
```

- Renderer는 project·task·objective별 typed command만 호출한다. 임의 channel이나 generic cache
  조회 API는 노출하지 않는다.
- Main의 workspace handler는 예상 가능한 validation·version·recovery 실패를 reject하지 않고
  제한된 result envelope로 resolve한다. Preload가 이를 Renderer의 로컬 `Error`로 바꾸므로 Electron
  내부 오류 로거가 project 입력이나 local path를 Main console에 출력하지 않는다. IPC boundary에서
  command input을 먼저 검증해 입력 오류와 persisted snapshot recovery 오류를 구분한다.

### 운영형 Kanban·To-do의 소유권과 호환성

이 surface의 벤치마크와 범위 결정은 [`BENCHMARK_KANBAN_TODO.md`](BENCHMARK_KANBAN_TODO.md)에
기록한다. 핵심 결정은 별도 Todo 저장소를 만들지 않고 `WorkspaceTask` 하나를 두 projection에서
사용하는 것이다.

- 내부 상태 ID `backlog`, `planned`, `in_progress`, `review`, `done`은 sync command와 Project Chat
  action의 안정적인 의미로 유지한다. 사용자는 프로젝트마다 Board 제목, 다섯 column 표시명·순서와
  optional soft WIP limit을 바꿀 수 있지만 새 status ID를 만들거나 기존 ID를 삭제하지 않는다. 각
  column header의 `Rename` 동작과 상단 Board 설정은 같은 reusable editor를 열기 때문에 validation
  규칙이 갈라지지 않는다.
- `Kanban`과 `To-do`는 같은 `WorkspaceTask` ID, metadata와 optimistic version을 읽는 renderer
  projection이다. Kanban은 column과 drag workflow를, To-do는 같은 column order의 compact status group과
  completion checkbox를 제공한다. checkbox 완료는 canonical `done`으로 이동하고, 완료 해제는 별도
  이전-status history를 가장하지 않고 현재 Board 순서의 첫 non-`done` status로 명시적으로 재개한다.
  두 view는 composer, query·priority·label·due filter, edit, Task trash와 검색 target focus를 공유한다.
- `ProjectRecord.board`와 project-level `archivedAt`, Task의 description·priority·due date·labels·
  task-level `archivedAt`은 schema-v1 안의
  optional nested field다. v0.3.2 snapshot에 필드가 없어도 resolver가 런타임 기본값을 제공하며
  top-level 필드나 workspace schema version을 바꾸지 않는다. 새 project는 생성 시점의 full Board
  설정을 항상 저장하지만 기존 project의 optional shape은 계속 읽는다.
- project rename은 optimistic Project version을 검사하고 표시명만 바꾼다. repository·외부 연동의
  안정 식별자로 쓰일 수 있는 기존 slug는 조용히 다시 만들지 않는다. `project.rename` command와
  outbox provenance가 같은 workspace transaction에 남는다.
- project 삭제 UI는 hard delete가 아니라 `trashedAt`을 기록하는 `project.trash`다. 이름을 정확히
  입력하는 첫 경고와 최종 확인의 두 단계를 통과해야 하며, 기본 project picker에서는 숨기되 Settings의
  Trash에서 같은 UUID를 `project.restore`로 복원할 수 있다. task, objective, Board, Project Chat과
  pending outbox는 삭제하지 않는다. Trash의 기존 chat transcript는 읽을 수 있지만 새 turn·profile
  변경·action Apply를 Main service가 거절한다. Renderer의 disabled button에 의존하지 않고 Main의
  project-scoped gate가 starting·active turn과 chat mutation 중 `project.trash`를 원자적으로 거절하며,
  내부 호출이 이 gate를 우회한 terminal 경합에서도 assistant text만 보존하고 action proposal은
  폐기한다.
- Settings 통합 `Trash` 화면의 project group에서 실행하는 `Empty Trash`는 Trash에 이미 들어간 project만
  영구적으로 GOSU workspace에서 제거하는
  별도 `project.trash.empty` command다. 고정 문구 `EMPTY TRASH` 입력과 최종 확인을 모두 요구하고,
  expected workspace revision과 UUID idempotency key를 Main에서 검증한다. Active·Archived project는
  제거 집합에 포함될 수 없다. Main은 대상 project 전체에 Project Chat, SSH execution/approval과 Lecture
  generation lifecycle lock을 순서대로 잡고 하나라도 실행 중이면 `trash_busy`로 fail closed한다.
- Empty Trash의 workspace snapshot, sync outbox operation, append-only purge receipt, mutable local-module
  정리는 한 SQLCipher transaction에서 commit한다. Workspace task/objective와 Literature record/search run,
  Research Notes binding cache, SSH workspace grant, 아직 실행되지 않은 chat queue만 정리한다. GitHub
  repository, app local Git worktree, Obsidian/Research Notes file, remote server data는 삭제하지 않고 연결만
  해제한다. Project Chat history, experiment lineage/metric point, trusted SSH audit, Lecture revision 같은
  durable history와 provenance는 암호화 DB에 보존한다. 그중 experiment metric point, trusted SSH audit,
  Lecture revision과 purge receipt처럼 append-only guard가 있는 row는 그 guard를 우회하지 않는다. Settings
  결과 receipt가 이 경계를 다시 명시한다. 같은 idempotency key의 응답 유실 재시도는 저장된 receipt를
  반환하고 두 번째 state/outbox mutation을 만들지 않는다. schema-v1 receipt의 legacy wire field 이름
  `preservedImmutableProvenance`는 이미 저장된 idempotency receipt 호환성을 위해 유지하지만, 그 배열 전체가
  append-only라는 뜻으로 해석하지 않는다.
- project lifecycle은 서로 다른 세 상태로 분리한다. Active는 `archivedAt`과 `trashedAt`이 모두 없고,
  Archived는 `archivedAt`만 있으며, Trash는 `trashedAt`이 있는 모든 project다. `project.archive`와
  `project.unarchive`는 Project version CAS와 같은 SQLCipher transaction의 outbox provenance를 사용한다.
  Archived project의 기존 snapshot·chat transcript는 보존하지만 rename, Board·Objective·Task mutation,
  새 Project Chat turn·profile 변경·action Apply와 agent read tool은 Main에서 거절한다. Archived project를
  Trash로 옮길 때 `archivedAt`을 보존하므로 Trash 복원은 원래 Archived 상태로 돌아간다.
  optional project field는 legacy snapshot을 그대로 읽지만 새 outbox command enum을 모르는 v0.7 이하로의
  downgrade는 지원하지 않는다. downgrade 지원이 필요해지면 workspace/outbox schema migration을 별도
  ADR로 설계해야 한다.
- Renderer의 `project-sidebar.tsx`는 모든 Active project 이름을 folder tree로 보여주고, 여러 folder의
  Chat·Board·Goal & Metrics 하위 항목을 동시에 펼칠 수 있다. folder row를 누르면 그 project를 선택하며
  같은 row를 다시 누르면 하위 항목만 접고 현재 작업 화면은 유지한다. Hidden과 Archived는 별도
  recovery group으로 표시하고 Connections·Settings는 project 밖의 global navigation, Research Notes는 각 project folder 안의 navigation으로 둔다.
- folder 펼침, Active group 접힘, `Hide locally`, 왼쪽 project sidebar 전체의 접힘 상태와 사용자가
  drag 또는 keyboard separator로 조정한 폭은 개인 Mac의 navigation preference다.
  `project-navigation-state.ts`가 UUID 목록, boolean과 bounded width만 versioned
  `localStorage` key `gosu:project-navigation:v1`에 저장하며 SQLCipher snapshot, outbox, Git 또는
  Hosted Sync에는 넣지 않는다. sidebar를 접어도 현재 project·tab·chat draft는 그대로 유지하고
  Codex turn이나 SSH 작업을 중단하지 않는다. titlebar의 항상 보이는 panel button과
  `View → Toggle Project Sidebar` (`Control+Command+S`)가 같은 toggle을 호출한다. Main과 preload는
  payload 없는 고정 IPC channel만 노출하며 Renderer load 전 menu 요청은 toggle parity로 합쳐 전달한다.
  titlebar sidebar button은 34px hit area 안에 22px panel SVG를 사용하고, project section·Workspace
  navigation icon은 24px cell 안의 18px glyph로 정렬한다. group과 project folder disclosure는 작은
  font triangle 대신 shared SVG chevron을 18px로 고정한다. 이 icon geometry는 Appearance font scale과
  macOS fallback font에 종속되지 않으며 기존 row height, label ellipsis, `aria-label`·`aria-expanded`를
  유지한다.
  Desktop wide layout은 sidebar DOM과 고정된 2열 grid placement를 유지한 채 첫 track만 저장된
  220–440px 폭에서 0px로 전환하고 nav opacity·짧은 translate를 함께 적용한다. resize 중에는 grid
  transition을 끄고 pointer 위치를 직접 따라가며, content를 다른 row/column으로 재배치하지
  않고 `scrollbar-gutter: stable`로 scrollbar 출현에 따른 좌우 흔들림을 막는다. Renderer의
  `html`·`body`·`#root`와 `desktop-shell`은 window viewport 높이에 고정하고 document overflow를
  차단한다. 46px titlebar는 첫 grid row에 남고, 두 번째 row의 nav와 content만 각자의 세로 scroll을
  소유하며 `overscroll-behavior: contain`으로 scroll chaining을 막는다. 따라서 Connections처럼 긴
  surface도 GOSU window chrome이나 다른 pane을 밀어내지 않는다. 이 경계는 `position: sticky`에
  의존하지 않으며 compact logo·toggle·sync indicator도 같은 titlebar height token을 사용한다.
  접힌 nav는 transition
  종료 뒤 hidden visibility가 되며 `inert`·`aria-hidden`·pointer 차단으로 접근할 수 없다. keyboard 또는
  menu로 접을 때 sidebar 내부 focus는 먼저 titlebar toggle로 옮겨 숨겨진 control에 남지 않게 한다.
  좁은 stacked layout의 project navigation은 `min(320px, 40vh)` 높이 안에서 독립적으로 scroll해
  project가 많거나 글자 크기가 커져도 content row를 없애지 않는다. 이 layout은 즉시 접고
  `prefers-reduced-motion`에서는 모든 sidebar transition을 제거한다.
  Hide는 project lifecycle이나 협업자 화면을 바꾸지 않고 `Show` 또는 `Show all`로 즉시 되돌린다.
  진행 중인 Codex turn 표시와 중지 진입점을 숨기지 않도록 해당 project가 busy인 동안 Hide와 Archive를
  비활성화한다.
  Archive는 이 로컬 preference와 달리 domain command이므로 두 개념을 같은 필드나 API로 합치지 않는다.
- Renderer의 `board-view.tsx`는 Kanban·To-do view switch, form·drag-and-drop·completion·Delete 확인과 프로젝트별 임시 view state를
  소유한다. `kanban-board-model.ts`는 column resolve, 검색·priority·label·due date filter와 안전한
  drop 판단만 수행하는 pure helper다. 프로젝트 전환 시 `BoardView`를 project ID로 remount해 draft,
  filter, Task trash mode와 drag ID가 다른 프로젝트로 넘어가지 않게 한다.
- Workspace-level `Tasks`는 별도 task 저장소나 Main query를 만들지 않고 이미 검증된 workspace snapshot을
  읽는 renderer-only projection이다. parent의 `archivedAt`과 `trashedAt`이 모두 없는 Active project와
  `archivedAt`이 없는 active task만 포함한다. `Hide locally`는 navigation preference일 뿐 project
  lifecycle이 아니므로 숨긴 Active project도 이 집계에는 포함하고 project filter에서 명시적으로 선택할
  수 있다. Archived·Trash project와 Task trash의 task는 일반 전체 Tasks 화면에 섞지 않는다.
- 전체 Kanban은 project마다 다른 표시명·순서를 하나로 덮어쓰지 않고 안정적인 canonical status 다섯 개를
  global column으로 사용한다. 각 card와 To-do row는 owning project badge를 표시하고 project filter를
  제공한다. 새 task composer는 구체적인 Active project 선택을 필수로 하며 그 project Board의 첫 column을
  초기 status로 사용한다. 완료 해제도 owning project의 첫 non-`done` column으로 돌아간다. 서로 다른
  project의 WIP limit은 합치지 않으며 경고는 각 project Board에서 그 project 전체 active task를 기준으로
  계속 표시한다. 각 global column은
  `updatedAt`, Task ID 내림차순의 bounded initial subset만 그리고 사용자가 `Show more`로 다음 bounded
  batch를 여는 방식으로 큰 snapshot의 무제한 DOM 생성을 막는다. 따라서 방금 생성·이동·복원한 task가
  40개 window 밖으로 즉시 사라지지 않는다.
- 전체 Tasks에서 생성·편집·완료·status drag를 해도 새로운 workspace-scoped task command를 만들지 않는다.
  Renderer는 card가 소유한 `projectId`, `taskId`, `expectedVersion`을 기존 typed command에 넘기고 Main의
  `WorkspaceService`가 owning project의 Active 상태와 ID 일치, Task optimistic version을 다시 검증한다.
  state와 project-scoped `task.create`·`task.update` outbox는 기존 단일 SQLCipher transaction에서 함께
  commit된다. global drag는 같은 task의 canonical status만 바꾸며 project 사이 reassignment는 지원하지
  않는다. 이 화면은 Project Chat `/todo`나 agent tool에 all-project context를 추가하지 않으며 agent read와
  action proposal은 계속 현재 Active project에만 묶인다. 따라서 workspace/task schema migration 없이 기존
  project Board와 agent context가 같은 canonical task 변경을 다음 snapshot에서 읽는다.
- Board surface는 content pane의 가로 overflow를 풀지 않는다. 대신 `kanban-workspace`가 사용 가능한
  inline width를 100% 소유하고 다섯 column을 일반 desktop 폭에서 같은 비율로 축소해 한 화면에 표시한다.
  실제 Board 영역이 820px보다 좁아질 때만 각 column의 156px readable floor를 적용하며, focus 가능한
  `kanban-board` 자체가 `overflow-x: auto`와 contained overscroll의 유일한 가로 scroll owner가 된다.
  따라서 넓은 창에서는 불필요한 scrollbar가 없고, 최소 창·큰 글꼴·넓은 project sidebar 조합에서도
  마지막 column이 잘리지 않고 trackpad·mouse·keyboard로 접근 가능하다. Board header, filter와 composer는
  viewport가 아니라 workspace container width를 기준으로 2열과 1열로 재배치한다. macOS Electron geometry
  smoke는 1440px 창의 기본·최대 sidebar에서 5열 무-scroll fit을, 1060px·Extra Large 조합에서는 실제
  `scrollLeft` 이동과 마지막 `Done` column 노출을 검증한다.
- Board 설정은 Project version, task 수정·이동·Delete·restore는 Task version으로 optimistic
  conflict를 검사한다. Main의 `WorkspaceService`만 persisted snapshot을 바꾸며 각각
  `project.board.update`, `task.update`, `task.archive`, `task.restore` outbox command를 같은 SQLCipher
  transaction에 남긴다.
- 카드의 `Delete`는 hard delete가 아니라 `archivedAt`과 새 entity version을 남기는 복원 가능한
  soft delete다. 확인을 통과한 task는 기본 Board에서 빠지고 `Task trash`에 나타나며 `Restore`로 같은
  UUID를 되살린다. 저장·sync 호환성을 위해 내부 command 이름은 `task.archive`·`task.restore`를
  유지한다. 기본 Board와 Project Chat model context에는 active task만 들어가며 Task trash의 task는
  명시적으로 복원하기 전까지 제외한다. 영구 삭제 command는 제공하지 않는다.
- WIP limit은 현재 column의 전체 active task 수로 계산하는 시각적 경고다. filter 결과만 세거나
  이동을 막지 않는다. 임의 column 추가·삭제, column 내부 수동 ranking, saved view와 bulk edit는
  후속 범위다.
- Project Chat의 `/todo`는 외부 Codex `SKILL.md`가 아니라 앱에 함께 배포되는 command routing
  metadata다. Main이 NFKC-normalized exact `/todo` prefix와 `help | add | list | done | move` operation만
  다시 파싱하고 project/session ID는 인자에서 받지 않는다. 일반 자연어와 slash 입력 모두 active project의
  같은 bounded Board context와 `task.create`·`task.update` proposal을 사용하며 Apply gate,
  `expectedVersion`, idempotent action claim을 우회하지 않는다. ambiguous task·column과 equivalent active
  duplicate는 mutation 없이 확인하거나 기존 task를 안내한다. `task.create`의 description·priority·due
  date·label은 Apply 카드에 모두 표시해 숨은 mutation이 없게 하며, due date는 형식뿐 아니라 실제 존재하는
  calendar date인지 structured response boundary에서 검증한다. action description은 모델 출력에서 3,200자로
  제한하고 전체 serialized command도 SQLCipher `command_json`의 4,096자 한도 이내인지 저장 전에 검증해
  schema-valid proposal이 persistence 단계에서 사라지지 않게 한다. To-do checkbox의 완료·재개도 현재 Task
  version을 `expectedVersion`으로 전달하고 stale update는 기존 optimistic conflict 경계에서 중단한다.

### 로컬 통합 검색 경계

Workspace의 `Search`는 모든 non-Trash project를 대상으로 Project Chat, Research Notes, Experiments,
Goal & Metrics, Board, Literature와 Repository 결과를 module별 group/tab으로 돌려주는 로컬 read model이다.
Research Notes 안에는 같은 contract를 `research-notes` category와 현재 project scope로 고정한 compact
검색을 둔다. query는 256자, 응답은 category당 기본 20건·최대 50건으로 제한하며 title·snippet·project,
matched field와 typed navigation target만 Renderer에 보낸다. 결과를 누르면 active project와 해당 tab을
열고 Chat message, note path, repository file, experiment idea, Board task, Literature record의 exact target을
request ID로 선택·scroll한다. 프로젝트 또는 scope를 전환하면 generation과 scope key가 이전 비동기 응답을
무효화하므로 A 프로젝트 결과가 B 프로젝트 화면에 나타나지 않는다. Archived 결과는 검색에는 포함하지만
mutation 화면을 바로 열지 않고 Project Settings의 restore 동선으로 보낸다.

`SearchService`는 먼저 versioned workspace snapshot으로 project scope와 Board·Objective 결과를 만든 뒤
세 개의 독립 source를 병렬 호출한다. Goal & Metrics는 화면이 실제로 여는 project별 최신 Objective만
색인하고 goal·metric·evaluator·dataset뿐 아니라 baseline·target·guardrail·budget·stop policy도 찾는다.
클릭 전 current Objective ID/version을 다시 확인해 검색 뒤 새 version이 생겼다면 최신 내용을 잘못 열지 않고
재검색을 안내한다. Application source는 SQLCipher의 Project Chat message/session title, Experiment idea와
bounded metric point summary, Literature metadata를 project-isolated bounded SQL로 검색한다. metric은
series/key/name·value/unit·trial ID·aggregation·baseline/target·source/sequence를 찾되 raw dataset·hash를
result에 노출하지 않는다. Literature는 DOI·citation key·publication year·citation count도 포함한다.
SQLite parameter 상한을 넘는 128개 초과 project scope는 chunking하고 뒤쪽 project 결과와 partial failure를
보존한다. Research
Notes source는 `inspectReadyWorkspace`와 `readReadyMarkdown`이라는 별도 read-only path만 사용한다. 이 경로는
folder/template 생성, rename reconciliation, Literature projection 또는 binding 저장을 일으키지 않는다.
global scan은 project별 file queue를 round-robin하여 첫 Vault가 전체 예산을 독점하지 못하게 하고, 총
240개 Markdown·8,000,000자·file당 160,000자 안에서만 읽는다. hit ID에는 path 대신 SHA-256 digest를 쓰며
Renderer target에도 project-relative 검증 path만 전달한다.

Repository source는 일반 snapshot처럼 status·branch·history를 계산하지 않고, Git service의 read-only
`searchFiles`로 tracked/untracked file index만 bounded 조회한다. archived project는 이 검색 전용 reader에서
허용하지만 Trash는 Main에서 거절한다. file index는 20,000 entry·8 MiB output 한도와 `truncated/incomplete`
상태를 갖고, absolute worktree path·Git diff·본문은 응답이나 검색 DB에 들어가지 않는다. Research Notes와
Repository의 긴 정상 path도 fixed-length SHA-256 hit ID로 바꿔 response ID 한도를 넘지 않는다.

각 source의 UI await budget은 5초이며 Main이 absolute deadline과 AbortSignal을 SQL chunk, Vault
inspection/read와 Git subprocess까지 전달한다. timeout 시 50ms cooperative grace 동안 source가 지금까지
모은 hit를 `incomplete` partial result로 반환할 수 있다. OS/file provider가 취소를 무시하면 이미 시작한
read-only promise 하나만 background에 남기고 source-local pending guard가 그것이 settle되기 전 후속 검색의
새 I/O를 fail closed해 반복 검색이 느린 mount 작업을 중첩하지 않게 한다. timeout, busy source, 일부 project
실패, 전체 source 실패와 scan budget 소진은 category별 `incomplete`, `truncated`, bounded
`unavailableReason`으로 표시한다. 내부 exception, Vault path, repository root와 query 본문을 오류 문자열로
노출하지 않는다. 한 source 장애는 다른 category 결과를 없애지 않으며 0건과 검색 불완전을 UI에서 구분한다.
검색 결과·index·본문은 SQLCipher, Hosted Sync, outbox와 telemetry에 새로 저장하지 않고 매 query마다 현재
로컬 authoritative source에서 읽는다.

### Project Chat 흐름과 소유권

```mermaid
flowchart LR
  ChatUI["Project Chat UI\nsession rail·safe Markdown/KaTeX"]
  ChatIPC["typed Chat IPC\nproject-scoped DTO"]
  ChatService["ProjectChatService\ndurable attempt router"]
  AgentRuntime["GOSU Agent Runtime\nrun graph·context plan·working memory"]
  ToolGateway["ProjectAgentToolSession\nproject-bound capabilities"]
  Codex["isolated Codex App Server\nstructured final response"]
  Vault["project Research Notes\nopaque IDs·bounded chunks"]
  Attachments["ephemeral turn attachments\nopaque IDs·bounded units·normalized images"]
  Literature["LiteratureService\npolicy-v3·HF additive discovery"]
  LiteratureDB["Literature SQLCipher tables"]
  Web["Codex first-party web search\ncached/live"]
  SSH["SSH broker\nworkspace grant·Allow once/trusted audit"]
  ChatDB["SQLCipher chat tables\nsessions·messages·attempts·queue·receipts"]
  Approval["Apply action\nclaim→workspace command"]
  Workspace["WorkspaceService\nversion·project validation"]

  ChatUI --> ChatIPC --> ChatService --> AgentRuntime --> ChatDB
  AgentRuntime --> ChatService
  ChatService --> Codex
  Codex -->|"item/tool/call"| ToolGateway
  ToolGateway -->|"Board·Objective"| Workspace
  ToolGateway -->|"explicit project grant"| Vault
  Attachments -->|"claimed project+session capability"| ToolGateway
  ToolGateway -->|"explicit user command"| Literature --> LiteratureDB
  ToolGateway -->|"project grant·exact approved argv"| SSH
  Codex -->|"profile web_search config"| Web
  Codex --> ChatService --> ChatDB
  ChatDB --> ChatUI
  ChatUI --> Approval --> Workspace
  Workspace --> ChatDB
```

- `project_chat_sessions`, `project_chat_session_messages`, `project_chat_messages`,
  `project_chat_attempts`, `project_chat_actions`, `project_chat_profiles`,
  `project_chat_instruction_revisions`는 Project Chat 모듈이
  소유한다. 대화를
  `local_workspace_state` JSON이나 workspace sync outbox에 넣지 않는다. 따라서 긴 대화가
  Project·Task·Objective snapshot의 크기와 delivery 순서에 영향을 주지 않는다.
- GOSU Agent Runtime phase 1은 Hermes runtime을 복제하거나 그 session DB를 가져오지 않는다. GOSU가
  `project_agent_runs`, `project_agent_nodes`, `project_agent_working_memory`를 SQLCipher에서 직접 소유하고,
  Codex와 Hermes는 provider-neutral node의 executor일 뿐이다. 모든 새 Project Chat attempt는 정확히 하나의
  coordinator node를 가진 run으로 투영되고 `starting → running → terminal` 상태를 따른다. 명시적인
  Codex→Hermes 위임 receipt는 같은 run의 `delegated-worker` child node로 기록한다. 앱 재시작 때 남아 있는
  starting/running run과 node는 interrupted로 봉인하며 기존 chat attempt의 재시작 reconciliation과 별개로
  완료된 것처럼 가장하지 않는다. legacy snapshot에는 이 필드가 없어도 계속 읽힌다.
- phase 1 context manager는 매 turn마다 이전 40개 message·24,000자를 그대로 되풀이하지 않는다. 최근
  complete message는 최대 12개·직렬화 10,000자로 제한하고, 더 오래된 성공 turn은 session별 최대 8개의
  deterministic `{userRequest,outcome,attemptId}` working-memory excerpt로 보완한다. 최근 원문에 이미 포함된
  attempt의 memory entry는 중복 주입하지 않는다. memory는 모델이 쓴 사실 DB가 아니라 untrusted conversation
  evidence이므로 최신 원문과 충돌하면 최신 원문이 우선하고 project 사실의 증거로 승격하지 않는다. 각 run은
  포함 segment, 최근/생략 message 수, memory revision·문자 수와 기존 24,000자 기준 대비 절감 문자를
  `contextPlan`에 고정해 UI와 회귀 테스트에서 확인할 수 있다. 실패·중단 turn은 memory에 들어가지 않는다.
  Project Chat은 active run을 `Agent process` live panel로 표시하고 완료 응답마다 접을 수 있는 상세 activity를
  남긴다. 여기에는 context message/memory/절감 수치, coordinator·delegated-worker provider와 상태, bounded task,
  결과 요약, 짧은 node/invocation/parent 식별자가 포함된다. 이는 검증 가능한 orchestration telemetry이며 provider의
  비공개 chain-of-thought를 노출하거나 추측하지 않는다.
- 이번 phase의 실행 graph는 coordinator와 이미 존재하는 bounded Hermes delegation을 영속화하는 기반이다.
  autonomous planner, 병렬 worker fan-out, semantic memory curator, reusable skill promotion은 후속 phase이며,
  이들이 들어와도 GOSU tool broker의 project scope, approval, evidence receipt와 Stop/restart 경계를 우회해서는
  안 된다. 단순 질문은 coordinator 한 개의 fast path를 계속 사용해 불필요한 agent 호출을 만들지 않는다.
  `pnpm test:agent-runtime`은 context 축소·memory 중복 제거·coordinator 상태 전이·Hermes child delegation·완료
  memory의 다음 turn 재주입을 하나의 고정 regression으로 검증하며, 일반 `pnpm test`와 CI의 별도 named gate에
  모두 포함된다. 이후 Agent Runtime 동작 변경에는 이 gate를 통과하는 회귀 test가 반드시 함께 추가되어야 한다.
- 각 project는 정확히 하나의 durable default root session marker를 갖는다. active project 존재·Archive·
  Trash 상태를 Main에서 먼저 검증한 뒤 chat을 처음 조회할 때 default를 idempotent하게 만들므로 잘못된
  project UUID가 orphan session을 만들 수 없다. legacy `snapshot(projectId)`·send·cancel caller는 이 default로
  routing하며, 기존 message와 attempt는 migration에서 순서를 잃지 않고 같은 membership으로 backfill한다.
  초기 default title은 `Project chat`이고 일반 session처럼 rename할 수 있지만 `isDefault`, project identity,
  parent lineage와 생성 identity는 update/delete trigger로 바꿀 수 없다. 현재 catalog는 정확히 하나의
  default를 가져야 한다.
- `New chat`은 history가 빈 독립 root를 만들고 같은 project의 root title과 충돌하면 `New chat 2`처럼
  번호를 붙인다. branch는 `parentSessionId`와 `branchedFromMessageId`를 함께 고정하고, source session의
  terminal `complete` message까지 기존 immutable message membership만 하나의 transaction에서 연결한다.
  message 본문·action·attempt·model provenance를 복제하지 않으며 branch 이후 source history도 child에
  유입되지 않는다. source session에 속하지 않은 message, 다른 project, active/incomplete point, ordinal
  gap·cycle·손상된 lineage는 fail closed한다. 최대 session 100개, branch depth 32, inherited message
  5,000개와 trim된 title 120자 제한을 적용한다.
- branch transaction은 먼저 `Branch · <source title>` 형태의 deterministic placeholder를 commit해 대화
  생성을 모델 가용성과 분리한다. 그 뒤 별도의 best-effort title job이 paginated `model/list`의 opaque
  catalog에서 provider가 표시한 default model과 그 model이 광고한 첫 reasoning option을 그대로 사용한다.
  App Server catalog에는 속도·비용 순위가 없으므로 model 이름에서 `mini`, `fast`, `low`를 추측하거나
  하드코딩하지 않는다. 각 title job은 서로 독립적으로 실행되어 하나의 느린 catalog/thread가 다음 branch의
  제목을 head-of-line block하지 않는다. 단일 10초 end-to-end deadline은 catalog·session snapshot·project
  directory·thread/start·turn/start/completion·CAS rename 전체를 감싼다. title turn은 web·dynamic tool 없이
  low verbosity와 strict JSON schema, bounded recent branch context만 사용한다. timeout 뒤 늦게 생긴 thread는
  turn을 시작하지 않고 release하며, 이미 시작된 turn의 opaque ID가 늦게 오면 interrupt 후 cleanup한다.
  실제 resolved model·catalog hash·reasoning ID는 session title provenance에 남긴다. compare-and-set rename은
  사용자가 그 사이 수동으로 바꾼 제목을 절대 덮지 않으며, 실패·timeout·재연결 불가도 이미 생성된 branch를
  rollback하지 않는다. `session.updated` event는 transcript, draft, scroll과 unread state를 재hydrate하지 않고
  catalog metadata만 단조롭게 갱신한다.
- fixed IPC는 session list, selected-session snapshot, root create, completed-message branch와 rename만
  노출한다. rail은 모든 session을 동시에 표시하고 default·independent·branched·active 상태, branch parent와
  생성 시각을 보여 준다. 각 행의 rename action과 rail 상단의 선택-session action은 같은 inline editor를
  열며 현재 제목을 선택한 상태로 시작한다. 제목은 trim 후 1–120자로 검증하고 Enter/Save로 저장,
  Escape/Cancel로 취소한다. IME composition 중 Enter·Escape는 command로 해석하지 않고 실패 시 입력값과
  editor·입력 focus를 유지하며, 성공·취소 뒤에는 같은 session 행으로 keyboard focus를 복원한다.
  저장 성공은 project-scoped SQLCipher session row와 Renderer의 session catalog·
  snapshot metadata만 갱신하므로 session ID, transcript, unsent draft, scroll, unread 표시를 다시
  hydrate하거나 초기화하지 않는다. 선택 session별 React key와 generation guard가 retry·scroll·늦게 도착한
  hydration을 격리한다. keyed `ProjectChatView`보다 오래 사는 Desktop shell이 unsent composer draft를
  project+session key의 Renderer volatile memory에만 보존해 session을 오간 뒤 복원하고 성공한 send 뒤
  해당 값만 지운다. 같은 소유자가 transcript의 finite nonnegative `scrollTop`도 project+session별 volatile
  map에 보존한다. 새 assistant response의 exact message ID도 project+session별 volatile map에 보존해
  inactive session에서 도착하거나 다른 session을 왕복해도 unread identity가 사라지거나 섞이지 않는다.
  chat 재진입 시 저장값이 있으면 viewport 범위로 clamp해 paint 전에 복원하고, 처음 여는
  session이면 실제 snapshot hydration 뒤 paint 전에 바로 bottom에서 시작한다. loading placeholder나 실패한
  hydration의 `0`은 위치로 저장하지 않는다. SQLCipher·Hosted Sync에는 이 UI 위치를 저장하지 않는다.
  같은 project+session의 parent rerender나 model·reasoning 변경은 typed draft,
  retry provenance와 Advanced 열림 상태를 바꾸지 않고, 실제 project/session identity 전환에서만 새 draft를
  hydrate하고 retry·Advanced를 초기화한다. 이 draft는 SQLCipher·Hosted Sync 원본이 아니다.
  snapshot·event·cancel·retry·action도
  project+session composite key와 membership을 다시 검사해 다른 session이나 project의 상태가 섞이지
  않게 한다.
- Project Chat은 다른 workspace 화면과 분리된 compact content layout을 사용한다. active project의 chat은
  공통 page heading과 그 안의 `New project` action을 렌더링하지 않고 internal chat toolbar와 session rail이
  content 상단부터 시작한다. 제거된 heading 높이도 chat viewport에 돌려준다. 새 project 생성은 titlebar에서
  다시 열 수 있는 Projects sidebar의 `＋`에서 계속 제공하며 Board·Repository·Settings 등 다른 surface는
  공통 heading과 action을 유지한다. session rail은 160–360px 범위의 독립 resize separator를 제공하고
  `gosu:project-chat-layout:v1` local preference로 마지막 폭, session rail 접힘, chat detail 접힘을 재시작
  뒤에도 복원한다. 이전 v1 값에 두 boolean이 없으면 펼침으로 migration한다. 이 값들은 Mac의 renderer
  layout 정보이며 SQLCipher·Hosted Sync·agent context에는 들어가지 않는다. session rail과 chat detail은
  서로 독립적으로 접을 수 있고 active turn 중에도 layout toggle은 잠기지 않는다. 접힌 session rail은 넓은
  layout에서 44px restore rail만 남기고 list·rename·resize handle을 keyboard와 accessibility tree에서도
  제외한다. 1,180px 이하에서는 44px 높이 restore strip으로 바뀐다. 접힌 chat detail은 model·reasoning,
  selection warning, 연결 server 수 또는 SSH setup 상태와 `Show details`만 한 줄에 남기고 model selector,
  resource card와 Advanced controls는 공간을 차지하지 않는다. detail toggle은 접힘 전후 같은 DOM node를
  유지해 keyboard focus를 잃지 않고, 최대 120자 project name 영역은 220px 안에서 shrink·ellipsis되어 restore
  action을 shell 밖으로 밀지 못한다. composer의 authoritative warning과 conversation control은 계속 보인다.
  transcript row는 `minmax(0, 1fr)`로 실제 남은 높이를 소유해 detail을 접으면 대화
  공간을 즉시 돌려받고 composer가 shell 밖으로 밀리지 않는다. 1,180px 이하에서는 두 저장 폭을
  억지로 축소해 drag origin·`aria-valuenow`와 실제 handle 위치를 어긋나게 하지 않고, session rail을
  horizontal row로 전환하며 해당 resize handle을 숨긴다. 따라서 860px mobile navigation 경계 바로 위에서도
  최대 Projects sidebar와 최대 Sessions rail이 나란히 chat 본문을 잠식하지 않는다. chat workspace에는 desktop
  최대 폭·높이 cap을 두지 않아 현재 window를 사용하며 transcript 안쪽 여백도 제한한다. message card는
  넓은 코드·표·수식을 위해 가용 폭의 96%, 최대 1,180px까지 확장하되 작은 window에서는 기존 horizontal
  session rail breakpoint를 유지한다. 완료된 최신 message가 transcript보다 길면 container-local scroll을
  그 message의 header와 top inset에 맞춰 시작해 toolbar 아래에서 첫 줄이 잘리지 않게 한다. active turn 시작 시
  bottom의 thinking state를 보여준다. terminal event가 새 snapshot보다 먼저 와도 stale user message로
  이동하지 않고 새 assistant message ID를 기다리며, 무관한 parent rerender는 현재 scroll을 바꾸지 않는다.
  transcript는 CSS smooth behavior를 사용하지 않아 restore·bottom·latest-message anchor가 과거 history를
  위에서 아래로 통과하는 애니메이션으로 보이지 않는다.
  사용자가 transcript bottom에서 96px 이내를 보고 있을 때만 새 assistant content를 자동 follow한다.
  그보다 위의 history를 읽는 동안에는 streaming update와 새 terminal message가 현재 viewport를 움직이지
  않고 composer 바로 위에 `New GOSU message` 알림을 표시한다. 알림은 새 응답의 시작점으로 즉시 이동하고,
  해당 assistant article에 focus한다. 이후 사용자가 보낸 message가 더 아래 있어도 unread 알림은 그 user
  message나 bottom으로 fallback하지 않는다. transcript 우하단의 `Latest` button은 항상 실제 bottom으로
  즉시 이동한다. unread identity는 terminal turn ID와 assistant message의 turn ID를 대조해 만들고 duplicate·
  stale·out-of-order event에 idempotent하며, 실제 응답을 보거나 near-bottom에 도달했을 때만 acknowledge한다.
  다른 surface의 공통 spacing은 이 chat 전용 class의 영향을 받지 않는다.
- 실행 소유권은 project가 아니라 `projectId + sessionId`다. 같은 project의 서로 다른 session은 동시에
  Codex 응답을 생성할 수 있고 rail의 각 session에 독립 active indicator가 표시된다. 같은 session에는 항상
  하나의 starting/running turn만 허용해 그 session 안의 visible history와 queue 순서를 보존한다. 앱 전체의
  live session turn은 4개로 제한해 Codex child·attachment·SSH capability가 무제한 증식하지 않게 하며, 남은
  session은 자기 queue에서 기다린다. Stop·Run now·event·snapshot·draft·scroll·unread와 transport revoke도
  composite session key로 routing되어 다른 session의 실행을 취소하거나 잠금을 풀지 않는다. project
  Archive·Trash·Empty Trash, project-shared profile mutation처럼 project 전체 의미가 바뀌는 command만 모든
  session의 activity를 lifecycle gate로 확인한다.
- project profile은 provider가 발견한 nullable opaque Codex collaboration mode ID,
  `auto`·`none`·`friendly`·`pragmatic` personality, `auto`·`low`·`medium`·`high` native verbosity,
  `disabled`·`cached`·`live` web search mode, `project`·`board`·`objective` context scope, nullable
  project-local Research Notes binding grant와 최대 4,000자의 custom instruction을 소유한다. web search 기본값은
  `cached`이며 profile migration과 attempt row에도 실제 turn 설정을 보존한다. v0.6의
  `context`·`planner`·`reviewer`와 `concise`·`standard`·`deep` column은
  migration·과거 receipt 판독을 위해 남기되 새 UI의 harness 원본으로 사용하지 않는다.
  Settings의 저장은 profile version CAS를 사용하고 stale edit는 `chat_profile_conflict`로 끝난다.
  Research Notes grant 저장 시 Main이 active project의 opaque binding ID와 고정 display name을 다시 대조한다.
  project folder나 Vault가 바뀌면 기존 grant는 inactive이며 자동 이전하지 않는다. active turn 중 profile
  변경은 거절해 한 turn의 capability snapshot을 고정한다. Renderer reload 때도 Main의 현재 project
  Research Notes workspace를 typed IPC로 hydrate하며 stale hydration response가 이후의 새 Vault 선택이나
  project 전환을 덮지 못하도록 generation guard를 둔다. Chat composer의
  capability status는 grant가 없거나 inactive일 때 project AI Agent Settings로 가는 `Authorize…` 동선을
  제공한다. Research Notes 화면도 진입 시 현재 active project의 암호화 profile을 hydrate하고, project 이름과
  `authorized`·`not authorized`·`inactive`·`checking`·`unavailable` 상태를 함께 표시한다. 사용자는 이
  화면에서 현재 folder를 직접 승인하거나 기존 grant를 즉시 해제할 수 있고, 같은 project의 AI Agent
  Settings로 바로 이동할 수 있다. 직접 변경은 storage-only profile field를 spread하지 않고 허용된 설정
  field를 명시적으로 보존한 CAS command만 전송한다. 승인은 Main이 확인한 exact project binding ID·이름과
  active turn 없음이 모두 충족될 때만 가능하며, 저장 직전에 선택 Vault와 project folder의 canonical root,
  device·inode identity 및 ownership marker도
  다시 검증한다. 해제는 Vault가 사라졌거나 상태 확인이 실패했어도 가능하다. Notes 진입 hydration이 진행
  중이면 direct action을 잠근다. Hydration busy state는 단일 current ID가 아니라 project별 in-flight set으로
  추적해 다른 project의 동시에 끝나는 snapshot이 이 잠금을 풀 수 없게 한다. local profile mutation은 진행
  중인 hydration token을 무효화하며, Renderer의 snapshot merge도 profile version을 단조롭게 유지하므로
  지연된 이전 snapshot이 새 grant를 화면에서 되돌릴 수 없다.
  authoritative status를 아직 확인 중이거나 IPC 오류로 확인하지 못했는데 저장된 grant가 있으면 chat
  send를 차단해 Main의 숨은 기존 capability가 UI 표시와 다르게 사용되지 않게 한다. Agent Settings의
  grant·revoke button은 profile 저장 전 local draft임을 label로 표시하고, Research Notes의 direct action은
  성공한 CAS 저장 결과를 즉시 상태에 반영한다.
  custom instruction 변경은 append-only revision과 content hash를 남기며 이전 attempt의 의미를
  덮어쓰지 않는다. Chat 화면의 per-turn override는 profile을 수정하지 않고 해당 attempt에만 고정된다.
- prompt assembly는 변경 가능한 문자열 연결을 Renderer에 두지 않는다. Main은 versioned immutable
  GOSU product policy만 developer instruction으로 만들고, Codex의 Default·Plan 동작과 답변 verbosity를
  자체 prompt로 재구현하지 않는다. custom project preference, project context, visible history와 user
  message는 모두 별도의 untrusted JSON envelope에 넣는다.
  context는 최대 48,000자, history는 최근 40개·24,000자, assembled prompt는 160,000자로 제한한다.
  policy·legacy compatibility·custom·context·history·message·최종 prompt의 SHA-256과
  profile/instruction revision, workspace revision, dynamic tool catalog hash, 실제 활성 Research Notes binding ID,
  Codex mode catalog hash, 선택 mode·personality·verbosity·effective reasoning, configured web search mode와
  truncation 여부를 attempt provenance assembly v3와 attempt row에 기록한다. 이전 assembly v1·v2
  provenance는 계속 읽을 수 있다.
- 기존 reviewer profile은 migration 호환 경로에서만 조언 전용으로 유지한다. 모델이 구조화 action을
  반환하더라도 service가 `actions=[]`로 강제하고 `researchNote` create도 거부한다. reviewer prompt는
  `researchNote: none`을 요구하며 위반 시 server-owned not-saved receipt를 남긴다. 사용자가 새 native mode를 명시하면 legacy reviewer를
  벗어난다. native mode를 포함한 모든 turn은 동일한 read-only·no-shell·no-browser·no-subagent 경계를
  사용하고, profile의 Codex first-party web search mode만 general network 금지의 좁은 예외다. GOSU typed
  project tool과 기본 `Allow once` 또는 exact trusted audit를 요구하는 Main-process SSH broker도 명시적
  capability 예외이며, SSH
  실행이 Codex child 자체에 shell·network 권한을 부여하지는 않는다. web search는 dynamic tool이 아니라
  `thread/start.config.web_search` 설정이다.
- 현재 `gosu_project` namespace는 항상 `read_workspace`, SSH workspace list/resource-read,
  workspace-mode file list/read/write와 command run을 제공한다. explicit
  literature-search command가 있는 non-legacy turn에는 `search_literature`, 승인된 Vault가 있으면
  `list_local_notes`·`read_local_note`, 현재 turn 연구 파일이 첨부됐으면 `list_turn_attachments`·
  `read_turn_attachment_text`가 추가된다. legacy reviewer에는 Literature mutation tool이 없다. Research Notes
  create는 dynamic tool catalog에 없고 required structured final response를 검증한 Main만 수행한다.
  `read_workspace`는 active project ID를 handler closure에 묶어 Board와 최신 Objective만 반환하며
  모델 argument로 project ID를 받지 않는다. repository는 credential·URL·SSH 주소를 제외한 canonical
  `owner/repository` label만 agent context에 포함한다. Research Notes list/read tool은 profile의 read grant가
  현재 project binding과 일치할 때만 catalog에 나타난다. list는 opaque note ID와 display title만 반환하고 read는 호출당
  24,000자, ephemeral turn당 합계 96,000자로 제한한다. attachment text read는 호출당 8 unit·24,000자와
  turn당 60,000자다. 동시 호출은 read 전에 budget을 reserve하고 모든 tool 결과는 직렬화 후 48,000자
  안으로 축약한다. note/attachment/web text와 image·tool result는 untrusted evidence이며 그 안의 지시를
  실행하지 않는다.
- SSH workspace list tool은 active project의 grant만 읽어 opaque grant ID, connection label과 permission
  mode를 반환한다. grant가 없을 때는 bounded `registeredConnectionCount`와
  `no_registered_connections|workspace_grant_required` setup state만 반환해 모델이 transport 실패와 승인
  누락을 혼동하지 않게 한다. global registry의 ungranted connection label/profile, 다른 project의 grant,
  actual target·user·root는 모델에 노출하지 않는다. file tool은 workspace-mode grant만 허용하고
  helper command·remote root·raw SSH wrapper를 모델에 돌려주지 않으며 strict receipt의 path·content/hash·
  offset·size를 원래 request와 다시 대조한다. command tool의
  resource-read는 grant ID만 받고 active project의 grant와 connection을 Main에서 재검증해 정규화된
  CPU/RAM/GPU snapshot만 반환한다. project·session·attempt·turn·tool-call·connection binding은
  모델 argument가 아니라 Main이 주입하고 grant를 다시 조회한다. 최대 20개 argument는 별도 token으로
  검증하며 absolute executable, relative workspace subdirectory와 mode별 inspect/test/build/experiment allowlist를
  적용한다. raw shell·inline interpreter eval, privilege escalation, nested transport·transfer, TTY·forwarding과
  unattended execution은 approval UI 전에 fail closed한다.
- 기본 Allow-once approval center는 viewport 중앙의 blocking alert dialog로 actual target, ROOT/HIGH RISK, connection label,
  project/session, workspace root/cwd, operation class와 exact remote preview를 표시한다. request queue에서는
  한 번에 하나만 보여 주며 긴 preview만 독립적으로 scroll하고 sticky action bar의 `Allow once`·Deny와
  live countdown은 계속 보인다. dialog가 열리면 같은 Renderer의 background workspace control은 inert가
  되고 keyboard focus를 dialog 안에 가두며, Escape는 Deny로 처리하고 초기 focus도 Deny에 둔다. 닫힐
  때는 dialog 전에 focus된 control로 scroll 이동 없이 focus를 복원한다. 기본
  decision window는 5분이다. 전체 pending 16개·turn당 4개, 전체 active와 trusted reservation을 합쳐
  4개·turn당 1개다. Renderer가 event를 놓치거나 Project Chat이 remount돼도 exact project+session을 받는
  pending-query IPC가 Main의 동일 request를 hydrate한다. query는 다른 project/session request를 반환하지
  않으며 이미 resolve된 ID의 bounded in-memory tombstone을 확인해 stale response가 allowed·denied·expired·
  cancelled dialog를 되살리지 못하게 한다. event 자체도 tombstone을 지우지 않으며 현재 visible
  project+session과 일치하지 않는 새 request는 UI에 넣지 않고 exact approval ID만 Deny한다. pending
  request의 authoritative state는 Main-process memory에 있고 presentation queue·countdown·resolved-ID
  tombstone은 Renderer의 volatile state/ref에 있다. 이 Allow-once 상태는 SQLCipher·Hosted
  Sync·outbox·telemetry에 persist 또는 sync하지 않는다. trusted path는 dialog state를 만들지 않고 실행 전
  bounded append-only audit만 별도로 저장한다. turn
  terminal/cancel, connection 삭제와 앱 종료는 pending 요청을 거절하고 active local
  SSH transport를 abort한다. 화면에서 project/session을 벗어나면 strict project/session payload만 받는
  cancellation-only `gosu:ssh:cancel-scope` IPC와 Project Chat revoke IPC가 Main의 pending·active transport와
  해당 live agent tool session을 찾아 attempt-scoped abort signal과 scope epoch를 폐기한다. revoke epoch는
  storage 검증보다 먼저 in-memory capability와 transport를 폐기한다. explicit session epoch와 revoke-all
  project epoch를 분리해 이전 session A의 revoke가 새 session B를 잘못 막지 않으면서, send의 첫 await 전에
  비교할 generation을 바꾸므로 이미 보이는 pending·active
  command뿐 아니라 connection lookup 중인 요청과 전환 race 뒤의 future SSH tool call도 fail closed하며,
  SSH 밖의 Codex turn은 계속 진행한다. dynamic tool timeout과 thread revoke는 handler에 AbortSignal을
  전달하고 SSH broker는 이를 connection lookup·pending approval·approved active transport 전체 수명에
  연결한다. approved chain은 runner 실행 직전과 result 채택 직전에 abort 상태를 다시 확인하고,
  single-terminal settlement로 runner가 signal을 무시하거나 늦게 성공해도 cancellation이 최종 결과로
  유지된다. abort·deny·expire·정상 종료마다 listener를 제거하며 timeout 응답을 먼저 보냈더라도 실제
  handler가 settle할 때까지 해당 in-flight capacity를 유지해 zombie 작업이 동시 실행 상한을 우회하지
  못하게 한다. Stop은 project/session lookup과 Codex
  interrupt보다 먼저, terminal notification은 Research Notes delivery settlement와 receipt persistence보다 먼저
  live SSH capability와 transport를 동기적으로 폐기한다. Renderer는 `turn.started` 전 startup 동안 Stop을
  표시하지 않고 project busy 상태만 보여 준다. timeout·output cap·transport failure는 typed error로 끝나 다른
  Project Chat capability를 중단시키지 않지만, local abort 뒤 remote process 종료는 보증하지 않는다.
  Allow-once event·binding·outcome은 memory-only라 restart 후 감사 원본으로 쓸 수 없고, trusted audit도
  raw output이나 remote process completion 증명이 아니라 auto-approval intent metadata다.
- agent가 실제로 읽은 note·attachment text와 App Server가 받아들인 native image는 성공·invalid
  response·중단·실패·turn 등록 실패를 포함한 모든 terminal assistant receipt 끝에 sanitized title 또는
  opaque attachment label, opaque ID prefix, content/source SHA-256, unit range와 excerpt 여부를 남긴다.
  자동 source appendix에는 raw note/attachment body, filename, temporary image path, root/path와 tool
  arguments를 넣지 않는다. 다만 모델이 evidence를 visible reply에 직접 인용·요약하면 그 reply는
  SQLCipher message와 향후 Hosted Sync 대상이다. terminal 경로는 pending note/attachment delivery를 최대
  100ms 동안 bounded settlement한 뒤 App Server의 해당
  thread tool registration을 동기적으로 revoke한다. revoke로 확정된 `uncertain` 결과까지 한 microtask
  안에서 반영한 다음 `Research Notes accessed` appendix를 봉인한다. timeout 뒤 완료된 handler는 note
  result를 Codex로 보내거나 receipt를 뒤늦게 변경할 수 없다. source identity는
  `note ID + content SHA-256` pair이므로 같은 note의 서로 다른 content version을 한 turn에서 읽어도 각각
  보존하고, 동일 version의 여러 excerpt만 하나의 source entry로 합친다.
- completed Project Chat의 valid structured response가 `researchNote: save`를 선언하면 service는 먼저 모든
  App Server dynamic-tool intake와 SSH/Literature/attachment capability를 동기적으로 닫는다. 그 다음 explicit
  `allowAgentMarkdownCreate` capability, active project와 binding을 확인하고 Main-owned create-only writer를
  직접 await한다. 모델은 이 후속 write 결과를 관찰하거나 저장 성공·경로를 주장할 수 없다. Main은
  `artifact ID + relative path + content SHA-256` receipt로 결과를 기억하고 terminal assistant message에
  `Research Notes saved`와 정확한 project-relative path를 server-owned appendix로 붙이고 raw Markdown body와
  Vault root는 넣지 않는다. authorization·stale binding·folder conflict·commit uncertainty는 별도의
  `Research Notes not saved` 또는 unconfirmed 안내로 남긴다. 한 completed turn은 최대 하나의 28,000자
  artifact만 선언할 수 있고 ordinary transient reply는 required `researchNote: none`을 사용한다. invalid,
  interrupted, failed turn은 structured payload를 저장하지 않는다. 이 create-only write는 사용자가 project
  profile에 별도로 준 Markdown-create capability와 이 기본 정책이 승인한 제한적
  local effect이며 일반 Board action의 Apply gate나 generic filesystem write 권한으로 확장되지 않는다.
- create 전 SQLCipher receipt journal은 expected hash를 `staged`로 고정한다. bounded wait 안에 exact
  write/read-back이 확인되면 `committed-unreported → reported`, 시간 안에 확정하지 못하면 `uncertain`으로
  전이한다. restart와 Vault reconnect reconciliation에서 verified-missing은 `abandoned`로 원자 정산하고,
  offline·stale binding·hash mismatch는 `uncertain`에 남긴다. assistant receipt와 상태 전이는 같은
  transaction이며 late exact success가 있으면 `abandoned → committed-unreported → reported`로 promote해
  not-saved 문구를 제거하고 검증된 path를 한 번만 append한다. Markdown body·absolute Vault path는
  journal에 없다.
- tool access는 UI section 자체나 database table 접근이 아니라 module capability다. 현재 구현된
  Board·To-do·Goal & Metrics·승인된 Research Notes list/read, server-owned category-scoped final create, 현재 turn 첨부 연구 파일,
  명시적 additive Literature search와
  active project에 grant된 SSH workspace의 opaque ID·label·mode, 정규화된 resource snapshot과 승인된
  bounded text file list/read/create/expected-hash-checked atomic replacement만 사용할 수 있다. Literature table 전체를 임의
  조회·수정하는 도구는 없고 search receipt만 돌아온다. SSH host resolution·credential·private-key path·
  remote root, Settings·Project Trash는 list tool에 노출하지 않으며 Manuscript·Review·References는
  domain service가 완성되기 전에는 접근 가능한 것처럼 표시하지 않는다. Lecture Studio는 구현됐지만
  별도의 workspace service와 전용 chat을 사용하므로 Project Chat tool catalog에는 넣지 않는다. Board
  쓰기는 기존 `task.create`·`task.update` proposal과 사용자 Apply만 사용하고, SSH workspace file
  operation과 command는 별도의 project grant와 기본 operation별 exact Allow-once 또는 exact trusted
  binding의 audit-before-execute 경계를 사용한다.
- 사용자 메시지를 받으면 Codex를 호출하기 전에 attempt와 user message를 한 transaction으로
  `starting` 상태에 기록한다. `turn/start`가 성공하면 실제 thread ID, turn ID, requested·resolved
  model provenance를 포함해 `running`으로 CAS 전이하고, terminal attempt와 assistant receipt도 한
  transaction으로 저장한다. process 재시작 시 남아 있는 `starting`·`running` attempt는
  `application_interrupted`로 바꾸고 정확히 하나의 보이는 중단 receipt를 만든다.
- 같은 session에 starting/running turn이 있거나 앱 전체 병렬 capacity가 찼으면 새 send는 message와
  model/profile 선택, opaque attachment ID만 `project_chat_queued_turns`에 저장하고 즉시 queued receipt를
  반환한다. session당 최대 50개를 허용하고, DB counter가 enqueue transaction에서 배정한 unique monotonic
  `enqueue_sequence`와 `next` priority로 **각 session 안의** FIFO를 결정한다. scheduler는 queued session을
  순회하면서 최대 4개 capacity를 채우므로 한 session의 긴 응답이 같은 project의 다른 session을 막지 않는다.
  claim은 해당 session에서 한 row만 `starting`으로 원자 전이하며 partial unique index가 session당 active
  queue claim을 하나로 제한한다. `Run now`는 그 session의 선택 row에 `next` priority를 주고 같은 session의
  현재 turn 또는 claim→turn-start 사이 작업만 취소한 뒤 실행하며 다른 session은 계속된다. transient drain
  오류는 bounded backoff로 다시 scheduling하고 tight loop나 중복 실행을 만들지 않는다. queued row는 실행 전
  edit/remove할 수 있고 완료된 과거 message edit는 원문을 바꾸지 않고 그 지점의 branch draft를 만든다.
  앱 시작은 남은 `starting` queue row를 `queued`로 복구하고 queued session을 다시 drain한다. attachment
  capability가 TTL/restart로 사라졌으면 해당 row를 hot-loop하지 않고 user message와 명확한 failed assistant
  receipt로 원자 정산하고 그 session의 다음 row를 계속한다. queue DB에는 file body·원본 path가 없다.
- 실패·중단 attempt는 UI에서 삭제하지 않는다. 사용자는 `Retry this turn`으로 원래 attempt를 명시해
  새 attempt를 만들 수 있고 `retryOfAttemptId`로 lineage를 남긴다. 실패한 partial history는 새 model
  prompt에 완료된 대화처럼 재주입하지 않는다. attempt ID가 없던 이전 버전의 실패 receipt도 바로 앞
  user message와 한 쌍으로 인식해 retry prompt에서 제외한다. 완료된 attempt를 retry하거나 다른
  project의 attempt를 지정하면 거절한다.
- Codex thread는 메시지마다 새 `ephemeral` thread로 만든다. 완료·실패·중단 후 즉시
  `thread/unsubscribe`한다. thread·turn ID는 attempt provenance로는 저장하지만 재시작 후 resume하지
  않는다. 대화 연속성은
  SQLCipher의 보이는 메시지 중 최근 최대 40개·24,000자를 다음 turn에 재주입해 유지한다.
- Codex가 turn을 수락한 뒤 `running` receipt 저장 또는 active router 등록이 실패하면 해당 turn을 먼저
  best-effort interrupt하고 thread를 해제한다. interrupt 확인까지 실패하면 실제 thread·turn·model
  provenance를 보존한 `application_interrupted` receipt를 남겨 숨은 실행을 자동 retry하지 않는다.
- turn prompt에는 현재 프로젝트의 이름·repository 식별자, Board 제목과 canonical status/display
  label mapping, 최대 200개 active Task의 bounded metadata, 최신 Objective와 해당 프로젝트의
  bounded visible history만 선제적으로 넣는다. archived Task는 개수만 제공한다. 다른 프로젝트,
  연구 파일과 secret은 포함하지 않는다. Vault 본문, attachment text·image와 web result는 선제 context에 넣지 않고
  승인·첨부·profile에 의해 허용된 현재 turn capability로 model이 요청한 bounded evidence만 제공한다.
- snapshot은 현재 active turn ID를 포함한다. 창 재생성이나 Renderer reload가 `turn.started` event를
  놓쳐도 Thinking·Stop 상태를 복구하며, load generation과 event sequence guard가 오래된 snapshot이
  새 turn 상태나 action receipt를 덮지 못하게 한다.
- 앱 시작과 사용자의 Reconnect는 Codex account 상태와 전체 동적 model catalog를 다시 확인한다.
  연결이 끊기면 이전 catalog를 폐기하며 Board·Settings·Research Notes는 계속 동작한다. 선택한 model이
  없어졌을 때 다른 model로 조용히 바꾸지 않는다.
- model별 reasoning option과 personality 지원 여부는 paginated `model/list` catalog가 제공한 실제 값만
  사용한다. `supportedReasoningEfforts[].reasoningEffort`의 opaque ID를 option ID와 짧은 label에 그대로
  쓰고 provider description을 label로 바꾸거나 reasoning 목록을 하드코딩·번역·재정렬하지 않는다. 새 local
  profile의 bootstrap preference만 사용자가 요청한 opaque ID `high`로 시작하며, effective default model이
  이를 실제 catalog에서 제공하지 않으면 낮은 값으로 바꾸지 않고 Settings에서 명시적 선택을 요구한다.
  따라서 provider가 새 effort ID를 추가하면 앱 업데이트 없이 catalog 순서대로 나타난다.
  `Model default`는 null이며 `defaultReasoningEffort`는 default 표시만 결정한다. 선택 ID가 refresh 뒤
  사라지거나 다른 model에서 지원되지 않으면 unavailable로 남기고 send를 중단하지 임의 fallback하지
  않는다. requested/resolved model ID, catalog hash, 실제 reasoning ID와 native mode 설정은 각 attempt
  provenance에 기록한다. 사용자가 선택한 model/reasoning이 mode 추천보다 우선하고, mode 추천은 provider
  기본값보다 우선한다. personality 미지원 model에는 Main도 설정을 거절한다.
- Project Chat의 user·assistant 본문은 같은 `react-markdown` pipeline으로 렌더링한다. `remark-gfm` 뒤
  `remark-math`가 `$ ... $` inline math와 독립 줄의 `$$ ... $$` display math marker를 만들고, raw HTML은
  `skipHtml`로 버린다. `rehype-sanitize`가 untrusted tree에서 기본 safe element와 KaTeX 입력용
  `math-inline`·`math-display` marker class만 보존한 **뒤에** bundled `rehype-katex`가 local HTML/MathML을
  생성한다. KaTeX는 `trust: false`, `strict: warn`, `maxExpand: 1000`, `maxSize: 20`으로 제한한다.
  공통 math policy는 문서당 수식 개수·개별·총 TeX 길이도 제한하고 초과 source를 code fallback으로
  보존해 Research Notes와 Chat 사이의 안전 설정이 갈라지지 않게 한다.
  link는 정확한 HTTPS만 Main의 external-browser IPC로 열고 image는 remote fetch 대신 blocked placeholder로
  바꾼다. 깨진 수식은 escaped error/fallback으로 해당 message 안에 남아 transcript 전체를 throw하지
  않으며 원문과 message provenance는 그대로 유지한다. KaTeX CSS와 font는 package에 묶여 theme·font
  scale을 따르고 수식 표시 때문에 외부 network를 요청하지 않는다.
- Codex final은 JSON Schema와 Zod가 함께 검증하는 `reply + actions` 계약이다. v1 action은
  `task.create`와 `task.update`뿐이며 모델이 `projectId`를 정할 수 없다. create proposal은 Board form과
  같은 optional description·priority·ISO due date·label metadata를 운반할 수 있고 Main이 다시 workspace
  input contract로 검증한다.
- 제안 action은 곧바로 실행되지 않는다. 사용자가 Apply하면 SQLCipher row를 `proposed → applying`으로
  원자 claim한 뒤 기존 `WorkspaceService` command를 호출한다. update는 Task의 project 소속과
  optimistic `expectedVersion`을 다시 검사하며 중복 Apply는 새 mutation을 만들지 않는다.
- `applying` 중 process가 중단되면 다음 DB open에서 `application_interrupted`로 표시한다. Board에
  반영됐는지 확인하기 전 자동 retry하지 않아 중복 Task 생성을 막는다.
- Board mutation 성공 뒤 action receipt 저장만 실패한 경우도 `application_interrupted`로 남기고
  `workspaceChanged: true`를 알린다. 이미 반영된 mutation을 거짓 실패로 표시하거나 자동 재시도하지
  않는다.
- IPC DTO와 Zod schema는 `apps/desktop/src/shared/workspace-contracts.ts`, runtime 상태 DTO는
  `apps/desktop/src/shared/runtime-contracts.ts`가 소유한다. Renderer와 Preload는 privileged Main
  구현을 import하지 않고 이 shared contract의 type만 사용한다.
- `WorkspaceService`는 untrusted payload와 persisted snapshot을 Zod로 검증하고 mutation을 직렬화한다.
- 각 task와 objective는 entity version을 가지며 stale command는 conflict로 끝난다. 자동 merge나
  last-write-wins는 수행하지 않는다.
- workspace 전체 revision은 성공한 mutation마다 증가한다. commit이 실패하면 in-memory snapshot도
  갱신하지 않는다. SQL transaction은 persisted revision이 정확히 이전 revision일 때만 snapshot을
  CAS 갱신하므로 예외적으로 두 DB connection이 겹쳐도 같은 revision이 서로를 덮어쓰지 못한다.
- 동일한 revision을 outbox operation의 durable `workspaceRevision`으로 기록하고 pending command는
  이 값으로 정렬한다. 같은 millisecond에 기록된 create→update 또는 save→freeze가 UUID 순서로
  뒤집히지 않는다.
- sequence 도입 전 local row는 open migration에서 기존 insertion `rowid` 순서를 한 번만
  `workspaceRevision` column과 정상 operation JSON에 backfill하고, 이후에는 그 durable 값을 사용한다.
  파싱할 수 없는 operation payload는 삭제하거나 재작성하지 않고 opaque provenance로 그대로 보존한다.
  기존 revision과 row 순서가 모순되는 partial migration은 임의로 재번호를 만들지 않고 queue만
  recovery-required로 막는다. 이때 snapshot과 기존 Board 읽기는 계속 가능하다.
- UI는 outbox payload 전체를 받지 않는다. transaction에서 함께 갱신되는 singleton summary의
  pending count와 latest revision만 고정 크기 IPC로 읽는다. summary 오류는 snapshot 로딩과
  격리되어 정상 project·task·objective를 숨기지 않는다. 앱을 열 때와 summary를 읽을 때 실제
  outbox row에서 singleton을 다시 계산해 누락되거나 불일치하는 legacy summary를 복구한다.
- project별 task 접근을 검사해 다른 project ID를 통한 수정은 거절한다.
- objective freeze는 현재 단일 사용자 로컬 불변성 기능이다. Owner 승인이나 RBAC 승인으로 해석하면
  안 되며, 변경하려면 명시적으로 다음 objective version을 시작해야 한다.
- 이 slice에는 outbox delivery, conflict reconciliation, 로그인·연구실 RBAC가 아직 없다. 따라서
  pending operation을 synced로 표시하지 않는다.

### Foreground LLM 중단 정책

- 모든 사용자 주도 foreground LLM surface는 진행 중일 때 눈에 보이는 중단 action을 제공한다. Project
  Chat과 Lecture Assistant는 `Stop response`, Lecture 초기·재생성은 `Stop generation`, Experiment
  Assistant는 `Stop response`, Literature metadata 정리는 `Stop AI`를 사용한다. 버튼은 해당
  project+session 또는 Studio/project의 현재 turn만 취소하며 다른 project, 다른 session, queued turn과 이미
  완료된 결과를 건드리지 않는다.
- Renderer의 버튼 상태만 끝내지 않고 Main이 소유한 opaque thread+turn을 provider interrupt로 연결한다.
  interrupt 요청과 terminal notification이 경합해도 cancel flag를 commit 직전 다시 검사하고 late success를
  새 결과로 저장하지 않는다. Project Chat의 interrupted receipt와 Experiment의 interrupted user message는
  audit 가능한 실패 provenance로 남고, Lecture는 기존 revision을 유지하며, Literature는 아직 적용하지 않은
  annotation batch를 전혀 쓰지 않는다.
- process 재시작 뒤 메모리에 없는 provider turn을 renderer가 임의 ID로 중단할 수는 없다. 각 module의 기존
  startup reconciliation이 남은 generating/running 상태를 interrupted 또는 failed로 정산하며 자동으로 숨은
  turn을 재시작하지 않는다.

### App-level Settings, 표시 설정과 로컬 기본 template

- Settings는 project module tab이 아니라 workspace와 분리된 app-level surface다. global Settings
  button과 macOS `GOSU > Settings…` (`Command+,`)가 같은 화면을 열고 Done으로 이전 workspace로
  돌아간다. category는 Appearance, Board defaults, Lecture defaults, Projects, Trash, Overleaf, Servers,
  AI Agent로 분리한다.
- appearance(`system`·`dark`·`light`)와 text size(`compact`·`default`·`large`·`extra-large`)는
  schema version이 있는 Renderer `localStorage` preference다. React mount 전에 root dataset에
  적용해 시작 시 theme flash를 줄이고, 변경은 semantic color·font token을 통해 전체 UI에 반영한다.
  네 font preset의 body 기준은 각각 12·14·16·18 px이며 component가 고정된 작은 pixel font를 다시
  도입하지 않고 semantic token을 사용한다.
- 같은 local preference에는 새 project용 default Board title, column 표시명·순서와 WIP limit도
  들어간다. legacy preference에 이 필드가 없거나 유효하지 않으면 display 설정은 보존하고 Board
  template만 GOSU 기본값으로 복구한다.
- 같은 local preference의 `Lecture defaults`는 새 Studio용 `adaptive|custom` notes/slides structure와 세
  document feature의 workspace default·project UUID별 override를 보존한다. custom outline은 ordered section
  row와 `notes-and-slides|notes-only` coverage를 편집한다. project override가 없으면 workspace feature를
  상속하고, output project가 정해진 새 Studio 생성 시 resolved structure/feature의 independent copy가 generation
  brief로 넘어간다. legacy preference에 field가 없거나 strict validation에 실패하면 다른 preference를 보존하고
  해당 structure 또는 feature field만 안전한 기본값으로 복구한다. stale project override는 권한이 아니며 새
  Studio source/output membership은 Main이 다시 검증한다. Settings 저장은 기존 Studio, 생성 중 attempt,
  immutable revision과 Research Notes bundle을 소급 변경하지 않는다.
- Codex default model/reasoning도 같은 Renderer local preference에 저장한다. 초기값은 provider `Auto`와
  native reasoning ID `high`이며 Settings의 AI Agent category에서 live Codex catalog로 선택한다. 이 값은 새
  Project Chat session과 새 Lecture Studio에 scope preference로 한 번 복사되고 Literature·Experiment의
  scope 없는 AI action에는 현재 값이 직접 적용된다. 기존 scope, active/queued attempt와 immutable
  invocation provenance는 Settings 변경으로 다시 쓰지 않는다. 명시적 `Auto`/`Model default`도 별도 stored
  record로 보존해 새 scope와 구분하며, legacy에서 key가 없던 Auto scope는 처음 열 때 새 default를 한 번
  채택한다. catalog에서 model이나 reasoning이 사라지면 UI와 Main 모두 fail closed하고 임의 fallback하지
  않는다.
- OpenClaw·Hermes 선택도 같은 Renderer local preference에 저장한다. OpenClaw는
  `disabled|detect-local`, Hermes는 `disabled|detect-local|connect-local`만 허용하고 legacy·unknown 값이나
  OpenClaw의 연결 mode는 `disabled`로 fail closed한다. `connect-local` 이름은 preference schema 호환을 위해
  유지하지만 packaged app에서는 GOSU와 함께 배포되고 manifest·source revision·전체 tree hash로 검증된
  Hermes runtime을 공식 ACP Project Chat provider로 연결하라는 명시적 요청이다. Main status의 연결 mode는
  `bundled-acp-agent`이며, development-only custom runtime fallback만 `byo-local-acp-agent`로 구분한다.
  인증정보를 GOSU durable storage나 runtime bundle에 복사하지 않는다. Project Chat의 선택
  model/reasoning은 project/session key로 별도 local preference에 저장해 session 전환 뒤 복원하고,
  Hermes를 끄거나 catalog에서 provider가 사라질 때만 명시적으로 reconcile한다. 기본 provider와
  Literature·Lecture 실행 경로는 계속 bundled Codex다.
- template preference 자체는 SQLCipher, Git 또는 Hosted Sync에 저장하지 않는다. project 생성 시 Board
  template을, Lecture Studio 생성 시 structure와 resolved document feature를 그 시점의 독립 copy로 typed Main command에 보내 다시
  검증하고 authoritative configuration에 기록한다. 이후 Settings template 변경은 기존 Board나 Studio를
  바꾸지 않는다.
- appearance와 text size 및 project folder 접힘·hide는 IPC에 넣지 않는다. project rename·Archive·
  Trash·restore는 Workspace SQLCipher가,
  AI Agent profile은 Project Chat SQLCipher table이 각각 소유한다. Renderer preference는 파일·Keychain·Codex
  권한을 얻지 않으며, 프로젝트를 아직 만들지 않았거나 workspace 복구가 실패해도 Settings 화면은
  열려야 한다.
  앞으로 계정 간 preference 동기화가 필요하면 전용 계약과 명시적 opt-in을 별도로 설계한다.

### Workspace Usage 분석과 model token 원장

- Workspace sidebar의 `Usage`는 Settings 바로 위에 있는 app-wide 분석 surface다. 오늘, 현재 ISO 주
  (월요일 시작), 현재 calendar month를 사용자의 IANA time zone으로 계산하고 project, workload,
  connection과 resolved model filter를 같은 query에 적용한다. summary, input/output 추세와
  project·Lecture generation·provider/model breakdown은 모두 동일한 SQLCipher 원장을 집계한다. 첫 화면의
  model mix는 resolved model마다 별도 card로 input/output/total과 turn coverage를 표시하며, 같은 model도
  connection이 다르면 provenance를 합치지 않는다. `gpt-5.6-sol`, `claude-opus-5`처럼 인식 가능한 exact ID는
  `GPT 5.6 Sol`, `Claude Opus 5`로 읽기 쉽게 병기하되 raw resolved ID도 함께 보여 주고, 알 수 없는 ID는
  추측해 이름을 바꾸지 않는다.
- 이 화면은 **이 Mac에서 GOSU가 관측한 provider-reported token usage**다. provider 청구서, 계정 전체
  quota, 구독 사용량이나 비용 추정치가 아니다. 추적 기능 도입 전 호출은 역산하지 않으며
  `trackingStartedAt`보다 오래된 기간은 기록되지 않았다고 표시한다. provider가 input/output을 보내지
  않은 terminal turn도 0으로 만들지 않고 `Not reported` coverage에 포함한다. 실제로 보고된 0만 숫자
  0으로 표시한다.
- Codex App Server의 `thread/tokenUsage/updated` 중 thread 누적 `total` snapshot만 사용한다. `(provider,
thread)` cursor와 component별 새 누적값의 단조 증가분을 한 SQLCipher transaction에서 해당 turn에
  더한다. 같은 snapshot 재전송은 no-op이고 counter 감소는 음수 보정이나 추정 없이 partial baseline
  anomaly로 남긴다. `last`와 opt-in하지 않은 internal raw response event는 합산하지 않는다.
- Hermes ACP의 일반 `usage_update`는 context pressure이므로 token 소비량으로 쓰지 않는다. 완료된
  `session/prompt` response가 제공한 input/output/total과 optional cache·thought breakdown만 bounded
  cumulative snapshot으로 처리한다. cache read/write는 input의 하위 분류이고 reasoning/thought는
  output의 하위 분류이므로 전체 token에 다시 더하지 않는다.
- invocation identity, usage row, workload attribution과 thread cursor를 분리한다. Project Chat과 title,
  Lecture generation·correction·assistant edit, Literature organize, Experiment Evaluation과 Hermes
  delegation은 각각 실제 provider turn에 결합한다. 여러 source project를 쓰는 Lecture는 저장을 소유한
  `outputProjectId`에 한 번만 합산하고 source project 목록을 이유로 token을 복제하지 않는다. manual
  Lecture LaTeX revision은 model 호출이 아니므로 usage를 만들지 않는다.
- connection snapshot에는 transport(`codex|hermes`), 검증된 auth/configured provider 종류, 실제 resolved
  model과 사용자에게 보일 non-secret label만 고정한다. model 문자열만 보고 Claude·ChatGPT를 추정하지
  않는다. Codex의 trusted account kind가 ChatGPT이면 `ChatGPT`, API key이면 `OpenAI API`로 분리하고,
  Hermes는 sealed runtime의 configured provider를 표시한다. account email, plan, key, prompt/response,
  attachment 이름·경로와 raw provider notification은 저장하지 않는다.
- usage 원장은 local-only다. project를 Archive·Trash하거나 connection을 끊어도 역사 attribution은
  유지하지만 `sync_outbox`, Hosted Sync와 telemetry에는 넣지 않는다. Renderer는 strict aggregate DTO만
  받고 raw event나 account credential을 읽지 않는다. 실패·중단 turn은 도착한 숫자를 버리지 않되
  partial/unavailable coverage를 함께 표시한다.

### Project Agent Runtime: native Codex harness와 후속 자율 실행 설계

Project Chat에는 pinned local [Codex App Server](https://learn.chatgpt.com/docs/app-server)의 native
thread/turn/item agent loop와 dynamic tools를 사용해 active project의 Board·Objective와 명시적으로
승인한 Research Notes, project-scoped CPU/RAM/GPU snapshot을 읽고, 현재 project에 grant된 OpenSSH
alias/direct target에 기본 exact Allow-once 또는 exact trusted audit-before-execute workspace command를
요청하는 bounded tool loop가 구현되어 있다. Workspace mode에서는 최대 120초의 제한된 foreground
Python experiment도 같은 typed policy와 선택한 승인 경계로 요청할 수
있다. GOSU가 별도의 planner/reviewer loop를
재작성하지 않고 Codex가 제공하는
collaboration mode·reasoning·personality·verbosity를 조합한다.
다만 이 문단의 GOSU-managed Codex capability는 navigation UI나 DB를 자유롭게 조작하는 agent가 아니다.
mutation은 검증된 proposal과 사용자 Apply를 거친다. 승인형 SSH는 local shell/network 권한을 Codex에
주는 것이 아니라 Main의 고정 broker가
project grant와 argv policy를 검증해 한 command만 대리 실행하는 좁은 예외다. remote workspace mode는
interactive terminal이나 hard sandbox가 아니며, arbitrary local file, 실험 campaign 실행과 논문 변경을
포함한 GOSU-managed 프로젝트 자율 실행 runtime은 아직 계획 단계다. 아래 bundled Hermes의 text/reasoning-only
surface와 GOSU-owned 고수준 위임은 이 Codex capability 계획과 별개이며 GOSU project capability bridge가
아니다.

OpenClaw는 GOSU의 bundled harness dependency가 아닌 **선택형 add-on 후보**로 감지만 지원한다. Hermes는
release installer가 검증된 runtime을 같이 배포하는 선택형 ACP Project Chat provider이며, 사용자 provider
credential은 bundle에 넣지 않고 GOSU가 만드는 isolated local profile에서만 해석한다. 구현은 공식
[OpenClaw repository](https://github.com/openclaw/openclaw)·
[설치 문서](https://docs.openclaw.ai/install)와 Nous Research의 공식
[Hermes Agent repository](https://github.com/NousResearch/hermes-agent)·
[문서](https://hermes-agent.nousresearch.com/docs/)·
[programmatic integration](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration)에서
제품 identity, CLI 이름과 ACP transport를 고정한다.
`AgentAddOnDescriptor`는 publisher·official URL·executable name과 GOSU integration capability를 typed
metadata로 선언한다. local installation detection과 setup guidance는 양쪽 모두 제공하고, Project Chat
provider는 Hermes만 `available`이다. Hermes capability는 `automaticInstaller=bundled`로 표시하고 credential
management는 구현하지 않는다.

Electron Main의 `AgentAddOnRegistry`는 provider별 adapter 뒤에서 현재 `PATH`와 공식 installer가 사용하는
known local prefix(`~/.openclaw/bin/openclaw`, `~/.local/bin/hermes`)의 실행 가능 file만 읽기 전용으로
검사하고 path 자체는 Renderer에 보내지 않는다. detection-only 상태는 CLI를 실행하거나
version·publisher·signature·configuration을 추론하지 않으며 항상 “detected — not connected”로 표시한다.
Hermes의 기존 `connect-local` preference key는 저장된 사용자 설정 호환성을 위해 유지하지만, packaged
Main에서는 bundled manifest·source revision·전체 tree hash·configured runtime·sealed preflight를 검증한 뒤
actual model descriptor와 `connectionMode=bundled-acp-agent` status를 반환한다. development-only local
fallback은 `connectionMode=byo-local-acp-agent`로 구분한다. turn에서는
sealed Python ACP v1 client·profile factory와 turn-scoped safety broker를 조합한다. Renderer는 strict typed
status/connect/disconnect IPC만으로 production connection을 제어하고 Main은 unknown·duplicate ID나 추가
field를 fail closed한다. future mutation bridge용 approval IPC는 구현돼 있지만 현재 tool allowlist에서는
호출되지 않는다.
모든 add-on이 `disabled`면 detection IPC도 호출하지 않으며 연결돼 있던 Hermes에는 별도 disconnect
command를 보내 connection authority, 모든 primary·delegation client와 pending permission을 닫는다.
Release packaging은 `GOSU_HERMES_BUNDLE_SOURCE`로 지정한 clean exact-revision source bundle만 받아 secret·
session DB·Git checkout·symlink를 거절하고 manifest를 생성한다. release 명령은 bundle이 없으면 실패하고
packaged-app verifier가 포함된 resource를 다시 hash-check한다. Settings의 official setup link는 provider
credential 설정 문서를 직접 여는 navigation일 뿐 GOSU가 onboarding, API key 또는 OAuth를 대신 실행하지
않는다.

후속 기능도 우선 Codex App Server와 Hermes ACP의 native agent loop를 재사용하고, GOSU는 연구 도메인
capability·승인·provenance만 소유한다. 현재 Hermes는 native tool 없이 primary agent turn으로만 연결되고,
Codex→Hermes 위임도 fresh Hermes primary turn을 호출하는 GOSU-owned bounded port다. GOSU Board·Notes·
Literature·SSH capability를 Hermes에 직접 열기 전에는 project capability negotiation, typed tool mapping,
process sandbox, durable audit와 child-agent project authorization을 별도로 설계·검토해야 한다. OpenClaw를
provider로 연결하거나 Hermes one-click installer를 추가하려면 signed distribution allowlist, update
channel, signature 검증과 credential ownership도 필요하다. 현재 configured MCP server는 Hermes ACP에서
의도적으로 비활성화한다.

```mermaid
flowchart LR
  User["Project conversation·goal"]
  Gateway["Local Project Agent Gateway\nrun acceptance·session lane"]
  Planner["Codex native agent loop\nResearchPlanV1·ActionProposalV1 output"]
  Policy["Deterministic Policy\nRBAC·mode·budget·policy hash"]
  Approval["Human approval\ndiff·manifest·scope"]
  Executor["Typed Executor\nversioned tool registry"]
  Runner["Linux Runner\nsigned JobManifestV1"]
  Observer["Observer\nreceipt·metric·guardrail"]
  Memory["Approved project memory\nfacts·episodes·playbooks"]

  User --> Gateway --> Planner --> Policy
  Policy -->|"needs approval"| Approval --> Executor
  Policy -->|"allowed"| Executor
  Executor --> Runner --> Observer --> Gateway
  Observer -->|"candidate + provenance"| Memory
  Memory --> Planner
```

적용할 경계는 다음과 같다.

- **Gateway와 run lifecycle**: Electron Main의 local gateway가 provider session, run queue, event와
  cancellation의 control plane을 소유한다. Linux Runner는 execution data plane이고 Hosted Sync는
  협업·승인·감사 metadata만 다룬다. LLM 호출 전에 `AgentRun`을 durable accept하고 `runId`를 반환한
  뒤 lifecycle, assistant, tool, observation stream을 분리한다. project/session lane별 직렬화와
  idempotency key·fencing token으로 stale run이 최신 상태를 덮지 못하게 한다.
- **Native agent loop와 계획 계약**: Codex가 목표와 허용된 tool observation을 바탕으로 계획을
  진행하되, GOSU가 받는 변경 출력은 `ObjectiveVersion`, expected metric, precondition, rollback,
  budget을 포함한 versioned `ResearchPlanV1`과 `ActionProposalV1`으로 제한한다. Codex mode가 connector나
  shell 권한을 스스로 얻거나 성공을 최종 판정하지 않는다.
- **Policy**: LLM·plugin과 분리된 결정론적 engine이 lab/project RBAC, Autopilot mode, metric·dataset,
  budget, network·secret, branch/base-SHA와 policy hash를 평가해 `allow`, `deny`, `needsApproval`을
  결정한다. session ID는 routing 식별자일 뿐 authorization 근거가 아니다.
- **Executor와 tool manifest**: tool은 version, JSON Schema input/output, capability, side-effect,
  idempotency와 source hash를 선언한다. MVP는 bundled·allowlisted adapter만 로드하고 deny가 allow보다
  우선한다. 실험은 raw shell string이 아니라 서명된 `JobManifestV1`만 Runner에 전달한다. connector는
  별도 worker process로 격리한다.
- **Observer와 evidence**: Runner, Git, compiler와 evaluator event를 append-only observation과
  `ExecutionReceipt`로 만든다. trusted evaluator와 guardrail이 metric 채택을 판단하며 LLM 문장은
  evidence가 아니다. 실패·중단·negative result도 lineage에서 제거하지 않는다.
- **Memory와 skill learning**: bounded curated memory와 on-demand searchable history를 분리해
  (1) run 시작 시 고정된 bounded working snapshot, (2) project-scoped episodic history,
  (3) 승인된 structured fact, (4) versioned procedural playbook을 별도 저장한다. 새 memory·playbook은
  source, run, commit, ObjectiveVersion provenance가 있는 candidate→diff→human approval을 거친다.

채택하지 않을 패턴도 불변식으로 둔다. 임의 marketplace plugin·MCP·skill을 Main process에 로드하지
않고, host shell을 기본 tool로 제공하지 않으며, project 사이에 persistent execution container를
공유하지 않는다. agent가 만든 memory·skill·code를 기본 자동 반영하지 않고 model/provider 오류를
silent fallback으로 숨기지 않는다. approval regex, redaction, prompt scan은 보조 방어이며 실제 보안
경계는 OS process, container, credential store와 tenant authorization이다.

### 로컬 실행과 패키징 경로

`pnpm app:dev`는 일반적인 workspace 병렬 실행과 별개의 사용자용 local slice다.
package script의 shell은 `exec`로 supervisor에 교체되어 terminal signal을 중간에서 소비하지 않는다.

1. `GOSU_SYNC_API_URL`을 credential·path가 없고 port가 명시된 loopback HTTP base URL로 검증한다.
2. 고정된 `/v1/health/ready`에서 service identity와 readiness를 확인한다.
3. 건강한 기존 GOSU Sync가 없으면 loopback memory Sync를 시작하고 준비 완료까지 기다린다. 같은
   port에서 다른 서비스가 응답하면 충돌로 중단한다.
4. 준비된 base URL만 Electron Main에 전달하고 Desktop을 시작한다.
5. Desktop이 끝나거나 `Ctrl+C`를 받으면 진행 중인 probe/readiness를 취소하고 이후 child 생성을
   차단한 뒤 소유한 process group을 종료해 watcher와 Electron helper가 남지 않게 한다.

Desktop Main은 single-instance lock을 먼저 획득한다. 같은 user data를 사용하는 두 앱이 동시에
SQLCipher workspace를 열지 않으며 두 번째 실행은 기존 창만 앞으로 가져온다. terminal이나 상위
process가 사라진 뒤 `stdout`·`stderr`가 닫혀도 `EIO`·`EPIPE`만 제한적으로 흡수해 진단 출력의
연쇄 crash를 막고, 그 밖의 process output 오류는 그대로 실패시킨다. 개발 launcher가 비정상
종료되어 signal cleanup을 실행하지 못한 경우에도 Desktop은 supervisor PID liveness를 확인해 고아
DB writer로 남지 않는다.

root `turbo.json`의 package-specific `@gosu/desktop#build` task는 Desktop build output을 `out/**`로
좁힌다. 일반 package compile 결과는 계속 cache하지만 Electron packaging이 만드는 `dist/**`의 `.app`과
DMG는 Turbo cache에 넣지 않는다. `dist/**`는 release마다 직접 재생성·검증한다. 이 override를 제거하면
수백 MB 앱 bundle과 DMG가 반복 압축되어 `.turbo/cache`가 수십 GB 이상 커질 수 있으므로, 변경 후에는
Turbo dry-run의 resolved Desktop output과 실제 cache 크기를 함께 확인한다.
`scripts/turbo-cache-policy.test.mjs`는 이 package-specific output이 `out/**`에서 넓어지는 회귀를 막는다.

`pnpm app:doctor`는 Node, macOS target, workspace 의존성, Electron·Codex package와 local port를
비밀값 없이 검사한다. `pnpm app:package`는 전체 품질 게이트 후 ad-hoc 서명된 개발용 DMG를
만든다. 이 로컬 전용 경로는 Electron 하위 바이너리까지 일관되게 서명하기 위해 Hardened Runtime을
끄지만, 기본 macOS production 설정의 Hardened Runtime은 그대로 유지한다. DMG는 Hosted Sync가
없어도 local-first 기능과 runtime 상태를 표시하며, 실제 배포용 Developer ID 서명·notarization과
update channel은 아직 없다. `afterPack` hook은 Electron 기본 plist에서 사용하지 않는 카메라,
마이크, Bluetooth 권한 설명을 제거하고 arbitrary network load를 끈 뒤 loopback 예외만 유지한다.
ad-hoc signature의 designated requirement는 build마다 달라질 수 있으므로 기존 `Electron Safe
Storage` Keychain item을 읽을 때 macOS가 사용자 승인을 다시 요구할 수 있다. 이를 피하려고 Keychain
ACL을 약화하거나 key를 평문으로 옮기지 않으며, 안정적인 무인 upgrade는 Developer ID signing 이후
제공한다.
`pnpm app:package:release`는 Hardened Runtime을 유지하고 signing identity가 없으면
`forceCodeSigning`으로 즉시 실패하는 release 전용 경로다. Developer ID와 notarization credential은
공개 저장소가 아닌 release 환경에서만 주입한다.
`@gosu/integrations`처럼 `type: module`인 내부 runtime package의 상대 import·re-export는
Node ESM 규칙에 따라 `.js` 확장자를 명시하고 `NodeNext` typecheck로 강제한다. Desktop Main은 내부
`@gosu/*` package를 external dependency로 남기지 않고 bundle하며, build 후 Main output에 내부 package
`require()`가 없는지 검사한다. package command는 workspace dependency를 먼저 재빌드하고 생성된
`.app`을 `--gosu-packaged-startup-smoke` 격리 모드로 실제 cold-start한다. 이 모드는 DB·Keychain·network·
Renderer window를 열기 전에 고정 READY marker를 출력하고 종료하지만 Main의 top-level module graph와
packaged Electron runtime은 그대로 로드하므로 ASAR 누락, extensionless ESM, native startup 오류를
release 실패로 만든다. macOS CI도 unsigned directory package에 같은 검사를 수행한다.
패키지 안의 Codex JavaScript launcher와 native binary는 `app.asar.unpacked`에 두며 Main이 실제
unpacked 경로를 계산해 실행한다. child process에 virtual `app.asar` 경로를 넘기면 native binary
spawn이 실패하므로 경로 변환을 unit test와 설치본 smoke test로 검증한다.

앱 아이콘은 `apps/desktop/build` 안에서 역할별로 분리한다. `icon-source.png`는 사용자가 승인한
고해상도 편집 원본이고, 앱이 직접 읽지 않는다. `icon.png`는 투명한 바깥 모서리와 macOS squircle
silhouette를 가진 1024×1024 RGBA canonical rendition이며 개발 실행의 Dock 아이콘으로 쓴다.
`icon.icns`는 같은 rendition에서 16·32·64·128·256·512·1024px를 만든 설치 앱·DMG용 자산이다.
아이콘을 바꿀 때는 두 runtime 자산을 함께 재생성하고 ICNS를 다시 iconset으로 추출한 1024px
rendition을 canonical PNG로 확정한다. 이렇게 하면 `iconutil`의 PNG 재인코딩에도 두 자산이 byte
단위로 일치한다. `scripts/icon-assets.test.mjs`가 RGBA 크기, 투명 모서리, 충분한 squircle 면적,
package 설정과 ICNS의 `ic10` rendition 일치를 검사해 네모 아이콘이나 Electron 기본 아이콘으로의
회귀를 막는다.

현재 한계도 중요하다. local outbox table은 존재하지만 Sync delivery·reconciliation worker는 아직
없다. Codex Project Chat은 실제 thread·turn과 연결됐고 사용자가 capture한 exact manuscript source를
명시적 tool로 읽을 수 있지만 논문 작성·patch approval 흐름은 아직 연결되지 않았다. Manuscript
workspace는 provider-neutral identity/checkpoint, Overleaf manual inbound capture, bounded source read, prototype
MacTeX compile·PDF.js preview까지 연결됐다. source import·diff/review candidate, editor, durable compile artifact,
authority handoff, review branch와 outbound publish는 계획 상태다. 앱 관리형 Git Workspace는 동작하지만 GitHub App 설치·PR review·보호 branch gate와
repository asset preview도 계획 상태다. macOS Keychain의 기존 Git
credential을 사용할 수는 있지만 GOSU 자체 GitHub account lifecycle을 구현한 것은 아니다. 승인형 SSH
command importer와 project-scoped remote workspace broker는 구현됐지만 interactive terminal, PTY,
general binary file transfer, active port forwarding, unattended command, delete·rename·large-file patch와
Runner 설치·복구 connector는 계획 상태다. bounded UTF-8 text file list/read/create/expected-hash-checked atomic replacement는
구현됐지만 interactive editor 또는 arbitrary filesystem API가 아니다. importer에 포함된 loopback `-L`은
inactive plan일 뿐 tunnel을 열지 않는다. workspace command mode는 concrete executable과
inspect/test/build/foreground-experiment allowlist만 허용하며 raw shell이 아니다.
test/build/experiment는 project code를 remote account 권한으로 실행할 수 있고 lexical root 검사는
sandbox가 아니다. 기본 mode는 HIGH-RISK `Allow once`를 매 operation 확인하며, verified direct target에
사용자가 project별로 별도 켠 trusted mode는 같은 위험·allowlist를 유지한 채 반복 dialog 대신 실행 전
append-only audit를 사용한다. command
approval은 argv/cwd만 고정하고 실행 시 읽히는 source file hash를 고정하지 않는다. 명시적 root workspace
실행과 auto-run은 현재 prototype의 HIGH-RISK 예외이고 ROOT 전용 추가 확인 뒤에도 launched code는 server
전체에 영향을 줄 수 있다. hardened production은 non-root isolated Runner를 요구한다. 현재 approval
dialog와 trusted setting도 primary Renderer 안의 trusted UI boundary이며 별도의
Main-owned isolated approval window가 아니다. Renderer compromise까지 포함한 hardened threat model에서는
승인 전용 child window·최소 preload와 Main의 request binding 검증을 추가해야 한다. hash 재검사 뒤 atomic replacement도 unrelated writer와 경쟁할 수 있고,
mutation 뒤 receipt·transport 실패는 outcome uncertainty를 남기므로 same-path re-read/hash reconciliation이
필수다. local
OpenSSH transport를 timeout·cancel로 종료해도 연결이 이미 끊어진 뒤 remote process tree가 종료됐다고
보증할 수 없으므로 장기 workload는 SSH broker가 아니라 lease·fencing·reconciliation이 있는 Runner를
사용해야 한다. raw SSH output은 현재 turn memory에만 있고 durable transcript가 아니며, approval request·
command hash·binding·allowed/denied/expired/cancelled outcome도 해당 app process/turn 수명의 event일 뿐
append-only audit가 아니다. 이는 기본 Allow-once 경로의 한계이며 trusted auto-execution은 별도 SQLCipher
append-only table에 exact binding·operation·command SHA-256을 transport 시작 전에 기록한다. 그 audit도
raw command·output, remote completion 또는 workload lineage 증명은 아니다. Connections와 Project Chat의
CPU/RAM/GPU snapshot은 Linux `/proc`와
선택적인 NVIDIA CLI에서 읽은 순간 진단일 뿐 run lineage, 장기 monitoring, GPU accounting, experiment
metric, budget 근거나 Runner heartbeat가 아니다. sample history는 저장하지 않고 host별 비-NVIDIA
accelerator와 container 내부 accounting도 현재 보증하지 않는다. Project Chat의 인터넷 기능은 Codex
first-party cached/live search이며 일반
browser, 임의 URL download나 page control이 아니다. web provider 측 retention은 GOSU local DB 정책만으로
통제할 수 없다. 연구 파일 첨부는 해당 turn의 bounded reconstruction 또는 정규화 image 분석일 뿐이다.
PDF OCR·figure/table visual 이해, Office/HWPX layout·embedded object 복원, Zotero/Literature record
attachment 또는 paper full-text verification을 뜻하지 않는다. Literature는 metadata
검색·review table까지 구현됐지만 systematic-review full-text 근거 검증, Zotero 동기화, 예약된 background
alert와 Hosted collaboration은 아직 보증하지 않는다. DMG 설정은 있으나
Developer ID 서명·notarization·auto-update를 보증하지 않는다. 개발 DMG는 ad-hoc signature만 사용한다.

IPC 기능을 추가할 때는 preload type, argument schema, Main sender 검증, 최소 반환값, 실패 테스트를
한 묶음으로 변경한다. Renderer 편의를 이유로 filesystem path나 secret 값을 넓게 반환하면 안 된다.

## 9. Sync API 수명주기

### HTTP와 SSE

- `/v1/health/live`와 `/v1/health/ready`만 인증 없이 고정된 비민감 상태를 반환한다. 그 외 요청은
  global auth guard를 통과한다.
- development auth는 lab·subject·role header 세 개를 모두 요구하고 production 환경에서 거부된다.
- OIDC mode는 이미 발급된 GOSU JWT의 issuer, audience, expiration, lab과 role claim을 검증한다.
  Google·Apple login이나 session issuance를 구현한 것은 아니다.
- controller는 lab·project 확인 후 role별 command 권한을 검사한다.
- SSE는 현재 in-process memory event를 lab 기준으로 filter한다. durable resume stream이 아니다.

### WebSocket relay

- browser는 exact Origin allowlist를 통과해야 한다.
- Origin이 없는 native peer는 `x-gosu-client-kind: runner`를 선언하고 동일한 인증을 통과해야 한다.
- runner는 `runner.hello`로 project를 고정하고 Owner 또는 Project Lead 권한으로만 publish한다.
- viewer subscription과 runner publish는 서로 다른 client kind로 격리한다.
- payload는 제한되며 compression은 꺼져 있고, send buffer가 한도를 넘는 느린 viewer는 끊는다.
- relay는 raw payload를 로그에 남기지 않고 일반화된 거절 사유만 기록한다.

현재 runtime repository는 항상 memory store다. 지원하지 않는 `GOSU_PERSISTENCE` 값은 memory로
fallback하지 않고 시작 단계에서 거부한다. PostgreSQL migration과 adapter에는 tenant context,
forced RLS, optimistic version,
idempotency, approval, audit와 transactional outbox 기반이 있지만 bootstrap wiring, migration
운영, Redis coordination, outbox publisher와 실제 장애 복구 검증은 남아 있다.

## 10. Runner 수명주기와 실행 정책

### 시작과 연결

- 기본값은 execution disabled이며 control URL이 없으면 control client도 disabled다.
- control을 켜면 runner와 project ID가 필요하다. loopback `ws://` 개발 연결은 lab header를
  명시하고, non-loopback은 `wss://`만 허용한다.
- 현재 Node relay가 runner mTLS를 종료하거나 검증하지 않는다. production ingress와 workload
  identity는 계획 상태다.
- 연결이 끊기면 client는 backoff로 재연결하고 미확인 spool event를 재전송한다. 실행 중인
  workload는 main process context가 살아 있는 한 계속되지만 새 remote job은 받을 수 없다.

### 제출과 실행

1. strict JSON envelope와 만료되지 않은 lease를 decode한다.
2. manifest hash와 Ed25519 signature를 검증한다.
3. local policy version·hash, image digest, executable, mount, secret reference, CPU·memory·GPU·시간과
   objective GPU-hour budget을 검증한다.
4. idempotency key와 fencing token을 local atomic store에 기록한다.
5. rootless Podman command를 shell 없이 argument array로 구성한다.
6. lifecycle을 local store에 기록하고 project·campaign·trial·attempt lineage가 있는 event를 durable
   spool에 append한다.
7. shared state event로 변환해 Sync로 보내고 ACK sequence를 저장한다.

현재 workload는 non-root user, no-new-privileges, all capability drop, read-only root filesystem,
PID·CPU·memory limit과 `--network=none`을 사용한다. workspace만 제한적으로 read-write mount한다.
host mount, container socket, privileged 실행, shell executable과 inline secret-like argument를
거부한다. dataset·scratch resolver는 아직 없으며, network allowlist도 enforceable egress adapter가
없으므로 설정과 manifest 양쪽에서 fail-closed로 거부한다.

GPU는 기본 비활성이다. 운영자가 구체적인 NVIDIA CDI selector를 허용하고 VRAM 선언 상한과
GPU-hour budget을 설정한 경우에만 선택된 device를 전달한다. VRAM 값은 admission guardrail이지
하드웨어 partition 보증이 아니므로 엄격한 격리가 필요하면 MIG 같은 별도 수단이 필요하다.

### 상태와 제어

공유 trial 상태는 `pending → leased → running → terminal`을 기본으로 하며 `lost`는 reconciliation
후에만 복구할 수 있다. Runner 내부에는 container 제어를 위해 accepted, queued,
stop_requested, kill_requested 같은 세부 상태가 추가로 있다. 외부로 보낼 때는 versioned shared
state로 명시적으로 변환한다.

Stop은 queued workload를 종료하거나 실행 중 container에 grace를 주고, Kill은 즉시 container를
종료한다. 둘 다 exact current lease와 fence를 요구하고 replay는 no-op이다. superseded lease의
workload는 먼저 kill하여 중복 GPU 실행을 막는다.

현재 빠진 운영 기능은 repository checkout, artifact upload, secret materialization 검증,
active-container host-crash reconciliation, cross-process state lock, production enrollment와 완전한
optimizer scheduling이다.

## 11. 장애 격리 원칙

| 장애                               | 유지되어야 하는 기능                  | 처리 원칙                                                                            |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| Codex unavailable                  | local cache, Vault reader, project UI | provider 상태를 실패로 표시하고 다른 모듈을 중단하지 않는다                          |
| add-on CLI 미설치·감지 실패        | Codex Project Chat, 모든 local module | `not_detected` 또는 detection unavailable로만 표시하고 자동 설치·fallback하지 않는다 |
| SSH unavailable·approval timeout   | Project Chat history, Board, notes    | command만 typed failure로 끝내고 raw diagnostic·output을 저장하지 않는다             |
| GitHub·Zotero·Overleaf unavailable | 로컬 문서와 Kanban                    | connector별 timeout·retry·error를 port 뒤에 격리한다                                 |
| Hosted Sync unavailable            | 로컬 편집과 승인 전 작업              | command를 versioned outbox에 두고 재연결 시 conflict를 명시적으로 처리한다           |
| Runner disconnect                  | 현재 trial의 제한된 완료              | 기본적으로 새 trial은 시작하지 않고 spool event를 보존한다                           |
| duplicate event                    | 기존 projection                       | fingerprint와 idempotency 결과를 재사용하고 side effect를 반복하지 않는다            |
| out-of-order event                 | 현재 attempt projection               | stale로 거절하고 ACK·reconciliation 정책을 혼합하지 않는다                           |
| lease expiry·fence conflict        | 유효한 현재 workload                  | 즉시 재실행하지 않고 상태를 조회·조정한다                                            |
| malformed·secret-like payload      | 다른 정상 요청                        | 경계에서 거부하고 원문을 log·spool·telemetry에 남기지 않는다                         |
| PostgreSQL·Redis 장애              | 로컬 앱과 Runner 원본                 | Hosted command를 실패시키되 연구 payload를 임시 cloud 저장소로 우회하지 않는다       |

"fallback"은 보안 또는 provenance를 약화시키는 자동 대체를 의미하지 않는다. 예를 들어 선택한
model이 catalog에서 사라지면 다른 model로 조용히 바꾸지 않고 실행을 중단한다. Git base SHA가
달라져도 자동 merge·rebase하지 않는다. metric·dataset·budget 변경은 기존 objective를 수정하지
않고 새 version과 승인을 요구한다.

## 12. 테스트와 CI

### 로컬 품질 게이트

`pnpm check`는 formatting, contract drift, lint, TypeScript typecheck, test와 build를 순서대로
실행한다. Turbo는 workspace dependency의 build를 먼저 수행하고 root test는 local launcher의 URL,
service identity와 readiness retry 규칙을 검증한다. 특정 package를 변경해도 PR 전에는 전체 gate를
실행한다. Desktop build는 추가로 sandboxed preload bundle을 검사해 허용되지 않은 external module이
남은 artifact를 만들지 않는다.

macOS에서 `pnpm --filter @gosu/desktop smoke:local-db:mac`을 실행하면 Electron ABI의 실제
SQLCipher와 `safeStorage`를 사용해 workspace commit, encrypted file header, close/reopen 복구,
duplicate idempotency key에 의한 transaction rollback과 outbox summary 일관성을 검증한다. 두
SQLCipher connection의 동일 revision 경합, 실제 v0.1 outbox schema migration, 손상된 singleton
summary 재구성, 해석 불가능한 operation payload의 byte-for-byte 보존도 포함한다. legacy schema-v1
snapshot을 연 뒤 Board 설정, task metadata와 archive command를 기록하고 다시 열어 복원되는지도
검증한다. 새 project의 default Board template copy가 snapshot과 create outbox에 함께 보존되는지도
확인한다. project rename의 stable slug, Trash/restore 시 task·objective·chat 보존, chat profile revision과
prompt provenance의 재시작 복원도 확인한다. Manuscript private binding·credential reference·checkpoint
lineage의 close/reopen, legacy provider/credential column migration, permanent Trash cascade와 filesystem
artifact purge 및 reference-aware credential cleanup queue의 durable cursor·exact ACK도 같은 smoke가
담당한다. 이 검사는 native ABI와 `safeStorage`/Keychain
구현이 다른 Linux CI의 일반 Vitest 경로와 분리한다.

`pnpm --filter @gosu/desktop smoke:manuscript-layout:mac`은 실제 Manuscript React view를 최소 창
`1060×700`, 440px project sidebar와 Extra Large text에서 실행한다. 연결 전·연결 후·오류/Retry 상태의
container query, control containment, hit target, vertical scroll과 horizontal overflow 부재를 검증한다.
Renderer unit test는 현재 binding checkpoint만 비교 기준으로 인정하고 baseline 없음·동일 revision·새
revision·실패 후 stale 표시를 구분하며, 편집자 identity나 merge 안전성을 단정하는 문구가 없는지도 검증한다.

Project Agent tool test는 active project 밖의 Board·Objective가 섞이지 않는지, forged project
argument·credential 포함 repository와 raw path가 차단되는지, grant가 없거나 선택 Vault가 바뀌면 note
read tool이 없거나 stale error로 실패하는지 검증한다. structured response test는 required `none|save`,
28,000자 cap, 모델이 path를 주입할 수 없는 category/title/content schema, explicit create capability,
fixed folder mapping, deterministic attempt idempotency suffix, create-only collision, cross-project·ownership 차단,
post-write exact-byte read-back, commit uncertainty와 server-owned relative-path receipt를 검사한다. terminal
race test는 느린 local write를 기다리는 동안에도 model tool과 SSH capability가 이미 닫혔음을 고정한다.
Research Notes read는 opaque ID, 호출당 24,000자·동시 호출을 포함한 turn당
96,000자 budget, high-escaping 직렬화 cap, 큰 Board 축약, tail-only excerpt와 모든 terminal source
appendix를 검사한다. 자동 appendix에는 본문과 absolute path가 남지 않아야 하지만, 승인된 note를 모델이
visible answer에 인용한 경우 그 인용문이 durable chat에 저장되는 것도 명시적으로 검증한다. Codex App
Server protocol test는 namespace allowlist, 실제 turn binding, malformed·duplicate call, invalid result,
timeout과 release/disconnect cleanup, barrier를 둔 동시 thread ID 소유권 충돌뿐 아니라 active child의
write callback이 성공한 경우만 `delivered`, write 시작 뒤 error·revoke는 `uncertain`인지 검증한다.
Project Agent tool test는 discard 뒤 late completion 봉인, terminal의 bounded ack wait와 synchronous
transport revoke, write-in-progress 출처의 `delivery unconfirmed`, 같은 note의 서로 다른 content hash
보존도 담당한다. Project Chat service test는 project 간 thread ID 충돌이 기존 owner를 덮어쓰지 않는지
확인한다. result 직렬화 크기와 동시 note budget·큰 Board 축약도 Project Agent tool test가 담당한다.
SQLCipher smoke는 Research Notes의 legacy `local_notes` grant column이 없던 실제 v0.5 profile schema를 열어 nullable grant로
migration한 뒤 새 grant를 저장할 수 있는지도 확인한다. 기존 grant에는
`local_notes_allow_agent_markdown_create=0`을 적용해 read-only로 유지하고 새 explicit grant의 true가 재시작
뒤에도 복원되는지 검증한다. receipt test는 body·absolute path를 저장하지 않는 stage, uncertain timeout,
commit 뒤 assistant appendix와 `reported`의 원자성, restart recovery, Vault reconnect의 verified-missing
`abandoned`, offline·stale 상태 보존과 late exact success의 단일 promote를 고정한다.

Project Chat web-search test는 `disabled|cached|live`가 정확한 `thread/start.config.web_search`로 전달되고
legacy profile은 `cached`로 migration되는지, profile·attempt가 SQLCipher reopen 뒤 mode를 보존하는지,
invalid mode는 fail closed하는지 검증한다. 각 mode에서도 shell, browser, Apps, MCP와 general network가
계속 비활성이고 mode를 silent fallback하지 않아야 한다.

Agent add-on test는 OpenClaw·Hermes descriptor의 공식 identity, PATH와 known local prefix candidate,
실행 없는 detector와 replaceable adapter registry를 고정한다. strict IPC와 mixed preference test는 enabled
ID만 adapter에 전달되고 disabled ID·unknown·duplicate·extra-field input은 검사 전에 거절되는지 확인한다.
Hermes preflight test는 exact version pin, provider-plugin 봉인과 unsupported/meta runtime 거절을 검사한다.
isolated-profile test는 deterministic project/session path, non-secret config, credential environment allowlist와
symlink·profile-local dotenv 거절을 고정한다. ACP client unit test는 fake process로
initialize/session/prompt/cancel, client capability, empty configured MCP, permission response, sanitized session
update, size·timeout·pending cap과 process-group shutdown을 검사한다. malformed JSON/RPC envelope와
split/coalesced newline frame은 아직 직접 fixture로 고정하지 않았다. ACP Project Chat adapter test도 fake
client로 매 turn runtime 재검증, project/session scope, primary·ephemeral delegation, permission cancel,
concurrent session, no-fallback와 전체 client shutdown을 검사한다. primary durable invocation은 Hermes adapter
provider와 resolved model을 검사한다. delegation test는 strict structured receipt의 actual model/provider,
catalog, agent/transport/stop/time을 검사하고 raw task/context/reply/credential이 schema와 SQLCipher에 없는지,
exact retry idempotency, conflicting retry 거절, append-only trigger와 chat-attempt purge 뒤 receipt 보존을
검사한다.

Renderer Hermes approval test는 future mutation-tool bridge용 broker/화면의 bounded preview와 opaque ID
비노출만 확인한다. 현재 production allowlist에는 승인 가능한 mutation tool이 없어 이 화면을 열지 않는다.
future bridge를 활성화하기 전에는 focus trap, background global approval queue와 SSH dialog 시간순 직렬화를
실제 DOM interaction/Electron test로 추가 검증해야 한다. preference test는
legacy·unknown mode와 OpenClaw `connect-local`의 `disabled` 복구, project/session별 Hermes 선택 복원,
no-fallback와 explicit disconnect 뒤 reconcile을 검사한다. opt-in local integration test는 production sealed
Python source를 실제 설치된 Hermes `0.19.1`과 local Nous credential pool에 연결해 ACP session과 GOSU-owned
Hermes delegation 결과를 확인한다. 실제 turn은 답 `42`, native tool/approval 0건, `state.db`·WAL·SHM과 raw
prompt marker 미잔존을 함께 검증한다.
현재 package script는 packaged app startup만 검사하고 Finder-launched installed app 안에서 Hermes Connect와
실제 turn까지 자동 조작하지 않으므로 이 packaged integration smoke는 후속 release gate로 남는다.

attachment test는 trusted IPC sender와 strict project/session DTO, Renderer path 비노출, symlink·가짜
magic·oversize·encrypted·extraction-timeout과 legacy `.ppt`를 거절한다. OOXML/HWPX는 ZIP central/local
불일치, understated output·CRC·payload alias/overlap, bomb·traversal·duplicate path·DTD/ENTITY·외부
relationship, orphan part, relationship order, shared note, pre-reconstruction unit cap, comment·CDATA·
foreign element/attribute namespace spoofing, malformed QName·case-folded prefix·nested/duplicate note
container·double entity decode·reserved namespace rebinding·unknown relationship target mode를, image는
decoded format·pixel/edge cap·metadata 제거·
animation first-frame 정책을 검사한다. TTL·single claim, project/session forgery, 5개·파일당 20 MiB·turn
전체 50 MiB·500 unit·총 60,000자·호출당 8 unit/24,000자·live capability/image 한도, session 전환·
terminal·startup failure·cancel revoke와 late picker/result 폐기를 고정한다. text-only model과 catalog
snapshot에 없거나 image modality가 없는 early/late reroute는 interrupt·tool revoke·modality failure로
fail closed하고 buffer saturation·terminal persistence recovery에서도 image source receipt와 불완전한 saved
retry를 막으며 raw bytes/text,
filename과 temporary path가 prompt, message, SQLCipher·telemetry에 남지 않으며 실제 전달된 read/native
image만 bounded source appendix를 만드는지도 검증한다. parser나 web/literature provider 장애는 Board·
Research Notes와 기존 Literature table을 막지 않아야 한다.

Research Notes tree test는 입력 순서와 무관한 directory-first natural ordering, duplicate와 malformed path
제외, nested·sibling expansion 보존, 현재 note ancestor reveal을 고정한다. Renderer test는 접힌 descendant가
DOM에 없고 directory의 `aria-expanded`, 현재 file의 `aria-selected`·`aria-current`, visible row의 단일
roving tab stop과 tree level·position metadata가 일치하는지 검사한다. Markdown document test는 inline·
display MathML, frontmatter·inline/fenced code 제외, escaped·unmatched dollar, malformed·unsafe TeX,
수식 rendering budget의 visible fallback, 긴 prose 줄바꿈과 inline/display 수식·code·table의 local
가로 scroll 계약, 기존 wiki-link·attachment·HTTPS·raw HTML 경계를 함께 검증한다. 별도 Electron Chromium
smoke는 지원하는 최소 창 크기·최대 sidebar·오류 notice·기본/Extra Large 글자 조합에서 Research Notes와
Repository preview의 `scrollHeight > clientHeight`, 실제 `scrollTop` 이동, viewer 폭 보존과 code block의
local `scrollLeft` 이동을 함께 검사한다. 같은 smoke의 compact tree scenario는 wide/stacked window에서
270px explorer가 44px rail/strip으로 줄어 reader가 공간을 회수하는지, restore 뒤 geometry가 돌아오는지,
toggle focus와 ARIA state가 유지되는지, 긴 folder/file 이름과 selected path가 Extra Large 글자에서도
ellipsis containment를 지키는지 검증한다. 실제 macOS 최소 창 `1060×700`, 최대 440px project sidebar와
860px responsive 경계에서는 닫힘·열림·복원 모두 settings panel과 toggle이 explorer·document layout·viewport
안에 완전히 포함되고, outer hidden overflow 없이 settings body만 끝까지 scroll되는지도 검사한다. fixture는
실제 `.search-view.compact` form을 사용해 `Search Research Notes` label과 input·긴 `Searching…` control row가
270px rail 안에서 완전히 보이고 horizontal overflow를 만들지 않는지, 아래까지 scroll한 settings를 닫았다
다시 열면 검색 form이 top에 복구되는지도 확인한다.
layout-state test는 missing·legacy·malformed·storage 예외를
expanded default로 복구하고 explicit collapse만 저장하는 계약을 고정한다. route helper test는 active
project의 Notes·Repository에만 bounded document layout class가 적용되는지도 고정한다.

Project Chat session test는 legacy single-chat DB가 default session으로 lossless migration되는지,
root session isolation, completed-message branch prefix와 이후 source history 차단, cross-project·
cross-session snapshot/cancel/retry/action 거절, duplicate·stale event guard, 같은 session의 단일 turn과 서로
다른 session의 최대 4개 병렬 turn을 검증한다. queue test는 같은 timestamp에서도 단조
`enqueue_sequence`가 session 내부 FIFO를 고정하는지, 다른 session의 느린 Codex startup이 batch drain을
직렬화하지 않는지, `next` priority·edit/remove·Run now의 exact starting claim·claim handoff·self-interrupt
방지, startup의 `starting → queued` 복구와 bounded retry, 반복 snapshot의 backoff 우회 방지를 검사한다.
attachment expiry를 durable failed user/assistant receipt로 원자 정산한 뒤 같은 session의 다음 row가
진행되는지, message body 외 file path·bytes가 queue DB에 남지 않는지도 고정한다. Renderer test는 session
create/select/rename/branch, 여러 active session 표시, session별 composer와 selected-session Stop, 긴 최신
답변의 top anchor, 짧은 답변의 bottom clamp와
terminal-event/snapshot 순서 경합을 검사한다. scroll helper test는 96px near-bottom 기준, history를 읽는
중 assistant stream의 viewport 보존·알림, bottom auto-follow, user message와 무변경 snapshot의 no-op을
고정하고 Renderer markup은 `Latest` button과 composer 직전의 접근 가능한 새-message 알림을 검사한다.
session-state test는 unread assistant 뒤에 user message가 추가돼도 exact response ID를 유지하고, inactive
session 도착·session 왕복·duplicate terminal event·acknowledge 뒤 stale event가 unread를 되살리지 않는지
검사한다. completion intent가 더 늦은 snapshot 요청에 의해 supersede돼도 accepted snapshot까지 남는지,
더 최신 assistant가 이미 있어도 completed turn ID의 exact assistant를 선택하는지도 별도 race fixture로 고정한다.
layout-state와 Renderer test는 이전 width-only preference의 펼침 migration, 두 접힘 상태의 독립 persistence,
접힌 rail의 접근 가능한 restore control, 접힌 detail의 model·reasoning·SSH critical summary, persistent toggle
node와 120자 project name bound, hidden control의 DOM·keyboard 제외와 active turn 중 toggle 가용성을 고정한다.
별도 Electron geometry smoke는 production CSS,
Extra Large 글자, 최대 Projects sidebar, 12개 session과 긴 transcript를 1,060×700·1,480×930 window에서
실행해 detail collapse의 transcript 높이 회수, rail collapse의 chat 폭 또는 row 높이 회수, shell edge 안정성,
composer containment와 실제 transcript scroll을 검사한다.
Markdown test는 GFM과 `$...$`·`$$...$$` KaTeX,
raw HTML·unsafe URL 차단, 긴 입력과 깨진 수식의 bounded fallback을 검증한다. model catalog test는
provider가 제공한 opaque reasoning ID와 짧은 label을 그대로 보존하고 임의 fallback하지 않는지 확인한다.

Project navigation test는 이전 저장값에 sidebar 필드가 없으면 펼침으로 복구하고, sidebar toggle이 folder·
group·hidden project 상태를 보존하는지 확인한다. Renderer test는 접힘·펼침 button의 `aria-controls`와
`aria-expanded`, 46px 공통 titlebar token, viewport height chain과 document overflow 차단, nav·content의
독립 scroll ownership, 고정 content grid placement, animated zero-width track, stable scrollbar gutter,
`inert`·`aria-hidden`, 34px sidebar toggle·22px panel icon·18px navigation/disclosure icon,
responsive·reduced-motion fallback과 focus 이동 순서를 검사한다. 861px regression은
두 저장 폭을 최대로 둔 경우에도 1,180px breakpoint가 Sessions를 horizontal row로 바꾸고 숨은 handle이
stale drag origin을 만들지 않는다는 layout 계약을 고정한다. application menu와 preload test는
고정 accelerator, 표준 View 동작 보존, 구독 해제, 잘못된 payload 거절과 Renderer 준비 전 toggle parity를
검증한다.

SSH test는 legacy alias-only schema에서 additive direct-target/grant schema로의 migration,
connection/grant version CAS와 SQLCipher reopen, Renderer에 credential·raw paste·output이 노출되지 않는
IPC, narrow full-command parser, trailing loopback `-L` normalization·inactive retention,
dangerous option·remote command·shell syntax 거절, direct target의 `-F none`과 imported forwarding 미적용,
OpenSSH safe option·argument quoting·environment, background fork 차단, client diagnostic 비공개 격리와
remote stderr 보존을 검증한다. Renderer test는 grant setup의 sole-server preselection·명시적 risk confirmation
유지, 등록 row의 active-project 연결/linked/비활성 상태와 Project Chat의 project-grant CTA를 검사한다.
resource monitor test는 고정 command, `/proc` delta와 memory parser, 다중 GPU CSV·`N/A`·GPU
없음·malformed output, partial/unavailable snapshot, profile generation별 12초 cache·동일 profile
coalescing·전역 concurrency 4 제한, project grant isolation, server별 refresh의 단일-target 보장과 raw
output 비노출 IPC를 고정한다. resource refresh policy test는 다섯 주기 mapping, Manual 무예약,
visible-only lifecycle, 느린 조회 비중첩, 실패 후 재시도와 cleanup 뒤 재예약 금지를 검사한다. resource
summary test는 CPU/RAM/GPU meter, 여러 GPU, stale last sample, 접힘 상태에서도 남는 시각·issue,
명시적인 partial/no-GPU 상태와 접근 가능한 toggle label을 검사하고, session state/view test는 scroll 위치의
project/session 격리·saved zero·invalid value 거절·bottom default·viewport clamp·smooth replay 금지를 고정한다.
workspace policy test는 project grant isolation, canonical root·relative cwd,
mode별 concrete executable·inspect/test/build/experiment allowlist, root diagnostic 축소, shell·inline eval·privilege·
transfer·forwarding 거절, approval exact target/root/mode/command binding·profile/grant revalidation·TTL·capacity·
Allow once·scope cancel, centered blocking alert·single-request presentation·sticky action/countdown,
exact project+session pending-query hydration·resolved-ID tombstone·memory-only lifecycle와 navigation cancel,
450초 outer budget을 고정한다. trusted test는 standard direct target의 두 단계 consent, root target의
추가 ROOT consent, unknown privilege 차단, exact
project/grant/connection/root/policy version binding, global·turn reservation, audit-before-run 실패의 fail-closed,
grant/profile mutation·revoke·cancel·shutdown 뒤 재검사와 append-only update/delete guard를 고정한다. remote file helper test는 app-owned
Python source와 JSON-only stdin, physical root/no-symlink traversal, secret·binary·oversize 차단,
bounded list/read, create-only·stale SHA conflict·mode-preserving expected-hash-checked atomic replace·fsync
receipt와 post-mutation outcome uncertainty 뒤 same-path hash reconciliation 규칙을 검증한다.
runner test는 helper stdin일 때만 `-n`을 제거하고 exact bounded UTF-8 bytes를 전달하는지 확인하며,
service/approval test는 stdin hash, exact file preview, grant/profile 재검증과 승인 전 무변경을 고정한다. Project Agent
통합 test는 모델이 project/session/connection binding을 위조하거나 다른 project grant를 선택할 수 없고
허용된 workspace command도 승인 전에는 실행되지
않으며 navigation·send startup·startup Stop 경합, 실패하거나 지연된 Stop, pending Research Notes delivery가
있는 terminal turn과 app shutdown이 pending approval과 local transport를 즉시 폐기하는지 확인한다. remote
process-tree 종료와 기본 Allow-once request/outcome의 durable audit는 현재 구현·테스트 보증 밖이다. trusted
auto-execution의 append-only audit는 intent와 command hash를 보존하지만 remote completion 증명은 아니다.

Literature test는 Semantic Scholar fixed origin, relevance·citation·recent lane, year filter, author batch
bound, API key header, timeout·streaming response size·429 mapping과 raw abstract 제외를 검사한다. Hugging
Face test는 fixed Papers endpoint, modern·legacy arXiv normalization, bounded query/result/year filter,
timeout·cancel·response size·invalid response, summary 비보존과 additive failure isolation을 검사한다.
Discovery test는 lane별 성공·실패 coverage, 빈 보강 pool에서도 유지되는 degradation provenance,
불완전 Semantic Scholar pool의 Crossref 보강·combined rerank, Hugging Face만 target을 채워도 Semantic
Scholar 부족분의 Crossref 보강을 생략하지 않는 규칙, canonical arXiv cross-provider dedupe,
30,000-ID 선형 bound와 first·last·other
author의 균형 selection·partial coverage를
검사한다. deterministic rank test는 Core/Rising 최대 상한과 Broad 재분배, citation 0·venue 유무와 무관한
Core fail-closed, 미래 연도와 불완전 서지 identity 차단, DOI dedupe, junk type 제외, Core 안의 canonical
high-citation 예약, absolute eligibility floor, citation/recent lane을 query relevance로 오인하지 않는 규칙,
sparse Semantic Scholar·rich Crossref
동일 DOI의 deterministic metadata merge, age-adjusted momentum, author signal cap과 Crossref 3-lane
fallback을 고정한다. Renderer table test는 Total이 세 layer와 unclassified를 모두 포함하고 기본 선택되는지,
layer별 filter와 세로 위치 초기화가 가로 위치를 보존하는지, 서로 다른 query의 상대 score를 비교하지 않고
latest matching run과 same-run layer/rank만 사용하는지 검사하고, focusable region·명시적 shrinkable grid
track·bounded block size·양축 scrollbar와 네 개의 fallback navigation command를 고정한다. macOS Electron
geometry smoke는 실제 production CSS와 25행×11열
fixture를 BrowserWindow에 넣어 `scrollWidth > clientWidth`, `scrollHeight > clientHeight`와 양축 최대
offset 이동을 검사하므로 SSR markup·CSS 문자열만으로 scroll 가능성을 추정하지 않는다. transfer test는
JSON/CSV/BibTeX deterministic round-trip, DOI·fingerprint·
citation-key consistency, CSV formula injection 방어, HTTPS URL과 8 MB·500건 한도를 확인한다. service와
IPC test는 active project authorization, project isolation, strict sender/input, additive merge, rate-limit
failure isolation, basename-only dialog receipt와 record version conflict를 고정한다. SQLCipher smoke는
strong DOI/provider/canonical arXiv 우선 identity와 weak fingerprint fallback, 동일 fingerprint·서로 다른
DOI 보존, Hugging Face→Semantic Scholar canonical merge와 provider priority, ambiguous weak import 거절,
후보별 search conflict 격리와 normalized canonical conflict detail·`conflict_count`·index migration,
Crossref/import trust merge, sparse Semantic Scholar refresh의 기존 metadata·annotation 보존과 richer refresh의
stale AI invalidation, manual·AI annotation atomic CAS, soft delete, discovery policy·layer count·coverage·hit
provenance의 durability, 검색별 typed tag 누적·정규화 idempotence·tag-only AI 보존·conflict/failure 비적용과
search run restart reconciliation, pre-canonical legacy DB의 column/index migration·HF backfill·기존 conflict
보존을 실제 Electron ABI close/reopen으로
검증한다. AI test는 최대 50개
provider metadata와 bounded abstract prompt, detailed topic·keyword 분리, dynamic model·reasoning provenance,
manual annotation 비노출, exact record/version
response와 malformed·hallucinated·stale batch 전체 거절을 검사한다.
Project Chat Literature tool test는 trusted top-level message의 direct subject+action authorization과
negative command·검색 정책 meta-question denial, injected active project ID, cross-project 차단,
strict query/year/limit/tag, additive dedupe와 적용 tag receipt,
metadata-only count receipt, legacy reviewer exclusion과 125초 timeout override를 검사한다. cancel·terminal
뒤 늦은 provider completion은 commit·tool delivery·visible receipt를 만들지 않아야 한다.

Desktop Experiment test는 active project와 parent·metric·run의 project isolation, strict IPC와 preload
allowlist, idea/run optimistic version, target 없는 Objective와 objective-free exploratory run, trial idempotency,
immutable logging template snapshot, terminal evidence 불변성, execution grant와 log source 일치, JSONL field
coverage·각 lifecycle record의 필수 field·type·sequence·timestamp·lifecycle·hash 검증, 실패·불완전 log 보존과 valid comparable summary만의
ingestion을 검사한다. execution test는 authority·command·path·coverage를 묶은 immutable intent mismatch 차단,
process 완료 직후 durable `verifying` receipt, 검증 retry와 process 중복 실행 방지, terminal projection 복구를
검사한다. log viewer test는 매 요청의 full-file local SHA-256·byte·path·offset·truncation
검증, forged remote hash 거절, stale project response 폐기, 검증 후 local pagination과 raw path 비노출을 고정한다.
trajectory model test는 maximize/minimize best-so-far, 서로 다른
Objective·evaluator·dataset·holdout series 분리, baseline·optional target과 단일 point, Idea A→A-1
label·cycle/missing-parent fallback, outcome count·phase·best lineage report를 고정한다. SQLCipher Electron smoke는
composite foreign key, project별 sequence, append-only provenance, transaction 안의 capacity limit·CAS·실패 atomicity,
legacy run schema의 idempotent migration과 unverified legacy success 격리, 휴지통 뒤 실행 origin snapshot을 포함한
실험 이력 보존, current-marker 재격리와 unverified summary query·global-search 차단, legacy intent success 격리·origin backfill·tombstone,
close/reopen durability, interrupted running run의 `lost` reconciliation과 pending `verifying`
보존을 실제 native ABI에서 검증한다.
Renderer markup과 CSS test는 다섯 tab, MLOps summary, table overflow, honest unknown progress, logging field
add/delete와 example-only preview, outcome의 색상 외 symbol·text, graph scroll, print report와
`Local live / Runner not connected` 문구를 고정한다.

Runner는 별도 Go module이다. 최소 검증은 다음과 같다.

- `gofmt` 결과가 깨끗한지 확인
- `go test -race ./...`
- `go vet ./...`
- Linux binary build
- Python optimizer syntax compile

### GitHub Actions

- CI matrix: `format:check`, `contracts:check`, lint, typecheck, test, build
- Desktop Vitest는 파일 I/O·Git·PDF integration fixture의 CPU·filesystem contention으로 생기는 timeout을 막기
  위해 worker 수를 1로 고정하며, test 자체의 timeout을 느슨하게 늘려 통과시키지 않는다.
- Runner job: formatting, race test, vet, build, optimizer syntax
- Security workflow: 전체 Git 이력 secret scan, PR dependency review
- Actions는 최소 `contents: read` 권한과 commit SHA로 고정된 action을 사용한다.
- Dependabot은 npm, Go module과 GitHub Actions를 주 단위로 확인한다.

### 변경별 필수 테스트

- contract 변경: Zod parse, generated-schema drift, consumer fixture, Go mirror wire shape
- domain 변경: 정상 전이, 금지 전이, replay no-op, immutable field와 budget 경계
- API 변경: schema, lab·project isolation, 모든 role, idempotency conflict, version conflict
- relay 변경: Origin·native runner 인증, project isolation, duplicate·stale, backpressure, retention
- Desktop IPC 변경: trusted sender, untrusted frame, path escape, 크기 제한, secret 비노출
- Desktop menu·Settings 변경: fixed no-payload navigation event, early-event buffer, 표준 macOS role 보존
- Research Notes 변경: Vault-wide Renderer bridge 부재, strict project/binding IPC, root·project ownership
  identity, path traversal·ancestor/project-root symlink·foreign marker·managed-file collision·크기 제한,
  project isolation, default folder/template idempotency, deterministic Literature projection, one-time
  user-owned paper note, category-scoped agent artifact의 path 비노출·create-only·retry idempotency·저장 위치
  receipt·`staged|uncertain|committed-unreported|reported|abandoned` reconciliation·commit uncertainty,
  rename success·collision `rename-pending`, stale project 전환 응답 폐기, v2 schema와 reserved field,
  model frontmatter impersonation 차단, `created_at` 보존·`modified_at` 갱신, project/session ID·이름 pair,
  technical producer identity, project-relative document link·credential 없는 HTTPS paper link,
  producer별 동일 serializer 사용과 legacy/user-owned Markdown의 no-rewrite
- Project lifecycle 변경: Active/Archived/Trash의 중복 없는 분류, archive/unarchive stale version,
  archived mutation·chat·agent tool 차단, active-turn lifecycle gate, Archived→Trash→restore 상태 보존,
  두 단계 Trash UI, 같은 UUID와 task·objective·chat·outbox 보존, `EMPTY TRASH` typed phrase와 native
  confirmation, active/archived 제외, lifecycle lock의 fail-closed, expected revision·idempotency·reopen
  receipt, Project Chat·SSH·Lecture lifecycle lock, snapshot/outbox/receipt/module cleanup의 단일 transaction,
  mutable local projection만 정리하고 외부 Git/Obsidian/remote data와 durable history·guarded append-only
  provenance는 보존
- Project portfolio navigation 변경: 여러 folder 동시 펼침, 같은 folder 재선택 시 접힘, local hide·show·
  show-all, malformed/stale localStorage 복구, hidden·archived fallback과 project 간 active-tab 격리
- 로컬 통합 검색 변경: trusted fixed IPC·project/Trash 격리, archived read-only 일관성, category grouping,
  project/scope 전환의 stale response 폐기, 최신 Objective만 색인·click-time version 재검증, goal의
  baseline/target/guardrail/budget/stop policy, experiment metric/trial/value, Literature DOI/citation key/year/count,
  exact navigation target, bounded SQL·128개 초과 scope chunk, Research Notes round-robin·file/character budget,
  Git filename-only reader, 긴 path hash ID, source deadline·AbortSignal·cooperative partial과 pending-operation
  중첩 방지, partial/all failure·busy·truncation 표시, query/result 비지속성
- Project Chat native harness 변경: dynamic mode catalog·hash·TOCTOU, mode/model/reasoning fallback 금지,
  personality 지원, profile CAS, instruction revision, prompt hash·bound·truncation, project 격리,
  legacy reviewer action suppression, dynamic model/mode/reasoning provenance, session migration·branch lineage·
  provider-default·catalog 첫 reasoning을 쓰는 독립 end-to-end-bounded branch title job·late thread/turn cleanup·
  manual rename CAS·title provenance,
  project/session event isolation, sanitized Markdown·KaTeX, web-search mode provenance·no silent fallback과
  shell/browser/MCP 비활성 유지, PDF path/bytes/raw-text non-retention·scope·TTL·single-use·budget·revoke,
  session-scoped monotonic durable queue·서로 다른 session 병렬 실행·global capacity·restart drain·scheduler
  retry·attachment expiry terminalization·edit/remove/Run-now의 같은-session cancellation
- SSH broker 변경: global alias/direct-target registry와 project-scoped workspace grant 분리, deterministic
  command import·inactive loopback `-L`, credential·raw paste·raw output 비보존, root 축소 diagnostics와
  mode별 concrete executable·inspect/test/build/foreground-experiment policy, project-scoped structured resource
  read, app-owned fixed helper의 bounded text file list/read/create/expected-hash-checked atomic replacement,
  external-writer race와 post-mutation outcome uncertainty, physical no-symlink root check와
  secret/binary/oversize 차단, JSON stdin hash·actual target/root/file action/content exact Allow once binding과
  eligible trusted binding의 exact version·capacity reservation·append-only audit-before-execute,
  profile/grant CAS revalidation과 in-flight mutation/approval 경합, cancellation-only navigation IPC,
  OpenSSH argument array·direct `-F none`·
  background fork 차단·client diagnostic 격리, Test 결과의
  `ready|unknown_host_key|authentication_failed|timed_out|connection_failed` typed 분류, resource 상태의
  local client/transport/parser/`nvidia-smi` missing/no-GPU/malformed-output 분리, 세 absolute GPU binary
  후보의 executable-not-found-only fallback, timeout·capacity·local
  transport cancel, remote kill·hard
  confinement 비보증과 ephemeral approval metadata
- Literature 변경: active project 격리, Semantic Scholar·Crossref·Hugging Face Papers fixed-origin과 bounded
  metadata normalization, additive HF가 Semantic Scholar 부족분의 Crossref fallback을 막지 않는 규칙,
  policy-v3 provenance, strong DOI/provider/canonical arXiv identity와 weak fingerprint fallback, 동일
  fingerprint·다른 DOI 보존, canonical migration·provider priority·true conflict 격리,
  source/search-tag/manual/AI field ownership, optimistic annotation conflict, no-abstract retention,
  Main-owned no-symlink transfer, deterministic JSON/CSV/BibTeX와 metadata-only Codex provenance,
  Semantic Scholar fixed-origin·3-lane candidate pool·linear author bound·role-balanced sample·partial
  coverage, 부족한 pool의 Crossref supplement·combined rerank, cross-provider rich metadata·canonical merge,
  deterministic 3-layer ranking·Core canonical reserve와
  hit-level policy provenance, Project Chat의 shared policy·explicit command gate·injected project
  identity·typed search tag·receipt-only 결과·cancel/late-result 봉인, 검색 tag의 누적·정확 filter와
  provider/manual/AI topic 분리, legacy JSON/CSV·BibTeX tag round-trip, DOI → versionless canonical arXiv →
  credential 없는 HTTPS source의 shared landing-page 우선순위와 title/DOI action 일치, invalid URL의
  non-clickable fallback
- Runner 변경: signature·policy rejection, fence race, Stop·Kill race, exact JSON wire, Podman argument
  array와 fail-closed 설정
- connector 변경: deterministic fake response, capability 정확성, credential·원문 미저장

현재 빠진 검증은 실제 PostgreSQL·Redis runtime integration, process restart·outbox recovery,
실제 Podman GPU workload, macOS clean-machine OAuth·permission·notarization·update, 외부 connector
sandbox, 그리고 목표부터 논문·export·lecture까지의 최종 E2E다.

## 13. ADR 원칙

다음 변경은 구현 전에 Architecture Decision Record를 작성한다.

- 새 Hosted 데이터 종류 또는 retention 변경
- 새 프로세스·서비스·database·queue 도입
- module ownership이나 dependency direction 변경
- 인증·암호화·secret·network·mount·container 권한 변경
- contract의 breaking change 또는 state machine 의미 변경
- 새로운 AI provider, 자동 승인 범위 또는 무인 실행 범위
- canonical source나 conflict 정책 변경

ADR은 `docs/adr/NNNN-short-title.md` 형식을 권장하며 다음 항목을 포함한다.

1. Context와 해결할 문제
2. Decision과 명확한 범위
3. 검토한 alternatives
4. security·privacy·cost·migration 영향
5. rollout, rollback과 관측 방법
6. 구현·테스트 완료 조건

ADR은 현재 동작을 숨기는 계획 문서가 아니다. 결정이 구현되지 않았다면 상태를 Proposed로 두고,
구현 후 Accepted, 대체되면 Superseded로 변경한다.

## 14. 안전한 변경 레시피

### 새 command 또는 event 추가

1. 소유 모듈과 data authority를 정한다.
2. contracts에 versioned schema와 최소 payload를 추가한다.
3. domain에 순수한 authorization 외 결정과 상태 전이를 추가한다.
4. repository transaction에 state, audit, outbox를 함께 기록한다.
5. producer retry와 consumer idempotency를 정의한다.
6. 다른 lab·project, duplicate, stale, restart 테스트를 추가한다.

### contract 변경

1. additive·optional인지 breaking인지 판정한다.
2. breaking이면 새 version을 만들고 migration 기간의 reader 전략을 기록한다.
3. Zod source를 수정하고 JSON Schema를 생성한다.
4. Desktop, Sync, Runner, fixture를 한 PR에서 맞춘다.
5. generated file을 수동 편집하지 말고 `generate:check`를 통과시킨다.

### Hosted 필드 추가

1. 해당 값이 협업 metadata인지 먼저 증명한다.
2. source, note body, raw log·metric, artifact, secret 또는 hidden tool payload면 추가하지 않는다.
3. tenant·project authorization, RLS, retention, backup, log·trace 노출을 검토한다.
4. safe-payload 검사와 negative test를 추가한다.
5. PostgreSQL adapter를 runtime에 연결하기 전 memory와 PostgreSQL semantics를 동일하게 만든다.

### Runner capability 추가

1. threat model과 승인 주체를 ADR에 기록한다.
2. manifest contract, signature 범위, local policy, concrete executor에 각각 방어층을 둔다.
3. policy version·hash와 objective budget에 capability를 고정한다.
4. broad selector, privilege escalation, host escape와 secret leak의 negative test를 먼저 작성한다.
5. 실행 실패 시 안전한 상태와 reconciliation 절차를 정의한다.

특히 network는 Podman에 단순 bridge를 켜는 것으로 구현하지 않는다. DNS·IP·redirect·IPv6까지
enforce하고 감사할 수 있는 egress adapter가 생기기 전에는 계속 `none`으로 유지한다.

### LLM provider 또는 model 기능 추가

1. `LLMProviderAdapter`를 구현하고 provider credential은 로컬 provider store에 둔다.
2. model ID를 enum으로 만들지 않고 catalog 결과를 그대로 다룬다.
3. 실행마다 requested·resolved model, catalog version과 reasoning option을 기록한다.
4. catalog refresh 실패와 model disappearance를 명시적으로 처리한다.
5. AI 출력은 patch 또는 staging commit으로 만들고 승인 gate를 우회하지 않는다.

OpenClaw를 실제 provider로 승격하거나 bundled Hermes를 자동 update 또는 broader research-tool runtime으로
확장하는 경우에는 위 항목 외에도 upstream identity, 지원 protocol, signed update channel, credential ownership,
process sandbox, project capability mapping을 ADR로 확정해야 한다. 현재 GOSU release는 exact Hermes
source/version과 sealed ACP boundary를 검증한 runtime archive를 앱과 함께 배포하지만, 이것이 Hermes process를
hard sandbox하거나 독립 updater의 supply-chain policy까지 제공한다는 뜻은 아니다. CLI 이름 감지만으로
adapter를 connected로 바꾸거나 Codex 실패 시 silent fallback으로 선택해서는 안 된다.

### connector 추가

1. capability를 실제 지원 수준으로 선언한다.
2. credential provider와 connector를 분리한다.
3. canonical source, sync direction, cursor·idempotency, rate limit을 문서화한다.
4. 장애가 다른 connector와 core project command에 전파되지 않게 timeout과 error mapping을 둔다.
5. fixture에는 실제 연구 원문, repository private URL 또는 token을 넣지 않는다.

### Manuscript engine 추가 또는 교체

1. portable descriptor·binding·checkpoint·anchor를 재사용하고 provider URL·token·path를 공통 계약에
   추가하지 않는다.
2. descriptor capability와 adapter operation이 정확히 일치하는 registry test를 먼저 추가한다.
3. onboarding configuration과 credential은 provider-private Main/store가 소유하고 Renderer에는 fixed typed
   command만 연다.
4. immutable checkpoint fetch, artifact validation·cleanup, 장애 격리와 manuscript 전체 lineage를 구현한다.
5. checkpoint source를 engine 밖의 Review·Git bridge가 읽을 수 있도록 provider-neutral artifact
   materialize/read/export port와 canonical content digest를 별도 version으로 추가한다.
6. realtime provider는 checkpoint 외에 editor operation, compile, presence/comment/tracked-change와 session
   recovery contract를 별도 version으로 추가한다.
7. authority 변경은 동시에 staged된 old/new binding을 검증하는 migration 또는 handoff command·human
   approval로만 수행하고 두 provider를 동시에
   write authority로 만들지 않는다.
8. native migration 전 deterministic source-content digest, compile result와 rollback fixture를 검증한다.

## 15. 알려진 공백과 우선순위

### 프로덕션 전 필수

- Google·Apple OIDC/PKCE, invitation, membership, session issuance와 account linking
- PostgreSQL runtime wiring, migration 운영, Redis coordination와 transactional outbox publisher
- trusted ingress의 TLS·runner mTLS·service credential과 proxy spoofing 방어
- Desktop sync worker, offline command replay와 사람이 이해할 수 있는 conflict UI
- GitHub App 설치·token lifecycle, PR review·보호 branch·AI patch·base-SHA gate
- LaTeX editor·bundled Tectonic production compile·durable PDF artifact·review anchor·citation provenance,
  deterministic source digest와 Overleaf compiler/TeX Live 설정 provenance
- durable manuscript sync attempt·lease/fencing, explicit authority handoff, strict fetch-time disk quota,
  Overleaf review branch·conditional publish
- provider-neutral source artifact/editor/compile/realtime ports, generic provider onboarding/configuration
  storage와 staged multi-binding migration
- Runner enrollment, repository materialization, dataset·scratch resolver, artifact reference·upload,
  restart reconciliation
- bounded/full Autopilot approval와 manuscript evidence gate
- DMG signing, notarization, auto-update와 clean-machine test
- OpenClaw provider와 Hermes one-click installer의 signed distribution/update allowlist,
  credential ownership·sandbox·GOSU capability bridge 계약
- 실제 cross-application E2E와 장애 주입 테스트

### 구현과 문서가 어긋나기 쉬운 지점

- PostgreSQL adapter가 존재한다는 것과 실제 API가 PostgreSQL을 사용한다는 것은 다르다.
- UI에 보이는 버튼·차트가 실제 command나 experiment를 수행한다는 뜻은 아니다.
- Desktop Experiment의 tracked foreground run·on-demand server log와 local-live 갱신이 있다는 것과 durable
  Runner campaign·raw learning curve streaming이 연결됐다는 것은 다르다. Runner 연결 여부, 각 point source와
  log validation을 별도로 확인해야 한다.
- Project Chat이 연결됐다는 것과 Codex가 논문 파일을 쓰거나 자동실험을 실행한다는 것은 다르다.
- Overleaf Git project가 Manuscript에 연결됐다는 것과 GOSU가 Overleaf를 실시간 동기화·push하거나
  editing authority로 전환했다는 것은 다르다. Project Chat과 PDF preview가 읽는 것도 사용자가
  capture한 manual inbound checkpoint이지 live/unsaved Overleaf edit나 Overleaf 서버가 만든 PDF가 아니다.
  PDF는 로컬 MacTeX로 다시 compile한 prototype preview이므로 Overleaf compiler 설정과 다른 결과가 나올 수
  있으며 source는 아직 import/review candidate로 승격된 것이 아니다.
- OpenClaw CLI 이름이 감지됐다는 것과 안전한 Project Chat provider로 연결됐다는 것은 다르다. Hermes는
  사용자의 명시적 선택 뒤 bundled version·source revision·tree hash, pinned `0.19.1` sealed preflight와
  공식 ACP v1 adapter를 모두 검증해야 연결되며
  현재 native tool inventory는 비어 있고 web·native delegation·shell·process·code·file·browser·memory·
  skill·MCP·GOSU mutation tool을 차단한다. GOSU Board·Research Notes·
  Literature·SSH broker와 첨부는 아직 Hermes ACP에 직접 bridge하지 않았고, OpenClaw는 detector와 official
  setup guidance만 제공한다.
- SSH command broker가 있다는 것과 interactive terminal, 원격 process-tree kill 보증 또는 Runner 기반
  무인 실험 orchestration이 완성됐다는 것은 다르다.
- Repository file·history·branch·commit UI가 있다는 것과 GitHub App 로그인, PR merge 또는
  AI가 worktree를 자유롭게 수정할 권한이 있다는 것은 다르다.
- connector class가 있다는 것과 사용자의 OAuth 연결·증분 sync가 완성됐다는 것은 다르다.
- Literature의 citation·author·momentum ranking이 높다는 것과 paper full text를 읽어 연구 품질이나
  systematic-review evidence를 검증했다는 것은 다르다. 이 score는 discovery 우선순위일 뿐이며 Zotero
  자동 동기화와 background alert도 아직 수행하지 않는다.
- Obsidian의 `Literature Review.md`가 보인다는 것과 그 파일이 Literature 원본이라는 것은 다르다.
  authoritative source는 SQLCipher이며 managed file은 재생성 가능한 metadata-only projection이다. `Papers`
  note도 생성 시점의 metadata 초안이고 full text 검증이나 Zotero PDF 보관을 의미하지 않는다.
- Project Chat web search가 있다는 것과 browser·임의 URL fetch 권한이 있다는 것은 다르다. 연구 파일
  첨부도 one-turn bounded reconstruction·normalized-image capability이지 durable reference attachment·
  OCR·Office layout 복원·원문 검증이 아니다.
- Lecture Studio가 여러 project의 source를 합친다는 것과 arbitrary published-paper full text·PDF figure·live
  Overleaf workspace를 읽었다는 것은 다르다. Literature source는 metadata-only이고 Experiment source도
  저장된 summary/metric이다. Manuscript source는 사용자가 capture한 exact checkpoint에서 full hash를 검증한
  bounded `.tex`·`.bib` extract뿐이다. 사용자가 직접 추가한 `.tex/.md`는 bounded strict UTF-8 snapshot이고,
  `.pdf`는 selectable-text snapshot만 제공하므로 scan·figure·equation image와 layout은 포함하지 않는다.
  Overleaf URL도 Keychain-backed exact Git checkpoint로 capture한 시점만 source이며 provider의 이후 revision,
  provider-compiled PDF와 binary figure는 포함하지 않는다. 10/20/30/50분 선택은 slide-count budget이며 실제 발표 시간이나 rehearsal을 보증하지
  않는다. local PDF는 exact canonical Lecture LaTeX의 ephemeral MacTeX preview이며 PPTX가 아니다. 사용자가
  명시적으로 export한 `.tex`와 PDF copy만 외부 durable copy이고 immutable revision authority는 SQLCipher와
  Research Notes revision bundle에 남는다.
- macOS package 설정이 있다는 것과 배포 artifact가 서명·notarization됐다는 것은 다르다.
- manifest에 `allowlist` enum이 있다는 것과 Runner network 실행이 허용된다는 것은 다르다. 현재는
  명시적으로 거부된다.

## 16. 유지보수 체크리스트

### 모든 PR

- [ ] 변경의 소유 모듈과 authoritative source가 명확한가?
- [ ] 다른 앱·모듈의 persistence를 직접 읽지 않는가?
- [ ] untrusted input을 contract로 parse한 뒤 domain rule을 적용하는가?
- [ ] lab·project·role authorization이 command, query, search, stream 모두에 있는가?
- [ ] optimistic version, idempotency, replay와 conflict semantics가 정의됐는가?
- [ ] secret, 연구 원문, raw output가 DB·event·log·fixture에 들어가지 않는가?
- [ ] Git 변경이면 arbitrary command·hook·filter·protocol·remote URL 우회가 없는가? HEAD와 branch를
      함께 검증하고 destructive history 작업을 새 IPC에 넣지 않았는가?
- [ ] SSH 변경이면 global transport profile과 project workspace grant가 분리되고 raw paste·credential·
      private-key path가 저장·tool list에 노출되지 않는가? importer가 shell 없이 narrow option만 정규화하고
      forwarding을 자동 실행하지 않는가? active project binding, profile/grant CAS, actual target/root/mode/
      command exact approval, concrete executable·argument array·timeout·output non-retention·turn cleanup이
      유지되는가? root secret read, arbitrary shell·inline eval·privilege·transfer·unattended 실행이 승인 전에
      fail closed하는가? lexical root를 sandbox라 부르거나 local abort를 remote kill 보증, ephemeral metadata를
      durable 감사 원본이라 부르지 않는가? command approval이 argv/cwd만 고정하고 source file hash를
      고정하지 않는다는 한계를 표시하는가? remote file replacement를 CAS·serialized transaction이라
      부르지 않고 external-writer race와 post-mutation outcome uncertainty 뒤 same-path re-read/hash
      reconciliation을 요구하는가? root workspace execution은 prototype-only HIGH RISK로 표시하고 hardened
      production을 non-root isolated Runner로 제한하는가? trusted mode면 verified standard/root eligibility,
      ROOT 전용 추가 consent와 unknown 차단,
      exact project/grant/connection/root/policy version, pre-audit capacity reservation, append-only
      audit-before-execute와 mutation·cancel·shutdown 뒤 재검사를 모두 유지하는가?
- [ ] Literature 변경이면 provider raw response·abstract·local path를 저장하지 않고 project isolation,
      source/search-tag/manual/AI ownership, tag의 additive typed provenance, deterministic transfer와
      metadata-only AI provenance를 유지하는가?
      policy-v3 source를 바꾸면 Semantic Scholar authority lane, additive Hugging Face와 Crossref fallback의
      독립성을 유지하는가? canonical arXiv normalization·partial unique index·conflict provenance와
      `import < hugging-face < crossref < semantic-scholar` 우선순위를 보존하는가?
      ranking 변경이면 fixed policy version, deterministic layer quota, capped author signal, momentum의
      proxy 표기, absolute eligibility floor, lane coverage·degradation, hit-level provenance와 기존 run의
      재현성을 유지하는가? 서로 다른 query의 상대 score를 직접 비교하지 않는가?
      Project Chat search면 trusted user-message authorization, Main-injected project ID, receipt-only result와
      동일한 LiteratureService policy, cancel/late-result 봉인을 유지하는가?
- [ ] Research Notes 변경이면 Renderer에 Vault-wide path/read/write/delete 권한을 추가하지 않고 active
      project ID·binding ID·ownership marker·Vault identity를 모두 재검증하는가? 일반 Vault file과
      user-owned paper note를 덮어쓰지 않는가? Literature SQLCipher 원본과 deterministic Markdown projection,
      receipt journal의 terminal·restart·Vault reconnect 상태 전이, rename-pending/retry, project 전환
      generation guard와 Hosted Sync 본문 금지를 유지하는가?
- [ ] Lecture 변경이면 Workspace 전역 studio와 project-scoped output ownership을 분리하고 Project Chat
      history/tool grant를 재사용하지 않는가? summary/detail·bounded in-memory offset pagination, selected-ID
      직접 재검증, reviewed/included metadata-only status, frozen manifest와 actual model provenance를
      유지하는가?
      raw HTML/image·unknown citation·uncited substantive slide를 저장 전에 거부하고, Vault preflight와 두-file
      staged directory journal, exact-hash rollback/reconciliation, append-only revision과 실제 상대 path receipt를
      보존하는가?
- [ ] Project Chat web search 변경이면 actual mode를 profile·attempt에 기록하고 silent fallback 없이
      `disabled|cached|live`만 허용하는가? shell, browser, Apps, MCP와 general network가 계속 꺼져 있는가?
- [ ] Project Chat attachment 변경이면 local path·원본 bytes·raw extracted text·temporary image를 저장·
      동기화하지 않고 project/session scope, TTL, single claim, 개수·size·unit·character·pixel·archive
      budget, format authenticity, image modality fail-closed, untrusted marker와 모든 terminal/startup/
      session-transition revoke를 유지하는가?
- [ ] Usage 변경이면 Codex cumulative total cursor와 Hermes prompt-result usage만 사용하고 `last`, context
      pressure, raw response를 합산하지 않는가? cache/reasoning을 total에 중복 합산하지 않으며 unknown을
      0으로 만들지 않는가? 모든 model workload의 project/attempt attribution, local-only SQLCipher 보존,
      time-zone calendar boundary와 `sync_outbox` 비변경을 검증했는가?
- [ ] 실패·cancel·negative result provenance가 사라지지 않는가?
- [ ] 외부 장애가 독립 모듈을 막지 않는가?
- [ ] 구현 상태와 계획 상태를 README·architecture에서 정확히 구분했는가?
- [ ] 전체 `pnpm check`와 해당 runtime의 추가 gate를 통과했는가?

### contract와 state 변경

- [ ] version 호환성과 rollout 순서를 기록했는가?
- [ ] generated JSON Schema와 모든 consumer fixture가 갱신됐는가?
- [ ] duplicate, stale, out-of-order와 restart를 테스트했는가?
- [ ] state 전이가 한 곳의 domain rule로 유지되는가?

### 보안 경계 변경

- [ ] renderer 권한, IPC sender, CSP 또는 external navigation이 넓어지지 않았는가?
- [ ] Runner privilege, mount, network, secret, image·command allowlist가 fail-closed인가?
- [ ] credential이 URL, process argument, event 또는 진단 로그로 이동하지 않는가?
- [ ] 승인·budget·metric·dataset·base-SHA gate를 개발 모드에서도 우회하지 않는가?
- [ ] 새 Hosted 데이터에 RLS, retention, backup과 telemetry 검토가 있는가?

### 릴리스 전

- [ ] release revision의 CI·security check가 모두 성공했는가?
- [ ] 실제 production adapter와 설정이 문서의 주장과 일치하는가?
- [ ] migration rollback과 outbox drain·replay를 검증했는가?
- [ ] runner 중복 실행·Lost reconciliation·Stop·Kill 경합을 검증했는가?
- [ ] clean macOS 설치, OAuth, Keychain, folder permission, signing, notarization, update를 검증했는가?
- [ ] synthetic data E2E가 목표 설정부터 experiment, review, merge, export, lecture까지 통과하는가?

이 체크리스트를 통과하지 못한 기능은 UI에 존재하더라도 production-ready로 표기하지 않는다.
