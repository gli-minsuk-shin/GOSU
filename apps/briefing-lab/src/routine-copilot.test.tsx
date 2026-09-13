import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodexModelCatalog } from '@gosu/contracts';
import { RoutineCopilot } from './routine-copilot';
import type { RoutineClient } from './routine-client';
import { RoutineProposalSchema, type RoutineResult } from './routine-builder';
import { initialWorkspace } from './fixtures';

const catalog = createCodexModelCatalog([
  {
    id: 'gpt-future',
    model: 'gpt-future',
    displayName: 'Future model',
    isDefault: true,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }],
  },
]);
const routine = initialWorkspace('2026-09-08T00:00:00.000Z').routines[0]!;
const result: RoutineResult = {
  answer: '검토할 루틴을 준비했습니다.',
  proposal: RoutineProposalSchema.parse({
    name: '논문 아침',
    kind: 'personal',
    schedule: routine.schedule,
    interest: routine.interest,
    sourceIds: [],
    countries: [],
  }),
  providerId: 'codex',
  model: 'gpt-future',
  reasoning: 'high',
  nextDates: ['2026-09-09T23:00:00.000Z'],
};
const renderers: ReactTestRenderer[] = [];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  await act(() => {
    for (const renderer of renderers.splice(0)) renderer.unmount();
  });
  vi.unstubAllGlobals();
});
async function mount() {
  const client = {
    models: vi.fn<RoutineClient['models']>(async () => [
      { providerId: 'codex', catalog, error: null },
    ]),
    run: vi.fn<RoutineClient['run']>(async () => result),
  };
  const save = vi.fn();
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(<RoutineCopilot onCreate={save} client={client} />);
  });
  renderers.push(renderer);
  const button = (label: string) =>
    renderer.root.findAllByType('button').find((item) => item.children.join('') === label)!;
  const click = async (label: string) => {
    await act(() => button(label).props.onClick());
  };
  const type = async (value: string) => {
    await act(() => renderer.root.findByType('textarea').props.onChange({ target: { value } }));
  };
  return { client, renderer, save, button, click, type };
}
describe('Routine creation Copilot', () => {
  it('connects only on request; uses catalog choices; saves only after review and only once', async () => {
    const test = await mount();
    expect(test.client.models).not.toHaveBeenCalled();
    await test.click('GOSU 엔진 연결');
    expect(JSON.stringify(test.renderer.toJSON())).toContain('Future model');
    const select = test.renderer.root.findAllByType('select')[1]!;
    await act(() => select.props.onChange({ target: { value: 'high' } }));
    await test.type('논문 루틴 만들어줘');
    await test.click('루틴 제안 요청');
    expect(test.client.run.mock.calls[0]![0]).toMatchObject({
      modelId: 'gpt-future',
      providerId: 'codex',
      reasoning: 'high',
      history: [],
    });
    expect(test.save).not.toHaveBeenCalled();
    await test.click('검토한 루틴 추가');
    expect(test.save).toHaveBeenCalledOnce();
    expect(test.save.mock.calls[0]![0]).toMatchObject({ name: '논문 아침', state: 'draft' });
    expect(test.button('초안으로 추가됨').props.disabled).toBe(true);
    await test.click('초안으로 추가됨');
    expect(test.save).toHaveBeenCalledOnce();
  });
  it('carries the unsaved proposal into a follow-up; a failed follow-up removes the obsolete apply button', async () => {
    const test = await mount();
    await test.click('GOSU 엔진 연결');
    await test.type('논문');
    await test.click('루틴 제안 요청');
    test.client.run.mockRejectedValueOnce(new Error('routine_proposal_invalid'));
    await test.type('9시로 바꿔줘');
    await test.click('루틴 제안 요청');
    expect(test.client.run.mock.calls[1]![0].previousProposal).toEqual(result.proposal);
    expect(test.button('검토한 루틴 추가')).toBeUndefined();
    expect(test.renderer.root.findByType('textarea').props.value).toBe('9시로 바꿔줘');
    expect(test.save).not.toHaveBeenCalled();
  });
  it('cancels and ignores a late result without saving or showing it', async () => {
    const test = await mount();
    await test.click('GOSU 엔진 연결');
    let finish!: (value: RoutineResult) => void;
    test.client.run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await test.type('논문');
    await test.click('루틴 제안 요청');
    await test.click('중단');
    expect(test.client.run.mock.calls[0]![1].aborted).toBe(true);
    await act(() => finish(result));
    expect(test.button('검토한 루틴 추가')).toBeUndefined();
    expect(test.save).not.toHaveBeenCalled();
  });
  it('does not turn a clarification into a creation', async () => {
    const test = await mount();
    await test.click('GOSU 엔진 연결');
    test.client.run.mockResolvedValueOnce({
      ...result,
      answer: '격주인가요?',
      proposal: null,
      nextDates: [],
    });
    await test.type('bi-weekly');
    await test.click('루틴 제안 요청');
    expect(test.button('검토한 루틴 추가')).toBeUndefined();
    expect(test.save).not.toHaveBeenCalled();
    expect(JSON.stringify(test.renderer.toJSON())).toContain('격주인가요?');
  });
});
