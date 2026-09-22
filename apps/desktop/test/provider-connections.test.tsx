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
it('signs in to Claude from GOSU and offers reopen and cancel while sign-in is pending', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const preferences = {
    openclaw: 'disabled',
    hermes: 'disabled',
    'claude-code': 'disabled',
  } as const;
  const login = {
    phase: 'idle' as 'idle' | 'signing-in' | 'failed',
    message: null as string | null,
    onLogin: vi.fn(),
    onCancel: vi.fn(),
    onOpenSignInPage: vi.fn(),
    onSubmitCode: vi.fn(),
  };
  const render = (controls: typeof login) => (
    <AgentAddOnsSection preferences={preferences} onChange={vi.fn()} claudeCodeLogin={controls} />
  );
  const buttonLabels = (root: ReturnType<typeof create>['root']) =>
    root
      .findByProps({ 'aria-label': 'Claude 연결' })
      .findAllByType('button')
      .map((button) => JSON.stringify(button.props.children));
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(render(login));
    });
    const claude = ui.root.findByProps({ 'aria-label': 'Claude 연결' });
    const signIn = claude
      .findAllByType('button')
      .find((button) => JSON.stringify(button.props.children).includes('Claude 로그인'))!;
    await act(() => signIn.props.onClick());
    expect(login.onLogin).toHaveBeenCalledOnce();

    await act(() => {
      ui.update(render({ ...login, phase: 'signing-in', message: '브라우저에서 로그인하세요.' }));
    });
    expect(buttonLabels(ui.root).join()).toContain('로그인 페이지 다시 열기');
    expect(buttonLabels(ui.root).join()).toContain('로그인 취소');
    expect(JSON.stringify(ui.toJSON())).toContain('로그인 진행 중');
    const codeInput = ui.root.findByProps({ 'aria-label': 'Claude 인증 코드' });
    expect(codeInput.props.type).toBe('password');
    await act(() => codeInput.props.onChange({ target: { value: '  pasted#code  ' } }));
    const codeForm = ui.root.findByProps({ 'aria-label': 'Claude 인증 코드 입력' });
    await act(() => codeForm.props.onSubmit({ preventDefault: () => undefined }));
    expect(login.onSubmitCode).toHaveBeenCalledExactlyOnceWith('pasted#code');
    expect(ui.root.findByProps({ 'aria-label': 'Claude 인증 코드' }).props.value).toBe('');
    const pending = ui.root.findByProps({ 'aria-label': 'Claude 연결' }).findAllByType('button');
    await act(() =>
      pending.find((b) => JSON.stringify(b.props.children).includes('취소'))!.props.onClick(),
    );
    expect(login.onCancel).toHaveBeenCalledOnce();
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});
