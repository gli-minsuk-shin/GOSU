# GOSU Project Chat Sessions, Math, Native Reasoning & SSH — 실행 Prompt

## 역할

당신은 GOSU의 local-first Electron/React 연구 운영 앱을 유지보수하는 senior product and security engineer다. 기존 SQLCipher 저장소, Electron Renderer sandbox, typed IPC allowlist, 프로젝트 격리, Codex App Server의 동적 model catalog, visible-chat provenance를 보존하면서 Project Chat을 실제 연구 세션과 원격 서버 작업에 사용할 수 있게 확장하라.

## 구현 목표

1. 하나의 프로젝트에 여러 개의 독립된 채팅 session을 둔다.
2. 프로젝트에는 항상 기본 session 하나가 있고 새 session을 만들 수 있다.
3. 완료된 기존 message를 분기점으로 새 session을 만들 수 있다.
4. 모든 user/assistant message에서 `$...$` inline math와 `$$...$$` block math를 안전하게 렌더링한다.
5. reasoning picker는 선택한 model이 `model/list`에서 광고한 native effort ID만 짧게 표시한다.
6. 사용자가 로컬에서 등록한 SSH connection을 모든 프로젝트의 AI가 발견할 수 있게 하되, 원격 명령은 매번 사용자의 명시적 승인을 받은 뒤에만 실행한다.

## Codex App Server에서 그대로 채택할 계약

- `model/list`의 `supportedReasoningEfforts[].reasoningEffort`를 option ID와 화면 label로 사용한다. 설명 문장을 option label로 대신 쓰거나 `medium / high / xhigh / max / ultra`를 앱에 하드코딩하지 않는다.
- `defaultReasoningEffort`는 model default 표시 판단에만 사용하고 사용자가 `Model default`를 선택하면 null을 보낸다.
- 선택한 effort가 갱신된 catalog에서 사라지면 자동 fallback하지 않고 send를 중단해 다시 선택하게 한다.
- Codex App Server는 `thread/start`, `thread/resume`, `thread/fork(lastTurnId)`를 제공하지만 GOSU의 동기화 가능한 canonical history는 암호화된 visible message다. 현재 ephemeral Codex transport 경계를 유지하고, GOSU session lineage가 분기된 visible history를 결정한다.
- 실제 model ID, catalog snapshot, effective reasoning ID는 기존 provenance에 계속 기록한다.

## 1. 프로젝트별 다중 채팅 session

### 공개 계약

`ProjectChatSession`을 versioned strict schema로 추가한다.

- `id`, `projectId`, `title`, `createdAt`, `updatedAt`
- immutable default marker `isDefault`, optional `parentSessionId`, `branchedFromMessageId`
- 프로젝트마다 default root marker는 정확히 하나다. title rename은 허용하지만 default·project·lineage
  marker는 외부 command와 DB update/delete trigger로 바꾸지 못한다.
- 초기 default title은 `Project chat`이다. title은 trim 후 1–120자이며 새 root chat은 충돌하지 않는
  `New chat`, `New chat 2` 형식으로 만든다.

Session command를 fixed IPC channel로 제공한다.

- session 목록과 선택 session snapshot 조회
- 새 root session 생성
- 특정 완료 message까지의 history를 상속하는 branch session 생성
- session rename

기존 snapshot/send/cancel/event/action command에는 `sessionId`를 포함한다. Main에서 session과 message가 요청 project에 속하는지 다시 확인한다.

### 저장과 migration

- SQLCipher에 `project_chat_sessions`를 추가한다.
- message와 attempt에 `session_id`를 추가하고 새 write는 항상 session을 요구한다.
- 기존 project chat data는 프로젝트별 default root session 하나에 lossless하게 귀속한다.
- chat이 없던 기존 project는 Main이 active project 존재·Archive·Trash 상태를 먼저 검증한 뒤 최초 조회 때
  default session을 idempotent하게 생성한다. 유효하지 않은 project UUID에 orphan session을 만들지 않는다.
- branch는 message 본문이나 provenance를 복제하지 않는다. immutable parent lineage와 branch message boundary를 저장하고, source session의 선택 message까지 immutable message membership만 새 session에 원자적으로 연결한다. 이후 source message는 child로 유입되지 않는다.
- branch message는 source session의 effective history에 속하고 terminal 상태여야 한다. 다른 project, 미래 message, active/incomplete turn에서 분기하지 않는다.
- branch depth와 effective message 수에 상한을 두고 cycle 또는 손상된 lineage는 fail closed 한다.
- retry target과 proposed action은 현재 session lineage 안에 있을 때만 사용할 수 있다.

### 동시성과 UI

- active turn, loading state, cancel은 `projectId + sessionId` 단위로 식별하되 한 project에서는 동시에
  하나의 turn만 실행한다.
- profile mutation과 project archive/trash는 해당 project의 어느 session에서든 turn이 실행 중이면 잠근다.
- Project Chat 상단 또는 왼쪽 rail에 전체 session 목록, 현재 session, `New chat`을 표시한다.
- 각 message에 `Branch from here`를 제공하고 성공하면 새 session으로 이동한다.
- 새 session/분기 session 전환 시 unsent draft는 keyed chat view보다 오래 사는 Desktop shell의
  project+session별 Renderer volatile memory에 보존해 돌아왔을 때 복원하고, retry state와 scroll 위치도
  다른 session으로 새지 않게 한다. draft는 DB·Sync에 저장하지 않으며 성공한 send 뒤 해당 session 값만
  지운다. 같은 project+session의 parent rerender나 model·reasoning 변경은 typed draft, retry target,
  Advanced 열림 상태를 초기화하지 않고 실제 project/session identity 전환에서만 hydrate/reset한다.
- session list와 snapshot hydration은 느린 이전 응답이 현재 선택을 덮지 못하도록 generation guard를 사용한다.

## 2. LaTeX math rendering

- user와 assistant가 공유하는 `react-markdown` pipeline에 `remark-gfm`, `remark-math`,
  `rehype-sanitize`, `rehype-katex`, local `katex` CSS를 사용한다.
- inline math는 `$x^2$`, display math는 `$$\nE = mc^2\n$$` 형식을 사용한다.
- user message와 assistant message에 같은 renderer를 적용한다.
- raw HTML은 `skipHtml`로 비활성화하고 exact HTTPS link만 system browser IPC로 열며 image는 remote fetch
  대신 blocked placeholder로 바꾼다.
- sanitizer를 KaTeX보다 먼저 실행해 기본 safe tree와 `math-inline`·`math-display` marker만 보존한다.
  그 뒤 local KaTeX가 `trust: false`, bounded expansion·size로 HTML/MathML을 생성하게 해 임의 HTML은
  실행되지 않고 수식 때문에 network를 요청하지 않게 한다.
- 잘못된 수식은 transcript 전체를 깨뜨리지 않고 원문 또는 명확한 error styling으로 남긴다.
- Project Chat developer instruction에 모든 수식을 위 두 delimiter로 작성하고 LaTeX document wrapper나 `\(...\)`를 사용하지 말라는 규칙을 추가한다.

## 3. Native reasoning picker

- catalog adapter는 reasoning option label을 provider description이 아니라 opaque native effort ID로 전달한다.
- UI는 `Model default` 다음에 live catalog 순서 그대로 짧은 ID만 표시한다.
- ID를 번역·축약·정렬·추측하지 않는다.
- model 변경 시 새 model이 지원하지 않는 기존 effort는 자동 변경하지 않고 unavailable 상태를 보여준다.
- turn 직전 cached catalog 대신 fresh `model/list`를 다시 조회해 explicit model·reasoning ID를 검증하며,
  사라진 ID는 provider fallback에 맡기지 않고 중단한다.
- fixture catalog에 새로운 effort를 추가하면 앱 업데이트 없이 picker에 그대로 나타나야 한다.

## 4. 승인형 SSH connection과 chat tool

### Connection 원본과 secret 경계

- SSH connection은 이 Mac의 encrypted local DB에만 저장하며 Hosted Sync, Git, telemetry에 넣지 않는다.
  connection registry는 이 Mac의 모든 local project가 공유한다.
- MVP profile은 display label과 concrete OpenSSH host alias만 저장한다. password, private key, token, raw SSH config, server file은 저장하지 않는다.
- 인증은 system OpenSSH, `~/.ssh/config`, ssh-agent/Keychain을 사용한다.
- Renderer는 private key path나 resolved host credential을 받지 않는다.
- 사용자가 Connections 화면에서 alias를 추가·rename·remove하고 연결을 test할 수 있게 한다.
- `StrictHostKeyChecking=yes`, `BatchMode=yes`, 짧은 connect timeout을 사용한다. known_hosts에 없는 host는 자동 승인하지 않고 사용자가 Terminal에서 fingerprint를 확인하도록 안내한다.

### 명령 실행

- chat tool은 먼저 connection의 opaque ID와 display label만 나열한다.
- 실행 요청은 `connectionId`, `command`, `args[]`, optional absolute working directory, bounded timeout의 구조화된 값만 받는다.
- local process는 `spawn`/`execFile` argument array를 사용하고 local shell을 거치지 않는다.
- remote shell 전달을 위해 각 command/arg를 검증된 POSIX single-quote encoding으로 직렬화한다. raw operator string, newline, NUL, control character를 거부한다.
- forwarding, TTY, local command, password prompt를 끄고 stdout/stderr와 실행 시간을 제한한다.
- executable은 `/bin`, `/sbin`, `/usr/bin`, `/usr/sbin` 아래 concrete system path여야 하고 basename은
  고정된 read/diagnostic allowlist에 있어야 한다. `hostname`, `date`, `nvidia-smi`는 query-only argument를
  별도로 검증한다. arbitrary script·file/process/container mutation, privilege escalation, shell·interpreter
  eval, transfer와 forwarding은 Allow once UI에 도달하기 전에 fail closed한다.
- 모든 실행은 exact connection label, command preview, project/session을 보여 주는 `Allow once / Deny`
  승인 UI를 거친다. timeout·cancel·project/session 전환 시 Renderer에 보이는 승인만 지우는 데 의존하지
  않고 Main이 해당 attempt의 abort signal과 scope epoch를 폐기한다. 이때 pending·active transport와 전환
  race 뒤 도착하는 future SSH tool call도 fail closed하되, SSH 밖의 Codex turn은 계속 진행할 수 있다.
- dynamic tool의 기본 timeout은 10초다. registration에 선언된 tool만 최대 180초의 고정 override를 가질
  수 있고, `run_ssh_command`만 30초 approval과 최대 120초 execution을 포함하는 155초 bound를 사용한다.
  모델 input으로 tool timeout을 확대하지 않는다. timeout과 thread revoke는 handler에 AbortSignal을
  전달하며, timeout 응답 뒤에도 실제 handler가 settle할 때까지 in-flight capacity를 유지해 zombie 작업이
  동시 호출 상한을 우회하지 못하게 한다.
- 허용된 read/diagnostic command도 승인 없이 실행하지 않는다. 사용자가 exact alias와 preview를 직접
  검토한 뒤 실행마다 `Allow once` 해야 하며 승인을 기억하거나 unattended 실행으로 전환하지 않는다.
- timeout·cancel·turn 종료는 local OpenSSH transport만 종료한다. command가 이미 시작됐다면 remote process
  또는 그 child의 종료를 보증하지 않으므로 장기·무인 workload는 Runner를 사용한다.
- raw SSH output은 해당 turn의 Main memory와 bounded tool result에서만 일시적으로 다루고 DB, Hosted Sync,
  outbox, telemetry에 저장하지 않는다. tool result가 assistant의 visible reply에 포함된 경우 그 reply만
  기존 chat 정책에 따라 저장한다. approval request·binding·allowed/denied/expired/cancelled outcome도 현재
  process/turn의 ephemeral event이며 durable audit log가 아니다.
- active project/session이 바뀌거나 turn이 끝나면 해당 dynamic tool capability와 pending approval을 폐기한다.

## UI

- Project Chat session rail은 긴 제목 ellipsis, empty/default/branched 상태, active turn 상태를 구분한다.
- branch origin은 `Branched from <session> at <time>`처럼 표시하되 내부 Codex thread ID는 노출하지 않는다.
- message 본문은 Markdown typography와 KaTeX가 현재 font size/theme을 따른다.
- reasoning select에는 짧은 native ID만 보이고 선택한 option 설명은 필요할 때 별도 보조 text로만 표시한다.
- Connections에 `SSH servers` card를 추가해 alias, 상태, test, remove를 제공한다.
- SSH approval은 command와 target을 읽기 쉽게 보여주며 keyboard로 승인/거부할 수 있다. 승인 button을 기본 focus로 두지 않는다.

## 명시적 제외 범위

- Hosted Sync의 session 동기화와 multi-user 실시간 session editing
- Codex rollout 파일을 GOSU canonical chat data로 사용
- session hard delete, message edit/delete
- SSH password 저장, private-key import, host-key 자동 신뢰
- interactive PTY, long-running daemon, file upload/download, port forwarding
- 승인 기억하기, wildcard command allowlist, unattended SSH autopilot
- remote raw output과 terminal transcript의 영구 저장

## 필수 테스트

1. 기존 단일 chat이 default session으로 lossless migration되고 restart 후 유지된다.
2. chat이 없던 project에 default session이 정확히 하나만 생성된다.
3. 새 root session의 history가 다른 session과 섞이지 않는다.
4. branch는 선택 message까지의 ancestor history만 포함하고 이후 message를 포함하지 않는다.
5. cross-project/session branch, retry, action, cancel을 API와 storage 모두에서 거부한다.
6. concurrent hydration/event 순서가 바뀌어도 선택 session과 최신 snapshot이 되돌아가지 않는다.
7. inline/block math가 렌더링되고 raw HTML/script는 실행되지 않는다.
8. malformed math가 chat 전체를 crash시키지 않는다.
9. model fixture의 native reasoning IDs가 설명문 없이 같은 순서로 picker에 나타난다.
10. 사라진 reasoning ID는 자동 fallback되지 않는다.
11. SSH profile에는 alias/label만 저장되고 secret·resolved credential이 Renderer나 DB row에 남지 않는다.
12. unknown host, auth failure, timeout, oversized output, invalid command/arg가 bounded error가 된다.
13. 승인 전에는 SSH process가 시작되지 않고 Deny/timeout/cancel은 실행을 0회로 유지한다.
14. 승인된 command도 fixed SSH safety option과 output/time budget을 우회하지 못한다.
15. concrete system executable과 query-only read/diagnostic allowlist 밖의 command·subcommand·script·
    mutation·privilege·shell·transfer는 승인 UI 전에 거부된다.
16. 허용된 diagnostic도 정확한 `Allow once` 이전에는 local SSH process를 시작하지 않는다.
17. project/session 전환, app shutdown, Codex disconnect에서 pending approval과 local SSH child를 정리하되
    remote process-tree kill을 보증한다고 주장하지 않는다.
18. raw output과 approval metadata가 restart 가능한 DB·outbox·telemetry에 남지 않는다.
19. Codex·SSH 장애 중에도 Board, Local Notes reader, 기존 chat history가 정상 동작한다.
20. 전체 `pnpm check`, macOS local DB smoke, package build를 통과한다.

## 완료 조건

- 앱 버전을 `0.10.0`으로 올린다.
- 실제 macOS arm64 DMG를 생성하고 `/Applications/GOSU.app`을 복구 가능하게 교체한다.
- 기존 사용자 data로 default session migration, 새 chat, message branch, math rendering, native reasoning label, SSH connection UI를 시각 검증한다.
- `docs/ARCHITECTURE.md`를 갱신한다.
- 이 prompt와 architecture 문서를 Obsidian mirror와 byte-identical하게 유지한다.
- feature branch, commit, PR, CI 통과, `main` squash merge까지 완료한다.
