import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { MailScope } from '@gosu/briefing-core';
import { MailConnectionSettings } from './mail-connection-settings';
import { sourceRequest } from './live-client';

vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const scope: MailScope = {
  accountId: 'a',
  mailboxId: 'box-a',
  days: 3,
  limit: 10,
  subject: '',
  sender: '',
  unreadOnly: false,
  bodyPreview: true,
};
const catalog = {
  limited: false,
  accounts: ['a', 'b', 'c'].map((id) => ({
    id,
    name: `Account ${id}`,
    unavailable: id === 'c',
    limited: false,
    mailboxes: id === 'c' ? [] : [{ id: `box-${id}`, name: 'Inbox' }],
  })),
};
const byLabel = (label: string) => renderer.root.findByProps({ 'aria-label': label });
const text = () => JSON.stringify(renderer.toJSON());
async function mount(initial: MailScope | null = scope) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockImplementation(async (path) =>
    path === '/mail/discover'
      ? catalog
      : {
          state: 'configured',
          expiresAt: null,
          approved: true,
          mailRead: true,
          mailAi: false,
        },
  );
  function Harness() {
    const [value, setValue] = useState<MailScope | null>(initial);
    return (
      <>
        <MailConnectionSettings routineId="r" managedBySettings value={value} onChange={setValue} />
        <output>{JSON.stringify(value)}</output>
      </>
    );
  }
  await act(() => {
    renderer = create(<Harness />);
  });
}
it('lists selected accounts, adds a second without replacing the first, and removes only the chosen connection', async () => {
  await mount();
  expect(text()).toContain('연결할 계정 1개');
  expect(sourceRequest).toHaveBeenCalledTimes(1);
  expect(sourceRequest).toHaveBeenCalledWith('/mail/status', expect.anything(), expect.anything());
  await act(() => byLabel('계정 추가').props.onClick());
  expect(text()).toContain('Account a');
  expect(text()).toContain('메일함 조회 실패');
  await act(() =>
    byLabel('Account b 추가할 메일함').props.onChange({ target: { value: 'box-b' } }),
  );
  await act(() => byLabel('Account b 연결 추가').props.onClick());
  expect(JSON.parse(renderer.root.findByType('output').children.join(''))).toMatchObject({
    accountId: 'a',
    additionalAccounts: [{ accountId: 'b', mailboxId: 'box-b' }],
  });
  await act(() => byLabel('Account a 연결 삭제').props.onClick());
  expect(JSON.parse(renderer.root.findByType('output').children.join(''))).toMatchObject({
    accountId: 'b',
    mailboxId: 'box-b',
  });
  await act(() => byLabel('Account b 연결 삭제').props.onClick());
  expect(renderer.root.findByType('output').children.join('')).toBe('null');
  expect(text()).toContain('연결한 계정이 없습니다');
  expect(
    vi
      .mocked(sourceRequest)
      .mock.calls.every(([path]) => ['/mail/status', '/mail/discover'].includes(path)),
  ).toBe(true);
});
it('uses fifty for a new connection, explains the three-message introduction, and preserves saved custom limits', async () => {
  await mount(null);
  await act(() => byLabel('계정 추가').props.onClick());
  await act(() =>
    byLabel('Account a 추가할 메일함').props.onChange({ target: { value: 'box-a' } }),
  );
  await act(() => byLabel('Account a 연결 추가').props.onClick());
  expect(JSON.parse(renderer.root.findByType('output').children.join('')).limit).toBe(50);
  expect(text()).toContain('전체 최대 3개');
  await act(() => renderer.unmount());
  await mount();
  expect(JSON.parse(renderer.root.findByType('output').children.join('')).limit).toBe(10);
  const reset = renderer.root
    .findAllByType('button')
    .find((b) => b.children.join('') === '기본값 50개로 변경')!;
  await act(() => reset.props.onClick());
  expect(JSON.parse(renderer.root.findByType('output').children.join('')).limit).toBe(50);
});
it('does not call a stale saved scope connected, and retains missing accounts for explicit removal', async () => {
  await mount();
  vi.mocked(sourceRequest).mockResolvedValueOnce({ ...catalog, accounts: [] });
  await act(() => byLabel('계정 추가').props.onClick());
  expect(text()).toContain('목록에서 찾을 수 없음');
  expect(text()).not.toContain('읽기 권한 활성');
  expect(renderer.root.findByType('output').children.join('')).toContain('box-a');
});
it('expires active grants on time and distinguishes read-off from saved configuration', async () => {
  vi.useFakeTimers();
  await mount();
  vi.mocked(sourceRequest).mockResolvedValue({
    state: 'connected',
    approved: true,
    mailRead: true,
    expiresAt: new Date(Date.now() + 31_000).toISOString(),
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(text()).toContain('읽기 권한 활성');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_001);
  });
  expect(text()).not.toContain('읽기 권한 활성');
  vi.mocked(sourceRequest).mockResolvedValue({
    state: 'disconnected',
    approved: false,
    mailRead: false,
    expiresAt: null,
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(text()).toContain('읽기 꺼짐');
});
it('keeps the last catalog on failed refresh, never auto-selects a mailbox, and ignores cancelled discovery', async () => {
  await mount();
  await act(() => byLabel('계정 추가').props.onClick());
  expect(byLabel('Account b 연결 추가').props.disabled).toBe(true);
  vi.mocked(sourceRequest).mockRejectedValueOnce(Error('Synthetic discovery failure'));
  await act(() => byLabel('계정 목록 새로고침').props.onClick());
  expect(text()).toContain('기존 연결은 유지됩니다');
  expect(text()).toContain('Account a');
  let resolve!: (value: unknown) => void;
  vi.mocked(sourceRequest).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(() => byLabel('계정 목록 새로고침').props.onClick());
  const cancel = renderer.root.findAllByType('button').find((b) => b.children.join('') === '취소')!;
  await act(() => cancel.props.onClick());
  await act(() => resolve({ limited: false, accounts: [] }));
  expect(text()).toContain('Account a');
});
