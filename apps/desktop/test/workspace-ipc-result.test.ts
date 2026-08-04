import { describe, expect, it } from 'vitest';

import { unwrapWorkspaceIpcResult } from '../src/shared/workspace-ipc-result';

describe('workspace IPC result', () => {
  it('unwraps successful values', () => {
    expect(unwrapWorkspaceIpcResult({ ok: true, value: { revision: 3 } })).toEqual({
      revision: 3,
    });
  });

  it('creates bounded renderer errors without a Main-process rejection', () => {
    expect(() =>
      unwrapWorkspaceIpcResult({
        ok: false,
        error: { code: 'version_conflict', currentVersion: 4 },
      }),
    ).toThrow('version_conflict:4');
  });

  it('preserves bounded project Archive and Trash state errors for renderer handling', () => {
    expect(() =>
      unwrapWorkspaceIpcResult({ ok: false, error: { code: 'project_archived' } }),
    ).toThrow('project_archived');
    expect(() =>
      unwrapWorkspaceIpcResult({ ok: false, error: { code: 'project_not_archived' } }),
    ).toThrow('project_not_archived');
    expect(() =>
      unwrapWorkspaceIpcResult({ ok: false, error: { code: 'project_trashed' } }),
    ).toThrow('project_trashed');
    expect(() =>
      unwrapWorkspaceIpcResult({ ok: false, error: { code: 'project_not_trashed' } }),
    ).toThrow('project_not_trashed');
    expect(() => unwrapWorkspaceIpcResult({ ok: false, error: { code: 'chat_busy' } })).toThrow(
      'chat_busy',
    );
  });

  it('maps malformed or unknown responses to workspace unavailable', () => {
    expect(() =>
      unwrapWorkspaceIpcResult({ ok: false, error: { code: '/private/research/path' } }),
    ).toThrow('workspace_unavailable');
    expect(() => unwrapWorkspaceIpcResult(null)).toThrow('workspace_unavailable');
  });
});
