# GOSU Kanban Operational MVP — 실행 Prompt

## 역할

당신은 GOSU의 local-first Electron/React 연구 운영 앱을 유지보수하는 senior product engineer다. 현재 Board는 고정 5개 column, task 생성·제목 수정·status 이동만 지원한다. 기존 SQLCipher workspace, optimistic entity version, typed IPC allowlist, project 격리, offline outbox를 깨뜨리지 않고 실제로 사용할 수 있는 Kanban MVP로 확장하라.

## 공식 제품 조사에서 채택할 원칙

- Trello처럼 card를 column 사이에서 drag-and-drop으로 이동하되 keyboard/button fallback을 유지한다.
  - https://support.atlassian.com/trello/docs/moving-cards-or-lists/
- Jira처럼 column 이름·순서와 WIP constraint를 설정할 수 있게 하고, WIP limit은 hard block이 아니라 soft warning으로 표시한다.
  - https://support.atlassian.com/jira-software-cloud/docs/configure-columns/
- GitHub Projects처럼 사용자화된 Board column과 filter를 제공하되 이번 slice에는 saved multi-view를 넣지 않는다.
  - https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project
- Linear처럼 priority는 `No priority / Low / Medium / High / Urgent`의 제한된 집합으로 유지하고 label·due date·filter를 제공한다.
  - https://linear.app/docs/priority
  - https://linear.app/docs/filters
- 삭제보다 archive/restore를 기본으로 사용해 연구 provenance를 보존한다.
  - https://support.atlassian.com/trello/docs/archiving-and-deleting-cards/

## 호환성 불변식

1. 내부 task status ID `backlog / planned / in_progress / review / done`은 변경하지 않는다.
2. arbitrary column 추가·삭제는 이번 slice에서 구현하지 않는다.
3. 기존 v0.3.2 snapshot은 strict schema version 1이며 새 필드가 없다. 새 Project/Task 필드는 optional로 파싱하고 runtime resolver가 default를 제공해야 한다.
4. top-level required field를 추가하거나 workspace schema version을 올리지 않는다.
5. Board 설정 변경은 Project의 optimistic `version`을 사용한다.
6. Task 수정·이동·archive/restore는 Task의 optimistic `version`을 사용한다.
7. state snapshot과 outbox operation은 기존처럼 하나의 SQLCipher transaction에서 commit한다.
8. 다른 프로젝트의 Board 설정이나 Task를 읽거나 수정할 수 없어야 한다.
9. Renderer에 raw DB, generic IPC, outbox payload, secret 또는 파일 본문을 노출하지 않는다.
10. drag payload에 Task/Project 본문을 넣지 않는다. component-local task ID만 사용한다.

## 구현 범위

### 1. 프로젝트별 Board 설정

`ProjectRecord.board?`에 backward-compatible한 설정을 둔다.

- Board title
- 각 canonical status의 사용자 표시명
- 다섯 status의 표시 순서
- 각 status의 optional soft WIP limit
- column 표시명은 trim 후 1–40자, case-insensitive 중복 금지
- column order는 다섯 canonical status를 정확히 한 번씩 포함
- WIP limit은 null 또는 1–999
- 설정 초기화 버튼으로 GOSU 기본값 복원
- `UpdateBoardSettingsInput`, fixed IPC channel, WorkspaceService command, outbox `project.board.update`를 추가
- Board 설정 성공 시 Project version을 1 증가

### 2. Card 정보와 편집

기존 `WorkspaceTask`에 optional 필드를 추가한다.

- `description?: string` — plain text/Markdown source, 최대 4,000자
- `priority?: 'low' | 'medium' | 'high' | 'urgent'`
- `dueDate?: string` — local date `YYYY-MM-DD`
- `labels?: readonly string[]` — 최대 8개, 각 1–32자, trim·case-insensitive dedupe
- `archivedAt?: string`

Task 생성과 편집 UI에서 해당 필드를 입력할 수 있게 한다. 빈 priority/date/description은 optional 값 제거로 처리한다. Card에는 priority, labels, due date 상태(Overdue / Today / Upcoming)를 compact하게 표시한다.

### 3. Archive와 restore

- hard delete는 구현하지 않는다.
- `SetTaskArchivedInput`과 fixed IPC command를 추가한다.
- archive는 `task.archive`, restore는 `task.restore` outbox command를 남긴다.
- 기본 Board에는 active card만 표시한다.
- “Archived” view/toggle에서 검색 가능한 archived card와 Restore를 제공한다.
- archive/restore도 project ownership과 expectedVersion을 검사한다.

### 4. 이동과 WIP

- card를 column 사이로 native drag-and-drop할 수 있게 한다.
- drop은 기존 `updateTask`의 canonical status 변경만 호출한다.
- 현재 좌우 이동 버튼과 status select를 accessibility/keyboard fallback으로 유지한다.
- 다른 project 또는 현재 렌더링 목록에 없는 task ID는 drop하지 않는다.
- WIP count는 filter 결과가 아니라 해당 column의 전체 active task 수로 계산한다.
- limit 초과 시 column header와 count를 경고하되 이동은 막지 않는다.

### 5. 검색과 filter

pure renderer helper로 다음을 구현하고 unit test한다.

- title + description keyword search
- priority filter
- label filter
- due filter: `all / overdue / today / this_week / no_due_date`
- active/archived mode
- 활성 filter 수와 Clear all
- filter 적용 중에도 각 column은 유지하고 “No matching tasks”를 구분

filter는 사용자 로컬 view state이며 Hosted Sync/outbox에 넣지 않는다. 프로젝트 전환 시 draft, drag, filter, archive mode가 다른 프로젝트로 새지 않아야 한다.

### 6. Project Chat 정합성

- Codex project context에 Board title, canonical status와 display label mapping, priority·labels·due date를 bounded하게 포함한다.
- AI action schema는 기존 `task.create / task.update`만 유지한다.
- AI가 Board 설정을 직접 변경하거나 archive할 수 없게 한다.
- Project Chat action card가 사용자 정의 column label을 표시한다.

### 7. UI 구조

- Board header에 Board title, search, filter, “Board settings”를 배치
- Board settings는 명확한 form/panel로 제공
- 새 Task composer는 title 중심으로 빠르게 쓰되 “More details”로 metadata를 열 수 있게 한다
- Task edit form은 title, description, status, priority, due date, labels를 지원
- archive는 명시적 버튼과 confirmation을 사용
- 기존 appearance/text-size 설정과 light/dark theme 모두에서 읽기 쉬워야 함
- 작은 화면에서는 Board 자체의 horizontal scroll을 유지

## 명시적 제외 범위

- arbitrary column/status 생성·삭제
- column 내부 card 수동 ranking
- assignee와 lab member picker
- checklist, dependency, recurring task
- saved views, swimlane, bulk edit
- calendar/timeline, cumulative-flow chart
- automation rule builder
- destructive permanent delete
- cross-project card 이동

## 필수 테스트

1. v0.3.2 필드가 없는 Project/Task snapshot이 그대로 열린다.
2. 프로젝트별 Board title/label/order/WIP 설정이 섞이지 않는다.
3. column label 중복, 잘못된 order, 잘못된 WIP는 bounded validation error다.
4. stale Project version으로 Board 설정을 덮어쓸 수 없다.
5. description/priority/due date/labels가 normalize되어 restart 후 복원된다.
6. archive/restore가 optimistic version과 project ownership을 지킨다.
7. keyword/priority/label/due/archive filter pure helper 테스트.
8. drag는 동일 project의 알려진 active task만 canonical status로 이동한다.
9. WIP warning은 filter와 무관한 전체 active count를 사용한다.
10. IPC allowlist와 invalid payload bounded error를 검증한다.
11. SQLCipher smoke에서 legacy snapshot을 연 뒤 새 설정·metadata·archive를 commit하고 restart 복원한다.
12. Project Chat context는 현재 project의 설정과 metadata만 포함한다.
13. GitHub·Codex 장애가 Board 로컬 기능을 막지 않는다.
14. 전체 `pnpm check`, desktop test, macOS local DB smoke, package build를 통과한다.

## 완료 조건

- 앱 버전을 `0.4.0`으로 올린다.
- 실제 macOS DMG를 생성한다.
- 설치된 `/Applications/GOSU.app`을 복구 가능하게 교체하고 앱을 실행한다.
- 기존 사용자 데이터가 보존된 상태에서 Board를 시각 검증한다.
- software architecture 문서를 갱신하고 모든 변경된 Markdown을 Obsidian mirror와 byte-identical하게 유지한다.
- feature branch, commit, PR, CI 통과, main merge까지 완료한다.
