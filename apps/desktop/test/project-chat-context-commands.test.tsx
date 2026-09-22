import type { ComponentProps } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { setUiLanguage } from '@gosu/ui/language';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ProjectChatView,
  projectChatCompactionStatus,
} from '../src/renderer/src/project-chat-view';
import {
  PROJECT_CHAT_COMPACTION_REASONS,
  defaultProjectChatProfile,
  type ProjectChatCompactionReceipt,
} from '../src/shared/project-chat-contracts';

type Props = ComponentProps<typeof ProjectChatView>;
const project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Research fixture',
  slug: 'research-fixture',
  version: 1,
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:00.000Z',
};
const renderers: ReactTestRenderer[] = [];
function props(overrides: Partial<Props> = {}): Props {
  return {
    project,
    tasks: [],
    snapshot: {
      schemaVersion: 1,
      projectId: project.id,
      messages: [],
      attempts: [],
      profile: defaultProjectChatProfile(project.id),
    },
    loading: false,
    inFlight: false,
    models: [
      {
        providerId: 'codex',
        modelId: 'fixture',
        displayName: 'Fixture',
        isDefault: true,
        reasoningOptions: [],
      },
    ],
    collaborationModes: [],
    selectedProviderId: 'codex',
    selectedModel: 'fixture',
    selectedReasoning: null,
    applyingActionId: null,
    vault: null,
    vaultState: 'unavailable',
    onSelectedModel: vi.fn(),
    onSelectedReasoning: vi.fn(),
    onRefreshModels: vi.fn(),
    onOpenAgentSettings: vi.fn(),
    onUpdatePolicyRules: vi.fn(async () => true),
    onSend: vi.fn(async () => true),
    onCancel: vi.fn(),
    onApplyAction: vi.fn(),
    onCreateSession: vi.fn(),
    onCompactContext: vi.fn(async (): Promise<ProjectChatCompactionReceipt | null> => ({
      outcome: 'compacted',
      summarizedMessages: 8,
    })),
    ...overrides,
  };
}
async function mount(input: Props) {
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(<ProjectChatView {...input} />);
  });
  renderers.push(renderer);
  return renderer;
}
const composer = (renderer: ReactTestRenderer) =>
  renderer.root.findByProps({ 'aria-label': 'Message GOSU project copilot' });
const type = (renderer: ReactTestRenderer, value: string) =>
  act(() => composer(renderer).props.onChange({ target: { value } }));
const enter = (renderer: ReactTestRenderer) =>
  act(async () =>
    composer(renderer).props.onKeyDown({
      key: 'Enter',
      shiftKey: false,
      nativeEvent: { isComposing: false },
      keyCode: 13,
      preventDefault: vi.fn(),
    }),
  );
const status = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByProps({ className: 'chat-context-command-status' });

beforeEach(() => {
  setUiLanguage('en');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  await act(() => {
    for (const renderer of renderers.splice(0)) renderer.unmount();
  });
  setUiLanguage('en');
  vi.unstubAllGlobals();
});

describe('Project Chat /new and /compact', () => {
  it('/new opens a new chat through the existing control and is never sent as a message', async () => {
    const input = props();
    const renderer = await mount(input);
    await type(renderer, '  /NEW ');
    await enter(renderer);
    expect(input.onCreateSession).toHaveBeenCalledOnce();
    expect(input.onSend).not.toHaveBeenCalled();
    expect(input.onCompactContext).not.toHaveBeenCalled();
    expect(composer(renderer).props.value).toBe('');
  });

  it('/compact runs for the selected session and says what it did, in the reader’s language', async () => {
    const input = props();
    const renderer = await mount(input);
    await type(renderer, '/compact');
    await enter(renderer);
    expect(input.onCompactContext).toHaveBeenCalledOnce();
    expect(input.onSend).not.toHaveBeenCalled();
    expect(status(renderer)[0]!.props['data-tone']).toBe('info');
    expect(JSON.stringify(renderer.toJSON())).toContain('Summarized 8 earlier messages.');
    await act(() => setUiLanguage('ko'));
    expect(JSON.stringify(renderer.toJSON())).toContain('이전 메시지 8개를 요약으로 바꿨습니다.');
  });

  it('holds questions and offers Stop while a compaction runs', async () => {
    let finish!: (receipt: ProjectChatCompactionReceipt) => void;
    const input = props({
      onCompactContext: vi.fn(
        () => new Promise<ProjectChatCompactionReceipt | null>((resolve) => (finish = resolve)),
      ),
    });
    const renderer = await mount(input);
    await type(renderer, '/compact');
    await enter(renderer);
    expect(JSON.stringify(renderer.toJSON())).toContain('Compacting the conversation…');
    await type(renderer, 'A question typed too early');
    const send = () => renderer.root.findByProps({ className: 'primary-button chat-send' });
    expect(send().props.disabled).toBe(true);
    await enter(renderer);
    expect(input.onSend).not.toHaveBeenCalled();
    await act(async () =>
      renderer.root.findByProps({ className: 'danger-button chat-stop' }).props.onClick(),
    );
    expect(input.onCancel).toHaveBeenCalledOnce();
    await act(async () => finish({ outcome: 'cancelled', summarizedMessages: 0 }));
    expect(JSON.stringify(renderer.toJSON())).toContain('/compact was stopped.');
    expect(send().props.disabled).toBe(false);
  });

  it('refuses /compact while an answer is running and keeps the command in the box', async () => {
    const input = props({ inFlight: true });
    const renderer = await mount(input);
    await type(renderer, '/compact');
    await enter(renderer);
    expect(input.onCompactContext).not.toHaveBeenCalled();
    expect(input.onSend).not.toHaveBeenCalled();
    expect(status(renderer)[0]!.props['data-tone']).toBe('error');
    expect(composer(renderer).props.value).toBe('/compact');
  });

  it('sends a sentence that only starts with a command as an ordinary question', async () => {
    const input = props();
    const renderer = await mount(input);
    await type(renderer, '/compact the related work section into one paragraph');
    await enter(renderer);
    expect(input.onSend).toHaveBeenCalledOnce();
    expect(input.onCompactContext).not.toHaveBeenCalled();
  });

  it('lists the commands while one word starting with "/" is typed, and Enter completes it', async () => {
    const input = props();
    const renderer = await mount(input);
    const commands = () =>
      renderer.root
        .findAllByProps({ className: 'chat-skill-menu' })
        .flatMap((menu) => menu.findAllByType('code'))
        .map((node) => node.children.join(''));
    await type(renderer, '/');
    expect(commands()).toEqual([
      '/new',
      '/compact',
      '/todo',
      '/todo list',
      '/todo done',
      '/todo move',
    ]);
    await type(renderer, '/c');
    expect(commands()).toEqual(['/compact']);
    await enter(renderer);
    expect(composer(renderer).props.value).toBe('/compact');
    expect(input.onCompactContext).not.toHaveBeenCalled();
    expect(input.onSend).not.toHaveBeenCalled();
    await type(renderer, '/to');
    expect(commands()).toEqual(['/todo', '/todo list', '/todo done', '/todo move']);
  });

  it('has one specific sentence for every outcome and reason', () => {
    const texts = new Set<string>();
    for (const reason of PROJECT_CHAT_COMPACTION_REASONS) {
      const described = projectChatCompactionStatus({
        outcome: 'failed',
        reason,
        summarizedMessages: 0,
      });
      expect(described.tone).toBe('error');
      expect(described.text).toContain('/compact');
      texts.add(described.text);
    }
    expect(texts.size).toBe(PROJECT_CHAT_COMPACTION_REASONS.length);
    expect(projectChatCompactionStatus(null).tone).toBe('error');
    expect(
      projectChatCompactionStatus({ outcome: 'nothing_to_compact', summarizedMessages: 0 }).tone,
    ).toBe('info');
  });
});
