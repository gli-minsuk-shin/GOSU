import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { BriefingRunDelete } from './briefing-history-delete';
import { BriefingHistoryView } from './briefing-history-view';
import { BriefingApp } from './briefing-app';
import { initialRealWorkspace } from './workspace-defaults';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let ui: ReactTestRenderer;
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const button = (name: string) =>
  ui.root
    .findAllByType('button')
    .find((b) => b.props['aria-label'] === name || b.children.join('') === name)!;
const click = async (name: string) => act(() => button(name).props.onClick());
const receipt = {
  deletionId: '11111111-1111-4111-8111-111111111111',
  routineId: 'r',
  runId: '22222222-2222-4222-8222-222222222222',
  historyIds: ['h1', 'h2'],
};
it('requires a confirmation, leaves source systems alone, and never removes UI on an unconfirmed/failed request', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const done = vi.fn();
  await act(() => {
    ui = create(
      <BriefingRunDelete target={{ routineId: 'r', historyId: 'h1' }} onDeleted={done} />,
    );
  });
  await click('브리핑 전체 삭제');
  await click('취소');
  expect(sourceRequest).not.toHaveBeenCalled();
  await click('브리핑 전체 삭제');
  vi.mocked(sourceRequest).mockRejectedValueOnce(Error('Synthetic delete failure'));
  await click('이 회차 삭제');
  expect(done).not.toHaveBeenCalled();
  expect(JSON.stringify(ui.toJSON())).toContain('Synthetic delete failure');
  vi.mocked(sourceRequest).mockResolvedValueOnce(receipt);
  await click('이 회차 삭제');
  expect(done).toHaveBeenCalledWith(receipt);
  expect(vi.mocked(sourceRequest).mock.calls.every(([p]) => p === '/history/delete')).toBe(true);
  expect(vi.mocked(sourceRequest).mock.calls[1]?.[1]).toEqual({
    routineId: 'r',
    historyId: 'h1',
    confirmed: true,
  });
});
it('removes a complete grouped run, keeps other dates, and restores from deleted briefings', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', new EventTarget());
  const rows = [
    {
      id: 'h1',
      runId: receipt.runId,
      routineId: 'r',
      createdAt: '2026-09-10T00:00:00Z',
      kind: 'briefing',
      answer: 'First run summary',
      private: false,
      items: [],
    },
    {
      id: 'h2',
      runId: receipt.runId,
      routineId: 'r',
      createdAt: '2026-09-10T00:01:00Z',
      kind: 'briefing',
      answer: 'Same run second batch',
      private: false,
      items: [],
    },
    {
      id: 'older',
      routineId: 'r',
      createdAt: '2026-09-09T00:00:00Z',
      kind: 'briefing',
      answer: 'Older run summary',
      private: false,
      items: [],
    },
  ];
  let deleted = false;
  vi.mocked(sourceRequest).mockImplementation(async (path) => {
    if (path === '/history/list') return { history: deleted ? rows.slice(2) : rows };
    if (path === '/history/delete') {
      deleted = true;
      return receipt;
    }
    if (path === '/history/restore') {
      deleted = false;
      return receipt;
    }
    if (path === '/history/deleted')
      return {
        removed: deleted
          ? [
              {
                id: receipt.deletionId,
                routineId: 'r',
                runId: receipt.runId,
                historyId: 'h1',
                createdAt: rows[0]!.createdAt,
                deletedAt: '2026-09-10T02:00:00Z',
                routineName: 'Synthetic',
              },
            ]
          : [],
      };
    return {};
  });
  await act(() => {
    const seed = initialRealWorkspace('2026-09-10T00:00:00Z');
    ui = create(
      <BriefingApp
        workspace={{
          ...seed,
          selectedRoutineId: 'r',
          routines: [{ ...seed.routines[0]!, id: 'r' }],
        }}
        onChange={vi.fn()}
      />,
    );
  });
  expect(ui.root.findAllByProps({ className: 'briefing-history-run' })).toHaveLength(2);
  const view = ui.root.findByType(BriefingHistoryView);
  await click('브리핑 전체 삭제');
  await click('이 회차 삭제');
  expect(ui.root.findByType(BriefingHistoryView)).toBe(view);
  expect(button('삭제 취소')).toBeTruthy();
  expect(JSON.stringify(ui.toJSON())).not.toContain('First run summary');
  expect(JSON.stringify(ui.toJSON())).toContain('Older run summary');
  expect(ui.root.findAllByProps({ className: 'briefing-history-run' })).toHaveLength(1);
  await click('삭제한 브리핑 보기');
  await click('복원');
  expect(button('삭제 취소')).toBeUndefined();
  expect(ui.root.findAllByProps({ className: 'briefing-history-run' })).toHaveLength(2);
  expect(JSON.stringify(ui.toJSON())).toContain('Same run second batch');
});
