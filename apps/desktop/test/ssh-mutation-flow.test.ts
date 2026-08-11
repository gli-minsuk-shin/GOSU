import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  buildSshConnectionRemovalConfirmation,
  commitSshMutationThenRefresh,
} from '../src/renderer/src/ssh-mutation-flow';

describe('SSH mutation completion', () => {
  it('does not refresh or report success when the mutation itself fails', async () => {
    const mutationError = new Error('ssh_workspace_grant_conflict');
    const mutation = vi.fn(async () => {
      throw mutationError;
    });
    const refresh = vi.fn(async () => undefined);

    const outcome = await commitSshMutationThenRefresh(mutation, refresh);

    expect(outcome).toEqual({ committed: false, mutationError });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps a committed mutation successful when only the follow-up refresh fails', async () => {
    const refreshError = new Error('ssh_unavailable');
    const mutation = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => {
      throw refreshError;
    });

    const outcome = await commitSshMutationThenRefresh(mutation, refresh);

    expect(outcome).toEqual({ committed: true, refreshError });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reports a clean commit after mutation and refresh both finish', async () => {
    const mutation = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);

    await expect(commitSshMutationThenRefresh(mutation, refresh)).resolves.toEqual({
      committed: true,
      refreshError: null,
    });
  });
});

describe('SSH server removal disclosure', () => {
  it('names and counts every linked active project and discloses cascaded grants', () => {
    const message = buildSshConnectionRemovalConfirmation('GPU server', [
      'Protein benchmark',
      'Vision study',
    ]);

    expect(message).toContain('2 active projects');
    expect(message).toContain('\u2022 Protein benchmark');
    expect(message).toContain('\u2022 Vision study');
    expect(message).toContain('revokes every GOSU project workspace grant');
    expect(message).toContain('archived or trashed projects');
    expect(message).toContain('does not change your OpenSSH config');
    expect(message).toContain('does not change your OpenSSH config or delete files on the server');
  });
});

describe('SSH server inventory layout', () => {
  it('uses the card width to stack server rows before the supported window minimum clips them', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /\.ssh-connections-card\s*\{[^}]*container-name:\s*ssh-connections;[^}]*container-type:\s*inline-size;/su,
    );
    expect(styles).toMatch(
      /@container ssh-connections \(max-width: 840px\)[\s\S]*?\.ssh-connections-card \.connection-item\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/u,
    );
  });
});
