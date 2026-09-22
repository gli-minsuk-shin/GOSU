import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BriefingHistoryItem } from './briefing-history-view';
import { resetMailReadSession } from './mail-read-status';
import { sourceRequest } from './live-client';
import type { BriefingHistory } from '../briefing-workspace-store';

vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let ui: ReactTestRenderer;
afterEach(() => {
  act(() => ui?.unmount());
  vi.mocked(sourceRequest).mockReset();
  resetMailReadSession();
});
const mailMessageUrl = 'message://%3Coriginal%40example.test%3E';
const target = { routineId: 'r', historyId: 'h', itemId: 'm' };
const email = (value: Partial<BriefingHistory['items'][number]> = {}) => ({
  id: 'm',
  kind: 'email' as const,
  title: 'Committee schedule',
  summary: 'Please pick a slot.',
  readScope: 'mail-preview',
  importance: 'high',
  relevance: '',
  mailMessageUrl,
  mailUnread: true,
  ...value,
});
async function mount(item: ReturnType<typeof email>, onFeedback = vi.fn(async () => undefined)) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await act(async () => {
    ui = create(
      <BriefingHistoryItem item={item} mailOpenTarget={target} onFeedback={onFeedback} />,
    );
  });
  return onFeedback;
}
const press = (label: string) =>
  act(async () =>
    ui.root
      .findByProps({ 'aria-label': label })
      .props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() }),
  );
const markCalls = () =>
  vi.mocked(sourceRequest).mock.calls.filter((call) => call[0] === '/mail/mark-read');
const text = () => JSON.stringify(ui.toJSON());

it('marks an unread email read in Apple Mail when the user rates it, once', async () => {
  vi.mocked(sourceRequest).mockResolvedValue({
    status: 'read',
    markedAt: '2026-09-19T04:00:00.000Z',
  });
  const onFeedback = await mount(email());
  expect(text()).toContain('읽지 않음');
  await press('관심 있음');
  expect(onFeedback).toHaveBeenCalledWith('important');
  // The existing single-message path: same target, same server checks and confirmation policy.
  expect(markCalls()).toEqual([['/mail/mark-read', target]]);
  expect(text()).toContain('읽음 처리를 완료했습니다');
  expect(text()).not.toContain('읽지 않음');
  // Changing the choice afterwards does not touch Apple Mail again.
  await press('관심 없음');
  expect(onFeedback).toHaveBeenLastCalledWith('not-interested');
  expect(markCalls()).toHaveLength(1);
});

it('leaves read, already marked and unselected emails alone', async () => {
  vi.mocked(sourceRequest).mockResolvedValue({ status: 'read', markedAt: '2026-09-19T04:00:00Z' });
  await mount(email({ mailUnread: false }));
  await press('관심 있음');
  act(() => ui.unmount());
  await mount(email({ mailMarkedReadAt: '2026-09-18T01:00:00Z' }));
  await press('관심 없음');
  act(() => ui.unmount());
  // Pressing the saved choice again only clears it.
  const onFeedback = vi.fn(async () => undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await act(async () => {
    ui = create(
      <BriefingHistoryItem
        item={email()}
        mailOpenTarget={target}
        feedbackChoice="important"
        onFeedback={onFeedback}
      />,
    );
  });
  await press('관심 있음');
  expect(onFeedback).toHaveBeenCalledWith(null);
  expect(markCalls()).toEqual([]);
});

it('shows why Apple Mail could not be updated, and keeps the rating', async () => {
  vi.mocked(sourceRequest).mockRejectedValue(
    new Error('Apple Mail에서 메일을 찾지 못했습니다. 원본 메일을 확인해주세요.'),
  );
  const onFeedback = await mount(email());
  await press('관심 있음');
  expect(onFeedback).toHaveBeenCalledWith('important');
  expect(
    ui.root
      .findAllByProps({ role: 'alert' })
      .map((node) => node.children.join(''))
      .join(' '),
  ).toContain('메일을 찾지 못했습니다');
  expect(text()).toContain('읽지 않음');
  // An unconfirmed write is reported as uncertain, like the manual button.
  act(() => ui.unmount());
  resetMailReadSession();
  vi.mocked(sourceRequest).mockReset().mockResolvedValue({
    status: 'unconfirmed',
    error: '읽음 적용 여부를 확인하지 못했습니다.',
  });
  await mount(email());
  await press('관심 없음');
  expect(text()).toContain('확인 필요');
  expect(text()).toContain('읽음 적용 여부를 확인하지 못했습니다.');
});

it('marks an unread email read after it is opened in Apple Mail, and not when opening failed', async () => {
  vi.mocked(sourceRequest).mockImplementation(async (path: string) =>
    path === '/mail/open'
      ? { status: 'requested' }
      : { status: 'read', markedAt: '2026-09-19T12:00:00.000Z' },
  );
  await mount(email());
  await press('Apple Mail에서 원본 메일 열기');
  expect(vi.mocked(sourceRequest).mock.calls.map((call) => call[0])).toEqual([
    '/mail/open',
    '/mail/mark-read',
  ]);
  expect(markCalls()).toEqual([['/mail/mark-read', target]]);
  expect(text()).toContain('읽음 처리를 완료했습니다');
  // Opening it again does not write again.
  await press('Apple Mail에서 원본 메일 열기');
  expect(markCalls()).toHaveLength(1);
  act(() => ui.unmount());
  resetMailReadSession();
  vi.mocked(sourceRequest)
    .mockReset()
    .mockRejectedValue(new Error('Apple Mail을 열지 못했습니다.'));
  await mount(email());
  await press('Apple Mail에서 원본 메일 열기');
  expect(markCalls()).toEqual([]);
  expect(text()).toContain('읽지 않음');
  act(() => ui.unmount());
  // An email already read is only opened.
  vi.mocked(sourceRequest).mockReset().mockResolvedValue({ status: 'requested' });
  await mount(email({ mailUnread: false }));
  await press('Apple Mail에서 원본 메일 열기');
  expect(markCalls()).toEqual([]);
});
