import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { MarkAllMailRead } from './mail-mark-all';
import { MailReadStatus, resetMailReadSession } from './mail-read-status';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));

const url = (id: string) => `message://%3C${id}%40example.test%3E`;
const mails = [
  { historyId: 'h1', itemId: 'm1', url: url('m1') },
  { historyId: 'h1', itemId: 'm2', url: url('m2') },
  { historyId: 'h2', itemId: 'm3', url: url('m3') },
];
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  resetMailReadSession();
  vi.mocked(sourceRequest).mockReset();
  vi.unstubAllGlobals();
});
const text = () => JSON.stringify(renderer!.toJSON());
const button = () =>
  renderer!.root.findByProps({ className: 'briefing-button briefing-mark-all-read' });

// 2026-09-22 user request: "daily 별로 briefing 에서 모두읽기 버튼 넣자. 하나씩 누르기 너무 귀찮다."
it('marks every unread mail of a briefing with one request and updates each card', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let resolve!: (value: unknown) => void;
  vi.mocked(sourceRequest).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(() => {
    renderer = create(
      <div>
        <MarkAllMailRead routineId="r" mails={mails} />
        <MailReadStatus
          unread
          historical
          target={{ routineId: 'r', historyId: 'h1', itemId: 'm1' }}
          url={url('m1')}
        />
        <MailReadStatus
          unread
          historical
          target={{ routineId: 'r', historyId: 'h1', itemId: 'm2' }}
          url={url('m2')}
        />
      </div>,
    );
  });
  expect(button().children.join('')).toBe('모두 읽음 (3)');
  // Inside a <summary>: the click must not fold the section.
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  await act(() => button().props.onClick(event));
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.stopPropagation).toHaveBeenCalled();
  expect(vi.mocked(sourceRequest)).toHaveBeenCalledExactlyOnceWith('/mail/mark-read-all', {
    routineId: 'r',
    items: [
      { historyId: 'h1', itemId: 'm1' },
      { historyId: 'h1', itemId: 'm2' },
      { historyId: 'h2', itemId: 'm3' },
    ],
  });
  expect(button().props.disabled).toBe(true);
  expect(text()).toContain('읽음 처리 중');
  await act(async () =>
    resolve({
      marked: 2,
      results: [
        { historyId: 'h1', itemId: 'm1', status: 'read', markedAt: '2026-09-22T00:00:00.000Z' },
        { historyId: 'h1', itemId: 'm2', status: 'failed', error: '메일을 찾지 못했습니다.' },
        { historyId: 'h2', itemId: 'm3', status: 'read', markedAt: '2026-09-22T00:00:01.000Z' },
      ],
    }),
  );
  // The result is said in words, with the concrete reason of what failed.
  expect(text()).toContain('2통 읽음 처리');
  expect(text()).toContain('1통 실패');
  expect(text()).toContain('메일을 찾지 못했습니다.');
  // The card of a marked mail follows; the failed one stays unread and shows why.
  expect(text()).toContain('읽음 처리를 완료했습니다.');
  // Only the mail that failed is left to retry.
  expect(button().children.join('')).toBe('모두 읽음 (1)');
});

it('shows a failed request as an error and leaves every mail to retry; without unread mail there is no button', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockRejectedValue(new Error('Apple Mail 접근 권한이 없습니다.'));
  await act(() => {
    renderer = create(<MarkAllMailRead routineId="r" mails={mails} />);
  });
  await act(async () => button().props.onClick({ preventDefault() {}, stopPropagation() {} }));
  expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain(
    'Apple Mail 접근 권한이 없습니다.',
  );
  expect(button().children.join('')).toBe('모두 읽음 (3)');
  expect(button().props.disabled).toBe(false);
  await act(() => renderer!.update(<MarkAllMailRead routineId="r" mails={[]} />));
  expect(renderer!.toJSON()).toBeNull();
});
