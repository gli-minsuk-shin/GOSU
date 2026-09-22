import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FullDiskAccessState } from '../shared/full-disk-access';

/**
 * Lists ~/Library/Mail, the folder the fast mail read needs. Without Full Disk Access macOS refuses
 * silently (EPERM, no dialog); nothing in the folder is opened. A Mac where Mail was never used has
 * no such folder and needs no permission.
 */
export async function fullDiskAccessState(
  options: {
    home?: string;
    platform?: NodeJS.Platform;
    list?: (path: string) => Promise<unknown>;
  } = {},
): Promise<FullDiskAccessState> {
  if ((options.platform ?? process.platform) !== 'darwin') return 'not-needed';
  try {
    await (options.list ?? readdir)(join(options.home ?? homedir(), 'Library', 'Mail'));
    return 'granted';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return 'not-needed';
    return code === 'EPERM' || code === 'EACCES' ? 'missing' : 'unknown';
  }
}
