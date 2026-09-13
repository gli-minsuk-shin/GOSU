import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
import { mountBriefingRoot } from './root-mount';

const create = vi.hoisted(() => vi.fn());
vi.mock('react-dom/client', () => ({ createRoot: create }));
describe('Briefing entry hot reload', () => {
  beforeEach(() => create.mockReset());
  it('reuses one root when Vite re-evaluates the entry module', () => {
    const root = { render: vi.fn(), unmount: vi.fn() } as Root;
    create.mockReturnValue(root);
    const hotData = {};
    const container = {} as HTMLElement;
    mountBriefingRoot(container, 'first render', hotData);
    mountBriefingRoot(container, 'updated render', hotData);
    expect(create).toHaveBeenCalledExactlyOnceWith(container);
    expect(root.render).toHaveBeenNthCalledWith(1, 'first render');
    expect(root.render).toHaveBeenNthCalledWith(2, 'updated render');
  });
  it('creates a root normally without a development hot context', () => {
    const root = { render: vi.fn(), unmount: vi.fn() } as Root;
    create.mockReturnValue(root);
    const container = {} as HTMLElement;
    expect(mountBriefingRoot(container, 'production')).toBe(root);
    expect(create).toHaveBeenCalledExactlyOnceWith(container);
    expect(root.render).toHaveBeenCalledWith('production');
  });
});
