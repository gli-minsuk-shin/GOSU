import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import type { ExperimentEvaluationArtifactWriter } from './experiment-evaluation-service';

const PENDING_MARKER = '.gosu-profile-pending';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PYTHON_FILE_PATTERN = /^[a-z][a-z0-9_-]*\.py$/u;

function profileRoot(root: string, projectId: string, profileId: string) {
  return join(root, projectId, profileId);
}

function expectedReceipt(projectId: string, profileId: string, fileName: string) {
  const relativeRoot = `evaluation-profiles/${projectId}/${profileId}`;
  return {
    codePath: `${relativeRoot}/${fileName}`,
    promptPath: `${relativeRoot}/evaluation-prompt.txt`,
  };
}

function assertInside(root: string, target: string) {
  const scoped = relative(root, target);
  if (scoped === '' || scoped === '..' || scoped.startsWith(`..${sep}`)) {
    throw new Error('experiment_evaluation_artifact_path_escape');
  }
}

async function closeQuietly(handle: FileHandle | undefined) {
  await handle?.close().catch(() => undefined);
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

function directoryNoFollowRejected(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ELOOP' || code === 'ENOTDIR';
}

async function syncDirectory(directory: string) {
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    await handle.sync();
  } catch (error) {
    if (!directorySyncUnsupported(error)) throw error;
  } finally {
    await closeQuietly(handle);
  }
}

async function assertPrivateDirectory(path: string, expectedCanonical?: string) {
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_DIRECTORY ?? 0),
    );
    const metadata = await handle.stat();
    if (!metadata.isDirectory() || (metadata.mode & 0o077) !== 0) {
      throw new Error('experiment_evaluation_artifact_directory_invalid');
    }
  } catch (error) {
    if (directoryNoFollowRejected(error)) {
      throw new Error('experiment_evaluation_artifact_directory_invalid', { cause: error });
    }
    throw error;
  } finally {
    await closeQuietly(handle);
  }
  const canonical = await realpath(path);
  if (expectedCanonical && canonical !== expectedCanonical) {
    throw new Error('experiment_evaluation_artifact_directory_invalid');
  }
  return canonical;
}

async function ensurePrivateDirectory(path: string, parent: string, expectedCanonical?: string) {
  let created = false;
  try {
    await mkdir(path, { mode: 0o700 });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  let handle: FileHandle | undefined;
  let canonical: string;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_DIRECTORY ?? 0),
    );
    const metadata = await handle.stat();
    if (!metadata.isDirectory()) {
      throw new Error('experiment_evaluation_artifact_directory_invalid');
    }
    await handle.chmod(0o700);
    canonical = await realpath(path);
    if (expectedCanonical && canonical !== expectedCanonical) {
      throw new Error('experiment_evaluation_artifact_directory_invalid');
    }
  } catch (error) {
    if (directoryNoFollowRejected(error)) {
      throw new Error('experiment_evaluation_artifact_directory_invalid', { cause: error });
    }
    throw error;
  } finally {
    await closeQuietly(handle);
  }
  if (created) await syncDirectory(parent);
  return canonical;
}

async function writeDurableExclusive(path: string, content: string) {
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('experiment_evaluation_artifact_file_invalid');
    await handle.chmod(0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await closeQuietly(handle);
  }
}

async function readPrivateFile(path: string, expectedSize: number) {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0 || metadata.size !== expectedSize) {
      return null;
    }
    return await handle.readFile({ encoding: 'utf8' });
  } finally {
    await closeQuietly(handle);
  }
}

async function secureArtifactRoots(rootDirectory: string, projectId: string, create: boolean) {
  const root = resolve(rootDirectory);
  const rootParent = dirname(root);
  const canonicalRoot = create
    ? await ensurePrivateDirectory(root, rootParent)
    : await assertPrivateDirectory(root);
  const projectRoot = join(root, projectId);
  assertInside(root, projectRoot);
  const expectedProjectCanonical = join(canonicalRoot, projectId);
  const canonicalProject = create
    ? await ensurePrivateDirectory(projectRoot, root, expectedProjectCanonical)
    : await assertPrivateDirectory(projectRoot, expectedProjectCanonical);
  return { root, canonicalRoot, projectRoot, canonicalProject };
}

export class LocalExperimentEvaluationArtifacts implements ExperimentEvaluationArtifactWriter {
  constructor(private readonly rootDirectory: () => string) {}

  async saveProfile(
    input: Readonly<{
      projectId: string;
      profileId: string;
      fileName: string;
      code: string;
      prompt: string;
    }>,
  ) {
    if (
      !UUID_PATTERN.test(input.projectId) ||
      !UUID_PATTERN.test(input.profileId) ||
      !PYTHON_FILE_PATTERN.test(input.fileName)
    ) {
      throw new Error('experiment_evaluation_artifact_input_invalid');
    }
    const { root, projectRoot, canonicalProject } = await secureArtifactRoots(
      this.rootDirectory(),
      input.projectId,
      true,
    );
    const destination = join(projectRoot, input.profileId);
    const temporary = join(projectRoot, `.pending-${input.profileId}-${randomUUID()}`);
    assertInside(root, destination);
    assertInside(root, temporary);
    await ensurePrivateDirectory(
      temporary,
      projectRoot,
      join(canonicalProject, basename(temporary)),
    );
    try {
      await Promise.all([
        writeDurableExclusive(join(temporary, input.fileName), `${input.code.trim()}\n`),
        writeDurableExclusive(join(temporary, 'evaluation-prompt.txt'), `${input.prompt.trim()}\n`),
        writeDurableExclusive(join(temporary, PENDING_MARKER), `${input.profileId}\n`),
      ]);
      await syncDirectory(temporary);
      await assertPrivateDirectory(projectRoot, canonicalProject);
      await rename(temporary, destination);
      await assertPrivateDirectory(destination, join(canonicalProject, input.profileId));
      await syncDirectory(projectRoot);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return expectedReceipt(input.projectId, input.profileId, input.fileName);
  }

  async finalizeProfile(input: Readonly<{ projectId: string; profileId: string }>) {
    if (!UUID_PATTERN.test(input.projectId) || !UUID_PATTERN.test(input.profileId)) return;
    const { root, projectRoot, canonicalProject } = await secureArtifactRoots(
      this.rootDirectory(),
      input.projectId,
      false,
    );
    const directory = profileRoot(root, input.projectId, input.profileId);
    await assertPrivateDirectory(directory, join(canonicalProject, input.profileId));
    const marker = join(directory, PENDING_MARKER);
    assertInside(root, marker);
    const markerStat = await lstat(marker);
    if (markerStat.isSymbolicLink() || !markerStat.isFile()) {
      throw new Error('experiment_evaluation_artifact_file_invalid');
    }
    await rm(marker, { force: true });
    await syncDirectory(directory);
    await syncDirectory(projectRoot);
  }

  async verifyProfile(
    input: Readonly<{
      projectId: string;
      profileId: string;
      fileName: string;
      code: string;
      prompt: string;
      codePath: string;
      promptPath: string;
    }>,
  ) {
    if (
      !UUID_PATTERN.test(input.projectId) ||
      !UUID_PATTERN.test(input.profileId) ||
      !PYTHON_FILE_PATTERN.test(input.fileName)
    ) {
      return false;
    }
    const expected = expectedReceipt(input.projectId, input.profileId, input.fileName);
    if (input.codePath !== expected.codePath || input.promptPath !== expected.promptPath) {
      return false;
    }
    const { root, canonicalProject } = await secureArtifactRoots(
      this.rootDirectory(),
      input.projectId,
      false,
    );
    const directory = profileRoot(root, input.projectId, input.profileId);
    const codeFile = join(directory, input.fileName);
    const promptFile = join(directory, 'evaluation-prompt.txt');
    assertInside(root, codeFile);
    assertInside(root, promptFile);
    const expectedCode = `${input.code.trim()}\n`;
    const expectedPrompt = `${input.prompt.trim()}\n`;
    try {
      await assertPrivateDirectory(directory, join(canonicalProject, input.profileId));
      const [code, prompt] = await Promise.all([
        readPrivateFile(codeFile, Buffer.byteLength(expectedCode, 'utf8')),
        readPrivateFile(promptFile, Buffer.byteLength(expectedPrompt, 'utf8')),
      ]);
      return code === expectedCode && prompt === expectedPrompt;
    } catch {
      return false;
    }
  }

  async reconcilePendingProfiles(
    profileExists: (projectId: string, profileId: string) => boolean | Promise<boolean>,
  ) {
    const root = resolve(this.rootDirectory());
    await ensurePrivateDirectory(root, dirname(root));
    const projects = await readdir(root, { withFileTypes: true });
    const result = { finalized: 0, removed: 0, failures: 0 };
    for (const project of projects) {
      try {
        if (project.name.startsWith('.pending-')) {
          await rm(join(root, project.name), { recursive: true, force: true });
          await syncDirectory(root);
          result.removed += 1;
          continue;
        }
        if (!project.isDirectory() || !UUID_PATTERN.test(project.name)) continue;
        const { projectRoot } = await secureArtifactRoots(
          this.rootDirectory(),
          project.name,
          false,
        );
        const profiles = await readdir(projectRoot, { withFileTypes: true });
        for (const profile of profiles) {
          try {
            const destination = join(projectRoot, profile.name);
            if (profile.name.startsWith('.pending-')) {
              await rm(destination, { recursive: true, force: true });
              await syncDirectory(projectRoot);
              result.removed += 1;
              continue;
            }
            if (!profile.isDirectory() || !UUID_PATTERN.test(profile.name)) continue;
            const marker = join(destination, PENDING_MARKER);
            const hasPendingMarker = await lstat(marker)
              .then((stat) => {
                if (stat.isSymbolicLink() || !stat.isFile()) {
                  throw new Error('experiment_evaluation_artifact_marker_invalid');
                }
                return true;
              })
              .catch((error: unknown) => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
                throw error;
              });
            if (!hasPendingMarker) continue;
            if (await profileExists(project.name, profile.name)) {
              await this.finalizeProfile({ projectId: project.name, profileId: profile.name });
              result.finalized += 1;
            } else {
              await this.rollbackProfile({ projectId: project.name, profileId: profile.name });
              result.removed += 1;
            }
          } catch {
            result.failures += 1;
          }
        }
      } catch {
        result.failures += 1;
      }
    }
    return result;
  }

  async rollbackProfile(input: Readonly<{ projectId: string; profileId: string }>) {
    if (!UUID_PATTERN.test(input.projectId) || !UUID_PATTERN.test(input.profileId)) {
      return;
    }
    const { root, projectRoot, canonicalProject } = await secureArtifactRoots(
      this.rootDirectory(),
      input.projectId,
      false,
    );
    const destination = profileRoot(root, input.projectId, input.profileId);
    assertInside(root, destination);
    try {
      await assertPrivateDirectory(destination, join(canonicalProject, input.profileId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await rm(destination, { recursive: true, force: true });
    await syncDirectory(projectRoot);
  }
}
