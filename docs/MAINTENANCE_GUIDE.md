# GOSU 유지보수 가이드와 개발 기억

[0.58.161 설치](releases/0.58.161.md): 같은 수를 두 군데에 적으면 한 쪽만 맞게 된다. 화면 높이를 쓰는 sticky 패널은 자기가 실제로 시작하는 위치에서 계산해야 한다. 옆에 있던 목록이 멀쩡했던 이유는 그것만 화면 꼭대기에서 시작했기 때문이다. 큰 레이아웃 개편보다 틀린 계산 한 줄을 고치는 쪽이 결함에 맞는 크기다

[0.58.160 설치](releases/0.58.160.md): 선택적 문자열 하나가 두 가지를 뜻하면 반드시 새어 나간다. `paperKey?: string`로는 "논문 요약인데 논문 없음"과 "AI 비서"를 구분할 수 없어 후속 질문이 남의 대화로 떨어진다. 타입을 갈라 컴파일러가 호출자를 전부 찾게 할 것. 그리고 대화를 합칠 때 범위에서 유도하던 것(논문별 횟수·필터·인덱스)은 턴 기록으로 옮겨야 살아남는다. 메일: 같은 계정의 두 메일함에 있는 한 통은 Message-ID·제목·수신시각이 모두 같을 때만 합친다

[0.58.159 설치](releases/0.58.159.md): 같은 것을 가리키는 열쇠에 움직이는 값을 넣으면 안 된다. 메일 건너뛰기 열쇠가 메일함 경로와 그 안의 번호로 만들어져 있었고, 둘 다 메일이 옮겨지거나 색인이 다시 만들어지면 바뀐다. 그리고 초록 배경 위의 초록 표시는 아무리 렌더해도 안 보인다. 렌더 확인은 실제 페이지 배경 위에서 할 것

[0.58.158 설치](releases/0.58.158.md): 클래스가 요소에 붙었다는 테스트는 사용자가 무언가를 본다는 증거가 아니다. 목록 안의 카드는 자기 테두리를 포기하므로(`.briefing-reading-list > .briefing-card…`), 같은 특정도의 규칙을 나중에 써도 화면은 그대로다. 실제 CSS로 렌더해 보기 전까지는 no-op인지 알 수 없다. 패널 높이 상한과 최소 폭은 창이 커져도 남는 공간을 만들고, 리사이즈 바의 이동 거리를 0으로 만들 수 있다: 상한은 고정값 대신 비율로 둘 것

[0.58.157 설치](releases/0.58.157.md): 대화는 목록 맨 밑이 아니라 패널에 있어야 한다. 위치가 잘못됐을 때 스크롤로 따라가게 만드는 것은 증상을 덮는 것이고, 자리를 옮기면 그 보정은 지워야 한다. 한 자리를 두 대화가 나눠 쓰면 숨기되 언마운트하지 말 것(안 보낸 초안이 날아간다). 기능이 없어 보인다는 신고는 먼저 재어 볼 것: 버튼은 처음부터 같았고 없었던 건 높이였다. 공용 컴포넌트의 라벨 상수를 다른 화면에서 재사용하면 기존 화면의 문구가 조용히 바뀐다

[0.58.156 설치](releases/0.58.156.md): 같은 규칙을 세 군데에 손으로 복사해 두면 고쳐지는 것은 한 군데뿐이다. Briefing에는 수식 방어가 아예 없었다. 그리고 수식 안에 살아남은 $ 는 그 마디가 수식이 아니라는 가장 강한 증거다. strict: warn에서 모르는 명령어는 오류가 아니라 글자로 그려지니, 진짜 실패를 시험하려면 괄호를 깨야 한다

[0.58.155 설치](releases/0.58.155.md): 0.58.96에 남겨 둔 원고 PDF 프로세스 그룹 테스트의 간헐 실패는 다른 세션이 고쳐 이 릴리스에 함께 들어갔다. 0.35초 경쟁을 믿는 대신 프로세스 그룹이 사라질 때까지 확인한다. 화면을 여는 것을 막았다고 데이터를 넘기는 배선까지 끊긴 것이 아니다. 분리는 배선을 지워야 끝난다. 그리고 상태가 바뀌었다고 사용자가 본 것이 아니다. 목록 맨 끝에서 열리는 패널은 스크롤해 주지 않으면 없는 것과 같다. 트리에 있는지만 보는 테스트는 이것을 절대 못 잡는다

[0.58.154 설치](releases/0.58.154.md): 모델이 볼 수 있는 도구는 사용자에게 한 약속이다. 통로가 없으면 등록하지 말고, 권한이 없으면 이유를 구체적으로 돌려줄 것. 도구 목록, 지침 문구, context 예산은 같은 플래그 하나로 묶어야 계획과 실제 turn이 어긋나지 않는다

[0.58.153 설치](releases/0.58.153.md): 화면 전환과 동시에 무언가를 열라고 하면 mount 시 effect 선언 순서에 걸린다. 초기화 effect보다 뒤에 선언할 것. 대화 목록을 다른 저장소와 조인하면 그쪽에서 사라진 항목이 통째로 안 보인다

[0.58.152 설치](releases/0.58.152.md): 저장을 갈라도 화면에 내려주는 쪽이 합치면 사용자는 그대로 섞여 보인다. conversationDisplay가 한 라우틴의 모든 scope를 flatten하고 있었다. 권한 변경 이력은 유지하면서 채팅만 가르려면 정확한 scope가 아니라 채팅 단위로 매칭할 것

[0.58.151 설치](releases/0.58.151.md): 식별자 형식을 바꾸면 이미 저장된 식별자를 전부 옮겨야 한다. 한 군데만 관용적으로 고치면 화면과 실제 동작이 서로 다른 말을 한다. 볼트 안에서 찾은 폴더는 기록된 id보다 위치가 더 강한 증거다

[0.58.150 설치](releases/0.58.150.md): 한 역할이 성격이 다른 두 작업을 겸하면 둘 중 하나는 반드시 잘못된 모델로 돈다. 역할을 쪼갤 때 기본값을 같이 두면 쪼갠 의미가 없어지므로 각자 맞는 상위 역할을 따르게 할 것

[0.58.149 설치](releases/0.58.149.md): 봉인된 논문 보관함은 create-only link로 쓰므로 자기 기록에 무언가를 덧붙일 때만 rename으로 교체한다. onClick={fn} 에서 fn이 인자를 받으면 클릭 이벤트가 그 인자로 들어간다

[0.58.148 설치](releases/0.58.148.md): Briefing Lab은 별도 프레임이라 설정값은 navigation 메시지로 보낸다. 값이 없는 메시지는 프레임의 현재 값을 건드리지 않아야 구버전 셸과 단독 실행이 함께 산다

[0.58.147 설치](releases/0.58.147.md): 저장된 허가가 업데이트마다 풀린다면 무엇을 키로 썼는지 볼 것. inode는 macOS가 스스로 바꾼다. 반복되는 AI 출력도 모델이 아니라 우리 쪽 고정 입력을 먼저 의심할 것

[0.58.146 설치](releases/0.58.146.md): 화면이 버벅인다는 신고는 먼저 재어 볼 것. 정적 HTML로 뽑아 브라우저에서 프레임을 재면 그리기 비용인지 React 비용인지 바로 갈린다
(브리핑 피드는 36,909개 요소에서도 중앙값 13.3ms였다). 이 화면의 진짜 비용은 `BriefingHistoryFeed`가 보관된 브리핑을 전부 그리는 것이었고, `react-test-renderer`로 mount와
재렌더 시간을 직접 재어 확인했다(30개 394ms, 60개 857ms). 대책은 `BRIEFING_FEED_PAGE`(8개) 창과 `useMemo(groupBriefingHistory)`이며, 창 밖의 브리핑은
IntersectionObserver 감시자가 화면에 닿을 때 8개씩 들어온다. 창을 도입할 때 알림 점프가 깨지지 않게 `runsToShow`가 알림이 가리키는 run을 포함하도록 창을 넓힌다.
`loadAllHistory`는 여전히 전부 불러오므로, 목록이 더 길어지면 다음 단계는 불러오기 자체를 페이지로 나누는 것이다.

[0.58.145 설치](releases/0.58.145.md): 제목 표시줄의 AI 줄은 사이드바 별과 **같은 상태**(`useSidebarAiActivity`의 `AiActivityState`)를 읽는다. 새 AI 작업을 만들면
그 scope를 `aiWorkItems`의 `describe`에도 추가해야 줄에 이름이 뜬다(이름을 못 붙이면 조용히 빠진다). scope 형식은 `assistant`·`briefing`·`papers`·`lecture`와
`project:<uuid>:<chat|review|experiments|literature>`이고, 확인 표시는 해당 탭을 열 때 기존 effect가 처리하므로 클릭 처리기는 이동만 하면 된다. 제목 표시줄 안의
상호작용 요소는 `<button>`이어야 `-webkit-app-region: no-drag`가 걸린다. `AiActivityStar`는 `<span>`을 그리므로 테스트에서 `findByType('span')`으로 라벨을 찾지 말고
클래스로 찾는다. 오늘의 격언 프롬프트는 "연구자용"이라는 서술 자체가 편향을 만들었다: 주제 목록(`DAILY_QUOTE_SUBJECTS`)을 날짜로 돌리고 연구·마감에 상한을 두는
방식으로 고쳤다. 내장 격언 목록을 늘릴 때 저자를 붙이려면 널리 확인된 인용만 쓰고, 아니면 author를 null로 둔다. 사이드바는 굵은 글씨 없이 12px 제목과 11px 항목
두 단계만 쓴다(`sidebar-density.test.ts`가 고정).

[0.58.144 설치](releases/0.58.144.md): 오늘의 격언 파일은 이제 하루에 여러 줄을 담는다. 현재 줄은 (날짜, 언어)에서 `createdAt`이 가장 최근인 항목이고,
`createdAt`이 없는 옛 항목은 그 날짜의 자정으로 친다(`writtenAt`). 손으로 요청한 횟수는 항목 수가 아니라 파일의 `refreshes` 배열에 날짜별로 센다: 실패한 시도도
세야 고장난 모델을 반복 호출하지 않기 때문이다. 새로고침 실패는 그 날의 다른 줄을 지우면 안 되므로 `save(entry, append=false)`를 쓰지 말고 보여 주고 있는 줄의
`failure`만 바꾼다(`save`의 비-append 경로는 같은 날짜·언어의 항목을 모두 지운다). 모델에 넘기는 `recent`에는 오늘 쓴 줄도 포함해야 새로고침이 같은 문장을 다시
쓰지 않는다. 이 파일에 키를 더하면 예전 build는 strict parse에 실패해 내장 격언을 보여 주지만 파일을 덮어쓰지는 않는다(되돌리기 안전). 제목 표시줄의 팝오버는
`popover="auto"` + 호출 버튼으로 top layer에 띄운다(헤더가 잘라내지 못함). 제목 표시줄 안의 상호작용 요소는 `<button>`이어야 `-webkit-app-region: no-drag`가
적용된다. 데스크톱 `tsconfig.json`의 include는 `test/**/*.ts`뿐이라 `test/**/*.tsx`는 `tsc`가 검사하지 않는다: .tsx 테스트의 타입 오류는 vitest 실행에서만 드러난다.
사용량 그래프의 빗금처럼 거의 모든 값에 붙는 표시는 정보가 아니라 잡음이다; 같은 사실을 문장·접근성 라벨·표의 열에 남기고 그림에서는 뺀다.

[0.58.143 설치](releases/0.58.143.md): 채팅 명령은 `@gosu/ui/chat-slash-commands` 하나로 해석한다(메시지 전체가 명령일 때만, NFKC·대소문자 무시).
새 명령을 더할 때도 세 채팅이 이 목록을 함께 쓴다. `/compact`의 엔진은 `compactConversationNow`(briefing-context.ts)이며 `prepareConversationContext`와
같은 checkpoint 규칙을 쓴다: 유효한 checkpoint는 이어 붙이고, 저장은 호출자가 넘긴 `save`만 한다. 세 채팅 모두 자동 요약과 같은 요약 모델·사용량 종류
(`context_compaction`)·checkpoint 저장소를 쓰므로 다음 턴은 checkpoint를 그대로 찾는다. AI 비서의 `/new`는 대화 레코드의 `contextStartsAt`/`contextStartedAt`이고
(`briefing-workspace-store.ts`의 `modelFacingMessages`), checkpoint의 `through`와 digest는 그 시작점부터 센다: `conversation()`과
`saveConversationCheckpoint`가 같은 목록을 봐야 한다. 대화 객체는 strict가 아니어서 예전 build는 이 필드를 버리고 읽는다. 화면의 구분선은
`conversationDisplay`가 돌려주는 시각으로 그리며 문자열이 아니라 시각으로 비교한다(밀리초 유무가 섞여 있다). Model Lab은 `model-chat-context.ts`의
`contextStartsAt`(index)이고 reset 때 checkpoints를 비운다. 두 곳 모두 `/new` 이후 `search_conversation`은 현재 문맥만 읽는다. Project Chat의
`compactSession`은 `runWhenProjectChatSessionIdle` 안에서 돌고 `contextControllers`에 등록되므로 기존 `cancel`이 중단시킨다. 예상되는 실패는 throw하지 않고
receipt의 `outcome`/`reason`(`PROJECT_CHAT_COMPACTION_REASONS`)으로 돌려준다: IPC 오류 코드 목록은 bounded라 늘리지 않는다. 문맥 창 계산은
`resolveProjectContextWindow` 하나를 `send`와 함께 쓴다. `context.updated` 이벤트의 `attemptId`는 renderer가 쓰지 않으므로 `/compact`는 새 UUID를 넣는다.
AI 비서 서버의 두 경로(`/assistant/conversation/new`, `/assistant/conversation/compact`)는 `BriefingChatQueue.begin`으로 루틴당 실행 하나를 잡는다.

[0.58.142 설치](releases/0.58.142.md): "Codex에서만 된다"는 증상은 provider 검사보다 실행 한도를 먼저 의심할 것. Claude Code는 한 턴이 CLI 프로세스
하나이고 마감이 절대 시간이다(`turnTimeoutMs`, 기본 5분, 최대 30분). Project Chat은 `projectChatTurnTimeoutMs`로 가장 긴 도구 대기의 두 배 + 10분을 넘긴다.
도구 대기 시간을 늘리면 이 값도 함께 본다(`project-chat-service.test.ts`가 고정). SSH 연결 profile의 version은 trusted-access 승인에 묶여 있으므로, 접속 정체성과
무관한 사용자 설정(서버별 AI 지침 등)은 profile에 넣지 말 것: `ssh-agent-notes.v1.json`처럼 따로 둔다. 채팅 스크롤: `scrollTop`을 첫 commit에 한 번만 쓰면
수식·글꼴·도구 패널이 자라기 전 높이에 잘린다. `@gosu/ui/scroll-settle`의 `holdScrollTarget`으로 잡고 있는 동안에는 그 값을 읽던 위치로 저장하지 않는다.
숨겨진 iframe 안의 스크롤 위치는 브라우저가 0으로 되돌리며 React는 다시 그려지지 않으므로 `restoreScrollWhenShown`(ResizeObserver)으로 복원한다. 제목
표시줄의 격언은 모델이 쓴 글이므로 `uiText`에 넣지 않고, 실패해도 chrome에 오류를 띄우지 않는다(사유는 tooltip). 새 사용량 종류는 세 enum과
`WORKLOAD_LABELS`를 함께 고친다(`daily_quote`). Model Lab의 화면 문구는 "Model Assistant"이고 식별자·경로·저장 키의 `copilot`은 그대로다
(`packages/ui/src/language.test.ts`가 화면 문구를 고정).

[0.58.141 설치](releases/0.58.141.md): 문헌 검색의 관련성은 이제 두 겹이다. provider의 순위 위치와, 논문 자체 텍스트가 검색어의 주제어를
언급하는지(`shared/literature-query.ts`, `rankLiteratureCandidates`의 `queryTerms`). 새 provider나 lane을 붙일 때 이 gate를 우회하지 말 것: gate가 없던 때에는
읽지 못하는 문장에도 50편이 저장됐다. 순위 정책 버전을 올릴 때는 `BALANCED_LITERATURE_CORE_GATES_SINCE_VERSION`도 판단한다(Core·Rising 기준이 그대로면 예전
label을 legacy로 만들지 않는다). 저장되는 degradation enum에는 값을 더하지 말 것: run은 엄격하게 parse되어 downgrade한 build가 library를 못 연다. 세부 원인은
receipt의 `providerFailures`로만 보낸다. 문헌 AI의 모든 turn은 `LiteratureAiService.runStructuredTurn` 하나를 거치고 실패는 `start_failed`·`turn_failed`·
`timeout`으로 나뉜다. 한 turn에 초록 50편은 120초 안에 끝나지 않으므로 화면이 10편씩 나눠 부른다. Literature의 SQLite 계층에는 테스트가 없으므로 새 SQL을 쓰지
말고 기존 storage method를 조합한다(`undoSearchAdditions`가 그렇게 한다). storage는 `import` 후보를 검토 파일로 보고 일치한 record의 수동 메모를 덮어쓴다:
논문을 "추가"하는 경로는 반드시 `addImportedCandidates`(이미 표에 있는 논문은 건드리지 않음)를 거친다. 논문 요약 보관함이 읽을 수 있는 링크의 규칙은
`verifiablePaperLink` 하나이며 카드와 ingestion이 함께 쓴다. 카드는 논문마다 따로 저장한다. Project Chat의 고정 정책 문구는 fallback 문맥 창을 대화 기록과
나눠 쓰므로, 문구를 늘리면 `project-chat-prompt.test.ts`의 raw turn 수가 줄어든다(이번에 8 → 7). 사이드바의 1단계 행(도구, 그룹 머리줄, 프로젝트, 아카이브
이름)은 22px 아이콘 칸 + 8px 간격의 한 grid를 쓴다(`sidebar-density.test.ts`가 고정). 알림 줄(`.notice`)의 버튼은 `flex: none; white-space: nowrap`이어야
한국어 라벨이 글자마다 꺾이지 않는다.

[0.58.140 설치](releases/0.58.140.md): 메일 한 통에 대한 읽음 처리·상태 확인·발신자 복구는 `LiveSourceService.mailItemAction` 하나이고,
`/mail/mark-read-all`은 확인을 한 번만 받은 뒤 이 메서드를 메일마다 부른다. 여러 통을 한 스크립트로 처리하도록 바꾸려면 검증 단계(대상 확인, 쓰기 뒤 재확인)를 그대로
옮겨야 한다. 메일 검색 기간: 저장된 `days`는 브리핑 수집과 기본값에만 쓰인다(`resolveMailSearch`). 브리핑 기간보다 넓은 검색은 `collectTarget`에서 색인이 있을 때만
실행되고(`mail_search_index_required`, `mail_search_too_broad`), 색인은 `terms`로 `subjects`·`addresses`를 조인해 후보를 좁힌다. 이 필터는 반드시 "실제 일치의
상위 집합"이어야 한다: SQLite LIKE는 ASCII만 대소문자를 접으므로 대소문자가 있는 비ASCII 글자가 든 단어는 SQL에 넣지 않는다(`foldable`). Envelope Index 구조는
`sqlite3 -readonly … ".schema messages"`처럼 표 정의만 읽어 확인한다(내용은 읽지 않는다). 사용량: 모델 행의 입력·출력 금액은 `estimateUsageCostPartsUsd`에서 나오며
합이 행의 금액과 같아야 한다. 새 기능 종류를 더할 때는 세 곳(`native-usage-observer.ts`, `native-usage-ledger.ts`, `model-usage-contracts.ts`)과
`usage-view.tsx`의 `WORKLOAD_LABELS`를 함께 고친다. `byDayWorkloadModel`은 `MODEL_USAGE_DETAIL_WORKLOADS`(브리핑, 논문 요약)만 담는다.

[0.58.139 설치](releases/0.58.139.md): `ContextUsageMeter`(Briefing 대화, AI 비서, Project Chat, Model Lab이 함께 씀)의 상세는 `popover="auto"`이고
`contextDetailPlacement`가 칩의 `getBoundingClientRect()`로 자리를 정한다. 호스트 CSS에 기대는 절대 위치로 되돌리지 말 것: AI 비서 입력 상자와 Project Chat
상자는 `overflow: hidden`이라 패널이 통째로 잘린다. 칩은 popover의 선언된 호출자(`popoverTarget`)라서 열고 닫기·바깥 클릭·Escape는 브라우저가 처리한다
(스크립트로 `showPopover()`를 부르면 칩을 다시 누를 때 닫혔다가 바로 다시 열린다). popover는 시스템 글자색을 쓰므로 색을 직접 준다. 겹쳐 뜨는 UI는 테스트 렌더러로
잘림을 알 수 없으니 실제 부모 구조와 실제 CSS로 브라우저에서 `elementFromPoint`로 확인한다. 사용 분포의 기능별 모델 구간은 `buildUsageDistribution`이 기능 행에
붙이는 `parts`와 `splitUsageParts`에서 나오고, 모델의 색(`tone`)은 지표가 아니라 리포트의 모델 순서를 따른다. "안 읽은 메일만"은 `mailStillUnread`
(`mailUnread` + `mailMarkedReadAt`)로 거르는 표시 필터다: Mail을 다시 읽지 않으며, 강조 목록과 섹션 개수에도 같은 필터를 적용해 숨은 카드로 가는 링크를 만들지 않는다.

[0.58.138 설치](releases/0.58.138.md): 사용량 화면의 금액은 모두 `renderer/src/usage-distribution-model.ts`의 `buildUsageDistribution(report, prices)`에서
나온다. 새 금액 표시를 만들 때 `byModel`이나 `byWorkload`를 따로 가격 계산하지 말 것: `aggregate()`는 보고된 턴 하나라도 캐시 수가 없으면 묶음의 캐시 수를
null로 만들어 정가로 계산되므로, 묶는 방식이 다르면 합이 어긋난다. 기준은 서비스가 만드는 `byWorkloadModel`(키: 기능·연결·제공자·upstream·모델, `byModel`과 같은
단위, `GLOBAL_USAGE_OWNER` 행 포함)이고, `usageCostParts`가 부분의 턴 합 = `totals.turnCount`일 때만 쓴다(1000행 절단·예전 리포트 대비). 금액 상태는
`known`/`unpriced`/`unreported`/`no_breakdown` 네 가지이며 0으로 뭉개지 않는다. `UsageDistribution`은 표시 전용(라벨과 기준을 props로 받음)이고 전환 상태는
`UsageView`에 둔다(`UsageReport`는 기간·필터마다 다시 마운트됨). `usage-view.test.tsx`는 가격표 없는 화면에 'API-equivalent'·'Cost' 문자열이 없을 것,
`— <small>Not reported</small>` 개수, `role="tab"` 3개를 확인하므로 새 구역은 다른 마크업과 `aria-pressed` 버튼을 쓴다. 실제 원장으로 확인하려면
`native-usage-ledger.v1.json`과 `model-prices.v1.json`의 사본을 임시 vitest에서 `NativeUsageLedger` + `ModelUsageService`로 돌린다(숫자만 출력).

[0.58.137 설치](releases/0.58.137.md): `LiveSourceService.keepUnsummarizedMail`은 요약 루프의 `finally`에서 저장되지 않은 선택 메일을 빈 요약으로
`saveBriefing`한다(15개씩, 실패해도 던지지 않음, 취소된 실행은 건너뜀). 빈 이메일 요약을 "미요약"으로 취급하는 곳(`isPriorityOnlyEmailSummary('')`는
true, `mailReadPlan`의 `!item.summary.trim()`, `dailyItemKeys`, 알림 집계, `summaryHistory`)을 바꾸면 재요약이 깨지니 함께 확인할 것. 단축키는
`shared/app-shortcuts.ts`의 `APP_SHORTCUT_TARGETS`에 `briefingRun`을 더했고(`.default()`로 예전 설정 파일 호환), `AssistantShortcutSchema`가 Enter 키를
허용한다. GOSU 안에서는 Briefing 프레임이 키를 직접 듣지 않는다: 메인의 `before-input-event` → `openSurface('briefingRun')` → `runRequest` →
`gosu-briefing-run-now`. 전체 디스크 접근 권한은 `main/full-disk-access.ts`(`~/Library/Mail` 목록 조회)와 `full-disk-access-notice.tsx`,
`permissions-helper.tsx`(둘 다 localStorage 플래그)로 안내만 한다. 권한이 업데이트 후 풀렸다는 보고가 오면 `codesign -d -r- /Applications/GOSU.app`의
designated requirement가 이전 빌드와 같은지 먼저 본다. 라이브러리 질문 버튼은 `asksPaperLibraryQuestion`(서버의 `approvedPaperSaveScope`와 같은 문구)이
기준이며 `PaperSummarySaveOffer`는 데스크톱 Project Chat과 Model Lab도 함께 쓴다.

[0.58.136 설치](releases/0.58.136.md)는 구독 한도 표시를 더했다. `shared/usage-limit-contracts.ts`(스키마, IPC 채널, `parseCodexRateLimits`,
`parseClaudeUsage`, `headlineWindow`), `main/usage-limit-service.ts`(`UsageLimitService`: `<userData>/usage-limits.v1.json`, 주기 갱신, 창이 보일 때만,
단일 실행, 실패 시 마지막 값 유지 + 코드 + 대기 시간 증가, Codex `account/rateLimits/updated` 수신), `main/claude-usage-probe.ts`(`get_usage` 제어 요청,
1분 미만 주기에서만 CLI 유지), `CodexAppServer.rateLimits()`. 규칙: 자격 증명을 읽지 않고 모델 요청을 보내지 않는다. Claude의 `get_usage`는 SDK에서
실험적이라고 표시된 호출이므로 형식이 바뀌면 `usage_limits_format`/`usage_limits_unsupported`가 뜬다: 그때는 실제 응답을 다시 받아(저장소의 테스트 러너로
`ClaudeUsageProbe`를 한 번 돌리면 된다. `tsx`는 `@gosu/contracts` exports 때문에 이 모듈을 못 읽는다) `parseClaudeUsage`와 `test/usage-limit-fixtures.ts`를
고친다. Codex 구간은 `primary`/`secondary` 위치가 아니라 `windowDurationMins`로 이름을 정한다(Pro는 주간만 `primary`로 온다). 타이틀 바 안에 `<strong>`을
쓰면 `.titlebar strong`(GOSU 로고 글자 스타일)을 물려받는다. 프로젝트 사이드바의 우클릭은 같은 줄의 `details.project-folder-menu`를 여는 것뿐이다.
Briefing Lab 단축키는 `desktop-bridge.ts`의 `isBriefingRunShortcut`과 `gosu-briefing-run-now` 메시지(데스크톱 → 프레임)로 동작한다.
Briefing 헤더(`.briefing-main-header`) 안에 그리는 것은 `<p>`를 쓰지 않는다: `workspace.css`가 헤더의 모든 `<p>`를 숨기며, 실행 경고의 상세 문구가
이 때문에 펼쳐도 보이지 않았다(단위 테스트는 통과한다. 실제 CSS를 넣은 페이지에서 `getBoundingClientRect`로 확인할 것).

[0.58.135 설치](releases/0.58.135.md)의 첫 부분: Briefing의 모델은 설정 → Agent 한 곳에서만 정한다. `briefing-model-routing.ts`의
`routedBriefingPreferences(preferences, policy, usage)`가 유일한 규칙이다: 사용처(`briefing`·`briefingAssistant`·`lightweightTasks`)의 역할에
모델이 있으면 제공자·모델·추론 수준을 모두 거기서 가져오고, 없을 때만 루틴에 저장된 선택(`preferences.providerId/modelId/reasoning`, 이제 UI에서
바꿀 수 없는 예전 값)을 쓴다. 새 AI 호출 경로를 만들 때는 `profile.preferences`를 직접 쓰지 말고 이 함수를 거친다(다시 요약·논문 분야 분류가
빠져 있었다). 개인 자료 검사 `canPrivateAi(id, provider)`·`assertMail(..., provider)`는 저장된 제공자이거나 `briefingRoutedProviders(policy)`에
있는 제공자만 통과시키며, 정책은 `LiveSourceService` 생성자가 `workspace.modelRouting`에 연결한다(정책 없이 만든 저장소는 저장된 제공자만 허용).
`scopeDigest`에는 저장된 제공자가 그대로 들어 있다: 이 값을 고치거나 digest에서 빼면 모든 루틴의 승인과 대화 기록 키가 바뀌므로 건드리지 않는다.
화면은 `/assistant/model/current`의 `usages`(사용처별 제공자·모델·`assigned`·`available`)를 `BriefingAgentModels`(설정)와
`BriefingModelBadge`(채팅 머리글)가 읽기 전용으로 보여 주고, `gosu-open-agent-settings` 메시지로 데스크톱의 설정 → Agent를 연다.
"브리핑이 설정과 다른 모델로 돌았다"는 보고가 오면 먼저 `model-routing.v1.json`의 그 사용처 역할에 모델이 지정돼 있는지 본다.
둘째 부분: `scripts/lab-bundles.mjs`를 더한다(타입은 `lab-bundles.d.mts`, 테스트는 `lab-bundles.test.mjs`).
`replaceLabBundle(source, target)`은 `source/index.html`을 확인한 뒤 대상 폴더를 지우고 복사하며, `electron.vite.config.ts`의
`bundle-model-lab` 플러그인이 두 Lab에 쓴다. 예전의 `mkdir` + `cp(recursive)`는 기존 폴더에 합쳐 넣기만 해서 해시 이름의 번들이 빌드마다
`out/model-lab/assets`·`out/briefing-lab/assets`에 쌓였다(Vite는 Lab의 `dist`를, electron-vite는 `out/main|preload|renderer`만 비운다).
`verifyPackagedLabBundles(asarPath)`는 `verify-packaged-app-startup.mjs`가 기동 smoke 앞에서 부르며, ASAR 헤더를 직접 읽어(`@electron/asar`는
pnpm에서 `scripts/`로 풀리지 않는다) `index.html`에서 시작해 파일 이름으로 도달 가능한 번들을 따라가고, 도달하지 못한 `.js`·`.mjs`·`.css`가 있으면
개수와 앞 12개 경로로 실패한다. 번들 점검에서 "지운 코드가 패키지에 남아 있다"가 나오면 먼저 이 검사가 통과했는지 본다. Turbo는 여전히 `out/**`를
캐시하고 복원은 지우지 않고 덮어쓰므로 디스크의 `out/`에는 예전 파일이 돌아올 수 있지만, `package:mac:*`는 Turbo를 거치지 않고 데스크톱 `build`를
직접 실행한다. 설정 파일에서 `scripts/*.mjs`를 가져올 때는 `allowJs: false`라서 옆에 `.d.mts` 선언이 있어야 타입 검사를 통과하고, Turbo는
패키지 안의 파일만 해시하므로 그 두 파일을 `turbo.json`의 `globalDependencies`에 넣어야 한다(`turbo-cache-policy.test.mjs`가
`electron.vite.config.ts`의 `../../` import마다 확인한다. 빠뜨리면 헬퍼를 고쳐도 캐시된 데스크톱 빌드가 재생된다). 이 Mac의
셸에는 `pnpm`이 PATH에 없을 수 있다: 저장소 안에서 `corepack pnpm`(11.19.0)을 쓴다(저장소 밖에서는 최신 pnpm을 내려받는다).

[0.58.134 설치](releases/0.58.134.md)는 `shared/model-price-contracts.ts`(스키마, `extractLitellmPrices`, `modelPriceKey`,
`estimateUsageCostUsd`, `summarizeUsageCost`, IPC 채널)와 `main/model-price-catalog.ts`(`ModelPriceCatalogStore`: `<userData>/model-prices.v1.json`,
ETag, 24시간 경과 시 갱신 + 1시간마다 확인, 단일 요청, 30초·16MB 제한, 실패 코드 6종)를 더했다. 가격을 소스에 적지 않는 것이 규칙이다: 새 모델이나
가격 변경은 목록이 갱신되면 따라오고, 목록에 없는 모델은 "가격 미확인"이다. GOSU 기록에서 캐시 읽기·쓰기는 입력 토큰의 일부, 추론은 출력 토큰의
일부이므로 비용은 부분별로 한 번씩만 곱한다. 구간별(200k/272k 초과)·batch·flex·priority 단가는 기간 합계로는 구분할 수 없어 쓰지 않는다.
`UsageView`는 `adapter.prices`/`refreshPrices`가 있을 때만 비용을 보이고 `initialPriceStatus`로 정적 렌더 테스트를 한다. 출처를 바꾸려면
`MODEL_PRICE_SOURCE_URL`과 `extractLitellmPrices`만 바꾸면 된다. 실제 목록 확인: `tsx`로 `ModelPriceCatalogStore`를 임시 폴더에 만들어
`refresh()`를 한 번 돌리면 된다(공개 GET).

[0.58.133 설치](releases/0.58.133.md)는 `briefing-model-routing.ts`의 `routedBriefingPreferences`가 제공자가 다를 때 던지지 않고 루틴의
설정을 그대로 돌려주며, 새 `roleRoutingNotice`가 그 이유 문장을 만들어 `generateDaily`의 warnings에 한 번 들어간다(어시스턴트 채팅의 자체 제공자
가드 `briefing-assistant.ts:309`는 그대로). 진단법: 실행이 메일 읽기 직후 요약 호출 없이 끝났으면(봉인 저장소 mtime이 마지막 osascript 종료
1초 뒤, 사용량 원장에 호출 없음) 묶음 루프의 재던지기 목록(`/cancel|abort|settings_changed|…|permission|…/`)에 걸리는 오류를 의심한다.
`BriefingGenerationControls`는 `job.error`가 있으면 상태와 무관하게 접힌 줄을 렌더링한다(`emailSourceState === 'failed'` → "이메일 조회
실패"). Model Lab: `--model-ai`(보라)와 `module-node--explained`(테두리·고리), 설명 상자 `module-detail-notes__ai`(저장된 항목의 user 메시지는
후속 질문 본문, 첫 설명 요청은 저장되지 않음), 사이드바 하단은 `panel-resizer--session-footer`(가로 구분선, `footerHeightAfterPointerMove`/
`footerHeightAfterSeparatorKey`, 저장 키 `gosu.model-lab.session-footer-height.v1`)와 `<details class="model-session-section">` 두 개
(`gosu.model-lab.session-sections.v1`; 가져오기가 시작되면 상태 섹션이 열린다). 사이드바 격자는 4행(`auto minmax(0,1fr) auto auto`)이고 접힌
사이드바는 구분선도 숨긴다. 날씨 카드는 `.weather-hit-layer`가 포인터 x를 `nearestHourIndex`로 시각에 매핑한다. 미리보기: 내장 브라우저
뷰포트가 사용자가 고른 768px이면 사이드바가 위에 쌓이는 모바일 배치로 보인다. 논문 저장 제안은 `answersFromSavedPapers`(답변의 paper 출처가 모두 `saved: true`면 제안 생략)로 걸러지며 `saved`는 `search_saved_papers`/`read_saved_paper`가 만든 출처에만 붙는다. `briefing-generation.test.ts`의 `ROLE_MODELS` 매트릭스는 새 모델을 역할에 쓰게 되면 한 줄 추가한다(같은 제공자면 역할 모델·reasoning 사용, 다르면 루틴 모델 + 안내). 채팅 입력은 `.briefing-chat-input-box`(테두리) 안에 textarea(`field-sizing: content`)와 `.briefing-chat-input-toolbar`(왼쪽 shortcuts, 오른쪽 `.briefing-chat-composer-actions`)가 흐름대로 놓인다(예전의 절대 위치 아이콘과 96px 고정 높이는 없다). 조용한 상태("답변 완료")는 `data-quiet`로 시각적으로만 숨긴다. 표 스크롤러에는 `overscroll-behavior: contain`을 쓰지 않는다(세로 휠을 삼킨다): `usage-view.css`는 x만 contain이다. 브리핑 시각 픽스처(`tools/*-visual.html`)는 dev 서버 전용이라 `vite build` 입력으로는 풀리지 않는다.

[0.58.132 설치](releases/0.58.132.md)는 `task-compact.tsx`(`compactTaskDue`·`TaskDue`·`TaskIcon`)를 더하고 `workspace-tasks-view.tsx`와
`board-view.tsx`의 헤더·필터·빠른 추가·행·카드 마크업을 재구성했다. 규칙: 필터/빠른 추가의 라벨은 `<span className="field-label">`로 감싸고
`.board-filter-bar .field-label, .task-composer > label > .field-label`에서만 시각적으로 숨긴다(상세 입력의 라벨은 보인다). 행은
`.todo-task-row`(flex, min-height 34px, `> .priority-badge`는 62px 고정 열, 우선순위가 없으면 `.none` 빈 칸), 제목은 `.todo-task-title`.
카드는 `.task-card-heading`(제목 h3, 2줄 clamp) + `.task-card-meta`(그 안의 `.task-labels`는 `display: contents`). 동작 버튼은 DOM에 남긴 채
`.todo-task-actions, .task-actions { opacity: 0 }`이고 `:hover`·`:focus-within`에서 1이 되며, 카드에서는 `position: absolute` 모서리 띠다.
테스트는 버튼 글자가 아니라 `aria-label`과 `<svg class="task-icon"`로 확인한다. 전체 보기의 단계 이름은 공용 열 이름과 다를 때만
`WorkspaceOwnStage`가 보여준다. 미리보기 방법: 컴포넌트를 `renderToStaticMarkup`으로 HTML에 쓰고 **`packages/ui/src/typography.css`를 함께
넣어야** 앱과 같은 글자 크기(본문 12px)가 된다. `styles.css`의 `@import '@gosu/ui/typography.css'`는 정적 HTML에서 풀리지 않아, 빠뜨리면
모든 수치가 크게 나온다(이번에 제안 단계 수치가 그렇게 부풀었다). 새로 쓴 실행 파일은 macOS가 먼저 검사하므로(이 Mac에서 0.26~0.54초)
스크립트를 만들어 바로 실행하는 테스트는 시작 대기를 500ms보다 넉넉히 준다.

[0.58.131 설치](releases/0.58.131.md)는 `mail-directory-store.ts`(봉인 파일 `mail-directory.v1.enc.json`: 승인 범위 메일함의 Mail 계정 id와
메일함 경로만, 최대 64개)를 더하고 `AppleMailConnection`이 `restorePolicyGrant`·`resolveMailbox` 앞에서 이를 복원한다. 지문은 저장값에서
다시 계산하므로 항목은 자기가 가리키는 메일함만 대신할 수 있다. 복원만 된 위치는 `unconfirmed`이고, 읽기가
`mail_account_missing|mail_mailbox_missing`(이제 `readerFailure`가 stderr에서 그대로 전달)으로 실패하면 `locationFailure`가 `discover`로
확인해 없어진 위치는 `mail_account_refresh_required`로 보고하고 잊는다(계정 목록이 limited/unavailable이면 잊지 않는다). 생성자 5번째
인자가 저장소이며 주입한 테스트 리더는 기본값이 null이라 `~/Library`를 건드리지 않는다. `runAppleMail` 감독: 스크립트가 `mail.accounts()`
직후 `{type:'answered'}`를 내보내고 `MailReadStream.answered`가 선다. 그 전에는 `APPLE_MAIL_FIRST_RESPONSE_MS`(300초)만 돌며 15초마다
`waitedSeconds` 진행을 보낸다. 첫 응답 후 read는 기존 160초 총 제한(부분 결과 유지), discover/mailboxes는 메일함마다 progress를 내고
160초 무응답 또는 총 `APPLE_MAIL_DISCOVERY_DEADLINE_MS`(420초)에서 멈춘다. `collect`는 `mail_timeout_account` 뒤 남은 계정을 Mail에 보내지
않고 `delayedAccounts`를 돌려준다. `LiveSourceService.collect`의 7번째 인자 `mailRecovery {retry,onDelayed}`는 `generateDaily`만 넘기며,
응답하다 끊긴 실패(`mailDelayed`이면서 `_account`가 아님)에 `mailRetryPauseMs`(20초) 뒤 한 번 재시도하고, 끝까지 무응답이면 Scholar 검색을
건너뛴다. `generateDaily`는 `retryMailInMs`(`MAIL_FOLLOW_UP_MS` 10분)를 돌려주고 `BriefingGeneration.followUpMail`이 `nextDueAt`을 당긴다:
루틴당 연속 1회(`mailFollowUps`), 자동 실행이 없거나 `nextDueAt`이 null(설정 변경으로 일시 중지)이면 예약하지 않는다. 진단법: 재시작 직후
"조회 미완료"면 `log show --predicate 'process == "osascript"'`로 리더 수명이 제한 시간과 같은지, Mail의 `com.apple.appleevents … dead:1`
줄이 있는지 본다(이 Mac에서는 `log show` 자체가 부하 중 5분 이상 걸리니 구간을 10분 이내로). 봉인 저장소의 mtime으로 마지막 실행 종료
시각을 알 수 있다. Mail에 AppleScript를 보내 시험하지 않는다.

[0.58.130 설치](releases/0.58.130.md)는 `briefing-credential-mail.ts`의 `isCredentialMail`(제목과 본문 앞 600자, "one time" 단독은
제외)을 더하고, `automaticSummaryPlan`이 그런 메일을 요약 대상에서 빼며(그래서 handled로 남는다), `saveBriefing`은 항목 단위로만
보류하고, `analyze`의 `historySaveFailed`가 "저장소 실패"와 "저장할 것이 없음"을 구분한다. 실행 루프는 전자일 때만
`briefing_memory_unavailable`로 멈춘다. 진단법: 사용량 원장에서 실패 호출들이 첫 묶음 완료 0.3초 뒤 동시에 끝났으면 제공자가 아니라
`runBatchesConcurrently`의 앱 측 중단이다. 실행 가드는 `generationScheduled`를 쓴다(루틴 시각만 예약된 경우). `restorePolicyGrant`는
같은 범위의 유효한 grant를 revoke하지 않고 연장한다. 채팅 모델 선택 레코드는 `origin: 'user'`가 있을 때만 `stored`, 없으면
`inherited`(설정을 따름)이고 기본값은 더 이상 저장하지 않는다. 화면 단축키는 `shared/app-shortcuts.ts`·`app-shortcut-store.ts`
(`app-shortcuts.v1.json`)·`installAppShortcutInput`·`openSurface` 채널이며 preload 표면 고정 테스트(`preload-navigation.test.ts`)에
새 메서드를 추가해야 한다. 빠른 1차 브리핑은 같은 날 기록의 이전 것을 `previousBriefing`으로 받아 `newPoints`/`carriedPoints`로
갱신하고 `mergeQuickBriefingUpdate`가 이전 줄을 보존한다. 부하가 높을 때(load 100+) 전체 검사는 5초 제한으로 실패할 수 있으니 실패
테스트를 단독·긴 제한으로 재실행해 구분한다.

[0.58.129 설치](releases/0.58.129.md)는 `codex-runtime-discovery.ts`가 프리릴리스를 semver 순서로 인정하게 하고(주 버전 가드는
유지), macOS에서 `/opt/homebrew/bin/codex`와 `/usr/local/bin/codex`를 후보에 넣는다. 그런 런타임은 node 스크립트라
`codexRuntimeEnvironment`가 그 디렉터리를 PATH 앞에 붙여 probe·spawn한다(데스크톱 app server, Model Lab 모두). `CodexAppServer`는
설치된 런타임이 initialize 전에 죽으면 `resolveCodexCommand({ bundledOnly: true })`로 한 번 되돌아간다(`GOSU_CODEX_BIN`은 대체하지
않음). 모델이 목록에서 빠지면 `@gosu/desktop/codex-project-chat/models_cache.json`의 `client_version`부터 본다. `VaultAccess.restore`는
single-flight이고 실패 사유(`restoreError`)를 남기며, `ResearchNotesService.current`가 미연결 시 재연결한다. 저장된 볼트를 못 열면
`research_notes_vault_missing|permission_denied|unreadable`을 던지고, 아무것도 저장되지 않았을 때만 `null`(첫 선택 화면)이다. 볼트
루트는 암호화된 `gosu.db`의 `cache_records`에 있어 직접 열지 않는다. 볼트 안 `.gosu-project.json`의 `vaultId`로 확인한다.

[0.58.128 설치](releases/0.58.128.md)는 Model Lab 채팅 메시지에 `moduleRef`(모듈 id·key·이름·위치·한 줄 요약·kind)를
더한다. 모듈 상세의 질문은 별도 스레드가 아니라 같은 Copilot 대화의 메시지이고, 본문은 질문만, 모델에는 `prompt`(모듈 문맥 포함)가
간다. 이후 턴의 history는 `moduleConversationBody`가 모듈 출처를 붙인다. 0.58.125~127이 저장한 원시 프롬프트는
`legacyModuleQuestion`으로 읽는다. `findGraphModule`은 반복 블록 안 단계까지 찾아 표시에서 상세를 연다. 모듈별 저장소
(`module-explanations`)는 카드 표시(`explainedKeys`)와 대화가 지워졌을 때의 대체 표시에만 쓴다. 기본 설명은
`module-explanation-text.ts`의 `moduleReading`(규칙 기반, 문장 단위 읽기는 `pseudocodeStatementSummary`)이다. 런타임 어댑터는
`modelLabRuntimeErrorDetail`로 서버 실패 코드를 보존한다(코드 형태가 아니면 버린다). Model Lab 상태는
`@gosu/desktop/model-lab/projects/<id>/workspace.json`에 있으므로 Copilot 턴 실패는 그 파일의 chat-sessions에서 먼저 확인한다.
Briefing 채팅의 "최신" 버튼은 `isNearLatestMessage`(96px)와 `.briefing-chat-log-region`이다.

[0.58.127 설치](releases/0.58.127.md)는 자동 실행 기록에 `routineSchedule`을 더하고 `nextGenerationDueAt`가 루틴 시각과
간격 중 이른 쪽을 고른다(`generationScheduled`가 둘 중 하나라도 켜졌는지 본다). 루틴 스케줄은 서버 프로필이 아니라 이 기록에
스냅샷으로 저장되며, 화면에서 시각이 바뀌면 컨트롤이 한 번 다시 저장한다. Model Lab 모듈 설명 저장소는 대화 배열
(`messages`)로 바뀌었고 예전 단일 답변은 첫 assistant 메시지로 읽는다. 후속 질문은 `moduleFollowUpQuestion`이 모듈 문맥과
직전 대화를 붙여 같은 Copilot 턴으로 보낸다(편집 제안은 반영하지 않음).

[0.58.126 설치](releases/0.58.126.md)는 `BriefingWorkspaceStore.hostReadProfile`/`assertHostRead`/`hostPrivateAllowed`와
`briefing-host-reads.ts`를 더한다. Briefing 읽기는 원래 브라우저 client token(`owns`)을 요구해서 Main이 통과할 수 없었다.
앱 자신이 사용자를 대신해 읽을 때만 `owns`를 앱의 신뢰 경계로 대체하고, 승인·범위 digest·권한 플래그는 그대로 검사한다.
`LiveSourceService.hostReads()` → `BriefingDesktopHost.reads()` → `ProjectChatService.briefingReads` → 프로젝트 도구
네 개로 이어지며, 확인 창은 호출한 프로젝트 채팅 이름을 표시한다. 정책 버전은 42이고 `project-chat-prompt.test.ts`가 고정한다.

[0.58.125 설치](releases/0.58.125.md)는 AI 비서 연구 작업 공간 도구(`briefing-assistant-workspace.ts`: 명시 요청
판별 `explicitAssistantWrites`, 턴별 제한과 재시도 안전 id, `assistantTodoCreator`)와 데스크톱 `global-assistant-workspace.ts`
(노트·서재·원고·실험 동작, 쓰기 전 권한 재확인), `LiteratureService.addFromAssistant`를 더한다. 쓰기 확인 창은
`confirmingAssistantWrites`가 담당한다. Model Lab 상세의 이동·흐름은 `module-detail-flow.ts`, AI 설명 저장은
`module-explanations.ts`(`gosu.model-lab.module-explanations.v1`)이며 설명 요청은 편집 제안을 반영하지 않는다(`explanationOnly`).

[0.58.124 설치](releases/0.58.124.md)는 `apps/model-lab/src/repeat-step-description.ts`(의사코드 한 줄의 문자 그대로
LaTeX 변환, 단계 이름, 언어별 설명)와 `repeatedModuleStepEntries`(들여쓰기로 if/with 문맥 추적)를 더한다. 정확한 연산 패턴이
먼저이고, 코드가 아닌 문장만 기존 대체 문구를 쓴다. 그래프는 `MODEL_GRAPH_POINTER_OPTIONS`로 상자 선택을 끈다(React Flow는
Shift를 눌린 것으로 보면 드래그를 선택으로 바꾼다).

[0.58.123 설치](releases/0.58.123.md)는 `apps/model-lab/model-lab-chat-write.ts`(명시 요청 판별, 요청 id, 도구 설명, 실패
코드)와 `ProjectModelTransferStore.addFromChat`·`ModelLabDesktopHost.addModelForChat`을 더한다. 열린 Model Lab iframe은
작업 공간 전체를 메모리에서 다시 쓰므로 Main이 `workspace.json`에 직접 쓰면 사라진다. 채팅 모델은 반드시 복사 대기함으로 넣는다.
프로젝트 채팅 도구는 `add_model_to_model_lab`(정책 v41), AI 비서는 브리지 `model-lab-add`와 `confirmingModelLabAdds`다.

[0.58.122 설치](releases/0.58.122.md)는 0.58.121의 `generateDaily` 예약 확인(`generationProfileMatches`로 저장된
`generationProfileDigest`와 비교)을 포함한다. 예약기 테스트는 실행을 mock으로 바꾸므로, 실제 서비스로 예약 실행을 돌리는
테스트(`runs a scheduled briefing through the real generation`)가 이 경로를 지킨다. `AppleMailLink`의 `onOpened`는 열기 요청이
받아진 뒤에만 불리며, 이메일 카드는 여기서 `markMailReadFor`를 호출한다.

[0.58.120 설치](releases/0.58.120.md)는 `PaperBriefingDisclosure` 안에 `BriefingSectionRail`(선택 `className`)을
`briefing-item-rail`로 둔다. 스타일은 `details.briefing-paper-disclosure > .briefing-item-rail`로 한정한다. 카드 안 버튼 공통 규칙
`.briefing-insight-card details button`이 여백·테두리·흰 배경을 덮어쓰기 때문이다.

[0.58.119 설치](releases/0.58.119.md)는 0.58.118의 `markMailReadFor`(`mail-read-status.tsx`, 수동 버튼과 같은
`/mail/mark-read`, 세션 중복 방지)를 포함한다. `feedbackProfile(routineId, includePrivate, senderOf)`는 키워드·보낸 사람·도메인을
각각 `FEEDBACK_PROFILE_LIMIT`(24)까지 두고, 보낸 사람은 `feedbackSenderLookup`이 저장된 브리핑과 현재 수집 결과에서 항목 id로
찾는다(기억 파일 형식 변경 없음). 이메일 요약은 항목별 `senderFeedback`과 조건부 `SENDER_FEEDBACK_INSTRUCTION`만 받는다.

[0.58.117 설치](releases/0.58.117.md)는 `sourceResponse`가 429 `routine_busy`(서버가 읽기 전에 거절)를 0.3·0.7·1.5초 뒤
다시 보내고, 끝내 실패하면 한국어 메시지와 `code: 'routine_busy'`를 준다. 지침 읽기는 `readBriefingGuidance`로 루틴당 하나만
진행된다. 제목 옆 진행 줄은 `overflow: hidden`, 저장 개수 `flex-shrink: 0`, 경고 `flex-shrink: 3`·최소 62px, 칸 최소
`min(160px, 100%)`이다. 새 요청을 동시에 늘리는 기능은 서버의 3개 제한을 고려한다.

[0.58.116 설치](releases/0.58.116.md)는 `runRoutineAgent`에서 `briefingClientContext`의 토큰을 잡아
`dynamicToolHandler`를 `briefingClientContext.run`으로 감싼다. 제공자 도구 호출(Claude Code MCP 브리지, Codex)은 요청의
AsyncLocalStorage 밖에서 오므로, 소유 확인(`owns`)을 쓰는 코드를 제공자 콜백에서 실행하면 요청자 문맥을 다시 넣어야 한다.

[0.58.115 설치](releases/0.58.115.md)는 `briefing-chat.tsx`에서 답변 중 `.briefing-chat-status`를 그리지 않고 경과 시간을
진행 메시지 머리에 둔다. `ContextUsageMeter`는 요약 칩과 `.briefing-context-detail`(당시에는 위로 열리는 절대 위치 패널, 0.58.139부터 top layer popover)로 나뉘고
`.briefing-chat-composer-actions` 안 `.briefing-chat-composer-meta`에 있다. 복원 안내는 로그 안 `.briefing-chat-restored-note`다.

[0.58.114 설치](releases/0.58.114.md)는 `.briefing-assistant-highlights` 열을
`minmax(min(260px, 100%), 1fr)`로 넓히고, `.briefing-assistant-highlight`를 두 열 grid(`minmax(0, 1fr) auto`)로 바꿔
`.briefing-summary-jump-hint`를 첫 행 둘째 열에 둔다. 카드 안 `.briefing-mail-delivery`는 한 줄이고 계정이 먼저 말줄임된다.
전체 검사가 load 20 안팎에서 데스크톱 Git·노트 테스트 시간 초과로 실패할 수 있다. 부하를 확인하고 다시 돌린다.

[0.58.113 설치](releases/0.58.113.md)는 `.briefing-assistant-highlights`를 `align-items: stretch`와
`grid-auto-rows: 1fr`로 바꿔 요약 카드를 모두 같은 크기로 만들고, 카드(`.briefing-assistant-highlight`)를 flex 열로 두어
`.briefing-summary-jump-hint`를 `margin-top: auto`로 바닥에 붙인다. 회귀 테스트는 `briefing-summary-card-size.test.ts`다.

[0.58.112 설치](releases/0.58.112.md)는 `BriefingGuidanceStore`(`guidance.v1.enc.json`, 루틴별)와
`/assistant/guidance/list|add|edit|delete` 경로를 더한다. 지침은 프로필 밖에 있어 `generationRunDigest`를 바꾸지 않는다.
`analyzeBriefing`의 마지막 인자와 `quickBriefingPayload`의 `guidance`로 전달되며, 지침이 없으면 프롬프트가 그대로다.
`src/briefing-guidance.ts`가 주소·도메인 규칙을 만들고 보낸 사람 주소로만 맞춘다(`matchesUserGuidance`, 기록 화면 고정).
헤더 안 UI는 `<p>`를 쓰지 않는다(`.briefing-main-header p`가 숨김).

[0.58.111 설치](releases/0.58.111.md)는 `mailReadNotice`가 일상 조회에서 빈 문자열을 돌려주고(첫 연결·새 계정만 안내),
`live-mail`은 빈 `notice`를 싣지 않는다. 기록 화면은 예전에 저장된 일상 조회 안내(`이미 요약한 메일은 제외하고…`)를 숨기고, 할 일
설명은 `todos.limited`일 때만 보인다. 참고로 `apps/desktop/out/briefing-lab/assets`에 이전 렌더러 빌드가 계속 쌓여 ASAR에 함께
들어간다(실제로 읽는 것은 `index.html`이 가리키는 하나). 이 누적은 [0.58.135 설치](releases/0.58.135.md)에서 고쳤다.

[0.58.110 설치](releases/0.58.110.md)는 `BriefingGenerationControls`의 `inSlot`으로 진행 상자·접힌 실행 경고·일시 중지 안내를
모두 제목 옆 `.briefing-title-progress`에 렌더링한다. `.briefing-title-row`는 최소 34px, 상태 칸은 `flex: 1 1 0`·줄바꿈 없음,
제목 열은 `flex: 1 1 0`으로 버튼 옆 남은 폭만 쓴다. 헤더 정렬 확인은 실제 CSS 미리보기에서 요소 세로 중심을 재서 한다.

[0.58.109 설치](releases/0.58.109.md)는 `src/email-action-weekday.ts`로 준비된 일정·할 일을 근거 문장의 단일 요일에
맞춘다(명시 날짜·복수 요일·종일 일정은 제외, Temporal로 현지 시각 유지). 요약 선별(`screenInsights`), `draftEmailEvent`,
저장 초안을 여는 버튼(`alignedPreparedActions`)에서 적용되고, 프롬프트에는 `receivedLocal`(요일 포함)이 들어간다. 실행 경고와
일시 중지 안내는 `BriefingCollapsibleAlert`(닫힌 `details`)이다. Claude CLI 결과가 ENOTFOUND 등 연결 오류면
`claude_code_network_unavailable`로 분류한다.

[0.58.108 설치](releases/0.58.108.md)는 `.briefing-assistant-highlight`에 종류별 `--highlight-accent`/`--highlight-tint`를
두고 왼쪽 막대·배경·라벨 색에 쓴다(`BriefingJumpTarget`에 `task` 추가). 기록 화면의 요약 카드는 `upcomingTodos`로
미완료 할 일 2개를 함께 보여주며, GOSU 안에서는 `openBriefingItem({kind:'task'})`로 연다.

[0.58.107 설치](releases/0.58.107.md)는 본문 읽기 요청 항목에 `html` 표시를 두어 Scholar 알림만
`source()`를 `mail-source`로 스트리밍하고, `src/mail-html-links.ts`가 MIME의 text/html 부분을 해석해 `mailLinks`로 붙인다.
`scholarCandidates`는 링크 글자가 기사 제목이고 `paperLink`를 통과할 때만 연결하며 `[PDF]`·도메인 글자는 제목으로 쓰지 않는다.
실제 알림 점검은 Mail 요청 없이 Envelope Index로 ID를 찾아 `.emlx`를 읽기 전용으로 열고 개수만 출력한다.

[0.58.106 설치](releases/0.58.106.md)는 `BriefingGenerationControls`에 `progressSlot`을 두어 실행 중 진행 상자를
`briefing-app.tsx` 제목 줄의 `.briefing-title-progress`에 포털로 렌더링한다(슬롯이 없으면 기존처럼 컨트롤 안). 제목 줄의
상세는 `position: absolute` 패널이고, 420px 컨트롤 열은 진행 상자나 `[role='alert']`가 컨트롤 안에 있을 때만 잡는다.

[0.58.105 설치](releases/0.58.105.md)는 메일 목록을 `readMailIndex`(node:sqlite, 읽기 전용)로 가져와 리더에 `indexed`
ID를 넘긴다. 리더는 `whose` 없이 `messages.byId`로 읽고 받은 시각이 2초 넘게 다르면 `mail_index_mismatch`를 던져 기존
방식으로 한 번 다시 읽는다. 색인 실패는 `warning`→생성 경고·`mailIndexFallback`으로 드러난다. 요약 검증은
`screenInsights`가 항목별로 하고(`quoteMatches`는 문장부호·공백·대소문자·생략 부호 허용), 요청 밖 ID는 버리며, 실패
항목만 한 번 재요청해 `rejectedItems`로 돌려준다. 생성은 실패 메일을 처리 완료로 표시하지 않아 다음 브리핑이 다시
읽는다. 요약 기억은 ID 없이 `{kind, text}`로만 보낸다. 진행 상세는 `summaryKinds`·`quickBriefingState`,
섹션 접기 막대는 `BriefingSectionRail`이다.

[0.58.104 설치](releases/0.58.104.md)는 일정 브리핑의 AI 단계를 병렬화한다. `runBatchesConcurrently`가 이메일 3개·
논문 2개 묶음을 동시에 돌리고, 치명적 오류는 새 묶음을 멈추고 진행 중 묶음을 중단시킨 뒤 다시 던진다. 수집 직후
`quickFirstBriefing`이 메타데이터만으로 `snapshot.quickBriefing`을 저장하고 `quickBriefingAt`으로 기록 화면을 새로고침한다
(메일 AI·private AI 허용, 매번 확인 아님일 때만, 실패는 경고). Claude Code의 `off` 추론 수준(기본값, 요청 없음 포함)과
`structuredJob.thinking: 'disabled'`는 `--effort`를 빼고 `MAX_THINKING_TOKENS=0`으로 실행한다. 속도 문제를 다시 볼 때는
먼저 사고 토큰(`usage.output_tokens_details.thinking_tokens`)을 확인한다.

[0.58.103 설치](releases/0.58.103.md)는 앱 시작 경로에서 safeStorage를 모두 뺀다. 0.58.102 기록과 달리 Overleaf 토큰
상태 확인(`overleafPersonalToken.status()`)은 창이 열릴 때 실행되어 토큰을 복호화했다. `PromptFreeSecretSealing`이
Overleaf 자격 증명 저장소와 강의 매니페스트 인증기에 safeStorage 대신 주입되며, `GOSU-SEAL-v2:` 접두어가 없는 기존
파일만 safeStorage로 읽고 시작 시 `credentials/overleaf-git/*.bin`과 `manifest-authentication-key.bin`을 한 번 다시
봉인한다. 도우미가 없으면 기존 경로 그대로다. 되돌린 이전 빌드는 다시 봉인된 토큰을 읽지 못하므로 백업에
`credentials/`와 `lecture-external-sources/`를 포함한다. safeStorage를 새로 쓰는 코드는 시작 경로에 두지 않는다.

[0.58.102 설치](releases/0.58.102.md)는 데이터베이스 키 보관 방식을 바꾼다. 팀 ID가 없는 로컬 서명에서는
Electron safeStorage의 키체인 허용이 빌드마다 사라지므로, 시작 경로는 `openLocalDatabaseWithWrappedKey`로
`local-key.v2.json`(Briefing 시스템 키에서 HKDF로 파생한 키로 AES-GCM 래핑)을 연다. 기존 `local-key.bin`은 마이그레이션
때 한 번 읽고 남겨두며, 도우미 실패 시 기존 경로로 연다. 강의 외부 소스·Overleaf 자격 증명은 아직 safeStorage를
쓰므로 그 기능을 처음 쓸 때 비밀번호를 물을 수 있다. 앱 백업에 `local-key.bin`과 WAL 파일을 포함한다.

[0.58.101 설치](releases/0.58.101.md)는 메일 읽기를 두 프로세스로 나눈다. 일반 읽기는 목록·연결 정보까지만 하고
(`bodiesDeferred`), 본문과 원문 증명은 `runAppleMailBodies`가 메일별 `body-start` 신호로 감시하며 8초(첫 메일 20초)
무응답이면 그 메일을 본문 대기로 두고 새 리더로 이어간다. 최대 개수 이후 새 메일은 `pending`으로만 세고 커버리지는
마지막으로 읽은 메일에 둔다. 커버리지 확정은 누락 경로마다 사유(`limit`·`body`·`incomplete`·`read-failed`)를 붙여
경고로 돌려준다. 커버리지 정보가 없는 리더(테스트 대역 등)는 경고도 커버리지 변경도 하지 않는다.

[0.58.100 설치](releases/0.58.100.md)는 Apple Mail 스크립트 성능의 핵심 규칙을 남긴다. 큰 메일함에서 위치 기반
지정자(`box.messages[n]`)의 Apple Event는 매번 위치를 다시 풀어 1~2초가 들고, `whose`가 반환한 ID 기반
참조(`messages.byId`)는 속성당 약 1ms다. 일반 수집은 커버리지 바닥 이후를 `whose`로 한 번 묻고 수신 시각으로
정렬해 모든 단계에서 그 참조를 재사용한다. 원문 증명은 `messageSize()`를 먼저 본다. 읽음 처리 위치 탐색은 아직
위치 기반이다. CLI 진단용 임시 래퍼는 백그라운드 실행(`&`) 시 stdin을 잃어 GOSU 요약을 실패시키므로 쓰면 안 된다.

[0.58.99 설치](releases/0.58.99.md)는 메일 누락 방지 구조를 기록한다. 워크스페이스의 `mailCoverage`는 메일함마다
`(coveredFrom, coveredTo]`를 빠짐없이 확인·처리한 구간으로, `gapFrom`은 아직 못 읽은 구간의 하한으로 저장한다.
리더는 이전 커버리지−6시간(승인된 조회 기간 아래로는 내려가지 않음)을 바닥으로 삼고 멈춘 이유·가장 오래 확인한
메일·시간 순서를 보고한다. 커버리지 확정은 요약 저장 뒤 `nextMailCoverage`로만 하며, 요약 실패·본문 미확인·순서
뒤섞임·중간 중단·읽기 실패는 전진시키지 않는다. 이미 요약한 메일은 `mailDeliveryKey`(ID·받은 시각)로 제목 읽기 전에
건너뛴다. 일반 메일 읽기와 Scholar 알림 검색은 Mail 경합을 피하려 순차 실행한다.

[0.58.98 설치](releases/0.58.98.md)는 메일 중복 병합에 `sameDeliveredMail`을 추가한다. 검증된 원문 일치 또는
서로 다른 계정의 동일 Message-ID(`message://` 링크)·제목이면 한 행으로 합치고, 양쪽 원문 증명이 서로 다르면
합치지 않는다. `sameVerifiedMail`, 요약 캐시 재사용, 증명 재확인 대상 선정은 그대로다. 표시 시점 병합이므로
저장된 두 사본에 링크가 모두 있어야 기존 이력도 합쳐진다.

[0.58.97 설치](releases/0.58.97.md)는 Apple Mail 다중 계정 읽기를 순차로 바꾼다. Mail은 Apple Event를 한
번에 하나씩 처리하므로 동시 리더는 서로를 기다리며 각자의 60초 기한을 소비한다(Gmail 목록 정보는 메일당
약 0.5–1.2초, 연세는 20–70ms). 결과 한도·계정 표시·범위 검사·부분 결과 처리는 그대로이고, 철회 시 진행 중인
리더만 중단하고 다음 계정은 시작하지 않는다. 동시 실행 경합은 측정이 아니라 타이밍·코드·화면으로 추론했다.

[0.58.96 설치](releases/0.58.96.md)는 Apple Mail 리더의 패스 순서를 Message-ID → 본문 → 원문 증명으로
바꾼 이유를 기록한다. 읽기 전용 진단에서 Message-ID는 한 통당 0.02–0.8초였지만 `content()`는 한 계정에서
8통 중 2통이 약 61초 멈췄고, 60초 읽기 제한은 부분 결과를 돌려주므로 본문을 먼저 읽으면 링크가 전혀 남지
않는다. Briefing 분석은 이메일 5분·논문 8분 기한을 쓰며 이를 Claude 턴 제한으로도 넘긴다. 요약 묶음 실패는
경고(`summaryFailures`)로 남기고 계속하되, 취소·설정/소유권 변경·동의·권한·로그인·모델 불가는 실행을 멈추고
모든 묶음이 실패하면 실행 실패로 처리한다. `manuscript-pdf-compiler.test.ts`의 종료 시 프로세스 그룹 정리
테스트는 간헐 실패가 확인되어 별도 작업으로 남겼다.

[0.58.95 설치](releases/0.58.95.md)는 CLI 업데이트 뒤 모든 구조화 Claude 턴이 실패한 원인을 기록한다.
`z.toJSONSchema`가 붙이는 `$schema`(draft 2020-12)를 Claude Code 2.1.272의 `--json-schema` 검증기가
해석하지 못해 요청 전 exit 1로 끝났다. 어댑터는 `claudeCliJsonSchema`로 스키마 수준 `$schema`만 제거하고
결과는 GOSU 스키마로 계속 검증한다. 직접 CLI 실험이 성공하는데 앱만 실패하면, 실험 스키마와 실제 인자가
같은지부터 확인해야 한다. 이번에는 GOSU가 부모일 때만 기록하는 임시 래퍼로 실제 stderr를 얻은 뒤 즉시
원래 링크로 되돌렸다. 자동 생성 스케줄은 승인 범위 digest만 저장하므로, 중지 안내는 범위에 포함된
항목을 나열할 뿐 어느 하나가 바뀌었는지 단정하지 않는다.

[0.58.94 설치](releases/0.58.94.md)는 Claude 로그인 상태를 오류 문구가 아니라 `claude auth status`로
판단하는 쪽을 보강한다. 카탈로그 갱신에서 `loggedIn`이 참이 아니면 캐시된 연결을 버리고 이후 요청은
`claude_code_auth_required`를 낸다(API 키 등 다른 인증 방식은 구독 필요 오류로 구분). macOS는 번들
브리지의 EventKit 요청을 호스트 앱에 귀속하므로, 미리 알림 사용 설명은 브리지가 아니라 호스트
`Info.plist`에 있어야 권한 창이 뜬다. `native-usage-ledger.v1.json`은 평문이라 실패한 호출의 모델과
소요 시간을 확인하는 첫 증거로 쓸 수 있다. 설치된 0.58.93에서 로그인 후에도 약 0.7초 만에 실패한 원인은
아직 미확인이며, 이번 버전의 오류 코드 표시로 확인할 예정이다.

[0.58.93 설치](releases/0.58.93.md)는 Claude Code 모델을 어댑터의 표 하나에서 게시하고, CLI 버전이
낮으면 Fable 5.1을 목록에서 빼 요청 전에 거부한다. `routedBriefingPreferences`는 Briefing 대화에서 고른
모델을 `briefingAssistant`에만 적용하므로 이메일·논문 요약은 설정한 역할(빠른 모델)을 따른다. 사이드바
AI 별은 `sidebar-row-label` 안에서 이름 옆에 놓여 격자 열을 건드리지 않고, 완료 상태는 `#f2b705`
발광이며 포인터 이벤트를 받지 않아 클릭이 행으로 전달돼 확인 처리된다. 검사 시간의 대부분은
`test/git-workspace-service.test.ts`(실제 git 실행, 35초)이며, 과거의 30분은 실험 프로세스와의 경쟁
때문이었다. 실제 앱에서의 모델 목록·요약 모델·별 동작 확인은 사용자에게 남아 있다.

[0.58.92 설치](releases/0.58.92.md)는 Apple Mail 메일 조회 실패가 코드가 아니라 시스템 과부하(실험
프로세스, 코어 10개에 부하 170~~205)로 Apple Event가 3~~17초씩 걸린 탓임을 기록한다. 메일 목록 읽기 제한은
50초이고 최신순이 두 날짜로 확인되면 기간 밖 메일에서 멈춘다. arXiv 429는 GOSU 밖의 요청 제한이며,
논문 조회는 실패 출처와 이유를 보존해 안내한다. 실제 Briefing 실행은 한가한 시점에 사용자 확인이 남아 있다.

[0.58.91 설치](releases/0.58.91.md)는 Lecture Studio를 Codex App Server 대신 Project Chat 라우터에
연결해 `claude-code:*` 모델을 허용한다. Claude CLI는 턴 중 진행 알림이 없으므로 Claude 강의 턴은 idle
감시 대신 전체 제한만 쓰고 스레드별 `turnTimeoutMs`(5–30분)를 요청한다. 제공자별 연결 끊김은 해당
제공자 턴만 끝낸다. 설정 저장과 실제 Claude 강의 생성은 사용자 확인이 남아 있다.

[0.58.90 설치](releases/0.58.90.md)는 GOSU AI 입력창 위 여백을 줄이고 `SealedStateStore` 저장 비용을
낮춘다. 저장 한 번은 기록 수와 무관한 고정 비용(약 3ms CPU + 7.6ms 파일 작업)이다. 자기 커밋의
inode·크기·mtime·ctime이 같을 때만 복호화를 건너뛰고 스키마 검증은 유지한다. 다른 쓰기나 변조는
전체 인증 읽기로 돌아간다. 부하 중 테스트 시간 초과는 동시 캡처·검사를 피해서 재현·확인한다.

[0.58.89 설치](releases/0.58.89.md)는 앱 내 Claude 로그인에 인증 코드 입력칸을 더한다. 터미널 없는
`claude auth login`은 브라우저 코드를 stdin으로 기다리므로, 로그인 중에만 코드를 받아 해당 프로세스에
전달하고 저장·기록하지 않는다. 백업 후 교체했고 실제 코드 입력 로그인은 사용자 확인이 남아 있다.

[0.58.88 설치](releases/0.58.88.md)는 Claude 구독 로그인을 설정 화면에서 시작한다. Main이 공식
`claude auth login --claudeai`만 실행하고 자격 증명은 Claude Code 저장소에 남는다. `auth status`는
토큰 만료를 검증하지 않으므로 turn의 `claude_code_auth_required`를 재로그인 안내로 표시한다.
nvm Node 22.22.3(ICU 78.2)은 한국어 시간을 `PM`으로 만들어 Briefing 날짜 테스트가 실패하므로
Runtime gate는 Node 26으로 실행했다. 백업 후 교체했고 실제 설정 화면 확인은 남아 있다.

[0.58.87 후보](releases/0.58.87.md)는 [생성 deadline](MODEL_GENERATION_DEADLINES.md)을
호출당 15분/큰 입력 30분으로 늘린다. 진단상 300초 로컬 cutoff에 후보가 없었으며 검증 실패와
구분한다. ModelIR 생성 경로만 확대하고 다른 호출·모델 설정·검증은 유지한다. 명시 Stop의
AbortSignal 전달, reader 정리와 늦은 결과 차단을 확인했다. 전체 4,239개/기존 제외 8개·Runtime
1,780개·모의 UI·패키징·고정 서명 통과. 설치는 .85 정상 종료 후 새 백업/교체 대기다.

[0.58.86 후보](releases/0.58.86.md)는 [AI 상태 별](SIDEBAR_AI_ACTIVITY.md)을 기존 아이콘 옆에
추가한다. 실제 실행 중/성공 결과/확인 상태를 분리하고 실패·취소만으로 완료 표시를 만들지
않는다. Frame source/origin과 workload를 확인하고 부모가 project scope를 정한다. Reload는
해당 producer의 실행만 초기화·재동기화한다. 전체 4,230개/기존 제외 8개·Runtime 1,753개,
테마/너비별 화면·패키징·고정 서명 통과. .85가 키체인 대기 이후 계속 실행 중이어서 강제
종료하지 않았다. 사용자 정상 종료 후 새 백업/교체/실제 설치 UI 확인을 이어간다.

[0.58.85 설치](releases/0.58.85.md)는 [그래프 검증](MODEL_GRAPH_PRESENTATION.md)의 nested
axis/index 등호 오판을 고치고 실제 validator 피드백으로 compiler를 1회 보정한다.
정확히 중복된 loop-carried 간선만 같은 소유자/포트/shape 확인 후 binding으로 정규화한다.
실제 요청 모델을 LLM으로 생성·검증해 기존 r0은 그대로 두고 r1을 저장했다. 다른 모델·대화·
설정은 유지했다. 전체 4,211개/기존 제외 8개·Runtime 1,734개, 고정 서명·백업·설치 smoke 통과.
새 client 미리보기에서 그래프를 확인했으나 실제 설치 창은 키체인 읽기 대기다. 사용자가 OS
요청을 처리한 뒤 실제 r1 UI 확인을 이어간다. .84 연속성 변경도 포함하며 실행 검증/수학 증명은 별개다.

[0.58.84 후보](releases/0.58.84.md)는 [AI 대화 연속성](CHAT_EXECUTION_CONTINUITY.md)을
보완한다. Model Copilot은 활성 모델 변경과 무관한 대화별 controller/진행 상태를 사용하며
답변은 원래 세션에 저장한다. Project Chat의 navigation SSH 취소/자동 거절을 제거하고
원래 scope의 전역 승인창·명시 취소·만료·권한 철회는 유지한다. 전체 4,204개/기존 제외 8개,
Runtime 1,683개·패키징·고정 서명 통과. 설치본은 실제 실행 확인된 .83이며 다른 백그라운드
작업을 중단하지 않도록 정상 종료 후 새 백업/교체를 기다린다. 앱 종료 후 inference 지속은 보장하지 않는다.

[0.58.83 설치](releases/0.58.83.md)는 메일 읽기 차단을 AI 제공자 승인 오류로 잘못 안내하던
재요약 분기를 구분한다. 소유한 설정의 승인만 무효이면 기존 설정 그대로 native 재승인을
요청하며 유효한 승인은 재사용하고 꺼진 권한은 유지한다. 전체 4,195개/기존 제외 8개,
Runtime 1,636개·동일 서명·백업·설치 smoke 통과. 실제 재실행은 키체인 읽기 대기이며
사용자 승인 후 실제 UI/메일 재요약 검증을 이어간다. 이전 .82 관심 토글 수정도 포함한다.

[0.58.82 후보](releases/0.58.82.md)는 관심 선택의 명시적 null 해제를 API·암호화 선호·UI에
연결한다. 같은 항목의 선호만 제거하고 다른 자료/요약은 유지한다. 전체 4,185개/기존 제외 8개,
Runtime 1,626개·화면·패키징·서명 통과. 설치본의 Model Copilot이 실행 중이라 종료/교체하지
않았다. 이후 새 상태·백업·해시를 확인해 이어가며 실행 중 연구 작업을 중단하지 않는다.

[0.58.81 설치](releases/0.58.81.md)는 이전 이메일 요약의 누락된 할 일 기한을 소유한 저장
자료에서 보수적으로 복원한다. 재요약/원문 재조회 없이 저장하고, 원래 요약·시각은 유지한다.
미리 알림 기본 목록/내보내기 선택은 암호화 task-links 저장소에 보존하되 OS 권한을 허위로
저장하지 않는다. 전체 4,182개/기존 제외 8개, Runtime 1,617개·동일 서명·백업·설치 및 실제
문제 이메일에서 날짜/12시 입력을 확인했다. OS 최초 허용/목록 선택은 사용자에게 남겨 두었다.

[0.58.80 설치](releases/0.58.80.md)는 [그래프 추론 계약](MODEL_GRAPH_PRESENTATION.md)을
생성·Copilot·정규화에 공유한다. 핵심 수식은 원래 수식의 행을 선택하고, 역할·차원 설명·
미확정 사항은 의사 코드 저장/복원에도 유지한다. 전체 4,161개/기존 제외 8개, Runtime 1,596개,
동일 서명·백업·설치·실제 버전과 대화 복원을 확인했다. 기존 손상 모델의 수학을 검증하거나
원본 없이 자동 정정한 것이 아니다.

[0.58.79 설치](releases/0.58.79.md)는 아래 0.58.74–78 후보와 후속 그래프 여백·메일 복구·
시간이 있는 할 일·Model Copilot 수정 실패 분리를 포함한다. 사용자 승인으로 임시 서명을
원래 고정 인증서로 복구했다. 보호된 백업, 전체 4,150개/기존 제외 8개, Runtime 1,545개,
설치 서명·기동 검사와 실제 버전/기존 Project Chat 복원을 확인했다. 개인 자료의 실작업 및
전체 메뉴 탐색 성공과는 구분하며, 실제 백업·해시·제한은 릴리스 기록을 따른다.

[0.58.78 후보](releases/0.58.78.md)는 Briefing Lab 클릭을 History로 직접 연결하고 Papers를
동등한 다음 행으로 분리한다. 하위 메뉴/루틴 관리 진입만 제거하며 데이터·설정은 유지한다.
논문 제목 옆 원문 버튼은 저장된 안전한 URL만 열고 펼침/AI 호출을 유발하지 않는다.

[0.58.77 후보](releases/0.58.77.md)는 완료된 조회 결과와 job 오류를 헤더에서 제거한다.
실행 중 진행·중단 및 실제 조작/설정 실패는 유지하고 자동 주기·이력·본문 소스 상태는 바꾸지 않는다.
전체 4,120개·Runtime 1,498개, 화면·패키징·고정 서명 검증 통과. 현재 설치본과의 서명 연속성
실패로 교체하지 않았다. 서명 복구에 대한 사용자 검토 전 gate를 우회하지 않는다.

[0.58.76 후보](releases/0.58.76.md)는 알림 진입의 scrollIntoView를 내부 pane 스크롤로 대체한다.
실제 브라우저에서 문서가 55px 밀리는 현상을 재현했고 수정 후 문서/host offset 0과 전체 높이를
확인했다. 알림 요청은 한 번만 이동하고 history 갱신 때 사용자 스크롤을 빼앗지 않는다.
전체 4,118개·Runtime 1,496개 통과. 고정 서명 후보를 준비했으나 현재 임시 서명 설치본과
연속성 검증에 실패하여 교체하지 않았다. 서명 복구 검토·승인 전에 gate를 우회하지 않는다.

[0.58.75 후보](releases/0.58.75.md)는 [사전 준비한 이메일 작업](EMAIL_PREPARED_ACTIONS.md)을
저장하고 버튼의 LLM 재호출을 없앤다. Apple 권한이 없는 경우 GOSU-only 저장을 허용한다.
기존 요약은 강제 재생성하지 않으며, 확인창/목적지/서버 중복 방지와 OS 권한 경계를 유지한다.
전체 4,114개·Runtime 1,487개 통과. 작업 중 설치본이 외부에서 같은 ASAR의 임시 서명 0.58.75로
바뀌어 서명 연속성 검증에 실패했다. 고정 인증서 복구에 대한 사용자 검토 없이 설치를 진행하지 않는다.

[0.58.74 후보](releases/0.58.74.md)는 [비서 공개 웹/미디어](ASSISTANT_WEB_MEDIA.md)를 연결한다.
비서만 live 검색, 요약/루틴 기본은 disabled다. 기존 scope 검증은 유지한다. 외부 이미지/지도는
사용자가 눌러 표시하며 복원만으로 원격 요청하지 않는다. 공개 Nominatim API는 추가하지 않는다.

[0.58.73 설치](releases/0.58.73.md)는 공통 논문 disclosure 하단에 상단과 동일한 AI 참조 버튼을
추가한다. 접기 버튼과 같은 작은 행에 배치하며, 참조/대화/저장 권한과 자동 질의 동작은 바꾸지 않는다.

[0.58.72 설치](releases/0.58.72.md)는 [구조 우선 그래프](MODEL_GRAPH_PRESENTATION.md)를 적용한다.
기본 forward 흐름, 동일 높이 카드와 상세 수식 분리, 영어 표시 이름을 사용한다. 기존 저장 모델과
참조/hash는 바꾸지 않는다. 생성 시 영어 이름/안전한 차원을 검증하고 기존 잘못된 차원은 추측하지 않는다.

[0.58.71 설치](releases/0.58.71.md)는 모델 옆 AI 대화 버튼을 Model Copilot으로 명확히 연결한다.
선택 모델/리비전 태그와 입력 포커스를 유지하고 Project Chat 이동은 모델 메뉴의 별도 항목으로
옮긴다. 같은 프로젝트의 Model Lab을 읽는 Project Chat 도구와 저장된 참조/대화는 그대로다.
실제 Model Lab 컴포넌트의 모의 hosted 화면에서 모델 전환·태그·포커스 및 이동/LLM 호출 0회를 확인했다.
전체 4,073개·Runtime 1,465개 통과. 0.58.67–70 변경도 포함해 정상 Quit/백업/교체했다.
설치 버전·해시·기동 smoke 통과, 설정 파일은 보존했다. 재실행 main thread가 키체인 복호화에서
대기하므로 사용자에게 macOS 승인창 확인을 요청했다. OS 보안을 우회하거나 데이터를 초기화하지
말고, 응답 후 실제 설치 UI를 확인한다. 자세한 백업 경로와 검증 범위는 릴리스 기록을 따른다.

[0.58.70 후보](releases/0.58.70.md)는 [사이드바 프로젝트 순서](PROJECT_SIDEBAR_ORDER.md)를
마우스 드래그와 메뉴로 바꾼다. 기존 로컬 navigation 상태에 ID 순서만 저장하고 프로젝트 데이터,
선택/펼침과 실행 중인 작업은 건드리지 않는다. 새 프로젝트 추가·숨김/복원·취소·외부 파일 드래그
거부를 검증하며, 실제 브라우저에서 양방향 드래그와 새로고침 후 복원을 확인했다.

[0.58.69 후보](releases/0.58.69.md)는 설정의 모델 구조 추출 사용처를 빠른/고성능/기존 모델에
연결한다. 새 구조 추출과 audit repair에만 적용하며, 캐시와 Model Lab 채팅 선택은 유지한다.
기존 설정 파일의 새 필드 미지정은 기존 Model Lab 선택을 뜻한다. 빈 역할은 오류로 안내한다.
전체 4,066개·Runtime 1,458개·설정 화면 검증 통과. 설치 상태는 릴리스 기록을 확인한다.

[0.58.68 후보](releases/0.58.68.md)는 할 일의 프로젝트를 선택 사항으로 바꾸고 개인 할 일을
`projectId: null`로 저장한다. 표시용 그룹은 실제 프로젝트가 아니다. To-do/브리핑/마감 알림/
휴지통에 연결하며, 프로젝트 전용 Sync에는 보내지 않는다. UI에서 확인한 신규 생성과 AI의
기존 할 일 읽기 권한을 분리한다. 일정처럼 AI 준비 후 편집창을 열고 성공 시 닫는다.
실제 SQLCipher 저장/수정과 outbox 보존 smoke 통과. 전체/설치 상태와 구버전 rollback 주의는
해당 릴리스 및 [할 일 계약](BRIEFING_TASKS_AND_LIGHTWEIGHT_MODELS.md)을 확인한다.

[0.58.67 후보](releases/0.58.67.md)는 내부 iframe 재로드가 메인 renderer 준비 상태를 false로
고정해 네이티브 단축키 요청을 대기시키던 문제를 수정한다. main document navigation만 추적하고,
before-input-event에서 물리 키를 비교한다. 단축키 설정은 보조키/키 선택 목록으로 바꾼다.
Electron 격리 재현에서 이전 gate 실패와 수정 후 iframe/입력창 포커스 성공을 확인했다.
전체 최종 검사·설치 상태는 해당 릴리스 기록을 확인한다.

[0.58.66 후보](releases/0.58.66.md)는 이메일 할 일 버튼도 경량 AI로 제목·내용·마감일을
채우도록 연결했다. 수정한 초안 보존·근거/권한 검증·확인 후 저장은 유지한다. 전체 4,048개,
Runtime 1,446개·합성 Spark 실호출·실렌더·서명 continuity 통과. 설치본은 0.58.65이며
정상 종료 메뉴가 창 변경으로 거부되고 재조회가 timeout이라 교체하지 않았다. 사용자 종료 후
새 백업·해시/설정 재확인부터 이어간다. 실제 개인 할 일·미리 알림은 생성하지 않았다.

[0.58.65 설치](releases/0.58.65.md)는 [아주 가벼운 모델·할 일 추가](BRIEFING_TASKS_AND_LIGHTWEIGHT_MODELS.md)를
연결한다. 일정 초안은 별도 Spark/low 역할로 지정했고 기존 fast/strong 설정은 유지했다.
이메일 옆 할 일 추가는 GOSU 프로젝트와 선택한 Apple 미리 알림 목록에 확인 후 저장하며,
중복/부분 실패를 구분한다. 전체 4,034개/환경 제외 8개·Runtime 1,440개·네이티브 컴파일·화면 검사 후
정상 종료·백업·교체했다. 실제 v0.58.65/저장 모델/자동 주기 파일 보존 확인. OS 미리 알림 허용과
실제 개인 항목 생성·휴대폰 도착은 미검증이며, 수정/완료 양방향 동기화는 구현 범위가 아니다.

[0.58.64 설치](releases/0.58.64.md)는 진행 상세 내용 때문에 헤더 버튼이 밀리던 문제를
수정한다. 최소화/갱신/생성/중단을 같은 행에 두고 상세 영역 폭을 고정한다. 넓고 좁은 검증
화면에서 펼침 전후 버튼 좌표가 동일했다. 전체 4,018개/환경 제외 8개·Runtime 1,424개 통과.
정상 종료·백업·교체 후 실제 v0.58.64와 기록 복원, 자동 갱신 파일 보존을 확인했다.

[0.58.63 설치](releases/0.58.63.md)는 AI 비서만 28px였던 그림을 검색/알림과 같은 18px로
줄인다. 버튼/22px 슬롯/말풍선/반짝임은 유지한다. 전체 4,016개/환경 제외 8개·Runtime 1,422개,
4종 화면 검사 및 밝은/어두운 화면 직접 확인. 작업 중 설치본이 0.58.62로 바뀌고 생성이 끝난 것을
재확인한 뒤 정상 종료·새 백업·교체했다. 실제 v0.58.63의 아이콘과 이력, 자동 주기 파일 보존 확인.

[0.58.62 후보](releases/0.58.62.md)는 앱 내 AI 비서 단축키 ⌘⇧Space와 설정의 단축키 항목을
추가한다. 앱 외부 설정 파일에 저장하고 네이티브 메뉴를 즉시 갱신한다. 전역 OS 단축키는 아니다.
전체 4,015개/환경 제외 8개·Runtime 1,422개·설정 합성 화면 확인. 설치본 0.58.58의 실행 중인
브리핑을 중단해도 되는지 사용자에게 확인 요청했으며 아직 교체하지 않았다.

[0.58.61 후보](releases/0.58.61.md)는 이메일의 첫 날짜 정규식 대신 요약 모델로 일정 초안을
준비한다. 근거·시간대·범위 검증과 권한 재확인 후 편집창에 제목/시간/장소/메모를 전달한다.
실제 합성 메일 모델 호출에서 약 10초에 확정된 약속을 추출했다. 전체 4,010개/환경 제외 8개,
Runtime 1,422개 통과. 0.58.59–60 수정도 포함하며 실제 일정 생성은 시험하지 않았다.

[0.58.60 후보](releases/0.58.60.md)는 같은 날 Calendar 재조회를 생략하던 조건을 제거한다.
새 브리핑마다 승인된 오늘·내일 일정을 갱신하고 실패 때 이전 일정은 보존한다. 실조회에서
현재 3개/저장 2개, 누락 1개를 확인했다. 전체 4,004개/환경 제외 8개·Runtime 1,422개 통과.
0.58.59 Scholar 수정도 포함하며 설치본 0.58.58은 생성 중이라 아직 교체하지 않았다.

[0.58.59 후보](releases/0.58.59.md)는 Scholar 알림을 일반 이메일 요약 제외 목록과 독립적으로
검색한다. 기존 계정/기간/미리보기 권한은 유지하고 논문 기준 중복을 제외한다. Crossref 후보는
기간 안에서 관련성순으로 조회한다. 실조회에서 공개 후보 2개, 알림 10개에서 논문 후보 12개를
확인했다. 전체 4,003개/환경 제외 8개·Runtime 1,421개 통과. 설치본 0.58.58은 브리핑 생성 중이다.

[0.58.58 설치](releases/0.58.58.md)는 강수확률을 고정 0–100% 축으로 표시하며 시간별 숫자를
제거한다. 0/50/100% 축 눈금과 비례 막대, 선택 상세값만 유지한다. 전체 4,001개/환경 제외 8개,
Runtime 1,419개·실렌더·서명 검증 후 정상 종료·백업·교체했다. 실제 v0.58.58과 4시간 주기 확인.

[0.58.57 설치](releases/0.58.57.md)는 날씨의 반복 0% 숫자를 연속 구간별로 묶는다. 모두 0%이면
한 줄 설명과 낮은 기준선으로 표시하고 그래프를 158px로 줄인다. 값·이력·시간별 상세는 유지한다.
전체 4,001개/환경 제외 8개·Runtime 1,419개·합성 화면·빌드·서명 검증 후 백업/교체했다.
설치본 v0.58.57과 4시간 자동 주기, 새 0% 그래프 설명을 확인했다. 기존 자료/설정은 유지했다.

[0.58.56 설치](releases/0.58.56.md)는 자동 브리핑 주기를 오류 때 끔으로 덮어쓰지 않는다.
승인된 창/모델 설정과 실행 권한을 구분하고, 실제 권한 변경은 주기를 보존한 채 일시 중지한다.
로딩 중 끔 표시를 제거하며 재시작 후 4시간 등 기존 선택을 복원한다.
전체 3,999개/환경 제외 8개·Runtime 1,411개·화면/빌드/서명 검증 후 정상 종료·백업·교체했다.
실제 v0.58.56에서 4시간 주기와 기존 다음 실행 시각, 이력 복원을 확인했다. 설정 파일도 보존했다.

[0.58.55 설치](releases/0.58.55.md)는 [문맥 효율·사용량 집계](TOKEN_EFFICIENCY_AND_ACCOUNTING.md)를
개선한다. 원본 기억은 유지하고 인사/관련 이력을 선택하며, 비서·브리핑·Model Lab·압축의 실제
호출 카운터를 별도 metadata ledger로 기록한다. 기존 Project Chat 집계와 모델별로 함께 표시한다.
전체 3,994개/환경 제외 8개, Runtime 1,406개·합성 화면·빌드·서명·continuity 통과. 종료 확인 후
0.58.52와 DB/브리핑/기억/모델 설정을 백업하고 교체했다. 실제 v0.58.55 및 기존 이력을 확인했다.
0.58.53 논문 검색과 0.58.54 승인 재사용도 함께 설치했다. 새 실측 과금/LLM 품질 검증과는 구분한다.

[0.58.54 후보](releases/0.58.54.md)는 [승인 범위 재사용](APPROVED_SCOPE_REUSE.md)을 공통 설정으로
연결한다. 승인된 Briefing 범위와 일반 사용자 SSH 작업 폴더를 재사용하되 root/OS/새 범위는
자동 승인하지 않는다. 개별 철회와 실행 직전 binding 재검증·audit는 유지한다. 0.58.53도 포함한다.

[0.58.53 후보](releases/0.58.53.md)는 채팅에만 있던 대체 논문 검색을 실제 브리핑 생성에도 연결한다.
arXiv 실패 시에도 Crossref/OpenReview 후보를 유지하며 날짜·연구 필터·저장 요약 제외를 지킨다.
실패를 0개로 오해하지 않도록 빈 실패 섹션 제목을 조회 미완료로 구분한다.

[0.58.52 설치](releases/0.58.52.md)는 이메일을 중요도·실제 수신 시각 순으로 정렬하고 발신자를
기존 계정/시간 메타데이터 줄에 표시한다. 발신자를 암호화 이력에 저장하며, 이전 누락 이력은
명시적인 단일 메일 헤더 조회로 복구할 수 있다. AI 재요약·읽음 변경·자동 대량 재조회는 하지 않는다.
전체 3,967개/환경 제외 8개, Runtime 1,266개, 실렌더·빌드·고정 서명·continuity 통과.
정상 종료 후 앱/보호된 데이터를 백업해 교체했고 실제 v0.58.52와 기존 이력 표시를 확인했다.

[0.58.51 설치](releases/0.58.51.md)는 작은 말풍선이 된 0.58.50 디자인을 대체한다. AI 비서
그림만 28px로 키우고 큰 말풍선·반짝임 배지를 함께 쓴다. 버튼·22px 정렬 슬롯·채팅 패널은 유지한다.
전체 3,954개/환경 제외 8개, Runtime 1,236개, 실렌더 4종 통과. 사용자 정상 종료 확인 뒤
0.58.49와 보호된 데이터를 백업하고 교체했다. 실제 v0.58.51·새 아이콘·기존 이력을 확인했다.

[0.58.50 후보](releases/0.58.50.md)는 AI 비서 반짝임을 1.75배로 키우고 테마 녹색으로 강조한다.
버튼·아이콘 슬롯·채팅 동작은 유지한다. 전체 3,954개/환경 제외 8개, Runtime 1,236개,
실렌더 4종·빌드·패키징·고정 서명·continuity 통과. 정상 종료 요청이 적용되지 않고
사용자 창 상태가 바뀌어 설치본 0.58.49는 유지했다. 검증된 staging과 재개 절차는 릴리스 기록에 있다.

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
