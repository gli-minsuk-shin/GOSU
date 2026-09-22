/** Project research workspace actions: notes, Literature library, manuscripts and experiments. */
export type AssistantWorkspaceAction =
  | 'notes'
  | 'note-save'
  | 'literature'
  | 'literature-add'
  | 'manuscripts'
  | 'experiments'
  | 'experiment-idea-add'
  | 'experiment-metric-record';

export type ProjectBridge = (
  action:
    | 'list'
    | 'read'
    | 'remember'
    | 'request'
    | 'model-lab'
    | 'model-lab-add'
    | AssistantWorkspaceAction,
  projectId: string,
  text: string,
  signal: AbortSignal,
  recheck?: () => Promise<void>,
) => Promise<unknown>;

export const MODEL_LAB_ADD_CONSENT =
  'AI 비서가 선택한 프로젝트의 Model Lab에 새 모델을 추가합니다. 기존 모델은 바꾸지 않습니다. 이번 요청에만 허용할까요?';

const WRITE_CONSENT: Readonly<Record<string, (input: Record<string, unknown>) => string>> = {
  'model-lab-add': () => MODEL_LAB_ADD_CONSENT,
  'note-save': (input) =>
    `AI 비서가 선택한 프로젝트의 연구 노트 폴더에 새 노트를 만듭니다. 기존 노트는 바꾸지 않습니다.\n\n${String(input.title ?? '')}\n\n이번 요청에만 허용할까요?`,
  'literature-add': (input) => {
    const papers = Array.isArray(input.papers) ? input.papers : [];
    const titles = papers
      .slice(0, 5)
      .map((paper) =>
        paper && typeof paper === 'object' && 'title' in paper ? `· ${String(paper.title)}` : '',
      )
      .filter(Boolean);
    return `AI 비서가 이번 대화에서 찾은 논문 ${papers.length}편을 선택한 프로젝트의 논문 서재에 추가합니다. 이미 있는 논문은 새로 만들지 않습니다.\n\n${titles.join('\n')}\n\n이번 요청에만 허용할까요?`;
  },
  'experiment-idea-add': (input) =>
    `AI 비서가 선택한 프로젝트에 새 실험 아이디어를 추가합니다.\n\n${String(input.title ?? '')}\n\n이번 요청에만 허용할까요?`,
  'experiment-metric-record': (input) =>
    `AI 비서가 선택한 프로젝트의 실험 아이디어에 지표 값 ${String(input.value ?? '')}을(를) 기록합니다.\n\n이번 요청에만 허용할까요?`,
};

/** The consent text for a bridge write, or null for actions that do not write. */
export function assistantWriteConsent(action: string, text: string): string | null {
  const describe = WRITE_CONSENT[action];
  if (!describe) return null;
  let parsed: Record<string, unknown> = {};
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    if (value && typeof value === 'object' && !Array.isArray(value))
      parsed = value as Record<string, unknown>;
  } catch {
    // The desktop side rejects malformed input; the consent text stays generic.
  }
  return describe(parsed).replace(/\n{3,}/gu, '\n\n');
}

/**
 * Assistant writes (Model Lab model, research note, Literature papers, experiment idea or metric)
 * run at once when requests are always allowed and ask first when the policy is "ask every time".
 * Reads and the project memory/request actions, which confirm on the desktop side, pass through.
 */
export function confirmingAssistantWrites(
  bridge: ProjectBridge,
  needsConfirmation: () => boolean,
  consent: (message: string, signal: AbortSignal) => Promise<void>,
): ProjectBridge {
  return async (action, projectId, text, signal, recheck) => {
    const message = assistantWriteConsent(action, text);
    if (message && needsConfirmation()) await consent(message, signal);
    return bridge(action, projectId, text, signal, recheck);
  };
}
