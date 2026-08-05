import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

const MARKER_FILE = '.gosu-project.json';
const MAX_MARKER_BYTES = 16_384;
const MAX_MANAGED_MARKDOWN_BYTES = 8 * 1_024 * 1_024;

export type ResearchNotesOwnership = Readonly<{
  schemaVersion: 1;
  projectId: string;
  bindingId: string;
  vaultId: string;
  projectName: string;
}>;

function assertInside(root: string, target: string) {
  const path = relative(root, target);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`)) {
    throw new Error('research_notes_path_escape');
  }
  return path;
}

function pathSegments(path: string) {
  if (path.includes('\0')) throw new Error('research_notes_path_escape');
  const segments = path.split(/[\\/]/u);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('research_notes_path_escape');
  }
  return segments;
}

async function ensureDirectory(root: string, relativePath: string) {
  let current = root;
  for (const segment of pathSegments(relativePath)) {
    const next = resolve(current, segment);
    assertInside(root, next);
    try {
      const metadata = await lstat(next);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error('research_notes_folder_conflict');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try {
        await mkdir(next, { mode: 0o700 });
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
      }
      const metadata = await lstat(next);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error('research_notes_folder_conflict', { cause: error });
      }
    }
    current = next;
  }
  return current;
}

async function existingKind(path: string) {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) return 'symlink' as const;
    if (metadata.isDirectory()) return 'directory' as const;
    if (metadata.isFile()) return 'file' as const;
    return 'other' as const;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing' as const;
    throw error;
  }
}

async function writeExclusive(path: string, content: string) {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAtomic(path: string, content: string) {
  const parent = dirname(path);
  const temporary = resolve(parent, `.gosu-write-${randomUUID()}.tmp`);
  await writeExclusive(temporary, content);
  try {
    const kind = await existingKind(path);
    if (kind === 'directory' || kind === 'symlink' || kind === 'other') {
      throw new Error('research_notes_folder_conflict');
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function parseMarker(value: string): ResearchNotesOwnership | null {
  try {
    const parsed = JSON.parse(value) as Partial<ResearchNotesOwnership>;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.projectId !== 'string' ||
      typeof parsed.bindingId !== 'string' ||
      typeof parsed.vaultId !== 'string' ||
      typeof parsed.projectName !== 'string'
    ) {
      return null;
    }
    return parsed as ResearchNotesOwnership;
  } catch {
    return null;
  }
}

export function safeResearchNotesFolderName(name: string) {
  const normalized = name
    .normalize('NFKC')
    .replace(/[\p{Cc}/\\:]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[. ]+|[. ]+$/gu, '')
    .trim();
  const fallback = normalized || 'Untitled Project';
  let result = '';
  for (const character of fallback) {
    if (Buffer.byteLength(result + character, 'utf8') > 160) break;
    result += character;
  }
  return result || 'Untitled Project';
}

export class ResearchNotesManagedFiles {
  constructor(private readonly vaultRoot: string) {}

  async validateRoot() {
    const canonical = await realpath(this.vaultRoot);
    if (canonical !== this.vaultRoot) throw new Error('research_notes_vault_changed');
  }

  projectRelativeRoot(folderName: string) {
    return `GOSU/${folderName}`;
  }

  async folderKind(folderName: string) {
    return existingKind(resolve(this.vaultRoot, this.projectRelativeRoot(folderName)));
  }

  async readOwnership(folderName: string) {
    const projectRoot = await this.requireProjectRoot(folderName);
    const marker = resolve(projectRoot, MARKER_FILE);
    if ((await existingKind(marker)) !== 'file') return null;
    const bytes = await readFile(marker);
    if (bytes.length > MAX_MARKER_BYTES) return null;
    return parseMarker(bytes.toString('utf8'));
  }

  async createProjectWorkspace(
    folderName: string,
    ownership: ResearchNotesOwnership,
    folders: readonly string[],
    templates: Readonly<Record<string, string>>,
  ) {
    await this.validateRoot();
    const relativeRoot = this.projectRelativeRoot(folderName);
    const projectRoot = await ensureDirectory(this.vaultRoot, relativeRoot);
    const markerPath = resolve(projectRoot, MARKER_FILE);
    const markerKind = await existingKind(markerPath);
    if (markerKind === 'missing') {
      await writeExclusive(markerPath, `${JSON.stringify(ownership, null, 2)}\n`);
    } else {
      const current = await this.readOwnership(folderName);
      if (!current || !sameOwnership(current, ownership)) {
        throw new Error('research_notes_folder_conflict');
      }
    }
    for (const folder of folders) await ensureDirectory(projectRoot, folder);
    for (const [path, content] of Object.entries(templates)) {
      const target = resolve(projectRoot, path);
      assertInside(projectRoot, target);
      await ensureDirectory(projectRoot, dirname(path));
      if ((await existingKind(target)) === 'missing') await writeExclusive(target, content);
    }
    await this.validateRoot();
  }

  async renameProjectWorkspace(
    currentFolderName: string,
    nextFolderName: string,
    ownership: ResearchNotesOwnership,
  ) {
    await this.validateRoot();
    const source = resolve(this.vaultRoot, this.projectRelativeRoot(currentFolderName));
    const target = resolve(this.vaultRoot, this.projectRelativeRoot(nextFolderName));
    assertInside(this.vaultRoot, source);
    assertInside(this.vaultRoot, target);
    const sourceKind = await existingKind(source);
    const targetKind = await existingKind(target);

    if (sourceKind === 'missing' && targetKind === 'directory') {
      const marker = await this.readOwnership(nextFolderName);
      if (marker && sameOwnership(marker, ownership)) return;
    }
    if (sourceKind !== 'directory') throw new Error('research_notes_folder_unavailable');
    const marker = await this.readOwnership(currentFolderName);
    if (!marker || !sameOwnership(marker, ownership)) {
      throw new Error('research_notes_folder_ownership_changed');
    }
    if (targetKind !== 'missing' && source !== target) {
      const [sourceMetadata, targetMetadata] = await Promise.all([lstat(source), lstat(target)]);
      if (
        !sourceMetadata.isDirectory() ||
        !targetMetadata.isDirectory() ||
        sourceMetadata.dev !== targetMetadata.dev ||
        sourceMetadata.ino !== targetMetadata.ino
      ) {
        throw new Error('research_notes_folder_conflict');
      }
    }
    if (source !== target) await rename(source, target);
    await this.writeOwnership(nextFolderName, ownership);
    await this.validateRoot();
  }

  async writeManagedMarkdown(
    folderName: string,
    relativePath: string,
    content: string,
    ownership: ResearchNotesOwnership,
  ) {
    await this.validateRoot();
    const projectRoot = await this.requireProjectRoot(folderName);
    const target = resolve(projectRoot, relativePath);
    assertInside(projectRoot, target);
    await ensureDirectory(projectRoot, dirname(relativePath));
    await this.assertProjectOwnership(folderName, ownership);
    if ((await existingKind(target)) === 'file') {
      const metadata = await lstat(target);
      if (metadata.size > MAX_MANAGED_MARKDOWN_BYTES) {
        throw new Error('research_notes_folder_conflict');
      }
      const current = await readFile(target, 'utf8');
      if (
        !current.includes('<!-- GOSU-MANAGED-FILE v1:') ||
        !current.includes(`gosu_project_id: ${JSON.stringify(ownership.projectId)}`)
      ) {
        throw new Error('research_notes_folder_conflict');
      }
      if (current === content) return;
    }
    await writeAtomic(target, content);
    await this.validateRoot();
  }

  async createUserMarkdown(
    folderName: string,
    relativePath: string,
    content: string,
    ownership: ResearchNotesOwnership,
  ) {
    await this.validateRoot();
    const projectRoot = await this.requireProjectRoot(folderName);
    const target = resolve(projectRoot, relativePath);
    assertInside(projectRoot, target);
    await ensureDirectory(projectRoot, dirname(relativePath));
    await this.assertProjectOwnership(folderName, ownership);
    const kind = await existingKind(target);
    if (kind === 'file') return false;
    if (kind !== 'missing') throw new Error('research_notes_folder_conflict');
    await writeExclusive(target, content);
    await this.validateRoot();
    return true;
  }

  private async assertProjectOwnership(folderName: string, ownership: ResearchNotesOwnership) {
    const marker = await this.readOwnership(folderName);
    if (!marker || !sameOwnership(marker, ownership)) {
      throw new Error('research_notes_folder_ownership_changed');
    }
  }

  private async writeOwnership(folderName: string, ownership: ResearchNotesOwnership) {
    const marker = resolve(this.vaultRoot, this.projectRelativeRoot(folderName), MARKER_FILE);
    await writeAtomic(marker, `${JSON.stringify(ownership, null, 2)}\n`);
  }

  private async requireProjectRoot(folderName: string) {
    const projectRoot = resolve(this.vaultRoot, this.projectRelativeRoot(folderName));
    assertInside(this.vaultRoot, projectRoot);
    const metadata = await lstat(projectRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('research_notes_folder_ownership_changed');
    }
    const canonical = await realpath(projectRoot);
    assertInside(this.vaultRoot, canonical);
    if (canonical !== projectRoot) {
      throw new Error('research_notes_folder_ownership_changed');
    }
    return projectRoot;
  }
}

function sameOwnership(left: ResearchNotesOwnership, right: ResearchNotesOwnership) {
  return (
    left.projectId === right.projectId &&
    left.bindingId === right.bindingId &&
    left.vaultId === right.vaultId
  );
}
