import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, create } from 'react-test-renderer';
import { defaultModelRouting, routedModel, ModelRoutingSchema } from '@gosu/contracts';
import { ModelRoutingStore } from '../src/main/model-routing-store';
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
    const policy = { ...defaultModelRouting(), fast, strong };
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
    expect(onSave).not.toHaveBeenCalled();
    await act(() => ui.root.findByProps({ className: 'primary-button' }).props.onClick());
    expect(onSave).toHaveBeenCalledWith({
      ...defaultModelRouting(),
      fast,
      strong,
      usage: { ...defaultModelRouting().usage, briefingAssistant: 'strong' },
    });
    expect(JSON.stringify(ui.toJSON())).toContain('저장됨');
  } finally {
    if (ui) await act(() => ui.unmount());
    vi.unstubAllGlobals();
  }
});
