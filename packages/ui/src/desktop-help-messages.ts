/** Desktop permission and help copy. The same safety scope is retained in both languages. */
const pairs: readonly (readonly [string, string])[] = [
  [
    'Delete “{title}” from project tasks? It will move to Task trash and can be restored later.',
    '프로젝트 할 일에서 “{title}”을 삭제할까요? 할 일 휴지통으로 이동하며 나중에 복원할 수 있습니다.',
  ],
  [
    'Saved a new immutable logging-template revision with {loggingChangeCount} reviewed change.',
    '검토한 변경 {loggingChangeCount}개를 반영한 새 불변 로깅 템플릿 리비전을 저장했습니다.',
  ],
  [
    'Saved a new immutable logging-template revision with {loggingChangeCount} reviewed changes.',
    '검토한 변경 {loggingChangeCount}개를 반영한 새 불변 로깅 템플릿 리비전을 저장했습니다.',
  ],
  [
    'Move “{title}” to Trash?\n\nThe Studio session and its chat history can be restored from Settings. Saved Research Notes and exported LaTeX/PDF files will stay on disk.',
    '“{title}”을 휴지통으로 옮길까요?\n\n스튜디오 세션과 채팅 이력은 설정에서 복원할 수 있습니다. 저장된 연구 노트와 내보낸 LaTeX/PDF 파일은 디스크에 남습니다.',
  ],
  [
    "Delete “{title}” from this project's Literature table? This does not delete the source paper or repository files.",
    '프로젝트의 문헌 표에서 “{title}”을 삭제할까요? 원본 논문이나 저장소 파일은 삭제하지 않습니다.',
  ],
  [
    "Couldn't check Overleaf. Previous result may be stale. No remote files were changed. {value1}",
    'Overleaf를 확인하지 못했습니다. 이전 결과는 오래된 정보일 수 있습니다. 원격 파일은 변경하지 않았습니다. {value1}',
  ],
  [
    'Remove “{title}”? This deletes only this unused local setup record. It cannot be undone.',
    '“{title}”을 제거할까요? 사용하지 않는 로컬 설정 기록만 삭제합니다. 되돌릴 수 없습니다.',
  ],
  [
    'Enable Project trusted execution / Auto-run for {label} in {name}?\n\nSupported operations inside {canonicalRoot} will run without repeated Allow once prompts. This setting applies only to this project and exact server grant.',
    '{name}의 {label}에 대해 프로젝트 신뢰 실행 / 자동 실행을 활성화할까요?\n\n{canonicalRoot} 안에서 지원되는 작업은 반복적인 한 번 허용 요청 없이 실행됩니다. 이 설정은 해당 프로젝트와 정확한 서버 접근 권한에만 적용됩니다.',
  ],
  [
    'ROOT FINAL WARNING: code launched for {name} may read, modify, or delete anything on the remote server, including data outside {canonicalRoot}. GOSU exposes only bounded project operations, but launched code is not sandboxed. Enable automatic ROOT execution anyway?',
    'ROOT 최종 경고: {name}에서 실행되는 코드는 {canonicalRoot} 밖의 데이터를 포함해 원격 서버의 모든 내용을 읽거나 수정·삭제할 수 있습니다. GOSU는 제한된 프로젝트 작업만 제공하지만 실행되는 코드는 sandbox로 격리되지 않습니다. 그래도 자동 ROOT 실행을 활성화할까요?',
  ],
  [
    'Final warning: tests, builds, and Python entrypoints run with this SSH account’s OS and network permissions. GOSU exposes no raw-shell control, but launched repository code is not sandboxed and can access anything this account permits. Enable anyway?',
    '최종 경고: test, build, Python 진입점은 이 SSH 계정의 운영체제·네트워크 권한으로 실행됩니다. GOSU는 원시 shell 제어를 제공하지 않지만 실행되는 저장소 코드는 sandbox로 격리되지 않으며 계정에 허용된 모든 자원에 접근할 수 있습니다. 그래도 활성화할까요?',
  ],
  [
    'Final warning (2 of 2): permanently remove {length} project from GOSU? External repositories, Research Notes files, and remote server data will be preserved. This cannot be undone in GOSU.',
    '최종 경고(2/2): 프로젝트 {length}개를 GOSU에서 영구 삭제할까요? 외부 저장소, 연구 노트 파일, 원격 서버 데이터는 유지됩니다. GOSU에서는 되돌릴 수 없습니다.',
  ],
  [
    'Final warning (2 of 2): permanently remove {length} projects from GOSU? External repositories, Research Notes files, and remote server data will be preserved. This cannot be undone in GOSU.',
    '최종 경고(2/2): 프로젝트 {length}개를 GOSU에서 영구 삭제할까요? 외부 저장소, 연구 노트 파일, 원격 서버 데이터는 유지됩니다. GOSU에서는 되돌릴 수 없습니다.',
  ],
  [
    'Final warning (2 of 2): permanently remove {length} Lecture Studio from GOSU? Research Notes and exported files remain on disk. This cannot be undone in GOSU.',
    '최종 경고(2/2): 강의 스튜디오 {length}개를 GOSU에서 영구 삭제할까요? 연구 노트와 내보낸 파일은 디스크에 남습니다. GOSU에서는 되돌릴 수 없습니다.',
  ],
  [
    'Final warning (2 of 2): permanently remove {length} Lecture Studios from GOSU? Research Notes and exported files remain on disk. This cannot be undone in GOSU.',
    '최종 경고(2/2): 강의 스튜디오 {length}개를 GOSU에서 영구 삭제할까요? 연구 노트와 내보낸 파일은 디스크에 남습니다. GOSU에서는 되돌릴 수 없습니다.',
  ],
  [
    'Delete “{title}” from {projectLabel}? It will move to Task trash and can be restored later.',
    '{projectLabel}에서 “{title}”을 삭제할까요? 할 일 휴지통으로 이동하며 나중에 복원할 수 있습니다.',
  ],
  [
    '{value1} · GOSU verified a local claude.ai subscription login. Credentials remain in Claude Code.',
    '{value1} · 로컬 claude.ai 구독 로그인을 검증했습니다. 인증 정보는 Claude Code에 남습니다.',
  ],
  [
    '{value1} · GOSU verified the runtime manifest and completed a sealed ACP session check before showing Connected; credentials remain local.',
    '{value1} · 연결됨으로 표시하기 전에 runtime manifest를 검증하고 격리된 ACP 세션 검사를 완료했습니다. 인증 정보는 로컬에 남습니다.',
  ],
  [
    'Revision {currentRevision} is loaded as the edit base. Chat edits currently require the model to return complete replacement bodies for both Notes and Slides—not a small patch. GOSU then validates both documents, may run one correction, and compiles both PDFs. For a literal text change, Stop generation and use Edit source to skip the model call.',
    '리비전 {currentRevision}을 편집 기준으로 불러왔습니다. 현재 채팅 편집에서는 모델이 작은 patch가 아니라 강의 노트와 슬라이드의 전체 교체 본문을 반환해야 합니다. GOSU는 두 문서를 검증하고 필요하면 한 번 수정한 후 두 PDF를 컴파일합니다. 단순한 텍스트 변경에는 생성을 중단하고 원본 편집을 사용하면 모델 호출을 생략할 수 있습니다.',
  ],
  [
    'Analyze the next {length} papers without an AI draft; available abstracts are included',
    'AI 초안이 없는 다음 논문 {length}개 분석 · 확보된 초록 포함',
  ],
  [
    'Compile the exact captured checkpoint locally with {value1}. This choice is not read from Overleaf.',
    '{value1}으로 저장된 정확한 체크포인트를 로컬에서 컴파일합니다. 이 선택은 Overleaf에서 읽어 오지 않습니다.',
  ],
  [
    ' This foreground Python experiment can execute untrusted project code and change server state. GOSU waits for it for at most {SSH_COMMAND_MAX_TIMEOUT_SECONDS} seconds; this is not an unattended job runner.',
    ' 이 포그라운드 Python 실험은 신뢰되지 않은 프로젝트 코드를 실행하고 서버 상태를 변경할 수 있습니다. GOSU는 최대 {SSH_COMMAND_MAX_TIMEOUT_SECONDS}초 동안 기다리며 무인 작업 실행기가 아닙니다.',
  ],
  [
    'Design, inspect and discuss models in this project workspace.',
    '프로젝트 작업 공간에서 모델을 설계하고 살펴보며 대화하세요.',
  ],
  [
    'Talk with the linked Codex model and turn the conversation into reviewed project work.',
    '연결된 Codex 모델과 대화하고 검토를 거쳐 프로젝트 작업으로 이어 가세요.',
  ],
  [
    'Browse project files, review changes and history, and use bounded Git operations without a terminal.',
    '프로젝트 파일과 변경·이력을 살펴보고 터미널 없이 제한된 Git 작업을 사용하세요.',
  ],
  [
    'Connect replaceable writing engines and capture immutable inbound checkpoints for future import and review.',
    '교체 가능한 집필 엔진을 연결하고 이후 가져오기·검토에 사용할 불변 체크포인트를 저장하세요.',
  ],
  [
    'Create work, move it through the research workflow, and keep every change locally.',
    '할 일을 만들고 연구 단계에 따라 이동하며 모든 변경을 로컬에 보관하세요.',
  ],
  [
    'Define a versioned goal, evaluation metric, reproducibility hashes, and hard experiment budget.',
    '목표, 평가 지표, 재현성 해시, 엄격한 실험 예산을 버전별로 정의하세요.',
  ],
  [
    'Trace ideas into experiments, follow metric progress, and build a report from stored evidence.',
    '아이디어에서 실험으로 이어지는 과정을 추적하고 지표 변화를 확인하며 저장된 근거로 보고서를 만드세요.',
  ],
  [
    'Build a living evidence table, enrich it with AI, and move records safely between JSON, CSV, and BibTeX.',
    '지속적으로 갱신하는 근거 표를 만들고 AI로 보완하며 JSON, CSV, BibTeX 사이에서 기록을 안전하게 옮기세요.',
  ],
  [
    'Review and update the active tasks from every project in one Kanban board or To-do list.',
    '모든 프로젝트의 활성 할 일을 하나의 Kanban 보드 또는 할 일 목록에서 검토하고 갱신하세요.',
  ],
  [
    'Combine papers and experiments across projects into editable lecture notes and timed talk slides.',
    '여러 프로젝트의 논문과 실험을 모아 편집 가능한 강의 노트와 발표 시간에 맞춘 슬라이드를 만드세요.',
  ],
  [
    'Search every non-trashed project locally and return to the original conversation, note, or workspace tab.',
    '휴지통에 없는 모든 프로젝트를 로컬에서 검색하고 원래 대화, 노트, 작업 공간 탭으로 돌아가세요.',
  ],
  [
    'Inspect real local capabilities. No connection state on this page is simulated.',
    '실제 로컬 기능을 확인하세요. 이 페이지의 연결 상태는 모의 값이 아닙니다.',
  ],
  [
    'Analyze locally recorded input and output tokens by project, Lecture generation, provider, and model.',
    '로컬에 기록된 입력·출력 token을 프로젝트, 강의 생성, 제공자, 모델별로 분석하세요.',
  ],
  [
    'Browse this project’s managed Obsidian research workspace. Note contents stay on this Mac.',
    '프로젝트의 관리되는 Obsidian 연구 작업 공간을 살펴보세요. 노트 내용은 이 Mac에 남습니다.',
  ],
  [
    'Eligibility-gated, high-impact query anchors and limited canonical classics.',
    '선정 기준을 통과한 영향력 높은 핵심 논문과 제한된 대표 고전 논문입니다.',
  ],
  [
    'Relevant recent work that also clears the estimated momentum gate.',
    '관련성이 있으며 추정 성장세 기준도 충족하는 최근 연구입니다.',
  ],
  [
    'Wider recall for screening beyond the obvious papers.',
    '대표적인 논문을 넘어 폭넓게 찾은 검토용 결과입니다.',
  ],
  [
    'All saved papers, including Core, Rising, Broad, and imported / unclassified.',
    'Core, Rising, Broad, 가져온 논문과 미분류 논문을 포함한 모든 저장 논문입니다.',
  ],
  [
    "Codex stays GOSU's default provider. Claude Code reuses the Claude.ai subscription already signed in on this Mac; GOSU does not copy its credentials. Hermes uses the version-pinned runtime shipped with GOSU.",
    'GOSU의 기본 제공자는 Codex입니다. Claude Code는 이 Mac에 이미 로그인된 Claude.ai 구독을 재사용하며 GOSU는 인증 정보를 복사하지 않습니다. Hermes는 GOSU에 포함된 고정 버전 runtime을 사용합니다.',
  ],
  [
    'Use the existing local Claude Code login; API keys are not accepted for this connection',
    '기존 로컬 Claude Code 로그인을 사용합니다. 이 연결에는 API key를 사용할 수 없습니다.',
  ],
  [
    "Prefer GOSU's pinned bundle; development builds may use a compatible local installation",
    'GOSU의 고정 버전 번들을 우선 사용합니다. 개발 빌드는 호환되는 로컬 설치를 사용할 수도 있습니다.',
  ],
  [
    'The executable name was found, but its publisher, version, configuration, and identity have not been verified.',
    '실행 파일 이름을 찾았지만 배포자, 버전, 설정, 신원은 아직 검증하지 않았습니다.',
  ],
  [
    "Packaged GOSU launches only its hash-verified bundled Hermes ACP agent after an explicit selection; it never searches PATH or silently falls back to another version. Its only native tools are project-scoped file read and search. Codex can explicitly delegate a bounded task to a fresh Hermes primary ACP agent. File writes, terminal, processes, code execution, web, browser automation, native delegation, memory, skills, MCP, GOSU tools, and attachments are disabled. Claude Code runs a bounded multi-turn agent loop with only the active Project Chat session's GOSU MCP tools. Built-in shell, file writes, user MCP servers, hooks, plugins, browser integration, and Claude session persistence remain disabled. GOSU removes API-key routing variables so this connection uses the verified Claude.ai subscription login. OpenClaw remains detection-only.",
    '설치된 GOSU는 명시적인 선택 이후 해시를 검증한 내장 Hermes ACP agent만 실행합니다. PATH를 검색하거나 다른 버전으로 자동 전환하지 않습니다. native 도구는 프로젝트 범위의 파일 읽기와 검색뿐입니다. Codex는 제한된 작업을 새 Hermes 기본 ACP agent에 명시적으로 위임할 수 있습니다. 파일 쓰기, 터미널, 프로세스, 코드 실행, 웹, 브라우저 자동화, native 위임, 메모리, skill, MCP, GOSU 도구, 첨부파일은 비활성화됩니다. Claude Code는 활성 프로젝트 채팅 세션의 GOSU MCP 도구만으로 제한된 여러 단계 agent 작업을 수행합니다. 내장 shell, 파일 쓰기, 사용자 MCP 서버, hook, plugin, 브라우저 연결, Claude 세션 보존은 비활성화됩니다. GOSU는 API key 라우팅 환경변수를 제거하여 검증된 Claude.ai 구독 로그인을 사용합니다. OpenClaw는 설치 확인만 지원합니다.',
  ],
  [
    'GOSU discovers these modes from the pinned local Codex App Server. Modes supported by the bundled Codex runtime appear here automatically.',
    '고정된 로컬 Codex App Server에서 모드를 조회합니다. 내장 Codex runtime이 지원하는 모드가 여기에 자동으로 표시됩니다.',
  ],
  [
    "The mode selects Codex's own agent loop and instructions. It never expands GOSU's project capability boundary.",
    '모드는 Codex 자체의 agent 실행 과정과 지침을 선택합니다. GOSU의 프로젝트 권한 범위는 확장하지 않습니다.',
  ],
  [
    'Cached search is the safer default. Live search is useful for current facts, but every result remains untrusted model input.',
    '기본값인 캐시 검색이 더 안전합니다. 실시간 검색은 최신 사실 확인에 유용하지만 모든 검색 결과는 여전히 신뢰되지 않은 모델 입력입니다.',
  ],
  [
    "This controls only Codex's first-party web search tool. It does not enable shell networking, the browser, MCP servers, plugins, or direct page control.",
    'Codex가 직접 제공하는 웹 검색 도구만 제어합니다. shell 네트워크, 브라우저, MCP 서버, plugin 또는 웹페이지 직접 제어는 활성화하지 않습니다.',
  ],
  [
    "The agent receives bounded list and read tools. If you explicitly enable automatic saves, it can also create reusable Markdown deliverables in this project’s managed folders without asking on every task. It never receives the Vault root, a raw path, shell access, or another project's grant.",
    'agent에는 제한된 목록 조회와 읽기 도구가 제공됩니다. 자동 저장을 명시적으로 활성화하면 매번 묻지 않고 이 프로젝트의 관리 폴더에 재사용 가능한 Markdown 결과물을 생성할 수도 있습니다. Vault 최상위 경로, 원시 경로, shell 접근 또는 다른 프로젝트의 접근 권한은 제공하지 않습니다.',
  ],
  [
    'GOSU could not verify this project’s Obsidian folder. Chats with a saved grant are paused.',
    '프로젝트의 Obsidian 폴더를 검증하지 못했습니다. 저장된 접근 권한을 사용하는 채팅은 일시정지되었습니다.',
  ],
  [
    'is inactive because the project folder binding changed. GOSU will not silently transfer access.',
    '프로젝트 폴더 연결이 변경되어 비활성화되었습니다. GOSU는 접근 권한을 자동 이전하지 않습니다.',
  ],
  [
    "Listing notes sends their display titles and opaque IDs to the configured Codex/LLM. Reading sends a bounded excerpt plus its content SHA-256, offset, and total character count for that turn. With automatic saves enabled, a reusable Markdown deliverable is written create-only under this project’s Research Notes and the visible answer reports its relative location. A different existing file is never overwritten. The model may quote or summarize read data in its visible answer. Visible chat is saved in this project's encrypted local database and is eligible for Hosted Sync. GOSU does not automatically store or sync the raw tool payload, Vault root/path, source note file, or newly created Markdown body; it appends bounded source and save metadata to the answer.",
    '노트 목록 조회 시 표시 제목과 불투명 ID를 설정된 Codex/LLM에 보냅니다. 읽기 시에는 해당 응답에 필요한 제한된 발췌문, 내용 SHA-256, offset, 전체 글자 수를 보냅니다. 자동 저장이 활성화되면 이 프로젝트 연구 노트 아래에 새 Markdown 결과물만 만들고 답변에 상대 위치를 표시합니다. 다른 기존 파일은 덮어쓰지 않습니다. 모델이 읽은 내용을 답변에 인용하거나 요약할 수 있습니다. 보이는 채팅은 이 프로젝트의 암호화된 로컬 DB에 저장되며 Hosted Sync 대상이 될 수 있습니다. GOSU는 원시 도구 입력, Vault 최상위 경로, 원본 노트 파일, 새 Markdown 본문을 자동 저장하거나 동기화하지 않으며 제한된 출처·저장 메타데이터만 답변에 추가합니다.',
  ],
  [
    'Personality and answer verbosity use native Codex turn/thread settings. Model reasoning remains a separate live-catalog choice on each turn.',
    '성격과 답변 상세도는 native Codex 응답·세션 설정을 사용합니다. 모델 reasoning은 각 응답마다 실시간 카탈로그에서 별도로 선택합니다.',
  ],
  [
    "Use this for research conventions, decision criteria, and response preferences. It is versioned locally and cannot override GOSU's safety boundary.",
    '연구 관례, 판단 기준, 응답 선호도를 입력하세요. 로컬에서 버전을 관리하며 GOSU의 안전 경계는 변경할 수 없습니다.',
  ],
  [
    'Example: Separate verified evidence from hypotheses. Prefer falsifiable next experiments and call out metric leakage risks.',
    '예: 검증된 근거와 가설을 구분하세요. 반증 가능한 다음 실험을 우선 제안하고 지표 누출 위험을 알려주세요.',
  ],
  [
    'Codex sandbox: project-bound reads · no direct shell, filesystem, raw network, browser, MCP, or subagents',
    'Codex sandbox: 프로젝트 범위 읽기 · 직접 shell, 파일 시스템, 원시 네트워크, 브라우저, MCP, 하위 agent 접근 불가',
  ],
  [
    "Board and Objective can be read live. Board changes remain proposals and require Apply. A separate Main-process SSH broker can run bounded Git inspection and, in an explicitly granted Workspace mode, approved direct-argv tests/builds or a foreground Python experiment entrypoint that may execute project code. Every command requires a fresh Allow once decision; experiments are limited to 120 seconds. Raw shells, inline Python, TTY, transfer, unattended execution, broader capabilities, and access to another project's data remain unavailable.",
    '보드와 목표를 실시간으로 읽을 수 있습니다. 보드 변경은 제안 상태로 남으며 적용을 눌러야 합니다. 별도 Main 프로세스의 SSH 중개기가 제한된 Git 조회를 실행할 수 있으며, 명시적으로 허용된 Workspace 모드에서는 승인된 직접 인자 기반 test/build 또는 프로젝트 코드를 실행할 수 있는 포그라운드 Python 실험 진입점을 실행할 수 있습니다. 모든 명령은 새로운 한 번 허용 승인을 받아야 하며 실험은 120초로 제한됩니다. 원시 shell, 인라인 Python, TTY, 전송, 무인 실행, 더 넓은 권한, 다른 프로젝트 데이터 접근은 사용할 수 없습니다.',
  ],
  [
    'These defaults apply to new Project Chat sessions. Lecture Studios and other Codex-native surfaces retain their own provider-compatible defaults. Existing scoped choices remain unchanged.',
    '새 프로젝트 채팅 세션에 적용되는 기본값입니다. 강의 스튜디오와 다른 native Codex 화면은 각 제공자와 호환되는 기본값을 유지합니다. 기존 개별 선택은 변경하지 않습니다.',
  ],
  [
    'If a saved model or reasoning level disappears from its connected provider, GOSU keeps the missing choice visible and stops new Project Chat work from using that default until you explicitly save an available one.',
    '저장한 모델이나 reasoning 수준이 연결된 제공자에서 사라지면 GOSU는 누락된 선택을 계속 표시합니다. 사용 가능한 항목을 명시적으로 저장하기 전에는 새 프로젝트 채팅에서 해당 기본값을 사용하지 않습니다.',
  ],
  [
    'Authentication and the live model catalog are handled by the local Codex App Server. The Settings defaults seed new AI work; Project Chat and Lecture can keep their own scoped choices. Every turn records the resolved model locally.',
    '인증과 실시간 모델 카탈로그는 로컬 Codex App Server가 처리합니다. 설정의 기본값은 새 AI 작업에 적용되며 프로젝트 채팅과 강의는 개별 선택을 유지할 수 있습니다. 각 응답에서 실제 선택된 모델을 로컬에 기록합니다.',
  ],
  [
    'GOSU shows the exact KPI and table instead. Add at least eight evaluations to display the line.',
    '대신 정확한 KPI와 표를 표시합니다. 평가를 8개 이상 추가하면 선을 표시합니다.',
  ],
  [
    'Previews use synthetic test data. Periodic Runner scheduling and live result ingest are not connected yet.',
    '미리보기는 합성 시험 데이터를 사용합니다. 주기적 Runner 예약과 실시간 결과 수집은 아직 연결되지 않았습니다.',
  ],
  [
    'Create a session, then describe metrics, cadence, outputs, and experiment rules in plain language.',
    '세션을 만들고 지표, 주기, 출력 형식, 실험 규칙을 자연어로 설명하세요.',
  ],
  [
    'Example: “Every 500 steps, evaluate holdout macro-F1, show per-class results as a table and a learning curve, and stop after three consecutive failures.”',
    '예: “500 step마다 holdout macro-F1을 평가하고, 클래스별 결과를 표와 학습 곡선으로 보여줘. 연속 3회 실패하면 중단해줘.”',
  ],
  [
    'Unchecked conflicts are skipped. Nothing changes until you save the reviewed logging revision below.',
    '선택하지 않은 충돌은 건너뜁니다. 아래에서 검토한 로깅 리비전을 저장하기 전에는 아무것도 변경하지 않습니다.',
  ],
  [
    'This chat drafts evaluation, metric, logging, and run rules. Every change waits for your approval.',
    '평가, 지표, 로깅, 실행 규칙의 초안을 만드는 채팅입니다. 모든 변경은 사용자 승인을 기다립니다.',
  ],
  [
    'A target threshold is optional. Saved campaign budgets and stop policies are enforced after the Runner is connected.',
    '목표 임계값은 선택 사항입니다. 저장한 전체 실험 예산과 중단 정책은 Runner 연결 후 적용됩니다.',
  ],
  [
    'A numeric target value is optional, and exploratory runs do not need a frozen objective. Comparable results still require a frozen primary metric, evaluator, dataset, and holdout snapshot.',
    '수치 목표는 선택 사항이며 탐색 실행에는 확정된 목표가 필요하지 않습니다. 비교 가능한 결과에는 여전히 확정된 주 지표, evaluator, 데이터셋, holdout 스냅샷이 필요합니다.',
  ],
  [
    'Solid line: recorded result · dashed line: direction-aware best so far. Select a point for its idea and provenance.',
    '실선: 기록된 결과 · 점선: 개선 방향을 반영한 현재까지 최적 결과. 점을 선택하면 아이디어와 출처 이력을 볼 수 있습니다.',
  ],
  [
    'Create an idea, freeze Goal & Metrics, then record a result. GOSU does not insert demonstration values into a real project.',
    '아이디어를 만들고 목표 및 지표를 확정한 후 결과를 기록하세요. GOSU는 실제 프로젝트에 예제 값을 넣지 않습니다.',
  ],
  [
    'No tracked runs yet. Runs created by Project Chat or a connected Runner will appear here.',
    '아직 추적 중인 실행이 없습니다. 프로젝트 채팅이나 연결된 Runner가 만든 실행이 여기에 표시됩니다.',
  ],
  [
    'Project Chat and the Runner create these records. The current Project Chat foreground path records start and verified final-log state; live per-step streaming begins when a Runner is connected. This table never invents missing progress or a total.',
    '프로젝트 채팅과 Runner가 이 기록을 만듭니다. 현재 프로젝트 채팅의 포그라운드 실행은 시작 상태와 검증된 최종 로그 상태를 기록합니다. step별 실시간 스트리밍은 Runner 연결 후 시작됩니다. 누락된 진행률이나 총량을 임의로 표시하지 않습니다.',
  ],
  [
    'Design an exploratory or comparable experiment in Project Chat. Its server, step, metric summary, and validated log reference will appear here.',
    '프로젝트 채팅에서 탐색 또는 비교 실험을 설계하세요. 서버, step, 지표 요약, 검증된 로그 참조가 여기에 표시됩니다.',
  ],
  [
    'Raw JSONL stays on the linked server. GOSU reads it into this view only on demand and refuses content whose full-file hash differs from the validated run reference.',
    '원본 JSONL은 연결된 서버에 남습니다. 요청할 때만 이 화면으로 읽어 오며 전체 파일 해시가 검증된 실행 참조와 다르면 내용을 거부합니다.',
  ],
  [
    'Project Chat must include these fields when it designs and launches experiments. Save changes as a new immutable version; existing runs keep their original snapshot.',
    '프로젝트 채팅이 실험을 설계하고 실행할 때 반드시 포함할 필드입니다. 변경은 새 불변 버전으로 저장하며 기존 실행은 원래 스냅샷을 유지합니다.',
  ],
  [
    'Run records keep validation state, missing required fields, size, and content hash. Raw logs remain at their approved server or Runner source. The Runs tab reads a verified copy into memory only when you choose Open log.',
    '실행 기록에는 검증 상태, 누락된 필수 필드, 크기, 내용 해시가 저장됩니다. 원시 로그는 승인된 서버 또는 Runner 원본에 남습니다. 실행 탭에서 로그 열기를 선택할 때만 검증된 사본을 메모리로 읽어 옵니다.',
  ],
  [
    'This form records a manual local summary. It does not claim that a Runner executed the experiment.',
    '이 양식은 로컬 요약을 수동으로 기록합니다. Runner가 실험을 실행했다고 주장하지 않습니다.',
  ],
  [
    'Some lineage links are incomplete or cyclic. The list remains available; no record was silently reassigned.',
    '일부 계보 연결이 불완전하거나 순환합니다. 목록은 계속 사용할 수 있으며 어떤 기록도 임의로 재배정하지 않았습니다.',
  ],
  [
    'Create the first falsifiable hypothesis. Results are never generated automatically in this local view.',
    '첫 번째 반증 가능한 가설을 만드세요. 이 로컬 화면에서는 결과를 자동 생성하지 않습니다.',
  ],
  [
    'Review this bounded preview carefully. GOSU does not persist the structured raw Hermes tool payload or tool output, but this preview is derived from the request and may contain sensitive command arguments. Allow once applies to this request only. Allow for session applies only to matching requests in this active Hermes session and ends when that session closes.',
    '제한된 미리보기를 주의 깊게 검토하세요. GOSU는 구조화된 원시 Hermes 도구 입력이나 출력을 저장하지 않지만, 요청에서 만든 이 미리보기에는 민감한 명령 인자가 포함될 수 있습니다. 한 번 허용은 이 요청에만 적용됩니다. 세션 동안 허용은 활성 Hermes 세션에서 일치하는 요청에만 적용되며 세션 종료 시 끝납니다.',
  ],
  [
    'Add LaTeX (.tex), Markdown (.md), or PDF (.pdf), or capture an exact Overleaf Git checkpoint.',
    'LaTeX (.tex), Markdown (.md), PDF (.pdf)를 추가하거나 정확한 Overleaf Git 체크포인트를 저장하세요.',
  ],
  [
    'Uses the token saved in Overleaf Settings. GOSU captures one exact Git checkpoint for',
    'Overleaf 설정에 저장한 token을 사용합니다. 다음 대상의 정확한 Git 체크포인트 한 개를 저장합니다:',
  ],
  [
    "Adds labels such as [P1] beside supported claims. Hidden markers still retain the revision's evidence record.",
    '근거가 있는 주장 옆에 [P1] 같은 표시를 추가합니다. 표시를 숨겨도 리비전의 근거 기록은 유지됩니다.',
  ],
  [
    'raster images. GOSU can place these local Figure library assets in the first notes and slides.',
    '래스터 이미지. 이 로컬 그림 라이브러리 항목을 첫 강의 노트와 슬라이드에 배치할 수 있습니다.',
  ],
  [
    'Select captured manuscripts, reviewed paper metadata, experiment evidence, or add local TeX, Markdown, PDF, and Overleaf Git sources. GOSU freezes the exact source set for each generated revision.',
    '저장된 원고, 검토한 논문 메타데이터, 실험 근거를 선택하거나 로컬 TeX, Markdown, PDF, Overleaf Git 원본을 추가하세요. 생성되는 리비전마다 정확한 원본 묶음을 확정합니다.',
  ],
  [
    'Set optional length targets and guidance before generation. You can continue refining the result in the dedicated Lecture Studio chat.',
    '생성 전에 선택적인 분량 목표와 지침을 설정하세요. 전용 강의 스튜디오 채팅에서 결과를 계속 다듬을 수 있습니다.',
  ],
  [
    'This saved default needs attention in Settings → Lecture defaults before creating a Studio.',
    '스튜디오를 만들기 전에 설정 → 강의 기본값에서 이 저장된 기본값을 확인해야 합니다.',
  ],
  [
    'Every revision is saved as new immutable LaTeX files in this project’s Research Notes.',
    '각 리비전은 이 프로젝트의 연구 노트에 새 불변 LaTeX 파일로 저장됩니다.',
  ],
  [
    'exact records in total. Reviewed paper metadata stays labeled as metadata-only until full text is verified. GOSU stops before generation if verbose source metadata cannot fit in the model context; it never silently drops selected evidence.',
    '개의 정확한 기록이 포함됩니다. 검토한 논문 메타데이터는 본문 검증 전까지 메타데이터 전용으로 표시됩니다. 상세 원본 메타데이터가 모델 context에 들어가지 않으면 생성을 중단하며 선택한 근거를 임의로 누락하지 않습니다.',
  ],
  [
    'The model must return complete Notes and Slides bodies. GOSU then validates both documents, may run one correction, and compiles both PDFs.',
    '모델은 강의 노트와 슬라이드의 전체 본문을 반환해야 합니다. GOSU는 두 문서를 검증하고 필요하면 한 번 수정한 후 두 PDF를 컴파일합니다.',
  ],
  [
    'Add or remove figures now, then generate the first revision. Figure changes are saved to this Studio immediately.',
    '지금 그림을 추가하거나 삭제한 후 첫 리비전을 생성하세요. 그림 변경은 이 스튜디오에 즉시 저장됩니다.',
  ],
  [
    'This chat edits only this lecture workspace. Project chats remain separate. Showing up to the',
    '이 채팅은 해당 강의 작업 공간만 편집합니다. 프로젝트 채팅은 별도로 유지됩니다. 최대 표시 개수:',
  ],
  [
    'Direct source editing is active. Save or cancel it before asking the Lecture Assistant for another revision.',
    '원본 직접 편집 중입니다. 다른 리비전을 요청하기 전에 편집 내용을 저장하거나 취소하세요.',
  ],
  [
    'Try “shorten section 2,” “add an equation slide,” or “make the conclusion fit one minute.”',
    '“2절을 줄여줘”, “수식 슬라이드를 추가해줘”, “결론을 1분 안에 설명할 분량으로 해줘”처럼 요청해 보세요.',
  ],
  [
    'Original files and local paths stay on this Mac. A bounded text snapshot is sent to the selected model for this edit and retained with the successful revision’s source provenance.',
    '원본 파일과 로컬 경로는 이 Mac에 남습니다. 이번 편집을 위해 제한된 텍스트 스냅샷을 선택한 모델에 보내며, 성공한 리비전의 원본 출처 이력과 함께 보관합니다.',
  ],
  [
    'Run a search or import an existing review. New searches merge into this project library.',
    '검색하거나 기존 리뷰를 가져오세요. 새 검색 결과는 이 프로젝트 라이브러리에 합쳐집니다.',
  ],
  [
    'Scroll vertically for more papers and horizontally for additional evidence columns. When focused, the arrow and page keys scroll this table. Drag a column divider to resize it, or focus the divider and use Left and Right Arrow keys.',
    '다른 논문은 세로 스크롤로, 추가 근거 열은 가로 스크롤로 보세요. 표에 초점이 있으면 방향키와 Page 키로 스크롤할 수 있습니다. 열 구분선을 드래그하거나 구분선에 초점을 두고 좌우 방향키를 눌러 폭을 조절하세요.',
  ],
  [
    '. This score is only comparable with papers from the same search; it is a discovery ranking, not verified evidence quality.',
    '. 이 점수는 동일한 검색의 논문끼리만 비교할 수 있습니다. 발견 순위이며 검증된 근거의 품질 점수가 아닙니다.',
  ],
  [
    "Create a metadata-only Markdown review template in this project's Obsidian Papers folder",
    '프로젝트의 Obsidian Papers 폴더에 메타데이터 전용 Markdown 리뷰 템플릿 만들기',
  ],
  [
    'Subject and keyword values refine provider discovery and are saved automatically as searchable tags on every matched paper. When an abstract is available, AI also adds paper-specific detailed keywords after the search.',
    '주제와 키워드는 제공자의 검색을 구체화하고 일치하는 모든 논문에 검색 가능한 태그로 자동 저장됩니다. 초록이 있으면 검색 후 AI가 논문별 상세 키워드도 추가합니다.',
  ],
  [
    'Subject and Keyword options refine the provider query and accumulate on matching papers across searches. Separate values with commas; leaving both fields blank uses the normalized search query as a Topic tag. Author and venue are also applied as structured filters where the provider supports them and verified against returned metadata.',
    '주제와 키워드 옵션은 제공자의 검색어를 구체화하며 여러 검색에서 일치하는 논문에 누적됩니다. 쉼표로 구분하세요. 두 필드가 모두 비어 있으면 정규화된 검색어를 Topic 태그로 사용합니다. 저자와 게재지는 제공자가 지원하는 경우 구조화된 필터로 적용하며 반환된 메타데이터와 대조합니다.',
  ],
  [
    'Core is a maximum, never a quota. Search combines Semantic Scholar, Hugging Face Papers, and a resilient Crossref fallback; Hugging Face index presence never promotes a paper by itself. High-impact relevant papers must appear in the relevance lane with a within-search normalized rank score of at least',
    'Core는 최대치이며 반드시 채울 수량이 아닙니다. 검색은 Semantic Scholar, Hugging Face Papers, 장애 대응 Crossref 대체 경로를 결합합니다. Hugging Face 등록만으로 논문을 승격하지 않습니다. 영향력이 높고 관련성이 있는 논문은 관련성 검색에 나타나며 검색 내 정규화 순위 점수가 다음 이상이어야 합니다:',
  ],
  [
    'influential citations. A limited canonical route uses the same impact floor, a citation lane, and age of at least',
    '개의 영향력 있는 인용. 제한된 대표 논문 경로에는 동일한 영향력 기준, 인용 검색, 다음 이상의 논문 연령을 적용합니다:',
  ],
  [
    'influential citation. Others remain Broad for screening. Venue metadata and author h-index never promote a paper by themselves. Existing v1 labels remain historical until that search is run again. Each search is additive; scores are only comparable within the same search.',
    '개의 영향력 있는 인용. 나머지는 검토를 위한 Broad에 남습니다. 게재지 메타데이터와 저자 h-index만으로는 승격하지 않습니다. 기존 v1 분류는 해당 검색을 다시 실행하기 전까지 과거 기록으로 유지됩니다. 각 검색은 결과를 추가하며 점수는 같은 검색 안에서만 비교할 수 있습니다.',
  ],
  [
    'AI drafts use provider metadata and available abstracts, and remain separate from human review notes.',
    'AI 초안은 제공자 메타데이터와 확보된 초록을 사용하며 사람이 작성한 리뷰 노트와 분리됩니다.',
  ],
  [
    'Uses the token saved in Overleaf Settings. Captures inbound Git checkpoints only; realtime editing stays in the provider workspace when available.',
    'Overleaf 설정에 저장한 token을 사용합니다. 가져오는 Git 체크포인트만 저장하며, 지원되는 경우 실시간 편집은 제공자 작업 공간에서 진행합니다.',
  ],
  [
    'The corrected root applies to future captures. Existing checkpoint receipts stay immutable.',
    '수정한 최상위 경로는 이후 체크포인트 저장에 적용됩니다. 기존 체크포인트 기록은 변경하지 않습니다.',
  ],
  [
    'A capture stores one immutable provider revision. Project Chat can read only that captured source, and the PDF preview compiles only that revision on this Mac. Neither action edits Overleaf, merges changes, or reads unsaved live edits.',
    '체크포인트 저장은 제공자의 리비전 한 개를 불변 상태로 보관합니다. 프로젝트 채팅은 저장된 원본만 읽으며 PDF 미리보기도 이 Mac에서 해당 리비전만 컴파일합니다. Overleaf를 편집하거나 변경을 병합하거나 저장하지 않은 실시간 편집 내용을 읽지 않습니다.',
  ],
  [
    'Manuscripts were not replaced. Use Retry above when the local workspace is available.',
    '원고는 교체하지 않았습니다. 로컬 작업 공간을 사용할 수 있을 때 위의 다시 시도를 누르세요.',
  ],
  [
    'Once captured, Project Chat can request the exact checkpoint read-only, and this tab can request a local PDF compile. Each operation checks the local mirror and required MacTeX sandbox when used.',
    '체크포인트를 저장하면 프로젝트 채팅에서 정확한 해당 내용을 읽기 전용으로 요청할 수 있고 이 탭에서는 로컬 PDF 컴파일을 요청할 수 있습니다. 각 작업 시 로컬 미러와 필요한 MacTeX sandbox를 검사합니다.',
  ],
  [
    'The checkpoint core is portable for GOSU Local LaTeX and GOSU Cloud Collaboration. Native editor onboarding, artifact import, realtime, and migration ports are still pending.',
    '체크포인트 핵심 구조는 GOSU Local LaTeX와 GOSU Cloud Collaboration에서 재사용할 수 있습니다. native 편집기 연결, 결과물 가져오기, 실시간 기능, 마이그레이션 연결부는 아직 준비 중입니다.',
  ],
  [
    'GOSU could not verify this project’s Obsidian folder. Existing files were not changed. Retry the connection or choose the Vault again.',
    '프로젝트의 Obsidian 폴더를 검증하지 못했습니다. 기존 파일은 변경하지 않았습니다. 다시 연결하거나 Vault를 다시 선택하세요.',
  ],
  [
    "Choose your Obsidian Vault once. GOSU creates only this project's managed GOSU folder with Literature, Papers, Experiments, Project Progress, and Idea Development notes. General Vault content remains read-only and is never sent to Hosted Sync automatically.",
    'Obsidian Vault를 한 번 선택하세요. GOSU는 문헌, 논문, 실험, 프로젝트 진행, 아이디어 개발 노트가 있는 이 프로젝트 전용 관리 폴더만 만듭니다. 일반 Vault 내용은 읽기 전용이며 Hosted Sync로 자동 전송하지 않습니다.',
  ],
  [
    'GOSU receives read-only access to the folder you select. File contents are not sent to Hosted Sync automatically.',
    '선택한 폴더에 대한 읽기 전용 접근 권한을 받습니다. 파일 내용은 Hosted Sync로 자동 전송하지 않습니다.',
  ],
  [
    'Access is project-specific and stays off until you explicitly authorize this folder here or in AI Agent Settings. Listing sends display titles and opaque IDs; reading also sends the requested excerpt, content hash, offset, and total length to the configured LLM. Automatic Markdown saving is a separate explicit capability: it creates only new files under this project’s managed folders, never replaces a different existing file, and reports the relative location. Legacy grants remain read-only until upgraded. Visible replies may be stored and synchronized; Research Notes file bodies remain local.',
    '접근 권한은 프로젝트별로 적용되며 여기 또는 AI Agent 설정에서 이 폴더를 명시적으로 허용할 때까지 비활성 상태입니다. 목록 조회 시 표시 제목과 불투명 ID를 보내며 읽기 시에는 요청한 발췌문, 내용 해시, offset, 전체 길이도 설정된 LLM에 보냅니다. 자동 Markdown 저장은 별도로 명시적으로 허용하는 기능입니다. 프로젝트 관리 폴더 아래에 새 파일만 생성하며 다른 기존 파일을 덮어쓰지 않고 상대 위치를 알려줍니다. 기존 접근 권한은 갱신 전까지 읽기 전용으로 유지됩니다. 보이는 답변은 저장·동기화될 수 있지만 연구 노트 파일 본문은 로컬에 남습니다.',
  ],
  [
    'Enabling automatic Markdown saves lets Project Chat create reusable deliverables in this project’s Research Notes without asking on every task. GOSU reports the relative saved location and cannot replace a different existing file.',
    '자동 Markdown 저장을 활성화하면 프로젝트 채팅이 매 작업마다 묻지 않고 이 프로젝트 연구 노트에 재사용 가능한 결과물을 생성할 수 있습니다. 저장한 상대 위치를 알려주며 다른 기존 파일은 덮어쓸 수 없습니다.',
  ],
  [
    'Save it once, then Manuscript and Lecture Studio use it automatically when you link a new Overleaf project.',
    '한 번 저장하면 새 Overleaf 프로젝트를 연결할 때 원고와 강의 스튜디오에서 자동으로 사용합니다.',
  ],
  [
    'GOSU encrypts it on this Mac using operating-system secure storage. Each new link receives its own encrypted, workspace-bound copy.',
    '운영체제의 안전한 저장소를 사용하여 이 Mac에서 암호화합니다. 새 연결마다 암호화된 작업 공간 전용 사본을 받습니다.',
  ],
  [
    'Existing linked manuscripts keep working when this token is replaced or cleared. Clear removes GOSU’s saved copy; it does not revoke the token in Overleaf.',
    '이 token을 교체하거나 지워도 기존 연결 원고는 계속 작동합니다. 지우기는 GOSU에 저장된 사본만 제거하며 Overleaf의 token을 취소하지 않습니다.',
  ],
  [
    'Applied to every existing and new chat session in this project. Rules cannot grant tools, permissions, or access to another project.',
    '이 프로젝트의 기존·신규 모든 채팅 세션에 적용됩니다. 규칙으로 도구, 권한 또는 다른 프로젝트 접근을 허용할 수 없습니다.',
  ],
  [
    'No project rules yet. Add one concise rule for conventions the assistant must keep across sessions.',
    '아직 프로젝트 규칙이 없습니다. 여러 세션에서 assistant가 지켜야 할 관례를 간결한 규칙으로 추가하세요.',
  ],
  [
    'Example: Always separate verified evidence from hypotheses and state uncertainty explicitly.',
    '예: 항상 검증된 근거와 가설을 구분하고 불확실성을 명시하세요.',
  ],
  [
    'Appearance and Board defaults still work. Retry the workspace before managing projects.',
    '화면 모양과 보드 기본값은 계속 사용할 수 있습니다. 프로젝트 관리 전에 작업 공간을 다시 불러오세요.',
  ],
  [
    'Archive pauses normal work while keeping the project easy to restore. Trash is a separate, recoverable step with two warnings. Renaming keeps the stable project slug.',
    '보관은 쉽게 복원할 수 있도록 유지하면서 일반 작업을 일시정지합니다. 휴지통은 두 번의 경고를 거치는 별도의 복원 가능한 단계입니다. 이름을 바꿔도 고정 프로젝트 slug는 유지됩니다.',
  ],
  [
    "Stop or wait for this project's active Codex turn before archiving it or moving it to Trash.",
    '프로젝트를 보관하거나 휴지통으로 옮기기 전에 진행 중인 Codex 응답을 중단하거나 완료를 기다리세요.',
  ],
  [
    'The project will disappear from the switcher, but its tasks, objectives, Board, project chat, and action provenance stay locally preserved. You can restore it below.',
    '프로젝트가 전환 목록에서 사라지지만 할 일, 목표, 보드, 프로젝트 채팅, 작업 출처 이력은 로컬에 보존됩니다. 아래에서 복원할 수 있습니다.',
  ],
  [
    'Archived projects keep their Board, goals, notes, and chat history. Restore one to active before changing it or asking its AI agent to work.',
    '보관된 프로젝트의 보드, 목표, 노트, 채팅 이력은 유지됩니다. 변경하거나 AI agent에 작업을 요청하려면 먼저 활성 상태로 복원하세요.',
  ],
  [
    'Enter only an owner/repository identifier. Tokens, SSH addresses, and repository contents never enter Hosted Sync.',
    'owner/repository 식별자만 입력하세요. token, SSH 주소, 저장소 내용은 Hosted Sync에 포함하지 않습니다.',
  ],
  [
    'GOSU keeps this clone on your Mac, separate from Project Chat scratch space. GitHub credentials remain with your Mac Git credential helper.',
    '복제본은 프로젝트 채팅 임시 공간과 별도로 이 Mac에 보관됩니다. GitHub 인증 정보는 Mac의 Git credential helper가 관리합니다.',
  ],
  [
    'Allow once permits only this exact reviewed operation for this turn. The configured root and path checks are an advisory policy boundary, not a remote sandbox; repository code can access resources permitted to the SSH account.',
    '한 번 허용은 이번 응답에서 정확히 검토한 작업만 허용합니다. 설정한 최상위 경로와 경로 검사는 권고적 정책 경계이지 원격 sandbox가 아닙니다. 저장소 코드는 SSH 계정에 허용된 자원에 접근할 수 있습니다.',
  ],
  [
    ' This creates or replaces one bounded text file with the exact content shown above. GOSU rechecks the existing hash immediately before replacement, but another server process can still race the final rename. The typed file broker does not delete remote files.',
    ' 위에 표시된 정확한 내용으로 제한된 텍스트 파일 한 개를 만들거나 교체합니다. 교체 직전에 기존 해시를 다시 확인하지만 최종 이름 변경 시 다른 서버 프로세스와 경합할 수 있습니다. 타입이 지정된 파일 중개기는 원격 파일을 삭제하지 않습니다.',
  ],
  [
    'Approval binds the executable, arguments, and working directory, not repository file contents; those files can change before launch. ',
    '승인은 실행 파일, 인자, 작업 디렉터리에 적용되며 저장소 파일 내용에는 적용되지 않습니다. 실행 전에 해당 파일이 바뀔 수 있습니다. ',
  ],
  [
    'Bounded output is returned to the model as untrusted data and is not saved as raw SSH output. To stop repeated prompts for this project, enable Project auto-run for this exact grant in Project Chat details or Connections.',
    '제한된 출력은 신뢰되지 않은 데이터로 모델에 반환되며 원시 SSH 출력으로 저장하지 않습니다. 반복 승인을 생략하려면 프로젝트 채팅 상세 또는 연결에서 해당 정확한 접근 권한에 대해 프로젝트 자동 실행을 활성화하세요.',
  ],
  [
    'Allow once runs only this reviewed restricted diagnostic for this project chat session. Its bounded output is returned to the linked model but is not stored as raw SSH output. Remote output is untrusted data, never project instructions. Review the target and every argument because output can contain private server data.',
    '한 번 허용은 이 프로젝트 채팅 세션에서 검토한 제한된 진단만 실행합니다. 제한된 출력은 연결된 모델에 반환되지만 원시 SSH 출력으로 저장하지 않습니다. 원격 출력은 신뢰되지 않은 데이터이며 프로젝트 지침이 아닙니다. 출력에 서버 개인정보가 포함될 수 있으므로 대상과 모든 인자를 검토하세요.',
  ],
  [
    'GOSU calls the system OpenSSH client with a registered alias or a safely parsed destination. Authentication stays in your SSH agent; passwords, private keys, and pasted command text are never stored by this connection list.',
    '시스템 OpenSSH client를 등록된 alias 또는 안전하게 해석한 대상으로 호출합니다. 인증은 SSH agent가 관리합니다. 이 연결 목록에는 비밀번호, 개인 키, 붙여 넣은 명령 텍스트를 저장하지 않습니다.',
  ],
  [
    'Test checks host trust and non-interactive authentication only. Project linking and command Allow once approval are separate.',
    '테스트는 host 신뢰와 비대화형 인증만 확인합니다. 프로젝트 연결과 명령별 한 번 허용 승인은 별개입니다.',
  ],
  [
    'requests are stored as an inactive normalized plan. Project Chat does not open a tunnel automatically and can request only separately approved commands.',
    '요청은 비활성 정규화 계획으로 저장됩니다. 프로젝트 채팅은 터널을 자동으로 열지 않으며 별도 승인된 명령만 요청할 수 있습니다.',
  ],
  [
    'The parser runs locally without an LLM or shell. Generic options, key paths, proxy commands, remote commands, and shell syntax are rejected. A root login requires a separate project workspace grant and is marked HIGH RISK for every approval.',
    '파서는 LLM이나 shell 없이 로컬에서 실행됩니다. 일반 옵션, key 경로, proxy 명령, 원격 명령, shell 문법은 거부합니다. root 로그인에는 별도의 프로젝트 작업 공간 접근 권한이 필요하며 모든 승인에서 고위험으로 표시합니다.',
  ],
  [
    "Project Chat can request a typed remote command, but every command waits for a separate Allow once decision. Raw output is returned only to that active model turn and is not saved as a tool payload; a summary the model writes in its visible answer becomes chat history. Registered servers remain unavailable to a project until a separate workspace grant is approved. Diagnostics grants permit bounded Git inspection; Workspace grants may additionally list/read bounded text files, create a new text file, replace an unchanged text file, run a strict direct-argv test/build allowlist, and run one foreground Python experiment entrypoint for at most 120 seconds. Every file action and command requires Allow once. The typed broker itself has no deletion, raw shell, inline eval, module launch, interactive shell, privilege escalation, general file transfer, TTY, or forwarding action. Approved Python, tests, and builds are still untrusted code with the SSH account's full accessible privileges; the workspace path does not sandbox that code. Parsed destinations use isolated, non-interactive OpenSSH options.",
    '프로젝트 채팅은 타입이 지정된 원격 명령을 요청할 수 있지만 모든 명령은 별도의 한 번 허용 승인을 기다립니다. 원시 출력은 활성 모델 응답에만 반환되며 도구 입력·출력으로 저장하지 않습니다. 모델이 보이는 답변에 작성한 요약은 채팅 이력이 됩니다. 등록된 서버도 별도의 작업 공간 권한을 승인하기 전까지 프로젝트에서 사용할 수 없습니다. Diagnostics 권한은 제한된 Git 조회를 허용합니다. Workspace 권한은 제한된 텍스트 파일 목록·읽기·새 파일 생성·변경되지 않은 파일 교체, 엄격한 직접 인자 test/build 허용 목록, 최대 120초의 포그라운드 Python 실험 진입점 실행을 추가로 허용할 수 있습니다. 모든 파일 작업과 명령에는 한 번 허용이 필요합니다. 타입이 지정된 중개기는 삭제, 원시 shell, 인라인 eval, module 실행, 대화형 shell, 권한 상승, 일반 파일 전송, TTY, 포워딩 작업을 제공하지 않습니다. 승인된 Python, test, build도 SSH 계정이 접근 가능한 전체 권한으로 실행되는 신뢰되지 않은 코드입니다. 작업 공간 경로가 해당 코드를 sandbox로 격리하지 않습니다. 해석된 대상에는 격리된 비대화형 OpenSSH 옵션을 사용합니다.',
  ],
  [
    'Usage probes do not wait for Allow once. Remote files and commands are separate: they need a project grant and may show an Allow once request.',
    '사용량 조회에는 한 번 허용이 필요하지 않습니다. 원격 파일과 명령은 별도로 프로젝트 접근 권한이 필요하며 한 번 허용 요청이 표시될 수 있습니다.',
  ],
  [
    'A registered server is not automatically available to every project. Grant one canonical workspace root to the active project, then Project Chat can request bounded text file listing, reading, creation, and replacement plus approved direct-argv commands. By default, every command and file action requires a separate Allow once decision. Project Chat can explicitly enable audited Project trusted execution for an exact Workspace grant; it removes repeated prompts but never adds raw shell, a broader project scope, direct secret access, out-of-grant paths, or remote deletion. ROOT grants require an additional high-risk warning.',
    '등록된 서버를 모든 프로젝트에서 자동으로 사용할 수 있는 것은 아닙니다. 활성 프로젝트에 표준 작업 공간 최상위 경로 한 개를 허용하면 프로젝트 채팅이 제한된 텍스트 파일 목록·읽기·생성·교체와 승인된 직접 인자 명령을 요청할 수 있습니다. 기본적으로 모든 명령과 파일 작업에는 별도의 한 번 허용 승인이 필요합니다. 프로젝트 채팅에서 정확한 Workspace 권한에 대해 감사 기록이 있는 프로젝트 신뢰 실행을 명시적으로 활성화할 수 있습니다. 반복 승인만 생략하며 원시 shell, 더 넓은 프로젝트 범위, 직접적인 비밀 정보 접근, 권한 밖의 경로, 원격 삭제를 추가하지 않습니다. ROOT 권한에는 추가 고위험 경고가 필요합니다.',
  ],
  [
    '` and continue. Enter an existing project directory on this server. `/`, `/root`, and system directories are blocked.',
    '`을 입력하고 계속하세요. 이 서버에 존재하는 프로젝트 디렉터리를 입력하세요. `/`, `/root`, 시스템 디렉터리는 차단됩니다.',
  ],
  [
    'I understand this is an advisory policy boundary, not a remote sandbox. Tests, builds, and foreground Python experiments may execute repository code with the SSH account’s privileges and may access or change anything that account can reach. Approved typed text file creates and replacements change the workspace; the typed file broker does not provide remote deletion.',
    '이것은 권고적 정책 경계이며 원격 sandbox가 아님을 이해합니다. test, build, 포그라운드 Python 실험은 SSH 계정의 권한으로 저장소 코드를 실행하며 해당 계정이 접근 가능한 모든 자원에 접근하거나 변경할 수 있습니다. 승인된 타입 지정 텍스트 파일 생성·교체는 작업 공간을 변경합니다. 타입 지정 파일 중개기는 원격 삭제를 제공하지 않습니다.',
  ],
  [
    'Workspace · inspection, approved tests/builds, and foreground Python experiments; approved text file list/read/create/replace',
    'Workspace · 조회, 승인된 test/build, 포그라운드 Python 실험 · 승인된 텍스트 파일 목록·읽기·생성·교체',
  ],
  [
    'Restore projects, Lecture Studios, and Board tasks from one place. Permanent removal remains separated by item type so each existing safety confirmation stays explicit.',
    '프로젝트, 강의 스튜디오, 보드 할 일을 한곳에서 복원하세요. 영구 삭제는 항목 유형별로 분리하여 기존 안전 확인 절차를 명시적으로 유지합니다.',
  ],
  [
    'Restoring keeps the same project ID, Board, goals, and local history. Active and archived projects are never included when this section is emptied.',
    '복원 시 동일한 프로젝트 ID, 보드, 목표, 로컬 이력을 유지합니다. 이 구역을 비워도 활성 프로젝트와 보관된 프로젝트는 포함되지 않습니다.',
  ],
  [
    'GitHub repositories, local worktrees, Research Notes files, and remote server data are not deleted. Project links are detached and cannot be restored in GOSU.',
    'GitHub 저장소, 로컬 worktree, 연구 노트 파일, 원격 서버 데이터는 삭제하지 않습니다. 프로젝트 연결은 해제되며 GOSU에서 복원할 수 없습니다.',
  ],
  [
    'If a Lecture Studio still references one of these projects, permanently remove that Studio in the section below first, or restore the project instead.',
    '강의 스튜디오가 해당 프로젝트를 참조한다면 아래 구역에서 스튜디오를 먼저 영구 삭제하거나 대신 프로젝트를 복원하세요.',
  ],
  [
    'Restore a Studio with the same ID, chat, source manifest, and revision history. Research Notes and generated files remain on disk.',
    '동일한 ID, 채팅, 원본 목록, 리비전 이력을 유지하여 스튜디오를 복원합니다. 연구 노트와 생성 파일은 디스크에 남습니다.',
  ],
  [
    'Permanent removal applies only to the Lecture Studios shown here; it does not empty project or Board task items.',
    '여기 표시된 강의 스튜디오만 영구 삭제합니다. 프로젝트나 보드 할 일의 휴지통은 비우지 않습니다.',
  ],
  [
    'Board tasks can be restored here. GOSU does not currently permanently purge individual tasks. A task is removed from the workspace only when its trashed parent project is permanently removed above; its immutable project provenance remains preserved.',
    '보드 할 일은 여기서 복원할 수 있습니다. 현재 개별 할 일의 영구 삭제는 지원하지 않습니다. 위에서 휴지통에 있는 상위 프로젝트를 영구 삭제할 때만 할 일이 작업 공간에서 제거되며, 불변 프로젝트 출처 이력은 유지됩니다.',
  ],
  [
    'Parent project is archived. Restore it to Active in Projects before restoring this task.',
    '상위 프로젝트가 보관되어 있습니다. 할 일을 복원하기 전에 프로젝트 화면에서 활성 상태로 복원하세요.',
  ],
  [
    'Known tokens come only from local provider receipts. Missing usage is never estimated or displayed as zero.',
    '확인된 token 수는 로컬 제공자의 실행 기록만 사용합니다. 누락된 사용량을 추정하거나 0으로 표시하지 않습니다.',
  ],
  [
    'Project totals use the recorded output owner. Linked Lecture source projects are not duplicated.',
    '프로젝트 합계는 기록된 출력 소유자를 기준으로 계산합니다. 연결된 강의 원본 프로젝트를 중복 집계하지 않습니다.',
  ],
  [
    'Tracking started inside this range. Earlier turns are not estimated or counted as zero.',
    '이 기간 중에 추적이 시작되었습니다. 이전 응답은 추정하거나 0으로 집계하지 않습니다.',
  ],
  [
    'This entire range predates local usage tracking. GOSU does not estimate earlier turns or substitute zero.',
    '전체 기간이 로컬 사용량 추적 시작 이전입니다. 이전 응답을 추정하거나 0으로 대체하지 않습니다.',
  ],
  [
    '. Partial reports may be lower bounds; unavailable turns remain visible in coverage and are excluded from token totals.',
    '. 부분 보고서는 최소치일 수 있습니다. 사용량을 확인할 수 없는 응답은 집계 범위에 표시하되 token 합계에서는 제외합니다.',
  ],
  [
    'Each resolved model is counted separately. The connection remains visible so usage from different accounts or providers is not silently merged.',
    '실제 사용한 모델별로 별도 집계합니다. 연결 정보도 표시하여 다른 계정이나 제공자의 사용량을 임의로 합치지 않습니다.',
  ],
  [
    'calendar buckets. The accompanying data table contains the same values and reporting coverage.',
    '개의 달력 구간. 함께 제공되는 데이터 표에도 동일한 값과 보고 범위가 포함됩니다.',
  ],
  [
    'Projects and tasks are stored in the encrypted local workspace. You can start offline; pending collaboration changes remain visible.',
    '프로젝트와 할 일은 암호화된 로컬 작업 공간에 저장됩니다. 오프라인에서도 시작할 수 있으며 대기 중인 협업 변경 사항은 계속 표시됩니다.',
  ],
  [
    'Saved with the objective. The Runner will enforce these campaign-wide limits; the current Project Chat foreground path only enforces its per-run timeout.',
    '목표와 함께 저장됩니다. 전체 실험에 걸친 한도는 Runner가 적용합니다. 현재 프로젝트 채팅의 포그라운드 실행은 개별 실행 제한 시간만 적용합니다.',
  ],
  [
    'No target is set, so exploratory and comparable runs can still proceed. Campaign budgets, guardrails, no-improvement limits, and Stop or Kill are enforced after the Runner is connected; the current Project Chat path only enforces its per-run timeout.',
    '목표가 설정되지 않아도 탐색·비교 실행을 진행할 수 있습니다. 전체 실험 예산, guardrail, 개선 없음 한도, 중단 또는 강제 종료는 Runner 연결 후 적용합니다. 현재 프로젝트 채팅은 개별 실행 제한 시간만 적용합니다.',
  ],
  [
    'Frozen revisions cannot be edited. Start a new revision to change the metric or budget.',
    '확정된 리비전은 편집할 수 없습니다. 지표나 예산을 변경하려면 새 리비전을 시작하세요.',
  ],
  [
    'Guardrails default to an empty list in this first usable slice. Metric, hashes, budget and stop policy are still persisted as one versioned objective.',
    '첫 기능 버전에서 guardrail 기본값은 빈 목록입니다. 지표, 해시, 예산, 중단 정책은 하나의 버전 관리 목표로 함께 저장됩니다.',
  ],
];

export const desktopHelpMessages: Record<string, { en: string; ko: string }> = Object.fromEntries(
  pairs.map(([en, ko]) => [en, { en, ko }]),
);
