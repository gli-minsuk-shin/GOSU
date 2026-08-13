import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LectureDocumentCompiler,
  LectureDocumentCompilerError,
  lectureMarkdownToLatex,
} from '../src/main/lecture-document-compiler';

const RUN_LOCAL_MACTEX_SMOKE =
  process.platform === 'darwin' &&
  process.env.GOSU_RUN_LOCAL_MACTEX_SMOKE === '1' &&
  existsSync('/Library/TeX/texbin/latexmk') &&
  existsSync('/usr/bin/sandbox-exec');
const LOCAL_MACTEX_SMOKE_NOTES_PATH = process.env.GOSU_LECTURE_PDF_SMOKE_NOTES_PATH;

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

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

describe('LectureDocumentCompiler', () => {
  let root: string;
  let engine: string;
  let sandboxExecutable: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gosu-lecture-pdf-'));
    engine = join(root, 'latexmk');
    sandboxExecutable = join(root, 'sandbox-exec');
    await writeFile(engine, '#!/bin/sh\n', { mode: 0o700 });
    await writeFile(sandboxExecutable, '#!/bin/sh\n', { mode: 0o700 });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('converts bounded Markdown deterministically without carrying executable TeX commands', () => {
    const markdown = [
      '# Section',
      '',
      'A **bounded** result with $x = 2$ and `code_value`.',
      '',
      '- First item',
      '- Second item',
      '',
      'Unsafe inline math is shown as text: $\\input{/etc/passwd}$.',
    ].join('\n');
    const first = lectureMarkdownToLatex('lecture-notes', 'Fixture & notes', markdown);
    const second = lectureMarkdownToLatex('lecture-notes', 'Fixture & notes', markdown);

    expect(first).toBe(second);
    expect(first).toContain('\\documentclass[11pt]{article}');
    expect(first).toContain('\\textbf{bounded}');
    expect(first).toContain('$x = 2$');
    expect(first).toContain('\\textbackslash{}input');
    expect(first).not.toContain('\\input{/etc/passwd}');
  });

  it('preserves rigorous inline and display mathematics used by lecture notes', () => {
    const markdown = [
      '# Mathematical guarantees',
      '',
      'For $B\\asymp\\sqrt n$, let $\\widehat F_{B,M}$ converge as $B\\to\\infty$.',
      '',
      '$$',
      '\\begin{aligned}',
      '\\sup_z \\left|\\widehat F_{B,M}(z)-\\mathbb P\\{g(S_n)\\le z\\}\\right|',
      '&\\le \\frac{C}{\\sqrt M}+O_P(B^{-1}) \\\\',
      'S_{B,s} &\\rightsquigarrow_{\\#} N(0,\\Sigma).',
      '\\end{aligned}',
      '$$',
    ].join('\n');

    const latex = lectureMarkdownToLatex('lecture-notes', 'Rigorous fixture', markdown);

    expect(latex).toContain('$B\\asymp\\sqrt n$');
    expect(latex).toContain('\\begin{aligned}');
    expect(latex).toContain('\\sup_z');
    expect(latex).toContain('\\widehat F_{B,M}');
    expect(latex).toContain('\\rightsquigarrow_{\\#}');
    expect(latex).toContain('\\end{aligned}');
    expect(latex).not.toContain('\\textbackslash{}widehat');
  });

  it.each([
    '\\input{/etc/passwd}',
    '\\include{secrets}',
    '\\write18{touch /tmp/unsafe}',
    '\\newcommand{\\escape}{unsafe}',
    '\\href{https://example.com}{unsafe}',
    '\\^^69nput{/etc/passwd}',
    '^^5cinput{/etc/passwd}',
    'x = 1 ^^25 \\input{/etc/passwd}',
    '\\catcode`x=1',
    '\\begin{document}unsafe\\end{document}',
    '\\begin {document}unsafe\\end {document}',
    '\\begin{aligned}x=1\\end{matrix}',
  ])('renders unsafe or structurally invalid math as inert text: %s', (expression) => {
    const markdown = `Unsafe: $${expression}$`;
    const latex = lectureMarkdownToLatex('lecture-notes', 'Security fixture', markdown);

    expect(latex).not.toContain(`$${expression}$`);
    expect(latex).toMatch(/\\(?:textbackslash|textasciicircum)\{\}/u);
  });

  it('preserves only explicitly allowed symbolic TeX commands in math', () => {
    const expression = String.raw`\left\{x \in \mathbb R : x \# 0\right\}\,\Vert x\Vert`;
    const latex = lectureMarkdownToLatex(
      'lecture-notes',
      'Symbol fixture',
      `Safe: $${expression}$`,
    );

    expect(latex).toContain(`$${expression}$`);
    expect(latex).not.toContain('\\textbackslash{}left');
  });

  it('uses fixed XeLaTeX sandbox arguments and returns only validated PDF bytes', async () => {
    let generatedSource = '';
    const run = vi.fn(
      async (_executable: string, arguments_: readonly string[], options: { cwd: string }) => {
        expect(arguments_[0]).toBe('-p');
        expect(arguments_[1]).toContain('(deny network*)');
        if (arguments_.at(-1) === '-v') {
          return { stdout: 'Latexmk, Version 4.88', stderr: '' };
        }
        expect(arguments_).toContain('-xelatex');
        expect(arguments_).toContain('-latexoption=-no-shell-escape');
        expect(arguments_).toContain('./document.tex');
        generatedSource = await readFile(join(options.cwd, 'document.tex'), 'utf8');
        const output = arguments_.find((argument) => argument.startsWith('-outdir='))!.slice(8);
        await writeFile(join(output, 'document.pdf'), Buffer.from('%PDF-1.7\nfixture\n%%EOF'));
        return { stdout: '', stderr: '' };
      },
    );
    const compiler = new LectureDocumentCompiler({
      rootDirectory: () => join(root, 'artifacts'),
      engineCandidates: [engine],
      sandboxExecutable,
      run,
      platform: 'darwin',
    });
    const markdown = '# Notes\n\nCaptured evidence [M1].';

    const result = await compiler.compile({
      studioId: '11111111-1111-4111-8111-111111111111',
      revision: 2,
      title: 'Captured lecture',
      kind: 'lecture-notes',
      markdown,
      contentSha256: hash(markdown),
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      title: 'Lecture notes PDF',
      fileName: 'Lecture Notes.pdf',
      sizeBytes: 22,
      sourceDescription: 'Captured lecture · revision 2',
    });
    expect(Buffer.from(result.pdfBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(generatedSource).toContain('Captured evidence [M1].');
    expect(await readdir(join(root, 'artifacts'))).toEqual([]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('binds compilation to the exact revision content hash and rejects active content', async () => {
    const compiler = new LectureDocumentCompiler({
      rootDirectory: () => join(root, 'artifacts'),
      engineCandidates: [engine],
      sandboxExecutable,
      run: vi.fn(),
      platform: 'darwin',
    });
    const base = {
      studioId: '11111111-1111-4111-8111-111111111111',
      revision: 1,
      title: 'Lecture',
      kind: 'lecture-notes' as const,
    };

    await expect(
      compiler.compile({
        ...base,
        markdown: '# Notes',
        contentSha256: 'a'.repeat(64),
      }),
    ).rejects.toEqual(new LectureDocumentCompilerError('lecture_pdf_invalid'));
    const imageMarkdown = '# Notes\n\n![remote](https://example.com/a.png)';
    await expect(
      compiler.compile({
        ...base,
        markdown: imageMarkdown,
        contentSha256: hash(imageMarkdown),
      }),
    ).rejects.toMatchObject({ code: 'lecture_pdf_invalid' });
  });

  it('cleans only stale app-owned staging directories', async () => {
    const artifactRoot = join(root, 'artifacts');
    const stale = join(artifactRoot, '.compile-AbC123');
    const preserved = join(artifactRoot, 'keep-me');
    await mkdir(stale, { recursive: true });
    await writeFile(preserved, 'preserve');
    const compiler = new LectureDocumentCompiler({
      rootDirectory: () => artifactRoot,
      engineCandidates: [engine],
      sandboxExecutable,
      run: vi.fn(),
      platform: 'darwin',
    });

    await compiler.reconcileStaleStaging();

    await expect(access(stale)).rejects.toBeDefined();
    await expect(access(preserved)).resolves.toBeUndefined();
  });

  it.skipIf(!RUN_LOCAL_MACTEX_SMOKE)(
    'compiles Korean lecture notes and a multi-page Beamer deck with local MacTeX',
    async () => {
      let commandError: unknown;
      const compiler = new LectureDocumentCompiler({
        rootDirectory: () => join(root, 'artifacts'),
        engineCandidates: ['/Library/TeX/texbin/latexmk'],
        run: async (...arguments_) => {
          try {
            return await runLocalSmokeCommand(...arguments_);
          } catch (error) {
            commandError = error;
            throw error;
          }
        },
        platform: 'darwin',
      });
      const notes = LOCAL_MACTEX_SMOKE_NOTES_PATH
        ? await readFile(LOCAL_MACTEX_SMOKE_NOTES_PATH, 'utf8')
        : [
            '# 강의 노트',
            '',
            '정확한 증거 [M1]와 수식 $B\\asymp\\sqrt n$를 설명합니다.',
            '',
            '## 핵심 내용',
            '',
            '- 첫 번째 근거',
            '- 두 번째 근거',
            '',
            '$$',
            '\\begin{aligned}',
            '\\sup_z \\left|\\widehat F_{B,M}(z)-\\mathbb P\\{g(S_n)\\le z\\}\\right|',
            '&\\le \\frac{C}{\\sqrt M}+O_P(B^{-1}) \\\\',
            'S_{B,s} &\\rightsquigarrow_{\\#} N(0,\\Sigma).',
            '\\end{aligned}',
            '$$',
          ].join('\n');
      const slides = [
        '# 연구 개요',
        '',
        '정확한 원고 [M1]',
        '',
        '---',
        '',
        '# 결과',
        '',
        '- 개선 결과 [M1]',
        '',
        '$$',
        '\\widehat F_{B,M} \\xrightarrow{P} F, \\qquad B\\asymp\\sqrt n.',
        '$$',
        '',
        '---',
        '',
        '# 한계',
        '',
        '추가 검증이 필요합니다 [M1].',
      ].join('\n');

      const notePdf = await compiler
        .compile({
          studioId: '11111111-1111-4111-8111-111111111111',
          revision: 1,
          title: '한국어 강의',
          kind: 'lecture-notes',
          markdown: notes,
          contentSha256: hash(notes),
        })
        .catch((error: unknown) => {
          throw commandError ?? error;
        });
      const slidePdf = await compiler
        .compile({
          studioId: '11111111-1111-4111-8111-111111111111',
          revision: 1,
          title: '한국어 슬라이드',
          kind: 'slides',
          markdown: slides,
          contentSha256: hash(slides),
        })
        .catch((error: unknown) => {
          throw commandError ?? error;
        });

      expect(Buffer.from(notePdf.pdfBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
      expect(Buffer.from(slidePdf.pdfBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
      expect(notePdf.sizeBytes).toBeGreaterThan(1_000);
      expect(slidePdf.sizeBytes).toBeGreaterThan(1_000);
      const qaDirectory = process.env.GOSU_LECTURE_PDF_QA_DIRECTORY;
      if (qaDirectory) {
        await mkdir(qaDirectory, { recursive: true });
        await Promise.all([
          writeFile(join(qaDirectory, 'lecture-notes.pdf'), notePdf.pdfBase64, 'base64'),
          writeFile(join(qaDirectory, 'lecture-slides.pdf'), slidePdf.pdfBase64, 'base64'),
        ]);
      }
      expect(await readdir(join(root, 'artifacts'))).toEqual([]);
    },
    60_000,
  );
});
