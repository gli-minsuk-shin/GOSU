import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useLiveFeedback } from './live-feedback';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let ui: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const result = {
  kind: 'email' as const,
  status: 'ready' as const,
  fetchedAt: '',
  note: '',
  receiptId: '11111111-1111-4111-8111-111111111111',
  items: [
    {
      id: 'm',
      kind: 'email' as const,
      title: 'Mail',
      text: '',
      source: 'Mail',
      readScope: 'mail-metadata' as const,
      details: [],
    },
  ],
};
function Fixture() {
  const feedback = useLiveFeedback('r', [result]);
  return (
    <button data-choice={feedback.choices.m} onClick={() => feedback.saved('m', 'not-interested')}>
      {feedback.warning}
    </button>
  );
}
it('restores server-owned votes on remount and does not let a late lookup overwrite a newly saved vote', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let reply!: (value: unknown) => void;
  vi.mocked(sourceRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  await act(() => {
    ui = create(<Fixture />);
  });
  await act(() => ui!.root.findByType('button').props.onClick());
  await act(async () => reply({ choices: { m: 'important' } }));
  expect(ui!.root.findByType('button').props['data-choice']).toBe('not-interested');
  await act(() => ui!.unmount());
  vi.mocked(sourceRequest).mockResolvedValueOnce({ choices: { m: 'not-interested' } });
  await act(() => {
    ui = create(<Fixture />);
  });
  expect(ui!.root.findByType('button').props['data-choice']).toBe('not-interested');
  expect(vi.mocked(sourceRequest).mock.calls[0]!.slice(0, 2)).toEqual([
    '/memory/feedback/choices',
    { routineId: 'r', receiptId: result.receiptId },
  ]);
});
it('shows a restoration warning instead of claiming an unverified selection was saved', async () => {
  vi.mocked(sourceRequest).mockRejectedValueOnce(new Error('offline'));
  await act(() => {
    ui = create(<Fixture />);
  });
  expect(ui!.root.findByType('button').props['data-choice']).toBeUndefined();
  expect(ui!.root.findByType('button').children.join('')).toContain('확인하지 못했습니다');
});
