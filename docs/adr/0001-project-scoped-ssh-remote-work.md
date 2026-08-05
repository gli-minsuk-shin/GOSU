# ADR 0001: Project-scoped SSH remote work

- Status: Accepted
- Date: 2026-08-05
- Owners: AI Gateway, Integration Hub, Project Portfolio

## Context

GOSU 사용자는 Terminal에서 쓰던 SSH 연결 명령을 Connections에 붙여 넣고, Project Chat이 등록된
서버에서 해당 프로젝트의 작업을 수행하기를 원한다. 기존 구현은 `~/.ssh/config`의 alias와 승인형
read-only 진단 명령만 지원한다.

전체 SSH 문자열을 그대로 실행하거나 하나의 서버 작업 폴더를 모든 프로젝트가 공유하면 command
injection, secret 노출, 프로젝트 간 경로 혼합, 권한 오용이 발생한다. 특히 임대 GPU 서버에서 흔한
`root` 계정은 project code를 실행하는 것만으로 host 전체를 변경할 수 있으며, 단순한 `cd`는 filesystem
sandbox가 아니다.

## Decision

1. SSH transport profile은 이 Mac의 모든 local project가 공유하는 SQLCipher registry가 소유한다.
   profile은 기존 OpenSSH alias 또는 정규화된 direct target(`host`, optional `user`·`port`) 중 하나다.
   비밀번호, private-key 경로와 원본 paste 문자열은 저장하지 않는다.
2. command importer는 shell이나 LLM을 호출하지 않는 bounded parser다. `ssh`, `-p`, `-l`, 하나의
   destination과 loopback-only `-L`만 인식하며 remote command, quoting·expansion, key·proxy·TTY·agent
   forwarding option을 거절한다. `-L`은 inactive plan으로만 보존하고 Project Chat transport에는 적용하지
   않는다. 사용자가 display label을 생략하면 endpoint 대신 opaque default label을 만들어 model-visible
   workspace catalog가 host·user·port를 우회 노출하지 않게 한다.
3. 원격 workspace 권한은 global connection profile과 분리한 project-scoped, versioned grant다. grant는
   `projectId`, `connectionId`, canonical remote root, permission mode를 소유한다. Main process가 active
   project binding을 주입하며 모델은 project ID나 root를 선택·변경할 수 없다.
4. `diagnostics`가 기본 mode다. `workspace` mode는 사용자가 프로젝트별로 명시적으로 켜고 remote root를
   지정해야 한다. `root` login은 별도의 고위험 확인을 요구하며 승인 화면에 실제 target, ROOT 표시,
   project·chat, workspace root, risk class와 exact command/args를 표시한다. alias profile은 실제 target과
   account privilege를 고정할 수 없어 `workspace` mode를 허용하지 않고 diagnostics에서도 privilege unknown
   고위험 대상으로 표시한다. user를 생략한 direct target도 account privilege는 unknown이며 workspace
   opt-in과 매 command 경고가 필요하다. 명시적 `root`가 아닌 unknown target이 실제 root인지 Main이 감지할
   수 없다는 한계를 UI와 문서에 유지한다.
5. Project Chat은 raw shell, interactive TTY, `sudo`·`su`·`doas`, nested SSH·file transfer, port forwarding,
   background/unattended 실행을 받지 않는다. Main의 typed tool과 bounded executable/argument policy만
   사용하고 모든 실행에 새 `Allow once` 승인을 요구한다. profile과 grant version은 승인 뒤 실행 직전에
   다시 확인하며, 이미 시작된 profile·grant mutation queue가 끝난 뒤에만 transport를 시작한다. Node
   실행은 명시적인 `node --test`만 test로 인정하고 일반 script 실행은 거절한다.
6. system diagnostics와 workspace work는 별도 tool과 policy를 사용한다. privileged target의 diagnostics는
   secret-bearing file/process 내용을 읽을 수 없는 축소 allowlist를 사용한다. workspace mode는 정확한
   working directory와 직접 인자를 요구하고, 실행될 project code가 host 권한으로 동작할 수 있다는 사실을
   숨기지 않는다. Git inspection은 subcommand별 argument schema와 강제된 no-hooks, no-fsmonitor,
   no-external-diff/textconv, no-pager 설정을 사용한다.
7. OpenSSH child는 `shell: false`, strict host key, non-interactive authentication, forwarding off와 bounded
   timeout/output으로 실행한다. direct target은 user SSH config를 읽지 않는다. raw stdout/stderr와 pasted
   command는 SQLCipher, Hosted Sync, outbox, telemetry, Git에 저장하지 않는다.
8. Stop·timeout은 local OpenSSH transport를 종료할 뿐 remote process tree 종료를 보증하지 않는다.
   장기·무인 실험과 강한 filesystem/process isolation은 signed manifest, non-root container,
   lease·fencing·reconciliation을 제공하는 Runner가 담당한다.

## Alternatives considered

- 원본 SSH command를 shell로 실행: 가장 편하지만 injection과 option smuggling을 막을 수 없어 거절한다.
- `~/.ssh/config`만 지원: 안전 경계는 단순하지만 임대 GPU 서버의 일회성 direct target UX를 충족하지 못한다.
- workspace root를 connection profile에 저장: 모든 프로젝트가 같은 root와 권한을 공유해 isolation을 깨므로
  거절한다.
- Project Chat에 interactive terminal 제공: 승인 단위와 output retention을 통제하기 어려워 MVP에서
  제외한다.
- 모든 `root` target 차단: 안전하지만 실제 GPU 임대 환경을 사용할 수 없다. 대신 명시적 고위험 opt-in과
  매 command 승인을 사용하고, Runner가 준비되기 전에는 강한 confinement를 주장하지 않는다.

## Security, privacy, cost, and migration

- 기존 alias profile은 direct target이 없는 legacy row로 그대로 읽는다.
- direct target과 project grant는 local SQLCipher에만 저장하며 Hosted Sync 대상이 아니다.
- `list_ssh_workspaces`는 active project에 속한 opaque grant ID, connection label과 permission mode만 모델에
  반환한다. host, username, port와 root path는 tool catalog/list 결과에 포함하지 않는다.
- raw remote output은 현재 turn의 untrusted ephemeral tool result로만 전달한다.
- remote execution 비용과 변경 위험은 사용자가 소유하며, GOSU는 command별 승인과 명확한 warning을 제공한다.

## Rollout and rollback

- importer와 project grant UI를 feature-complete vertical slice로 배포한다.
- schema migration은 additive column/table만 사용한다. importer 또는 workspace mode를 숨겨도 기존 alias와
  diagnostics는 계속 동작한다.
- direct target 또는 grant를 삭제하면 관련 pending/active approval을 취소한다.
- forwarding activation, interactive shell과 unattended execution은 별도 ADR 없이는 추가하지 않는다.

## Completion criteria

- 대표 direct command와 trailing loopback `-L`이 raw 실행 없이 정규화되고 재등록은 idempotent하다.
- shell syntax, remote command, dangerous option, non-loopback forwarding과 synthetic secret-shaped fixture가
  거절된다.
- project A grant가 project B tool·UI·approval에서 보이지 않으며 grant/profile version race가 fail closed한다.
- root workspace opt-in과 HIGH-RISK approval이 없으면 workspace command가 실행되지 않는다.
- exact target/root/command를 승인한 뒤에만 bounded command가 실행되고 raw output은 저장되지 않는다.
- cancel, timeout, navigation, connection/grant deletion과 app shutdown이 pending/active local transport를
  정리한다.
- SQLCipher reopen, IPC sender/input validation과 Project Chat tool binding 자동 검증을 통과한다. 생성된
  DMG의 codesign 검증·mount·설치·launch는 수동 release smoke로 확인한다.
