// @vitest-environment node
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { initialWorkspace } from './fixtures';
import { AssistantSettings } from './assistant-settings';
import { BriefingAgentModels } from './briefing-agent-models';
import { BriefingModelBadge } from './briefing-model-badge';
import { sourceRequest } from './live-client';

const usages = [
  {
    usage: 'briefing',
    providerId: 'codex',
    modelId: 'gpt-5.6-luna',
    displayName: 'Luna',
    reasoning: 'low',
    assigned: true,
    available: true,
  },
  {
    usage: 'briefingAssistant',
    providerId: 'codex',
    modelId: 'gpt-6-astra',
    displayName: 'Astra',
    reasoning: null,
    assigned: true,
    available: true,
  },
  {
    usage: 'lightweightTasks',
    providerId: 'claude-code',
    modelId: null,
    displayName: '제공자 기본 모델',
    reasoning: null,
    assigned: false,
    available: false,
  },
];
vi.mock('./live-client', () => ({
  sourceRequest: vi.fn(async (path: string) =>
    path === '/assistant/model/current'
      ? { modelId: 'gpt-6-astra', displayName: 'Astra', reasoning: null, usages }
      : {},
  ),
}));
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const text = () => JSON.stringify(renderer!.toJSON()).replace(/","/gu, '').replace(/\\"/gu, '"');
const flush = () => act(async () => void (await Promise.resolve()));

it('has no engine, model or reasoning picker in the Briefing settings', () => {
  const routine = {
    ...initialWorkspace().routines[0]!,
    live: { ...defaultLiveSettings(), assistant: defaultAssistantPreferences() },
  };
  const html = renderToStaticMarkup(<AssistantSettings routine={routine} onChange={vi.fn()} />);
  for (const gone of ['GOSU AI 엔진', 'OpenAI · Codex', 'Anthropic · Claude Code', 'Reasoning'])
    expect(html).not.toContain(gone);
  expect(html).toContain('설정 → Agent의 ‘작업별 AI 모델’에서 정한 모델로 실행합니다');
  expect(html).toContain('Briefing에는 모델을 따로 고르는 곳이 없습니다');
  // The private-data consent names where the data goes now.
  expect(html).toContain('설정 → Agent에서 Briefing 작업에 지정한 모델의');
  // The old picker and its save endpoint are gone from the app.
  const app = readFileSync(new URL('./briefing-app.tsx', import.meta.url), 'utf8'),
    service = readFileSync(new URL('../live-source-service.ts', import.meta.url), 'utf8');
  expect(app).not.toContain('BriefingModelMenu');
  expect(service).not.toContain('/assistant/model/save');
});

it('lists the model each Briefing usage runs on and says when Settings → Agent assigns none', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await act(() => {
    renderer = create(<BriefingAgentModels routineId="r" />);
  });
  await flush();
  expect(sourceRequest).toHaveBeenCalledWith(
    '/assistant/model/current',
    { routineId: 'r' },
    expect.anything(),
  );
  const shown = text();
  expect(shown).toContain('이메일·논문 요약');
  expect(shown).toContain('Codex · Luna · low');
  expect(shown).toContain('AI 비서 대화');
  expect(shown).toContain('Codex · Astra');
  expect(shown).toContain('Claude Code · 제공자 기본 모델');
  expect(shown).toContain('이 작업의 모델이 미지정입니다');
  expect(shown).toContain('현재 연결에서 이 모델을 쓸 수 없습니다');
  // Outside the desktop app there is nothing to open.
  expect(renderer!.root.findAllByType('button')).toHaveLength(0);
  expect(renderer!.root.findAllByType('select')).toHaveLength(0);
});

it('shows the assistant model in the chat header and opens Settings → Agent from the desktop app', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const parent = { postMessage: vi.fn() };
  vi.stubGlobal('window', {
    location: { search: '?embedded=gosu' },
    parent,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  await act(() => {
    renderer = create(<BriefingModelBadge routineId="r" />);
  });
  await flush();
  const badge = renderer!.root.findByProps({
    'aria-label': 'AI 비서 모델 · 설정 → Agent에서 변경',
  });
  expect(text()).toContain('Astra');
  expect(badge.props.title).toContain('Codex · Astra');
  expect(renderer!.root.findAllByType('select')).toHaveLength(0);
  await act(() => badge.props.onClick());
  expect(parent.postMessage).toHaveBeenCalledWith({ type: 'gosu-open-agent-settings' }, '*');
});
