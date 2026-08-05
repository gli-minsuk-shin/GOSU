# ADR 0002: Project-scoped Obsidian Research Notes

- Status: Accepted
- Date: 2026-08-06
- Owners: Obsidian Knowledge, Reference & Literature, Project Portfolio

## Context

초기 Desktop은 사용자가 선택한 임의 Markdown folder를 `Local Notes`로 읽었다. 이 방식은 Markdown
preview를 빠르게 검증하는 데는 유용했지만 다음 제품 요구와 맞지 않았다.

- 여러 project의 note를 한 화면과 하나의 Vault grant로 취급해 project 경계가 약했다.
- Literature, Experiments, 진행 기록과 idea lineage를 어디에 저장할지 일관된 구조가 없었다.
- project rename과 Obsidian folder 이름의 관계, 충돌과 복구 정책이 없었다.
- Renderer에 Vault 전체 selection과 read capability가 노출되어 최소 권한 원칙보다 넓었다.
- Literature SQLCipher table과 사용자가 보는 Obsidian Markdown 중 어느 쪽이 원본인지 불명확했다.

Obsidian은 사용자가 직접 편집하고 다른 plugin과 함께 쓰는 지식 저장소이므로 GOSU가 Vault 전체를
소유하거나 양방향 동기화를 흉내 내면 안 된다. 반대로 검색 문헌 표처럼 GOSU가 만든 결과를 사용자가
Obsidian에서 바로 읽을 수 있는 제한된 projection은 필요하다.

## Decision

### 1. 하나의 Vault, project별 binding

사용자가 Obsidian Vault root를 선택하면 Main process가 canonical path와 device/inode identity를
검증하고 암호화 local cache에 root만 보존한다. 각 active project에는 SQLCipher에 다음 local binding을
저장한다.

- stable project ID
- random 64-hex binding ID
- Vault ID
- current folder name과 desired folder name
- `ready | rename-pending` 상태와 bounded attention code
- 마지막 Literature projection 시각

Renderer와 Project Chat은 Vault ID나 absolute path가 아니라 active project의 binding ID를 사용한다.

### 2. Owned project root와 기본 구조

기본 project root는 `GOSU/<safe project name>`이다. 이름은 NFKC 정규화, separator/control 제거와
UTF-8 byte 제한을 적용한다. 다음 folder와 초기 Markdown을 idempotent하게 만든다.

- `Literature`
- `Papers`
- `Experiments`
- `Project Progress`
- `Idea Development`

root의 `.gosu-project.json`은 project ID, binding ID와 Vault ID를 기록하는 ownership marker다. 모든
managed write와 agent read는 marker와 root identity를 다시 검증한다. 기존 사용자 folder와 이름이
충돌하면 덮어쓰지 않고 최초 할당에 project ID prefix suffix를 사용한다.

### 3. 제한된 write 모델

일반 Vault content는 GOSU가 수정하지 않는다. 허용된 write는 세 종류뿐이다.

1. owned project root의 초기 folder/template 생성
2. `Literature/Literature Review.md` deterministic managed projection
3. 사용자가 요청하거나 review/metadata 정리한 record의 `Papers/<record>.md` 최초 생성

managed Literature file은 GOSU marker와 project ID가 있는 기존 file만 atomic replace한다. paper note는
최초 생성 뒤 user-owned이며 다시 덮어쓰지 않는다. Renderer에는 generic filesystem write, delete, rename,
Vault-wide read IPC를 제공하지 않는다.

### 4. Authoritative source와 projection

Literature SQLCipher table이 서지 metadata, search tag, review와 AI annotation의 authoritative source다.
검색, import, annotation, delete 또는 AI metadata 정리가 commit된 뒤 Markdown table을 재생성한다.
projection 실패는 Literature transaction을 rollback하지 않으며 다음 Research Notes 진입이나 Literature
변경에서 재시도한다. 생성 결과가 byte-for-byte 같으면 파일을 교체하지 않는다.

paper note는 metadata-only provenance와 빈 human review section을 포함한다. full text를 실제로 읽지
않았다면 `metadata_only: true`, `full_text_reviewed: false`를 기록한다.

### 5. Rename과 lifecycle

project rename은 workspace DB를 먼저 commit하고 그 뒤 owned Obsidian folder를 옮긴다. destination
collision, missing source, marker 변경 또는 offline Vault이면 기존 folder를 그대로 두고
`rename-pending`으로 기록한다. UI가 상태와 retry를 제공하며 pending 동안 Project Chat note tool은
비활성이다. 같은 Vault 재선택은 기존 binding과 collision suffix를 재사용하고, 대소문자만 달라진 이름은
같은 directory identity인지 확인한 뒤 rename한다. Archive와 Trash는 Obsidian file을 자동 삭제하지 않는다.

### 6. AI access

Research Notes는 profile에서 명시적으로 승인해야 한다. Main은 active project, binding, Vault root와
ownership을 매 turn 재검증한다. list는 opaque note ID와 title, read는 bounded excerpt만 반환한다.
다른 project와 일반 Vault content는 tool catalog에 들어가지 않는다.

## Alternatives considered

### Vault 전체 read/write

Obsidian과 가장 비슷한 경험을 빠르게 만들 수 있지만 project isolation과 최소 권한을 훼손하고 사용자
plugin/file을 덮어쓸 위험이 있어 거절했다.

### project마다 별도 Vault 선택

물리적 격리는 강하지만 project 전환 때마다 권한 선택이 반복되고 하나의 연구 Vault에서 backlink를 쓰는
Obsidian workflow와 맞지 않아 기본값으로 채택하지 않았다.

### Obsidian Markdown을 Literature 원본으로 사용

사람이 직접 편집하기 쉽지만 deterministic dedupe, optimistic version, search provenance와 structured
export를 안정적으로 유지하기 어려워 거절했다. Markdown은 projection으로 유지한다.

### Git repository에 모든 research note 저장

공유와 history에는 유리하지만 개인 Vault, local attachment와 Obsidian workflow를 강제로 Git에 넣게 되어
별도 explicit snapshot/export 범위로 남겼다.

## Consequences

장점:

- project 전환과 AI tool이 같은 격리 경계를 사용한다.
- Literature 결과를 Obsidian에서 바로 읽으면서 structured 원본과 재현성을 유지한다.
- 사용자 note와 기존 folder를 자동 덮어쓰지 않는다.
- rename 실패가 project metadata rename을 되돌리거나 다른 모듈을 중단시키지 않는다.

비용과 한계:

- Obsidian 변경을 GOSU Literature table로 가져오는 양방향 sync는 제공하지 않는다.
- project folder rename은 local filesystem의 동시 변경과 충돌할 수 있어 retry UI가 필요하다.
- paper full text, PDF와 Zotero attachment는 자동 보관·검증하지 않는다.
- Native descriptor-relative `openat` traversal이 없어 정교한 local directory-swap 공격을 완전히 제거하려면
  후속 native hardening이 필요하다.

## Rollout and rollback

- 기존 `localNotesVault` profile column과 `list_local_notes`/`read_local_note` tool 이름은 저장·protocol
  호환을 위해 유지하되 값은 새 project binding ID를 가리킨다.
- 기존 grant가 새 binding과 일치하지 않으면 자동 이전하지 않고 UI에서 재승인을 요구한다.
- Obsidian 연결을 끊거나 기능을 rollback해도 project folder와 user-owned paper note는 삭제하지 않는다.
- managed Literature file은 marker가 없으면 더 이상 갱신하지 않고 conflict로 중단한다.

## Verification

- strict project-scoped IPC와 Vault-wide Renderer bridge 부재
- safe folder name, traversal, symlink, marker/ownership과 managed-file collision
- project 간 list/read와 stale binding 격리
- default structure의 idempotent 생성
- Literature Markdown의 deterministic order와 source digest
- paper note 최초 생성 및 이후 사용자 편집 보존
- rename 성공, destination collision과 `rename-pending` 복구
- Literature commit과 Obsidian projection 실패의 장애 격리
