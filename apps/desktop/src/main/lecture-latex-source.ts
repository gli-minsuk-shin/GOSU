const MAX_LECTURE_LATEX_CHARACTERS = 200_000;
const SOURCE_MARKER = '% GOSU-LECTURE-LATEX v1';
const CONTENT_BEGIN = '% GOSU-CONTENT-BEGIN';
const CONTENT_END = '% GOSU-CONTENT-END';

export type LectureLatexKind = 'lecture-notes' | 'slides';

export class LectureLatexSourceError extends Error {
  constructor() {
    super('lecture_latex_invalid');
    this.name = 'LectureLatexSourceError';
  }
}

const DOCUMENT_COMMAND = /\\(?:begin|end)\s*\{\s*document\s*\}|\\documentclass\b/iu;
const RAW_HTML_PATTERN = /<\s*(?:!--|\/?\s*[A-Za-z][^>]*>)/u;
const MARKDOWN_STRUCTURE_PATTERN = /(?:^|\n)\s*(?:#{1,6}\s+|```|~~~|---\s*(?:\n|$))/u;
const ENVIRONMENT_PATTERN = /\\(begin|end)\s*\{\s*([A-Za-z*]+)\s*\}/gu;
const COMMON_ENVIRONMENTS = new Set([
  'align',
  'align*',
  'aligned',
  'alignedat',
  'array',
  'Bmatrix',
  'bmatrix',
  'cases',
  'center',
  'description',
  'enumerate',
  'equation',
  'equation*',
  'gather',
  'gather*',
  'gathered',
  'itemize',
  'matrix',
  'multline',
  'multline*',
  'pmatrix',
  'quote',
  'smallmatrix',
  'split',
  'tabular',
  'Vmatrix',
  'vmatrix',
]);
const NOTES_ENVIRONMENTS = new Set([
  ...COMMON_ENVIRONMENTS,
  'definition',
  'example',
  'lemma',
  'longtable',
  'proof',
  'proposition',
  'remark',
  'theorem',
]);
const SLIDES_ENVIRONMENTS = new Set([
  ...COMMON_ENVIRONMENTS,
  'alertblock',
  'block',
  'column',
  'columns',
  'frame',
]);
const MATH_ENVIRONMENTS = new Set([
  'align',
  'align*',
  'aligned',
  'alignedat',
  'array',
  'Bmatrix',
  'bmatrix',
  'cases',
  'equation',
  'equation*',
  'gather',
  'gather*',
  'gathered',
  'matrix',
  'multline',
  'multline*',
  'pmatrix',
  'smallmatrix',
  'split',
  'Vmatrix',
  'vmatrix',
]);
const ALIGNMENT_ENVIRONMENTS = new Set([
  'align',
  'align*',
  'aligned',
  'alignedat',
  'array',
  'Bmatrix',
  'bmatrix',
  'cases',
  'gathered',
  'matrix',
  'pmatrix',
  'smallmatrix',
  'split',
  'tabular',
  'Vmatrix',
  'vmatrix',
]);

const COMMON_COMMANDS = new Set(
  `begin end section subsection subsubsection paragraph item textbf textit texttt textsc emph
  footnote label ref eqref pageref autoref cite top mid bottomrule multicolumn
  alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi
  pi varpi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma
  Upsilon Phi Psi Omega frac dfrac tfrac binom choose sqrt sum prod int iint iiint oint lim log ln exp sin cos
  tan max min argmax argmin arccos arcsin arctan csc deg det dim gcd hom inf ker Pr sec sup mathbb
  mathbf boldsymbol bm mathrm mathcal mathsf mathtt mathit mathfrak text textnormal operatorname mathop
  overline underline overbrace underbrace hat widehat widetilde tilde bar vec dot ddot overset
  underset stackrel substack limits nolimits left right big Big bigg Bigg bigl bigr Bigl Bigr biggl
  biggr Biggl Biggr cdot times div pm mp le leq ge geq gtrsim lesssim ll gg neq approx asymp cong
  propto sim simeq equiv in notin ni subset subseteq supset supseteq cup cap setminus emptyset
  varnothing forall exists nexists neg land lor implies iff to mapsto gets leftarrow rightarrow
  leftrightarrow Leftarrow Rightarrow Leftrightarrow longleftarrow longrightarrow
  longleftrightarrow hookrightarrow rightsquigarrow xrightarrow uparrow downarrow partial nabla
  infty ell ldots cdots vdots ddots dots prime top bot perp parallel mid vert Vert lVert rVert
  langle rangle lceil rceil lfloor rfloor pmod mod bmod coloneqq colon angle triangle square Box
  Diamond circ bullet star ast dagger ddagger oplus otimes odot oslash bigcup bigcap bigoplus
  bigotimes begin end quad qquad enspace hfill vfill smallskip medskip bigskip noindent centering
  linewidth columnwidth textwidth displaystyle textstyle scriptstyle scriptscriptstyle
  textbackslash textasciicircum textasciitilde normalsize small footnotesize scriptsize tiny
  Large LARGE huge Huge`.split(/\s+/u),
);
const NOTES_COMMANDS = COMMON_COMMANDS;
const SLIDES_COMMANDS = new Set([...COMMON_COMMANDS, 'alert', 'pause']);

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

function isEscaped(value: string, index: number) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function assertBalancedBraces(value: string) {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '{' && !isEscaped(value, index)) depth += 1;
    if (value[index] === '}' && !isEscaped(value, index)) depth -= 1;
    if (depth < 0 || depth > 256) throw new LectureLatexSourceError();
  }
  if (depth !== 0) throw new LectureLatexSourceError();
}

function assertEnvironments(value: string, kind: LectureLatexKind) {
  const allowedEnvironments = kind === 'lecture-notes' ? NOTES_ENVIRONMENTS : SLIDES_ENVIRONMENTS;
  const stack: string[] = [];
  for (const match of value.matchAll(ENVIRONMENT_PATTERN)) {
    const operation = match[1]!;
    const environment = match[2]!;
    if (!allowedEnvironments.has(environment)) throw new LectureLatexSourceError();
    if (operation === 'begin') stack.push(environment);
    else if (stack.pop() !== environment) throw new LectureLatexSourceError();
  }
  if (stack.length > 0) throw new LectureLatexSourceError();
}

function assertCommands(value: string, kind: LectureLatexKind) {
  const allowedCommands = kind === 'lecture-notes' ? NOTES_COMMANDS : SLIDES_COMMANDS;
  for (const match of value.matchAll(/\\([A-Za-z]+|[^A-Za-z\s])/gu)) {
    const command = match[1]!;
    if (/^[A-Za-z]+$/u.test(command)) {
      if (!allowedCommands.has(command)) throw new LectureLatexSourceError();
    } else if (!'\\,;!:#$%&_{} '.includes(command)) {
      throw new LectureLatexSourceError();
    }
  }
}

function assertMathAndSpecialCharacters(value: string) {
  const events = new Map<
    number,
    Readonly<{ operation: string; environment: string; end: number }>
  >();
  for (const match of value.matchAll(ENVIRONMENT_PATTERN)) {
    if (match.index === undefined) continue;
    events.set(match.index, {
      operation: match[1]!,
      environment: match[2]!,
      end: match.index + match[0].length,
    });
  }
  const environments: string[] = [];
  let delimiter: 'inline' | 'display' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const event = events.get(index);
    if (event) {
      if (event.operation === 'begin') environments.push(event.environment);
      else environments.pop();
      index = event.end - 1;
      continue;
    }
    const character = value[index]!;
    if (character === '$' && !isEscaped(value, index)) {
      const display = value[index + 1] === '$' && !isEscaped(value, index + 1);
      const nextDelimiter = display ? 'display' : 'inline';
      if (environments.some((environment) => MATH_ENVIRONMENTS.has(environment))) {
        throw new LectureLatexSourceError();
      }
      if (delimiter === null) delimiter = nextDelimiter;
      else if (delimiter === nextDelimiter) delimiter = null;
      else throw new LectureLatexSourceError();
      if (display) index += 1;
      continue;
    }
    if (isEscaped(value, index)) continue;
    const inMath =
      delimiter !== null || environments.some((environment) => MATH_ENVIRONMENTS.has(environment));
    if ((character === '_' || character === '^') && !inMath) {
      throw new LectureLatexSourceError();
    }
    if (
      character === '&' &&
      !environments.some((environment) => ALIGNMENT_ENVIRONMENTS.has(environment))
    ) {
      throw new LectureLatexSourceError();
    }
    if (character === '~') throw new LectureLatexSourceError();
  }
  if (delimiter !== null) throw new LectureLatexSourceError();
}

type LectureLatexValidationOptions = Readonly<{
  requireSourcesUsed?: boolean;
}>;

export function validateLectureLatexBody(
  kind: LectureLatexKind,
  rawBody: string,
  options: LectureLatexValidationOptions = {},
) {
  const body = rawBody.trim();
  if (
    body.length < 1 ||
    body.length > MAX_LECTURE_LATEX_CHARACTERS ||
    [...body].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    }) ||
    body.includes('^^') ||
    RAW_HTML_PATTERN.test(body) ||
    MARKDOWN_STRUCTURE_PATTERN.test(body) ||
    DOCUMENT_COMMAND.test(body)
  ) {
    throw new LectureLatexSourceError();
  }
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if ((character === '%' || character === '#') && !isEscaped(body, index)) {
      throw new LectureLatexSourceError();
    }
  }
  assertBalancedBraces(body);
  assertEnvironments(body, kind);
  assertCommands(body, kind);
  assertMathAndSpecialCharacters(body);
  if (kind === 'lecture-notes') {
    if (options.requireSourcesUsed !== false && !findLectureSourcesUsedSection(body)) {
      throw new LectureLatexSourceError();
    }
  } else {
    const frames = [...body.matchAll(/\\begin\s*\{\s*frame\s*\}/gu)];
    if (frames.length < 1) throw new LectureLatexSourceError();
  }
  return body;
}

export function findLectureSourcesUsedSection(body: string) {
  const match = /\\section\s*\*?\s*\{\s*Sources used\s*\}/iu.exec(body);
  return match?.index === undefined
    ? null
    : { index: match.index, end: match.index + match[0].length };
}

function notesPrefix(title: string) {
  return [
    `${SOURCE_MARKER} lecture-notes`,
    '\\documentclass[11pt]{article}',
    '\\usepackage{fontspec}',
    '\\usepackage{kotex}',
    '\\usepackage{amsmath,amssymb,mathtools}',
    '\\usepackage{amsthm}',
    '\\usepackage{bm}',
    '\\usepackage{booktabs,array,longtable}',
    '\\usepackage[margin=1in]{geometry}',
    '\\usepackage[hidelinks]{hyperref}',
    '\\newtheorem{theorem}{Theorem}',
    '\\newtheorem{proposition}{Proposition}',
    '\\newtheorem{lemma}{Lemma}',
    '\\newtheorem{definition}{Definition}',
    '\\newtheorem{remark}{Remark}',
    '\\newtheorem{example}{Example}',
    `\\title{${escapeLatex(title)}}`,
    '\\author{GOSU Lecture Studio}',
    '\\date{}',
    '\\begin{document}',
    '\\maketitle',
    CONTENT_BEGIN,
  ].join('\n');
}

function slidesPrefix(title: string) {
  return [
    `${SOURCE_MARKER} slides`,
    '\\documentclass[aspectratio=169]{beamer}',
    '\\usepackage{fontspec}',
    '\\usepackage{kotex}',
    '\\usepackage{amsmath,amssymb,mathtools}',
    '\\usepackage{bm}',
    '\\usepackage{booktabs,array}',
    '\\usetheme{default}',
    '\\setbeamertemplate{navigation symbols}{}',
    '\\setbeamertemplate{footline}[frame number]',
    `\\title{${escapeLatex(title)}}`,
    '\\author{GOSU Lecture Studio}',
    '\\date{}',
    '\\begin{document}',
    '\\begin{frame}',
    '\\titlepage',
    '\\end{frame}',
    CONTENT_BEGIN,
  ].join('\n');
}

function prefix(kind: LectureLatexKind, title: string) {
  return kind === 'lecture-notes' ? notesPrefix(title) : slidesPrefix(title);
}

const SUFFIX = `${CONTENT_END}\n\\end{document}\n`;

export function buildLectureLatexDocument(kind: LectureLatexKind, title: string, rawBody: string) {
  const normalizedTitle = title.trim();
  if (normalizedTitle.length < 1 || normalizedTitle.length > 256) {
    throw new LectureLatexSourceError();
  }
  const body = validateLectureLatexBody(kind, rawBody);
  return `${prefix(kind, normalizedTitle)}\n${body}\n${SUFFIX}`;
}

export function validateCanonicalLectureLatex(
  kind: LectureLatexKind,
  title: string,
  source: string,
) {
  const expectedPrefix = `${prefix(kind, title.trim())}\n`;
  if (!source.startsWith(expectedPrefix) || !source.endsWith(SUFFIX)) {
    throw new LectureLatexSourceError();
  }
  const body = source.slice(expectedPrefix.length, -SUFFIX.length).replace(/\n$/u, '');
  const normalized = buildLectureLatexDocument(kind, title, body);
  if (normalized !== source) throw new LectureLatexSourceError();
  return source;
}

export function countLectureSlidePages(slidesLatexBody: string) {
  return 1 + [...slidesLatexBody.matchAll(/\\begin\s*\{\s*frame\s*\}/gu)].length;
}
