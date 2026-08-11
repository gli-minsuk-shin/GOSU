import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, open, readdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { ManuscriptRootDocumentSchema, type ManuscriptCheckpointV1 } from '@gosu/contracts';

import {
  MANUSCRIPT_LATEX_ENGINE_DISPLAY_NAMES,
  type ManuscriptLatexEngine,
} from '../shared/manuscript-workspace-contracts';

const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_COMPILER_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_COMPILE_GENERATED_BYTES = 192 * 1024 * 1024;
const MAX_COMPILE_GENERATED_ENTRIES = 50_000;
const COMPILE_RESOURCE_POLL_MS = 100;
const COMPILE_TIMEOUT_MS = 120_000;
const VERSION_TIMEOUT_MS = 10_000;
const MAX_VERSION_OUTPUT_BYTES = 64 * 1024;
const STALE_COMPILE_DIRECTORY = /^\.compile-[A-Za-z0-9]{6}$/u;
const LATEXMK_ENGINE_ARGUMENT = {
  pdflatex: '-pdf',
  xelatex: '-xelatex',
  lualatex: '-lualatex',
} as const satisfies Record<ManuscriptLatexEngine, string>;

export type ManuscriptCheckpointMaterializer = Readonly<{
  materializeCheckpoint(
    bindingId: string,
    revision: string,
    rootDocument: string,
    expectedRevisionEnvelopeDigest: string,
    destinationDirectory: string,
  ): Promise<unknown>;
}>;

type CommandResult = Readonly<{ stdout: string; stderr: string }>;
export type ManuscriptPdfCommandRunner = (
  executable: string,
  arguments_: readonly string[],
  options: Readonly<{
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    maxBytes: number;
    resourceDirectories?: readonly string[];
    maxResourceBytes?: number;
    resourcePollMs?: number;
  }>,
) => Promise<CommandResult>;

type ActiveCommand = Readonly<{
  terminate: () => void;
  reject: () => void;
}>;

export type ManuscriptPdfCompilerErrorCode =
  | 'manuscript_pdf_compiler_unavailable'
  | 'manuscript_pdf_compile_failed'
  | 'manuscript_pdf_too_large'
  | 'manuscript_pdf_invalid';

export class ManuscriptPdfCompilerError extends Error {
  constructor(readonly code: ManuscriptPdfCompilerErrorCode) {
    super(code);
    this.name = 'ManuscriptPdfCompilerError';
  }
}

async function generatedBytesWithinBudget(
  roots: readonly string[],
  maximumBytes: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) return false;
  const pending = [...roots];
  let entries = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const path = pending.pop()!;
    const metadata = await lstat(path).catch(() => null);
    if (!metadata || metadata.isSymbolicLink()) return false;
    entries += 1;
    if (entries > MAX_COMPILE_GENERATED_ENTRIES) return false;
    if (metadata.isDirectory()) {
      const children = await readdir(path).catch(() => null);
      if (!children) return false;
      for (const child of children) pending.push(join(path, child));
      continue;
    }
    if (!metadata.isFile()) return false;
    bytes += metadata.size;
    if (!Number.isSafeInteger(bytes) || bytes > maximumBytes) return false;
  }
  return true;
}

export type ManuscriptPdfCompileResult = Readonly<{
  artifactId: string;
  compiler: Readonly<{
    kind: 'latexmk';
    displayName: string;
    version: string;
    engine: ManuscriptLatexEngine;
    engineDisplayName: string;
  }>;
  pdfSha256: string;
  sizeBytes: number;
  pdfBase64: string;
}>;

export function createManuscriptPdfCommandRunner() {
  const active = new Set<ActiveCommand>();
  let disposed = false;

  const run: ManuscriptPdfCommandRunner = (executable, arguments_, options) => {
    if (disposed) {
      return Promise.reject(new ManuscriptPdfCompilerError('manuscript_pdf_compile_failed'));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(executable, [...arguments_], {
          cwd: options.cwd,
          env: options.env,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch {
        reject(new ManuscriptPdfCompilerError('manuscript_pdf_compile_failed'));
        return;
      }

      const terminate = () => {
        const pid = child.pid;
        if (pid !== undefined && process.platform !== 'win32') {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            // The complete process group has already exited.
          }
        }
        try {
          child.kill('SIGKILL');
        } catch {
          // The direct child has already exited.
        }
      };
      const finish = () => {
        clearTimeout(timer);
        if (resourceTimer) clearInterval(resourceTimer);
        active.delete(command);
      };
      const settleReject = () => {
        if (settled) return;
        settled = true;
        finish();
        reject(new ManuscriptPdfCompilerError('manuscript_pdf_compile_failed'));
      };
      const settleResolve = (result: CommandResult) => {
        if (settled) return;
        settled = true;
        finish();
        resolve(result);
      };
      const command = { terminate, reject: settleReject } satisfies ActiveCommand;
      active.add(command);
      let resourceCheckActive = false;
      const resourceBudgetOkay = async () => {
        if (!options.resourceDirectories || options.resourceDirectories.length === 0) return true;
        if (!options.maxResourceBytes) return false;
        return generatedBytesWithinBudget(options.resourceDirectories, options.maxResourceBytes);
      };
      const pollResourceBudget = () => {
        if (settled || resourceCheckActive) return;
        resourceCheckActive = true;
        void resourceBudgetOkay()
          .then((withinBudget) => {
            if (!withinBudget && !settled) {
              terminate();
              settleReject();
            }
          })
          .catch(() => {
            if (!settled) {
              terminate();
              settleReject();
            }
          })
          .finally(() => {
            resourceCheckActive = false;
          });
      };
      const resourceTimer = options.resourceDirectories
        ? setInterval(pollResourceBudget, options.resourcePollMs ?? COMPILE_RESOURCE_POLL_MS)
        : null;
      resourceTimer?.unref();
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let capturedBytes = 0;
      const capture = (destination: Buffer[], value: Buffer | string) => {
        if (settled) return;
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
        if (capturedBytes + bytes.byteLength > options.maxBytes) {
          terminate();
          settleReject();
          return;
        }
        capturedBytes += bytes.byteLength;
        destination.push(bytes);
      };
      child.stdout?.on('data', (value: Buffer | string) => capture(stdout, value));
      child.stderr?.on('data', (value: Buffer | string) => capture(stderr, value));
      child.on('error', () => {
        terminate();
        settleReject();
      });
      child.on('close', (code) => {
        if (settled) return;
        // A successful parent is not allowed to leave detached TeX helpers behind.
        // The process group is private to this command, so ending any remaining
        // members here cannot affect another compile or the GOSU process.
        terminate();
        if (code !== 0) {
          settleReject();
          return;
        }
        void resourceBudgetOkay()
          .then((withinBudget) => {
            if (!withinBudget) {
              settleReject();
              return;
            }
            settleResolve({
              stdout: Buffer.concat(stdout).toString('utf8'),
              stderr: Buffer.concat(stderr).toString('utf8'),
            });
          })
          .catch(settleReject);
      });
      const timer = setTimeout(() => {
        terminate();
        settleReject();
      }, options.timeoutMs);
    });
  };

  return {
    run,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const command of [...active]) {
        command.terminate();
        command.reject();
      }
    },
  } as const;
}

function sandboxString(value: string) {
  return JSON.stringify(value);
}

function compilerRootDocument(value: string) {
  const parsed = ManuscriptRootDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new ManuscriptPdfCompilerError('manuscript_pdf_compile_failed');
  }
  // Prefixing the relative path prevents latexmk from interpreting a root
  // document whose first segment resembles a command-line option.
  return `./${parsed.data}`;
}

export function manuscriptLatexSandboxProfile(sourceDirectory: string, workDirectory: string) {
  const outputDirectory = join(workDirectory, 'output');
  const homeDirectory = join(workDirectory, 'home');
  return [
    '(version 1)',
    '(import "dyld-support.sb")',
    '(deny default)',
    '(deny network*)',
    '(allow process*)',
    '(allow sysctl-read)',
    '(allow ipc-posix-shm)',
    `(allow file-read-metadata file-test-existence
      (path-ancestors ${sandboxString(sourceDirectory)})
      (path-ancestors ${sandboxString(workDirectory)})
      (path-ancestors "/Library/TeX")
      (path-ancestors "/Library/Fonts")
      (path-ancestors "/Library/Perl")
      (path-ancestors "/usr/local/texlive")
      (path-ancestors "/private/var/select/sh"))`,
    // TeX engines expose low-level file primitives that do not all honor
    // openin_any. Keep the OS read boundary explicit: the captured source and
    // disposable work tree plus immutable MacTeX/system runtime and font
    // locations. In particular, do not grant /Users, /private/etc, or an
    // unrestricted file-read rule.
    `(allow file-read* file-test-existence file-map-executable
      (subpath ${sandboxString(sourceDirectory)})
      (subpath ${sandboxString(workDirectory)})
      (literal "/Library")
      (subpath "/Library/Apple")
      (subpath "/Library/TeX")
      (subpath "/Library/Fonts")
      (subpath "/Library/Perl")
      (subpath "/System")
      (literal "/usr/local")
      (subpath "/usr/local/texlive")
      (subpath "/usr/bin")
      (subpath "/bin")
      (subpath "/usr/lib")
      (subpath "/usr/share")
      (subpath "/private/var/db/timezone")
      (literal "/private/etc/localtime")
      (literal "/private/var/select/sh")
      (literal "/dev/autofs_nowait")
      (literal "/dev/dtracehelper")
      (literal "/dev/null")
      (literal "/dev/random")
      (literal "/dev/urandom")
      (literal "/dev/zero"))`,
    `(allow file-write* (subpath ${sandboxString(outputDirectory)}) (subpath ${sandboxString(homeDirectory)}) (literal "/dev/null"))`,
  ].join('\n');
}

function minimalCompilerEnvironment(
  engineDirectory: string,
  homeDirectory: string,
  output: string,
) {
  return {
    PATH: `${engineDirectory}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: homeDirectory,
    TMPDIR: join(homeDirectory, 'tmp'),
    LANG: 'C.UTF-8',
    LC_ALL: 'C',
    TEXMFHOME: join(homeDirectory, 'texmf'),
    TEXMFVAR: join(homeDirectory, 'texmf-var'),
    TEXMFCONFIG: join(homeDirectory, 'texmf-config'),
    TEXMFOUTPUT: output,
    openin_any: 'p',
    openout_any: 'p',
    shell_escape: 'f',
  } satisfies NodeJS.ProcessEnv;
}

function compilerVersion(output: string) {
  const line = output
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => /latexmk/iu.test(candidate));
  return (line || 'latexmk').slice(0, 128);
}

export class ManuscriptPdfCompiler {
  private readonly materializer: ManuscriptCheckpointMaterializer;
  private readonly rootDirectory: () => string;
  private readonly engineCandidates: readonly string[];
  private readonly sandboxExecutable: string;
  private readonly run: ManuscriptPdfCommandRunner;
  private readonly commandRunner: ReturnType<typeof createManuscriptPdfCommandRunner> | null;
  private readonly platform: NodeJS.Platform;

  constructor(
    options: Readonly<{
      materializer: ManuscriptCheckpointMaterializer;
      rootDirectory: () => string;
      engineCandidates?: readonly string[];
      sandboxExecutable?: string;
      run?: ManuscriptPdfCommandRunner;
      platform?: NodeJS.Platform;
    }>,
  ) {
    this.materializer = options.materializer;
    this.rootDirectory = options.rootDirectory;
    this.engineCandidates =
      options.engineCandidates ??
      (process.platform === 'darwin'
        ? ['/Library/TeX/texbin/latexmk']
        : ['/usr/bin/latexmk', '/usr/local/bin/latexmk']);
    this.sandboxExecutable = options.sandboxExecutable ?? '/usr/bin/sandbox-exec';
    this.commandRunner = options.run ? null : createManuscriptPdfCommandRunner();
    this.run = options.run ?? this.commandRunner!.run;
    this.platform = options.platform ?? process.platform;
  }

  async reconcileStaleStaging(): Promise<void> {
    const root = this.rootDirectory();
    if (!isAbsolute(root)) {
      throw new ManuscriptPdfCompilerError('manuscript_pdf_compile_failed');
    }
    await mkdir(root, { recursive: true, mode: 0o700 });
    const canonicalRoot = await realpath(root);
    const entries = await readdir(canonicalRoot, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isDirectory() || !STALE_COMPILE_DIRECTORY.test(entry.name)) return;
        const candidate = join(canonicalRoot, entry.name);
        const stat = await lstat(candidate).catch(() => null);
        if (!stat?.isDirectory() || stat.isSymbolicLink()) return;
        await rm(candidate, { recursive: true, force: true });
      }),
    );
  }

  dispose(): void {
    this.commandRunner?.dispose();
  }

  async compile(
    bindingId: string,
    checkpoint: ManuscriptCheckpointV1,
    latexEngine: ManuscriptLatexEngine,
  ): Promise<ManuscriptPdfCompileResult> {
    if (this.platform !== 'darwin') {
      throw new ManuscriptPdfCompilerError('manuscript_pdf_compiler_unavailable');
    }
    const [engine] = await Promise.all([this.resolveEngine(), this.requireSandbox()]);
    const rootDocument = compilerRootDocument(checkpoint.rootDocument);
    const root = this.rootDirectory();
    if (!isAbsolute(root)) {
      throw new ManuscriptPdfCompilerError('manuscript_pdf_compile_failed');
    }
    await mkdir(root, { recursive: true, mode: 0o700 });
    const work = await mkdtemp(join(await realpath(root), '.compile-'));
    const source = join(work, 'source');
    const output = join(work, 'output');
    const home = join(work, 'home');
    let result: ManuscriptPdfCompileResult | undefined;
    let operationFailed = false;
    let operationError: unknown;
    try {
      await Promise.all([
        mkdir(source, { recursive: true, mode: 0o700 }),
        mkdir(output, { recursive: true, mode: 0o700 }),
        mkdir(join(home, 'tmp'), { recursive: true, mode: 0o700 }),
      ]);
      await this.materializer.materializeCheckpoint(
        bindingId,
        checkpoint.providerRevision ?? checkpoint.sourceRevision,
        checkpoint.rootDocument,
        checkpoint.revisionEnvelopeDigest,
        source,
      );

      const environment = minimalCompilerEnvironment(dirname(engine), home, output);
      const profile = manuscriptLatexSandboxProfile(source, work);
      const versionResult = await this.run(
        this.sandboxExecutable,
        ['-p', profile, engine, '-norc', '-v'],
        {
          cwd: source,
          env: environment,
          timeoutMs: VERSION_TIMEOUT_MS,
          maxBytes: MAX_VERSION_OUTPUT_BYTES,
        },
      ).catch(() => ({ stdout: 'latexmk', stderr: '' }));
      await this.run(
        this.sandboxExecutable,
        [
          '-p',
          profile,
          engine,
          '-norc',
          '-use-make-',
          LATEXMK_ENGINE_ARGUMENT[latexEngine],
          '-cd-',
          `-outdir=${output}`,
          `-auxdir=${output}`,
          '-interaction=nonstopmode',
          '-halt-on-error',
          '-file-line-error',
          '-latexoption=-no-shell-escape',
          rootDocument,
        ],
        {
          cwd: source,
          env: environment,
          timeoutMs: COMPILE_TIMEOUT_MS,
          maxBytes: MAX_COMPILER_OUTPUT_BYTES,
          resourceDirectories: [output, home],
          maxResourceBytes: MAX_COMPILE_GENERATED_BYTES,
        },
      );

      const pdfPath = join(output, `${basename(checkpoint.rootDocument, '.tex')}.pdf`);
      const handle = await open(pdfPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW).catch(
        () => {
          throw new ManuscriptPdfCompilerError('manuscript_pdf_compile_failed');
        },
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size < 8) {
          throw new ManuscriptPdfCompilerError('manuscript_pdf_invalid');
        }
        if (stat.size > MAX_PDF_BYTES) {
          throw new ManuscriptPdfCompilerError('manuscript_pdf_too_large');
        }
        const bytes = Buffer.allocUnsafe(stat.size);
        let offset = 0;
        while (offset < stat.size) {
          const read = await handle.read(bytes, offset, stat.size - offset, offset);
          if (read.bytesRead === 0) break;
          offset += read.bytesRead;
        }
        if (offset !== stat.size || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
          throw new ManuscriptPdfCompilerError('manuscript_pdf_invalid');
        }
        result = {
          artifactId: randomUUID(),
          compiler: {
            kind: 'latexmk',
            displayName: 'Local MacTeX latexmk',
            version: compilerVersion(`${versionResult.stdout}\n${versionResult.stderr}`),
            engine: latexEngine,
            engineDisplayName: MANUSCRIPT_LATEX_ENGINE_DISPLAY_NAMES[latexEngine],
          },
          pdfSha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
          sizeBytes: stat.size,
          pdfBase64: bytes.toString('base64'),
        };
      } finally {
        await handle.close();
      }
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }
    try {
      await rm(work, { recursive: true, force: true });
    } catch {
      if (!operationFailed) {
        operationFailed = true;
        operationError = new ManuscriptPdfCompilerError('manuscript_pdf_compile_failed');
      }
    }
    if (operationFailed) {
      throw operationError ?? new ManuscriptPdfCompilerError('manuscript_pdf_compile_failed');
    }
    if (!result) {
      throw new ManuscriptPdfCompilerError('manuscript_pdf_compile_failed');
    }
    return result;
  }

  private async resolveEngine() {
    for (const candidate of this.engineCandidates) {
      if (!isAbsolute(candidate)) continue;
      try {
        await access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // Try the next fixed, credential-free local TeX installation path.
      }
    }
    throw new ManuscriptPdfCompilerError('manuscript_pdf_compiler_unavailable');
  }

  private async requireSandbox() {
    if (!isAbsolute(this.sandboxExecutable)) {
      throw new ManuscriptPdfCompilerError('manuscript_pdf_compiler_unavailable');
    }
    try {
      await access(this.sandboxExecutable, fsConstants.X_OK);
    } catch {
      throw new ManuscriptPdfCompilerError('manuscript_pdf_compiler_unavailable');
    }
  }
}
