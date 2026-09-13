import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, it, expect, vi } from 'vitest';
import { BriefingMemoryPanel, type BriefingMemorySession } from './briefing-memory-panel';
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
it('unlocks, remembers user feedback, restores after remount and keeps plaintext out of persistence', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let stored: string | null = null;
  vi.stubGlobal('localStorage', {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  });
  let session: BriefingMemorySession | null = null;
  const publish = (value: BriefingMemorySession | null) => {
    session = value;
  };
  const mount = async () => {
    await act(() => {
      renderer = create(<BriefingMemoryPanel routineId="r" onSession={publish} />);
    });
    await act(() =>
      renderer!.root
        .findByProps({ 'aria-label': 'Briefing memory 암호' })
        .props.onChange({ target: { value: 'synthetic-test-password' } }),
    );
    await act(() =>
      renderer!.root
        .findAllByType('button')
        .find((b) => b.children.join('') === 'Memory 만들기 / 열기')!
        .props.onClick(),
    );
  };
  await mount();
  // The click handler starts async WebCrypto. Wait on its visible unlocked state, not a fixed sleep.
  await vi.waitFor(() => expect(session).not.toBeNull());
  await act(async () => {
    await session!.remember({
      routineId: 'r',
      kind: 'feedback',
      text: 'Prefer reproducible convergence results',
      sourceId: 'fixture',
    });
  });
  expect(stored).not.toContain('reproducible');
  expect(stored).not.toContain('synthetic-test-password');
  await act(() => renderer!.unmount());
  session = null;
  await mount();
  await vi.waitFor(() => expect(session).not.toBeNull());
  expect((session as BriefingMemorySession | null)?.memory.entries[0]!.text).toBe(
    'Prefer reproducible convergence results',
  );
});
