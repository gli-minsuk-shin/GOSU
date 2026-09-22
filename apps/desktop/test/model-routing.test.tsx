import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, create } from 'react-test-renderer';
import { defaultModelRouting, routedModel, ModelRoutingSchema } from '@gosu/contracts';
import { ModelRoutingStore } from '../src/main/model-routing-store';
import { routedBriefingPreferences } from '../../briefing-lab/briefing-model-routing';
import { defaultAssistantPreferences } from '../../briefing-lab/src/workspace-contracts';
import {
  ModelRoutingSettings,
  modelRoutingIssue,
  useModelRouting,
} from '../src/renderer/src/model-routing-settings';
const fast = { providerId: 'codex' as const, modelId: 'quick-fixture', reasoningOptionId: 'low' };
const strong = { providerId: 'codex' as const, modelId: 'deep-fixture', reasoningOptionId: 'high' };
const models = [fast, strong].map((m) => ({
  ...m,
  displayName: m.modelId,
  isDefault: m === strong,
  reasoningOptions: [{ id: m.reasoningOptionId, label: m.reasoningOptionId, isDefault: true }],
}));
it('adds a lightweight role without rewriting legacy roles and applies it only to lightweight jobs despite a chat pin', () => {
  const legacy = {
    version: 1 as const,
    fast,
    strong,
    usage: {
      projectChat: 'strong' as const,
      briefing: 'fast' as const,
      briefingAssistant: 'strong' as const,
      lecture: 'strong' as const,
    },
  };
  expect(ModelRoutingSchema.parse(legacy)).toEqual(legacy);
  const policy = {
    ...legacy,
    lightweight: { ...fast, modelId: 'tiny-fixture' },
    usage: { ...legacy.usage, lightweightTasks: 'lightweight' as const },
  };
  const pinned = {
    ...defaultAssistantPreferences(),
    providerId: 'codex' as const,
    modelId: strong.modelId,
  };
  expect(routedBriefingPreferences(pinned, policy, 'lightweightTasks').modelId).toBe(
    'tiny-fixture',
  );
  expect(routedBriefingPreferences(pinned, policy, 'briefingAssistant').modelId).toBe(
    strong.modelId,
  );
  // Email and paper summaries follow the assigned role even when the chat model is pinned.
  expect(routedBriefingPreferences(pinned, policy, 'briefing')).toMatchObject({
    modelId: fast.modelId,
    reasoning: fast.reasoningOptionId,
  });
  expect(routedBriefingPreferences(pinned, legacy, 'lightweightTasks')).toEqual(pinned);
  expect(
    ModelRoutingSchema.safeParse({ ...policy, lightweight: { ...fast, providerId: 'hermes' } })
      .success,
  ).toBe(false);
});
it('maps independently selected roles to workloads without inventing models or falling back from explicit pins', () => {
  const empty = defaultModelRouting();
  expect(routedModel(empty, 'briefing')).toBeNull();
  const policy = { ...empty, fast, strong };
  expect(routedModel(policy, 'briefing')).toEqual(fast);
  expect(routedModel(policy, 'projectChat')).toEqual(strong);
  expect(routedModel(policy, 'briefingAssistant')).toEqual(strong);
  policy.usage.briefing = 'strong';
  expect(routedModel(policy, 'briefing')).toEqual(strong);
  policy.usage.projectChat = 'existing';
  expect(routedModel(policy, 'projectChat')).toBeNull();
  expect(modelRoutingIssue(policy, models)).toBeNull();
  expect(modelRoutingIssue(policy, models.slice(0, 1))).toContain('고성능 모델');
  expect(ModelRoutingSchema.safeParse({ ...policy, permission: true }).success).toBe(false);
  expect(
    ModelRoutingSchema.safeParse({ ...policy, strong: { ...strong, providerId: 'hermes' } })
      .success,
  ).toBe(false);
});
it('routes lecture work to a Claude Code subscription model but still rejects Hermes', () => {
  const claude = {
    providerId: 'claude-code' as const,
    modelId: 'claude-code:opus-5',
    reasoningOptionId: 'high',
  };
  const policy = { ...defaultModelRouting(), fast, strong: claude };
  expect(ModelRoutingSchema.safeParse(policy).success).toBe(true);
  expect(routedModel(policy, 'lecture')).toEqual(claude);
  const withClaude = [
    ...models,
    {
      ...claude,
      displayName: 'Claude Code · Opus 5 (subscription)',
      isDefault: false,
      reasoningOptions: [{ id: 'high', label: 'High', isDefault: true }],
    },
  ];
  expect(modelRoutingIssue(policy, withClaude)).toBeNull();
  const hermes = {
    providerId: 'hermes' as const,
    modelId: 'hermes:configured',
    reasoningOptionId: null,
  };
  expect(
    ModelRoutingSchema.safeParse({
      ...defaultModelRouting(),
      strong: hermes,
      usage: { ...defaultModelRouting().usage, projectChat: 'strong', lecture: 'strong' },
    }).success,
  ).toBe(false);
});
it('loads persisted routing before allowing new defaults and keeps it intact when a save fails', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let complete!: (value: ReturnType<typeof defaultModelRouting>) => void;
  const getModelRouting = vi.fn(
    () =>
      new Promise<ReturnType<typeof defaultModelRouting>>((resolve) => {
        complete = resolve;
      }),
  );
  const setModelRouting = vi.fn(async () => {
    throw Error('write failed');
  });
  vi.stubGlobal('window', { gosu: { briefingLab: { getModelRouting, setModelRouting } } });
  let latest!: ReturnType<typeof useModelRouting>, ui!: ReturnType<typeof create>;
  function Probe() {
    latest = useModelRouting();
    return null;
  }
  try {
    await act(() => {
      ui = create(<Probe />);
    });
    expect(latest.ready).toBe(false);
    const saved = { ...defaultModelRouting(), fast, strong };
    await act(() => complete(saved));
    expect(latest.ready).toBe(true);
    expect(latest.policy).toEqual(saved);
    await expect(latest.save(defaultModelRouting())).rejects.toThrow('write failed');
    expect(latest.policy).toEqual(saved);
    expect(getModelRouting).toHaveBeenCalledTimes(1);
  } finally {
    if (ui) await act(() => ui.unmount());
    vi.unstubAllGlobals();
  }
});
it('persists atomically across restart and rejects corrupt policy instead of silently choosing a costly default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'model-routing-'));
  try {
    const path = join(dir, 'policy.json'),
      store = new ModelRoutingStore(path);
    expect(await store.get()).toEqual(defaultModelRouting());
    const policy = {
      ...defaultModelRouting(),
      fast,
      strong,
      usage: { ...defaultModelRouting().usage, modelExtraction: 'fast' as const },
    };
    await store.set(policy);
    expect(await new ModelRoutingStore(path).get()).toEqual(policy);
    expect(() => store.set({ ...policy, fast: { ...fast, providerId: 'unknown' } })).toThrow();
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(policy);
    await writeFile(path, '{broken');
    await expect(store.get()).rejects.toThrow('model_routing_unreadable');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('says that Briefing runs on these models and has no picker of its own', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(
        <ModelRoutingSettings
          policy={defaultModelRouting()}
          models={models}
          loading={false}
          onSave={vi.fn(async () => undefined)}
          onRefresh={vi.fn()}
        />,
      );
    });
    const shown = JSON.stringify(ui.toJSON());
    expect(shown).toContain('Briefing에는 모델을 따로 고르는 곳이 없습니다');
    expect(shown).toContain('여기서 지정한 모델의 제공자에게 전달됩니다');
    // The old rule (a separate Briefing provider approval) is gone from the explanation.
    expect(shown).not.toContain('Briefing 연결·전송 권한을 별도로 확인');
    const label = (usage: string) =>
      ui.root
        .findByProps({ 'aria-label': usage })
        .findAllByType('option')
        .find((o) => o.props.value === 'existing')!.props.children;
    expect(JSON.stringify(label('Briefing · 이메일 요약'))).toContain('루틴이 전에 쓰던 모델');
    expect(JSON.stringify(label('전역 AI 비서 · 프로젝트·메일·일정 대화'))).toContain(
      '루틴이 전에 쓰던 모델',
    );
    expect(JSON.stringify(label('Project Chat · 새 과학·연구 대화'))).toBe('"기존 설정"');
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});
it('edits each role and workload in a single explicit save without model calls', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const onSave = vi.fn(async () => undefined),
    onRefresh = vi.fn();
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(
        <ModelRoutingSettings
          policy={defaultModelRouting()}
          models={models}
          loading={false}
          onSave={onSave}
          onRefresh={onRefresh}
        />,
      );
    });
    await act(() =>
      ui.root
        .findByProps({ 'aria-label': '빠른 모델 선택' })
        .props.onChange({ target: { value: JSON.stringify(['codex', fast.modelId]) } }),
    );
    await act(() =>
      ui.root
        .findByProps({ 'aria-label': '빠른 모델 추론 수준' })
        .props.onChange({ target: { value: 'low' } }),
    );
    await act(() =>
      ui.root
        .findByProps({ 'aria-label': '고성능 모델 선택' })
        .props.onChange({ target: { value: JSON.stringify(['codex', strong.modelId]) } }),
    );
    await act(() =>
      ui.root
        .findByProps({ 'aria-label': '고성능 모델 추론 수준' })
        .props.onChange({ target: { value: 'high' } }),
    );
    await act(() =>
      ui.root
        .findByProps({ 'aria-label': '전역 AI 비서 · 프로젝트·메일·일정 대화' })
        .props.onChange({ target: { value: 'strong' } }),
    );
    const extraction = ui.root.findByProps({ 'aria-label': 'Model Lab · 모델 구조 추출' });
    expect(extraction.findAllByType('option').map((o) => o.props.value)).toEqual([
      'fast',
      'strong',
      'existing',
    ]);
    expect(onSave).not.toHaveBeenCalled();
    await act(() =>
      ui.root
        .findByProps({ 'aria-label': 'Model Lab · 모델 구조 추출' })
        .props.onChange({ target: { value: 'fast' } }),
    );
    await act(() => ui.root.findByProps({ className: 'primary-button' }).props.onClick());
    expect(onSave).toHaveBeenCalledWith({
      ...defaultModelRouting(),
      fast,
      strong,
      usage: {
        ...defaultModelRouting().usage,
        briefingAssistant: 'strong',
        modelExtraction: 'fast',
      },
    });
    expect(JSON.stringify(ui.toJSON())).toContain('저장됨');
  } finally {
    if (ui) await act(() => ui.unmount());
    vi.unstubAllGlobals();
  }
});
