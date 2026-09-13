import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import { MailReadStatus, resetMailReadSession } from './mail-read-status';
import { sourceRequest } from './live-client';
import { appleMailMessageUrl } from './apple-mail-url';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let ui: ReactTestRenderer;
const target = { routineId: 'r', historyId: 'h', itemId: 'm' },
  url = appleMailMessageUrl('original@example.test');
afterEach(async () => {
  await act(() => ui?.unmount());
  resetMailReadSession();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('keeps the badge/action unbroken and overrides generic detail-button padding with centered icon geometry', () => {
  const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  const control = css.match(/\.briefing-mail-state-control\s*\{[^}]*\}/)?.[0] ?? '';
  const button =
    css.match(/\.briefing-mail-mark-control\s*>\s*\.briefing-mail-mark-read\s*\{[^}]*\}/)?.[0] ??
    '';
  expect(control).toContain('flex-wrap: nowrap');
  expect(control).toContain('flex: 0 0 auto');
  expect(button).toContain('display: inline-flex');
  expect(button).toContain('justify-content: center');
  expect(button).toContain('padding: 0');
  expect(button).toContain('flex: 0 0 25px');
  expect(button).toContain('box-sizing: border-box');
  const title = css.match(/\.briefing-email-title-row\s*\{[^}]*\}/)?.[0] ?? '';
  expect(title).toContain('flex-wrap: wrap');
  const tooltip = css.match(/\.briefing-mail-mark-tooltip\s*\{[^}]*\}/)?.[0] ?? '';
  expect(tooltip).toContain('right: 0');
  expect(tooltip).not.toContain('translateX');
});
it('renders only an icon beside unread; tooltip is delayed and no operation happens on render', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await act(() => {
    ui = create(<MailReadStatus unread target={target} url={url} />);
  });
  const button = ui.root.findByType('button');
  expect(button.children.some((c) => typeof c === 'string')).toBe(false);
  expect(button.props['aria-label']).toBe('읽음으로 변환');
  expect(ui.root.findByProps({ role: 'tooltip' }).children).toEqual(['읽음으로 변환']);
  expect(sourceRequest).not.toHaveBeenCalled();
  expect(readFileSync(new URL('./workspace.css', import.meta.url), 'utf8')).toMatch(
    /transition-delay:\s*0?\.6s/,
  );
});
it('keeps unread on failure, prevents expansion/double requests and synchronizes mounted copies only after acknowledgment', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await act(() => {
    ui = create(
      <>
        <MailReadStatus unread target={target} url={url} />
        <MailReadStatus unread historical target={{ ...target, historyId: 'h2' }} url={url} />
      </>,
    );
  });
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  const click = () => ui.root.findAllByType('button')[0]!.props.onClick(event);
  vi.mocked(sourceRequest).mockRejectedValueOnce(new Error('결과를 확인하지 못했습니다.'));
  await act(async () => {
    await Promise.all([click(), click()]);
  });
  expect(sourceRequest).toHaveBeenCalledOnce();
  expect(ui.root.findAllByType('button')).toHaveLength(2);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.stopPropagation).toHaveBeenCalled();
  vi.mocked(sourceRequest).mockResolvedValueOnce({
    status: 'read',
    markedAt: '2026-09-10T00:00:00Z',
  });
  await act(async () => {
    await click();
  });
  expect(ui.root.findAllByType('button')).toHaveLength(0);
  expect(ui.root.findAllByProps({ className: 'briefing-mail-read-status is-read' })).toHaveLength(
    0,
  );
  expect(ui.root.findAllByProps({ className: 'briefing-mail-read-status is-unread' })).toHaveLength(
    0,
  );
  expect(vi.mocked(sourceRequest).mock.calls[1]?.slice(0, 2)).toEqual(['/mail/mark-read', target]);
});
it('replaces unread immediately with pending, restores it on failure and hides completed state after reload', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let reject!: (error: Error) => void;
  vi.mocked(sourceRequest).mockImplementation(
    () =>
      new Promise((_resolve, failure) => {
        reject = failure;
      }),
  );
  await act(() => {
    ui = create(<MailReadStatus unread target={target} url={url} />);
  });
  let request!: Promise<void>;
  await act(() => {
    request = ui.root
      .findByType('button')
      .props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
  });
  expect(ui.root.findAllByProps({ className: 'briefing-mail-read-status is-unread' })).toHaveLength(
    0,
  );
  expect(ui.root.findByType('button').props['aria-busy']).toBe(true);
  expect(ui.root.findByProps({ role: 'tooltip' }).children).toEqual(['읽음 처리 중…']);
  await act(async () => {
    reject(new Error('처리 실패'));
    await request;
  });
  expect(ui.root.findAllByProps({ className: 'briefing-mail-read-status is-unread' })).toHaveLength(
    1,
  );
  expect(ui.root.findByType('button').props.disabled).toBe(false);
  await act(() => {
    ui.update(
      <MailReadStatus
        unread
        historical
        target={target}
        url={url}
        markedReadAt="2026-09-10T00:00:00Z"
      />,
    );
  });
  expect(ui.root.findAllByType('button')).toHaveLength(0);
  expect(
    ui.root.findAll(
      (n) =>
        typeof n.props.className === 'string' &&
        n.props.className.includes('briefing-mail-read-status'),
    ),
  ).toHaveLength(0);
});
it('shows an uncertain state with a read-only recheck action, then clears every mounted copy on confirmation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await act(() => {
    ui = create(
      <>
        <MailReadStatus unread target={target} url={url} />
        <MailReadStatus unread target={{ ...target, historyId: 'other' }} url={url} />
      </>,
    );
  });
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  vi.mocked(sourceRequest).mockResolvedValueOnce({
    status: 'unconfirmed',
    error: '상태 확인 필요',
  });
  await act(() => ui.root.findAllByType('button')[0]!.props.onClick(event));
  expect(
    ui.root.findAllByProps({ className: 'briefing-mail-read-status is-unknown' }),
  ).toHaveLength(1);
  expect(ui.root.findAllByProps({ 'aria-label': '읽음 상태 다시 확인' })).toHaveLength(1);
  vi.mocked(sourceRequest).mockResolvedValueOnce({
    status: 'read',
    markedAt: '2026-09-10T00:00:00Z',
  });
  await act(() =>
    ui.root.findByProps({ 'aria-label': '읽음 상태 다시 확인' }).props.onClick(event),
  );
  expect(vi.mocked(sourceRequest).mock.calls.map(([path]) => path)).toEqual([
    '/mail/mark-read',
    '/mail/read-status',
  ]);
  expect(ui.root.findAllByType('button')).toHaveLength(0);
  expect(ui.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
});
it('restores the explicit mark control only when a read-only check confirms unread, without another automatic write', async () => {
  await act(() => {
    ui = create(<MailReadStatus unread target={target} url={url} />);
  });
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  vi.mocked(sourceRequest)
    .mockResolvedValueOnce({ status: 'unconfirmed' })
    .mockResolvedValueOnce({ status: 'unread' });
  await act(() => ui.root.findByType('button').props.onClick(event));
  await act(() => ui.root.findByType('button').props.onClick(event));
  expect(ui.root.findByType('button').props['aria-label']).toBe('읽음으로 변환');
  expect(sourceRequest).toHaveBeenCalledTimes(2);
  expect(ui.root.findAllByProps({ className: 'briefing-mail-read-status is-unread' })).toHaveLength(
    1,
  );
});
it('keeps confirmation for the same receipt across remounts but a new native receipt uses its observed unread state', async () => {
  const receipt = {
    routineId: 'r',
    receiptId: '11111111-1111-4111-8111-111111111111',
    itemId: 'm',
  };
  vi.mocked(sourceRequest).mockResolvedValue({ status: 'read', markedAt: '2026-09-10T00:00:00Z' });
  await act(() => {
    ui = create(<MailReadStatus unread target={receipt} url={url} />);
  });
  await act(() =>
    ui.root
      .findByType('button')
      .props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() }),
  );
  await act(() => ui.unmount());
  await act(() => {
    ui = create(<MailReadStatus unread target={receipt} url={url} />);
  });
  expect(ui.root.findAllByType('button')).toHaveLength(0);
  await act(() =>
    ui.update(
      <MailReadStatus
        unread
        target={{ ...receipt, receiptId: '22222222-2222-4222-8222-222222222222' }}
        url={url}
      />,
    ),
  );
  expect(ui.root.findAllByType('button')).toHaveLength(1);
});
