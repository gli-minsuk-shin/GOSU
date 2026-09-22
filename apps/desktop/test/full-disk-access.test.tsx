import { readFileSync } from 'node:fs';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fullDiskAccessState } from '../src/main/full-disk-access';
import {
  FULL_DISK_ACCESS_DISMISSED_KEY,
  FULL_DISK_ACCESS_SETTINGS_URL,
  PERMISSIONS_HELPER_SEEN_KEY,
} from '../src/shared/full-disk-access';
import { FullDiskAccessNotice } from '../src/renderer/src/full-disk-access-notice';
import {
  PermissionsHelper,
  markPermissionsHelperSeen,
  permissionsHelperPending,
} from '../src/renderer/src/permissions-helper';

const failing = (code: string) => async () => {
  throw Object.assign(new Error(code), { code });
};
function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe('Full Disk Access', () => {
  it('judges it by listing the Mail folder, without opening anything in it', async () => {
    const list = vi.fn(async () => ['V10']);
    expect(await fullDiskAccessState({ home: '/Users/t', platform: 'darwin', list })).toBe(
      'granted',
    );
    expect(list).toHaveBeenCalledWith('/Users/t/Library/Mail');
    for (const [code, state] of [
      ['EPERM', 'missing'],
      ['EACCES', 'missing'],
      ['ENOENT', 'not-needed'],
      ['EIO', 'unknown'],
    ] as const)
      expect(
        await fullDiskAccessState({ home: '/Users/t', platform: 'darwin', list: failing(code) }),
      ).toBe(state);
    const other = vi.fn();
    expect(await fullDiskAccessState({ platform: 'linux', list: other })).toBe('not-needed');
    expect(other).not.toHaveBeenCalled();
  });

  it('opens only the fixed System Settings panes and changes no setting itself', () => {
    expect(FULL_DISK_ACCESS_SETTINGS_URL).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    );
    const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
    expect(main).toContain(
      "if (kind !== 'automation' && kind !== 'calendar' && kind !== 'full-disk')",
    );
    expect(main).toContain('handle(FULL_DISK_ACCESS_CHANNEL, () => fullDiskAccessState());');
    // One approval must survive updates: the package is signed with the same certificate and the
    // release gate compares the code signing requirement of the old and the new app.
    const continuity = readFileSync(
      new URL('../../../scripts/verify-update-continuity.mjs', import.meta.url),
      'utf8',
    );
    expect(continuity).toContain('preservedIdentity');
  });

  it('tells the user at start while it is missing, until they close the notice', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const local = storage();
    const openPrivacy = vi.fn(async () => undefined);
    vi.stubGlobal('window', { localStorage: local, gosu: { briefingLab: { openPrivacy } } });
    for (const state of ['granted', 'not-needed', 'unknown', null] as const)
      expect(
        renderToStaticMarkup(
          <FullDiskAccessNotice state={state} failure={null} onCheck={vi.fn()} />,
        ),
      ).toBe('');
    const onCheck = vi.fn();
    await act(() => {
      renderer = create(<FullDiskAccessNotice state="missing" failure={null} onCheck={onCheck} />);
    });
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain('전체 디스크 접근 권한');
    expect(text).toContain('한 번 허용하면 GOSU를 업데이트해도');
    expect(text).toContain('GOSU를 다시 시작하세요');
    const [open, check, close] = renderer!.root.findAllByType('button');
    await act(() => open!.props.onClick());
    expect(openPrivacy).toHaveBeenCalledWith('full-disk');
    await act(() => check!.props.onClick());
    expect(onCheck).toHaveBeenCalledOnce();
    await act(() => close!.props.onClick());
    expect(local.values.get(FULL_DISK_ACCESS_DISMISSED_KEY)).toBe('1');
    expect(renderer!.toJSON()).toBeNull();
    // Closed once, it stays closed at the next start.
    expect(
      renderToStaticMarkup(
        <FullDiskAccessNotice state="missing" failure={null} onCheck={vi.fn()} />,
      ),
    ).toBe('');
  });

  it('says why System Settings could not be opened', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', {
      localStorage: storage(),
      gosu: {
        briefingLab: { openPrivacy: vi.fn(async () => Promise.reject(new Error('no handler'))) },
      },
    });
    await act(() => {
      renderer = create(<FullDiskAccessNotice state="missing" failure={null} onCheck={vi.fn()} />);
    });
    await act(async () => {
      renderer!.root.findAllByType('button')[0]!.props.onClick();
      await Promise.resolve();
    });
    // The app's own wording for an unknown failure (describeError never echoes raw error text).
    expect(JSON.stringify(renderer!.toJSON())).toContain('The operation could not be completed.');
  });
});

describe('first-run permissions helper', () => {
  it('is pending once per Mac and never when storage is unavailable', () => {
    const local = storage();
    vi.stubGlobal('window', { localStorage: local });
    expect(permissionsHelperPending()).toBe(true);
    markPermissionsHelperSeen();
    expect(local.values.get(PERMISSIONS_HELPER_SEEN_KEY)).toBe('1');
    expect(permissionsHelperPending()).toBe(false);
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new Error('denied');
      },
    });
    expect(permissionsHelperPending()).toBe(false);
    expect(() => markPermissionsHelperSeen()).not.toThrow();
  });

  it('lists each permission with its purpose, its state when known, and the pane that grants it', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const openPrivacy = vi.fn(async () => undefined);
    vi.stubGlobal('window', { gosu: { briefingLab: { openPrivacy } } });
    const onCheck = vi.fn(),
      onClose = vi.fn();
    await act(() => {
      renderer = create(
        <PermissionsHelper fullDiskAccess="missing" onCheck={onCheck} onClose={onClose} />,
      );
    });
    const text = JSON.stringify(renderer!.toJSON());
    for (const expected of [
      'macOS 권한 도우미',
      '전체 디스크 접근 권한',
      '꺼져 있음',
      '자동화 · Mail 제어',
      '캘린더',
      '한 번 허용하면 GOSU를 업데이트해도 유지됩니다',
      'GOSU를 다시 시작',
    ])
      expect(text).toContain(expected);
    const rows = renderer!.root.findAllByType('li');
    expect(rows.map((row) => row.props['data-tone'])).toEqual(['todo', 'idle', 'idle']);
    const click = (row: number, label: string) =>
      act(() =>
        rows[row]!.findAllByType('button')
          .find((b) => b.props.children === label)!
          .props.onClick(),
      );
    await click(0, '시스템 설정 열기');
    await click(1, '시스템 설정 열기');
    await click(2, '시스템 설정 열기');
    expect(openPrivacy.mock.calls.map(([pane]) => pane)).toEqual([
      'full-disk',
      'automation',
      'calendar',
    ]);
    await click(0, '다시 확인');
    expect(onCheck).toHaveBeenCalledOnce();
    await act(() =>
      renderer!.root.findByProps({ 'aria-label': '권한 도우미 닫기' }).props.onClick(),
    );
    expect(onClose).toHaveBeenCalledOnce();
    // Granted: said so, and no longer highlighted.
    await act(() =>
      renderer!.update(
        <PermissionsHelper fullDiskAccess="granted" onCheck={onCheck} onClose={onClose} />,
      ),
    );
    expect(JSON.stringify(renderer!.toJSON())).toContain('허용됨');
    expect(renderer!.root.findAllByType('li')[0]!.props['data-tone']).toBe('ok');
  });

  it('opens at the first start, replaces the notice while open and is reachable from Settings', () => {
    const app = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );
    expect(app).toContain('useState(permissionsHelperPending)');
    expect(app).toContain('markPermissionsHelperSeen();');
    expect(app).toMatch(/\{permissionsHelperOpen \? \(\s+<PermissionsHelper/u);
    expect(app).toContain('setPermissionsHelperOpen(true);');
    const view = readFileSync(
      new URL('../src/renderer/src/global-briefing-view.tsx', import.meta.url),
      'utf8',
    );
    expect(view).toContain('권한 도우미');
    expect(view).toContain("openPrivacy('full-disk')");
  });
});
