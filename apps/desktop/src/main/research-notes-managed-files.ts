import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

const MARKER_FILE = '.gosu-project.json';
const PENDING_BUNDLE_FILE = '.gosu-pending-bundle.json';
const PENDING_BUNDLE_INDEX_DIRECTORY = '.gosu-pending-bundles';
const PENDING_BUNDLE_SCAN_CURSOR_FILE = '.gosu-scan-cursor';
const MAX_MARKER_BYTES = 16_384;
const MAX_PENDING_BUNDLE_BYTES = 32_768;
const MAX_PENDING_BUNDLE_INDEX_BYTES = 64_768;
const MAX_PENDING_BUNDLE_SCAN_CURSOR_BYTES = 1_024;
const MAX_MANAGED_MARKDOWN_BYTES = 8 * 1_024 * 1_024;
export const RESEARCH_NOTES_MAX_PENDING_BUNDLE_SCAN = 32;
export const RESEARCH_NOTES_MAX_USER_MARKDOWN_BYTES = 2_000_000;

export type ResearchNotesOwnership = Readonly<{
  schemaVersion: 1;
  projectId: string;
  bindingId: string;
  vaultId: string;
  projectName: string;
}>;

export type ResearchNotesPendingMarkdownBundle = Readonly<{
  schemaVersion: 1;
  kind: 'lecture-revision';
  projectId: string;
  bindingId: string;
  vaultId: string;
  bundleId: string;
  studioId: string;
  revision: number;
  attemptId: string;
  sourceManifestSha256: string;
  generationBriefSha256?: string;
  authoringPolicyVersion?: number;
  authoringPolicySha256?: string;
  /** Omitted by legacy revision journals, which always contain Markdown. */
  documentFormat?: 'markdown' | 'latex';
  files: readonly Readonly<{ name: string; contentSha256: string }>[];
}>;

export type ResearchNotesPendingMarkdownBundleEntry = Readonly<{
  relativeBundlePath: string;
  journal: ResearchNotesPendingMarkdownBundle;
}>;

type ResearchNotesPendingMarkdownBundleIndex = Readonly<{
  schemaVersion: 1;
  relativeBundlePath: string;
  journal: ResearchNotesPendingMarkdownBundle;
}>;

type ResearchNotesPendingMarkdownBundleScanCursor = Readonly<{
  schemaVersion: 1;
  after: string;
}>;

export type ResearchNotesMarkdownBundleFile = Readonly<{
  name: string;
  content: string;
}>;

function bundleDocumentFormat(journal: ResearchNotesPendingMarkdownBundle) {
  return journal.documentFormat ?? 'markdown';
}

function bundleFileNames(format: 'markdown' | 'latex') {
  return format === 'latex'
    ? (['Lecture Notes.tex', 'Slides.tex'] as const)
    : (['Lecture Notes.md', 'Slides.md'] as const);
}

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

function bundleFileName(name: string, format: 'markdown' | 'latex') {
  const extension = format === 'latex' ? '.tex' : '.md';
  if (
    name.includes('\0') ||
    name.includes('/') ||
    name.includes('\\') ||
    name === '.' ||
    name === '..' ||
    !name.endsWith(extension)
  ) {
    throw new Error('research_notes_path_escape');
  }
  return name;
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalBundleJournal(journal: ResearchNotesPendingMarkdownBundle) {
  const documentFormat = bundleDocumentFormat(journal);
  const expectedFileNames = bundleFileNames(documentFormat);
  const provenanceValues = [
    journal.generationBriefSha256,
    journal.authoringPolicyVersion,
    journal.authoringPolicySha256,
  ];
  const provenanceCount = provenanceValues.filter((value) => value !== undefined).length;
  if (
    journal.schemaVersion !== 1 ||
    journal.kind !== 'lecture-revision' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      journal.projectId,
    ) ||
    !/^[0-9a-f]{64}$/u.test(journal.bindingId) ||
    !/^[0-9a-f]{64}$/u.test(journal.vaultId) ||
    !/^[0-9a-f]{64}$/u.test(journal.bundleId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      journal.studioId,
    ) ||
    !Number.isSafeInteger(journal.revision) ||
    journal.revision < 1 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      journal.attemptId,
    ) ||
    !/^[0-9a-f]{64}$/u.test(journal.sourceManifestSha256) ||
    (provenanceCount !== 0 && provenanceCount !== provenanceValues.length) ||
    (journal.generationBriefSha256 !== undefined &&
      !/^[0-9a-f]{64}$/u.test(journal.generationBriefSha256)) ||
    (journal.authoringPolicyVersion !== undefined &&
      (!Number.isSafeInteger(journal.authoringPolicyVersion) ||
        journal.authoringPolicyVersion < 1)) ||
    (journal.authoringPolicySha256 !== undefined &&
      !/^[0-9a-f]{64}$/u.test(journal.authoringPolicySha256)) ||
    (journal.documentFormat !== undefined &&
      journal.documentFormat !== 'markdown' &&
      journal.documentFormat !== 'latex') ||
    journal.files.length !== 2 ||
    new Set(journal.files.map((file) => file.name)).size !== journal.files.length ||
    [...journal.files.map((file) => file.name)].sort().join('\0') !==
      [...expectedFileNames].sort().join('\0') ||
    journal.files.some(
      (file) =>
        bundleFileName(file.name, documentFormat) !== file.name ||
        !/^[0-9a-f]{64}$/u.test(file.contentSha256),
    )
  ) {
    throw new Error('research_notes_folder_conflict');
  }
  return `${JSON.stringify(journal, null, 2)}\n`;
}

function parseBundleJournal(value: string): ResearchNotesPendingMarkdownBundle | null {
  try {
    const parsed = JSON.parse(value) as ResearchNotesPendingMarkdownBundle;
    canonicalBundleJournal(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function canonicalBundleIndex(index: ResearchNotesPendingMarkdownBundleIndex) {
  const segments = pathSegments(index.relativeBundlePath);
  if (index.schemaVersion !== 1 || segments.join('/') !== index.relativeBundlePath) {
    throw new Error('research_notes_folder_conflict');
  }
  canonicalBundleJournal(index.journal);
  return `${JSON.stringify(index, null, 2)}\n`;
}

function parseBundleIndex(value: string): ResearchNotesPendingMarkdownBundleIndex | null {
  try {
    const parsed = JSON.parse(value) as ResearchNotesPendingMarkdownBundleIndex;
    canonicalBundleIndex(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function pendingBundleIndexFileName(journal: ResearchNotesPendingMarkdownBundle) {
  const journalSha256 = sha256(canonicalBundleJournal(journal));
  return `${journal.bundleId}-${journalSha256}.json`;
}

function canonicalBundleScanCursor(cursor: ResearchNotesPendingMarkdownBundleScanCursor) {
  if (cursor.schemaVersion !== 1 || !/^[0-9a-f]{64}-[0-9a-f]{64}\.json$/u.test(cursor.after)) {
    throw new Error('research_notes_folder_conflict');
  }
  return `${JSON.stringify(cursor, null, 2)}\n`;
}

function parseBundleScanCursor(value: string): ResearchNotesPendingMarkdownBundleScanCursor | null {
  try {
    const parsed = JSON.parse(value) as ResearchNotesPendingMarkdownBundleScanCursor;
    canonicalBundleScanCursor(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function isPathInsideParent(relativePath: string, relativeParentPath: string) {
  const path = pathSegments(relativePath);
  const parent = pathSegments(relativeParentPath);
  return path.length > parent.length && parent.every((segment, index) => path[index] === segment);
}

async function ensureDirectory(
  root: string,
  relativePath: string,
  directorySync: DirectorySync = syncDirectory,
) {
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
      let created = false;
      try {
        await mkdir(next, { mode: 0o700 });
        created = true;
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
      }
      const metadata = await lstat(next);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error('research_notes_folder_conflict', { cause: error });
      }
      if (created) await syncCreatedDirectoryEntry(current, directorySync);
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

type DirectorySync = (directory: string) => Promise<void>;

async function writeExclusive(path: string, content: string, directorySync: DirectorySync) {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncCreatedDirectoryEntry(dirname(path), directorySync);
}

function directorySyncUnsupported(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === 'EINVAL' ||
    code === 'ENOTSUP' ||
    code === 'EOPNOTSUPP' ||
    code === 'ENOSYS' ||
    code === 'EISDIR' ||
    (process.platform === 'win32' && (code === 'EPERM' || code === 'EBADF'))
  );
}

async function syncDirectory(directory: string) {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncCreatedDirectoryEntry(directory: string, directorySync: DirectorySync) {
  try {
    await directorySync(directory);
  } catch (error) {
    if (!directorySyncUnsupported(error)) throw error;
  }
}

async function writeAtomic(path: string, content: string, directorySync: DirectorySync) {
  const parent = dirname(path);
  const temporary = resolve(parent, `.gosu-write-${randomUUID()}.tmp`);
  try {
    await writeExclusive(temporary, content, directorySync);
    const kind = await existingKind(path);
    if (kind === 'directory' || kind === 'symlink' || kind === 'other') {
      throw new Error('research_notes_folder_conflict');
    }
    await rename(temporary, path);
    await syncCreatedDirectoryEntry(parent, directorySync);
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
  constructor(
    private readonly vaultRoot: string,
    private readonly directorySync: DirectorySync = syncDirectory,
  ) {}

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
    const projectRoot = await ensureDirectory(this.vaultRoot, relativeRoot, this.directorySync);
    const markerPath = resolve(projectRoot, MARKER_FILE);
    const markerKind = await existingKind(markerPath);
    if (markerKind === 'missing') {
      await writeExclusive(
        markerPath,
        `${JSON.stringify(ownership, null, 2)}\n`,
        this.directorySync,
      );
    } else {
      const current = await this.readOwnership(folderName);
      if (!current || !sameOwnership(current, ownership)) {
        throw new Error('research_notes_folder_conflict');
      }
    }
    for (const folder of folders) await ensureDirectory(projectRoot, folder, this.directorySync);
    for (const [path, content] of Object.entries(templates)) {
      const target = resolve(projectRoot, path);
      assertInside(projectRoot, target);
      await ensureDirectory(projectRoot, dirname(path), this.directorySync);
      if ((await existingKind(target)) === 'missing') {
        await writeExclusive(target, content, this.directorySync);
      }
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
    await ensureDirectory(projectRoot, dirname(relativePath), this.directorySync);
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
    await writeAtomic(target, content, this.directorySync);
    await this.validateRoot();
  }

  async createUserMarkdown(
    folderName: string,
    relativePath: string,
    content: string,
    ownership: ResearchNotesOwnership,
  ) {
    if (Buffer.byteLength(content, 'utf8') > RESEARCH_NOTES_MAX_USER_MARKDOWN_BYTES) {
      throw new Error('research_notes_markdown_too_large');
    }
    await this.validateRoot();
    const projectRoot = await this.requireProjectRoot(folderName);
    const target = resolve(projectRoot, relativePath);
    assertInside(projectRoot, target);
    await ensureDirectory(projectRoot, dirname(relativePath), this.directorySync);
    await this.assertProjectOwnership(folderName, ownership);
    const kind = await existingKind(target);
    if (kind === 'file') return false;
    if (kind !== 'missing') throw new Error('research_notes_folder_conflict');
    await writeExclusive(target, content, this.directorySync);
    await this.validateRoot();
    return true;
  }

  async createUserMarkdownBundle(
    folderName: string,
    relativeBundlePath: string,
    files: readonly ResearchNotesMarkdownBundleFile[],
    journal: ResearchNotesPendingMarkdownBundle,
    ownership: ResearchNotesOwnership,
  ) {
    if (
      files.length !== 2 ||
      files.some(
        (file) => Buffer.byteLength(file.content, 'utf8') > RESEARCH_NOTES_MAX_USER_MARKDOWN_BYTES,
      )
    ) {
      throw new Error('research_notes_markdown_too_large');
    }
    const documentFormat = bundleDocumentFormat(journal);
    const names = files.map((file) => bundleFileName(file.name, documentFormat));
    if (new Set(names).size !== names.length) throw new Error('research_notes_folder_conflict');
    const expectedJournal: ResearchNotesPendingMarkdownBundle = {
      ...journal,
      files: files.map((file) => ({ name: file.name, contentSha256: sha256(file.content) })),
    };
    const journalContent = canonicalBundleJournal(expectedJournal);
    await this.validateRoot();
    const projectRoot = await this.requireProjectRoot(folderName);
    const bundlePath = resolve(projectRoot, relativeBundlePath);
    assertInside(projectRoot, bundlePath);
    const parent = await ensureDirectory(
      projectRoot,
      dirname(relativeBundlePath),
      this.directorySync,
    );
    await this.assertProjectOwnership(folderName, ownership);
    const kind = await existingKind(bundlePath);
    let previousJournal: ResearchNotesPendingMarkdownBundle | null = null;
    if (kind === 'directory') {
      const current = await this.readPendingBundle(bundlePath);
      await this.assertPendingBundleFiles(bundlePath, current);
      if (JSON.stringify(current) === JSON.stringify(expectedJournal)) {
        await this.ensurePendingBundleIndex(projectRoot, relativeBundlePath, expectedJournal);
        return false;
      }
      if (!samePendingBundleIdentity(current, expectedJournal)) {
        throw new Error('research_notes_folder_conflict');
      }
      previousJournal = current;
    } else if (kind !== 'missing') {
      throw new Error('research_notes_folder_conflict');
    }

    const stagedPath = resolve(parent, `.gosu-bundle-${randomUUID()}.tmp`);
    assertInside(projectRoot, stagedPath);
    let indexed = false;
    let published = false;
    try {
      await mkdir(stagedPath, { mode: 0o700 });
      for (const file of files) {
        await writeExclusive(resolve(stagedPath, file.name), file.content, this.directorySync);
      }
      await writeExclusive(
        resolve(stagedPath, PENDING_BUNDLE_FILE),
        journalContent,
        this.directorySync,
      );
      await syncCreatedDirectoryEntry(stagedPath, this.directorySync);
      await this.ensurePendingBundleIndex(projectRoot, relativeBundlePath, expectedJournal);
      indexed = true;
      if (previousJournal) {
        const current = await this.readPendingBundle(bundlePath);
        await this.assertPendingBundleFiles(bundlePath, current);
        if (JSON.stringify(current) !== JSON.stringify(previousJournal)) {
          throw new Error('research_notes_folder_conflict');
        }
        await rm(bundlePath, { recursive: true });
        await syncCreatedDirectoryEntry(parent, this.directorySync);
      } else if ((await existingKind(bundlePath)) !== 'missing') {
        throw new Error('research_notes_folder_conflict');
      }
      await rename(stagedPath, bundlePath);
      published = true;
      await syncCreatedDirectoryEntry(parent, this.directorySync);
      if (previousJournal) {
        await this.removePendingBundleIndex(projectRoot, relativeBundlePath, previousJournal);
      }
    } finally {
      await rm(stagedPath, { recursive: true, force: true }).catch(() => undefined);
      if (indexed && !published) {
        await this.removePendingBundleIndex(projectRoot, relativeBundlePath, expectedJournal).catch(
          () => undefined,
        );
      }
    }
    await this.validateRoot();
    return true;
  }

  async assertUserMarkdownBundleDestination(
    folderName: string,
    relativeParentPath: string,
    ownership: ResearchNotesOwnership,
  ) {
    await this.validateRoot();
    const projectRoot = await this.requireProjectRoot(folderName);
    const parent = await ensureDirectory(projectRoot, relativeParentPath, this.directorySync);
    await this.assertProjectOwnership(folderName, ownership);
    const probe = resolve(parent, `.gosu-write-probe-${randomUUID()}.tmp`);
    assertInside(projectRoot, probe);
    try {
      await writeExclusive(probe, '', this.directorySync);
    } finally {
      await rm(probe, { force: true }).catch(() => undefined);
      await syncCreatedDirectoryEntry(parent, this.directorySync);
    }
    await this.validateRoot();
  }

  async listPendingUserMarkdownBundles(
    folderName: string,
    relativeParentPath: string,
    ownership: ResearchNotesOwnership,
    requestedLimit = RESEARCH_NOTES_MAX_PENDING_BUNDLE_SCAN,
  ): Promise<readonly ResearchNotesPendingMarkdownBundleEntry[]> {
    const limit = Math.max(
      1,
      Math.min(Math.trunc(requestedLimit), RESEARCH_NOTES_MAX_PENDING_BUNDLE_SCAN),
    );
    await this.validateRoot();
    const projectRoot = await this.requireProjectRoot(folderName);
    const parent = resolve(projectRoot, relativeParentPath);
    assertInside(projectRoot, parent);
    await this.assertProjectOwnership(folderName, ownership);
    const parentKind = await existingKind(parent);
    if (parentKind === 'missing') return [];
    if (parentKind !== 'directory') throw new Error('research_notes_folder_conflict');

    const indexDirectory = resolve(projectRoot, PENDING_BUNDLE_INDEX_DIRECTORY);
    assertInside(projectRoot, indexDirectory);
    const indexDirectoryKind = await existingKind(indexDirectory);
    if (indexDirectoryKind === 'missing') return [];
    if (indexDirectoryKind !== 'directory') throw new Error('research_notes_folder_conflict');

    const indexEntries = (await readdir(indexDirectory, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          !entry.isSymbolicLink() &&
          /^[0-9a-f]{64}-[0-9a-f]{64}\.json$/u.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort();
    const cursor = await this.readPendingBundleScanCursor(indexDirectory);
    const firstAfterCursor = cursor ? indexEntries.findIndex((name) => name > cursor.after) : 0;
    const start = firstAfterCursor < 0 ? 0 : firstAfterCursor;
    const pending: ResearchNotesPendingMarkdownBundleEntry[] = [];
    let lastInspected: string | null = null;
    for (let offset = 0; offset < indexEntries.length; offset += 1) {
      if (pending.length >= limit) break;
      const entryName = indexEntries[(start + offset) % indexEntries.length]!;
      lastInspected = entryName;
      const indexPath = resolve(indexDirectory, entryName);
      try {
        assertInside(projectRoot, indexPath);
        const indexed = await this.readPendingBundleIndex(indexPath);
        if (entryName !== pendingBundleIndexFileName(indexed.journal)) continue;
        if (
          indexed.journal.projectId !== ownership.projectId ||
          indexed.journal.bindingId !== ownership.bindingId ||
          indexed.journal.vaultId !== ownership.vaultId ||
          !isPathInsideParent(indexed.relativeBundlePath, relativeParentPath)
        ) {
          continue;
        }
        const bundlePath = resolve(projectRoot, indexed.relativeBundlePath);
        assertInside(projectRoot, bundlePath);
        const bundleKind = await existingKind(bundlePath);
        if (bundleKind === 'missing') {
          await this.removePendingBundleIndex(
            projectRoot,
            indexed.relativeBundlePath,
            indexed.journal,
          );
          continue;
        }
        if (bundleKind !== 'directory') continue;
        const journalKind = await existingKind(resolve(bundlePath, PENDING_BUNDLE_FILE));
        if (journalKind === 'missing') {
          await this.removePendingBundleIndex(
            projectRoot,
            indexed.relativeBundlePath,
            indexed.journal,
          );
          continue;
        }
        if (journalKind !== 'file') continue;
        const journal = await this.readPendingBundle(bundlePath);
        if (JSON.stringify(journal) !== JSON.stringify(indexed.journal)) {
          if (samePendingBundleIdentity(journal, indexed.journal)) {
            await this.removePendingBundleIndex(
              projectRoot,
              indexed.relativeBundlePath,
              indexed.journal,
            );
          }
          continue;
        }
        await this.assertPendingBundleFiles(bundlePath, indexed.journal);
        pending.push({
          relativeBundlePath: indexed.relativeBundlePath,
          journal: indexed.journal,
        });
      } catch {
        // Foreign, edited, or malformed index/target states are user-owned conflicts.
      }
    }
    if (lastInspected) {
      await this.writePendingBundleScanCursor(indexDirectory, lastInspected);
    }
    await this.validateRoot();
    return pending;
  }

  async confirmUserMarkdownBundle(
    folderName: string,
    relativeBundlePath: string,
    expected: ResearchNotesPendingMarkdownBundle,
    ownership: ResearchNotesOwnership,
  ) {
    await this.validateRoot();
    const projectRoot = await this.requireProjectRoot(folderName);
    const bundlePath = resolve(projectRoot, relativeBundlePath);
    assertInside(projectRoot, bundlePath);
    await this.assertProjectOwnership(folderName, ownership);
    const current = await this.readPendingBundle(bundlePath);
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      throw new Error('research_notes_folder_conflict');
    }
    await this.assertPendingBundleFiles(bundlePath, current);
    await rm(resolve(bundlePath, PENDING_BUNDLE_FILE));
    await syncCreatedDirectoryEntry(bundlePath, this.directorySync);
    await this.removePendingBundleIndex(projectRoot, relativeBundlePath, current);
    await this.validateRoot();
  }

  async rollbackUserMarkdownBundle(
    folderName: string,
    relativeBundlePath: string,
    expected: ResearchNotesPendingMarkdownBundle,
    ownership: ResearchNotesOwnership,
  ) {
    await this.validateRoot();
    const projectRoot = await this.requireProjectRoot(folderName);
    const bundlePath = resolve(projectRoot, relativeBundlePath);
    assertInside(projectRoot, bundlePath);
    await this.assertProjectOwnership(folderName, ownership);
    const current = await this.readPendingBundle(bundlePath);
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      throw new Error('research_notes_folder_conflict');
    }
    await this.assertPendingBundleFiles(bundlePath, current);
    await rm(bundlePath, { recursive: true });
    await syncCreatedDirectoryEntry(dirname(bundlePath), this.directorySync);
    await this.removePendingBundleIndex(projectRoot, relativeBundlePath, current);
    await this.validateRoot();
  }

  private async ensurePendingBundleIndex(
    projectRoot: string,
    relativeBundlePath: string,
    journal: ResearchNotesPendingMarkdownBundle,
  ) {
    const indexDirectory = await ensureDirectory(
      projectRoot,
      PENDING_BUNDLE_INDEX_DIRECTORY,
      this.directorySync,
    );
    const index: ResearchNotesPendingMarkdownBundleIndex = {
      schemaVersion: 1,
      relativeBundlePath,
      journal,
    };
    const content = canonicalBundleIndex(index);
    const indexPath = resolve(indexDirectory, pendingBundleIndexFileName(journal));
    assertInside(projectRoot, indexPath);
    const kind = await existingKind(indexPath);
    if (kind === 'file') {
      const current = await this.readPendingBundleIndex(indexPath);
      if (JSON.stringify(current) !== JSON.stringify(index)) {
        throw new Error('research_notes_folder_conflict');
      }
      return;
    }
    if (kind !== 'missing') throw new Error('research_notes_folder_conflict');
    try {
      await writeExclusive(indexPath, content, this.directorySync);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = await this.readPendingBundleIndex(indexPath);
      if (JSON.stringify(current) !== JSON.stringify(index)) {
        throw new Error('research_notes_folder_conflict', { cause: error });
      }
    }
  }

  private async removePendingBundleIndex(
    projectRoot: string,
    relativeBundlePath: string,
    journal: ResearchNotesPendingMarkdownBundle,
  ) {
    const indexDirectory = resolve(projectRoot, PENDING_BUNDLE_INDEX_DIRECTORY);
    assertInside(projectRoot, indexDirectory);
    if ((await existingKind(indexDirectory)) !== 'directory') return false;
    const indexPath = resolve(indexDirectory, pendingBundleIndexFileName(journal));
    assertInside(projectRoot, indexPath);
    if ((await existingKind(indexPath)) !== 'file') return false;
    const expected: ResearchNotesPendingMarkdownBundleIndex = {
      schemaVersion: 1,
      relativeBundlePath,
      journal,
    };
    let current: ResearchNotesPendingMarkdownBundleIndex;
    try {
      current = await this.readPendingBundleIndex(indexPath);
    } catch {
      return false;
    }
    if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
    await rm(indexPath);
    await syncCreatedDirectoryEntry(indexDirectory, this.directorySync);
    return true;
  }

  private async readPendingBundleIndex(indexPath: string) {
    try {
      const metadata = await lstat(indexPath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error('research_notes_folder_conflict');
      }
      const bytes = await readFile(indexPath);
      if (bytes.length > MAX_PENDING_BUNDLE_INDEX_BYTES) {
        throw new Error('research_notes_folder_conflict');
      }
      const index = parseBundleIndex(bytes.toString('utf8'));
      if (!index) throw new Error('research_notes_folder_conflict');
      return index;
    } catch (error) {
      if (error instanceof Error && error.message === 'research_notes_folder_conflict') {
        throw error;
      }
      throw new Error('research_notes_folder_conflict', { cause: error });
    }
  }

  private async readPendingBundleScanCursor(indexDirectory: string) {
    const cursorPath = resolve(indexDirectory, PENDING_BUNDLE_SCAN_CURSOR_FILE);
    const kind = await existingKind(cursorPath);
    if (kind === 'missing') return null;
    if (kind !== 'file') throw new Error('research_notes_folder_conflict');
    const metadata = await lstat(cursorPath);
    if (metadata.isSymbolicLink() || metadata.size > MAX_PENDING_BUNDLE_SCAN_CURSOR_BYTES) {
      throw new Error('research_notes_folder_conflict');
    }
    const cursor = parseBundleScanCursor(await readFile(cursorPath, 'utf8'));
    if (!cursor) throw new Error('research_notes_folder_conflict');
    return cursor;
  }

  private async writePendingBundleScanCursor(indexDirectory: string, after: string) {
    const cursorPath = resolve(indexDirectory, PENDING_BUNDLE_SCAN_CURSOR_FILE);
    const kind = await existingKind(cursorPath);
    if (kind !== 'missing' && kind !== 'file') {
      throw new Error('research_notes_folder_conflict');
    }
    await writeAtomic(
      cursorPath,
      canonicalBundleScanCursor({ schemaVersion: 1, after }),
      this.directorySync,
    );
  }

  private async readPendingBundle(bundlePath: string) {
    try {
      const metadata = await lstat(bundlePath);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error('research_notes_folder_conflict');
      }
      const journalPath = resolve(bundlePath, PENDING_BUNDLE_FILE);
      const journalMetadata = await lstat(journalPath);
      if (journalMetadata.isSymbolicLink() || !journalMetadata.isFile()) {
        throw new Error('research_notes_folder_conflict');
      }
      const journalBytes = await readFile(journalPath);
      if (journalBytes.length > MAX_PENDING_BUNDLE_BYTES) {
        throw new Error('research_notes_folder_conflict');
      }
      const journal = parseBundleJournal(journalBytes.toString('utf8'));
      if (!journal) throw new Error('research_notes_folder_conflict');
      return journal;
    } catch (error) {
      if (error instanceof Error && error.message === 'research_notes_folder_conflict') {
        throw error;
      }
      throw new Error('research_notes_folder_conflict', { cause: error });
    }
  }

  private async assertPendingBundleFiles(
    bundlePath: string,
    journal: ResearchNotesPendingMarkdownBundle,
  ) {
    const entries = (await readdir(bundlePath)).sort();
    const expected = [...journal.files.map((file) => file.name), PENDING_BUNDLE_FILE].sort();
    if (JSON.stringify(entries) !== JSON.stringify(expected)) {
      throw new Error('research_notes_folder_conflict');
    }
    for (const file of journal.files) {
      const path = resolve(bundlePath, file.name);
      const metadata = await lstat(path);
      if (
        metadata.isSymbolicLink() ||
        !metadata.isFile() ||
        metadata.size > RESEARCH_NOTES_MAX_USER_MARKDOWN_BYTES
      ) {
        throw new Error('research_notes_folder_conflict');
      }
      const content = await readFile(path, 'utf8');
      if (sha256(content) !== file.contentSha256) {
        throw new Error('research_notes_folder_conflict');
      }
    }
  }

  private async assertProjectOwnership(folderName: string, ownership: ResearchNotesOwnership) {
    const marker = await this.readOwnership(folderName);
    if (!marker || !sameOwnership(marker, ownership)) {
      throw new Error('research_notes_folder_ownership_changed');
    }
  }

  private async writeOwnership(folderName: string, ownership: ResearchNotesOwnership) {
    const marker = resolve(this.vaultRoot, this.projectRelativeRoot(folderName), MARKER_FILE);
    await writeAtomic(marker, `${JSON.stringify(ownership, null, 2)}\n`, this.directorySync);
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

function samePendingBundleIdentity(
  left: ResearchNotesPendingMarkdownBundle,
  right: ResearchNotesPendingMarkdownBundle,
) {
  return (
    left.projectId === right.projectId &&
    left.bindingId === right.bindingId &&
    left.vaultId === right.vaultId &&
    left.bundleId === right.bundleId &&
    left.studioId === right.studioId &&
    left.revision === right.revision &&
    left.sourceManifestSha256 === right.sourceManifestSha256 &&
    left.generationBriefSha256 === right.generationBriefSha256 &&
    left.authoringPolicyVersion === right.authoringPolicyVersion &&
    left.authoringPolicySha256 === right.authoringPolicySha256
  );
}
