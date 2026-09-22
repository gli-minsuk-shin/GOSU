import { afterEach, expect, it, vi } from 'vitest';
import { projectChatAiScope, trackProjectAiWork } from '../src/renderer/src/sidebar-ai-activity';
afterEach(() => vi.unstubAllGlobals());
it('routes Critical Review to its own icon instead of regular Project chat', () => {
  expect(projectChatAiScope('p', { criticalReviewMode: 'direction' })).toBe('project:p:review');
  expect(projectChatAiScope('p', null)).toBe('project:p:chat');
});
it.each([false, true])(
  'reports native project-scoped AI completion only when the task succeeds (%s)',
  async (failed) => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const work = () => (failed ? Promise.reject(Error('failed')) : Promise.resolve('done'));
    if (failed) await expect(trackProjectAiWork('p', 'experiments', work)).rejects.toThrow();
    else await expect(trackProjectAiWork('p', 'experiments', work)).resolves.toBe('done');
    expect(dispatchEvent.mock.calls.map((c) => (c[0] as CustomEvent).detail.event.phase)).toEqual([
      'running',
      failed ? 'failed' : 'completed',
    ]);
    expect((dispatchEvent.mock.calls[0]![0] as CustomEvent).detail.scope).toBe(
      'project:p:experiments',
    );
  },
);
