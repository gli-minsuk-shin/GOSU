import type { AppLanguage } from '@gosu/contracts';

const messages: Readonly<Record<string, string>> = {
  'Joined the existing build for identical source bytes; no duplicate LLM call was started.':
    '동일한 원본의 진행 중인 생성 작업에 합류했습니다. LLM을 중복 호출하지 않았습니다.',
  'Validating the model-builder request.': '모델 생성 요청을 검증하고 있습니다.',
  'Checking for a canonical graph built from the same source bytes.':
    '동일한 원본으로 생성된 표준 그래프가 있는지 확인하고 있습니다.',
  'No canonical graph exists for these source bytes; starting one new build.':
    '동일한 원본의 표준 그래프가 없어 새 모델 생성을 시작합니다.',
  'Reusing the prepared source capsule and adding one bounded validation receipt; documents are not extracted again.':
    '준비된 원본 자료를 재사용하고 검증 결과만 추가합니다. 문서를 다시 추출하지 않습니다.',
  'This source import is already running. Waiting for its canonical graph instead of starting another LLM call.':
    '동일한 원본을 이미 가져오고 있습니다. LLM을 중복 호출하지 않고 표준 그래프 생성을 기다립니다.',
  'Model reconstruction did not finish within 10 minutes for this large source. The source was not executed and no incomplete graph was saved. Retry or select a faster reasoning level.':
    '큰 원본의 모델 재구성이 10분 내에 완료되지 않았습니다. 원본을 실행하지 않았고 불완전한 그래프도 저장하지 않았습니다. 재시도하거나 더 빠른 reasoning 수준을 선택하세요.',
  'Model reconstruction did not finish within 5 minutes. Retry, or select a faster model/reasoning level after the GOSU adapter is connected.':
    '모델 재구성이 5분 내에 완료되지 않았습니다. GOSU adapter 연결 후 재시도하거나 더 빠른 모델 또는 reasoning 수준을 선택하세요.',
  'Codex exited before producing a ModelIR result. Retry the reconstruction or check the local Codex connection.':
    'ModelIR 결과를 생성하기 전에 Codex가 종료되었습니다. 재구성을 다시 시도하거나 로컬 Codex 연결을 확인하세요.',
  'Claude Code exited before producing a ModelIR result. Check that Claude Code is still signed in with a Claude.ai subscription, then retry.':
    'ModelIR 결과를 생성하기 전에 Claude Code가 종료되었습니다. Claude.ai 구독으로 로그인되어 있는지 확인하고 다시 시도하세요.',
  'The supplied source evidence does not fit the selected model context without truncation. Use a larger-context model or import fewer/smaller source files; GOSU did not create or cache an incomplete graph.':
    '원본 근거가 선택한 모델의 context 한도를 초과합니다. 더 긴 context를 지원하는 모델을 선택하거나 파일 수와 크기를 줄이세요. 불완전한 그래프는 생성하거나 캐시하지 않았습니다.',
  'Python static architecture analysis could not determine a safe model entrypoint. The source was not executed and no incomplete graph was saved.':
    'Python 정적 분석으로 안전한 모델 진입점을 확인하지 못했습니다. 원본을 실행하지 않았고 불완전한 그래프도 저장하지 않았습니다.',
};

/** Called only for application-authored status copy; captured names/diagnostics are preserved. */
export function modelLabMessage(message: string, language: AppLanguage): string {
  if (language !== 'ko') return message;
  if (messages[message]) return messages[message];
  const rules: readonly [RegExp, (...parts: string[]) => string][] = [
    [
      /^Accepted (.+) bounded source artifacts?\.$/,
      (count) => `원본 자료 ${count}개를 접수했습니다.`,
    ],
    [
      /^Preparing (.+) bounded source artifacts? for reconstruction\.$/,
      (count) => `모델 재구성을 위해 원본 자료 ${count}개를 준비하고 있습니다.`,
    ],
    [
      /^Reusing canonical ModelIR (.+); no LLM was invoked\.$/,
      (id) => `표준 ModelIR ${id}를 재사용합니다. LLM은 호출하지 않았습니다.`,
    ],
    [
      /^(.+) selected with (.+) reasoning\.$/,
      (model, reasoning) => `${model} · reasoning ${reasoning}으로 실행합니다.`,
    ],
    [
      /^Static Python AST selected (.+); retained (.+) of (.+) lines in its transitive architecture capsule without executing the file\.$/,
      (entry, kept, total) =>
        `Python AST 분석에서 ${entry}를 선택했습니다. 파일을 실행하지 않고 관련 구조 ${kept}/${total}행을 유지했습니다.`,
    ],
    [
      /^Prepared bounded (.+) source capsule \((.+) characters\) for the selected LLM\.$/,
      (types, count) => `선택한 LLM에 제공할 ${types} 원본 자료 ${count}자를 준비했습니다.`,
    ],
    [
      /^Prepared source capsule reused \((.+) characters with diagnostic\); requesting one targeted complete replacement ModelIR\.$/,
      (count) =>
        `준비된 원본 자료와 진단 ${count}자를 재사용하여 수정된 전체 ModelIR을 요청합니다.`,
    ],
    [
      /^Repairing only formula and explanation in (.+) modules; the existing graph and ports are preserved\.$/,
      (count) => `${count}개 모듈의 수식과 설명만 수정합니다. 기존 그래프와 포트는 유지됩니다.`,
    ],
    [
      /^LLM call (.+) is reconstructing the architecture; up to (.+) minutes for this source\. Later calls occur only when audits reject a candidate\.$/,
      (attempt, minutes) =>
        `LLM 호출 ${attempt} · 모델 구조를 재구성하고 있습니다. 최대 ${minutes}분입니다. 검증에 실패한 경우에만 추가 호출합니다.`,
    ],
    [
      /^LLM call (.+) is applying the latest targeted audit receipt; up to (.+) minutes for this source\.$/,
      (attempt, minutes) =>
        `LLM 호출 ${attempt} · 최신 검증 결과에 따라 수정하고 있습니다. 최대 ${minutes}분입니다.`,
    ],
    [
      /^LLM call (.+) is still running · (.+) seconds elapsed · (.+) minute limit\. Waiting for the provider's (.+)\.$/,
      (attempt, seconds, minutes, kind) =>
        `LLM 호출 ${attempt} 진행 중 · ${seconds}초 경과 · 제한 ${minutes}분. ${kind === 'complete ModelIR response' ? '전체 ModelIR 응답' : '수식·설명 수정안'}을 기다리고 있습니다.`,
    ],
    [
      /^(Initial|Repair (\d+)) deterministic audit: semantic blocks, exact ports, loop composition, graph references, and formula consistency\.$/,
      (phase, attempt) =>
        `${phase === 'Initial' ? '초기' : `수정 ${attempt}`} 검증: 의미 단위 블록, 포트, 반복 구조, 그래프 참조, 수식 일관성을 확인합니다.`,
    ],
    [
      /^(Initial audit|Repair audit (\d+)) rejected the candidate; starting targeted LLM call (.+): ([\s\S]*)$/,
      (phase, attempt, call, reason) =>
        `${phase === 'Initial audit' ? '초기' : `수정 ${attempt}`} 검증 실패 · 수정용 LLM 호출 ${call} 시작. 진단: ${reason}`,
    ],
    [
      /^Semantic architecture audit passed: (.+) modules and (.+) exact connections\.$/,
      (modules, connections) => `모델 구조 검증 통과: 모듈 ${modules}개, 연결 ${connections}개.`,
    ],
    [
      /^Import receipt (.+); generation and audit results are saved locally\.$/,
      (id) => `가져오기 기록 ${id} · 생성 및 검증 결과를 로컬에 저장합니다.`,
    ],
    [
      /^Resuming saved candidate from import receipt (.+); correcting (.+) modules without regenerating the graph\. A fresh full audit is required after repair\.$/,
      (id, count) =>
        `가져오기 기록 ${id}의 저장된 후보를 이어서 처리합니다. 그래프를 다시 생성하지 않고 모듈 ${count}개를 수정한 후 전체 검증을 다시 수행합니다.`,
    ],
    [
      /^Python static architecture analysis failed\. ([\s\S]*)$/,
      (detail) => `Python 정적 구조 분석에 실패했습니다. 진단: ${detail}`,
    ],
    [
      /^The selected model returned an invalid model graph\. ([\s\S]*)$/,
      (detail) => `선택한 모델이 반환한 그래프가 검증을 통과하지 못했습니다. 진단: ${detail}`,
    ],
  ];
  for (const [pattern, render] of rules) {
    const match = message.match(pattern);
    if (match) return render(...match.slice(1));
  }
  return message;
}
