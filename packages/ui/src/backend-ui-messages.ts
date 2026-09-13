/** Application-owned error copy only; provider stderr and user content are never translated here. */
const pairs: readonly (readonly [string, string])[] = [
  ['Minimize objective', '최소화'],
  [
    'A newer plan changed this objective. Your unsaved draft is preserved.',
    '새 계획이 목표를 갱신했습니다. 작성 중인 내용은 그대로 보존했습니다.',
  ],
  ['Discard draft and load latest', '작성 중인 내용 버리고 최신 목표 불러오기'],
  [
    'Plan saved. Supply evaluator and dataset identities, then reapply and activate the plan from Project Chat before comparable runs.',
    '계획은 저장됐습니다. 평가기·데이터 식별자를 확인한 뒤 Project Chat에서 계획을 다시 반영하고 활성화하면 비교 실험을 실행할 수 있습니다.',
  ],
  [
    'Replace pending evaluator and dataset identities before freezing this objective.',
    '목표를 동결하기 전에 미확정 평가기·데이터 식별자를 실제 값으로 바꿔주세요.',
  ],
  [
    'Reapply and activate this plan with current evaluator and dataset identities before comparable runs.',
    '비교 실험 전에 최신 평가기·데이터 식별자로 계획을 다시 반영하고 활성화해주세요.',
  ],
  ['Resolving frozen project sources', '확정된 프로젝트 원본 확인 중'],
  ['Loading the current revision as the edit base', '현재 리비전을 편집 기준으로 불러오는 중'],
  ['Building the bounded model context', '제한된 모델 context 구성 중'],
  ['Starting the selected model', '선택한 모델 시작 중'],
  ['Generating complete Notes and Slides bodies', '강의 노트와 슬라이드 전체 본문 생성 중'],
  ['Revising the complete Notes and Slides bodies', '강의 노트와 슬라이드 전체 본문 수정 중'],
  ['Receiving the model’s complete document response', '모델의 전체 문서 응답 수신 중'],
  ['Validating citations, figures, structure, and LaTeX', '인용·그림·구조·LaTeX 검증 중'],
  ['Running the one bounded automatic correction', '제한된 자동 수정 한 번 실행 중'],
  ['Compiling Notes PDF and Slides PDF', '강의 노트 PDF와 슬라이드 PDF 컴파일 중'],
  ['Staging the new LaTeX revision bundle', '새 LaTeX 리비전 묶음 준비 중'],
  ['Committing the revision and frozen provenance', '리비전과 확정된 출처 이력 저장 중'],
  ['Response format', '응답 형식'],
  ['Required lecture fields', '필수 강의 항목'],
  ['LaTeX compatibility', 'LaTeX 호환성'],
  ['Source references', '출처 참조'],
  ['Slide count', '슬라이드 수'],
  ['Document was empty', '빈 문서'],
  ['Document exceeded the size limit', '문서 크기 한도 초과'],
  ['Invalid hidden character', '잘못된 숨은 문자'],
  ['Ambiguous LaTeX backslash', '모호한 LaTeX 역슬래시'],
  ['Unsupported caret escape', '지원하지 않는 caret escape'],
  ['HTML appeared in the document', '문서에 HTML 포함'],
  ['Markdown structure appeared in LaTeX', 'LaTeX에 Markdown 구조 포함'],
  ['Extra document wrapper', '추가 문서 wrapper'],
  ['Unsupported LaTeX comment', '지원하지 않는 LaTeX 주석'],
  ['Unsupported LaTeX parameter marker', '지원하지 않는 LaTeX 매개변수 표시'],
  ['Unsupported slide overlay', '지원하지 않는 슬라이드 overlay'],
  ['Unsupported multi-page slide', '지원하지 않는 여러 페이지 슬라이드'],
  ['Unsupported slide option', '지원하지 않는 슬라이드 옵션'],
  ['Unsupported heading option', '지원하지 않는 제목 옵션'],
  ['Unmatched braces', '짝이 맞지 않는 중괄호'],
  ['Malformed LaTeX environment', '잘못된 LaTeX environment 형식'],
  ['Unsupported LaTeX environment', '지원하지 않는 LaTeX environment'],
  ['Unmatched LaTeX environment', '짝이 맞지 않는 LaTeX environment'],
  ['Unsupported LaTeX command', '지원하지 않는 LaTeX 명령'],
  ['Unsupported LaTeX escape', '지원하지 않는 LaTeX escape'],
  ['Conflicting math delimiters', '충돌하는 수식 구분자'],
  ['Unmatched math delimiter', '짝이 맞지 않는 수식 구분자'],
  ['Subscript or superscript outside math', '수식 밖의 아래·위 첨자'],
  ['Alignment marker outside a supported layout', '지원되는 레이아웃 밖의 정렬 표시'],
  ['Unsupported tilde', '지원하지 않는 물결표'],
  ['Source marker placement or punctuation', '출처 표시의 위치 또는 구두점'],
  ['Missing source list', '출처 목록 누락'],
  ['Slides were missing a frame', '슬라이드 frame 누락'],
  ['Unknown or unavailable figure reference', '알 수 없거나 사용할 수 없는 그림 참조'],
  ['Invalid slide title', '잘못된 슬라이드 제목'],
  ['Invalid saved document wrapper', '잘못된 저장 문서 wrapper'],
  ['The local OpenSSH client is unavailable', '로컬 OpenSSH client를 사용할 수 없습니다'],
  [
    'Host key not trusted — verify it and connect once in Terminal',
    '신뢰되지 않은 host key — 검증한 후 터미널에서 한 번 연결하세요',
  ],
  [
    'Authentication failed — check ssh-agent or Keychain in Terminal',
    '인증 실패 — 터미널에서 ssh-agent 또는 Keychain을 확인하세요',
  ],
  [
    'Connection failed — check the host, port, and network',
    '연결 실패 — host, port, 네트워크를 확인하세요',
  ],
  [
    'Connection timed out — check the server and network',
    '연결 시간 초과 — 서버와 네트워크를 확인하세요',
  ],
  ['CPU unavailable', 'CPU 확인 불가'],
  ['Memory unavailable', '메모리 확인 불가'],
  ['nvidia-smi reports no NVIDIA GPU', 'nvidia-smi에서 NVIDIA GPU가 없다고 보고했습니다'],
  ['GPU unavailable', 'GPU 확인 불가'],
  [
    'nvidia-smi is not available in the supported server installation locations',
    '지원되는 서버 설치 경로에서 nvidia-smi를 찾을 수 없습니다',
  ],
  ['Server unavailable', '서버 사용 불가'],
  ['Usage response invalid', '잘못된 사용량 응답'],
  [
    'Enter a GitHub repository as owner/repository first.',
    '먼저 GitHub 저장소를 owner/repository 형식으로 입력하세요.',
  ],
  ['Clone the repository before opening its files.', '파일을 열기 전에 저장소를 복제하세요.'],
  [
    'This project already has a local Git workspace.',
    '이 프로젝트에는 이미 로컬 Git 작업 공간이 있습니다.',
  ],
  [
    'The local repository no longer matches this project. GOSU stopped before reading it.',
    '로컬 저장소가 프로젝트와 더 이상 일치하지 않아 읽기 전에 중단했습니다.',
  ],
  [
    'This repository enables a Git hook, filter, or external command. GOSU stopped before reading or changing it.',
    '이 저장소에서 Git hook, filter 또는 외부 명령을 활성화하고 있어 읽거나 변경하기 전에 중단했습니다.',
  ],
  [
    'Git is not available on this Mac. Install Apple Command Line Tools, then retry.',
    '이 Mac에서 Git을 사용할 수 없습니다. Apple Command Line Tools를 설치하고 다시 시도하세요.',
  ],
  [
    'GitHub authentication is required. Sign in through your Mac Git credential helper, then retry.',
    'GitHub 인증이 필요합니다. Mac의 Git credential helper로 로그인한 후 다시 시도하세요.',
  ],
  [
    'Commit or stage the current changes before switching branches or pulling.',
    '브랜치를 전환하거나 pull하기 전에 현재 변경을 commit 또는 stage하세요.',
  ],
  [
    'The branch changed since this screen loaded. Refresh and review before retrying.',
    '화면을 불러온 후 브랜치가 변경되었습니다. 새로고침하고 검토한 후 다시 시도하세요.',
  ],
  [
    'The staged changes changed since this screen loaded. Refresh and review the exact commit again.',
    '화면을 불러온 후 stage된 변경이 바뀌었습니다. 새로고침하고 정확한 commit 내용을 다시 검토하세요.',
  ],
  [
    'Switch to a named branch before creating a commit.',
    'commit을 만들기 전에 이름이 있는 브랜치로 전환하세요.',
  ],
  [
    'Create the first commit before using this Git operation.',
    '이 Git 작업을 사용하려면 먼저 첫 commit을 만드세요.',
  ],
  ['A safe GitHub origin remote was not found.', '안전한 GitHub origin remote를 찾지 못했습니다.'],
  [
    'The current branch does not have an origin upstream yet. Push it first.',
    '현재 브랜치에 origin upstream이 아직 없습니다. 먼저 push하세요.',
  ],
  [
    'Stage at least one changed file before committing.',
    'commit하려면 변경된 파일을 하나 이상 stage하세요.',
  ],
  [
    'Set your Git user.name and user.email, then retry the commit. GOSU reads them only for commit authorship.',
    'Git user.name과 user.email을 설정한 후 commit을 다시 시도하세요. GOSU는 commit 작성자 정보에만 사용합니다.',
  ],
  [
    'That object is not a commit in the current branch history. Refresh History and select a listed commit.',
    '현재 브랜치 이력의 commit이 아닙니다. 이력을 새로고침하고 목록의 commit을 선택하세요.',
  ],
  ['That branch already exists.', '이미 존재하는 브랜치입니다.'],
  ['That local branch is no longer available.', '해당 로컬 브랜치를 더 이상 사용할 수 없습니다.'],
  [
    'Git stopped because the operation would conflict. No automatic merge was attempted.',
    '충돌이 발생할 수 있어 Git 작업을 중단했습니다. 자동 merge는 시도하지 않았습니다.',
  ],
  [
    'GOSU blocked this file path because it is missing, linked, or outside the repository.',
    '파일이 없거나 링크이거나 저장소 밖에 있어 경로를 차단했습니다.',
  ],
  [
    'This file is too large for the bounded in-app preview.',
    '제한된 앱 미리보기에서 보기에는 파일이 너무 큽니다.',
  ],
  [
    'Binary files are listed but their contents are not returned to the app.',
    '바이너리 파일은 목록에 표시하지만 내용은 앱으로 반환하지 않습니다.',
  ],
  [
    'The requested Git output is too large for the safe preview limit.',
    '요청한 Git 출력이 안전한 미리보기 한도를 초과합니다.',
  ],
  [
    'The Git request was invalid. Refresh and try again.',
    '잘못된 Git 요청입니다. 새로고침 후 다시 시도하세요.',
  ],
  [
    'The Git operation could not be completed. Your repository was not reset or cleaned.',
    'Git 작업을 완료하지 못했습니다. 저장소를 reset하거나 정리하지 않았습니다.',
  ],
  [
    'The literature provider is unavailable. Your saved evidence table is still available.',
    '문헌 제공자를 사용할 수 없습니다. 저장된 근거 표는 계속 사용할 수 있습니다.',
  ],
  [
    'The literature provider asked GOSU to slow down. Wait briefly, then search again.',
    '문헌 제공자가 요청 속도를 낮추도록 요청했습니다. 잠시 기다린 후 다시 검색하세요.',
  ],
  [
    'This paper changed since you opened it. GOSU kept both versions safe; refresh before editing again.',
    '논문을 연 후 내용이 변경되었습니다. 두 버전을 안전하게 유지했으므로 다시 편집하기 전에 새로고침하세요.',
  ],
  [
    'This project already has 500 active papers. Remove a paper before adding more; this operation changed nothing.',
    '프로젝트에 이미 활성 논문이 500개 있습니다. 더 추가하려면 논문을 하나 삭제하세요. 이번 작업은 아무것도 변경하지 않았습니다.',
  ],
  [
    'The available paper identities point to different saved records. GOSU changed nothing so you can review the conflict safely.',
    '확보한 논문 식별 정보가 서로 다른 저장 기록을 가리킵니다. 충돌을 안전하게 검토할 수 있도록 아무것도 변경하지 않았습니다.',
  ],
  [
    'That file could not be imported. Use a GOSU JSON or CSV export, or valid BibTeX.',
    '파일을 가져오지 못했습니다. GOSU JSON 또는 CSV 내보내기 파일이나 올바른 BibTeX를 사용하세요.',
  ],
  [
    'That import is too large for one local operation. Split it into smaller review files.',
    '한 번에 가져오기에는 너무 큽니다. 작은 리뷰 파일로 나누세요.',
  ],
  [
    'This export is too large for one local operation. Filter or select fewer records.',
    '한 번에 내보내기에는 너무 큽니다. 필터를 적용하거나 더 적은 기록을 선택하세요.',
  ],
  [
    'Another literature organization turn is already running for this project.',
    '이 프로젝트에서 다른 문헌 정리 작업이 이미 진행 중입니다.',
  ],
  [
    'AI organization is unavailable. Search and manual literature review remain usable.',
    'AI 정리를 사용할 수 없습니다. 검색과 수동 문헌 검토는 계속 사용할 수 있습니다.',
  ],
  [
    'The linked model did not return valid structured annotations. No paper was overwritten.',
    '연결된 모델이 올바른 구조의 주석을 반환하지 않았습니다. 논문은 덮어쓰지 않았습니다.',
  ],
  [
    'Some papers changed while AI organization was running. GOSU skipped the stale annotations.',
    'AI 정리 중 일부 논문이 변경되었습니다. 오래된 내용에 대한 주석은 건너뛰었습니다.',
  ],
  [
    'Check the search years and fields, then try again.',
    '검색 연도와 입력 항목을 확인한 후 다시 시도하세요.',
  ],
  [
    'The local literature library is unavailable. Board, Notes, and existing project work remain usable.',
    '로컬 문헌 라이브러리를 사용할 수 없습니다. 보드, 노트, 기존 프로젝트 작업은 계속 사용할 수 있습니다.',
  ],
  [
    'The literature operation could not be completed. Saved records were not removed.',
    '문헌 작업을 완료하지 못했습니다. 저장된 기록은 삭제하지 않았습니다.',
  ],
  [
    'GOSU closed before this generation finished. Retry when you are ready.',
    '생성이 완료되기 전에 GOSU가 종료되었습니다. 준비되면 다시 시도하세요.',
  ],
  [
    'Review the selected projects, sources, and presentation settings.',
    '선택한 프로젝트, 원본, 발표 설정을 확인하세요.',
  ],
  [
    'This lecture workspace no longer exists. Refresh and choose another.',
    '이 강의 작업 공간이 더 이상 존재하지 않습니다. 새로고침 후 다른 공간을 선택하세요.',
  ],
  [
    'This lecture workspace is already changing. Wait for it to finish and retry.',
    '강의 작업 공간을 이미 변경 중입니다. 완료될 때까지 기다린 후 다시 시도하세요.',
  ],
  [
    'A selected source changed after review. Refresh the source list before generating.',
    '검토 후 선택한 원본이 변경되었습니다. 생성 전에 원본 목록을 새로고침하세요.',
  ],
  [
    'The selected evidence or current documents are too large to send without hiding content. Select fewer sources or split the lecture into smaller Studios.',
    '선택한 근거나 현재 문서가 내용을 숨기지 않고 보내기에는 너무 큽니다. 원본 수를 줄이거나 강의를 작은 스튜디오로 나누세요.',
  ],
  [
    'This Lecture Studio reached its local history limit. Keep the existing files and start a new Studio.',
    '강의 스튜디오의 로컬 이력이 한도에 도달했습니다. 기존 파일을 유지하고 새 스튜디오를 시작하세요.',
  ],
  [
    'Connect Research Notes for the output project before generating LaTeX files.',
    'LaTeX 파일을 생성하기 전에 출력 프로젝트의 연구 노트를 연결하세요.',
  ],
  [
    'Lecture notes and slides are temporarily unavailable. Existing files were not replaced.',
    '강의 노트와 슬라이드를 일시적으로 사용할 수 없습니다. 기존 파일은 교체하지 않았습니다.',
  ],
  [
    'Codex is unavailable. Existing lecture files remain available.',
    'Codex를 사용할 수 없습니다. 기존 강의 파일은 계속 사용할 수 있습니다.',
  ],
  [
    'Codex authentication has expired or is missing. Sign in again from Connections, then retry generation. Existing lecture files remain available.',
    'Codex 인증이 만료되었거나 없습니다. 연결 화면에서 다시 로그인한 후 생성하세요. 기존 강의 파일은 계속 사용할 수 있습니다.',
  ],
  [
    'Generation stopped after Codex became inactive or reached the 30-minute safety limit. The previous revision remains unchanged.',
    'Codex가 비활성 상태가 되었거나 30분 안전 한도에 도달하여 생성을 중단했습니다. 이전 리비전은 변경하지 않았습니다.',
  ],
  [
    'The connected Codex account reached its usage limit. Try again after the limit resets or connect another account or API key. Existing lecture files remain available.',
    '연결된 Codex 계정의 사용량 한도에 도달했습니다. 한도 초기화 후 다시 시도하거나 다른 계정 또는 API key를 연결하세요. 기존 강의 파일은 계속 사용할 수 있습니다.',
  ],
  [
    'A temporary Codex server or response-stream interruption stopped this generation. Retry generation; the previous revision remains unchanged.',
    'Codex 서버 또는 응답 스트림의 일시적 장애로 생성을 중단했습니다. 다시 생성하세요. 이전 리비전은 변경하지 않았습니다.',
  ],
  [
    'Codex started this generation but could not complete it. The previous revision remains unchanged.',
    'Codex가 생성을 시작했지만 완료하지 못했습니다. 이전 리비전은 변경하지 않았습니다.',
  ],
  [
    'This lecture changed in another action. Refresh and try again.',
    '다른 작업에서 강의가 변경되었습니다. 새로고침 후 다시 시도하세요.',
  ],
  [
    'The Figure library is unavailable or changed. Refresh this direct edit and try again.',
    '그림 라이브러리를 사용할 수 없거나 변경되었습니다. 직접 편집 화면을 새로고침하고 다시 시도하세요.',
  ],
  [
    'Choose a supported, readable raster image.',
    '지원되는 읽기 가능한 래스터 이미지를 선택하세요.',
  ],
  [
    'That image is too large to normalize safely. Choose a smaller raster image.',
    '안전하게 정규화하기에는 이미지가 너무 큽니다. 더 작은 래스터 이미지를 선택하세요.',
  ],
  [
    'This Lecture Studio already has the maximum number of Figure-library images.',
    '이 강의 스튜디오의 그림 라이브러리 이미지 수가 최대치에 도달했습니다.',
  ],
  [
    'This figure is still referenced by a saved revision. Remove its references before deleting it.',
    '저장된 리비전이 아직 이 그림을 참조합니다. 삭제 전에 참조를 제거하세요.',
  ],
  [
    'The selected model cannot use this Figure library. Choose a vision-capable model or edit the source directly.',
    '선택한 모델은 이 그림 라이브러리를 사용할 수 없습니다. 이미지 지원 모델을 선택하거나 원본을 직접 편집하세요.',
  ],
  [
    'A selected manuscript, paper, or experiment is no longer available.',
    '선택한 원고, 논문 또는 실험을 더 이상 사용할 수 없습니다.',
  ],
  [
    'One of the selected files could not be read safely or was already added.',
    '선택한 파일 중 하나를 안전하게 읽을 수 없거나 이미 추가했습니다.',
  ],
  ['Choose a LaTeX, Markdown, or PDF file.', 'LaTeX, Markdown 또는 PDF 파일을 선택하세요.'],
  ['Each source file must be 20 MB or smaller.', '각 원본 파일은 20 MB 이하여야 합니다.'],
  [
    'These files contain too much data to use together. Remove one or choose smaller files.',
    '함께 사용하기에는 파일들의 데이터가 너무 많습니다. 하나를 제거하거나 더 작은 파일을 선택하세요.',
  ],
  [
    'The local source limit was reached. Remove a file before adding another.',
    '로컬 원본 한도에 도달했습니다. 파일을 제거한 후 추가하세요.',
  ],
  [
    'Password-protected PDF sources cannot be read yet.',
    '암호로 보호된 PDF 원본은 아직 읽을 수 없습니다.',
  ],
  [
    'GOSU could not extract readable evidence from that PDF.',
    'PDF에서 읽을 수 있는 근거를 추출하지 못했습니다.',
  ],
  [
    'That temporary file source expired or was removed. Add it again.',
    '임시 원본 파일이 만료되었거나 삭제되었습니다. 다시 추가하세요.',
  ],
  [
    'That temporary file source expired before it could be used. Add it again.',
    '임시 원본 파일을 사용하기 전에 유효기간이 만료되었습니다. 다시 추가하세요.',
  ],
  [
    'That temporary file belongs to another Lecture Studio or is no longer editable. Add it here again.',
    '임시 파일이 다른 강의 스튜디오에 속하거나 더 이상 편집할 수 없습니다. 이곳에 다시 추가하세요.',
  ],
  [
    'A staged source changed unexpectedly, so GOSU stopped before using it. Add it again.',
    '준비된 원본이 예기치 않게 변경되어 사용 전에 중단했습니다. 다시 추가하세요.',
  ],
  [
    'GOSU could not create a unique Overleaf manuscript connection for this source.',
    '이 원본에 대해 고유한 Overleaf 원고 연결을 만들지 못했습니다.',
  ],
  [
    'Overleaf connected, but the requested root TeX checkpoint is not ready. Review it in Manuscript.',
    'Overleaf를 연결했지만 요청한 최상위 TeX 체크포인트가 준비되지 않았습니다. 원고 화면에서 확인하세요.',
  ],
  [
    'Overleaf authentication is not ready. Save or replace the personal Git token in Settings, then confirm Git access is enabled for your Overleaf Premium project.',
    'Overleaf 인증이 준비되지 않았습니다. 설정에서 개인 Git token을 저장하거나 교체하고 Overleaf Premium 프로젝트의 Git 접근이 활성화되어 있는지 확인하세요.',
  ],
  [
    'Enter an official Overleaf Git URL: https://git.overleaf.com/<project-id> or https://git@git.overleaf.com/<project-id>.',
    '공식 Overleaf Git URL을 입력하세요: https://git.overleaf.com/<project-id> 또는 https://git@git.overleaf.com/<project-id>.',
  ],
  [
    'The root TeX file was not found in the captured Overleaf checkpoint.',
    '저장된 Overleaf 체크포인트에서 최상위 TeX 파일을 찾지 못했습니다.',
  ],
  [
    'Overleaf rejected the saved personal Git token. Replace it in Settings and try again.',
    'Overleaf가 저장된 개인 Git token을 거부했습니다. 설정에서 교체하고 다시 시도하세요.',
  ],
  [
    'The generated draft failed source or LaTeX safety checks, so no files were changed.',
    '생성된 초안이 원본 또는 LaTeX 안전 검사를 통과하지 못해 파일을 변경하지 않았습니다.',
  ],
  [
    'The model did not return a readable structured lecture draft after one automatic correction. No files were changed.',
    '한 번 자동 수정한 후에도 모델이 읽을 수 있는 구조의 강의 초안을 반환하지 않았습니다. 파일은 변경하지 않았습니다.',
  ],
  [
    'The model returned an incomplete lecture draft after one automatic correction. No files were changed.',
    '한 번 자동 수정한 후에도 모델이 불완전한 강의 초안을 반환했습니다. 파일은 변경하지 않았습니다.',
  ],
  [
    'The generated notes or slides still used unsupported LaTeX after one automatic correction. No files were changed.',
    '한 번 자동 수정한 후에도 생성된 노트나 슬라이드에 지원하지 않는 LaTeX가 남아 있습니다. 파일은 변경하지 않았습니다.',
  ],
  [
    'The generated draft still had missing or unknown source labels, an incomplete source mapping, or the wrong Sources used visibility after one automatic correction. No files were changed.',
    '한 번 자동 수정한 후에도 출처 표시 누락·미확인, 불완전한 출처 연결 또는 잘못된 Sources used 표시 설정이 남아 있습니다. 파일은 변경하지 않았습니다.',
  ],
  [
    'The generated deck still did not match the requested slide count after one automatic correction. Adjust the slide target or retry.',
    '한 번 자동 수정한 후에도 슬라이드 수가 요청과 일치하지 않습니다. 목표 슬라이드 수를 조정하거나 다시 시도하세요.',
  ],
  [
    'GOSU could not safely commit this revision. Any pending file bundle was rolled back.',
    '리비전을 안전하게 저장하지 못했습니다. 대기 중인 파일 묶음은 되돌렸습니다.',
  ],
  [
    'Generation was stopped. The previous revision remains unchanged.',
    '생성을 중단했습니다. 이전 리비전은 변경하지 않았습니다.',
  ],
  ['This lecture is no longer generating.', '이 강의는 더 이상 생성 중이 아닙니다.'],
  [
    'Local PDF preview needs MacTeX. Install MacTeX, then try compiling this revision again.',
    '로컬 PDF 미리보기에는 MacTeX가 필요합니다. 설치한 후 이 리비전을 다시 컴파일하세요.',
  ],
  [
    'The local LaTeX compiler could not build this revision. The saved LaTeX is unchanged.',
    '로컬 LaTeX 컴파일러가 이 리비전을 빌드하지 못했습니다. 저장된 LaTeX는 변경하지 않았습니다.',
  ],
  [
    'The compiled PDF exceeded the local preview limit. The saved LaTeX is unchanged.',
    '컴파일한 PDF가 로컬 미리보기 한도를 초과했습니다. 저장된 LaTeX는 변경하지 않았습니다.',
  ],
  [
    'This revision could not be converted into a safe local PDF preview. The saved LaTeX is unchanged.',
    '이 리비전을 안전한 로컬 PDF 미리보기로 변환하지 못했습니다. 저장된 LaTeX는 변경하지 않았습니다.',
  ],
  [
    'This saved lecture file no longer matches the selected revision. Refresh and try again.',
    '저장된 강의 파일이 선택한 리비전과 더 이상 일치하지 않습니다. 새로고침 후 다시 시도하세요.',
  ],
  [
    'The saved document changed outside GOSU, so it was not exported or opened as this revision.',
    '문서가 GOSU 밖에서 변경되어 이 리비전으로 내보내거나 열지 않았습니다.',
  ],
  [
    'The Research Notes output folder is unavailable. Reconnect it before opening saved files.',
    '연구 노트 출력 폴더를 사용할 수 없습니다. 저장된 파일을 열기 전에 다시 연결하세요.',
  ],
  ['GOSU could not safely export this lecture file.', '강의 파일을 안전하게 내보내지 못했습니다.'],
  [
    'The file could not be opened in the system default app.',
    '시스템 기본 앱에서 파일을 열지 못했습니다.',
  ],
  ['The lecture operation could not be completed.', '강의 작업을 완료하지 못했습니다.'],
  ['the selected local LaTeX engine', '선택한 로컬 LaTeX 엔진'],
  [
    'PDF preview needs a local MacTeX installation with {selectedEngine}. Install MacTeX or repair the existing installation, then retry; the captured source remains available and unchanged.',
    'PDF 미리보기에는 {selectedEngine}을 포함한 로컬 MacTeX 설치가 필요합니다. MacTeX를 설치하거나 기존 설치를 복구한 후 다시 시도하세요. 저장된 원본은 변경 없이 유지됩니다.',
  ],
  [
    '{selectedEngine} compilation failed. Confirm this local selection matches the Overleaf compiler setting, then check the root TeX document and captured dependencies before retrying.',
    '{selectedEngine} 컴파일에 실패했습니다. 로컬 선택이 Overleaf 컴파일러 설정과 일치하는지 확인하고 최상위 TeX 문서와 저장된 의존 파일을 점검한 후 다시 시도하세요.',
  ],
  [
    'The compiled PDF exceeds the 32 MB local preview limit. Open or export the PDF in Overleaf instead.',
    '컴파일한 PDF가 로컬 미리보기의 32 MB 한도를 초과합니다. Overleaf에서 직접 열거나 내보내세요.',
  ],
  [
    '{selectedEngine} did not produce a valid PDF. Check the root document and captured LaTeX source, then retry.',
    '{selectedEngine}이 올바른 PDF를 생성하지 못했습니다. 최상위 문서와 저장된 LaTeX 원본을 확인한 후 다시 시도하세요.',
  ],
  [
    'This captured checkpoint is no longer available. Check Overleaf changes and capture a new inbound checkpoint.',
    '저장된 체크포인트를 더 이상 사용할 수 없습니다. Overleaf 변경을 확인하고 새 체크포인트를 가져오세요.',
  ],
  [
    'The compiled PDF could not be retained in GOSU’s protected local cache. Check available disk space and retry the compile.',
    '컴파일한 PDF를 GOSU의 보호된 로컬 캐시에 보관하지 못했습니다. 디스크 여유 공간을 확인하고 다시 컴파일하세요.',
  ],
  [
    'This compiled PDF is no longer in the protected local cache. Compile it again before exporting or opening it.',
    '컴파일한 PDF가 보호된 로컬 캐시에 더 이상 없습니다. 내보내거나 열기 전에 다시 컴파일하세요.',
  ],
  [
    'The PDF could not be exported to the selected location. Choose another local folder and retry.',
    '선택한 위치로 PDF를 내보내지 못했습니다. 다른 로컬 폴더를 선택하고 다시 시도하세요.',
  ],
  [
    'The compiled PDF could not be opened in the system default PDF app.',
    '시스템 기본 PDF 앱에서 컴파일한 PDF를 열지 못했습니다.',
  ],
  [
    'The local experiment workspace is unavailable. Existing project work was not replaced.',
    '로컬 실험 작업 공간을 사용할 수 없습니다. 기존 프로젝트 작업은 교체하지 않았습니다.',
  ],
  [
    'This project no longer exists. Reload the workspace.',
    '프로젝트가 더 이상 존재하지 않습니다. 작업 공간을 새로고침하세요.',
  ],
  [
    'Restore this project before changing experiments.',
    '실험을 변경하려면 먼저 이 프로젝트를 복원하세요.',
  ],
  [
    'This idea no longer exists. Refresh the experiment workspace.',
    '아이디어가 더 이상 존재하지 않습니다. 실험 작업 공간을 새로고침하세요.',
  ],
  [
    'The parent idea no longer exists. Choose another parent.',
    '상위 아이디어가 더 이상 존재하지 않습니다. 다른 상위 항목을 선택하세요.',
  ],
  [
    'This idea changed since it was opened. GOSU did not overwrite the newer version.',
    '아이디어를 연 후 내용이 변경되었습니다. 최신 버전은 덮어쓰지 않았습니다.',
  ],
  [
    'This project has reached its local idea limit.',
    '프로젝트의 로컬 아이디어 수가 한도에 도달했습니다.',
  ],
  [
    'This project has reached its local metric-record limit.',
    '프로젝트의 로컬 지표 기록 수가 한도에 도달했습니다.',
  ],
  [
    'Freeze a Goal & Metrics objective before recording comparable results.',
    '비교 가능한 결과를 기록하려면 목표 및 지표를 먼저 확정하세요.',
  ],
  [
    'The logging template changed while you were editing. GOSU did not overwrite the newer version.',
    '편집 중 로깅 템플릿이 변경되었습니다. 최신 버전은 덮어쓰지 않았습니다.',
  ],
  [
    'This project has reached its local logging-template revision limit.',
    '프로젝트의 로컬 로깅 템플릿 리비전 수가 한도에 도달했습니다.',
  ],
  [
    'This run no longer exists. Refresh the experiment workspace.',
    '실행이 더 이상 존재하지 않습니다. 실험 작업 공간을 새로고침하세요.',
  ],
  [
    'This run changed since it was opened. GOSU did not overwrite the newer state.',
    '실행을 연 후 상태가 변경되었습니다. 최신 상태는 덮어쓰지 않았습니다.',
  ],
  [
    'This project has reached its local run limit.',
    '프로젝트의 로컬 실행 수가 한도에 도달했습니다.',
  ],
  [
    'That run state change is not valid from its current state.',
    '현재 실행 상태에서는 해당 상태로 변경할 수 없습니다.',
  ],
  [
    'The log reference could not be validated. Raw log content was not imported.',
    '로그 참조를 검증하지 못했습니다. 원시 로그 내용은 가져오지 않았습니다.',
  ],
  [
    'Enable Trusted workspace for this project server before opening logs in Experiments. The read remains project-scoped and audited.',
    '실험에서 로그를 열려면 이 프로젝트 서버의 신뢰 작업 공간을 활성화하세요. 읽기는 프로젝트 범위로 제한되며 감사 기록이 남습니다.',
  ],
  [
    'The server log changed after validation. GOSU did not display it as the recorded experiment evidence.',
    '검증 후 서버 로그가 변경되었습니다. 기록된 실험 근거로 표시하지 않았습니다.',
  ],
  [
    'The referenced server log is unavailable. The saved run summary remains unchanged.',
    '참조된 서버 로그를 사용할 수 없습니다. 저장된 실행 요약은 변경하지 않았습니다.',
  ],
  ['The experiment operation could not be completed.', '실험 작업을 완료하지 못했습니다.'],
  ['Review the evaluation request and try again.', '평가 요청을 검토하고 다시 시도하세요.'],
  ['This project no longer exists.', '프로젝트가 더 이상 존재하지 않습니다.'],
  [
    'Restore this project before changing evaluations.',
    '평가를 변경하려면 먼저 프로젝트를 복원하세요.',
  ],
  ['This evaluation session no longer exists.', '평가 세션이 더 이상 존재하지 않습니다.'],
  ['This saved recipe is no longer available.', '저장된 recipe를 더 이상 사용할 수 없습니다.'],
  [
    'This evaluation changed in another action. GOSU did not overwrite it.',
    '다른 작업에서 평가가 변경되었습니다. 덮어쓰지 않았습니다.',
  ],
  [
    'This evaluation session is already generating a draft.',
    '평가 세션에서 이미 초안을 생성 중입니다.',
  ],
  [
    'Codex could not produce this draft. Existing evaluation settings remain unchanged.',
    'Codex가 초안을 생성하지 못했습니다. 기존 평가 설정은 변경하지 않았습니다.',
  ],
  [
    'The generated draft failed the evaluation safety or structure checks.',
    '생성된 초안이 평가 안전성 또는 구조 검사를 통과하지 못했습니다.',
  ],
  ['The selected evaluation revision is unavailable.', '선택한 평가 리비전을 사용할 수 없습니다.'],
  [
    'A newer evaluation draft exists. Review it before saving a recipe.',
    '더 새로운 평가 초안이 있습니다. recipe를 저장하기 전에 검토하세요.',
  ],
  [
    'This project reached its local Evaluation Studio history limit.',
    '프로젝트의 로컬 평가 스튜디오 이력이 한도에 도달했습니다.',
  ],
  [
    'GOSU could not safely save the evaluator code and prompt. No recipe was activated.',
    'evaluator 코드와 프롬프트를 안전하게 저장하지 못했습니다. recipe는 활성화하지 않았습니다.',
  ],
  [
    'Evaluation Studio is temporarily unavailable.',
    '평가 스튜디오를 일시적으로 사용할 수 없습니다.',
  ],
  [
    'Project link required — grant this server to the active project in Connections.',
    '프로젝트 연결 필요 — 연결 화면에서 활성 프로젝트에 이 서버의 접근 권한을 부여하세요.',
  ],
  [
    'Select an active, non-archived project before reading linked resources.',
    '연결된 자원을 읽기 전에 보관되지 않은 활성 프로젝트를 선택하세요.',
  ],
  [
    'Host key not trusted — verify its fingerprint and connect once in Terminal.',
    '신뢰되지 않은 host key — fingerprint를 검증하고 터미널에서 한 번 연결하세요.',
  ],
  [
    'Authentication failed — check ssh-agent, Keychain, or the SSH alias.',
    '인증 실패 — ssh-agent, Keychain 또는 SSH alias를 확인하세요.',
  ],
  [
    'Connection failed — check the registered host, port, and network.',
    '연결 실패 — 등록된 host, port, 네트워크를 확인하세요.',
  ],
  [
    'Connection timed out — check that the server is running and reachable.',
    '연결 시간 초과 — 서버가 실행 중이며 연결 가능한지 확인하세요.',
  ],
  [
    'The separate remote command approval was denied; the command did not run.',
    '별도 원격 명령 승인이 거부되어 명령을 실행하지 않았습니다.',
  ],
  [
    'The separate Allow once request expired before the command ran.',
    '명령 실행 전에 별도의 한 번 허용 요청이 만료되었습니다.',
  ],
  [
    'The separate Allow once request was cancelled; the command did not run.',
    '별도의 한 번 허용 요청이 취소되어 명령을 실행하지 않았습니다.',
  ],
  [
    'Usage diagnostics are unavailable. Run Test for a more specific connection check.',
    '사용량 진단을 사용할 수 없습니다. 더 구체적인 연결 확인을 위해 테스트를 실행하세요.',
  ],
  ['Ready · non-interactive authentication verified', '준비됨 · 비대화형 인증 검증 완료'],
  [
    'Host key not trusted · verify its fingerprint and connect once in Terminal',
    '신뢰되지 않은 host key · fingerprint를 검증하고 터미널에서 한 번 연결하세요',
  ],
  [
    'Authentication failed · check ssh-agent, Keychain, or the SSH alias',
    '인증 실패 · ssh-agent, Keychain 또는 SSH alias를 확인하세요',
  ],
  [
    'Connection timed out · check the server and network',
    '연결 시간 초과 · 서버와 네트워크를 확인하세요',
  ],
  [
    'Connection failed · check the registered host, port, and network',
    '연결 실패 · 등록된 host, port, 네트워크를 확인하세요',
  ],
  [
    'Connection failed · run Test again after checking the server',
    '연결 실패 · 서버 확인 후 다시 테스트하세요',
  ],
  [
    'The renamed project folder would overwrite an existing Obsidian folder. GOSU kept the original folder unchanged.',
    '변경한 프로젝트 폴더 이름이 기존 Obsidian 폴더를 덮어쓸 수 있습니다. 원래 폴더를 그대로 유지했습니다.',
  ],
  [
    'The linked Obsidian project folder is missing. GOSU did not recreate or replace it automatically.',
    '연결된 Obsidian 프로젝트 폴더가 없습니다. 자동으로 다시 만들거나 교체하지 않았습니다.',
  ],
  [
    'The project folder ownership marker changed. GOSU stopped managed writes and left every file untouched.',
    '프로젝트 폴더의 소유권 표시가 변경되었습니다. 관리 쓰기를 중단하고 모든 파일을 그대로 유지했습니다.',
  ],
  [
    'The linked Obsidian Vault is unavailable. GOSU kept the existing folder binding for a safe retry.',
    '연결된 Obsidian Vault를 사용할 수 없습니다. 안전하게 재시도할 수 있도록 기존 폴더 연결을 유지했습니다.',
  ],
  [
    'The Obsidian project folder could not be reconciled safely. Existing notes were left untouched.',
    'Obsidian 프로젝트 폴더를 안전하게 일치시키지 못했습니다. 기존 노트는 그대로 유지했습니다.',
  ],
  ['Status unavailable', '상태 확인 불가'],
  ['Enter a personal Git token before saving.', '저장하려면 개인 Git token을 입력하세요.'],
  [
    'Enter a valid Overleaf personal Git token without spaces.',
    '공백 없는 올바른 Overleaf 개인 Git token을 입력하세요.',
  ],
  [
    'GOSU could not use this Mac’s secure credential storage. Check macOS access and try again.',
    '이 Mac의 안전한 인증 정보 저장소를 사용할 수 없습니다. macOS 접근 권한을 확인한 후 다시 시도하세요.',
  ],
  [
    'The saved Overleaf token could not be checked. Try again before changing it.',
    '저장된 Overleaf token을 확인하지 못했습니다. 변경하기 전에 다시 시도하세요.',
  ],
  [
    'The Overleaf token could not be updated. Try again.',
    'Overleaf token을 갱신하지 못했습니다. 다시 시도하세요.',
  ],
  [
    'Clear the saved Overleaf token from GOSU?\n\nExisting linked manuscripts keep working. New Overleaf links will require another saved token. This does not revoke the token in Overleaf.',
    'GOSU에 저장된 Overleaf token을 지울까요?\n\n기존 연결 원고는 계속 작동합니다. 새 Overleaf 연결에는 다른 저장된 token이 필요합니다. Overleaf의 token 자체를 취소하지는 않습니다.',
  ],
  [
    'This project no longer exists. Reload the workspace and try again.',
    '이 프로젝트가 더 이상 존재하지 않습니다. 작업 공간을 새로고침한 후 다시 시도하세요.',
  ],
  [
    'This project is archived. Restore it to active before making changes.',
    '보관된 프로젝트입니다. 변경하려면 먼저 활성 상태로 복원하세요.',
  ],
  ['This project is already active.', '이미 활성 상태인 프로젝트입니다.'],
  [
    'This project is in Trash. Restore it before making changes.',
    '휴지통에 있는 프로젝트입니다. 변경하려면 먼저 복원하세요.',
  ],
  ['This project is already active.', '이미 활성 상태인 프로젝트입니다.'],
  ['No projects remain in Trash.', '휴지통에 남아 있는 프로젝트가 없습니다.'],
  [
    'Trash could not be emptied because Project Chat, SSH, active lecture work, or a retained Lecture Studio still depends on a project. Stop the work, permanently remove related Lecture Studios, or restore the project, then try again.',
    '프로젝트 채팅, SSH, 진행 중인 강의 작업 또는 보관된 강의 스튜디오가 프로젝트를 사용 중이어서 휴지통을 비울 수 없습니다. 작업을 중단하고 관련 강의 스튜디오를 영구 삭제하거나 프로젝트를 복원한 후 다시 시도하세요.',
  ],
  [
    'This Lecture Studio is in Trash. Restore it in Settings before generating or editing.',
    '휴지통에 있는 강의 스튜디오입니다. 생성하거나 편집하려면 설정에서 먼저 복원하세요.',
  ],
  ['This Lecture Studio is already active.', '이미 활성 상태인 강의 스튜디오입니다.'],
  ['No Lecture Studios remain in Trash.', '휴지통에 남아 있는 강의 스튜디오가 없습니다.'],
  [
    'Trash changed after it was displayed. Nothing was removed. Review the refreshed items and confirm again.',
    '표시 이후 휴지통 내용이 변경되어 삭제하지 않았습니다. 새로고침된 항목을 검토하고 다시 확인하세요.',
  ],
  ['This task no longer exists.', '이 할 일이 더 이상 존재하지 않습니다.'],
  ['A task cannot be changed from another project.', '다른 프로젝트의 할 일을 변경할 수 없습니다.'],
  [
    'Save an objective before using revision controls.',
    '리비전 기능을 사용하려면 먼저 목표를 저장하세요.',
  ],
  [
    'This objective is frozen. Start a new revision before editing it.',
    '확정된 목표입니다. 편집하려면 새 리비전을 시작하세요.',
  ],
  [
    'Freeze the current objective before starting a new revision.',
    '새 리비전을 시작하려면 현재 목표를 먼저 확정하세요.',
  ],
  [
    'This item changed since it was opened. The newer version was not overwritten.',
    '항목을 연 이후 내용이 변경되었습니다. 최신 버전을 덮어쓰지 않았습니다.',
  ],
  ['Check the workspace fields and try again.', '작업 공간 입력 항목을 확인하고 다시 시도하세요.'],
  [
    'Local workspace metadata needs recovery. Restart the latest GOSU build; existing data was not replaced.',
    '로컬 작업 공간 메타데이터를 복구해야 합니다. 최신 GOSU를 다시 시작하세요. 기존 데이터는 교체하지 않았습니다.',
  ],
  [
    'The encrypted local workspace is unavailable. Your existing data was not replaced.',
    '암호화된 로컬 작업 공간을 사용할 수 없습니다. 기존 데이터는 교체하지 않았습니다.',
  ],
  [
    'This project already has an active Codex turn. Stop it or wait for completion.',
    '이 프로젝트에서 Codex가 응답을 생성 중입니다. 중단하거나 완료될 때까지 기다리세요.',
  ],
  [
    'That queued message already started, moved, or was removed.',
    '대기 중이던 메시지가 이미 시작되었거나 이동 또는 삭제되었습니다.',
  ],
  [
    'This chat already has 50 queued messages. Let one run or remove one before adding more.',
    '이 채팅에 이미 메시지 50개가 대기 중입니다. 하나를 실행하거나 삭제한 후 추가하세요.',
  ],
  [
    'There is no active Codex turn to stop for this project.',
    '이 프로젝트에서 중단할 Codex 응답이 없습니다.',
  ],
  [
    'The saved turn to retry is no longer available in this project. Send it as a new turn.',
    '재시도할 응답 기록을 이 프로젝트에서 찾을 수 없습니다. 새 메시지로 보내세요.',
  ],
  [
    'Only failed or interrupted Codex turns can be retried.',
    '실패하거나 중단된 Codex 응답만 재시도할 수 있습니다.',
  ],
  [
    'This project agent profile changed since it was opened. GOSU reloaded the current version.',
    '프로젝트 agent 프로필을 연 이후 변경되었습니다. 현재 버전을 다시 불러왔습니다.',
  ],
  [
    'This chat session no longer exists in the selected project. Choose another session.',
    '선택한 프로젝트에 이 채팅 세션이 더 이상 존재하지 않습니다. 다른 세션을 선택하세요.',
  ],
  [
    'That branch point is not part of the selected chat session.',
    '선택한 채팅 세션에 해당 분기 지점이 없습니다.',
  ],
  [
    'Wait for this turn to finish before branching from that message.',
    '이 메시지에서 분기하려면 응답이 완료될 때까지 기다리세요.',
  ],
  [
    'This chat lineage could not be verified, so GOSU did not create the branch.',
    '채팅 분기 이력을 검증할 수 없어 분기를 만들지 않았습니다.',
  ],
  [
    'This chat is too deep or long to branch safely. Start a new chat instead.',
    '안전하게 분기하기에는 채팅의 길이나 분기 깊이가 너무 큽니다. 새 채팅을 시작하세요.',
  ],
  [
    'This project has reached its local chat-session limit. Rename and reuse an existing chat.',
    '프로젝트의 로컬 채팅 세션 수가 한도에 도달했습니다. 기존 채팅의 이름을 바꾸어 재사용하세요.',
  ],
  [
    'Connect this project’s Research Notes folder before authorizing it for chat.',
    '채팅 접근을 허용하려면 먼저 프로젝트의 연구 노트 폴더를 연결하세요.',
  ],
  [
    'This project’s Research Notes binding changed. Review the Obsidian folder and authorize it again.',
    '프로젝트의 연구 노트 연결이 변경되었습니다. Obsidian 폴더를 확인하고 다시 허용하세요.',
  ],
  ['Check the Research Notes request and try again.', '연구 노트 요청을 확인하고 다시 시도하세요.'],
  [
    'This Research Notes project no longer exists. Reload the workspace and try again.',
    '연구 노트 프로젝트가 더 이상 존재하지 않습니다. 작업 공간을 새로고침하고 다시 시도하세요.',
  ],
  [
    'Research Notes are available only while this project is active. Restore it first.',
    '연구 노트는 활성 프로젝트에서만 사용할 수 있습니다. 먼저 프로젝트를 복원하세요.',
  ],
  [
    'Choose an Obsidian Vault before opening this project’s Research Notes.',
    '프로젝트 연구 노트를 열려면 먼저 Obsidian Vault를 선택하세요.',
  ],
  [
    'The selected Obsidian Vault changed. GOSU kept the existing project notes untouched.',
    '선택한 Obsidian Vault가 변경되었습니다. 기존 프로젝트 노트는 변경하지 않았습니다.',
  ],
  [
    'That Obsidian project folder already exists and cannot be safely replaced.',
    '해당 Obsidian 프로젝트 폴더가 이미 존재하여 안전하게 교체할 수 없습니다.',
  ],
  [
    'This project’s Obsidian folder is unavailable. Existing notes were not changed.',
    '프로젝트의 Obsidian 폴더를 사용할 수 없습니다. 기존 노트는 변경하지 않았습니다.',
  ],
  [
    'This note is no longer available inside the selected project folder.',
    '선택한 프로젝트 폴더에서 이 노트를 더 이상 찾을 수 없습니다.',
  ],
  [
    'This Literature record is no longer available, so no paper note was created.',
    '문헌 기록을 더 이상 찾을 수 없어 논문 노트를 만들지 않았습니다.',
  ],
  [
    'Research Notes are unavailable. Existing Obsidian files were not changed.',
    '연구 노트를 사용할 수 없습니다. 기존 Obsidian 파일은 변경하지 않았습니다.',
  ],
  [
    'The Research Notes save could not be confirmed. Check the project folder before retrying; the file may already exist.',
    '연구 노트 저장을 확인하지 못했습니다. 파일이 이미 존재할 수 있으므로 재시도 전에 프로젝트 폴더를 확인하세요.',
  ],
  [
    'This Markdown file is too large for the Research Notes reader. Split it into smaller notes and try again.',
    '연구 노트에서 읽기에 Markdown 파일이 너무 큽니다. 작은 노트로 나눈 후 다시 시도하세요.',
  ],
  [
    'This file is damaged or does not match its file type. Choose a valid local file.',
    '파일이 손상되었거나 파일 형식과 일치하지 않습니다. 올바른 로컬 파일을 선택하세요.',
  ],
  [
    'This file type is not supported yet. Use PDF, DOCX, PPTX, HWPX, text, or a common raster image. Export legacy .ppt files as .pptx first.',
    '아직 지원하지 않는 파일 형식입니다. PDF, DOCX, PPTX, HWPX, 텍스트 또는 일반 이미지 파일을 사용하세요. 기존 .ppt 파일은 먼저 .pptx로 내보내세요.',
  ],
  [
    'Each attachment must be 20 MB or smaller and within decode limits.',
    '각 첨부파일은 20 MB 이하이며 디코딩 제한 범위 안에 있어야 합니다.',
  ],
  [
    'The attachments in one message must total 50 MB or less.',
    '한 메시지의 첨부파일 총 크기는 50 MB 이하여야 합니다.',
  ],
  [
    'Attach no more than five files to one message.',
    '한 메시지에는 파일을 최대 5개까지 첨부할 수 있습니다.',
  ],
  [
    'Password-protected attachments cannot be read yet.',
    '암호로 보호된 첨부파일은 아직 읽을 수 없습니다.',
  ],
  [
    'This document expands beyond the safe archive limit and was not opened.',
    '이 문서의 압축 해제 크기가 안전 한도를 초과하여 열지 않았습니다.',
  ],
  [
    'GOSU could not safely reconstruct content from this file. Try exporting it again.',
    '이 파일에서 내용을 안전하게 추출하지 못했습니다. 다시 내보낸 후 시도하세요.',
  ],
  [
    'This one-time attachment expired. Attach it again.',
    '일회용 첨부파일의 유효기간이 만료되었습니다. 다시 첨부하세요.',
  ],
  [
    'This file belongs to another project or chat session. Attach it here again.',
    '다른 프로젝트 또는 채팅 세션의 파일입니다. 이곳에 다시 첨부하세요.',
  ],
  [
    'Too many one-time files are already waiting or being analyzed. Send or remove them, then try again.',
    '대기 중이거나 분석 중인 일회용 파일이 너무 많습니다. 보내거나 삭제한 후 다시 시도하세요.',
  ],
  [
    'The selected model cannot inspect images. Choose an image-capable model, attach the image again, and resend.',
    '선택한 모델은 이미지를 볼 수 없습니다. 이미지 지원 모델을 선택하고 다시 첨부하여 보내세요.',
  ],
  [
    'This proposed project action no longer exists.',
    '제안된 프로젝트 작업이 더 이상 존재하지 않습니다.',
  ],
  ['This project action was already handled.', '이미 처리된 프로젝트 작업입니다.'],
  [
    'Check the chat message and model selection, then try again.',
    '채팅 메시지와 모델 선택을 확인하고 다시 시도하세요.',
  ],
  [
    'Codex is unavailable. Board and Research Notes remain usable.',
    'Codex를 사용할 수 없습니다. 보드와 연구 노트는 계속 사용할 수 있습니다.',
  ],
  [
    'This GOSU release supports Hermes 0.19.1 only through its pinned runtime. A different runtime needs a reviewed GOSU update before it can be connected.',
    '이 GOSU 버전은 고정된 Hermes 0.19.1 runtime만 지원합니다. 다른 runtime을 연결하려면 검증된 GOSU 업데이트가 필요합니다.',
  ],
  [
    'The verified Hermes runtime is unavailable. Reinstall this GOSU release; development builds may instead use a compatible Hermes 0.19.1 installation.',
    '검증된 Hermes runtime을 사용할 수 없습니다. 이 GOSU 버전을 다시 설치하세요. 개발 빌드는 호환되는 Hermes 0.19.1 설치를 사용할 수도 있습니다.',
  ],
  [
    'Hermes cannot use MoA or a provider that starts another agent in sealed mode. Choose a direct model provider in Hermes, then reconnect.',
    '격리 모드의 Hermes에서는 MoA 또는 다른 agent를 시작하는 제공자를 사용할 수 없습니다. Hermes에서 모델 제공자를 직접 선택한 후 다시 연결하세요.',
  ],
  [
    'GOSU could not safely verify this Hermes setup. Check its model configuration and sign-in, then try again.',
    'Hermes 설정을 안전하게 검증하지 못했습니다. 모델 설정과 로그인을 확인한 후 다시 시도하세요.',
  ],
  [
    'Project chat is unavailable. Existing local messages were not replaced.',
    '프로젝트 채팅을 사용할 수 없습니다. 기존 로컬 메시지는 교체하지 않았습니다.',
  ],
  ['Check the experiment fields and try again.', '실험 입력 항목을 확인하고 다시 시도하세요.'],
  [
    'This project no longer exists. Reload the workspace before opening Experiments.',
    '프로젝트가 더 이상 존재하지 않습니다. 실험을 열기 전에 작업 공간을 새로고침하세요.',
  ],
  [
    'Experiments are available only while this project is active. Restore it first.',
    '실험은 활성 프로젝트에서만 사용할 수 있습니다. 먼저 복원하세요.',
  ],
  [
    'This experiment idea no longer exists in the selected project. Refresh and try again.',
    '선택한 프로젝트에 이 실험 아이디어가 더 이상 존재하지 않습니다. 새로고침 후 다시 시도하세요.',
  ],
  [
    'The parent idea is no longer available in this project. Choose another branch point.',
    '이 프로젝트에서 상위 아이디어를 더 이상 찾을 수 없습니다. 다른 분기 지점을 선택하세요.',
  ],
  [
    'This idea changed since it was opened. GOSU kept the newer version and did not overwrite it.',
    '아이디어를 연 이후 내용이 변경되었습니다. 최신 버전을 유지하고 덮어쓰지 않았습니다.',
  ],
  [
    'This project has reached its local experiment-idea limit.',
    '프로젝트의 로컬 실험 아이디어 수가 한도에 도달했습니다.',
  ],
  [
    'This project has reached its local experiment-metric history limit.',
    '프로젝트의 로컬 실험 지표 이력이 한도에 도달했습니다.',
  ],
  [
    'Freeze the latest Goal & Metrics revision before recording experiment evidence.',
    '실험 근거를 기록하려면 먼저 목표 및 지표의 최신 리비전을 확정하세요.',
  ],
  [
    'The local experiment workspace is unavailable. Existing experiment evidence was not replaced.',
    '로컬 실험 작업 공간을 사용할 수 없습니다. 기존 실험 근거는 교체하지 않았습니다.',
  ],
  [
    'This manuscript no longer exists in the selected project. Refresh and try again.',
    '선택한 프로젝트에 이 원고가 더 이상 존재하지 않습니다. 새로고침하고 다시 시도하세요.',
  ],
  [
    'This manuscript changed since it was opened. GOSU kept the newer version.',
    '원고를 연 이후 내용이 변경되었습니다. 최신 버전을 유지했습니다.',
  ],
  [
    'This project has reached its local manuscript limit.',
    '프로젝트의 로컬 원고 수가 한도에 도달했습니다.',
  ],
  [
    'Only a manuscript that has never been connected or captured can be removed. GOSU kept this manuscript and its provenance.',
    '연결되거나 체크포인트를 저장한 적이 없는 원고만 삭제할 수 있습니다. 원고와 출처 이력을 유지했습니다.',
  ],
  [
    'This manuscript workspace connection no longer exists. Refresh and reconnect if needed.',
    '원고 작업 공간 연결이 더 이상 존재하지 않습니다. 새로고침하고 필요하면 다시 연결하세요.',
  ],
  [
    'This manuscript connection changed since it was opened. No remote content was changed.',
    '원고 연결을 연 이후 설정이 변경되었습니다. 원격 내용은 변경하지 않았습니다.',
  ],
  [
    'This manuscript already has an active workspace. Disconnect it before choosing another engine.',
    '이 원고에는 이미 활성 작업 공간이 있습니다. 다른 엔진을 선택하려면 먼저 연결을 해제하세요.',
  ],
  [
    'The manuscript engine is unavailable. Repository, Board, and Research Notes remain usable.',
    '원고 엔진을 사용할 수 없습니다. 저장소, 보드, 연구 노트는 계속 사용할 수 있습니다.',
  ],
  [
    'Check the provider revision before capturing an inbound checkpoint.',
    '가져온 체크포인트를 저장하기 전에 제공자의 리비전을 확인하세요.',
  ],
  [
    'Paste the official HTTPS Overleaf Git URL for this project; Overleaf’s fixed git@ prefix is supported. Other usernames, passwords, query strings, and non-Overleaf URLs are blocked.',
    '프로젝트의 공식 HTTPS Overleaf Git URL을 붙여 넣으세요. Overleaf의 고정 git@ 접두사를 지원합니다. 다른 사용자 이름, 비밀번호, query string, Overleaf 이외의 URL은 차단됩니다.',
  ],
  [
    'Overleaf Git authentication failed. Check your personal Git token and Premium Git access.',
    'Overleaf Git 인증에 실패했습니다. 개인 Git token과 Premium Git 접근 권한을 확인하세요.',
  ],
  [
    'This Overleaf Git project could not be found with the current account.',
    '현재 계정으로 이 Overleaf Git 프로젝트를 찾을 수 없습니다.',
  ],
  [
    'This Overleaf project does not expose the expected Git checkpoint branch.',
    '이 Overleaf 프로젝트에 예상한 Git 체크포인트 브랜치가 없습니다.',
  ],
  [
    'Overleaf changed after the revision was observed. Check the provider again before capturing.',
    '리비전을 확인한 이후 Overleaf가 변경되었습니다. 체크포인트 저장 전에 제공자를 다시 확인하세요.',
  ],
  [
    'The configured root TeX file is missing or is not a regular file in this Overleaf revision.',
    '설정한 최상위 TeX 파일이 이 Overleaf 리비전에 없거나 일반 파일이 아닙니다.',
  ],
  [
    'This Overleaf checkpoint exceeds the local 256 MB manuscript mirror limit and was not saved.',
    'Overleaf 체크포인트가 로컬 원고 미러의 256 MB 한도를 초과하여 저장하지 않았습니다.',
  ],
  [
    'GOSU could not save the Overleaf token to macOS Keychain. The connection was not stored.',
    'Overleaf token을 macOS Keychain에 저장하지 못했습니다. 연결은 저장되지 않았습니다.',
  ],
  [
    'Use a non-empty personal Overleaf Git token without whitespace.',
    '공백 없이 비어 있지 않은 개인 Overleaf Git token을 입력하세요.',
  ],
  [
    'Check the manuscript name, root TeX path, and Overleaf connection fields.',
    '원고 이름, 최상위 TeX 경로, Overleaf 연결 항목을 확인하세요.',
  ],
  [
    'The local manuscript workspace is unavailable. Existing manuscripts were not replaced.',
    '로컬 원고 작업 공간을 사용할 수 없습니다. 기존 원고는 교체하지 않았습니다.',
  ],
  [
    'Check the SSH server name or alias and try again.',
    'SSH 서버 이름 또는 alias를 확인하고 다시 시도하세요.',
  ],
  [
    'Use ssh with only -p, -l, one user@host destination, and optional loopback-only -L forwarding.',
    'ssh에는 -p, -l, 하나의 user@host 대상과 선택적인 loopback 전용 -L 포워딩만 사용할 수 있습니다.',
  ],
  [
    'This SSH server profile no longer exists. Refresh Connections.',
    'SSH 서버 프로필이 더 이상 존재하지 않습니다. 연결 화면을 새로고침하세요.',
  ],
  [
    'This SSH server profile changed since it was opened. The newer version was not overwritten.',
    'SSH 서버 프로필을 연 이후 내용이 변경되었습니다. 최신 버전을 덮어쓰지 않았습니다.',
  ],
  [
    'This Mac has reached the SSH server profile limit.',
    '이 Mac의 SSH 서버 프로필 수가 한도에 도달했습니다.',
  ],
  [
    'This project remote workspace grant no longer exists. Refresh Connections.',
    '프로젝트의 원격 작업 공간 접근 권한이 더 이상 존재하지 않습니다. 연결 화면을 새로고침하세요.',
  ],
  [
    'This project remote workspace grant changed since it was opened. Review the latest version.',
    '프로젝트의 원격 작업 공간 접근 권한이 변경되었습니다. 최신 설정을 확인하세요.',
  ],
  [
    'This project has reached the remote workspace grant limit.',
    '프로젝트의 원격 작업 공간 접근 권한 수가 한도에 도달했습니다.',
  ],
  [
    'Remote workspace access is available only for an active, non-archived project.',
    '원격 작업 공간은 보관되지 않은 활성 프로젝트에서만 접근할 수 있습니다.',
  ],
  [
    'GOSU blocked this remote workspace command or permission mode. Use an approved bounded text file action, smaller Git inspection, direct test/build command, or relative Python experiment entrypoint.',
    'GOSU가 원격 작업 공간 명령 또는 권한 모드를 차단했습니다. 허용된 제한적 텍스트 파일 작업, 더 작은 Git 조회, 직접적인 test/build 명령 또는 상대 경로 Python 실험 진입점을 사용하세요.',
  ],
  [
    'This remote workspace text file no longer exists. Refresh the file list before continuing.',
    '원격 작업 공간의 텍스트 파일이 더 이상 존재하지 않습니다. 계속하기 전에 파일 목록을 새로고침하세요.',
  ],
  [
    'This remote workspace file changed after review, so GOSU did not replace it. Read the latest version and review a new change.',
    '검토 후 원격 파일이 변경되어 교체하지 않았습니다. 최신 버전을 읽고 새 변경안을 검토하세요.',
  ],
  [
    'GOSU blocked this remote file path or action. Choose a bounded text file inside the approved project workspace.',
    'GOSU가 원격 파일 경로 또는 작업을 차단했습니다. 승인된 프로젝트 작업 공간 안의 제한된 텍스트 파일을 선택하세요.',
  ],
  [
    'This remote file or proposed content is too large for one approved Project Chat action.',
    '원격 파일 또는 제안 내용이 프로젝트 채팅에서 한 번에 승인할 수 있는 크기를 초과합니다.',
  ],
  [
    'The remote file response was invalid or could not be confirmed. Re-read the same path before assuming whether a requested write changed it.',
    '원격 파일 응답이 잘못되었거나 확인할 수 없습니다. 쓰기 요청의 반영 여부를 판단하기 전에 같은 경로를 다시 읽으세요.',
  ],
  [
    'The remote write may have committed before confirmation failed. Read the same path and compare its SHA-256 before retrying.',
    '확인에 실패하기 전에 원격 쓰기가 반영되었을 수 있습니다. 재시도 전에 같은 경로를 읽고 SHA-256을 비교하세요.',
  ],
  [
    'This server does not provide the required /usr/bin/python3 file-broker runtime. Configure Python 3 on the server or choose another workspace; no retry was started.',
    '서버에 필요한 /usr/bin/python3 파일 중개 runtime이 없습니다. 서버에 Python 3을 설정하거나 다른 작업 공간을 선택하세요. 재시도는 시작하지 않았습니다.',
  ],
  [
    'Trusted workspace requires a standard non-root SSH user and an exact Workspace-mode grant.',
    '신뢰 작업 공간에는 root가 아닌 일반 SSH 사용자와 정확한 Workspace 모드 권한이 필요합니다.',
  ],
  [
    'Trusted workspace expired because its project, server, grant, path, or safety policy changed. Retry with Allow once or review and enable trust again.',
    '프로젝트, 서버, 권한, 경로 또는 안전 정책이 변경되어 신뢰 작업 공간의 유효기간이 만료되었습니다. 한 번 허용으로 재시도하거나 검토 후 신뢰를 다시 활성화하세요.',
  ],
  [
    'GOSU could not record the trusted-operation audit, so the remote operation was not started.',
    '신뢰 작업의 감사 기록을 저장하지 못하여 원격 작업을 시작하지 않았습니다.',
  ],
  ['This SSH approval is no longer pending.', '이 SSH 승인 요청은 더 이상 대기 중이 아닙니다.'],
  ['The SSH command was denied and was not started.', 'SSH 명령이 거부되어 시작하지 않았습니다.'],
  [
    'The SSH approval expired and the command was not started.',
    'SSH 승인이 만료되어 명령을 시작하지 않았습니다.',
  ],
  ['The SSH approval or command was cancelled.', 'SSH 승인 또는 명령이 취소되었습니다.'],
  [
    'GOSU blocked this SSH command shape or high-risk command. Use a smaller non-interactive command.',
    'GOSU가 SSH 명령 형식 또는 위험한 명령을 차단했습니다. 더 작은 비대화형 명령을 사용하세요.',
  ],
  [
    'This server host key is not trusted yet. Verify its fingerprint and connect once in Terminal.',
    '아직 신뢰되지 않은 서버 host key입니다. fingerprint를 검증하고 터미널에서 한 번 연결하세요.',
  ],
  [
    'SSH authentication failed. Check this alias, ssh-agent, and Keychain in Terminal.',
    'SSH 인증에 실패했습니다. 터미널에서 alias, ssh-agent, Keychain을 확인하세요.',
  ],
  [
    'The SSH connection failed. Board and existing chat remain available.',
    'SSH 연결에 실패했습니다. 보드와 기존 채팅은 계속 사용할 수 있습니다.',
  ],
  ['The SSH connection or command timed out.', 'SSH 연결 또는 명령 시간이 초과되었습니다.'],
  [
    'The SSH command produced more output than this chat tool can accept.',
    'SSH 명령 출력이 채팅 도구의 허용 크기를 초과했습니다.',
  ],
  [
    'The local SSH transport was stopped. The remote process may require separate verification.',
    '로컬 SSH 연결이 중단되었습니다. 원격 프로세스는 별도로 확인해야 할 수 있습니다.',
  ],
  [
    'Too many SSH commands are awaiting approval or running. Try again later.',
    '승인 대기 중이거나 실행 중인 SSH 명령이 너무 많습니다. 나중에 다시 시도하세요.',
  ],
  [
    'Local SSH is unavailable. Board and existing chat remain available.',
    '로컬 SSH를 사용할 수 없습니다. 보드와 기존 채팅은 계속 사용할 수 있습니다.',
  ],
  ['The operation could not be completed.', '작업을 완료하지 못했습니다.'],
  ['Installed', '설치됨'],
  ['Development', '개발 빌드'],
  ['Checking', '확인 중'],
  ['Encrypted store ready', '암호화 저장소 준비됨'],
  ['Available', '사용 가능'],
  ['Unavailable', '사용 불가'],
  ['Reachable', '연결 가능'],
  ['Offline', '오프라인'],
  ['READY', '준비됨'],
  ['CHECKING', '확인 중'],
  ['DEGRADED', '일부 기능 제한'],
  ['BLOCKED', '사용 불가'],
  ['LOCAL RUNTIME', '로컬 runtime'],
  ['Local runtime ready', '로컬 runtime 준비 완료'],
  ['Local workspace ready with limited connections', '로컬 작업 공간 준비 완료 · 일부 연결 제한'],
];

export const backendUiMessages: Record<string, { en: string; ko: string }> = Object.fromEntries(
  pairs.map(([en, ko]) => [en, { en, ko }]),
);
