import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUiLanguage, setUiLanguage, uiText } from '@gosu/ui/language';
import { ModelChatComposer } from './model-chat-composer';
import { CenterModelGraphButton } from './model-graph';
import { Formula, renderFormulaResult } from './formula';
import {
  ModelLabLanguageSettings,
  useModelLabLanguagePreference,
  modelLabReviewSummary,
} from './model-lab-language';
import { modelLabFetch } from './model-lab-environment';
import type * as ModelLabEnvironment from './model-lab-environment';

vi.mock('./model-lab-environment', async (importOriginal) => ({
  ...(await importOriginal<typeof ModelLabEnvironment>()),
  modelLabFetch: vi.fn(),
}));

const fetchMock = vi.mocked(modelLabFetch);
const renderers: ReactTestRenderer[] = [];
let fakeWindow: EventTarget;
let fakeDocument: EventTarget & { visibilityState: string; documentElement: { lang: string } };

function Harness() {
  const preference = useModelLabLanguagePreference();
  return createElement(
    'main',
    null,
    createElement(ModelLabLanguageSettings, { preference }),
    createElement(ModelChatComposer, {
      initialDraft: 'My English model note: H1_new = X.T @ (y - X @ H1) / N',
      busy: false,
      hasAttachments: false,
      onDraftChange: vi.fn(),
      onSubmit: vi.fn(),
      onStop: vi.fn(),
    }),
    createElement(Formula, { latex: 'H_3 = \\operatorname{concat}(H_1,H_2)' }),
  );
}

async function mount() {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  renderers.push(renderer);
  return renderer;
}

function preferenceResponse(language: 'ko' | 'en') {
  return new Response(JSON.stringify({ language, configured: true }));
}

beforeEach(() => {
  setUiLanguage('en');
  fetchMock.mockReset();
  fakeWindow = new EventTarget();
  fakeDocument = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    documentElement: { lang: 'en' },
  });
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(async () => {
  await act(async () => {
    for (const renderer of renderers.splice(0)) renderer.unmount();
  });
  setUiLanguage('en');
  vi.unstubAllGlobals();
});

describe('shared Model Lab language', () => {
  it('preserves change counts without leaking English plural suffixes into Korean', () => {
    expect(uiText('{count} change', { count: 1 })).toBe('1 change');
    expect(uiText('{count} changes', { count: 2 })).toBe('2 changes');
    setUiLanguage('ko');
    expect(uiText('{count} change', { count: 1 })).toBe('변경 1개');
    expect(uiText('{count} changes', { count: 2 })).toBe('변경 2개');
    expect(uiText('Jump to changed lines. {count} changes.', { count: 2 })).toBe(
      '변경된 줄로 이동합니다. 변경 2개.',
    );
    expect(uiText('{count} modified steps in this iteration', { count: 3 })).toBe(
      '이 반복에서 수정된 단계 3개',
    );
    expect(uiText('{changed} changed · {added} added Blocks', { changed: 2, added: 4 })).toBe(
      '변경 2개 · 추가 블록 4개',
    );
    expect(uiText('{count} changed edges', { count: 2 })).toBe('변경된 연결 2개');
    expect(
      uiText('Permanently delete {count} model sessions and their chat/view state?', { count: 2 }),
    ).toBe('모델 세션 2개 및 대화·화면 상태를 영구 삭제할까요?');
    expect(uiText('s')).toBe('s');
  });
  it('translates only known audit summaries while preserving unrecognized model/source diagnostics', () => {
    const source = '7 tensor interfaces are dimensionally consistent.';
    expect(modelLabReviewSummary(source)).toBe(source);
    setUiLanguage('ko');
    expect(modelLabReviewSummary(source)).toBe('텐서 연결 7개의 차원이 일치합니다.');
    expect(modelLabReviewSummary('Research equation H_3 = W H_1 + b')).toBe(
      'Research equation H_3 = W H_1 + b',
    );
  });
  it('uses saved GOSU language and changes labels without changing the draft or formula', async () => {
    fetchMock.mockResolvedValueOnce(preferenceResponse('ko'));
    const renderer = await mount();
    expect(getUiLanguage()).toBe('ko');
    expect(fakeDocument.documentElement.lang).toBe('ko');
    const textarea = renderer.root.findByType('textarea');
    expect(textarea.props.placeholder).toContain('모델을 질문');
    const editedDraft = '사용자 초안 / English name / H[:, d:] = 7 * tanh(H[:, d:] / 7)';
    await act(() => textarea.props.onChange({ target: { value: editedDraft } }));
    const formula = renderer.root.findByProps({ className: 'formula' }).props
      .dangerouslySetInnerHTML;
    fetchMock.mockResolvedValueOnce(preferenceResponse('en'));
    await act(async () =>
      renderer.root.findByType('select').props.onChange({ target: { value: 'en' } }),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/application-language',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ language: 'en' }),
      }),
    );
    expect(getUiLanguage()).toBe('en');
    expect(renderer.root.findByType('textarea').props.value).toBe(editedDraft);
    expect(renderer.root.findByType('textarea').props.placeholder).toContain('Ask about the model');
    expect(
      renderer.root.findByProps({ className: 'formula' }).props.dangerouslySetInnerHTML,
    ).toEqual(formula);
    expect(fakeDocument.documentElement.lang).toBe('en');
  });

  it('refreshes global changes on focus without reseeding or resetting a conversation', async () => {
    fetchMock.mockResolvedValueOnce(preferenceResponse('en'));
    const renderer = await mount();
    const before = renderer.root.findByType('textarea').props.value;
    fetchMock.mockResolvedValueOnce(preferenceResponse('ko'));
    await act(async () => {
      fakeWindow.dispatchEvent(new Event('focus'));
    });
    expect(renderer.root.findByType('select').props.value).toBe('ko');
    expect(renderer.root.findByType('textarea').props.value).toBe(before);
    fakeDocument.visibilityState = 'hidden';
    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      fakeWindow.dispatchEvent(new Event('focus'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it('keeps the last saved language on failed writes and exposes a localized error', async () => {
    fetchMock.mockResolvedValueOnce(preferenceResponse('ko'));
    const renderer = await mount();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    await act(async () =>
      renderer.root.findByType('select').props.onChange({ target: { value: 'en' } }),
    );
    expect(getUiLanguage()).toBe('ko');
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain(
      '저장하지 못했습니다',
    );
    expect(renderer.root.findByType('select').props.disabled).toBe(false);
  });

  it('ignores an older refresh response after the user saves a new language', async () => {
    let finishGet!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finishGet = resolve;
      }),
    );
    const renderer = await mount();
    fetchMock.mockResolvedValueOnce(preferenceResponse('ko'));
    await act(async () =>
      renderer.root.findByType('select').props.onChange({ target: { value: 'ko' } }),
    );
    await act(async () => {
      finishGet(preferenceResponse('en'));
    });
    expect(getUiLanguage()).toBe('ko');
  });

  it('localizes graph actions and error labels, but never transforms mathematical source', () => {
    setUiLanguage('ko');
    const korean = renderToStaticMarkup(
      createElement(CenterModelGraphButton, { onClick: vi.fn() }),
    );
    expect(korean).toContain('모델 블록 중앙 정렬');
    const source = 'H_3 = \\operatorname{concat}(H_1,H_2)';
    const first = renderFormulaResult(source);
    setUiLanguage('en');
    const english = renderToStaticMarkup(
      createElement(CenterModelGraphButton, { onClick: vi.fn() }),
    );
    expect(english).toContain('Center model boxes');
    expect(renderFormulaResult(source)).toEqual(first);
  });
});
