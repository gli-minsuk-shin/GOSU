import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { it, expect, vi } from 'vitest';
import { BackendMemoryPanel } from './backend-memory-panel';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
it('shows automatic backend persistence without a password or manual authoring prerequisite and only requests metadata on mount', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    state: 'ready',
    count: 5,
    automatic: 4,
    revision: 2,
    lastSavedAt: new Date().toISOString(),
  });
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(<BackendMemoryPanel routineId="r" refresh={0} />);
  });
  try {
    expect(JSON.stringify(renderer.toJSON())).toContain('5개 · backend 자동 저장');
    expect(
      renderer.root.findAllByType('input').filter((i) => i.props.type === 'password'),
    ).toHaveLength(0);
    expect(renderer.root.findAllByType('textarea')).toHaveLength(0);
    expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/memory/status']);
  } finally {
    await act(() => renderer.unmount());
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  }
});
