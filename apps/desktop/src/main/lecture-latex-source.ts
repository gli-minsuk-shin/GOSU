import {
  DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES,
  LECTURE_STUDIO_SOURCE_LIST_SECTION_TITLES,
  normalizeLectureStudioDocumentSectionTitle,
  resolveLectureStudioDocumentFeatures,
  type LectureStudioDocumentFeatures,
} from '../shared/lecture-studio-contracts';

const MAX_LECTURE_LATEX_CHARACTERS = 200_000;
const LEGACY_SOURCE_MARKER = '% GOSU-LECTURE-LATEX v1';
const SOURCE_MARKER_V2 = '% GOSU-LECTURE-LATEX v2';
const SOURCE_MARKER = '% GOSU-LECTURE-LATEX v3';
const DOCUMENT_FEATURES_MARKER = '% GOSU-DOCUMENT-FEATURES';
const CONTENT_BEGIN = '% GOSU-CONTENT-BEGIN';
const CONTENT_END = '% GOSU-CONTENT-END';
const EVIDENCE_LABEL_PATTERN = /\[((?:P|E|M|F|A)\d+)\]/gu;
const EVIDENCE_ANCHOR_PATTERN = /\\gosuevidence\{((?:P|E|M|F|A)\d+)\}/gu;
const EVIDENCE_ANCHOR_COMMAND_PATTERN = /\\gosuevidence\b/gu;
const LECTURE_FIGURE_ID_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const LECTURE_FIGURE_REFERENCE_PATTERN = new RegExp(
  String.raw`\\gosuimage\{(${LECTURE_FIGURE_ID_SOURCE})\}`,
  'gu',
);
const LECTURE_FIGURE_COMMAND_PATTERN = /\\gosuimage\b/gu;
const LECTURE_STRUCTURAL_HEADING_START_PATTERN =
  /\\(section|subsection|subsubsection|paragraph|subparagraph)\s*\*?\s*\{/gu;
const LECTURE_STRUCTURAL_HEADING_OPTION_PATTERN =
  /\\(section|subsection|subsubsection|paragraph|subparagraph)\s*\*?\s*\[/gu;
const NORMALIZED_SOURCE_LIST_SECTION_TITLES = new Set(
  LECTURE_STUDIO_SOURCE_LIST_SECTION_TITLES.map((title) =>
    normalizeLectureStudioDocumentSectionTitle(title),
  ),
);
const LECTURE_SECTION_TITLE_FORMATTING_COMMAND_SOURCE = String.raw`\\(?:textbf|textit|textsc|texttt|textrm|textsf|textmd|textup|textsl|textnormal|textsuperscript|textsubscript|text|emph|underline|overline)\s*\{`;
const LECTURE_SECTION_TITLE_FORMATTING_COMMAND_PATTERN = new RegExp(
  `^${LECTURE_SECTION_TITLE_FORMATTING_COMMAND_SOURCE}`,
  'u',
);
const LECTURE_SECTION_TITLE_FORMATTING_COMMAND_GLOBAL_PATTERN = new RegExp(
  LECTURE_SECTION_TITLE_FORMATTING_COMMAND_SOURCE,
  'gu',
);
const LECTURE_SECTION_TITLE_FORMATTING_DECLARATION_PATTERN =
  /\\(?:normalfont|rmfamily|sffamily|ttfamily|mdseries|bfseries|upshape|itshape|slshape|scshape|normalsize|small|footnotesize|scriptsize|tiny|Large|LARGE|huge|Huge)\b/gu;

export type LectureLatexKind = 'lecture-notes' | 'slides';

export const LECTURE_LATEX_VALIDATION_REASON_GUIDANCE = {
  empty_body: 'Return a non-empty LaTeX body.',
  body_too_large: 'Shorten the body to the configured size limit.',
  control_character:
    'Encode every LaTeX backslash as \\\\ in JSON; never use a single-backslash \\b or \\f JSON escape.',
  ambiguous_json_backslash_escape:
    'Encode every LaTeX backslash as \\\\ in JSON. If the reported text is an intentional new source line, indent it with spaces; otherwise restore the reported LaTeX command with a double-escaped backslash.',
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
  structural_heading_option:
    'Remove optional short-title arguments from section, subsection, subsubsection, and paragraph headings.',
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
  evidence_label_typography:
    'Place evidence labels directly after the claim and put sentence punctuation immediately after the final label, never before it or after intervening whitespace. Separate consecutive labels with whitespace only, never punctuation or connector words, and do not wrap labels in parentheses or extra brackets.',
  missing_sources_used: 'Finish the notes with a Sources used section.',
  missing_frame: 'Return at least one complete frame in the slides body.',
  invalid_title: 'Return a valid bounded lecture title.',
  invalid_figure_reference:
    'Insert only a GOSU Figure-library asset with the exact \\gosuimage{asset-id} command.',
  invalid_canonical_wrapper: 'Keep the exact GOSU-owned document wrapper unchanged.',
} as const;

export type LectureLatexValidationReason = keyof typeof LECTURE_LATEX_VALIDATION_REASON_GUIDANCE;

function normalizedDiagnosticToken(reason: LectureLatexValidationReason, rawToken: string | null) {
  if (rawToken === null) return null;
  if (
    (reason === 'unsupported_command' || reason === 'ambiguous_json_backslash_escape') &&
    /^[A-Za-z]{1,64}$/u.test(rawToken)
  ) {
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

const MAX_LECTURE_LATEX_DIAGNOSTIC_TOKENS = 32;

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
  'alignat',
  'alignat*',
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
  'figure',
  'itemize',
  'matrix',
  'multline',
  'multline*',
  'minipage',
  'pmatrix',
  'quote',
  'samepage',
  'smallmatrix',
  'split',
  'subequations',
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
  'alignat',
  'alignat*',
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
  'alignat',
  'alignat*',
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
  gosuimage
  alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi
  pi varpi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma
  Upsilon Phi Psi Omega varsigma varrho frac dfrac tfrac binom choose genfrac sqrt sum prod int iint iiint oint lim log ln exp sin cos
  tan sinh cosh tanh coth max min arg arccos arcsin arctan csc deg det dim gcd hom inf ker Pr sec sup mathbb
  mathbf boldsymbol bm mathrm mathcal mathsf mathtt mathit mathfrak text textnormal operatorname mathop
  overline underline overbrace underbrace hat widehat widetilde tilde bar vec dot ddot overset
  check breve acute grave boxed phantom hphantom vphantom smash underset stackrel substack limits nolimits not tag notag nonumber intertext shortintertext left right big Big bigg Bigg bigl bigr Bigl Bigr biggl
  biggr Biggl Biggr cdot times div pm mp le leq ge geq gtrsim lesssim ll gg neq approx asymp cong
  propto sim simeq equiv doteq prec preceq succ succeq in notin ni subset subseteq supset supseteq cup cap setminus emptyset
  varnothing forall exists nexists neg land lor wedge vee bigwedge bigvee implies iff to mapsto gets leftarrow rightarrow
  leftrightarrow Leftarrow Rightarrow Leftrightarrow longleftarrow longrightarrow longmapsto
  longleftrightarrow hookrightarrow rightsquigarrow xrightarrow xleftarrow uparrow downarrow partial nabla
  infty ell ldots cdots vdots ddots dots prime top bot perp parallel mid vert Vert lVert rVert
  langle rangle lceil rceil lfloor rfloor pmod mod bmod coloneqq colon angle triangle square Box
  Diamond circ bullet star ast dagger ddagger oplus otimes odot oslash bigcup bigcap bigoplus
  bigotimes begin end quad qquad enspace hfill vfill smallskip medskip bigskip noindent centering
  linewidth columnwidth textwidth displaystyle textstyle scriptstyle scriptscriptstyle par
  textbackslash textasciicircum textasciitilde normalsize small footnotesize scriptsize tiny
  Large LARGE huge Huge`.split(/\s+/u),
);
const NOTES_COMMANDS = new Set([...COMMON_COMMANDS, 'qedhere']);
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

const BLOCKED_N_PREFIX_COMMANDS = new Set([
  'newbox',
  'newcommand',
  'newcounter',
  'newenvironment',
  'newfont',
  'newgeometry',
  'newhelp',
  'newif',
  'newinsert',
  'newlabel',
  'newlength',
  'newpage',
  'newread',
  'newsavebox',
  'newtheorem',
  'newtoks',
  'newwrite',
  'nobibliography',
  'nocite',
  'nofiles',
  'nolinebreak',
  'nopagebreak',
  'numberline',
  'numberwithin',
]);

function asciiCommandSuffixAfter(value: string, index: number) {
  let end = index + 1;
  while (end < value.length && /[A-Za-z]/u.test(value[end]!)) end += 1;
  return value.slice(index + 1, end);
}

/**
 * Repairs only the two JSON escapes whose decoded values have a unique,
 * forbidden meaning in a generated LaTeX body. Tabs and carriage returns are
 * ambiguous (for example, `\\theta` and `\\ref`) and therefore fail closed.
 * A line feed fails closed only when its immediately adjacent letters can be
 * the decoded suffix of a known `\\n...` command. Indented source lines are
 * unambiguous and pass unchanged. Canonical files never use this transport
 * gate.
 */
export function normalizeGeneratedLectureLatexBody(kind: LectureLatexKind, rawBody: string) {
  const body = rawBody.replaceAll('\u0008', '\\b').replaceAll('\u000c', '\\f');
  const allowedCommands = kind === 'lecture-notes' ? NOTES_COMMANDS : SLIDES_COMMANDS;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!;
    if (character === '\t' || character === '\r') {
      const prefix = character === '\t' ? 't' : 'r';
      throw new LectureLatexSourceError(
        'ambiguous_json_backslash_escape',
        `${prefix}${asciiCommandSuffixAfter(body, index)}`,
      );
    }
    if (character !== '\n') continue;
    const suffix = asciiCommandSuffixAfter(body, index);
    if (suffix.length < 1) continue;
    const command = `n${suffix}`;
    if (allowedCommands.has(command) || BLOCKED_N_PREFIX_COMMANDS.has(command)) {
      throw new LectureLatexSourceError('ambiguous_json_backslash_escape', command);
    }
  }

  return body;
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

function assertGosuImageReferences(value: string) {
  const exactStarts = new Set(
    [...value.matchAll(LECTURE_FIGURE_REFERENCE_PATTERN)]
      .map((match) => match.index)
      .filter((index): index is number => index !== undefined),
  );
  LECTURE_FIGURE_REFERENCE_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(LECTURE_FIGURE_COMMAND_PATTERN)) {
    if (match.index === undefined || !exactStarts.has(match.index)) {
      LECTURE_FIGURE_COMMAND_PATTERN.lastIndex = 0;
      throw new LectureLatexSourceError('invalid_figure_reference');
    }
  }
  LECTURE_FIGURE_COMMAND_PATTERN.lastIndex = 0;
}

export function findLectureFigureAssetIds(value: string) {
  const ids = [...value.matchAll(LECTURE_FIGURE_REFERENCE_PATTERN)].map((match) => match[1]!);
  LECTURE_FIGURE_REFERENCE_PATTERN.lastIndex = 0;
  return [...new Set(ids)];
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
  /** Exact previously committed v1 wrappers may retain older evidence-label typography. */
  allowLegacyEvidenceTypography?: boolean;
  /** Exact previously committed v1 wrappers may retain optional structural short titles. */
  allowLegacyStructuralHeadingOptions?: boolean;
}>;

const EVIDENCE_LABEL_SOURCE = String.raw`\[(?:P|E|M|F|A)\d+\]`;
const WRAPPED_EVIDENCE_LABEL_GROUP_PATTERN = new RegExp(
  String.raw`(?:\(|\[)\s*${EVIDENCE_LABEL_SOURCE}(?:\s*${EVIDENCE_LABEL_SOURCE})*\s*(?:\)|\])`,
  'gu',
);
const EVIDENCE_LABEL_CLUSTER_SEPARATOR_PATTERN =
  /^(?:\s|[,.;:!?/&+]|\\&|\band\b|\bor\b|\bplus\b|및|와|과|또는)+$/iu;
const PUNCTUATION_BEFORE_EVIDENCE_LABEL_PATTERN = /[,.;:!?][ \t]*\[(?:P|E|M|F|A)\d+\]/gu;
const SPACED_PUNCTUATION_AFTER_EVIDENCE_LABEL_PATTERN = /\[(?:P|E|M|F|A)\d+\][ \t]+[,.;:!?]/gu;

function assertEvidenceLabelTypography(body: string) {
  if (PUNCTUATION_BEFORE_EVIDENCE_LABEL_PATTERN.test(body)) {
    PUNCTUATION_BEFORE_EVIDENCE_LABEL_PATTERN.lastIndex = 0;
    throw new LectureLatexSourceError('evidence_label_typography');
  }
  PUNCTUATION_BEFORE_EVIDENCE_LABEL_PATTERN.lastIndex = 0;
  if (SPACED_PUNCTUATION_AFTER_EVIDENCE_LABEL_PATTERN.test(body)) {
    SPACED_PUNCTUATION_AFTER_EVIDENCE_LABEL_PATTERN.lastIndex = 0;
    throw new LectureLatexSourceError('evidence_label_typography');
  }
  SPACED_PUNCTUATION_AFTER_EVIDENCE_LABEL_PATTERN.lastIndex = 0;
  for (const match of body.matchAll(WRAPPED_EVIDENCE_LABEL_GROUP_PATTERN)) {
    const isItemOptionalLabel =
      match[0].trimStart().startsWith('[') && /\\item\s*$/u.test(body.slice(0, match.index));
    if (!isItemOptionalLabel) {
      WRAPPED_EVIDENCE_LABEL_GROUP_PATTERN.lastIndex = 0;
      throw new LectureLatexSourceError('evidence_label_typography');
    }
  }
  WRAPPED_EVIDENCE_LABEL_GROUP_PATTERN.lastIndex = 0;
  const labels = [...body.matchAll(EVIDENCE_LABEL_PATTERN)];
  for (let index = 1; index < labels.length; index += 1) {
    const previous = labels[index - 1]!;
    const current = labels[index]!;
    const separator = body.slice(previous.index! + previous[0].length, current.index);
    if (separator.trim().length > 0 && EVIDENCE_LABEL_CLUSTER_SEPARATOR_PATTERN.test(separator)) {
      throw new LectureLatexSourceError('evidence_label_typography');
    }
  }
}

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
  if (options.allowLegacyStructuralHeadingOptions !== true) {
    const structuralHeadingOption = LECTURE_STRUCTURAL_HEADING_OPTION_PATTERN.exec(body);
    LECTURE_STRUCTURAL_HEADING_OPTION_PATTERN.lastIndex = 0;
    if (structuralHeadingOption) {
      throw new LectureLatexSourceError('structural_heading_option');
    }
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
  assertGosuImageReferences(body);
  assertCommands(body, kind);
  assertMathAndSpecialCharacters(body);
  if (options.allowLegacyEvidenceTypography !== true) {
    assertEvidenceLabelTypography(body);
  }
  if (kind === 'lecture-notes') {
    if (options.requireSourcesUsed !== false) {
      assertSourcesUsedConfiguration(kind, body, DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES);
    }
  } else {
    const frames = [...body.matchAll(/\\begin\s*\{\s*frame\s*\}/gu)];
    if (frames.length < 1) throw new LectureLatexSourceError('missing_frame');
  }
  return body;
}

function readLectureLatexBraceArgument(value: string, openingBraceIndex: number) {
  if (value[openingBraceIndex] !== '{') return null;
  let depth = 0;
  for (let index = openingBraceIndex; index < value.length; index += 1) {
    if (value[index] === '{' && !isEscaped(value, index)) depth += 1;
    if (value[index] !== '}' || isEscaped(value, index)) continue;
    depth -= 1;
    if (depth === 0) {
      return {
        content: value.slice(openingBraceIndex + 1, index),
        end: index + 1,
      };
    }
  }
  return null;
}

function normalizeLectureSourceListHeadingArgument(value: string) {
  let candidate = value.trim();
  for (let depth = 0; depth < 8; depth += 1) {
    if (candidate.startsWith('{')) {
      const group = readLectureLatexBraceArgument(candidate, 0);
      if (group?.end === candidate.length) {
        candidate = group.content.trim();
        continue;
      }
    }
    const formattingCommand = LECTURE_SECTION_TITLE_FORMATTING_COMMAND_PATTERN.exec(candidate);
    if (!formattingCommand) break;
    const argument = readLectureLatexBraceArgument(candidate, formattingCommand[0].length - 1);
    if (argument?.end !== candidate.length) break;
    candidate = argument.content.trim();
  }
  candidate = candidate
    .replace(LECTURE_SECTION_TITLE_FORMATTING_DECLARATION_PATTERN, ' ')
    .replace(LECTURE_SECTION_TITLE_FORMATTING_COMMAND_GLOBAL_PATTERN, '{')
    .replace(/[{}]/gu, '');
  return normalizeLectureStudioDocumentSectionTitle(candidate);
}

export type LectureSourceListSection = Readonly<{
  index: number;
  end: number;
  title: string;
  isCanonical: boolean;
  isTerminal: boolean;
}>;

export function findLectureSourceListSections(body: string): readonly LectureSourceListSection[] {
  const structuralHeadings = [...body.matchAll(LECTURE_STRUCTURAL_HEADING_START_PATTERN)];
  const structuralHeadingStarts = structuralHeadings
    .map((match) => match.index)
    .filter((index): index is number => index !== undefined);
  const sourceListSections: LectureSourceListSection[] = [];
  for (const match of structuralHeadings) {
    if (match.index === undefined) continue;
    const index = match.index;
    const argument = readLectureLatexBraceArgument(body, index + match[0].length - 1);
    if (!argument) continue;
    const title = normalizeLectureSourceListHeadingArgument(argument.content);
    if (!NORMALIZED_SOURCE_LIST_SECTION_TITLES.has(title)) continue;
    sourceListSections.push({
      index,
      end: argument.end,
      title,
      isCanonical:
        match[1] === 'section' &&
        argument.content.normalize('NFC').trim().toLowerCase() === 'sources used',
      isTerminal: !structuralHeadingStarts.some((headingIndex) => headingIndex > index),
    });
  }
  return sourceListSections;
}

export function findLectureSourcesUsedSection(body: string) {
  const match = findLectureSourceListSections(body).find((section) => section.isCanonical);
  return match ? { index: match.index, end: match.end } : null;
}

function legacyNotesPrefix(title: string) {
  return [
    `${LEGACY_SOURCE_MARKER} lecture-notes`,
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

function legacySlidesPrefix(title: string) {
  return [
    `${LEGACY_SOURCE_MARKER} slides`,
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

function legacyPrefix(kind: LectureLatexKind, title: string) {
  return kind === 'lecture-notes' ? legacyNotesPrefix(title) : legacySlidesPrefix(title);
}

function documentFeaturesMetadata(features: LectureStudioDocumentFeatures) {
  return `${DOCUMENT_FEATURES_MARKER} includeSlideTitlePage=${String(features.includeSlideTitlePage)} showInlineEvidenceLabels=${String(features.showInlineEvidenceLabels)} includeSourcesUsedSection=${String(features.includeSourcesUsedSection)}`;
}

function evidenceMacro(features: LectureStudioDocumentFeatures) {
  return features.showInlineEvidenceLabels
    ? '\\newcommand{\\gosuevidence}[1]{[#1]}'
    : '\\newcommand{\\gosuevidence}[1]{\\ifhmode\\unskip\\fi}';
}

function imageMacro() {
  return '\\newcommand{\\gosuimage}[1]{\\includegraphics[width=0.88\\linewidth]{Figure-#1.jpg}}';
}

function notesPrefixVersion(
  title: string,
  features: LectureStudioDocumentFeatures,
  sourceMarker: string,
  figuresEnabled: boolean,
) {
  return [
    `${sourceMarker} lecture-notes`,
    documentFeaturesMetadata(features),
    '\\documentclass[11pt]{article}',
    '\\usepackage{fontspec}',
    '\\usepackage{kotex}',
    '\\usepackage{amsmath,amssymb,mathtools}',
    '\\usepackage{amsthm}',
    '\\usepackage{bm}',
    '\\usepackage{booktabs,array,longtable}',
    ...(figuresEnabled ? ['\\usepackage{graphicx}'] : []),
    '\\usepackage[margin=1in]{geometry}',
    '\\usepackage[hidelinks]{hyperref}',
    evidenceMacro(features),
    ...(figuresEnabled ? [imageMacro()] : []),
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

function slidesPrefixVersion(
  title: string,
  features: LectureStudioDocumentFeatures,
  sourceMarker: string,
  figuresEnabled: boolean,
) {
  return [
    `${sourceMarker} slides`,
    documentFeaturesMetadata(features),
    '\\documentclass[aspectratio=169]{beamer}',
    '\\usepackage{fontspec}',
    '\\usepackage{kotex}',
    '\\usepackage{amsmath,amssymb,mathtools}',
    '\\usepackage{bm}',
    '\\usepackage{booktabs,array}',
    ...(figuresEnabled ? ['\\usepackage{graphicx}'] : []),
    '\\usetheme{default}',
    '\\setbeamertemplate{navigation symbols}{}',
    '\\setbeamertemplate{footline}[frame number]',
    evidenceMacro(features),
    ...(figuresEnabled ? [imageMacro()] : []),
    `\\title{${escapeLatex(title)}}`,
    '\\author{GOSU Lecture Studio}',
    '\\date{}',
    '\\begin{document}',
    ...(features.includeSlideTitlePage ? ['\\begin{frame}', '\\titlepage', '\\end{frame}'] : []),
    CONTENT_BEGIN,
  ].join('\n');
}

function notesPrefix(title: string, features: LectureStudioDocumentFeatures) {
  return notesPrefixVersion(title, features, SOURCE_MARKER, true);
}

function slidesPrefix(title: string, features: LectureStudioDocumentFeatures) {
  return slidesPrefixVersion(title, features, SOURCE_MARKER, true);
}

function prefixV2(kind: LectureLatexKind, title: string, features: LectureStudioDocumentFeatures) {
  return kind === 'lecture-notes'
    ? notesPrefixVersion(title, features, SOURCE_MARKER_V2, false)
    : slidesPrefixVersion(title, features, SOURCE_MARKER_V2, false);
}

function prefix(kind: LectureLatexKind, title: string, features: LectureStudioDocumentFeatures) {
  return kind === 'lecture-notes' ? notesPrefix(title, features) : slidesPrefix(title, features);
}

const SUFFIX = `${CONTENT_END}\n\\end{document}\n`;

function assertSourcesUsedConfiguration(
  kind: LectureLatexKind,
  body: string,
  features: LectureStudioDocumentFeatures,
  options: Readonly<{
    allowedContentSectionTitles?: readonly string[];
    enforceAliases?: boolean;
  }> = {},
) {
  if (kind !== 'lecture-notes') return;
  const sourceListSections = findLectureSourceListSections(body);
  const canonicalSections = sourceListSections.filter((section) => section.isCanonical);
  const allowedContentSectionTitles = new Set(
    (options.allowedContentSectionTitles ?? []).map((title) =>
      normalizeLectureStudioDocumentSectionTitle(title),
    ),
  );
  const enforcedSourceListSections =
    options.enforceAliases === false
      ? canonicalSections
      : sourceListSections.filter(
          (section) => section.isCanonical || !allowedContentSectionTitles.has(section.title),
        );
  if (features.includeSourcesUsedSection && canonicalSections.length === 0) {
    throw new LectureLatexSourceError('missing_sources_used');
  }
  if (
    (features.includeSourcesUsedSection &&
      (enforcedSourceListSections.length !== 1 ||
        canonicalSections.length !== 1 ||
        canonicalSections[0]?.isTerminal !== true)) ||
    (!features.includeSourcesUsedSection && enforcedSourceListSections.length > 0)
  ) {
    throw new LectureLatexSourceError('invalid_canonical_wrapper');
  }
}

function anchorLectureEvidenceLabels(body: string) {
  return body.replace(EVIDENCE_LABEL_PATTERN, (_match, label: string) => {
    return `\\gosuevidence{${label}}`;
  });
}

/**
 * Converts compiler-owned canonical evidence anchors back to the bounded labels
 * understood by the authoring model. Unknown or malformed anchors remain
 * untouched so downstream validation continues to fail closed.
 */
export function rehydrateLectureEvidenceAnchors(source: string) {
  return source.replace(EVIDENCE_ANCHOR_PATTERN, (_match, label: string) => `[${label}]`);
}

function assertCanonicalEvidenceAnchors(body: string) {
  if (EVIDENCE_LABEL_PATTERN.test(body)) {
    EVIDENCE_LABEL_PATTERN.lastIndex = 0;
    throw new LectureLatexSourceError('invalid_canonical_wrapper');
  }
  EVIDENCE_LABEL_PATTERN.lastIndex = 0;
  const exactStarts = new Set(
    [...body.matchAll(EVIDENCE_ANCHOR_PATTERN)]
      .map((match) => match.index)
      .filter((index): index is number => index !== undefined),
  );
  for (const match of body.matchAll(EVIDENCE_ANCHOR_COMMAND_PATTERN)) {
    if (match.index === undefined || !exactStarts.has(match.index)) {
      throw new LectureLatexSourceError('invalid_canonical_wrapper');
    }
  }
}

export function buildLectureLatexDocument(
  kind: LectureLatexKind,
  title: string,
  rawBody: string,
  features: LectureStudioDocumentFeatures = DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES,
  allowedContentSectionTitles: readonly string[] = [],
) {
  const normalizedTitle = title.trim();
  if (normalizedTitle.length < 1 || normalizedTitle.length > 256) {
    throw new LectureLatexSourceError('invalid_title');
  }
  const resolvedFeatures = resolveLectureStudioDocumentFeatures(features);
  const body = validateLectureLatexBody(kind, rawBody, { requireSourcesUsed: false });
  assertSourcesUsedConfiguration(kind, body, resolvedFeatures, {
    allowedContentSectionTitles,
  });
  const anchoredBody = anchorLectureEvidenceLabels(body);
  if (anchoredBody.length > MAX_LECTURE_LATEX_CHARACTERS) {
    throw new LectureLatexSourceError('body_too_large');
  }
  return `${prefix(kind, normalizedTitle, resolvedFeatures)}\n${anchoredBody}\n${SUFFIX}`;
}

const DOCUMENT_FEATURES_PATTERN =
  /^% GOSU-DOCUMENT-FEATURES includeSlideTitlePage=(true|false) showInlineEvidenceLabels=(true|false) includeSourcesUsedSection=(true|false)$/u;

function parseCanonicalDocumentFeatures(
  kind: LectureLatexKind,
  source: string,
  sourceMarker: string,
) {
  const marker = `${sourceMarker} ${kind}\n`;
  if (!source.startsWith(marker)) throw new LectureLatexSourceError('invalid_canonical_wrapper');
  const metadataEnd = source.indexOf('\n', marker.length);
  if (metadataEnd < 0) throw new LectureLatexSourceError('invalid_canonical_wrapper');
  const match = DOCUMENT_FEATURES_PATTERN.exec(source.slice(marker.length, metadataEnd));
  if (!match) throw new LectureLatexSourceError('invalid_canonical_wrapper');
  return resolveLectureStudioDocumentFeatures({
    includeSlideTitlePage: match[1] === 'true',
    showInlineEvidenceLabels: match[2] === 'true',
    includeSourcesUsedSection: match[3] === 'true',
  });
}

export function validateCanonicalLectureLatex(
  kind: LectureLatexKind,
  title: string,
  source: string,
) {
  if (source.startsWith(`${LEGACY_SOURCE_MARKER} ${kind}\n`)) {
    const expectedPrefix = `${legacyPrefix(kind, title.trim())}\n`;
    if (!source.startsWith(expectedPrefix) || !source.endsWith(SUFFIX)) {
      throw new LectureLatexSourceError('invalid_canonical_wrapper');
    }
    const body = source.slice(expectedPrefix.length, -SUFFIX.length).replace(/\n$/u, '');
    const normalizedBody = validateLectureLatexBody(kind, body, {
      requireSourcesUsed: false,
      allowLegacySlidePagination: kind === 'slides',
      allowLegacyEvidenceTypography: true,
      allowLegacyStructuralHeadingOptions: true,
    });
    const normalized = `${legacyPrefix(kind, title.trim())}\n${normalizedBody}\n${SUFFIX}`;
    if (normalized !== source) throw new LectureLatexSourceError('invalid_canonical_wrapper');
    return source;
  }

  const sourceMarker = source.startsWith(`${SOURCE_MARKER_V2} ${kind}\n`)
    ? SOURCE_MARKER_V2
    : SOURCE_MARKER;
  const features = parseCanonicalDocumentFeatures(kind, source, sourceMarker);
  const expectedPrefix = `${
    sourceMarker === SOURCE_MARKER_V2
      ? prefixV2(kind, title.trim(), features)
      : prefix(kind, title.trim(), features)
  }\n`;
  if (!source.startsWith(expectedPrefix) || !source.endsWith(SUFFIX)) {
    throw new LectureLatexSourceError('invalid_canonical_wrapper');
  }
  const anchoredBody = source.slice(expectedPrefix.length, -SUFFIX.length).replace(/\n$/u, '');
  assertCanonicalEvidenceAnchors(anchoredBody);
  const rawBody = rehydrateLectureEvidenceAnchors(anchoredBody);
  const normalizedBody = validateLectureLatexBody(kind, rawBody, {
    requireSourcesUsed: false,
  });
  assertSourcesUsedConfiguration(kind, normalizedBody, features, { enforceAliases: false });
  if (sourceMarker === SOURCE_MARKER_V2 && findLectureFigureAssetIds(normalizedBody).length > 0) {
    throw new LectureLatexSourceError('invalid_figure_reference');
  }
  const normalizedPrefix =
    sourceMarker === SOURCE_MARKER_V2
      ? prefixV2(kind, title.trim(), features)
      : prefix(kind, title.trim(), features);
  const normalized = `${normalizedPrefix}\n${anchorLectureEvidenceLabels(normalizedBody)}\n${SUFFIX}`;
  if (normalized !== source) throw new LectureLatexSourceError('invalid_canonical_wrapper');
  return source;
}

export function extractEditableLectureLatexBody(
  kind: LectureLatexKind,
  title: string,
  source: string,
) {
  validateCanonicalLectureLatex(kind, title, source);
  if (source.startsWith(`${LEGACY_SOURCE_MARKER} ${kind}\n`)) {
    const documentPrefix = `${legacyPrefix(kind, title.trim())}\n`;
    return {
      body: source.slice(documentPrefix.length, -SUFFIX.length).replace(/\n$/u, ''),
      features: DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES,
    } as const;
  }
  const sourceMarker = source.startsWith(`${SOURCE_MARKER_V2} ${kind}\n`)
    ? SOURCE_MARKER_V2
    : SOURCE_MARKER;
  const features = parseCanonicalDocumentFeatures(kind, source, sourceMarker);
  const documentPrefix = `${
    sourceMarker === SOURCE_MARKER_V2
      ? prefixV2(kind, title.trim(), features)
      : prefix(kind, title.trim(), features)
  }\n`;
  const anchoredBody = source.slice(documentPrefix.length, -SUFFIX.length).replace(/\n$/u, '');
  return { body: rehydrateLectureEvidenceAnchors(anchoredBody), features } as const;
}

export function countLectureSlidePages(
  slidesLatexBody: string,
  features: LectureStudioDocumentFeatures = DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES,
) {
  const resolvedFeatures = resolveLectureStudioDocumentFeatures(features);
  return (
    (resolvedFeatures.includeSlideTitlePage ? 1 : 0) +
    [...slidesLatexBody.matchAll(/\\begin\s*\{\s*frame\s*\}/gu)].length
  );
}
