import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setUiLanguage } from '@gosu/ui/language';
import { NotificationCenter } from '../src/renderer/src/notification-center';
import {
  emptyNotificationInbox,
  markNotifications,
  type WorkspaceNotification,
} from '../src/renderer/src/workspace-notifications';

const items: WorkspaceNotification[] = [
  {
    id: 'deadline:one',
    kind: 'deadline',
    title: 'Important model evaluation',
    detail: '',
    projectName: 'Research',
    severity: 'warning',
    phase: 'today',
    daysUntilDue: 0,
    dueDate: '2026-09-08',
    target: { kind: 'task', projectId: 'p', taskId: 't', dueDate: '2026-09-08' },
  },
  {
    id: 'issue:two',
    kind: 'issue',
    title: 'Server connection needs attention',
    detail: 'Please check the connection.',
    severity: 'error',
    target: { kind: 'connections' },
  },
];
const panel = { style: {}, showPopover: vi.fn(), hidePopover: vi.fn() };
const bell = { getBoundingClientRect: () => ({ left: 100, bottom: 70 }), focus: vi.fn() };
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.clearAllMocks();
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  setUiLanguage('en');
});
function mount(
  options: {
    empty?: boolean;
    suppressed?: boolean;
    loading?: boolean;
    storageError?: boolean;
  } = {},
) {
  const open = vi.fn();
  function Harness() {
    const [inbox, setInbox] = useState(emptyNotificationInbox);
    return (
      <NotificationCenter
        items={options.empty ? [] : items}
        inbox={inbox}
        onOpen={open}
        onMark={(ids, action) =>
          setInbox((current) => markNotifications(current, ids, action, '2026-09-08T00:00:00.000Z'))
        }
        {...options}
      />
    );
  }
  act(() => {
    renderer = create(<Harness />, {
      createNodeMock: (element) =>
        element.type === 'div' && element.props.popover
          ? panel
          : element.type === 'button' && element.props['aria-haspopup']
            ? bell
            : null,
    });
  });
  return { open };
}
const buttons = () => renderer!.root.findAllByType('button');
const text = (value: unknown): string =>
  Array.isArray(value)
    ? value.map(text).join('')
    : typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : value && typeof value === 'object' && 'props' in value
        ? text((value as { props: { children?: unknown } }).props.children)
        : '';
const clickText = (name: string) =>
  act(() =>
    buttons()
      .find((button) => text(button.props.children) === name)!
      .props.onClick(),
  );
describe('Notification bell and inbox controls', () => {
  it('shows briefing email/priority counts and opens its existing record without modifying mail', () => {
    setUiLanguage('ko');
    const onOpen = vi.fn(),
      onMark = vi.fn();
    const notice: WorkspaceNotification = {
      id: 'briefing:fixture',
      kind: 'briefing',
      title: 'New briefing ready',
      detail: '',
      severity: 'warning',
      createdAt: '2026-09-14T00:00:00Z',
      target: { kind: 'briefing', routineId: 'r', runId: 'run' },
      emailCounts: { total: 5, important: 2, unclassified: 1, partial: true },
    };
    act(() => {
      renderer = create(
        <NotificationCenter
          items={[notice]}
          inbox={emptyNotificationInbox()}
          onOpen={onOpen}
          onMark={onMark}
        />,
        {
          createNodeMock: (element) =>
            element.type === 'div' && element.props.popover
              ? panel
              : element.type === 'button' && element.props['aria-haspopup']
                ? bell
                : null,
        },
      );
    });
    act(() =>
      buttons()
        .find((b) => b.props['aria-haspopup'])!
        .props.onClick(),
    );
    expect(JSON.stringify(renderer!.toJSON())).toContain('새로 확인한 이메일 5개 · 그중 중요 2개');
    expect(JSON.stringify(renderer!.toJSON())).toContain('중요도 미확인 1개');
    act(() => renderer!.root.findByProps({ className: 'notification-open-item' }).props.onClick());
    expect(onOpen).toHaveBeenCalledWith(notice);
    expect(onMark).toHaveBeenCalledWith(['briefing:fixture'], 'read');
    act(() =>
      renderer!.update(
        <NotificationCenter
          items={[
            {
              ...notice,
              emailCounts: {
                total: 0,
                important: 0,
                unclassified: 0,
                partial: true,
                state: 'failed',
              },
            },
          ]}
          inbox={emptyNotificationInbox()}
          onOpen={onOpen}
          onMark={onMark}
        />,
      ),
    );
    expect(JSON.stringify(renderer!.toJSON())).toContain('이메일 조회 실패');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('이메일 0개');
  });
  it('keeps the small numeric badge legible in light and dark themes', () => {
    const css = readFileSync(
      new URL('../src/renderer/src/notification-center.css', import.meta.url),
      'utf8',
    );
    expect(css).toMatch(
      /\.notification-count\s*\{[^}]*background:\s*#b3353c;[^}]*color:\s*white;/s,
    );
    const linear = (value: number) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * linear(0xb3) + 0.7152 * linear(0x35) + 0.0722 * linear(0x3c);
    expect(1.05 / (luminance + 0.05)).toBeGreaterThan(4.5);
  });
  it('refreshes deadline time when opened and uses singular overdue copy', () => {
    const refresh = vi.fn();
    act(() => {
      renderer = create(
        <NotificationCenter
          items={[{ ...items[0]!, phase: 'overdue', daysUntilDue: -1 }]}
          inbox={emptyNotificationInbox()}
          onMark={vi.fn()}
          onOpen={vi.fn()}
          onRefresh={refresh}
        />,
        {
          createNodeMock: (element) =>
            element.type === 'div' && element.props.popover
              ? panel
              : element.type === 'button' && element.props['aria-haspopup']
                ? bell
                : null,
        },
      );
    });
    act(() =>
      buttons()
        .find((button) => button.props['aria-haspopup'])!
        .props.onClick(),
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer!.toJSON())).toContain('1 day overdue');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('1 days overdue');
  });
  it('shows unread count, opens a popover and marks all read without resolving sources', () => {
    mount();
    const button = buttons().find((button) => button.props['aria-haspopup'])!;
    expect(button.props['aria-label']).toBe('Notifications, 2 unread');
    act(() => button.props.onClick());
    expect(panel.showPopover).toHaveBeenCalledOnce();
    expect(button.props['aria-expanded']).toBe(true);
    clickText('Mark all as read');
    expect(button.props['aria-label']).toBe('Notifications, 0 unread');
    expect(renderer!.root.findAllByProps({ className: 'notification-count' })).toHaveLength(0);
    expect(items).toHaveLength(2);
    clickText('All');
    expect(renderer!.root.findAllByType('li')).toHaveLength(2);
    act(() =>
      buttons()
        .find((button) => text(button.props.children) === 'Mark unread')!
        .props.onClick(),
    );
    expect(button.props['aria-label']).toBe('Notifications, 1 unread');
  });
  it('opens the exact original item and only marks its notification read', () => {
    const { open } = mount();
    act(() =>
      buttons()
        .find(
          (button) =>
            button.props['aria-label'] === 'Open notification: Important model evaluation',
        )!
        .props.onClick(),
    );
    expect(open).toHaveBeenCalledExactlyOnceWith(items[0]);
    expect(buttons().find((button) => button.props['aria-haspopup'])!.props['aria-label']).toBe(
      'Notifications, 1 unread',
    );
    expect(panel.hidePopover).toHaveBeenCalled();
    expect(items[0]?.dueDate).toBe('2026-09-08');
  });
  it('hides and restores individual notifications without deleting a task', () => {
    mount();
    act(() =>
      buttons()
        .find(
          (button) =>
            button.props['aria-label'] === 'Hide notification: Important model evaluation',
        )!
        .props.onClick(),
    );
    expect(renderer!.root.findAllByType('li')).toHaveLength(1);
    clickText('Restore 1 hidden notifications');
    expect(renderer!.root.findAllByType('li')).toHaveLength(2);
  });
  it('closes on Escape, restores focus, and closes when an approval blocks the background', () => {
    mount();
    act(() =>
      buttons()
        .find((button) => button.props['aria-haspopup'])!
        .props.onClick(),
    );
    const preventDefault = vi.fn();
    act(() =>
      renderer!.root
        .findByProps({ role: 'dialog' })
        .props.onKeyDown({ key: 'Escape', preventDefault }),
    );
    expect(preventDefault).toHaveBeenCalled();
    expect(bell.focus).toHaveBeenCalled();
    act(() =>
      renderer!.update(
        <NotificationCenter
          items={items}
          inbox={emptyNotificationInbox()}
          onMark={vi.fn()}
          onOpen={vi.fn()}
          suppressed
        />,
      ),
    );
    expect(buttons().find((button) => button.props['aria-haspopup'])!.props.disabled).toBe(true);
    expect(panel.hidePopover).toHaveBeenCalled();
  });
  it('distinguishes loading from no unread items and shows persistence errors', () => {
    mount({ empty: true, loading: true, storageError: true });
    const output = JSON.stringify(renderer!.toJSON());
    expect(output).toContain('Checking task deadlines');
    expect(output).not.toContain('You are all caught up');
    expect(output).toContain('could not be saved');
  });
  it('supports Korean labels while keeping user-authored task titles literal', () => {
    setUiLanguage('ko');
    mount();
    expect(buttons().find((button) => button.props['aria-haspopup'])!.props['aria-label']).toBe(
      '알림, 미확인 2개',
    );
    expect(JSON.stringify(renderer!.toJSON())).toContain('Important model evaluation');
    expect(JSON.stringify(renderer!.toJSON())).toContain('오늘 마감');
  });
});
