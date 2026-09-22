import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ModelChatRuns, useModelChatRuns } from './model-chat-runs';
const a = JSON.stringify(['a', '1', 0]),
  b = JSON.stringify(['b', '1', 0]);
afterEach(() => vi.unstubAllGlobals());
it('retains bounded progress per revision while another session is selected', () => {
  const runs = new ModelChatRuns();
  const first = runs.start(a)!;
  const second = runs.start(b)!;
  for (let step = 0; step < 20; step++) runs.progress(a, first, { step, phase: 'thinking' });
  expect(runs.get(a)?.progress).toHaveLength(12);
  expect(runs.get(a)?.progress.at(-1)?.step).toBe(19);
  expect(runs.get(b)?.progress).toEqual([]);
  runs.stop(a);
  runs.progress(a, first, { step: 21, phase: 'final' });
  expect(runs.get(a)?.progress.at(-1)?.step).toBe(19);
  expect(second.signal.aborted).toBe(false);
  runs.dispose();
});
it('retains independent running questions and rejects duplicate sends for one session', () => {
  const runs = new ModelChatRuns();
  const first = runs.start(a)!;
  const second = runs.start(b)!;
  expect(runs.start(a)).toBeNull();
  expect(first.signal.aborted).toBe(false);
  expect(runs.owns(a, first)).toBe(true);
  runs.stop(b);
  expect(second.signal.aborted).toBe(true);
  expect(first.signal.aborted).toBe(false);
  runs.finish(b, second);
  expect(runs.get(a)?.controller).toBe(first);
  runs.dispose();
});
it('does not let stale completion clear a newer question and cancels deleted models only', () => {
  const runs = new ModelChatRuns();
  const old = runs.start(a)!;
  runs.finish(a, old);
  const current = runs.start(a)!;
  const other = runs.start(b)!;
  runs.finish(a, old);
  expect(runs.get(a)?.controller).toBe(current);
  runs.removeModel('a');
  expect(current.signal.aborted).toBe(true);
  expect(runs.owns(a, current)).toBe(false);
  expect(other.signal.aborted).toBe(false);
  runs.dispose();
  expect(other.signal.aborted).toBe(true);
});
it('continues a pending answer across hiding, switching sessions and returning to its original view', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let registry!: ModelChatRuns;
  const answers = new Map<string, string>();
  function View({ selected, hidden = false }: { selected: string; hidden?: boolean }) {
    const runs = useModelChatRuns();
    registry = runs;
    return (
      <div hidden={hidden}>
        {selected}:{runs.get(selected) ? 'running' : (answers.get(selected) ?? 'idle')}
      </div>
    );
  }
  let ui!: ReactTestRenderer;
  await act(() => {
    ui = create(<View selected={a} />);
  });
  let finish!: () => void;
  let controller!: AbortController;
  await act(() => {
    controller = registry.start(a)!;
  });
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  }).then(() => {
    if (registry.owns(a, controller)) answers.set(a, 'completed original answer');
    registry.finish(a, controller);
  });
  await act(() => ui.update(<View selected={b} hidden />));
  expect(controller.signal.aborted).toBe(false);
  await act(() => ui.update(<View selected={a} />));
  expect(JSON.stringify(ui.toJSON())).toContain('running');
  await act(() => ui.update(<View selected={b} />));
  await act(async () => {
    finish();
    await pending;
  });
  expect(JSON.stringify(ui.toJSON())).not.toContain('completed original answer');
  await act(() => ui.update(<View selected={a} />));
  expect(JSON.stringify(ui.toJSON())).toContain('completed original answer');
  await act(() => ui.unmount());
});
it('does not tie Model Assistant cancellation or completion to the selected model object', () => {
  const source = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
  expect(source).toContain('copilotRuns.start(activeChatSessionKey)');
  expect(source).not.toContain('copilotTurnAbortRef');
  expect(source).not.toContain('setAnswering(false)');
  expect(source).toContain('copilotRuns.removeModel(targetModelId)');
});
