# GOSU 유지보수 가이드와 개발 기억

[0.58.49 설치](releases/0.58.49.md)는 [모델 참조 대화](MODEL_REFERENCES.md)를 추가한다.
모델 ID·저장 revision·hash를 Main에서 확인하고 독립 Project Chat에 유지한다. Model Lab
자체 대화 이동 및 승인된 전역 비서 모델/대화 읽기도 연결한다. 전체 3,954개/환경 제외 8개,
Runtime 1,236개·SQLCipher·실렌더·빌드·패키징·고정 서명·continuity·격리 startup 통과.
2026-09-14 정상 종료를 확인하고 앱/보호된 데이터 백업 후 교체했다. 설치본 v0.58.49와
기존 프로젝트·Project Chat 이력 및 Critical Review 메뉴를 실제 화면에서 확인했다.
사용자 모델의 실제 LLM 질의와 전역 비서 이력 표시까지 검증한 것은 아니다. 승인 통합 옵션은 미구현이다.

[0.58.48 후보](releases/0.58.48.md)는 [Critical Review](CRITICAL_REVIEW.md)의 두 모드를
기존 Project Chat에 연결한다. 저장된 모드로 읽기 전용 권한을 강제하고 완성본 검토는
프로젝트 배경 자료를 원고 근거로 혼용하지 않는다. 전체 3,940개/기존 환경 제외 8개,
Runtime 1,223개·SQLCipher·실렌더·패키징·고정 서명·continuity·격리 startup 통과.
설치본 0.58.40은 정상 종료 대기이며 실제 원고/LLM 품질 검증과 설치 UI는 미완료다.

[0.58.47 후보](releases/0.58.47.md)는 [Project Chat 계획 연동](PROJECT_RESEARCH_PLANS.md)을
검증했다. 목표·로그·아이디어·규칙 세션을 원자적으로 저장하고 계획별 정확한 버전으로 실행을
연결한다. 전체 3,920개 / 환경 제외 8개, Runtime 1,203개, native SQLCipher·화면·패키징·서명·
continuity·격리 startup 통과. 기능만 분리한 `codex/project-research-plans`의 `ebb08e2`를 push했다
(분리본 전체 2,521개, Runtime 337개). 기존 미커밋 변경은 그대로이며 로컬 앱 후보와 해당
분리 커밋은 동일 바이너리 소스가 아니다. 설치본은 정상 종료 대기 중인 0.58.40이다.
현재 실제 실행은 기존 승인된 120초 전경 경로이며 장기 Runner가 아니다.

[0.58.46 후보](releases/0.58.46.md)는 기존 닫힌 말풍선에 작은 AI 반짝임을 더한다.
아이콘 슬롯·버튼·정렬·대화 기능은 그대로다. 이전 후보 변경도 포함한다. 전체 3,814개
(기존 환경 제외 8개), Runtime 1,012개, 화면 4종·패키징·고정 서명·continuity·격리 startup 통과.
설치본은 정상 종료/키체인 확인 대기인 0.58.40이며 강제 종료나 덮어쓰기를 하지 않았다.

[0.58.45 후보](releases/0.58.45.md)는 Astra 확장 요청 1,050,000과 모델별 자동 감지/실측을 분리한다.
현재 연결 실호출은 요청을 늘려도 828,400 유효 문맥을 보고했다. 실제 1M 적용 성공으로 보고하지 않는다.
AI 비서·Project Chat·Model Lab 모두 설정별 실측 재사용과 공통 표시를 사용한다. 전체 3,814개
(기존 환경 제외 8개)·Runtime 1,012개·합성 실렌더·패키징·고정 서명·continuity·격리 startup을
통과했다. 설치본은 정상 종료/키체인 확인 대기 중인 0.58.40이며 설치 UI는 미검증이다.

[0.58.44 후보](releases/0.58.44.md)는 AI 비서 진입 때 추천 질문을 보여주고 입력창 클릭·타이핑·
추천 영역 밖 클릭으로 자동 접는다. 자동 입력 포커스와 실제 사용자 입력을 구분하며, 대화·초안·
권한은 바꾸지 않는다. 0.58.43까지의 변경도 포함한다. 전체 3,811개(기존 환경 제외 8개),
Runtime 1,010개, 합성 실렌더, 패키징·고정 서명·continuity·격리 startup을 통과했다.
설치본은 정상 종료/키체인 확인을 기다리는 0.58.40이며 강제로 종료/교체하지 않았다.

[0.58.43 후보](releases/0.58.43.md)는 [앱 알림](WORKSPACE_NOTIFICATIONS.md)에 승인된 Calendar
일정과 브리핑 완료 이메일 수/중요 이메일 수를 연결한다. To-do와 함께 정확한 항목으로 이동한다.
조회 실패/분석 미완료는 0개와 구분하며 알림 집계만으로 메일·LLM을 재호출하지 않는다.
0.58.41–42 변경도 포함한다. 전체 3,809개(기존 환경 제외 8개)·Runtime 1,008개·실렌더
4개 조합·빌드·패키징·고정 서명·continuity·격리 startup을 통과했다. 설치본은 아직 0.58.40이며
키체인 접근 대기 프로세스의 정상 종료 전에는 교체하지 않는다. 설치 UI·실자료 알림은 미검증이다.

[0.58.42 후보](releases/0.58.42.md)는 재시작 때 AI 비서 대화를 먼저 복원하고, 같은 소유 루틴의
이전 설정/provider 대화도 로컬 화면에 표시한다. AI 문맥·검색·쓰기 승인은 현재 권한 범위를
그대로 사용한다. 설정 저장 시 프로필 순서를 유지하고, 기록이 있으면 추천 질문은 접는다.
기존 이력·권한은 수정/삭제하지 않는다. 일시적 시작 오류는 읽기만 최대 세 번 시도한다.
전체 검사(Briefing 765, Desktop 2,409/기존 환경 제외 8, Model Lab 349)·Runtime 991·
컴포넌트 실렌더·패키징·고정 서명·continuity·격리 startup을 통과했다. 설치본은 여전히
0.58.40이며 정상 종료 전 교체하지 않았다. 프로세스 sample에서 Keychain 항목 읽기 호출 대기를
확인했고 사용자에게 승인창 확인과 종료를 요청했다. 보안 UI 우회/강제 종료는 하지 않는다.

[0.58.41 후보](releases/0.58.41.md)는 [Model Lab 문맥·기억·토큰 관리](MODEL_LAB_CONTEXT.md)를
AI 비서/Project Chat과 같은 공통 planner/compactor/meter로 연결한다. 원본 이력은 프로젝트·
모델·리비전별 별도 backend 보관, UI 캐시와 분리한다. 기존 모델 기억/설정은 유지한다.
Claude의 Model Lab tool namespace도 수정했으며 live OAuth 실행 성공으로 혼동하지 않는다.
전체 검사(Model Lab 349, Briefing 761, Desktop 2,409/환경 제외 8)·Runtime 987·컴포넌트
실렌더·패키징·고정 서명·continuity·격리 startup을 통과했다. 현재 설치본은 0.58.40이며,
실행 프로세스가 남아 있고 창 조회가 timeout이라 정상 종료를 요청했다. 강제 종료/교체하지 않았다.

[0.58.40 설치](releases/0.58.40.md)는 AI 비서 대화의 논문 저장 승인을 실제 보관함 저장으로
연결한다. 서버 소유 이력의 제안과 현재 사용자 승인을 확인하고, 해당 논문을 공개 출처에서
식별한 뒤 논문 요약 모델로 저장한다. 실제 receipt만 완료로 표시한다. 전체 검사(Briefing 761,
Desktop 2,409/기존 환경 제외 8)·Runtime 948·패키징·고정 서명·백업·교체·격리 startup을
통과했다. 0.58.38 종료를 확인하고 교체했으며 설정/대화를 초기화하지 않았다. 실행 뒤 실제 창
조회는 두 번 timeout이고 Briefing 포트가 아직 열리지 않았다. 사용자에게 macOS 승인창 확인이
필요할 수 있다. 설치 UI나 실제 논문 저장 성공은 미검증이며 SecurityAgent를 우회하지 않는다.

[0.58.39 후보](releases/0.58.39.md)는 특정 예제 논문이 아닌 일반 검색을 보완한다.
Crossref·arXiv·OpenReview 병렬 검색, DOI/논문 ID 직접 식별, 출처별 검색 제한 시간,
제목/주제 구분과 오래된 논문 PDF fallback을 포함한다. 전체 검사(Briefing 755, Desktop
2,409/기존 환경 제외 8)·Runtime 942·패키징·고정 서명·continuity·격리 startup을 통과했다.
설치본은 0.58.38이고 정상 종료 확인 전 교체하지 않았다. 창 조회가 timeout이라 사용자에게
승인창 확인과 정상 종료를 요청했다. 보안 승인 문제를 강제 종료나 설정 초기화로 우회하지 않는다.

최신 바이너리는 [0.58.38](releases/0.58.38.md): AI 비서의 특정 논문 검색을 브리핑 기간 제한에서
분리하고 PMLR/OpenReview/DataCite 원문 경로와 오류 원인을 구분한다. 전체 검사·Runtime
931개·실제 공개 원문 조회·서명 continuity 후 정상 Quit/백업/교체했다. 실행 시 SecurityAgent가
나타나 키체인 승인 대기로 보이며, 해당 보안 앱은 도구 접근이 거부되어 사용자에게 직접 확인을
요청했다. 설치 UI/사용자 실대화 검증은 아직 미완료다. 보안 설정을 완화하거나 데이터를
초기화하지 말고 사용자 응답 후 확인한다. 이전 정상 UI 확인 설치는 아래 0.58.37이다.

최신 설치 [0.58.37](releases/0.58.37.md): Project Chat에도 [긴 문맥과 사용량 표시](CONTEXT_BUDGET_AND_USAGE.md)를
연결했다. 화면용 250개와 별개인 AI 이력 조회, 실제 모델 한도·문맥 압축·이전 대화 원문 검색,
동일 토큰 표시를 사용한다. 드래그 첨부 후보 0.58.36도 포함한다. 전체 검사·Runtime 922개·
SQLCipher smoke·합성 UI·서명 continuity 검증 후 종료된 앱을 백업·교체했다. 설치 header와
기존 Project Chat 이력, 토큰 표시 영역을 확인했다. 사용자 대화에 시험 질문은 보내지 않았다.
원본 대화·설정·계정 권한은 초기화하지 않았다. 아래 후보 설치 대기는 당시 기록이다.

[0.58.36 후보](releases/0.58.36.md)는 AI 비서와 Project Chat 파일 드래그 첨부를 추가했다.
전체 검사·Runtime 915개·네이티브 File 전달·합성 UI·패키징·동일 서명 검증을 통과했다.
설치본은 아직 0.58.35다. 사용자 Project Chat이 실행 중이어서 중단/교체하지 않았고 정상
종료 후 알림을 요청했다. 이후 교체할 때 새 백업과 artifact hash를 다시 확인한다.

최신 설치 [0.58.35](releases/0.58.35.md): AI 비서에 Project Chat의 파일 첨부와 저장 대기열을
연결했다. 실행 전 수정·삭제·먼저 실행을 지원하며 Codex의 현재 작업 보충은 중단 후 실행과
구분한다. [첨부/대기열 경계](CHAT_ATTACHMENTS_AND_QUEUE.md)를 읽는다. 전체 검사와 Runtime
895개, SQLCipher smoke, 합성 UI 검증 후 동일 서명·백업으로 교체했다. 설치 header와 이전
대화 복원을 확인했다. 사용자가 앱을 이용 중이므로 설치본의 실제 파일 선택/LLM 보충 호출은
실행하지 않았다. 기존 연결·설정·데이터는 초기화하지 않았다.

최신 설치 [0.58.34](releases/0.58.34.md): [문맥 예산·실측 토큰 표시](CONTEXT_BUDGET_AND_USAGE.md)를
추가했다. 6개 대화 고정 제한을 서버의 토큰 예산/압축/원문 검색으로 대체하고 실제 native 한도를
우선한다. 짧은 Astra 실호출에서 유효 문맥 828,400토큰을 확인했으며 명목 1M과 구분한다.
사용자 요청에 따라 검증된 GOSU 변경은 안전한 종료·백업·서명 검증 후 설치까지 기본 진행한다.
전체 gate·서명 continuity를 통과하고 이전 앱 및 암호화 workspace/프로젝트 DB를 백업했다.
실제 화면의 v0.58.34, 기존 AI 대화와 토큰 영역을 확인했다. 활성 사용자 작업은 강제로
종료하지 않았고, 과거 응답의 없는 토큰 기록을 추측해 채우지 않았다.

이전 설치는 [0.58.33](releases/0.58.33.md)이다. 아래 대화 영구 저장·검증된 논문 요약 저장·
선택 삭제와 설정 슬라이더 아이콘을 포함한다. 전체 gate·고정 서명 continuity를 통과하고
이전 앱 및 encrypted workspace를 백업한 뒤 교체했다. 실제 v0.58.33과 설정 아이콘을 확인했다.
아래 미설치 문구는 개발 당시 상태이며, 실사용 논문 저장/대화 재시작 시험과 혼동하지 않는다.

0.58.32 이후 추가 source: [논문 보관함 검증 저장·선택 삭제](SHARED_PAPER_LIBRARY.md#verified-paper-ingestion-and-selection-deletion-post-05832-source)는
일반 대화 복사를 중단하고 확인된 arXiv 논문을 요약 모델로 분석해 저장한다. DOI 등 미지원
원문은 실패로 표시한다. 체크박스 선택 삭제는 공용 encrypted trash/루틴 보관함 tombstone을
사용하며 실제 사용자 항목은 개발 중 삭제하지 않았다. 아직 설치하지 않았다.

0.58.32 이후 source: [AI 비서 대화 영구 저장](GLOBAL_ASSISTANT.md#durable-conversation-storage-post-05832-source-not-installed)을
추가했다. 질문/답변을 앱 외부 암호화 workspace에 저장하고 재시작 때 복원하며 최근 문맥을
다음 질문에 전달한다. 기존 개인화 기억과 설정은 유지한다. 아직 설치본에는 없고 실행 앱을
재시작하지 않았다. 새 storage field를 모르는 구버전으로 단순 rollback하면 안 된다.

최신 설치는 [0.58.32](releases/0.58.32.md)이다. 아래 source-only 글꼴 변경과 내장 채팅
높이, 실제 비서 모델 표시 수정을 포함한다. 전체 gate·고정 서명 continuity·백업 후 교체했으며
실제 화면에서 v0.58.32와 GPT-6-Astra/high, 전체 채팅 레이아웃을 확인했다. 사용자 설정과
연결 데이터는 변경하지 않았다. 아래 0.58.31 및 미설치 설명은 당시 상태다.

0.58.31 이후 source 글꼴 조정: [AI 채팅 크기 균형](TYPOGRAPHY.md)은 본문·입력을 13px로
줄이고 답변 제목 크기를 제한한다. 창 크기·아이콘·대화 상태는 유지했다. 아직 설치하지
않았으며 기존 dist의 0.58.31 앱에도 이 후속 변경은 없다. 다음 교체는 새 버전으로 다시
빌드·패키징·서명해야 한다. 실행 중인 사용자 AI 대화를 중단하거나 앱을 재시작하지 않았다.

최신 설치는 [0.58.31](releases/0.58.31.md)이다. 채팅 화면 변경을 유지하고 AI 비서 아이콘을
세 점 말풍선으로 바꾼 수정본을 전체 gate·고정 서명·continuity 검증 후 교체했다. 실제 화면의
v0.58.31과 새 아이콘, 기존 프로젝트/대화 표시를 확인했다. 이전 0.58.30은 릴리스 기록의
경로에 백업했으며 사용자 데이터·연결 설정은 초기화하지 않았다.

이전 설치 [0.58.30](releases/0.58.30.md)은 아래 2026-09-13 source 변경을 모두 포함해
고정 인증서로 서명하고 0.58.29를 백업한 뒤 교체했다. 설치 버전·서명·기동 검증과 실제
화면의 v0.58.30, 새 AI 비서 아이콘, 기존 프로젝트/대화 표시를 확인했다. 도구의 화면 탐색이
불안정해 설치본 세부 동작까지 검증됐다고 하지는 않는다. 아래 미설치 서술은 개발 당시 상태다.

2026-09-13 추가 source: [저장된 논문 유지](BRIEFING_WORKSPACE.md#saved-papers-survive-empty-or-failed-refreshes-2026-09-13-source)는
새 조회가 비거나 실패했을 때 기존 요약까지 숨기던 `visiblePaperKeys` 표시 필터를 제거한다.
같은 날 저장된 요약·시각은 그대로 유지하고 새 논문만 분석·추가한다. 기존 빈 표시 목록도
렌더링에서 무시하므로 재조회나 데이터 마이그레이션 없이 보인다. 설치본 교체는 아직 하지 않았다.

2026-09-13 추가 source: [AI 연결 정리](SHARED_MODEL_CATALOG.md#codex-and-claude-connections-retired-optional-providers-2026-09-13-source)는
Hermes/OpenClaw의 앱 연결·감지·위임을 제거하고 Settings에 Codex/Claude 연결 카드를 통일한다.
과거 ID·대화 읽기와 호환용 adapter/asset은 남긴다. 기존 Hermes 모델 지정은 다른 제공자로
자동 전송하지 않으며 새 모델 선택이 필요할 수 있다. 설치본 교체나 사용자 CLI 삭제는 하지 않았다.

2026-09-13 추가 source: [전역 AI 비서](GLOBAL_ASSISTANT.md)를 연결했다. 프로젝트 채팅에
전역 권한을 추가하지 않고 앱 소유 비서만 프로젝트별 최근 문맥을 읽는다. 기억 공유와 작업
전달은 대상·내용을 확인한 뒤 해당 프로젝트로만 보낸다. 설치 0.58.29에는 아직 포함되지 않았다.

이전 설치 [0.58.29](releases/0.58.29.md)는 전체 요약 문장에서 정확한 제목과 제한된
핵심어를 강조하고 기존 Pretendard의 굵기·행간·문단 간격을 다듬었다. 저장본을 재생성하지
않으며 설정과 이력을 유지한다. 전체 gate·고정 서명·설치 startup 검증은 통과했다. 합성
화면은 확인했으나 설치 창의 최종 시각 검증은 native 도구 timeout으로 미완료다.

이전 설치 [0.58.28](releases/0.58.28.md)은 arXiv 후보에서 기존 요약을 먼저 제외한 뒤
최대 표시 수를 적용해 false-zero 누락을 수정했다. 동일한 조회 범위와 raw XML 캐시를 쓰며,
기존 요약/설정/권한은 그대로 둔다. 전체 gate와 고정 서명 continuity 검증 후 백업·교체했고
설치 header 0.58.28을 확인했다. 실제 arXiv 재조회는 timeout이므로 새 실시간 요약 생성은
검증됐다고 하지 않는다. 자세한 검증 범위와 백업은 해당 릴리스 기록을 우선한다.

이전 설치 [0.58.27](releases/0.58.27.md)에서는 GOSU 부모 창에 붙은 Briefing 승인창으로
교체했고, 사용자 요청의 Mail 읽기 설정이 실제 저장되는 것과 메일 조회 진행을 확인했다.
고정 로컬 인증서로 본체/helper를 서명했으며 기존 앱은 정상 Quit 후 백업·교체했다.
루트 신뢰·Keychain ACL·TCC·사용자 데이터 초기화는 하지 않았다. 전체 테스트/Runtime/빌드와
설치 버전·서명 검증은 통과했다. 실제 이메일 29건 요약 저장 완료(오류 없음)를 encrypted-store
readback과 설치 UI에서 확인했다. 자세한 범위와 백업은 릴리스 기록을 확인한다.
아래 0.58.20 설치·서명 대기 서술은 과거 상태다.

2026-09-12 [0.58.26 교체 후보](releases/0.58.26.md)는 역할별 모델 설정을 포함해 패키징/격리
startup/전체 gate를 통과했다. 사용자가 로컬 서명 인증서를 생성했고, 동일 인증서로 시험
실행파일 서명과 strict DR 검증에 성공했다. 시스템 루트 신뢰와 기존 Keychain ACL 변경은 없다.
전체 앱 서명은 macOS 개인키 사용 승인 응답 대기 중이다. 설치본은 아직 0.58.20이며 후보를
교체하지 않았다. `security find-identity -v`의 0개만으로 로컬 서명 불가라고 단정하지 말고
명시적 인증서 지문·실제 strict 서명 검증·업데이트 continuity gate를 확인한다.

2026-09-12 추가 source: [역할별 모델 설정](SHARED_MODEL_CATALOG.md#role-based-model-routing-2026-09-12-source-update)을
구현했다. 빠른/고성능 모델·추론 수준을 별도로 저장하고 Project Chat, Briefing 요약/비서,
강의·문헌·실험 AI 사용처별로 지정한다. 기존 명시적 선택과 제공자별 개인정보 권한을 유지한다.
실제 사용자 모델 설정이나 권한은 바꾸지 않았다. 설치본 0.58.20 및 앞서 만든 0.58.25 패키지에는
이 후속 source 변경이 포함되지 않았다. 인증서 설치·앱 교체 작업도 재개하지 않았다.

2026-09-12 서명 전환 승인 후 [0.58.25 후보](releases/0.58.25.md)를 준비했다. Calendar helper를
앱에 포함해 고정 경로에서 실행하며 packaged 실행에서는 임시 ad-hoc 재생성을 하지 않는다.
개발 패키지·격리 startup은 통과했으나 인증서 도우미의 Create 단계는 사용자에게 넘겼고,
Mac 잠금으로 진행이 중단됐다. 고정 인증서 생성/서명/설치는 아직 미완료다. 설치본 0.58.20과
사용자 설정/데이터는 유지된다. 아래 0.58.24 후보 설명보다 이 최신 후보 기록을 우선한다.

2026-09-12 추가 source 변경: Briefing `New`는 루틴의 다음 daily generation에서 이전 표시가
만료되도록 암호화 snapshot의 `newItemsSince`를 사용한다. History/live AI 요약의 일정 카드도
native ID + occurrence start로 Calendar 상세를 연다. 기존 ID 없는 이력은 추측하지 않는다.
`pnpm check` 통과: Briefing 661, Desktop 2,380 통과/기존 환경 skip 8개, Model Lab 341.
집중 회귀 15개, Agent Runtime 628개 통과. 설정·원본 일정·메일 변경 및 앱 교체는 없었다.
설치본 0.58.20, 패키지 후보 0.58.24는 아래와 같으며 이 추가 source 변경은 패키징/설치되지
않았다. 실제 설치 UI 확인은 고정 서명 전환 이후 남아 있다.

최신 설치는 [0.58.20](releases/0.58.20.md)이다. 메일 구버전 중복 후보 재검사와 같은 조회/회차
논문 중복 차단을 포함한다. 정상 Quit 후 교체했으나 재실행은 Keychain 키 읽기 대기 상태로,
신규 설치 UI/실제 원문 중복 확인까지 완료됐다고 보고하지 않는다.

현재 후보는 [0.58.24](releases/0.58.24.md)이며 Calendar 직접 생성/저장/삭제와 수정시각만으로
발생하는 false conflict를 보완했다. 인증서 검증된 GOSU의 직접 UI 경로만 native 추가 검토를
생략하며 AI/CLI는 유지한다. 실제 일정 삭제·설정 변경은 하지 않았다.
[0.58.23](releases/0.58.23.md)부터 기존 설정 키가 있으면 기본값처럼 보여도
자동 복원/덮어쓰지 않으며, 수동 복원도 저장 전에는 draft다. 서명 신원이 바뀌는 ad-hoc
업데이트는 새 continuity gate에서 중단한다. 설치본은 0.58.20, 유효한 서명 인증서는 0개였다.
고정 서명 준비와 검토된 최초 전환 없이 다시 앱을 교체하지 않는다. 이전 메일 본문 읽기/전송
허용 질문에도 승인을 가정하지 않으며, 사용자 요청대로 현재 설정은 변경하지 않는다.

2026-09-11 후속: 0.58.17 binary 설치·서명·격리 startup 검증 완료. 실제 창 조회는 timeout으로
확인하지 못했다. Briefing 직접 이동·뒤로가기와 0.58.15–16 변경을 포함하며,
[0.58.17 설치 및 미검증 범위](releases/0.58.17.md)를 우선한다.
추가: History 일정의 native ID와 DOM anchor 분리가 [0.58.18](releases/0.58.18.md)에 있다.
0.58.17 설치본의 Calendar History 직접 이동을 완료로 보고하지 않는다.

2026-09-11 추가: 0.58.14 설치 및 Settings → Briefing Lab 화면, 저장된 Mail 연결 표시를 확인했다.
빈 초기 설정 복구와 macOS 사용 목적 선언을 수정했다. 실제 Calendar/AI-chat private 조회는
별도 검증이 남아 있다. [0.58.14 기록](releases/0.58.14.md)을 우선한다.

2026-09-11 후속: 공용 Calendar·To-do list·Briefing Lab, 일정/할 일 통합과 compact sidebar를
포함한 0.58.13이 설치됐으며 실제 앱 버전·사이드바 화면을 확인했다.
아래 과거 버전 서술보다 [0.58.13 검증/설치 기록](releases/0.58.13.md)의 실제 상태를 우선한다.

기준: 2026-09-09 로컬 작업 트리, Desktop 0.58.10.
2026-09-10 후속: source/package candidate는 0.58.11이며 설치본은 재시작 승인 전까지 0.58.10이다.
논문 분석 저장 확인과 공용 보관함은 [현재 계약](SHARED_PAPER_LIBRARY.md), 설치 상태는
[0.58.11 기록](releases/0.58.11.md)을 우선한다.
이 문서는 사용자 연구 프로젝트의 내용이 아니라 **GOSU 제품 구현**을 기억하기 위한 문서다.
실제 테스트·설치 상태는 [릴리스 기록](releases/0.58.10.md)을 확인한다.
Git HEAD만으로 로컬 설치본을 재현할 수 있다고 가정하지 않는다. 이번 작업 트리에는
이전 개발에서 누적된 미커밋 변경과 새 파일이 있다.

## 다음 개발 세션의 시작 순서

1. [AGENTS.md](../AGENTS.md)와 이 문서를 읽는다.
2. `git status --short`, 관련 코드, [기능별 문서](README.md)를 확인한다.
3. 사용자가 보는 대상이 `/Applications/GOSU.app`, 개발 Electron, standalone Model Lab,
   Briefing Lab 중 무엇인지 구분한다. 소스 변경·빌드·설치·실행 확인은 서로 다르다.
4. 실패를 재현하는 focused test부터 추가/수정한다. 이전 변경을 revert하거나 다른
   세션의 데이터를 초기화해서 테스트를 통과시키지 않는다.
5. affected package 전체 test/typecheck/lint/format/build를 통과시킨다. Agent Runtime,
   Project Chat context/memory/delegation 변경은 `pnpm test:agent-runtime`도 필수다.
6. UI 변경은 실제 렌더링을 보고 판단한다. provider 연결 변경은 mocked test와 live
   검증을 구분하며, 인증이 없으면 구체적으로 그 제한을 기록한다.
7. 문서와 Obsidian mirror를 갱신하고, 릴리스 때는 backup·bundle hash·설치 확인을 남긴다.

## 계속 유지할 사용자 결정

- GOSU와 Model Lab은 공통 provider engine, model catalog, reasoning, prompt policy를 재사용한다.
  모델명을 여러 UI에서 따로 하드코딩하거나, 동작하지 않는 deterministic 답변을 LLM처럼 보이지 않는다.
- agent는 필요한 도구를 반복 사용하고 실제 결과를 보여준다. verbose는 실행 상태·결과이지
  내부 chain-of-thought가 아니다. 과거 assistant 답변을 새 파일·실험의 증거로 쓰지 않는다.
- 영구 memory는 관련 문맥을 되찾는 장치이며, 새로운 도구 권한이나 영구 native CLI thread를 뜻하지 않는다.
- 변경마다 테스트를 추가/수정하고 실행한다. 사용자가 재차 요구해야만 테스트하는 방식으로 돌아가지 않는다.
- 모델·수도 코드·수식·설명·shape·변경 강조는 같은 revision을 가리켜야 한다.
  반복 층을 작은 카드의 단순 나열로만 표현하지 않고 의미 있는 블록으로 묶는다.
- 모델 작업은 프로젝트별로 격리한다. 새 프로젝트 기본 모델은 Bottleneck autoencoder 하나다.
  명시적으로 비운 workspace에 기본 모델을 다시 삽입하지 않는다.
- Compact/Default/Large/Extra large의 공통 본문은 **10/12/14/16px**다.
- Briefing Lab은 현재 독립 실험 공간이다. 시간 간격 자동 생성은 사용자가 선택한 루틴에서만
  로컬 서버 실행 중 동작하며, OS cron/시작 프로그램이나 기존 루틴의 자동 수집을 임의로 켜지 않는다.
  브리핑은 종류별로 묶고 표시 순서를 루틴별로 저장한다.
- 2026-09-10부터 Briefing production의 샘플 생성·보관함·초기화·소스 디렉터리는 제거됐다.
  실제 이력과 연결 설정은 유지하며, 검증용 fixture는 테스트에만 사용한다.
  브라우저 v2 설정 전환과 v1 복구본 보존은 [현재 계약](BRIEFING_WORKSPACE.md)을 따른다.
- Briefing memory는 요약 완료 후 backend에서 자동 저장·재사용한다. 사용자가 직접 작성하거나
  매번 암호를 입력해야 하는 기능으로 되돌리지 않는다. 검토·수정·삭제는 선택 사항이며,
  private memory 조회/외부 전송 권한과 저장된 AI 해석의 불확실성은 유지한다.
- Markdown 문서는 모두 Obsidian mirror와 byte-identical하게 유지한다.

## 실행 단위와 소유권

| Surface                 | 시작/배포                                           | 소유하는 상태                                  | 혼동하면 안 되는 점                              |
| ----------------------- | --------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| Desktop                 | `pnpm app:dev`, 설치된 GOSU.app                     | 프로젝트·채팅·grant·로컬 DB·provider lifecycle | 앱 폴더와 user data는 별개                       |
| Embedded Model Lab      | Desktop이 project capability URL 발급               | 프로젝트별 모델·revision·chat·artifact         | 4317 서버가 필요하지 않음                        |
| Standalone Model Lab    | `pnpm model-lab:dev`, 4317                          | standalone 브라우저 및 backend 저장소          | embedded 프로젝트 저장소와 별개                  |
| Briefing Lab            | `pnpm briefing-lab:dev`, 4318                       | 루틴 설정·실제 이력·표시 순서                  | 아직 GOSU 내장 탭/실제 scheduler 아님            |
| Briefing stable preview | build 후 `pnpm --filter @gosu/briefing-lab preview` | 같은 origin의 브라우저 저장소                  | dev와 같은 포트를 동시에 쓰지 않음               |
| Runner / Sync / Web     | 독립 app/package                                    | 각 계약의 허용 범위                            | 데스크톱 UI가 있다고 end-to-end 연결된 것은 아님 |

Desktop의 Model Lab은 production UI를 bundle 안에 포함하고, Main 소유 loopback 서버와
project capability로 서비스한다. iframe에 Node/preload 권한을 주지 않는다.
상세: [Model Lab Desktop](MODEL_LAB_DESKTOP.md), [release runbook](RELEASE_RUNBOOK.md).

## 공통 LLM engine와 agent lifecycle

### 찾아갈 코드

- [Codex adapter](../apps/desktop/src/main/codex-app-server.ts): native thread/turn, dynamic
  tools, cancellation, 실제 invocation와 provider catalog.
- [Claude adapter](../apps/desktop/src/main/claude-code-project-chat-adapter.ts): 기존 구독
  인증, Claude native system boundary, scoped MCP, generic final schema.
- [Claude MCP bridge](../apps/desktop/src/main/claude-code-mcp-bridge.ts): `gosu_project`
  namespace, per-thread/turn callback, socket/token, revoke/dispose.
- [Project Chat service](../apps/desktop/src/main/project-chat-service.ts): context 구성,
  session/run lifecycle, 도구·메모리·승인 흐름.
- [Project Chat prompt](../apps/desktop/src/main/project-chat-prompt.ts)와
  [shared policy](../packages/contracts/src/research-agent-harness.ts): 안정적인 공통 지침과
  도메인 지침. 사용자 질문·첨부·기억은 지침이 아닌 별도 evidence/input이다.
- [Model Lab native turn](../apps/model-lab/model-lab-native-agent.ts),
  [Briefing native turn](../apps/briefing-lab/briefing-native.ts): 같은 adapter를 각 도메인
  도구와 final schema로 사용한다. provider 재사용이 권한 전체 공유를 뜻하지 않는다.

### 모델 선택과 실행 버전

[공통 catalog](../packages/contracts/src/model-catalog.ts)와
[refresh lifecycle](../packages/contracts/src/model-catalog-refresh.ts)을 먼저 확인한다.
Auto는 provider default를 따른다. 명시적 model/reasoning은 보존하고, 사라진 선택을
다른 모델로 조용히 바꾸지 않는다. [runtime discovery](../packages/integrations/src/codex-runtime-discovery.ts)는
설치된 호환 runtime만 찾으며 다운로드하지 않는다. 번들 `@openai/codex` pin은 0.149.0이지만,
실제 연결이 더 새 설치 runtime을 선택할 수 있다. **모델명, runtime 버전, 앱 버전은 별개다.**

Codex는 GOSU의 기존 auth/config scope를 사용한다. Claude도 기존 계정을 사용한다.
키를 복사하거나 일반 API 과금 경로로 fallback하지 않는다. 단, provider 계정 자체의
추가 사용량 과금 설정까지 앱이 자동으로 제어한다고 보증하지 않는다.
구독 설정 감지와 실제 OAuth inference 성공은 별도 검증이다.

### memory와 관찰

[context/memory contract](../packages/contracts/src/agent-context.ts)는 context window,
출력/runtime 여유분, recent history, source, memory 예산을 나눈다. provider metadata가
없을 때의 catalog fallback과 generic budget helper fallback은 서로 다른 상수다.
광고된 최대 context 길이를 실제 이번 turn에 모두 전달했다고 말하지 않는다.

[local database](../apps/desktop/src/main/local-database.ts)의
`project_agent_runs`, `project_agent_working_memory`, `project_agent_permanent_memory`를 추적한다.
영구 기억은 scope별 최대 1,000개, 검색 결과 최대 12개/12,000자로 제한된다.
메모리 입력의 source·scope·민감 정보 필터를 유지한다. 사용자 결정/선호를 보존하는 것과
모든 과거 대화를 매번 prompt에 넣는 것은 다르다.

현재 UI lifecycle은 질문 완료 후 provider thread를 release한다. native Claude adapter의
정확한 session UUID resume 지원이 곧 모든 질문 사이의 영구 native transcript 유지라는 뜻은 아니다.
재시작 뒤 unfinished run 복구/중단 상태도 성공과 구분한다.

Project Chat의 [tool activity](PROJECT_CHAT_TOOL_ACTIVITY.md)는 safe metadata만 보여준다.
시작과 완료를 같은 call 행에 합치고, unknown/unfinished 상태를 성공으로 바꾸지 않는다.
이 UI 로그는 restart를 넘는 영구 audit 저장소가 아니다.

### Hermes와 OpenClaw

Hermes는 선택형 ACP provider/위임 경로이며 GOSU 전체 실행을 교체하는 필수 dependency가 아니다.
[Hermes adapter](../apps/desktop/src/main/hermes-acp-project-chat-adapter.ts), bundle manifest,
profile·capability negotiation을 확인한다. 연결 가능하다는 사실로 SSH나 native shell 도구를
사용할 수 있다고 추론하지 않는다. OpenClaw 감지를 provider 실행 연결로 오해하지 않는다.
long-running remote experiment와 arbitrary native tool 활성화는 별도 권한/Runner 설계가 필요하다.

## Model Lab

### Import부터 model graph까지

1. [import parser](../apps/model-lab/src/model-lab-import.ts)가 문서·이미지·소스 입력을 정규화한다.
   Python, image, PDF, DOCX, RTF, text/Markdown 입력과 ModelIR JSON 경로를 구분한다.
2. Python은 [정적 analyzer](../apps/model-lab/python-architecture-analyzer.py)와
   [host wrapper](../apps/model-lab/python-architecture-analysis.ts)가 callable entry와 dependency를
   추린다. 파일명을 하드코딩해 특정 모델만 통과시키거나 업로드 코드를 실행하지 않는다.
3. [builder](../apps/model-lab/src/model-lab-builder.ts),
   [server](../apps/model-lab/model-copilot-server.ts)가 source budget과 canonical pipeline version을
   사용해 LLM structured generation을 요청한다. Builder와 Copilot의 선택 UI/목적을 혼동하지 않는다.
4. schema, ownership, source completeness, semantic granularity, formula/description 감사 후에만
   모델을 채택한다. [diagnostics](../apps/model-lab/model-builder-diagnostics.ts),
   [canonical cache](../apps/model-lab/model-builder-cache.ts)는 raw secret/source dump가 아니다.
5. 실패 원인에 맞는 제한된 correction을 한다. narrative-only repair는 transform/ports/edges를
   바꾸지 못한다. 구조 실패를 주석 수정으로 우회하지 않는다.

동일 source/pipeline/language의 검증된 cache를 재사용하면 표현 안정성이 높아진다.
새로운 LLM generation까지 임의 모델에서 항상 byte-identical하거나 의미적으로 완벽하다고
보증하는 시스템은 아니다. 명확하지 않은 source entry·shape·operation은 불확실성을 유지한다.

### ModelIR, 수식, 반복 블록

- [schema](../apps/model-lab/src/model-lab-schema.ts),
  [domain](../apps/model-lab/src/model-lab-domain.ts)가 canonical 모델 계약이다.
- [repeat semantics](../apps/model-lab/src/model-repeat-semantics.ts)는 loop ownership과 의미
  블록을 확인한다. loop의 주석을 연산으로 세거나 뒤쪽 statement를 조용히 누락하지 않는다.
- [graph](../apps/model-lab/src/model-graph.tsx), [node](../apps/model-lab/src/module-node.tsx)는
  반복 stack, nested module 확장, graph focus/center, edge label을 표현한다.
  축약 블록과 펼친 상세는 같은 최신 transform/revision을 읽어야 한다.
- [formula audit](../apps/model-lab/src/model-formula-consistency.ts)와
  [math renderer](../apps/model-lab/src/formula.tsx)를 함께 확인한다. Linear를 MLP 수식으로,
  concat을 split으로, 독립 assignment를 chain equality로 대체하지 않는다.
  여러 수식은 세로로 보여주고 rendering failure를 원문과 함께 알린다.
- gradient status는 실제 실행 receipt 여부가 우선이다. `not-observed`를 zero/healthy로,
  `torch.no_grad()` 경계를 학습 가능하다고 보여주면 안 된다. design-only graph는 실행 검증이 아니다.

### 수도 코드와 revision

[pseudocode](../apps/model-lab/src/model-pseudocode.ts)의 `GOSU Model Pseudocode v2`와
`MODEL_PSEUDOCODE_LLM_GUIDE`가 template의 원본이다. 사람이 편집하는 의미 블록 3–8개를
권장하며 내부 loop 연산은 block body에 남긴다. v1 호환 reader는 별도로 유지한다.
자유 형식 입력은 LLM 해석/정규화 및 검토를 거친다. draft를 고쳤다는 이유만으로 graph가
이미 적용됐다고 표시하지 않는다.

revision은 immutable parent/child tree다. 이전 revision에서 수정하면 새 branch가 된다.
original/proposed draft, diff hunk 위치 이동, 변경 요약, graph 변경 강조의 기준을 같은
base/proposal로 맞춘다. chat 요청으로 만든 변경도 동일한 검토·적용 경로를 거친다.
[Python artifact](../apps/model-lab/src/model-python-artifact.ts)는 revision과 연결된 receipt를 가진다.
Python 파일 생성만으로 실행 성공이나 Experiment session 연동 완료를 선언하지 않는다.

### 프로젝트 격리와 UI 성능

[Desktop host](../apps/model-lab/model-lab-desktop-host.ts),
[backend context](../apps/model-lab/model-lab-backend-context.ts),
[workspace](../apps/model-lab/src/project-model-workspace.ts),
[transfer store](../apps/model-lab/project-model-transfer-store.ts)를 한 묶음으로 읽는다.
프로젝트별 저장소/cache/in-flight request가 분리돼야 한다.
Duplicate to project는 fresh IDs를 가진 독립 saved revision 복사이며 재생성이나 공유 포인터가 아니다.
사용자가 삭제한 모델을 sample seeding으로 복구하지 않는다.

[composer](../apps/model-lab/src/model-chat-composer.tsx)는 입력을 locally 소유한다.
키 입력마다 전체 graph/Markdown을 rerender하지 않는다. textarea, message log, model graph,
좌우 패널의 독립 scroll/min-width/min-height를 유지한다. 한국어 IME Enter는 제출과 구분한다.
왼쪽 session/model navigation 최소화가 graph 전체 최소화로 이어지지 않게 한다.

## Briefing Lab

상세 구현은 [Briefing 문서](BRIEFING_LAB_IMPLEMENTATION.md), 의도는 [계획](BRIEFING_LAB_PLAN.md)을 본다.
두 문서의 상태를 혼합하지 않는다.

- [pure core](../packages/briefing-core/src/index.ts): 시간대/DST/month-end, keyword ranking,
  fixture run, schema, category grouping.
- [앱](../apps/briefing-lab/src/briefing-app.tsx): 루틴 설정/회차/history.
- [sections](../apps/briefing-lab/src/briefing-sections.tsx): 요약 tile, 접기/펼치기, 넓은 화면 2열,
  전체 폭 상세, 종류별 순서 drag/keyboard controls.
- `sectionOrder`는 현재 루틴의 표시 preference이며 기존 결과에도 적용된다.
  `sectionOrderSnapshot`은 archived run의 원래 표시 순서를 보존한다. 이전 저장소는 필드 없이도 읽힌다.
  각 section 내부의 관련성 순위와 원본 run receipt는 바꾸지 않는다.
- [native LLM](../apps/briefing-lab/briefing-native.ts),
  [local API](../apps/briefing-lab/briefing-server.ts),
  [proposal](../apps/briefing-lab/src/routine-builder.ts),
  [Copilot](../apps/briefing-lab/src/routine-copilot.tsx)는 실제 GOSU adapter로 루틴을 설계한다.
  source 확인 → 일정 검증 → 검토 → 새 draft 추가. live source 수집이나 저장 권한이 있는 agent가 아니다.
- 모델은 host ID, activation, credentials, shell 명령을 proposal에 넣을 수 없다. 새 요청이 실패해도
  이전 proposal의 오래된 Apply 버튼을 남기지 않는다. cancel/late result도 저장하지 않는다.
- 샘플 회차는 격리된 테스트 fixture에만 남는다. 실제 브리핑은 저장한 루틴 조건으로 Open-Meteo,
  arXiv와 명시적으로 허용한 Apple Mail scope를 읽는다. raw 수집은 LLM에 전송하지 않으며,
  별도 AI 요약으로 중요도/연구 관련성/수식/원문 그림을 제공한다. 메일과 memory의 외부 분석은
  native 확인을 거친다. [live sources](BRIEFING_LIVE_SOURCES.md)와
  [intelligence·암호화 memory·보안 제한](BRIEFING_INTELLIGENCE.md)을 먼저 읽는다.
  최신 source-specific 요약은 이메일 배치를 먼저 처리하고, 상단 AI 비서 카드에 메일의
  실무 중요도·기한·다음 행동과 Calendar 하이라이트를 표시한다. 논문은 제목·keyword·연구
  우선순위만 먼저 보여주고 펼친 상세에서 수식/설명을 렌더링한다. 이메일에는 연구 관련성을
  억지로 덧붙이지 않는다. 진행률은 item count 기준 percent/range와 현재 native 작업을
  표시한다. [Briefing workspace](BRIEFING_WORKSPACE.md)의 current contract를 우선한다.
  생성 아이콘과 1·2·4시간 등의 간격 실행은 하루 단위 이력에 새 이메일·논문만 누적하고
  처음 날씨·일정을 보존한다. `generation.v1.enc.json`의 암호화된 권한·실행 상태와
  workspace의 daily/addedAt 메타데이터는 [현재 계약](BRIEFING_WORKSPACE.md)을 따른다.
  OS startup/알림 발송, tasks/연구과제 bridge와 위치별 사이트 discovery는 후속 단계다.
- Copilot 대화는 열린 pane 수명에 한정되고, 루틴 설정은 브라우저에 남는다.
  실제 요약·이력은 backend 암호화 저장소가 소유한다. 루틴 제안은 소스/권한을 활성화하지 않고
  `sourceIds: []`로 반환하며, 실제 연결은 설정에서 관리한다.
  이것을 GOSU의 project permanent memory와 동일하다고 설명하지 않는다.
- [자동 backend memory](../apps/briefing-lab/briefing-memory-store.ts)는 완료된 요약과 연구 관심사를
  별도 AES-GCM 파일에 저장한다. 키는 [macOS Keychain helper](../apps/briefing-lab/briefing-system-key.ts)가
  관리한다. 루틴별 검색, 중복 제거, 수정 보존, 원문/인증코드 제외, 취소·권한 해제 전 commit 재확인을 테스트한다.
  상태 API는 개수만 반환하며 기억 본문 검토는 native 승인 후 scope token이 필요하다. 이는 production XPC 격리가 아니다.

## UI, Notes, 알림

- [공통 typography](TYPOGRAPHY.md)는 Desktop/Model Lab의 body·control을 10/12/14/16px로 맞춘다.
  `typography.ts`와 `typography.css`, Settings sample, translation, 실제 computed-size 검사를 같이 고친다.
  Model Lab iframe은 typography message로만 갱신하고 reload하지 않는다.
- [언어](APPLICATION_LANGUAGE.md)는 저장된 `en`/`ko` preference를 UI와 다음 agent 요청에 전달한다.
  사용자 이름·수식·코드·기존 설명을 번역 대상으로 잘못 분류하지 않는다.
- [Sidebar](SIDEBAR_ICON_DESIGN.md)는 하나의 local SVG family를 쓴다. 프로젝트 이름 옆의 장식
  folder icon은 제거했고 disclosure/선택/실행 상태는 유지한다.
- [알림](WORKSPACE_NOTIFICATIONS.md)은 Search/Tasks 옆의 bell과 unread badge다. deadline,
  현재 앱에서 관찰한 chat 결과, actionable warning을 모은다. 읽음·숨김은 원본 task나 승인과 별개다.
- [Notes 선택 기능](PROJECT_CHAT_OPTIONAL_NOTES.md)은 권한이 없거나 폴더가 없어도 채팅을 계속한다.
  Notes 도구/자동 저장만 끄며, grant를 재작성하거나 사용자 대신 승인하지 않는다.

## 데이터 위치와 복구 경계

| 데이터                       | 위치/소유권                                                        | 보수 시 주의                                        |
| ---------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| 설치 binary                  | `/Applications/GOSU.app`                                           | 앱 교체 대상, user data가 아님                      |
| Desktop user data            | macOS `Library/Application Support/@gosu/desktop`                  | SQLCipher/secure storage, 임의 초기화 금지          |
| Embedded Model Lab           | user data의 `model-lab/projects/<project-id>/workspace.json`       | atomic 저장, project scope 유지                     |
| Standalone Model Lab backend | `.gosu/model-lab` 및 명시적 standalone override                    | embedded와 다른 소유권                              |
| Application language         | user data의 `application-language.json`                            | strict validation, atomic replace                   |
| Briefing browser state       | origin 4318의 `gosu.briefing-lab.workspace.v2`                     | 루틴 설정; v1은 복구용 보존, 실제 이력은 backend    |
| Briefing backend memory      | `Library/Application Support/GOSU/briefing-lab/memory.v2.enc.json` | AES-GCM + 별도 Keychain 키, 원문 inbox archive 아님 |
| 연구 노트                    | 사용자가 선택한 Obsidian project folder                            | repo 개발 문서와 섞지 않음                          |
| 개발 문서 mirror             | Obsidian Vault의 `GOSU/repository-docs`                            | 저장소와 같은 상대 경로, `cmp` 확인                 |
| 앱 백업                      | `Library/Application Support/GOSU/app-backups`                     | 이전 binary 보존; DB rollback 보증은 아님           |

실제 사용자 채팅/메일/연구 파일이나 credential을 유지보수 문서에 복사하지 않는다.
app bundle backup은 DB backup이 아니다. DB schema 변경 릴리스의 rollback은 별도 검증과
적절한 보호를 갖춘 data backup이 필요하다.

## 증상별 점검 순서

| 증상                                 | 먼저 점검할 것                                                                          | 피할 임시 처방                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------- |
| localhost 접속 불가                  | 해당 포트 listener, dev/preview 구분, stdout, 생성 asset                                | storage 초기화, 다른 앱 kill                    |
| 최신 모델이 picker에 없음            | 실제 provider catalog, 명시적 pin, refresh, 선택 runtime                                | 여러 UI에 모델 문자열 복사                      |
| Claude 설정은 보이는데 요청 실패     | safe turn code, auth-required 여부, tool namespace                                      | API key fallback, 인증 성공으로 단정            |
| Notes 때문에 Send 막힘               | resolved per-turn capability, disabled 조건                                             | grant 자동 복구/재승인                          |
| read workspace만 반복 표시           | tool call ID, safe activity metadata, begin/end 합치기                                  | 가짜 LLM 진행 문장 삽입                         |
| import correction 반복               | callable/source coverage, audit reason, candidate receipt, cache digest                 | 불변 구조를 narrative patch로 우회              |
| 수식/설명 불일치                     | canonical transform, operator audit, formula renderer, revision base                    | 특정 파일명/module name 예외 추가               |
| 수정한 loop statement 누락           | parser statement extraction, block ownership, stale expanded node                       | old child formula 재사용                        |
| chat 타이핑 지연/scroll 불가         | composer state ownership, memoization, constrained flex/grid height                     | 전체 workspace rerender, overflow hidden만 추가 |
| Briefing LLM/조회가 탭 전환으로 멈춤 | backend-owned auto-summary job, parent receipt state, status reconnect, explicit cancel | component unmount를 사용자 취소로 간주          |
| 다른 프로젝트 모델이 같음            | seed 여부/IDs, storage scope, copy provenance                                           | 모든 프로젝트 모델 일괄 초기화                  |
| 글자 크기 적용 안 됨                 | 소스/빌드/설치 구분, root data-text-size, iframe message                                | 라벨 숫자만 수정                                |
| 새 앱에서 Keychain 창                | ad-hoc signing에 따른 OS 승인                                                           | ACL 완화, password 수집, key 평문 이동          |

## 알려진 제한과 후속 보수

1. **Model Lab Claude live 확인**: 0.58.41 후보에서 `gosu_project` namespace로 등록/검증하도록
   수정하고 회귀 검사를 통과했다. Codex는 기존 top-level function/null namespace를 유지한다.
   이전 namespace 불일치는 source에서 수정됐지만 실제 Claude OAuth inference는 이번 작업에서
   실행하지 않았다. mocked transport 통과를 live 인증/추론 성공으로 보고하지 않는다.
2. Claude live inference는 최근 테스트에서 `claude_code_auth_required`였다.
   사용자의 재로그인이 필요하며, 이미 감지된 catalog가 token의 현재 유효성을 보증하지 않는다.
3. arbitrary Python/model 의미를 수학적으로 증명하는 import 시스템은 아니다.
   formula/operator/shape 검증과 관측 runtime receipt를 별도로 발전시켜야 한다.
4. Model Lab → Experiment 자동 실행, 장기 SSH workload, 완전한 Runner orchestration,
   unattended agent campaign, hosted sync worker는 UI 존재만으로 완료된 기능이 아니다.
5. Briefing은 수동 조회·근거 기반 LLM 요약·자동 backend 암호화 memory까지 연결됐다.
   서버 실행 중의 명시적 시간 간격 scheduling은 구현됐다. OS 자동 시작, funding/task bridge, 프로젝트 자동 sync, 기존
   루틴의 reviewed AI edit, production-isolated private source broker는 후속 작업이다.
6. 개발용 .app은 ad-hoc 서명이다. Developer ID/notarization/auto-update는 아직 별도 과제다.

## 변경별 검증 표

| 변경                           | 최소 focused 근거                                                           | 추가 gate                                         |
| ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------- |
| shared typography              | UI typography/language, Desktop Settings/typography, Model Lab iframe tests | typography real-render smoke                      |
| chat capability/context/memory | Desktop service/runtime/Notes tests, contracts tests                        | `pnpm test:agent-runtime`                         |
| provider/tool protocol         | adapter + 실제 bridge contract + scoped cancellation tests                  | 인증이 있을 때만 별도 live smoke                  |
| Model Lab import/graph         | builder/domain/schema/repeat/formula/pseudocode tests                       | 전체 Model Lab + 실제 graph screenshot            |
| project storage/copy           | desktop-host/project-workspace/transfer tests                               | cross-project regression, packaged resource check |
| Briefing grouping/schedules    | Core sections/schedule/schema + Lab UI/storage tests                        | Briefing visual smoke                             |
| notification/sidebar           | inbox/deadline/sidebar/keyboard tests                                       | notifications/sidebar visual smoke                |
| docs/release                   | [문서 경로 테스트](../scripts/maintenance-docs.test.mjs)                    | mirror 비교, package cold-start, 설치 UI          |

## 유지보수 완료 기록에 남길 것

- 바뀐 동작, 선택한 설계와 이유, 기존 사용자 데이터에 대한 영향.
- 관련 implementation/test/doc 경로; 원래 증상과 테스트가 실패하는 이유.
- 정확한 test 숫자, skip의 환경 조건, type/lint/format/build, 실제 화면 확인.
- live provider의 실제 사용 여부와 auth 등 미검증 이유. mock 숫자를 live 성공으로 표현하지 않는다.
- source version, Git 상태, package source, 설치 경로, 이전 binary backup, artifact hash.
- 알려진 다음 작업. 새 세션에서 다시 같은 조사를 하게 만드는 구두 약속만 남기지 않는다.

자세한 절차는 [릴리스 runbook](RELEASE_RUNBOOK.md)을 따른다.
