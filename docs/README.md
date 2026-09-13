# GOSU 문서 안내

이 폴더는 앱 유지보수와 다음 개발 세션을 위한 저장소의 작업 기억이다.
최신 설치/검증 범위는 [0.58.49 릴리스 기록](releases/0.58.49.md)을 우선한다. Model Lab 참조 대화와
Critical Review를 포함한 누적 수정본을 백업 후 설치했다. 실제 v0.58.49와 기존 Project Chat
이력·메뉴를 확인했으며, 실제 사용자 모델의 LLM 질의 등 개별 workflow 검증과는 구분한다.
대화에서 했던 약속과 실제 구현을 구분하고, 코드·테스트·실행 증거를 함께 기록한다.

## 먼저 읽을 문서

1. [유지보수 가이드](MAINTENANCE_GUIDE.md): 구조, 결정 사항, 소유권, 문제별 코드 탐색.
2. [로컬 릴리스·교체·복구 절차](RELEASE_RUNBOOK.md): 검증, 패키징, 백업, 설치 확인.
3. [0.58.10 로컬 릴리스 기록](releases/0.58.10.md): 이번 설치본과 검증 범위.
4. [아키텍처 상세](ARCHITECTURE.md): 기존 모듈과 보안 설계. 오래된 계획 문단은
   날짜가 있는 기능별 문서 및 실제 코드와 대조한다.

## 기능별 문서

| 주제                          | 문서                                                                    | 특히 지킬 경계                                        |
| ----------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| 공통 agent 실행·prompt·memory | [Shared harness](SHARED_RESEARCH_HARNESS.md)                            | 같은 엔진 ≠ 같은 도구 권한 ≠ 영구 native thread       |
| 모델과 reasoning 자동 발견    | [Model catalog](SHARED_MODEL_CATALOG.md)                                | provider 목록 사용, 명시적 선택 유지                  |
| 프로젝트별 Model Lab          | [Desktop integration](MODEL_LAB_DESKTOP.md)                             | 프로젝트 격리, 독립 복사, 모델 기본값                 |
| Python import                 | [Python import](PYTHON_MODEL_IMPORT.md)                                 | static AST, 사용자 Python 실행 금지                   |
| ModelIR·반복 블록·수도 코드   | [유지보수 가이드](MAINTENANCE_GUIDE.md#model-lab)                       | canonical graph, immutable revision, 의미 검증의 한계 |
| 한국어·영어                   | [Application language](APPLICATION_LANGUAGE.md)                         | UI 번역과 사용자·수식·코드 원문 분리                  |
| 글꼴 크기                     | [Typography](TYPOGRAPHY.md)                                             | 공통 본문 10/12/14/16px, iframe reload 금지           |
| Sidebar 아이콘                | [Icon design](SIDEBAR_ICON_DESIGN.md)                                   | 로컬 SVG, 접근성 label 유지                           |
| Search·Tasks·알림             | [Notifications](WORKSPACE_NOTIFICATIONS.md)                             | 읽음 처리 ≠ task 완료 ≠ 실행 승인                     |
| Project Chat 도구 진행 표시   | [Tool activity](PROJECT_CHAT_TOOL_ACTIVITY.md)                          | 실제 이벤트, 비밀·본문·내부 추론 제외                 |
| Notes 없이 채팅               | [Optional Notes](PROJECT_CHAT_OPTIONAL_NOTES.md)                        | 채팅 계속, 권한 자동 재승인 금지                      |
| Briefing Lab 실제 구현        | [Briefing implementation](BRIEFING_LAB_IMPLEMENTATION.md)               | 루틴 설계 LLM + 세 소스 수동 조회, 자동 예약 미연결   |
| Briefing Lab 후속 설계        | [Briefing plan](BRIEFING_LAB_PLAN.md)                                   | 메일·위치 동의, 출처, 예약 runtime는 후속 작업        |
| SSH                           | [SSH ADR](adr/0001-project-scoped-ssh-remote-work.md)                   | 프로젝트 grant, typed broker, 범용 shell 아님         |
| Research Notes                | [Notes ADR](adr/0002-project-scoped-obsidian-research-notes.md)         | 사용자 소유 Obsidian 원문 보호                        |
| Lecture Studio                | [Lecture ADR](adr/0003-workspace-level-lecture-studio.md)               | 프로젝트 채팅과 별도 revision                         |
| Manuscript                    | [Manuscript ADR](adr/0004-pluggable-manuscript-collaboration-engine.md) | 원본·checkpoint·publish 권한 분리                     |

## 갱신 규칙

2026-09-14: [모델 참조 대화](MODEL_REFERENCES.md)는 Model Lab 모델에서 Project Chat/자체 채팅으로
이동하고 저장 버전을 태그로 참조한다. 전역 AI 비서는 승인된 프로젝트의 모델·대화를 읽는다.

2026-09-14: [Critical Review](CRITICAL_REVIEW.md)는 연구 골격·방향과 완성 원고 검토를 별도
읽기 전용 대화로 제공한다. 실제 심사 결과 예측이나 자동 원고 수정이 아니다.

2026-09-14: [Project Chat 계획 연동](PROJECT_RESEARCH_PLANS.md)은 계획 작성과 Goal & Metrics,
Experiment 규칙 저장, 기존 추적 실험 실행 경계를 연결한다. 설정 저장을 실제 실험 성공이나
장기 GPU 실행으로 표현하지 않는다. [0.58.47](releases/0.58.47.md)에 검증/게시 상태를 기록한다.

2026-09-14: [Calendar·Briefing 알림](WORKSPACE_NOTIFICATIONS.md)은 앱 실행 중 승인된 일정,
To-do 마감과 브리핑의 새 이메일/중요 이메일 수를 통합한다. [0.58.43 후보](releases/0.58.43.md)의
실제 검증/설치 상태를 확인한다. OS 알림이나 앱 종료 중 예약 실행과 구분한다.

2026-09-14: [AI 비서 재시작 복원](GLOBAL_ASSISTANT.md)은 로컬 기록 표시와 AI 권한 범위를
분리하고 복원 중 새 대화처럼 보이는 화면을 제거한다. [0.58.42 후보](releases/0.58.42.md)는
검사·서명을 통과했지만 설치본 0.58.40의 키체인 대기/정상 종료 확인이 남아 있다.

2026-09-14: [Model Lab 문맥·토큰 관리](MODEL_LAB_CONTEXT.md)는 AI 원본 보관, 압축 checkpoint,
현재 문맥과 누적 usage의 구분 및 공통 meter를 설명한다. [0.58.41 후보](releases/0.58.41.md)는
검사·서명을 통과했지만 설치본 0.58.40의 정상 종료 확인을 기다린다.

2026-09-13: [첨부와 질문 대기열](CHAT_ATTACHMENTS_AND_QUEUE.md)은 AI 비서 파일 첨부,
저장된 대기 질문 수정·삭제·먼저 실행 및 Codex 실행 중 보충의 경계를 설명한다.

2026-09-13: [문맥 예산과 토큰 표시](CONTEXT_BUDGET_AND_USAGE.md)는 native 유효 한도,
대화 압축/원문 보존, 실측과 추정의 구분 및 0.58.34 설치 검증을 설명한다.

2026-09-13: [전역 AI 비서](GLOBAL_ASSISTANT.md)는 검색 왼쪽 진입점, 동일 Briefing 채팅,
프로젝트별 읽기·확인된 기억 공유·Project Chat 작업 전달과 모델 분리를 설명한다. 설치 전 source다.

2026-09-11: [공용 Calendar·To-do list·Briefing Lab 통합 후보](releases/0.58.12.md)는
Projects 위 전역 메뉴, 앱 소유 Briefing 서버, 기존 데이터 보존과 새 클라이언트 승인 경계를 다룬다.

2026-09-10 후속: [시간 간격 자동 생성](BRIEFING_WORKSPACE.md#one-click-daily-updates-and-hourly-generation-2026-09-10)은
한 번 클릭 생성, 서버 실행 중 1·2·4시간 등의 반복, 하루 단위 누적과 New 표시의 현재 계약이다.
기존 일정 계산 미리보기나 OS 자동 시작과 혼동하지 않는다.

2026-09-10: [명시적으로 승인한 논문 분석 보관함](SHARED_PAPER_LIBRARY.md)은 GOSU/Model Lab/Briefing
채팅의 저장 확인과 공용 암호화 사본을 설명한다. 설치 상태는 [0.58.11](releases/0.58.11.md)을 확인한다.

2026-09-09 후속: [Briefing workspace](BRIEFING_WORKSPACE.md)에 compact 화면, 자동 논문 요약,
설정 기반 지속 권한, 일반 AI 비서, Apple Calendar와 승인된 일정 변경을 정리한다.
이 문서가 아래 초기 소스/요약 문서의 반복 승인 UI 설명을 대체한다.

실제 Briefing 소스 연결은 [이메일·날씨·논문 설정과 개인정보 경계](BRIEFING_LIVE_SOURCES.md)를 읽는다.
LLM 요약·암호화 memory·Scholar 알림·수식/그림·날씨 그래픽은
[Briefing intelligence](BRIEFING_INTELLIGENCE.md)에 구현 및 안전 경계를 정리한다.
샘플 회차와 실제 조회 결과를 혼동하지 않는다.

- 동작이 바뀌면 해당 기능 문서와 실패 재현 테스트를 함께 수정한다.
- 문서의 테스트 숫자는 실행 날짜가 있는 기록이다. 영구적인 최신 상태로 인용하지 않는다.
- `implemented`, `fixture/prototype`, `planned`, `live verification blocked`를 섞지 않는다.
- 비밀번호, OAuth token, 메일 본문, 연구 데이터, 사용자의 실제 대화를 이 문서에 옮기지 않는다.
- 모든 Markdown을 Obsidian `GOSU/repository-docs`의 같은 상대 위치로 복사하고 `cmp`로 확인한다.
- [문서 경로 회귀 테스트](../scripts/maintenance-docs.test.mjs)는 안내 문서의 로컬 링크,
  현재 버전 릴리스 기록, 다음 세션용 AGENTS 진입점을 확인한다.
