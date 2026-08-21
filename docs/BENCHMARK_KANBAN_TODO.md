# Kanban + To-do 벤치마크와 GOSU 설계 결정

기준일: 2026-08-10

## 조사 목적

GOSU의 Kanban Board에 별도 To-do 기능을 붙일 때 데이터가 중복되거나 Project Chat이 서로 다른
작업 원본을 보지 않도록, 주요 할 일·프로젝트 관리 앱의 공식 문서에서 List와 Board의 결합 방식을
비교했다.

## 공식 제품 비교

| 제품    | List와 Board의 관계                                                                                                   | 세부 작업과 빠른 입력                                                                                    | GOSU에 적용할 패턴                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Todoist | 같은 project와 task를 List·Board·Calendar layout으로 전환한다. Board에서는 section이 column, task가 card다.           | Quick Add가 날짜·priority·label·project·section을 한 줄에서 해석한다.                                    | 같은 Task의 view 전환과 짧은 입력 문법                    |
| Notion  | 하나의 database에 List·Table·Board 등 여러 view를 붙인다. Board는 status·assignee·priority 같은 property로 group한다. | 간단한 `/todo` block과 assignee·status·date를 가진 database task/sub-item을 구분한다.                    | canonical record와 독립적인 projection/filter             |
| ClickUp | 하나의 Task를 List·Board 등 여러 view에서 보여주고 status·assignee·priority·tag·due date로 group한다.                 | Chat message에서 Task를 생성하거나 연결하고 slash command를 제공한다.                                    | chat-message와 task의 연결 및 공통 command 경로           |
| Linear  | 하나의 Issue를 List와 Board가 공유하고 status·project·priority·cycle·label로 group한다.                               | 빠른 생성과 Slack 자연어 명령이 같은 Issue를 만든다. sub-issue도 parent 관계를 가진 Issue다.             | 하나의 aggregate와 여러 projection이라는 가장 단순한 구조 |
| Trello  | Board list 안에 canonical card가 있고 Workspace Table이 여러 Board의 card를 집계한다.                                 | card 내부 checklist를 제공하고 필요하면 checklist item을 card로 승격한다. Inbox에서 먼저 포착할 수 있다. | 가벼운 단계와 독립 Task를 구분하는 후속 설계              |

## 공식 자료

- [Todoist Board layout](https://www.todoist.com/help/articles/use-the-board-layout-in-todoist-AiAVsyEI)
- [Todoist view 사용자화](https://www.todoist.com/help/articles/customize-views-in-todoist-AoHhBxFdZ)
- [Todoist Quick Add](https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz)
- [Notion database views](https://www.notion.com/help/views-filters-and-sorts)
- [Notion Board view](https://www.notion.com/help/boards)
- [Notion tasks와 dependencies](https://www.notion.com/help/tasks-and-dependencies)
- [ClickUp List와 Board](https://help.clickup.com/hc/en-us/articles/6310314670359-List-view-vs-Board-view)
- [ClickUp Chat message에서 Task 생성](https://help.clickup.com/hc/en-us/articles/26425806391703-Create-or-connect-tasks-from-Chat-messages)
- [ClickUp Slash Commands](https://help.clickup.com/hc/en-us/articles/6308960837911-Use-Slash-Commands)
- [Linear Board layout](https://linear.app/docs/board-layout)
- [Linear Issue 생성](https://linear.app/docs/creating-issues)
- [Linear Slack integration](https://linear.app/docs/slack)
- [Trello checklist](https://support.atlassian.com/trello/docs/adding-checklists-to-cards/)
- [Trello Inbox](https://support.atlassian.com/trello/docs/trello-inbox/)

## 결정

GOSU는 별도 `Todo` entity나 table을 만들지 않는다. 기존 `WorkspaceTask`가 유일한 원본이며,
`Kanban`과 `To-do`는 같은 Task ID·status·optimistic version을 표시하는 두 projection이다.

- Kanban은 사용자 지정 column 순서와 drag 이동에 최적화한다.
- To-do는 같은 filter와 composer를 공유하고 compact row, 완료 checkbox, status·priority·due date·tag를
  제공한다.
- 완료 checkbox는 안정적인 내부 status `done`으로 이동한다. 완료 해제는 과거 상태가 저장되어 있지
  않으므로 첫 non-done column으로 명시적으로 재개한다.
- 삭제는 완료와 구분하며 기존 `archivedAt` 기반 Task trash·restore를 그대로 사용한다.
- Board column 표시명은 바뀔 수 있지만 내부 status ID는 chat command와 sync의 안정 식별자로 유지한다.
- checklist와 sub-task는 이번 slice에서 새 schema를 만들지 않고 후속 versioned contract로 남긴다.

## 전체 project Tasks projection

Workspace의 `Tasks`는 모든 project용 task를 새 entity로 복제하지 않고 기존 `WorkspaceTask`를 모아 보여주는
renderer-only Kanban·To-do projection이다. parent가 Active인 active task만 대상으로 하며, local navigation에서
숨긴 Active project는 포함하되 Archived·Trash project와 Task trash는 제외한다. project badge와 project
filter로 각 task의 소유자를 항상 드러낸다.

- 전체 Kanban column은 project별 사용자 표시명이나 순서를 임의로 합치지 않고 canonical
  `backlog`·`planned`·`in_progress`·`review`·`done`을 사용한다.
- task 추가 시 구체적인 Active project를 반드시 선택한다. 초기 status와 완료 해제 status는 각각 선택하거나
  소유한 project의 Board 설정을 따른다. 서로 다른 project의 WIP limit은 전체 Tasks 합계에 적용하지 않고
  각 project Board에서만 그 project의 전체 active task를 기준으로 유지한다.
- card drag는 같은 task의 canonical status만 바꾸며 project 간 reassignment를 의미하지 않는다. 모든 생성과
  수정은 owning `projectId`, `taskId`, `expectedVersion`을 기존 `WorkspaceService` command에 전달하고
  project-scoped outbox와 함께 원자적으로 저장한다.
- 각 column은 최근 변경 순서의 bounded subset만 렌더링하고 `Show more`가 다음 bounded batch를 연다.
  따라서 방금 생성·이동·복원한 task를 즉시 보여주면서도 전체 snapshot의 task 수만큼 DOM을 한꺼번에
  만들지 않는다.
- 전체 Tasks 화면은 all-project agent context가 아니다. Project Chat, `/todo`와 agent tool은 계속 현재 Active
  project만 읽고 제안하며, global UI에서 저장한 task도 다음 project snapshot에서 같은 원본으로 보인다.

이 projection은 workspace/task schema, SQLCipher table 또는 sync command type을 추가하지 않으므로 기존
project Board와 저장된 schema-v1 snapshot의 호환성을 유지한다.

## Project Chat과 `/todo` skill

Project Chat은 활성 project의 Board/To-do snapshot만 읽고, 모델이 DB를 직접 수정하지 않는다. 일반
대화와 `/todo` 모두 기존 `task.create`·`task.update` 제안을 만들며 사용자가 `Apply`한 뒤에만
`WorkspaceService`가 project scope와 `expectedVersion`을 검증해 반영한다.

지원하는 입력은 다음과 같다.

```text
/todo <task title and optional details>
/todo add <task title and optional details>
/todo list [filter]
/todo done <task title or ID>
/todo move <task title or ID> <column>
/todo help
```

Main process가 `/todo` prefix와 operation을 다시 파싱하고 활성 project/session을 강제로 주입한다.
task·column이 없거나 여러 개로 해석되면 action을 만들지 않고 확인 질문을 한다. 자연어로 “이 작업을
이번 주 할 일에 넣어줘”, “남은 할 일을 읽어줘”라고 요청해도 같은 proposal·Apply 경로를 사용한다.

## 후속 범위

- Task 내부의 가벼운 checklist와 checklist-to-task 승격
- assignee와 Today·Upcoming 전용 saved view
- chat action과 생성 Task 사이의 durable source-session/source-message backlink
- Hosted Sync RBAC에서 Owner·Lead·Researcher mutation과 Reviewer·Viewer read-only 검증
