import type { UiLanguage } from '@gosu/ui/language';
import type { ModelModule, ModelModuleKind, ModelModulePort, ModelSpec } from './model-lab-schema';
import { moduleDataFlow, type ModuleFlowEntry } from './module-detail-flow';
import { pseudocodeStatementSummary } from './repeat-step-description';

/**
 * A readable account of one module that needs no AI: what kind of module it is, the order of its
 * computation read statement by statement, its shapes, and what it is wired to. It only restates
 * what the pseudocode and the graph say, so it is always available and never invents semantics.
 */
export type ModuleReading = Readonly<{
  /** The author's own notes from the pseudocode, when they say more than the source. */
  authored: string | null;
  overview: readonly string[];
  steps: readonly ModuleReadingStep[];
  omittedSteps: number;
  wiring: readonly string[];
  caveat: string;
}>;

export type ModuleReadingStep = Readonly<{ depth: number; code: string; text: string }>;

export const MAX_MODULE_READING_STEPS = 12;

type Localized = Readonly<Record<UiLanguage, string>>;

const KIND: Readonly<Record<ModelModuleKind, Readonly<{ label: Localized; role: Localized }>>> = {
  input: {
    label: { ko: '입력', en: 'input' },
    role: {
      ko: '모델 밖에서 들어오는 데이터를 받아 다음 모듈이 쓸 형태로 준비합니다',
      en: 'takes data from outside the model and prepares it for the next modules',
    },
  },
  linear: {
    label: { ko: '선형 변환', en: 'linear transform' },
    role: {
      ko: '학습되는 가중치로 값을 다른 표현 공간으로 옮깁니다',
      en: 'moves values into another representation with learned weights',
    },
  },
  normalization: {
    label: { ko: '정규화', en: 'normalization' },
    role: {
      ko: '값의 크기(스케일)를 맞춰 학습을 안정시킵니다',
      en: 'rescales values so training stays stable',
    },
  },
  activation: {
    label: { ko: '활성화', en: 'activation' },
    role: { ko: '비선형 함수를 적용합니다', en: 'applies a non-linear function' },
  },
  merge: {
    label: { ko: '결합', en: 'merge' },
    role: {
      ko: '여러 갈래의 값을 하나로 합치거나 서로 섞습니다',
      en: 'combines or mixes values from several branches',
    },
  },
  objective: {
    label: { ko: '목적 함수', en: 'objective' },
    role: {
      ko: '출력과 목표의 차이(손실)를 계산합니다',
      en: 'computes the loss between the output and the target',
    },
  },
  output: {
    label: { ko: '출력', en: 'output' },
    role: { ko: '모델의 최종 결과를 만듭니다', en: 'produces the final result of the model' },
  },
};

const BINDING: Readonly<Record<NonNullable<ModelModulePort['binding']>, Localized>> = {
  external: { ko: '외부 입력', en: 'external' },
  internal: { ko: '모듈 사이 연결', en: 'internal' },
  'loop-carried': { ko: '반복 사이에 전달', en: 'carried between iterations' },
};

const ORIGIN: Readonly<Record<ModuleFlowEntry['origin'], Localized>> = {
  connection: { ko: '연결', en: 'connection' },
  step: { ko: '같은 반복의 단계', en: 'step of this iteration' },
  'previous-iteration': { ko: '이전 반복', en: 'previous iteration' },
  'next-iteration': { ko: '다음 반복', en: 'next iteration' },
  'block-input': { ko: '블록 입력 또는 파라미터', en: 'block input or parameter' },
  'block-output': { ko: '블록 출력', en: 'block output' },
};

const isLoopStep = (module: ModelModule) => module.id.startsWith('repeat-step:');
const shape = (value: ModelModule['inputShape']) => `[${value.join(', ')}]`;

function portList(ports: readonly ModelModulePort[], language: UiLanguage) {
  return ports
    .slice(0, 8)
    .map(
      (port) =>
        `${port.name} ${shape(port.shape)}${port.binding ? ` (${BINDING[port.binding][language]})` : ''}`,
    )
    .join(', ');
}

/** Source lines as statements: comments split off, nesting depth from indentation. */
function sourceSteps(transform: string, language: UiLanguage): ModuleReadingStep[] {
  const ko = language === 'ko';
  const headers: number[] = [];
  const steps: ModuleReadingStep[] = [];
  for (const raw of transform.split(/\r?\n/u)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = raw.replace(/\t/gu, '    ').search(/\S/u);
    while (headers.length > 0 && indent <= headers.at(-1)!) headers.pop();
    const [codePart, ...notes] = trimmed.split(/\s+#\s*/u);
    const code = codePart!.trim();
    const annotation = notes.join(' · ').trim();
    const loop = /^for\s+(.+?)\s+in\s+(.+):$/u.exec(code);
    const summary = loop ? null : pseudocodeStatementSummary(code, language);
    const text = loop
      ? ko
        ? `반복: ${loop[1]}이(가) ${loop[2]}을(를) 도는 동안 아래 들여쓴 줄을 되풀이합니다.`
        : `Loop: repeats the indented lines below for ${loop[1]} in ${loop[2]}.`
      : summary
        ? summary.join(' ')
        : ko
          ? '규칙으로 풀어 읽지 못한 문장이라 원문 그대로 둡니다.'
          : 'Not readable by the fixed rules, so it is left as written.';
    steps.push({
      depth: headers.length,
      code,
      text: annotation ? `${text} ${ko ? '작성자 메모' : 'Author note'}: ${annotation}.` : text,
    });
    if (code.endsWith(':')) headers.push(indent);
  }
  return steps;
}

export function moduleReading(
  model: ModelSpec,
  module: ModelModule,
  parent: ModelModule | null,
  language: UiLanguage,
): ModuleReading {
  const ko = language === 'ko';
  const loopStep = isLoopStep(module);
  const notes = module.explanation.trim();
  const authored = !loopStep && notes && notes !== module.transform.trim() ? notes : null;
  const kind = KIND[module.kind];
  const overview: string[] = loopStep
    ? notes.split(/\r?\n/u).filter((line) => line.trim())
    : [
        ko
          ? `${module.name}: ${kind.label.ko} 모듈 — ${kind.role.ko}.`
          : `${module.name}: a ${kind.label.en} module that ${kind.role.en}.`,
      ];
  if (!loopStep && module.group && module.group !== module.name)
    overview.push(
      ko
        ? `그래프에서는 "${module.group}" 묶음에 속합니다.`
        : `In the graph it belongs to the "${module.group}" group.`,
    );
  if (module.repeat)
    overview.push(
      ko
        ? `같은 구조를 ${module.repeat.count}회 반복합니다 (${module.repeat.label}). 그래프에서 이 블록을 열면 반복 1회 안의 단계를 하나씩 볼 수 있습니다.`
        : `The same structure repeats ${module.repeat.count} times (${module.repeat.label}). Open the block in the graph to inspect the steps of one iteration.`,
    );
  if (parent && !loopStep)
    overview.push(
      ko
        ? `상위 블록 "${parent.name}" 안에 있습니다.`
        : `It sits inside the "${parent.name}" block.`,
    );
  overview.push(
    ko
      ? `입력 차원 ${shape(module.inputShape)} → 출력 차원 ${shape(module.outputShape)}.`
      : `Input shape ${shape(module.inputShape)} → output shape ${shape(module.outputShape)}.`,
  );
  if (module.inputPorts?.length)
    overview.push(`${ko ? '입력 포트' : 'Input ports'}: ${portList(module.inputPorts, language)}.`);
  if (module.outputPorts?.length)
    overview.push(
      `${ko ? '출력 포트' : 'Output ports'}: ${portList(module.outputPorts, language)}.`,
    );

  const allSteps = loopStep ? [] : sourceSteps(module.transform, language);
  const steps = allSteps.slice(0, MAX_MODULE_READING_STEPS);

  const wiring: string[] = [];
  if (module.activation) wiring.push(`${ko ? '활성화 함수' : 'Activation'}: ${module.activation}.`);
  if (module.parameterCount > 0)
    wiring.push(
      ko
        ? `학습 파라미터: ${module.parameterCount.toLocaleString()}개.`
        : `Trainable parameters: ${module.parameterCount.toLocaleString()}.`,
    );
  const flow = moduleDataFlow(model, module.id);
  const nameOf = (entry: ModuleFlowEntry) =>
    (entry.moduleId && model.modules.find((candidate) => candidate.id === entry.moduleId)?.name) ||
    ORIGIN[entry.origin][language];
  const side = (entries: readonly ModuleFlowEntry[], arrow: string) =>
    [...new Set(entries.map((entry) => `${entry.value} ${arrow} ${nameOf(entry)}`))]
      .slice(0, 8)
      .join(', ');
  if (flow.incoming.length > 0)
    wiring.push(`${ko ? '받는 값' : 'Receives'}: ${side(flow.incoming, '←')}.`);
  if (flow.outgoing.length > 0)
    wiring.push(`${ko ? '내보내는 값' : 'Sends'}: ${side(flow.outgoing, '→')}.`);
  if (module.presentation?.shapeNotes)
    wiring.push(`${ko ? '차원 메모' : 'Shape notes'}: ${module.presentation.shapeNotes}`);
  module.presentation?.uncertainties
    .slice(0, 4)
    .forEach((entry) => wiring.push(`${ko ? '확인되지 않은 점' : 'Not confirmed'}: ${entry}`));
  if (module.codeReference.trim())
    wiring.push(`${ko ? '근거 코드 위치' : 'Code reference'}: ${module.codeReference}.`);

  return {
    authored,
    overview,
    steps,
    omittedSteps: allSteps.length - steps.length,
    wiring,
    caveat: ko
      ? '이 설명은 의사코드와 그래프를 정해진 규칙으로 읽은 것입니다. 실행 관측이나 검증이 아니며, 왜 이렇게 설계했는지는 AI 설명에서 물어볼 수 있습니다.'
      : 'This reading follows fixed rules over the pseudocode and the graph. It is not a runtime observation or a verification; ask the AI explanation why it is designed this way.',
  };
}
