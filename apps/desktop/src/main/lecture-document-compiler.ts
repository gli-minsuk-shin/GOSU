import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import { PdfPreviewDocumentSchema, type PdfPreviewDocument } from '../shared/pdf-preview-contracts';
import {
  createManuscriptPdfCommandRunner,
  manuscriptLatexSandboxProfile,
  type ManuscriptPdfCommandRunner,
} from './manuscript-pdf-compiler';

const MAX_MARKDOWN_CHARACTERS = 200_000;
const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_COMPILER_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_GENERATED_BYTES = 192 * 1024 * 1024;
const COMPILE_TIMEOUT_MS = 120_000;
const VERSION_TIMEOUT_MS = 10_000;
const MAX_VERSION_OUTPUT_BYTES = 64 * 1024;
const STALE_COMPILE_DIRECTORY = /^\.compile-[A-Za-z0-9]{6}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RAW_HTML_PATTERN = /<\s*(?:!--|\/?\s*[A-Za-z][^>]*>)/u;
const MARKDOWN_IMAGE_PATTERN = /!\s*\[/u;

export type LectureDocumentKind = 'lecture-notes' | 'slides';

export type CompileLectureDocumentInput = Readonly<{
  studioId: string;
  revision: number;
  title: string;
  kind: LectureDocumentKind;
  markdown: string;
  contentSha256: string;
}>;

export type LectureDocumentCompilerErrorCode =
  | 'lecture_pdf_compiler_unavailable'
  | 'lecture_pdf_compile_failed'
  | 'lecture_pdf_too_large'
  | 'lecture_pdf_invalid';

export class LectureDocumentCompilerError extends Error {
  constructor(readonly code: LectureDocumentCompilerErrorCode) {
    super(code);
    this.name = 'LectureDocumentCompilerError';
  }
}

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function validateInput(input: CompileLectureDocumentInput) {
  if (
    !UUID_PATTERN.test(input.studioId) ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    input.title.trim().length < 1 ||
    input.title.trim().length > 256 ||
    (input.kind !== 'lecture-notes' && input.kind !== 'slides') ||
    input.markdown.length < 1 ||
    input.markdown.length > MAX_MARKDOWN_CHARACTERS ||
    !/^[a-f0-9]{64}$/u.test(input.contentSha256) ||
    sha256(input.markdown) !== input.contentSha256 ||
    RAW_HTML_PATTERN.test(input.markdown) ||
    MARKDOWN_IMAGE_PATTERN.test(input.markdown)
  ) {
    throw new LectureDocumentCompilerError('lecture_pdf_invalid');
  }
  return { ...input, title: input.title.trim() };
}

function escapeLatex(value: string) {
  const replacements: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '{': '\\{',
    '}': '\\}',
    '#': '\\#',
    $: '\\$',
    '%': '\\%',
    '&': '\\&',
    _: '\\_',
    '^': '\\textasciicircum{}',
    '~': '\\textasciitilde{}',
  };
  return [...value].map((character) => replacements[character] ?? character).join('');
}

const SAFE_MATH_COMMANDS = new Set([
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'varepsilon',
  'zeta',
  'eta',
  'theta',
  'vartheta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'pi',
  'varpi',
  'rho',
  'sigma',
  'tau',
  'upsilon',
  'phi',
  'varphi',
  'chi',
  'psi',
  'omega',
  'Gamma',
  'Delta',
  'Theta',
  'Lambda',
  'Xi',
  'Pi',
  'Sigma',
  'Upsilon',
  'Phi',
  'Psi',
  'Omega',
  'frac',
  'sqrt',
  'sum',
  'prod',
  'int',
  'oint',
  'lim',
  'log',
  'ln',
  'exp',
  'sin',
  'cos',
  'tan',
  'max',
  'min',
  'argmax',
  'argmin',
  'mathbb',
  'mathbf',
  'mathrm',
  'mathcal',
  'mathsf',
  'text',
  'operatorname',
  'overline',
  'underline',
  'hat',
  'bar',
  'vec',
  'dot',
  'ddot',
  'left',
  'right',
  'big',
  'Big',
  'bigl',
  'bigr',
  'cdot',
  'times',
  'div',
  'pm',
  'mp',
  'le',
  'leq',
  'ge',
  'geq',
  'neq',
  'approx',
  'equiv',
  'in',
  'notin',
  'subset',
  'supset',
  'subseteq',
  'supseteq',
  'cup',
  'cap',
  'to',
  'mapsto',
  'infty',
  'partial',
  'nabla',
  'forall',
  'exists',
  'neg',
  'land',
  'lor',
  'implies',
  'iff',
  'quad',
  'qquad',
  'ldots',
  'cdots',
  'vdots',
  'ddots',
  'begin',
  'end',
]);

const SAFE_MATH_ENVIRONMENTS = new Set(['aligned', 'matrix', 'pmatrix', 'bmatrix', 'cases']);

function safeMath(value: string) {
  if (value.length > 8_000 || /[%$#~]/u.test(value)) return null;
  let depth = 0;
  for (const character of value) {
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth < 0 || depth > 64) return null;
  }
  if (depth !== 0) return null;
  const commands = [...value.matchAll(/\\([A-Za-z]+)/gu)].map((match) => match[1]!);
  if (commands.some((command) => !SAFE_MATH_COMMANDS.has(command))) return null;
  const environments = [...value.matchAll(/\\(?:begin|end)\{([^}]+)\}/gu)].map(
    (match) => match[1]!,
  );
  if (environments.some((environment) => !SAFE_MATH_ENVIRONMENTS.has(environment))) return null;
  return value;
}

function renderInline(source: string) {
  let rendered = '';
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('**', index)) {
      const end = source.indexOf('**', index + 2);
      if (end > index + 2) {
        rendered += `\\textbf{${renderInline(source.slice(index + 2, end))}}`;
        index = end + 2;
        continue;
      }
    }
    if (source[index] === '`') {
      const end = source.indexOf('`', index + 1);
      if (end > index + 1) {
        rendered += `\\texttt{${escapeLatex(source.slice(index + 1, end))}}`;
        index = end + 1;
        continue;
      }
    }
    if (source[index] === '$' && source[index + 1] !== '$') {
      const end = source.indexOf('$', index + 1);
      if (end > index + 1) {
        const math = safeMath(source.slice(index + 1, end));
        rendered += math === null ? escapeLatex(source.slice(index, end + 1)) : `$${math}$`;
        index = end + 1;
        continue;
      }
    }
    if (source[index] === '[') {
      const labelEnd = source.indexOf('](', index + 1);
      const urlEnd = labelEnd < 0 ? -1 : source.indexOf(')', labelEnd + 2);
      if (labelEnd > index + 1 && urlEnd > labelEnd + 2) {
        rendered += `${renderInline(source.slice(index + 1, labelEnd))} (${escapeLatex(source.slice(labelEnd + 2, urlEnd))})`;
        index = urlEnd + 1;
        continue;
      }
    }
    if (source[index] === '*' && source[index + 1] !== '*') {
      const end = source.indexOf('*', index + 1);
      if (end > index + 1) {
        rendered += `\\emph{${renderInline(source.slice(index + 1, end))}}`;
        index = end + 1;
        continue;
      }
    }
    rendered += escapeLatex(source[index]!);
    index += 1;
  }
  return rendered;
}

function renderMarkdownBody(markdown: string, headingOffset = 0) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const output: string[] = [];
  let paragraph: string[] = [];
  let list: 'itemize' | 'enumerate' | null = null;
  let blockMath: string[] | null = null;
  let codeFence: string[] | null = null;

  const closeParagraph = () => {
    if (paragraph.length > 0) {
      output.push(renderInline(paragraph.join(' ').trim()), '');
      paragraph = [];
    }
  };
  const closeList = () => {
    if (list) output.push(`\\end{${list}}`, '');
    list = null;
  };
  const closeFlow = () => {
    closeParagraph();
    closeList();
  };

  for (const line of lines) {
    if (codeFence !== null) {
      if (/^\s*```/u.test(line)) {
        output.push(
          '\\begin{quote}\\small\\ttfamily',
          ...codeFence.map((item) => `${escapeLatex(item)}\\\\`),
          '\\end{quote}',
          '',
        );
        codeFence = null;
      } else {
        codeFence.push(line);
      }
      continue;
    }
    if (blockMath !== null) {
      if (/^\s*\$\$\s*$/u.test(line)) {
        const math = safeMath(blockMath.join('\n'));
        output.push(
          math === null
            ? `\\begin{quote}\\ttfamily ${escapeLatex(blockMath.join(' '))}\\end{quote}`
            : `\\[${math}\\]`,
          '',
        );
        blockMath = null;
      } else {
        blockMath.push(line);
      }
      continue;
    }
    if (/^\s*```/u.test(line)) {
      closeFlow();
      codeFence = [];
      continue;
    }
    if (/^\s*\$\$\s*$/u.test(line)) {
      closeFlow();
      blockMath = [];
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      closeFlow();
      const level = Math.min(3, heading[1]!.length + headingOffset);
      const command = level <= 1 ? 'section' : level === 2 ? 'subsection' : 'subsubsection';
      output.push(`\\${command}*{${renderInline(heading[2]!.trim())}}`, '');
      continue;
    }
    const unordered = /^\s*[-*+]\s+(.+)$/u.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/u.exec(line);
    if (unordered || ordered) {
      closeParagraph();
      const requestedList = unordered ? 'itemize' : 'enumerate';
      if (list !== requestedList) {
        closeList();
        list = requestedList;
        output.push(`\\begin{${list}}`);
      }
      output.push(`\\item ${renderInline((unordered ?? ordered)![1]!.trim())}`);
      continue;
    }
    if (/^\s*[-:| ]+\s*$/u.test(line) && line.includes('|')) {
      closeFlow();
      continue;
    }
    if (line.includes('|') && line.trim().startsWith('|')) {
      closeFlow();
      output.push(`\\noindent\\texttt{${escapeLatex(line.trim())}}\\par`, '');
      continue;
    }
    const quote = /^\s*>\s?(.*)$/u.exec(line);
    if (quote) {
      closeFlow();
      output.push(`\\begin{quote}${renderInline(quote[1]!)}\\end{quote}`, '');
      continue;
    }
    if (line.trim() === '') {
      closeFlow();
      continue;
    }
    paragraph.push(line.trim());
  }
  if (codeFence !== null) {
    output.push(
      '\\begin{quote}\\small\\ttfamily',
      ...codeFence.map((item) => `${escapeLatex(item)}\\\\`),
      '\\end{quote}',
    );
  }
  if (blockMath !== null) {
    output.push(`\\begin{quote}\\ttfamily ${escapeLatex(blockMath.join(' '))}\\end{quote}`);
  }
  closeFlow();
  return output.join('\n').trim();
}

function articleLatex(title: string, markdown: string) {
  return [
    '\\documentclass[11pt]{article}',
    '\\usepackage[margin=1in]{geometry}',
    '\\usepackage{fontspec}',
    '\\usepackage{kotex}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage[hidelinks]{hyperref}',
    '\\setlength{\\parindent}{0pt}',
    '\\setlength{\\parskip}{0.7em}',
    '\\sloppy',
    `\\title{${escapeLatex(title)}}`,
    '\\author{GOSU Lecture Studio}',
    '\\date{}',
    '\\begin{document}',
    '\\maketitle',
    renderMarkdownBody(markdown, 0),
    '\\end{document}',
    '',
  ].join('\n');
}

function slideTitleAndBody(markdown: string, index: number) {
  const lines = markdown.trim().split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s+\S/u.test(line));
  if (headingIndex < 0) return { title: `Slide ${index + 1}`, body: markdown.trim() };
  const match = /^#{1,6}\s+(.+)$/u.exec(lines[headingIndex]!)!;
  return {
    title: match[1]!.trim(),
    body: lines
      .filter((_line, lineIndex) => lineIndex !== headingIndex)
      .join('\n')
      .trim(),
  };
}

function slidesLatex(title: string, markdown: string) {
  const slides = markdown
    .split(/^\s*---\s*$/mu)
    .map((slide) => slide.trim())
    .filter(Boolean)
    .map(slideTitleAndBody);
  if (slides.length === 0) throw new LectureDocumentCompilerError('lecture_pdf_invalid');
  const frames = slides.map((slide, index) => {
    if (index === 0 && slide.body === '') {
      return [
        `\\title{${escapeLatex(slide.title)}}`,
        '\\author{GOSU Lecture Studio}',
        '\\date{}',
        '\\begin{frame}',
        '\\titlepage',
        '\\end{frame}',
      ].join('\n');
    }
    return [
      `\\begin{frame}[t]{${escapeLatex(slide.title)}}`,
      '\\small',
      renderMarkdownBody(slide.body, 1),
      '\\end{frame}',
    ].join('\n');
  });
  return [
    '\\documentclass[aspectratio=169]{beamer}',
    '\\usepackage{fontspec}',
    '\\usepackage{kotex}',
    '\\usepackage{amsmath,amssymb}',
    '\\usetheme{default}',
    '\\setbeamertemplate{navigation symbols}{}',
    '\\setbeamertemplate{footline}[frame number]',
    `\\hypersetup{hidelinks,pdftitle={${escapeLatex(title)}}}`,
    '\\begin{document}',
    ...frames,
    '\\end{document}',
    '',
  ].join('\n');
}

export function lectureMarkdownToLatex(kind: LectureDocumentKind, title: string, markdown: string) {
  return kind === 'lecture-notes' ? articleLatex(title, markdown) : slidesLatex(title, markdown);
}

function compilerVersion(output: string) {
  const line = output
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => /latexmk/iu.test(candidate));
  return (line || 'latexmk').slice(0, 128);
}

function minimalCompilerEnvironment(engineDirectory: string, home: string, output: string) {
  return {
    PATH: `${engineDirectory}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: home,
    TMPDIR: join(home, 'tmp'),
    LANG: 'C.UTF-8',
    LC_ALL: 'C',
    TEXMFHOME: join(home, 'texmf'),
    TEXMFVAR: join(home, 'texmf-var'),
    TEXMFCONFIG: join(home, 'texmf-config'),
    TEXMFOUTPUT: output,
    openin_any: 'p',
    openout_any: 'p',
    shell_escape: 'f',
  } satisfies NodeJS.ProcessEnv;
}

export class LectureDocumentCompiler {
  private readonly rootDirectory: () => string;
  private readonly engineCandidates: readonly string[];
  private readonly sandboxExecutable: string;
  private readonly run: ManuscriptPdfCommandRunner;
  private readonly commandRunner: ReturnType<typeof createManuscriptPdfCommandRunner> | null;
  private readonly platform: NodeJS.Platform;

  constructor(
    options: Readonly<{
      rootDirectory: () => string;
      engineCandidates?: readonly string[];
      sandboxExecutable?: string;
      run?: ManuscriptPdfCommandRunner;
      platform?: NodeJS.Platform;
    }>,
  ) {
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

  dispose() {
    this.commandRunner?.dispose();
  }

  async reconcileStaleStaging() {
    const root = await this.requireRoot();
    const entries = await readdir(root, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isDirectory() || !STALE_COMPILE_DIRECTORY.test(entry.name)) return;
        const candidate = join(root, entry.name);
        const metadata = await lstat(candidate).catch(() => null);
        if (!metadata?.isDirectory() || metadata.isSymbolicLink()) return;
        await rm(candidate, { recursive: true, force: true });
      }),
    );
  }

  async compile(rawInput: CompileLectureDocumentInput): Promise<PdfPreviewDocument> {
    const input = validateInput(rawInput);
    if (this.platform !== 'darwin') {
      throw new LectureDocumentCompilerError('lecture_pdf_compiler_unavailable');
    }
    const [engine, root] = await Promise.all([this.resolveEngine(), this.requireRoot()]);
    await this.requireSandbox();
    const work = await mkdtemp(join(root, '.compile-'));
    const source = join(work, 'source');
    const output = join(work, 'output');
    const home = join(work, 'home');
    try {
      await Promise.all([
        mkdir(source, { recursive: true, mode: 0o700 }),
        mkdir(output, { recursive: true, mode: 0o700 }),
        mkdir(join(home, 'tmp'), { recursive: true, mode: 0o700 }),
      ]);
      await writeFile(
        join(source, 'document.tex'),
        lectureMarkdownToLatex(input.kind, input.title, input.markdown),
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      const environment = minimalCompilerEnvironment(dirname(engine), home, output);
      const profile = manuscriptLatexSandboxProfile(source, work);
      const version = await this.run(
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
          '-xelatex',
          '-cd-',
          `-outdir=${output}`,
          `-auxdir=${output}`,
          '-interaction=nonstopmode',
          '-halt-on-error',
          '-file-line-error',
          '-latexoption=-no-shell-escape',
          './document.tex',
        ],
        {
          cwd: source,
          env: environment,
          timeoutMs: COMPILE_TIMEOUT_MS,
          maxBytes: MAX_COMPILER_OUTPUT_BYTES,
          resourceDirectories: [output, home],
          maxResourceBytes: MAX_GENERATED_BYTES,
        },
      );
      const bytes = await this.readPdf(join(output, 'document.pdf'));
      return PdfPreviewDocumentSchema.parse({
        schemaVersion: 1,
        artifactId: randomUUID(),
        title: input.kind === 'lecture-notes' ? 'Lecture notes PDF' : 'Slides PDF',
        fileName: input.kind === 'lecture-notes' ? 'Lecture Notes.pdf' : 'Slides.pdf',
        compilerDisplayName: `Local XeLaTeX via ${compilerVersion(`${version.stdout}\n${version.stderr}`)}`,
        sourceDescription: `${input.title} · revision ${input.revision}`,
        pdfSha256: `sha256:${sha256(bytes)}`,
        sizeBytes: bytes.byteLength,
        compiledAt: new Date().toISOString(),
        pdfBase64: bytes.toString('base64'),
      });
    } catch (error) {
      if (error instanceof LectureDocumentCompilerError) throw error;
      throw new LectureDocumentCompilerError('lecture_pdf_compile_failed');
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async requireRoot() {
    const root = this.rootDirectory();
    if (!isAbsolute(root)) {
      throw new LectureDocumentCompilerError('lecture_pdf_compile_failed');
    }
    await mkdir(root, { recursive: true, mode: 0o700 });
    return realpath(root);
  }

  private async resolveEngine() {
    for (const candidate of this.engineCandidates) {
      if (!isAbsolute(candidate)) continue;
      try {
        await access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // Try the next fixed local TeX installation path.
      }
    }
    throw new LectureDocumentCompilerError('lecture_pdf_compiler_unavailable');
  }

  private async requireSandbox() {
    if (!isAbsolute(this.sandboxExecutable)) {
      throw new LectureDocumentCompilerError('lecture_pdf_compiler_unavailable');
    }
    try {
      await access(this.sandboxExecutable, fsConstants.X_OK);
    } catch {
      throw new LectureDocumentCompilerError('lecture_pdf_compiler_unavailable');
    }
  }

  private async readPdf(path: string) {
    const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW).catch(() => {
      throw new LectureDocumentCompilerError('lecture_pdf_compile_failed');
    });
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size < 8) {
        throw new LectureDocumentCompilerError('lecture_pdf_invalid');
      }
      if (metadata.size > MAX_PDF_BYTES) {
        throw new LectureDocumentCompilerError('lecture_pdf_too_large');
      }
      const bytes = Buffer.allocUnsafe(metadata.size);
      let offset = 0;
      while (offset < metadata.size) {
        const read = await handle.read(bytes, offset, metadata.size - offset, offset);
        if (read.bytesRead === 0) break;
        offset += read.bytesRead;
      }
      if (offset !== metadata.size || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new LectureDocumentCompilerError('lecture_pdf_invalid');
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }
}
