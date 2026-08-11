import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createManuscriptPdfCommandRunner,
  ManuscriptPdfCompiler,
  manuscriptLatexSandboxProfile,
} from '../src/main/manuscript-pdf-compiler';

const RUN_LOCAL_MACTEX_SMOKE =
  process.platform === 'darwin' &&
  process.env.GOSU_RUN_LOCAL_MACTEX_SMOKE === '1' &&
  existsSync('/Library/TeX/texbin/latexmk');

const checkpoint = {
  schemaVersion: 1 as const,
  checkpointId: '11111111-1111-4111-8111-111111111111',
  bindingId: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  manuscriptId: '44444444-4444-4444-8444-444444444444',
  providerId: 'overleaf_git',
  direction: 'fetch' as const,
  sourceAuthority: 'provider' as const,
  sourceRevision: 'a'.repeat(40),
  gosuRevision: null,
  providerRevision: 'a'.repeat(40),
  cursor: 'a'.repeat(40),
  revisionEnvelopeDigest: `sha256:${'b'.repeat(64)}`,
  rootDocument: 'main.tex',
  baseCheckpointId: null,
  actorId: '55555555-5555-4555-8555-555555555555',
  observedAt: '2026-08-12T00:00:00.000Z',
};

function runLocalSmokeCommand(
  executable: string,
  arguments_: readonly string[],
  options: Readonly<{
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    maxBytes: number;
  }>,
) {
  return new Promise<Readonly<{ stdout: string; stderr: string }>>((resolve, reject) => {
    execFile(
      executable,
      [...arguments_],
      {
        cwd: options.cwd,
        env: options.env,
        encoding: 'utf8',
        timeout: options.timeoutMs,
        maxBuffer: options.maxBytes,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error([stderr, stdout, error.message].filter(Boolean).join('\n')));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

describe('ManuscriptPdfCompiler', () => {
  let root: string;
  let engine: string;
  let sandboxExecutable: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gosu-manuscript-pdf-'));
    engine = join(root, 'latexmk');
    sandboxExecutable = join(root, 'sandbox-exec');
    await writeFile(engine, '#!/bin/sh\n', { mode: 0o700 });
    await writeFile(sandboxExecutable, '#!/bin/sh\n', { mode: 0o700 });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('materializes the exact checkpoint and invokes a fixed no-network sandbox policy', async () => {
    const materializeCheckpoint = vi.fn(async (_bindingId, _revision, _root, _digest, source) => {
      await writeFile(join(source, 'main.tex'), '\\documentclass{article}');
    });
    const run = vi.fn(
      async (
        executable: string,
        arguments_: readonly string[],
        options: Readonly<{ env: NodeJS.ProcessEnv; timeoutMs: number; maxBytes: number }>,
      ) => {
        expect(executable).toBe(sandboxExecutable);
        expect(arguments_[0]).toBe('-p');
        expect(arguments_[1]).toContain('(deny network*)');
        expect(arguments_[1]).not.toContain('(allow file-read*)\n');
        expect(arguments_[1]).toContain(`(subpath ${JSON.stringify(options.env.TEXMFOUTPUT)}`);
        expect(arguments_[1]).not.toContain('(subpath "/private/etc")');
        expect(arguments_[1]).not.toContain('(subpath "/Users")');
        const writeRule = arguments_[1]!
          .split('\n')
          .find((line) => line.startsWith('(allow file-write*'));
        expect(writeRule).not.toContain('/source');
        expect(options.env).toMatchObject({
          openin_any: 'p',
          openout_any: 'p',
          shell_escape: 'f',
        });
        if (arguments_.at(-1) === '-v') {
          expect(arguments_).toContain('-norc');
          expect(options).toMatchObject({ timeoutMs: 10_000, maxBytes: 64 * 1024 });
          return { stdout: 'Latexmk, Version 4.88', stderr: '' };
        }
        expect(arguments_).toContain('-latexoption=-no-shell-escape');
        expect(arguments_).toContain('-norc');
        expect(arguments_).toContain('-use-make-');
        expect(arguments_).toContain('-pdf');
        expect(arguments_).not.toContain('-xelatex');
        expect(arguments_).not.toContain('-lualatex');
        expect(arguments_).toContain('./main.tex');
        expect(options).toMatchObject({ timeoutMs: 120_000, maxBytes: 2 * 1024 * 1024 });
        const output = arguments_.find((argument) => argument.startsWith('-outdir='))!.slice(8);
        await writeFile(join(output, 'main.pdf'), Buffer.from('%PDF-1.7\nfixture\n%%EOF'));
        return { stdout: '', stderr: '' };
      },
    );
    const compiler = new ManuscriptPdfCompiler({
      materializer: { materializeCheckpoint },
      rootDirectory: () => join(root, 'artifacts'),
      engineCandidates: [engine],
      sandboxExecutable,
      run,
      platform: 'darwin',
    });

    const result = await compiler.compile(checkpoint.bindingId, checkpoint, 'pdflatex');

    expect(materializeCheckpoint).toHaveBeenCalledWith(
      checkpoint.bindingId,
      checkpoint.providerRevision,
      checkpoint.rootDocument,
      checkpoint.revisionEnvelopeDigest,
      expect.any(String),
    );
    expect(result).toMatchObject({
      compiler: {
        kind: 'latexmk',
        version: 'Latexmk, Version 4.88',
        engine: 'pdflatex',
        engineDisplayName: 'pdfLaTeX',
      },
      sizeBytes: 22,
    });
    expect(Buffer.from(result.pdfBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    const artifactEntries = await readdir(join(root, 'artifacts'));
    expect(artifactEntries).toEqual([]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['pdflatex', '-pdf', 'pdfLaTeX'],
    ['xelatex', '-xelatex', 'XeLaTeX'],
    ['lualatex', '-lualatex', 'LuaLaTeX'],
  ] as const)(
    'maps %s to one fixed latexmk mode without fallback',
    async (latexEngine, expectedArgument, engineDisplayName) => {
      const compileArguments: string[][] = [];
      const compiler = new ManuscriptPdfCompiler({
        materializer: {
          materializeCheckpoint: async (_bindingId, _revision, _root, _digest, source) => {
            await writeFile(join(source, 'main.tex'), '\\documentclass{article}');
          },
        },
        rootDirectory: () => join(root, 'artifacts'),
        engineCandidates: [engine],
        sandboxExecutable,
        run: async (_executable, arguments_) => {
          if (arguments_.at(-1) === '-v') return { stdout: 'Latexmk, Version 4.88', stderr: '' };
          compileArguments.push([...arguments_]);
          const output = arguments_.find((argument) => argument.startsWith('-outdir='))!.slice(8);
          await writeFile(join(output, 'main.pdf'), Buffer.from('%PDF-1.7\nfixture\n%%EOF'));
          return { stdout: '', stderr: '' };
        },
        platform: 'darwin',
      });

      const result = await compiler.compile(checkpoint.bindingId, checkpoint, latexEngine);

      expect(compileArguments).toHaveLength(1);
      expect(compileArguments[0]).toContain(expectedArgument);
      expect(
        compileArguments[0]!.filter((argument) =>
          ['-pdf', '-xelatex', '-lualatex'].includes(argument),
        ),
      ).toEqual([expectedArgument]);
      expect(result.compiler).toMatchObject({ engine: latexEngine, engineDisplayName });
    },
  );

  it('fails clearly when no fixed local compiler is available', async () => {
    const compiler = new ManuscriptPdfCompiler({
      materializer: { materializeCheckpoint: vi.fn() },
      rootDirectory: () => join(root, 'artifacts'),
      engineCandidates: [join(root, 'missing-latexmk')],
      sandboxExecutable,
      platform: 'darwin',
    });
    await expect(
      compiler.compile(checkpoint.bindingId, checkpoint, 'pdflatex'),
    ).rejects.toMatchObject({
      code: 'manuscript_pdf_compiler_unavailable',
    });
  });

  it('preserves exact-checkpoint materialization errors and still removes staging files', async () => {
    const materializationError = new Error('checkpoint verification failed');
    const compiler = new ManuscriptPdfCompiler({
      materializer: {
        materializeCheckpoint: async () => {
          throw materializationError;
        },
      },
      rootDirectory: () => join(root, 'artifacts'),
      engineCandidates: [engine],
      sandboxExecutable,
      run: vi.fn(),
      platform: 'darwin',
    });

    await expect(compiler.compile(checkpoint.bindingId, checkpoint, 'pdflatex')).rejects.toBe(
      materializationError,
    );
    expect(await readdir(join(root, 'artifacts'))).toEqual([]);
  });

  it('rejects a compiler result that is not a PDF and removes staging files', async () => {
    const compiler = new ManuscriptPdfCompiler({
      materializer: {
        materializeCheckpoint: async (_bindingId, _revision, _root, _digest, source) => {
          await writeFile(join(source, 'main.tex'), '\\documentclass{article}');
        },
      },
      rootDirectory: () => join(root, 'artifacts'),
      engineCandidates: [engine],
      sandboxExecutable,
      run: async (_executable, arguments_) => {
        if (arguments_.at(-1) === '-v') return { stdout: 'Latexmk', stderr: '' };
        const output = arguments_.find((argument) => argument.startsWith('-outdir='))!.slice(8);
        await writeFile(join(output, 'main.pdf'), 'not a pdf');
        return { stdout: '', stderr: '' };
      },
      platform: 'darwin',
    });

    await expect(
      compiler.compile(checkpoint.bindingId, checkpoint, 'pdflatex'),
    ).rejects.toMatchObject({
      code: 'manuscript_pdf_invalid',
    });
    await expect(access(join(root, 'artifacts'))).resolves.toBeUndefined();
    const entries = await readdir(join(root, 'artifacts'));
    expect(entries).toEqual([]);
  });

  it('rejects a PDF larger than the preview bound without reading it into memory', async () => {
    const compiler = new ManuscriptPdfCompiler({
      materializer: {
        materializeCheckpoint: async (_bindingId, _revision, _root, _digest, source) => {
          await writeFile(join(source, 'main.tex'), '\\documentclass{article}');
        },
      },
      rootDirectory: () => join(root, 'artifacts'),
      engineCandidates: [engine],
      sandboxExecutable,
      run: async (_executable, arguments_) => {
        if (arguments_.at(-1) === '-v') return { stdout: 'Latexmk', stderr: '' };
        const output = arguments_.find((argument) => argument.startsWith('-outdir='))!.slice(8);
        const pdf = join(output, 'main.pdf');
        await writeFile(pdf, '%PDF-');
        await truncate(pdf, 32 * 1024 * 1024 + 1);
        return { stdout: '', stderr: '' };
      },
      platform: 'darwin',
    });

    await expect(
      compiler.compile(checkpoint.bindingId, checkpoint, 'pdflatex'),
    ).rejects.toMatchObject({
      code: 'manuscript_pdf_too_large',
    });
    expect(await readdir(join(root, 'artifacts'))).toEqual([]);
  });

  it.each(['paper/final(v2).tex', 'paper/main@camera.tex', '-e.tex'])(
    'accepts the public root-document contract for %s and prefixes the latexmk argv',
    async (rootDocument) => {
      const run = vi.fn(async (_executable: string, arguments_: readonly string[]) => {
        if (arguments_.at(-1) === '-v') return { stdout: 'Latexmk', stderr: '' };
        expect(arguments_.at(-1)).toBe(`./${rootDocument}`);
        const output = arguments_.find((argument) => argument.startsWith('-outdir='))!.slice(8);
        await writeFile(
          join(output, `${rootDocument.split('/').at(-1)!.slice(0, -4)}.pdf`),
          Buffer.from('%PDF-1.7\nfixture\n%%EOF'),
        );
        return { stdout: '', stderr: '' };
      });
      const compiler = new ManuscriptPdfCompiler({
        materializer: { materializeCheckpoint: vi.fn(async () => undefined) },
        rootDirectory: () => join(root, 'artifacts'),
        engineCandidates: [engine],
        sandboxExecutable,
        run,
        platform: 'darwin',
      });

      await expect(
        compiler.compile(checkpoint.bindingId, { ...checkpoint, rootDocument }, 'pdflatex'),
      ).resolves.toMatchObject({
        compiler: { engine: 'pdflatex', engineDisplayName: 'pdfLaTeX' },
      });
    },
  );

  it('rejects a root document outside the public contract before materializing', async () => {
    const materializeCheckpoint = vi.fn();
    const run = vi.fn();
    const compiler = new ManuscriptPdfCompiler({
      materializer: { materializeCheckpoint },
      rootDirectory: () => join(root, 'artifacts'),
      engineCandidates: [engine],
      sandboxExecutable,
      run,
      platform: 'darwin',
    });

    await expect(
      compiler.compile(
        checkpoint.bindingId,
        {
          ...checkpoint,
          rootDocument: '../private.tex',
        },
        'pdflatex',
      ),
    ).rejects.toMatchObject({ code: 'manuscript_pdf_compile_failed' });
    expect(materializeCheckpoint).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('fails clearly when the mandatory sandbox runtime is unavailable', async () => {
    const compiler = new ManuscriptPdfCompiler({
      materializer: { materializeCheckpoint: vi.fn() },
      rootDirectory: () => join(root, 'artifacts'),
      engineCandidates: [engine],
      sandboxExecutable: join(root, 'missing-sandbox-exec'),
      platform: 'darwin',
    });

    await expect(
      compiler.compile(checkpoint.bindingId, checkpoint, 'pdflatex'),
    ).rejects.toMatchObject({
      code: 'manuscript_pdf_compiler_unavailable',
    });
  });

  it('fails clearly on unsupported platforms without materializing source', async () => {
    const materializeCheckpoint = vi.fn();
    const compiler = new ManuscriptPdfCompiler({
      materializer: { materializeCheckpoint },
      rootDirectory: () => join(root, 'artifacts'),
      engineCandidates: [engine],
      sandboxExecutable,
      platform: 'linux',
    });

    await expect(
      compiler.compile(checkpoint.bindingId, checkpoint, 'pdflatex'),
    ).rejects.toMatchObject({
      code: 'manuscript_pdf_compiler_unavailable',
    });
    expect(materializeCheckpoint).not.toHaveBeenCalled();
  });

  it('removes only exact stale compile staging directories during startup reconciliation', async () => {
    const artifacts = join(root, 'artifacts');
    const stale = join(artifacts, '.compile-ABC123');
    const preservedDirectory = join(artifacts, '.compile-TOO-LONG');
    const preservedFile = join(artifacts, '.compile-DEF456-file');
    const symlinkTarget = join(root, 'preserved-target');
    const preservedSymlink = join(artifacts, '.compile-ZYX987');
    await mkdir(artifacts, { recursive: true });
    await Promise.all([
      mkdir(join(stale, 'source'), { recursive: true }),
      mkdir(preservedDirectory, { recursive: true }),
      mkdir(symlinkTarget, { recursive: true }),
      writeFile(preservedFile, 'keep'),
    ]);
    await writeFile(join(stale, 'source', 'main.tex'), 'stale');
    await symlink(symlinkTarget, preservedSymlink);
    const compiler = new ManuscriptPdfCompiler({
      materializer: { materializeCheckpoint: vi.fn() },
      rootDirectory: () => artifacts,
      engineCandidates: [engine],
      sandboxExecutable,
      run: vi.fn(),
      platform: 'darwin',
    });

    await compiler.reconcileStaleStaging();

    await expect(access(stale)).rejects.toBeDefined();
    await expect(access(preservedDirectory)).resolves.toBeUndefined();
    await expect(access(preservedFile)).resolves.toBeUndefined();
    await expect(access(preservedSymlink)).resolves.toBeUndefined();
    await expect(access(symlinkTarget)).resolves.toBeUndefined();
  });

  it.skipIf(!RUN_LOCAL_MACTEX_SMOKE)(
    'compiles a minimal captured checkpoint with the installed local MacTeX',
    async () => {
      const compiler = new ManuscriptPdfCompiler({
        materializer: {
          materializeCheckpoint: async (_bindingId, _revision, _root, _digest, source) => {
            await writeFile(
              join(source, 'main.tex'),
              [
                '\\documentclass{article}',
                '\\begin{document}',
                'GOSU captured-checkpoint PDF smoke test.',
                '\\end{document}',
              ].join('\n'),
            );
          },
        },
        rootDirectory: () => join(root, 'artifacts'),
        engineCandidates: ['/Library/TeX/texbin/latexmk'],
        run: runLocalSmokeCommand,
        platform: 'darwin',
      });

      const result = await compiler.compile(checkpoint.bindingId, checkpoint, 'pdflatex');

      expect(Buffer.from(result.pdfBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
      expect(result.compiler.version).toMatch(/Latexmk/iu);
      expect(await readdir(join(root, 'artifacts'))).toEqual([]);
    },
  );

  it.skipIf(!RUN_LOCAL_MACTEX_SMOKE)(
    'enforces the paranoid TeX input policy in the local MacTeX sandbox',
    async () => {
      const compiler = new ManuscriptPdfCompiler({
        materializer: {
          materializeCheckpoint: async (_bindingId, _revision, _root, _digest, source) => {
            await writeFile(
              join(source, 'main.tex'),
              [
                '\\documentclass{article}',
                '\\begin{document}',
                '\\input{/etc/passwd}',
                '\\end{document}',
              ].join('\n'),
            );
          },
        },
        rootDirectory: () => join(root, 'artifacts'),
        engineCandidates: ['/Library/TeX/texbin/latexmk'],
        run: runLocalSmokeCommand,
        platform: 'darwin',
      });

      await expect(
        compiler.compile(checkpoint.bindingId, checkpoint, 'pdflatex'),
      ).rejects.toBeDefined();
      expect(await readdir(join(root, 'artifacts'))).toEqual([]);
    },
  );

  it.skipIf(!RUN_LOCAL_MACTEX_SMOKE)(
    'blocks pdfTeX low-level reads outside the captured source at the OS boundary',
    async () => {
      const compiler = new ManuscriptPdfCompiler({
        materializer: {
          materializeCheckpoint: async (_bindingId, _revision, _root, _digest, source) => {
            await writeFile(
              join(source, 'main.tex'),
              [
                '\\documentclass{article}',
                '\\begin{document}',
                '\\edef\\hostprefix{\\pdffiledump offset 0 length 4 {/etc/hosts}}',
                '\\ifx\\hostprefix\\empty Read blocked.\\else',
                '\\errmessage{GOSU arbitrary file read succeeded}',
                '\\fi',
                '\\end{document}',
              ].join('\n'),
            );
          },
        },
        rootDirectory: () => join(root, 'artifacts'),
        engineCandidates: ['/Library/TeX/texbin/latexmk'],
        run: runLocalSmokeCommand,
        platform: 'darwin',
      });

      await expect(
        compiler.compile(checkpoint.bindingId, checkpoint, 'pdflatex'),
      ).resolves.toMatchObject({ compiler: { engine: 'pdflatex' } });
      expect(await readdir(join(root, 'artifacts'))).toEqual([]);
    },
    20_000,
  );

  it.skipIf(!RUN_LOCAL_MACTEX_SMOKE)(
    'blocks Lua io reads outside the captured source at the OS boundary',
    async () => {
      const compiler = new ManuscriptPdfCompiler({
        materializer: {
          materializeCheckpoint: async (_bindingId, _revision, _root, _digest, source) => {
            await writeFile(
              join(source, 'main.tex'),
              [
                '\\documentclass{article}',
                '\\begin{document}',
                '\\directlua{local f=io.open("/etc/hosts","r"); if f then tex.error("GOSU arbitrary file read succeeded") else tex.print("Read blocked.") end}',
                '\\end{document}',
              ].join('\n'),
            );
          },
        },
        rootDirectory: () => join(root, 'artifacts'),
        engineCandidates: ['/Library/TeX/texbin/latexmk'],
        run: runLocalSmokeCommand,
        platform: 'darwin',
      });

      await expect(
        compiler.compile(checkpoint.bindingId, checkpoint, 'lualatex'),
      ).resolves.toMatchObject({ compiler: { engine: 'lualatex' } });
      expect(await readdir(join(root, 'artifacts'))).toEqual([]);
    },
    30_000,
  );
});

describe.skipIf(process.platform === 'win32')('manuscript PDF command process groups', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gosu-manuscript-command-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('kills descendants when a command times out', async () => {
    const executable = join(root, 'timeout.sh');
    const survivor = join(root, 'timeout-survivor');
    await writeFile(
      executable,
      '#!/bin/sh\n(sleep 0.35; printf survived > "$1") &\nwhile :; do sleep 1; done\n',
      { mode: 0o700 },
    );
    const runner = createManuscriptPdfCommandRunner();

    await expect(
      runner.run(executable, [survivor], {
        cwd: root,
        env: process.env,
        timeoutMs: 50,
        maxBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: 'manuscript_pdf_compile_failed' });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(existsSync(survivor)).toBe(false);
    runner.dispose();
  });

  it('kills descendants when compiler output exceeds its bound', async () => {
    const executable = join(root, 'overflow.sh');
    const survivor = join(root, 'overflow-survivor');
    await writeFile(
      executable,
      [
        '#!/bin/sh',
        '(sleep 0.35; printf survived > "$1") &',
        "while :; do printf '0123456789abcdef'; done",
        '',
      ].join('\n'),
      { mode: 0o700 },
    );
    const runner = createManuscriptPdfCommandRunner();

    await expect(
      runner.run(executable, [survivor], {
        cwd: root,
        env: process.env,
        timeoutMs: 2_000,
        maxBytes: 128,
      }),
    ).rejects.toMatchObject({ code: 'manuscript_pdf_compile_failed' });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(existsSync(survivor)).toBe(false);
    runner.dispose();
  });

  it('kills every active command group when disposed during app shutdown', async () => {
    const executable = join(root, 'dispose.sh');
    const ready = join(root, 'ready');
    const survivor = join(root, 'dispose-survivor');
    await writeFile(
      executable,
      [
        '#!/bin/sh',
        'printf ready > "$1"',
        '(sleep 0.35; printf survived > "$2") &',
        'while :; do sleep 1; done',
        '',
      ].join('\n'),
      { mode: 0o700 },
    );
    const runner = createManuscriptPdfCommandRunner();
    const pending = runner.run(executable, [ready, survivor], {
      cwd: root,
      env: process.env,
      timeoutMs: 2_000,
      maxBytes: 1024,
    });
    for (let attempt = 0; attempt < 50 && !existsSync(ready); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(existsSync(ready)).toBe(true);
    runner.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'manuscript_pdf_compile_failed' });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(existsSync(survivor)).toBe(false);
  });

  it('rejects compiler output that exceeds the generated staging budget', async () => {
    const executable = join(root, 'generate.sh');
    const generated = join(root, 'generated');
    await mkdir(generated);
    await writeFile(executable, '#!/bin/sh\nprintf 0123456789abcdef > "$1/result.log"\n', {
      mode: 0o700,
    });
    const runner = createManuscriptPdfCommandRunner();

    await expect(
      runner.run(executable, [generated], {
        cwd: root,
        env: process.env,
        timeoutMs: 2_000,
        maxBytes: 1_024,
        resourceDirectories: [generated],
        maxResourceBytes: 8,
        resourcePollMs: 10,
      }),
    ).rejects.toMatchObject({ code: 'manuscript_pdf_compile_failed' });
    runner.dispose();
  });
});

it('escapes writable staging paths in the sandbox profile', () => {
  const profile = manuscriptLatexSandboxProfile('/tmp/source with space', '/tmp/work"quoted');
  expect(profile).toContain('(deny network*)');
  expect(profile).toContain('work\\"quoted');
  expect(profile).not.toContain('(allow mach-lookup)');
  expect(profile).not.toContain('(subpath "/private/etc")');
  expect(profile).toContain('(subpath "/tmp/work\\"quoted/output")');
  expect(profile).toContain('(subpath "/tmp/work\\"quoted/home")');
  const writeRule = profile.split('\n').find((line) => line.startsWith('(allow file-write*'));
  expect(writeRule).not.toContain('source with space');
});
