export type SshMutationOutcome =
  | Readonly<{ committed: true; refreshError: unknown | null }>
  | Readonly<{ committed: false; mutationError: unknown }>;

export async function commitSshMutationThenRefresh(
  mutation: () => Promise<unknown>,
  refresh: () => Promise<unknown>,
): Promise<SshMutationOutcome> {
  try {
    await mutation();
  } catch (mutationError) {
    return { committed: false, mutationError };
  }

  try {
    await refresh();
    return { committed: true, refreshError: null };
  } catch (refreshError) {
    return { committed: true, refreshError };
  }
}

export function buildSshConnectionRemovalConfirmation(
  connectionLabel: string,
  linkedActiveProjectNames: readonly string[],
) {
  const activeProjectSummary =
    linkedActiveProjectNames.length === 0
      ? 'This server is not linked to an active project.'
      : `This server is linked to ${linkedActiveProjectNames.length} active project${
          linkedActiveProjectNames.length === 1 ? '' : 's'
        }:\n${linkedActiveProjectNames.map((name) => `\u2022 ${name}`).join('\n')}`;

  return [
    `Remove \u201c${connectionLabel}\u201d from GOSU?`,
    activeProjectSummary,
    'Removing it revokes every GOSU project workspace grant for this server, including grants retained by archived or trashed projects.',
    'This does not change your OpenSSH config or delete files on the server.',
  ].join('\n\n');
}
