const MAX_LECTURE_LATEX_CHARACTERS = 200_000;
const SOURCE_MARKER = '% GOSU-LECTURE-LATEX v1';
const CONTENT_BEGIN = '% GOSU-CONTENT-BEGIN';
const CONTENT_END = '% GOSU-CONTENT-END';

export type LectureLatexKind = 'lecture-notes' | 'slides';

export const LECTURE_LATEX_VALIDATION_REASON_GUIDANCE = {
  empty_body: 'Return a non-empty LaTeX body.',
  body_too_large: 'Shorten the body to the configured size limit.',
  control_character: 'Remove control characters from the body.',
  tex_caret_escape: 'Do not use TeX ^^ character escapes.',
  raw_html: 'Remove HTML and express the content with the bounded LaTeX dialect.',
  markdown_structure: 'Remove Markdown headings, fences, and horizontal rules.',
  document_wrapper: 'Return only the body; GOSU owns the document class and wrapper.',
  raw_comment: 'Escape literal percent signs as \\% and do not emit comments.',
  raw_parameter: 'Escape literal hash signs as \\# and do not emit macro parameters.',
  beamer_overlay: 'Remove Beamer overlays so one frame always produces exactly one PDF page.',
  beamer_multipage_frame:
    'Remove allowframebreaks; split the content into explicit single-page frame environments.',
  beamer_frame_option:
    'Remove optional frame arguments and express the title as \\begin{frame}{Title}.',
  unbalanced_braces: 'Balance every unescaped opening and closing brace.',
  malformed_environment: 'Use complete \\begin{...} and \\end{...} commands.',
  unsupported_environment: 'Replace unsupported environments with an allowed environment.',
  unbalanced_environment: 'Properly nest and balance every environment.',
  unsupported_command: 'Replace unsupported commands with commands from the bounded dialect.',
  unsupported_escape: 'Remove unsupported single-character TeX escapes.',
  math_delimiter_in_math_environment:
    'Do not add dollar or command math delimiters inside a math environment.',
  unbalanced_math: 'Balance $, $$, \\(...\\), and \\[...\\] without mixing delimiter styles.',
  raw_subscript_or_superscript: 'Keep _ and ^ inside math, or escape them for prose.',
  raw_alignment_character: 'Use raw & only inside an alignment or table environment.',
  raw_tilde: 'Replace raw ~ with a space or \\textasciitilde{}.',
  missing_sources_used: 'Finish the notes with a Sources used section.',
  missing_frame: 'Return at least one complete frame in the slides body.',
  invalid_title: 'Return a valid bounded lecture title.',
  invalid_canonical_wrapper: 'Keep the exact GOSU-owned document wrapper unchanged.',
} as const;

export type LectureLatexValidationReason = keyof typeof LECTURE_LATEX_VALIDATION_REASON_GUIDANCE;

function normalizedDiagnosticToken(reason: LectureLatexValidationReason, rawToken: string | null) {
  if (rawToken === null) return null;
  if (reason === 'unsupported_command' && /^[A-Za-z]{1,64}$/u.test(rawToken)) {
    return `\\${rawToken}`;
  }
  if (reason === 'unsupported_environment' && /^[A-Za-z][A-Za-z0-9*]{0,63}$/u.test(rawToken)) {
    return rawToken;
  }
  if (reason === 'unsupported_escape' && /^[!-~]$/u.test(rawToken)) {
    return `\\${rawToken}`;
  }
  return null;
}

const MAX_LECTURE_LATEX_DIAGNOSTIC_TOKENS = 8;

export class LectureLatexSourceError extends Error {
  readonly token: string | null;
  readonly tokens: readonly string[];

  constructor(
    readonly reason: LectureLatexValidationReason = 'invalid_canonical_wrapper',
    rawTokens: string | readonly string[] | null = null,
  ) {
    super('lecture_latex_invalid');
    this.name = 'LectureLatexSourceError';
    this.tokens = [
      ...new Set(
        (typeof rawTokens === 'string' ? [rawTokens] : (rawTokens ?? []))
          .map((token) => normalizedDiagnosticToken(reason, token))
          .filter((token): token is string => token !== null),
      ),
    ].slice(0, MAX_LECTURE_LATEX_DIAGNOSTIC_TOKENS);
    this.token = this.tokens[0] ?? null;
  }
}

const DOCUMENT_COMMAND = /\\(?:begin|end)\s*\{\s*document\s*\}|\\documentclass\b/iu;
const RAW_HTML_COMMENT_PATTERN = /<!--/u;
const RAW_HTML_TAG_PATTERN = /<\/?[A-Za-z][A-Za-z0-9:-]{0,63}(?:\s+[^<>]*?)?\s*\/?>/gu;
const MARKDOWN_STRUCTURE_PATTERN = /(?:^|\n)\s*(?:#{1,6}\s+|```|~~~|---\s*(?:\n|$))/u;
const ENVIRONMENT_COMMAND_PATTERN = /\\(?:begin|end)\b/gu;
const ENVIRONMENT_PATTERN = /\\(begin|end)\s*\{\s*([^{}\r\n]+?)\s*\}/gu;
const SLIDE_OVERLAY_COMMAND_PATTERN =
  /\\(?:pause|only|uncover|visible|invisible|onslide|alt|temporal)\b|\\(?:item|alert|textbf|textit|textsl|texttt|textsc|emph|footnote|frametitle|framesubtitle)\s*<[^<>]*>/u;
const SLIDE_ANGLE_SPEC_PATTERN = /<[^<>]*>/gu;
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
  'displaymath',
  'enumerate',
  'equation',
  'equation*',
  'gather',
  'gather*',
  'gathered',
  'flushleft',
  'flushright',
  'itemize',
  'matrix',
  'multline',
  'multline*',
  'minipage',
  'pmatrix',
  'quote',
  'smallmatrix',
  'split',
  'table',
  'tabular',
  'Vmatrix',
  'vmatrix',
]);
const NOTES_ENVIRONMENTS = new Set([
  ...COMMON_ENVIRONMENTS,
  'definition',
  'example',
  'abstract',
  'lemma',
  'longtable',
  'proof',
  'proposition',
  'remark',
  'theorem',
  'table*',
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
  'displaymath',
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
  textrm textsf textmd textup textsl textnormal textsuperscript textsubscript footnote label ref
  eqref pageref autoref cite top mid toprule midrule bottomrule cmidrule addlinespace hline cline multicolumn
  caption appendix tableofcontents newline linebreak raggedright raggedleft
  alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi
  pi varpi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma
  Upsilon Phi Psi Omega varsigma varrho frac dfrac tfrac binom choose genfrac sqrt sum prod int iint iiint oint lim log ln exp sin cos
  tan sinh cosh tanh coth max min argmax argmin arccos arcsin arctan csc deg det dim gcd hom inf ker Pr sec sup mathbb
  mathbf boldsymbol bm mathrm mathcal mathsf mathtt mathit mathfrak text textnormal operatorname mathop
  overline underline overbrace underbrace hat widehat widetilde tilde bar vec dot ddot overset
  check breve acute grave boxed phantom hphantom vphantom smash underset stackrel substack limits nolimits not tag notag nonumber intertext shortintertext left right big Big bigg Bigg bigl bigr Bigl Bigr biggl
  biggr Biggl Biggr cdot times div pm mp le leq ge geq gtrsim lesssim ll gg neq approx asymp cong
  propto sim simeq equiv doteq prec preceq succ succeq in notin ni subset subseteq supset supseteq cup cap setminus emptyset
  varnothing forall exists nexists neg land lor wedge vee bigwedge bigvee implies iff to mapsto gets leftarrow rightarrow
  leftrightarrow Leftarrow Rightarrow Leftrightarrow longleftarrow longrightarrow
  longleftrightarrow hookrightarrow rightsquigarrow xrightarrow xleftarrow uparrow downarrow partial nabla
  infty ell ldots cdots vdots ddots dots prime top bot perp parallel mid vert Vert lVert rVert
  langle rangle lceil rceil lfloor rfloor pmod mod bmod coloneqq colon angle triangle square Box
  Diamond circ bullet star ast dagger ddagger oplus otimes odot oslash bigcup bigcap bigoplus
  bigotimes begin end quad qquad enspace hfill vfill smallskip medskip bigskip noindent centering
  linewidth columnwidth textwidth displaystyle textstyle scriptstyle scriptscriptstyle par
  textbackslash textasciicircum textasciitilde normalsize small footnotesize scriptsize tiny
  Large LARGE huge Huge`.split(/\s+/u),
);
const NOTES_COMMANDS = COMMON_COMMANDS;
const SLIDES_COMMANDS = new Set([
  ...COMMON_COMMANDS,
  'alert',
  'frametitle',
  'framesubtitle',
  'sectionpage',
  'subsectionpage',
  // Retained only so exact already-committed canonical artifacts can be reopened.
  // New bodies reject it before command validation as a multipage Beamer overlay.
  'pause',
]);

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

function hasPatternOutsideMath(value: string, pattern: RegExp) {
  const matchStarts = new Set(
    [...value.matchAll(pattern)]
      .map((match) => match.index)
      .filter((index): index is number => index !== undefined),
  );
  if (matchStarts.size === 0) return false;

  const environmentEvents = new Map<
    number,
    Readonly<{ operation: string; environment: string; end: number }>
  >();
  for (const match of value.matchAll(ENVIRONMENT_PATTERN)) {
    if (match.index === undefined) continue;
    environmentEvents.set(match.index, {
      operation: match[1]!,
      environment: match[2]!.trim(),
      end: match.index + match[0].length,
    });
  }
  const environments: string[] = [];
  let dollarDelimiter: 'inline' | 'display' | null = null;
  let commandDelimiter: 'inline' | 'display' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const event = environmentEvents.get(index);
    if (event) {
      if (event.operation === 'begin') environments.push(event.environment);
      else environments.pop();
      index = event.end - 1;
      continue;
    }
    if (matchStarts.has(index)) {
      const inMath =
        dollarDelimiter !== null ||
        commandDelimiter !== null ||
        environments.some((environment) => MATH_ENVIRONMENTS.has(environment));
      if (!inMath) return true;
    }
    if (value[index] === '$' && !isEscaped(value, index)) {
      const display = value[index + 1] === '$' && !isEscaped(value, index + 1);
      const next = display ? 'display' : 'inline';
      dollarDelimiter = dollarDelimiter === next ? null : next;
      if (display) index += 1;
      continue;
    }
    if (
      value[index] === '\\' &&
      !isEscaped(value, index) &&
      (value[index + 1] === '(' ||
        value[index + 1] === ')' ||
        value[index + 1] === '[' ||
        value[index + 1] === ']')
    ) {
      const delimiterCharacter = value[index + 1]!;
      const next = delimiterCharacter === '(' || delimiterCharacter === ')' ? 'inline' : 'display';
      commandDelimiter = delimiterCharacter === '(' || delimiterCharacter === '[' ? next : null;
      index += 1;
    }
  }
  return false;
}

function containsRawHtml(value: string) {
  return RAW_HTML_COMMENT_PATTERN.test(value) || hasPatternOutsideMath(value, RAW_HTML_TAG_PATTERN);
}

function containsSlideOverlay(value: string) {
  return (
    SLIDE_OVERLAY_COMMAND_PATTERN.test(value) ||
    hasPatternOutsideMath(value, SLIDE_ANGLE_SPEC_PATTERN)
  );
}

function slideFrameOptionIssue(value: string): LectureLatexValidationReason | null {
  let foundFrameOption = false;
  for (const match of value.matchAll(/\\begin\s*\{\s*frame\s*\}/gu)) {
    if (match.index === undefined) continue;
    let cursor = match.index + match[0].length;
    while (cursor < value.length && /\s/u.test(value[cursor]!)) cursor += 1;
    if (value[cursor] !== '[') continue;
    foundFrameOption = true;
    const closingBracket = value.indexOf(']', cursor + 1);
    if (closingBracket < 0) return 'beamer_frame_option';
    const option = value.slice(cursor + 1, closingBracket);
    if (/\ballowframebreaks\b/u.test(option)) return 'beamer_multipage_frame';
  }
  return foundFrameOption ? 'beamer_frame_option' : null;
}

function assertBalancedBraces(value: string) {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '{' && !isEscaped(value, index)) depth += 1;
    if (value[index] === '}' && !isEscaped(value, index)) depth -= 1;
    if (depth < 0 || depth > 256) {
      throw new LectureLatexSourceError('unbalanced_braces');
    }
  }
  if (depth !== 0) throw new LectureLatexSourceError('unbalanced_braces');
}

function assertEnvironments(value: string, kind: LectureLatexKind) {
  const allowedEnvironments = kind === 'lecture-notes' ? NOTES_ENVIRONMENTS : SLIDES_ENVIRONMENTS;
  const stack: string[] = [];
  const environmentMatches = [...value.matchAll(ENVIRONMENT_PATTERN)];
  if (environmentMatches.length !== [...value.matchAll(ENVIRONMENT_COMMAND_PATTERN)].length) {
    throw new LectureLatexSourceError('malformed_environment');
  }
  const unsupportedEnvironments = environmentMatches
    .map((match) => match[2]!.trim())
    .filter((environment) => !allowedEnvironments.has(environment));
  if (unsupportedEnvironments.length > 0) {
    throw new LectureLatexSourceError('unsupported_environment', unsupportedEnvironments);
  }
  for (const match of environmentMatches) {
    const operation = match[1]!;
    const environment = match[2]!.trim();
    if (operation === 'begin') stack.push(environment);
    else if (stack.pop() !== environment) {
      throw new LectureLatexSourceError('unbalanced_environment');
    }
  }
  if (stack.length > 0) throw new LectureLatexSourceError('unbalanced_environment');
}

function assertCommands(value: string, kind: LectureLatexKind) {
  const allowedCommands = kind === 'lecture-notes' ? NOTES_COMMANDS : SLIDES_COMMANDS;
  const unsupportedCommands: string[] = [];
  const unsupportedEscapes: string[] = [];
  for (const match of value.matchAll(/\\([A-Za-z]+|[^A-Za-z\s])/gu)) {
    const command = match[1]!;
    if (/^[A-Za-z]+$/u.test(command)) {
      if (!allowedCommands.has(command)) {
        unsupportedCommands.push(command);
      }
    } else if (!'\\,;!:#$%&_{}| ()[]'.includes(command)) {
      unsupportedEscapes.push(command);
    }
  }
  if (unsupportedCommands.length > 0) {
    throw new LectureLatexSourceError('unsupported_command', unsupportedCommands);
  }
  if (unsupportedEscapes.length > 0) {
    throw new LectureLatexSourceError('unsupported_escape', unsupportedEscapes);
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
  let delimiter: 'dollar-inline' | 'dollar-display' | 'command-inline' | 'command-display' | null =
    null;
  for (let index = 0; index < value.length; index += 1) {
    const event = events.get(index);
    if (event) {
      if (event.operation === 'begin') environments.push(event.environment);
      else environments.pop();
      index = event.end - 1;
      continue;
    }
    const character = value[index]!;
    if (
      character === '\\' &&
      !isEscaped(value, index) &&
      (value[index + 1] === '(' ||
        value[index + 1] === ')' ||
        value[index + 1] === '[' ||
        value[index + 1] === ']')
    ) {
      const delimiterCharacter = value[index + 1]!;
      const nextDelimiter =
        delimiterCharacter === '(' || delimiterCharacter === ')'
          ? 'command-inline'
          : 'command-display';
      const opening = delimiterCharacter === '(' || delimiterCharacter === '[';
      if (opening) {
        if (delimiter !== null) throw new LectureLatexSourceError('unbalanced_math');
        if (environments.some((environment) => MATH_ENVIRONMENTS.has(environment))) {
          throw new LectureLatexSourceError('math_delimiter_in_math_environment');
        }
        delimiter = nextDelimiter;
      } else {
        if (delimiter !== nextDelimiter) {
          throw new LectureLatexSourceError('unbalanced_math');
        }
        delimiter = null;
      }
      index += 1;
      continue;
    }
    if (character === '$' && !isEscaped(value, index)) {
      const display = value[index + 1] === '$' && !isEscaped(value, index + 1);
      const nextDelimiter = display ? 'dollar-display' : 'dollar-inline';
      if (environments.some((environment) => MATH_ENVIRONMENTS.has(environment))) {
        throw new LectureLatexSourceError('math_delimiter_in_math_environment');
      }
      if (delimiter === null) delimiter = nextDelimiter;
      else if (delimiter === nextDelimiter) delimiter = null;
      else throw new LectureLatexSourceError('unbalanced_math');
      if (display) index += 1;
      continue;
    }
    if (isEscaped(value, index)) continue;
    const inMath =
      delimiter !== null || environments.some((environment) => MATH_ENVIRONMENTS.has(environment));
    if ((character === '_' || character === '^') && !inMath) {
      throw new LectureLatexSourceError('raw_subscript_or_superscript');
    }
    if (
      character === '&' &&
      !environments.some((environment) => ALIGNMENT_ENVIRONMENTS.has(environment))
    ) {
      throw new LectureLatexSourceError('raw_alignment_character');
    }
    if (character === '~') throw new LectureLatexSourceError('raw_tilde');
  }
  if (delimiter !== null) throw new LectureLatexSourceError('unbalanced_math');
}

type LectureLatexValidationOptions = Readonly<{
  requireSourcesUsed?: boolean;
  /** Exact previously committed v1-wrapper slides may contain overlays accepted by older builds. */
  allowLegacySlidePagination?: boolean;
}>;

export function validateLectureLatexBody(
  kind: LectureLatexKind,
  rawBody: string,
  options: LectureLatexValidationOptions = {},
) {
  const body = rawBody.trim();
  if (body.length < 1) throw new LectureLatexSourceError('empty_body');
  if (body.length > MAX_LECTURE_LATEX_CHARACTERS) {
    throw new LectureLatexSourceError('body_too_large');
  }
  if (
    [...body].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    })
  ) {
    throw new LectureLatexSourceError('control_character');
  }
  if (body.includes('^^')) throw new LectureLatexSourceError('tex_caret_escape');
  if (containsRawHtml(body)) throw new LectureLatexSourceError('raw_html');
  if (kind === 'slides' && options.allowLegacySlidePagination !== true) {
    if (containsSlideOverlay(body)) {
      throw new LectureLatexSourceError('beamer_overlay');
    }
    const frameOptionIssue = slideFrameOptionIssue(body);
    if (frameOptionIssue) throw new LectureLatexSourceError(frameOptionIssue);
  }
  if (MARKDOWN_STRUCTURE_PATTERN.test(body)) {
    throw new LectureLatexSourceError('markdown_structure');
  }
  if (DOCUMENT_COMMAND.test(body)) throw new LectureLatexSourceError('document_wrapper');
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === '%' && !isEscaped(body, index)) {
      throw new LectureLatexSourceError('raw_comment');
    }
    if (character === '#' && !isEscaped(body, index)) {
      throw new LectureLatexSourceError('raw_parameter');
    }
  }
  assertBalancedBraces(body);
  assertEnvironments(body, kind);
  assertCommands(body, kind);
  assertMathAndSpecialCharacters(body);
  if (kind === 'lecture-notes') {
    if (options.requireSourcesUsed !== false && !findLectureSourcesUsedSection(body)) {
      throw new LectureLatexSourceError('missing_sources_used');
    }
  } else {
    const frames = [...body.matchAll(/\\begin\s*\{\s*frame\s*\}/gu)];
    if (frames.length < 1) throw new LectureLatexSourceError('missing_frame');
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
    throw new LectureLatexSourceError('invalid_title');
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
    throw new LectureLatexSourceError('invalid_canonical_wrapper');
  }
  const body = source.slice(expectedPrefix.length, -SUFFIX.length).replace(/\n$/u, '');
  const normalizedBody = validateLectureLatexBody(kind, body, {
    allowLegacySlidePagination: kind === 'slides',
  });
  const normalized = `${prefix(kind, title.trim())}\n${normalizedBody}\n${SUFFIX}`;
  if (normalized !== source) throw new LectureLatexSourceError('invalid_canonical_wrapper');
  return source;
}

export function countLectureSlidePages(slidesLatexBody: string) {
  return 1 + [...slidesLatexBody.matchAll(/\\begin\s*\{\s*frame\s*\}/gu)].length;
}
