import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { AgentAddOnsSection } from '../src/renderer/src/agent-addons-section';
import { createAgentAddOnRegistry } from '../src/main/agent-addon-service';
import { readFileSync } from 'node:fs';
it('does not discover or connect retired providers in the application registry', async () => {
  const isExecutable = vi.fn(async () => true);
  const registry = createAgentAddOnRegistry({ isExecutable });
  expect(registry.descriptors().map((d) => d.id)).toEqual(['claude-code']);
  await expect(registry.connect('hermes')).rejects.toThrow('unknown_agent_add_on_adapter');
  await expect(registry.statuses(['openclaw'])).rejects.toThrow('unknown_agent_add_on_adapter');
  expect(isExecutable).not.toHaveBeenCalled();
  const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  expect(main).toContain("['claude-code']");
  expect(main).not.toContain('hermesProjectChat: projectChatProvider');
  expect(main).not.toContain('delegate: (input) => hermesProjectChat.delegate(input)');
});
it('uses explicit connection buttons without detection on mount or touching unrelated settings', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const onChange = vi.fn(),
    refresh = vi.fn(async () => {});
  const codex = {
    status: 'Connected',
    busy: false,
    onConnect: vi.fn(),
    onLogin: vi.fn(),
    onRefresh: vi.fn(),
    onDisconnect: vi.fn(),
  };
  const preferences = {
    openclaw: 'disabled',
    hermes: 'disabled',
    'claude-code': 'disabled',
  } as const;
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(
        <AgentAddOnsSection
          preferences={preferences}
          onChange={onChange}
          codexConnection={codex}
          onRefreshClaudeCodeConnection={refresh}
        />,
      );
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    const claude = ui.root.findByProps({ 'aria-label': 'Claude 연결' });
    await act(() => claude.findAllByType('button')[0]!.props.onClick());
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...preferences,
      'claude-code': 'connect-local',
    });
    const card = ui.root.findByProps({ 'aria-label': 'Codex 연결' });
    await act(() => card.findAllByType('button')[0]!.props.onClick());
    expect(codex.onConnect).toHaveBeenCalledOnce();
    expect(codex.onLogin).not.toHaveBeenCalled();
    expect(JSON.stringify(ui.toJSON())).not.toContain('Hermes');
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});
