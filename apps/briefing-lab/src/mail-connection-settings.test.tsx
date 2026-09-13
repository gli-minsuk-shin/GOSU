import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, it, expect, vi } from 'vitest';
import type { MailScope } from '@gosu/briefing-core';
import { MailConnectionSettings } from './mail-connection-settings';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
const now = Date.parse('2026-09-09T00:00:00Z');
const scope: MailScope = {
  accountId: 'a',
  mailboxId: 'inbox-a',
  days: 3,
  limit: 10,
  subject: '',
  sender: '',
  unreadOnly: false,
  bodyPreview: false,
};
const catalog = {
  accounts: [
    {
      id: 'a',
      name: 'Research',
      mailboxes: [
        { id: 'inbox-a', name: 'INBOX' },
        { id: 'scholar-a', name: 'Scholar' },
      ],
      limited: false,
      unavailable: false,
    },
    {
      id: 'b',
      name: 'Other account',
      mailboxes: [{ id: 'inbox-b', name: 'Other inbox' }],
      limited: false,
      unavailable: false,
    },
  ],
  limited: false,
};
const field = (name: string) =>
  renderer!.root
    .findAllByType('label')
    .find((l) => l.findAllByType('span')[0]?.children.join('') === name)!;
const button = (name: string) =>
  renderer!.root.findAllByType('button').find((b) => b.children.join('') === name)!;
const phase = () =>
  renderer!.root.findByProps({ 'aria-live': 'polite' }).props['data-connection-state'];
const text = () => JSON.stringify(renderer!.toJSON());
async function mount(initial: MailScope | null = null) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  function Harness() {
    const [value, setValue] = useState(initial);
    return <MailConnectionSettings routineId="r" value={value} onChange={setValue} />;
  }
  await act(() => {
    renderer = create(<Harness />);
  });
}
it('loads both account mailboxes once, switches from cache, and never auto-reads or auto-authorizes', async () => {
  vi.mocked(sourceRequest).mockResolvedValue(catalog);
  await mount();
  expect(sourceRequest).not.toHaveBeenCalled();
  await act(() => button('Apple Mail 계정·메일함 불러오기').props.onClick());
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/mail/discover']);
  expect(button('메일함 불러오기')).toBeUndefined();
  expect(phase()).toBe('prepared');
  await act(() =>
    field('메일 계정')
      .findByType('select')
      .props.onChange({ target: { value: 'a' } }),
  );
  expect(
    field('메일함')
      .findAllByType('option')
      .map((o) => o.children.join('')),
  ).toContain('Scholar');
  await act(() =>
    field('메일함')
      .findByType('select')
      .props.onChange({ target: { value: 'scholar-a' } }),
  );
  await act(() =>
    field('메일 계정')
      .findByType('select')
      .props.onChange({ target: { value: 'b' } }),
  );
  expect(field('메일함').findByType('select').props.value).toBe('');
  expect(
    field('메일함')
      .findAllByType('option')
      .map((o) => o.children.join('')),
  ).toContain('Other inbox');
  expect(sourceRequest).toHaveBeenCalledOnce();
  expect(button('이 조건으로 메일 읽기 연결').props.disabled).toBe(true);
});
it('shows a prominent verified connection with scope/expiry, then removes it when filters change', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const receipt = {
    state: 'connected',
    expiresAt: new Date(now + 1800000).toISOString(),
    accountName: 'Research',
    mailboxName: 'INBOX',
  };
  vi.mocked(sourceRequest).mockImplementation(async (path) =>
    path === '/mail/discover' ? catalog : receipt,
  );
  await mount();
  await act(() => button('Apple Mail 계정·메일함 불러오기').props.onClick());
  await act(() =>
    field('메일 계정')
      .findByType('select')
      .props.onChange({ target: { value: 'a' } }),
  );
  await act(() =>
    field('메일함')
      .findByType('select')
      .props.onChange({ target: { value: 'inbox-a' } }),
  );
  const consent = renderer!.root
    .findByProps({ className: 'briefing-mail-consent' })
    .findByType('input');
  await act(() => consent.props.onChange({ target: { checked: true } }));
  await act(() => button('이 조건으로 메일 읽기 연결').props.onClick());
  expect(phase()).toBe('connected');
  expect(text()).toContain('메일 읽기 연결됨');
  expect(text()).toContain('✓ 읽기 권한 활성');
  expect(text()).toContain('Research');
  expect(text()).toContain('INBOX');
  expect(text()).toContain('유효 시각');
  await act(() =>
    field('메일 검색 기간 (최근 일수)')
      .findByType('input')
      .props.onChange({ target: { value: '7' } }),
  );
  expect(phase()).not.toBe('connected');
  expect(button('이 조건으로 메일 읽기 연결').props.disabled).toBe(true);
});
it('revalidates saved settings without enumerating Mail and never treats saved config as an active grant', async () => {
  vi.mocked(sourceRequest).mockResolvedValue({ state: 'disconnected', expiresAt: null });
  await mount(scope);
  expect(phase()).toBe('disconnected');
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/mail/status']);
});
it('shows saved scope separately from an active short-lived Mail grant', async () => {
  vi.mocked(sourceRequest).mockResolvedValue({
    state: 'configured',
    expiresAt: null,
    mailRead: true,
    mailAi: true,
    approved: true,
  });
  await mount(scope);
  expect(phase()).toBe('configured');
  expect(text()).toContain('메일 설정 저장됨');
  expect(text()).toContain('AI 전송');
  expect(text()).toContain('허용');
});
it('expires the connected card at its deadline, not only after the next server poll', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.mocked(sourceRequest).mockResolvedValue({
    state: 'connected',
    expiresAt: new Date(now + 1000).toISOString(),
    accountName: 'Research',
    mailboxName: 'INBOX',
  });
  await mount(scope);
  expect(phase()).toBe('connected');
  await act(() => {
    vi.advanceTimersByTime(1001);
  });
  expect(phase()).toBe('expired');
});
it('does not adopt discovery results that arrive after cancellation', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(sourceRequest).mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  await mount();
  await act(() => button('Apple Mail 계정·메일함 불러오기').props.onClick());
  expect(phase()).toBe('loading');
  await act(() => button('메일 요청 중단').props.onClick());
  await act(() => finish(catalog));
  expect(phase()).toBe('idle');
  expect(field('메일 계정').findByType('select').props.disabled).toBe(true);
});
it('removes the green state after disconnection and after a failed server-status check', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.mocked(sourceRequest).mockResolvedValue({
    state: 'connected',
    expiresAt: new Date(now + 1800000).toISOString(),
    accountName: 'Research',
    mailboxName: 'INBOX',
  });
  await mount(scope);
  expect(phase()).toBe('connected');
  vi.mocked(sourceRequest).mockRejectedValueOnce(new Error('server offline'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(phase()).toBe('unknown');
  vi.mocked(sourceRequest).mockResolvedValueOnce({ revoked: true });
  await act(() => button('메일 연결 해제').props.onClick());
  expect(phase()).toBe('disconnected');
  const count = vi.mocked(sourceRequest).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(vi.mocked(sourceRequest).mock.calls).toHaveLength(count);
});
it('does not call an empty catalog ready and exposes a per-account mailbox failure', async () => {
  vi.mocked(sourceRequest).mockResolvedValueOnce({ accounts: [], limited: false });
  await mount();
  await act(() => button('Apple Mail 계정·메일함 불러오기').props.onClick());
  expect(phase()).not.toBe('prepared');
  expect(text()).toContain('등록된 계정이 없습니다');
  vi.mocked(sourceRequest).mockResolvedValueOnce({
    ...catalog,
    accounts: [{ ...catalog.accounts[0]!, mailboxes: [], unavailable: true }],
  });
  await act(() => button('계정·메일함 새로고침').props.onClick());
  await act(() =>
    field('메일 계정')
      .findByType('select')
      .props.onChange({ target: { value: 'a' } }),
  );
  expect(text()).toContain('메일함 목록을 읽지 못했습니다');
  expect(field('메일함').findByType('select').props.disabled).toBe(true);
});
