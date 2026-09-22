import { readFileSync } from 'node:fs';
import type { ComponentProps } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { setUiLanguage } from '@gosu/ui/language';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectChatView } from '../src/renderer/src/project-chat-view';
import { defaultProjectChatProfile } from '../src/shared/project-chat-contracts';

type Props = ComponentProps<typeof ProjectChatView>;
const project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Research fixture',
  slug: 'research-fixture',
  version: 1,
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:00.000Z',
};
const grant = { id: 'a'.repeat(64), name: 'Research Vault', allowAgentMarkdownCreate: true };
const vault = { id: grant.id, name: grant.name, root: 'Obsidian/GOSU/Research fixture', files: [] };
const renderers: ReactTestRenderer[] = [];
const unavailableCases = [
  {
    label: 'no grant',
    state: 'ready',
    grant: null,
    vault: null,
    status: 'Research Notes not authorized — chat continues without notes',
  },
  {
    label: 'checking',
    state: 'checking',
    grant,
    vault: null,
    status: 'Research Notes access checking — chat remains available',
  },
  {
    label: 'unavailable',
    state: 'unavailable',
    grant,
    vault: null,
    status: 'Research Notes status unavailable — chat continues without notes',
  },
  {
    label: 'absent folder',
    state: 'ready',
    grant,
    vault: null,
    status: 'Research Vault grant inactive — chat continues without notes',
  },
  {
    label: 'mismatched folder',
    state: 'ready',
    grant,
    vault: { ...vault, id: 'b'.repeat(64) },
    status: 'Research Vault grant inactive — chat continues without notes',
  },
] satisfies readonly {
  label: string;
  state: Props['vaultState'];
  grant: typeof grant | null;
  vault: Props['vault'];
  status: string;
}[];

function props(overrides: Partial<Props> = {}): Props {
  return {
    project,
    tasks: [],
    snapshot: {
      schemaVersion: 1,
      projectId: project.id,
      messages: [],
      attempts: [],
      profile: { ...defaultProjectChatProfile(project.id), localNotesVault: grant },
    },
    initialDraft: 'Discuss the project without accessing notes',
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

describe('Project Chat without Research Notes', () => {
  it.each(unavailableCases)(
    'allows Send and Enter for $label without modifying or authorizing the saved grant',
    async (item) => {
      const input = props({
        vaultState: item.state,
        vault: item.vault,
        snapshot: {
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile: { ...defaultProjectChatProfile(project.id), localNotesVault: item.grant },
        },
      });
      const before = structuredClone(input.snapshot);
      const renderer = await mount(input);
      expect(JSON.stringify(renderer.toJSON())).toContain(item.status);
      expect(
        renderer.root.findByProps({ className: 'primary-button chat-send' }).props.disabled,
      ).toBe(false);
      await act(async () =>
        renderer.root.findByProps({ className: 'primary-button chat-send' }).props.onClick(),
      );
      expect(input.onSend).toHaveBeenCalledTimes(1);
      const composer = renderer.root.findByProps({ 'aria-label': 'Message GOSU project copilot' });
      await act(() => composer.props.onChange({ target: { value: 'Continue this discussion' } }));
      const preventDefault = vi.fn();
      await act(async () =>
        composer.props.onKeyDown({
          key: 'Enter',
          shiftKey: false,
          nativeEvent: { isComposing: false },
          keyCode: 13,
          preventDefault,
        }),
      );
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(input.onSend).toHaveBeenCalledTimes(2);
      expect(input.snapshot).toEqual(before);
      expect(input.onOpenAgentSettings).not.toHaveBeenCalled();
      expect(input.onUpdatePolicyRules).not.toHaveBeenCalled();
    },
  );

  it('sends the composer text when the send button is clicked, never the click event', async () => {
    // `submit` takes the text to send so a card can send a follow-up in the user's place. The
    // send button must not pass its own event into that parameter: the event would be the message.
    const input = props();
    const renderer = await mount(input);
    await act(async () =>
      renderer.root.findByProps({ className: 'primary-button chat-send' }).props.onClick({
        type: 'click',
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      }),
    );
    expect(input.onSend).toHaveBeenCalledOnce();
    expect(input.onSend.mock.calls[0]?.[0]).toBe('Discuss the project without accessing notes');
  });

  it('also permits Claude Code chat with an inactive note grant without switching providers', async () => {
    const input = props({
      models: [
        {
          providerId: 'claude-code',
          modelId: 'fixture-claude',
          displayName: 'Claude fixture',
          isDefault: false,
          reasoningOptions: [],
        },
      ],
      selectedProviderId: 'claude-code',
      selectedModel: 'fixture-claude',
    });
    const renderer = await mount(input);
    expect(
      renderer.root.findByProps({ className: 'primary-button chat-send' }).props.disabled,
    ).toBe(false);
    await act(async () =>
      renderer.root.findByProps({ className: 'primary-button chat-send' }).props.onClick(),
    );
    expect(input.onSend).toHaveBeenCalledOnce();
    expect(input.onSelectedModel).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'preserves explicit read/create capabilities for an authorized empty folder (create=%s)',
    async (createAllowed) => {
      const input = props({
        vault,
        vaultState: 'ready',
        snapshot: {
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile: {
            ...defaultProjectChatProfile(project.id),
            localNotesVault: { ...grant, allowAgentMarkdownCreate: createAllowed },
          },
        },
      });
      const renderer = await mount(input);
      const output = JSON.stringify(renderer.toJSON());
      expect(output).toContain(
        createAllowed
          ? 'Research Vault read + automatic saves authorized'
          : 'Research Vault read-only',
      );
      expect(output).not.toContain('chat continues without notes');
      expect(input.onOpenAgentSettings).not.toHaveBeenCalled();
    },
  );

  it('still blocks missing models and empty messages independently of Research Notes', async () => {
    const input = props({ selectedModel: 'missing-model' });
    const renderer = await mount(input);
    expect(
      renderer.root.findByProps({ className: 'primary-button chat-send' }).props.disabled,
    ).toBe(true);
    await act(async () =>
      renderer.root.findByProps({ className: 'primary-button chat-send' }).props.onClick(),
    );
    expect(input.onSend).not.toHaveBeenCalled();
    await act(() => renderer.update(<ProjectChatView {...props({ initialDraft: '' })} />));
    const composer = renderer.root.findByProps({ 'aria-label': 'Message GOSU project copilot' });
    await act(() => composer.props.onChange({ target: { value: '' } }));
    expect(
      renderer.root.findByProps({ className: 'primary-button chat-send' }).props.disabled,
    ).toBe(true);
  });

  it('localizes the nonblocking status and leaves the user-defined vault name unchanged', async () => {
    setUiLanguage('ko');
    const renderer = await mount(props({ vaultState: 'ready' }));
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'Research Vault 접근 권한 비활성 — 노트 없이 채팅을 계속합니다',
    );
    expect(
      renderer.root.findByProps({ className: 'primary-button chat-send' }).props.disabled,
    ).toBe(false);
  });

  it('does not reinstate a renderer-only note blocker before forwarding the unchanged request to Main', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );
    const handler = source.slice(
      source.indexOf('onSend={async (message, retryOfAttemptId, controls, attachmentIds)'),
      source.indexOf('const receipt = await window.gosu.projectChat.send'),
    );
    expect(handler).not.toContain('savedLocalNotesGrant');
    expect(handler).not.toContain('researchNotesState');
    expect(handler).not.toContain('GOSU paused this turn');
    expect(handler).toContain(
      "selectedDescriptor.providerId === 'hermes' && attachmentIds.length > 0",
    );
  });
});
