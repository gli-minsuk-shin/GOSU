import { describe, expect, it } from 'vitest';

import {
  buildLectureLatexDocument,
  countLectureSlidePages,
  extractEditableLectureLatexBody,
  findLectureFigureAssetIds,
  findLectureSourceListSections,
  LectureLatexSourceError,
  normalizeGeneratedLectureLatexBody,
  rehydrateLectureEvidenceAnchors,
  validateCanonicalLectureLatex,
  validateLectureLatexBody,
} from '../src/main/lecture-latex-source';

function validationError(kind: 'lecture-notes' | 'slides', body: string) {
  try {
    validateLectureLatexBody(kind, body);
  } catch (error) {
    if (error instanceof LectureLatexSourceError) return error;
    throw error;
  }
  throw new Error('Expected LectureLatexSourceError');
}

const notesBody = String.raw`\section{Scope}
Let $x \in \mathbb{R}$ and define $f(x)=x^2$ [M1].

\begin{equation}
f'(x)=2x.
\end{equation}

\section{Sources used}
\begin{itemize}
\item [M1] Captured manuscript
\end{itemize}`;

const slidesBody = String.raw`\begin{frame}{Scope}
Let $x \in \mathbb{R}$ [M1].
\end{frame}

\begin{frame}{Result}
$f'(x)=2x$ [M1].
\end{frame}`;

const allDocumentFeatures = {
  includeSlideTitlePage: true,
  showInlineEvidenceLabels: true,
  includeSourcesUsedSection: true,
} as const;

const figureId = '4b78cc25-2bd7-4c31-87c3-1f7ac3f5609a';

function legacyCanonicalSlides(title: string, body: string) {
  return [
    '% GOSU-LECTURE-LATEX v1 slides',
    '\\documentclass[aspectratio=169]{beamer}',
    '\\usepackage{fontspec}',
    '\\usepackage{kotex}',
    '\\usepackage{amsmath,amssymb,mathtools}',
    '\\usepackage{bm}',
    '\\usepackage{booktabs,array}',
    '\\usetheme{default}',
    '\\setbeamertemplate{navigation symbols}{}',
    '\\setbeamertemplate{footline}[frame number]',
    `\\title{${title}}`,
    '\\author{GOSU Lecture Studio}',
    '\\date{}',
    '\\begin{document}',
    '\\begin{frame}',
    '\\titlepage',
    '\\end{frame}',
    '% GOSU-CONTENT-BEGIN',
    body,
    '% GOSU-CONTENT-END',
    '\\end{document}',
    '',
  ].join('\n');
}

describe('Lecture LaTeX source', () => {
  it('builds deterministic self-contained notes and slides', () => {
    const notes = buildLectureLatexDocument('lecture-notes', 'Calculus', notesBody);
    const slides = buildLectureLatexDocument('slides', 'Calculus', slidesBody);

    expect(notes).toContain('% GOSU-LECTURE-LATEX v3 lecture-notes');
    expect(notes).toContain('\\documentclass[11pt]{article}');
    expect(notes).toContain('\\usepackage{graphicx}');
    expect(notes).toContain('\\newcommand{\\gosuevidence}[1]{[#1]}');
    expect(notes).toContain(
      '\\newcommand{\\gosuimage}[1]{\\includegraphics[width=0.88\\linewidth]{Figure-#1.jpg}}',
    );
    expect(notes).toContain('\\gosuevidence{M1}');
    expect(notes).not.toContain('[M1] Captured manuscript');
    expect(rehydrateLectureEvidenceAnchors(notes)).toContain(notesBody);
    expect(slides).toContain('\\documentclass[aspectratio=169]{beamer}');
    expect(slides).toContain('\\gosuevidence{M1}');
    expect(rehydrateLectureEvidenceAnchors(slides)).toContain(slidesBody);
    expect(countLectureSlidePages(slidesBody)).toBe(3);
    expect(validateCanonicalLectureLatex('lecture-notes', 'Calculus', notes)).toBe(notes);
    expect(validateCanonicalLectureLatex('slides', 'Calculus', slides)).toBe(slides);
  });

  it('builds and revalidates canonical notes without a visible Sources used section', () => {
    const body = String.raw`\section{Result}
The estimator is consistent under the stated assumptions [M1].`;

    expect(validationError('lecture-notes', body).reason).toBe('missing_sources_used');
    expect(() =>
      validateLectureLatexBody('lecture-notes', body, { requireSourcesUsed: false }),
    ).not.toThrow();
    const source = buildLectureLatexDocument('lecture-notes', 'Optional source list', body, {
      ...allDocumentFeatures,
      includeSourcesUsedSection: false,
    });
    expect(source).not.toContain('Sources used');
    expect(validateCanonicalLectureLatex('lecture-notes', 'Optional source list', source)).toBe(
      source,
    );
  });

  it('encodes configurable document elements in a strict v3 wrapper while retaining evidence anchors', () => {
    const notesWithoutSourceList = String.raw`\section{Result}
The estimator remains source-bound [M1].`;
    const hiddenFeatures = {
      includeSlideTitlePage: false,
      showInlineEvidenceLabels: false,
      includeSourcesUsedSection: false,
    } as const;
    const notes = buildLectureLatexDocument(
      'lecture-notes',
      'Hidden elements',
      notesWithoutSourceList,
      hiddenFeatures,
    );
    const slides = buildLectureLatexDocument(
      'slides',
      'Hidden elements',
      slidesBody,
      hiddenFeatures,
    );

    for (const source of [notes, slides]) {
      expect(source).toContain(
        '% GOSU-DOCUMENT-FEATURES includeSlideTitlePage=false showInlineEvidenceLabels=false includeSourcesUsedSection=false',
      );
      expect(source).toContain('\\newcommand{\\gosuevidence}[1]{\\ifhmode\\unskip\\fi}');
      expect(source).toContain('\\gosuevidence{M1}');
      expect(
        validateCanonicalLectureLatex(
          source === notes ? 'lecture-notes' : 'slides',
          'Hidden elements',
          source,
        ),
      ).toBe(source);
    }
    expect(slides).not.toContain('\\titlepage');
    expect(countLectureSlidePages(slidesBody, hiddenFeatures)).toBe(2);
    expect(rehydrateLectureEvidenceAnchors(notes)).toContain('[M1]');
    expect(extractEditableLectureLatexBody('lecture-notes', 'Hidden elements', notes)).toEqual({
      body: notesWithoutSourceList,
      features: hiddenFeatures,
    });

    const titleOnly = buildLectureLatexDocument('slides', 'Visible elements', slidesBody, {
      ...hiddenFeatures,
      includeSlideTitlePage: true,
      showInlineEvidenceLabels: true,
    });
    expect(titleOnly).toContain('\\titlepage');
    expect(titleOnly).toContain('\\newcommand{\\gosuevidence}[1]{[#1]}');
    expect(countLectureSlidePages(slidesBody, allDocumentFeatures)).toBe(3);
  });

  it('fails closed when current feature metadata, wrappers, or evidence anchors are changed', () => {
    const source = buildLectureLatexDocument('lecture-notes', 'Canonical integrity', notesBody);
    const tamperedSources = [
      source.replace(
        'includeSlideTitlePage=true showInlineEvidenceLabels=true',
        'showInlineEvidenceLabels=true includeSlideTitlePage=true',
      ),
      source.replace('showInlineEvidenceLabels=true', 'showInlineEvidenceLabels=false'),
      source.replace(
        '\\newcommand{\\gosuevidence}[1]{[#1]}',
        '\\newcommand{\\gosuevidence}[1]{\\ifhmode\\unskip\\fi}',
      ),
      source.replace('\\gosuevidence{M1}', '[M1]'),
      source.replace('\\gosuevidence{M1}', '\\gosuevidence{Z1}'),
      source.replace('\\gosuevidence{M1}', '\\gosuevidence {M1}'),
    ];

    for (const tampered of tamperedSources) {
      expect(() =>
        validateCanonicalLectureLatex('lecture-notes', 'Canonical integrity', tampered),
      ).toThrow(LectureLatexSourceError);
    }
  });

  it('requires the configured Sources used combination when building v2 notes', () => {
    const withoutSources = String.raw`\section{Result}
Source-bound result [M1].`;
    expect(() =>
      buildLectureLatexDocument('lecture-notes', 'Missing list', withoutSources),
    ).toThrow(expect.objectContaining({ reason: 'missing_sources_used' }));
    expect(() =>
      buildLectureLatexDocument('lecture-notes', 'Unexpected list', notesBody, {
        ...allDocumentFeatures,
        includeSourcesUsedSection: false,
      }),
    ).toThrow(expect.objectContaining({ reason: 'invalid_canonical_wrapper' }));
  });

  it.each([
    String.raw`\section{Source used}`,
    String.raw`\section{Source}`,
    String.raw`\section{Sources}`,
    String.raw`\section{Source list}`,
    String.raw`\section{References}`,
    String.raw`\section{Bibliography}`,
    String.raw`\section{Citations}`,
    String.raw`\section{Cited sources}`,
    String.raw`\section{Literature cited}`,
    String.raw`\section{출처 목록}`,
    String.raw`\section{참고 문헌}`,
    String.raw`\section{Sources   used}`,
    String.raw`\section{\textbf{References}}`,
    String.raw`\section{\textrm{References}}`,
    String.raw`\section{\textnormal{\textit{References}}}`,
    String.raw`\section{\underline{References}}`,
    String.raw`\section{\textsuperscript{References}}`,
    String.raw`\section{\Large References}`,
    String.raw`\section{Refer{ences}}`,
    String.raw`\subsection{References}`,
    String.raw`\subsubsection{출처 목록}`,
    String.raw`\paragraph{Bibliography}`,
  ])(
    'rejects an unconfigured semantic source-list heading while the list is hidden: %s',
    (heading) => {
      const body = `${String.raw`\section{Result}
Source-bound result [M1].`}
${heading}
[M1] Captured manuscript.`;
      expect(() =>
        buildLectureLatexDocument('lecture-notes', 'Hidden source list', body, {
          ...allDocumentFeatures,
          includeSourcesUsedSection: false,
        }),
      ).toThrow(expect.objectContaining({ reason: 'invalid_canonical_wrapper' }));
    },
  );

  it('distinguishes semantic source-list headings from prose and similarly named topics', () => {
    const body = String.raw`\section{\textbf{Reference methods}}
References and 출처 목록 are discussed as ordinary prose, not emitted as a source list [M1].`;
    expect(findLectureSourceListSections(body)).toEqual([]);
    expect(() =>
      buildLectureLatexDocument('lecture-notes', 'Reference methods', body, {
        ...allDocumentFeatures,
        includeSourcesUsedSection: false,
      }),
    ).not.toThrow();
  });

  it('grandfathers an exact custom content title without weakening canonical Sources used rules', () => {
    const hiddenBody = String.raw`\section{References}
Reference-estimator content remains evidence-bound [M1].`;
    const hidden = buildLectureLatexDocument(
      'lecture-notes',
      'Legacy custom structure',
      hiddenBody,
      { ...allDocumentFeatures, includeSourcesUsedSection: false },
      ['References'],
    );
    expect(validateCanonicalLectureLatex('lecture-notes', 'Legacy custom structure', hidden)).toBe(
      hidden,
    );
    expect(() =>
      buildLectureLatexDocument('lecture-notes', 'Not grandfathered', hiddenBody, {
        ...allDocumentFeatures,
        includeSourcesUsedSection: false,
      }),
    ).toThrow(expect.objectContaining({ reason: 'invalid_canonical_wrapper' }));

    const visibleBody = `${hiddenBody}
${String.raw`\section{Sources used}
[M1] Captured manuscript.`}`;
    expect(() =>
      buildLectureLatexDocument(
        'lecture-notes',
        'Legacy custom structure',
        visibleBody,
        allDocumentFeatures,
        ['References'],
      ),
    ).not.toThrow();
  });

  it.each(['section', 'subsection', 'subsubsection', 'paragraph'])(
    'requires Sources used to remain the final structural block before a later \\%s',
    (command) => {
      const body = `${notesBody}
\\${command}{Later material}
Later claim [M1].`;
      expect(() => buildLectureLatexDocument('lecture-notes', 'Terminal mapping', body)).toThrow(
        expect.objectContaining({ reason: 'invalid_canonical_wrapper' }),
      );
    },
  );

  it('rejects duplicate source-list aliases when the canonical mapping is enabled', () => {
    const body = `${String.raw`\section{References}
Reference content [M1].`}
${notesBody}`;
    expect(() => buildLectureLatexDocument('lecture-notes', 'Duplicate mapping', body)).toThrow(
      expect.objectContaining({ reason: 'invalid_canonical_wrapper' }),
    );
  });

  it('rejects optional short titles on newly authored structural headings', () => {
    const body = String.raw`\section[Short]{References}
Source mapping [M1].`;
    expect(() =>
      buildLectureLatexDocument('lecture-notes', 'Optional heading', body, {
        ...allDocumentFeatures,
        includeSourcesUsedSection: false,
      }),
    ).toThrow(expect.objectContaining({ reason: 'structural_heading_option' }));
  });

  it.each([
    String.raw`Claim [M1], [P2].`,
    String.raw`Claim [M1] and [P2].`,
    String.raw`Claim [M1]
and [P2].`,
    String.raw`Claim ([M1]).`,
    String.raw`Claim [[M1]].`,
    String.raw`Claim, [M1].`,
    String.raw`Claim. [M1]`,
    String.raw`Claim: [M1].`,
    String.raw`Claim [M1] .`,
  ])(
    'rejects evidence typography that would leave artifacts when labels are hidden: %s',
    (claim) => {
      const body = `${String.raw`\section{Result}`}
${claim}
${String.raw`\section{Sources used}
[M1] Manuscript
[P2] Paper`}`;
      expect(() => validateLectureLatexBody('lecture-notes', body)).toThrow(
        expect.objectContaining({ reason: 'evidence_label_typography' }),
      );
    },
  );

  it('accepts whitespace-only evidence clusters with sentence punctuation after the final label', () => {
    const body = String.raw`\section{Result}
Claim [M1] [P2].
\section{Sources used}
[M1] Manuscript
[P2] Paper`;
    expect(() => validateLectureLatexBody('lecture-notes', body)).not.toThrow();
  });

  it.each([
    String.raw`\item[[M1]] Captured manuscript`,
    String.raw`\item[{[M1]}] Captured manuscript`,
  ])('keeps a Sources used description-item label valid: %s', (item) => {
    const body = `${String.raw`\section{Result}
Claim [M1].
\section{Sources used}
\begin{description}`}
${item}
${String.raw`\end{description}`}`;
    const source = buildLectureLatexDocument('lecture-notes', 'Description mapping', body);
    expect(validateCanonicalLectureLatex('lecture-notes', 'Description mapping', source)).toBe(
      source,
    );
  });

  it.each([
    ['input', String.raw`\input{/etc/passwd}\section{Sources used}`],
    ['write18', String.raw`\write18{touch /tmp/x}\section{Sources used}`],
    ['newcommand', String.raw`\newcommand{\x}{bad}\section{Sources used}`],
    ['caret escape', String.raw`^^5cinput{/etc/passwd}\section{Sources used}`],
    ['document wrapper', String.raw`\begin{document}bad\end{document}`],
    ['Markdown', String.raw`# Markdown\section{Sources used}`],
    ['unclosed math', String.raw`An open $x+y.\section{Sources used}`],
    ['mixed math delimiters', String.raw`An open $$x+y$ display.\section{Sources used}`],
    ['raw prose underscore', String.raw`model_name is prose.\section{Sources used}`],
    ['raw prose ampersand', String.raw`notes & slides.\section{Sources used}`],
    ['raw prose caret', String.raw`value^label is prose.\section{Sources used}`],
    ['raw prose tilde', String.raw`approximately~equal.\section{Sources used}`],
    ['unbalanced environment', String.raw`\begin{itemize}\section{Sources used}`],
  ])('rejects unsafe or malformed notes body: %s', (_name, body) => {
    expect(() => validateLectureLatexBody('lecture-notes', body)).toThrow(LectureLatexSourceError);
  });

  it('rejects raw comments and slides without frames', () => {
    expect(() =>
      validateLectureLatexBody(
        'lecture-notes',
        String.raw`Text % hidden command
\section{Sources used}`,
      ),
    ).toThrow(LectureLatexSourceError);
    expect(() => validateLectureLatexBody('slides', String.raw`\section{No frame}`)).toThrow(
      LectureLatexSourceError,
    );
  });

  it('allows bounded mathematical spacing and aligned line breaks', () => {
    const body = String.raw`\section{Derivation}
\begin{align}
x &\le y \\
y &\approx z\,.
\end{align}
\section{Sources used}
\begin{itemize}
\item [M1] Captured manuscript.
\end{itemize}`;

    expect(() => validateLectureLatexBody('lecture-notes', body)).not.toThrow();
  });

  it('accepts ordinary inequalities without confusing them with raw HTML', () => {
    const body = String.raw`\section{Order}
Let $a < b$ and $c > d$, while \(a \le b\), $x<a>$, and $a<p>$ [M1].
\section{Sources used}
[M1] Captured manuscript.`;

    expect(() => validateLectureLatexBody('lecture-notes', body)).not.toThrow();
    expect(
      validationError(
        'lecture-notes',
        String.raw`\section{Order}<div>not LaTeX</div>\section{Sources used}`,
      ).reason,
    ).toBe('raw_html');
    expect(
      validationError(
        'lecture-notes',
        String.raw`\section{Order}<custom-tag data-x="1">not LaTeX</custom-tag>\section{Sources used}`,
      ).reason,
    ).toBe('raw_html');
    expect(
      validationError(
        'lecture-notes',
        String.raw`\section{Order}<a href="https://example.invalid">link</a><p>text</p>\section{Sources used}`,
      ).reason,
    ).toBe('raw_html');
    expect(
      validationError(
        'lecture-notes',
        String.raw`\section{Order}$a<p$ followed by <img src="x">\section{Sources used}`,
      ).reason,
    ).toBe('raw_html');
    expect(
      validationError(
        'lecture-notes',
        String.raw`\section{Order}<!-- hidden -->\section{Sources used}`,
      ).reason,
    ).toBe('raw_html');
  });

  it('balances command math delimiters without misreading table line-break spacing', () => {
    const body = String.raw`\section{Notation}
Inline \(x_i^2\) and display math
\[
\boxed{x_i^2 \le y_i^2}.
\]
\begin{tabular}{cc}
$x$ & $y$ \\[0.5em]
$1$ & $2$
\end{tabular}
\section{Sources used}
[M1] Captured manuscript.`;

    expect(() => validateLectureLatexBody('lecture-notes', body)).not.toThrow();
    expect(
      validationError('lecture-notes', String.raw`\section{Broken}\(x+y$\section{Sources used}`)
        .reason,
    ).toBe('unbalanced_math');
  });

  it('reports bounded reason IDs and up to 32 normalized unsupported tokens', () => {
    const commands = validationError(
      'lecture-notes',
      String.raw`\section{Aliases}
$\R+\E+\PP+\mainref+\includegraphics+\captionof+\foo+\bar+\baz+\quux+\R$ [M1].
\section{Sources used}
[M1] Captured manuscript.`,
    );
    expect(commands).toMatchObject({
      message: 'lecture_latex_invalid',
      reason: 'unsupported_command',
      token: String.raw`\R`,
    });
    expect(commands.tokens).toEqual([
      String.raw`\R`,
      String.raw`\E`,
      String.raw`\PP`,
      String.raw`\mainref`,
      String.raw`\includegraphics`,
      String.raw`\captionof`,
      String.raw`\foo`,
      String.raw`\baz`,
      String.raw`\quux`,
    ]);

    const aliases = Array.from(
      { length: 40 },
      (_, index) => `\\unsupported${'a'.repeat(index + 1)}`,
    );
    const bounded = validationError(
      'lecture-notes',
      `\\section{Aliases}\n${aliases.join(' ')}\n\\section{Sources used}\n[M1] Source.`,
    );
    expect(bounded.reason).toBe('unsupported_command');
    expect(bounded.tokens).toHaveLength(32);
    expect(bounded.tokens[0]).toBe(aliases[0]);
    expect(bounded.tokens.at(-1)).toBe(aliases[31]);

    const environments = validationError(
      'lecture-notes',
      String.raw`\section{Unsupported}
\begin{tikzpicture}\end{tikzpicture}
\begin{figure}\end{figure}
\section{Sources used}`,
    );
    expect(environments.reason).toBe('unsupported_environment');
    expect(environments.tokens).toEqual(['tikzpicture']);

    const customControlSymbol = validationError(
      'lecture-notes',
      String.raw`\section{Alias}
Use $\1$ only as a source-defined alias [M1].
\section{Sources used}
[M1] Captured manuscript.`,
    );
    expect(customControlSymbol.reason).toBe('unsupported_escape');
    expect(customControlSymbol.tokens).toEqual([String.raw`\1`]);
  });

  it('accepts only opaque GOSU figure references and preserves legacy v2 wrappers', () => {
    const body = String.raw`\section{Figure}
\begin{figure}
\centering
\gosuimage{${figureId}}
\caption{Captured estimator geometry}
\end{figure}
The geometry is supported by the captured manuscript [M1].
\section{Sources used}
[M1] Captured manuscript.`;
    const source = buildLectureLatexDocument('lecture-notes', 'Figure bundle', body);

    expect(findLectureFigureAssetIds(body)).toEqual([figureId]);
    expect(validateCanonicalLectureLatex('lecture-notes', 'Figure bundle', source)).toBe(source);
    expect(extractEditableLectureLatexBody('lecture-notes', 'Figure bundle', source).body).toBe(
      body,
    );

    for (const invalidBody of [
      body.replace(figureId, '../private-file'),
      body.replace(figureId, figureId.toUpperCase()),
      body.replace(`\\gosuimage{${figureId}}`, String.raw`\includegraphics{/tmp/private.jpg}`),
      body.replace(`\\gosuimage{${figureId}}`, String.raw`\gosuimage [width=2in]{${figureId}}`),
      body.replace(figureId, `${figureId}.jpg`),
    ]) {
      expect(() => validateLectureLatexBody('lecture-notes', invalidBody)).toThrow(
        LectureLatexSourceError,
      );
    }

    const currentPrefix = source.slice(0, source.indexOf('% GOSU-CONTENT-BEGIN'));
    const legacyV2WithFigure = source
      .replace('% GOSU-LECTURE-LATEX v3', '% GOSU-LECTURE-LATEX v2')
      .replace('\\usepackage{graphicx}\n', '')
      .replace(
        '\\newcommand{\\gosuimage}[1]{\\includegraphics[width=0.88\\linewidth]{Figure-#1.jpg}}\n',
        '',
      );
    expect(currentPrefix).toContain('\\usepackage{graphicx}');
    expect(() =>
      validateCanonicalLectureLatex('lecture-notes', 'Figure bundle', legacyV2WithFigure),
    ).toThrow(LectureLatexSourceError);

    const currentWithoutFigure = buildLectureLatexDocument(
      'lecture-notes',
      'Legacy v2 compatibility',
      notesBody,
    );
    const legacyV2 = currentWithoutFigure
      .replace('% GOSU-LECTURE-LATEX v3', '% GOSU-LECTURE-LATEX v2')
      .replace('\\usepackage{graphicx}\n', '')
      .replace(
        '\\newcommand{\\gosuimage}[1]{\\includegraphics[width=0.88\\linewidth]{Figure-#1.jpg}}\n',
        '',
      );
    expect(
      validateCanonicalLectureLatex('lecture-notes', 'Legacy v2 compatibility', legacyV2),
    ).toBe(legacyV2);
  });

  it('accepts safe article and single-page Beamer layout constructs', () => {
    const notes = String.raw`\begin{abstract}
A bounded summary [M1].
\end{abstract}
\section{Result}
\begin{flushleft}
Text\textsuperscript{2} and \textsubscript{n} [M1].
\end{flushleft}
\begin{minipage}{0.9\textwidth}
The notation stays consistent [M1].
\end{minipage}
\begin{align}
\boxed{x} &= y \tag{A} \\
z &= y \nonumber \\
\intertext{Hence, by the supplied result [M1],}
z &\le y.
\end{align}
\begin{table}
\centering
\caption{Bounded summary}
\begin{tabular}{cc}
\toprule
Term & Value \\
\cmidrule{1-2}
$x$ & $y$ \\
\addlinespace
$z$ & $y$ \\
\bottomrule
\end{tabular}
\end{table}
\section{Sources used}
[M1] Captured manuscript.`;
    const slides = String.raw`\begin{frame}
\frametitle{Bounded layout}
\begin{flushright}
Evidence\textsuperscript{2} [M1].
\end{flushright}
\begin{minipage}{0.8\textwidth}
The notation stays consistent [M1].
\end{minipage}
\begin{table}
\begin{tabular}{cc}
\hline
$a$ & $b$ \\
\cline{1-2}
$c$ & $d$ \\
\hline
\end{tabular}
\end{table}
\end{frame}`;

    expect(() => validateLectureLatexBody('lecture-notes', notes)).not.toThrow();
    expect(() => validateLectureLatexBody('slides', slides)).not.toThrow();
  });

  it('repairs deterministic JSON backslash escapes before validating generated bodies', () => {
    const decodedNotes =
      '\u0008egin{samepage}\n\\section{Transport}\nThe ratio is $\u000Crac{1}{2}$ [M1].\n\\end{samepage}\n\\section{Sources used}\n[M1] Captured manuscript.';
    const decodedSlides =
      '\u0008egin{frame}{Transport}\nThe ratio is $\u000Crac{1}{2}$ [M1].\n\\end{frame}';

    const notes = normalizeGeneratedLectureLatexBody('lecture-notes', decodedNotes);
    const slides = normalizeGeneratedLectureLatexBody('slides', decodedSlides);

    expect(notes).toContain(String.raw`\begin{samepage}`);
    expect(notes).toContain(String.raw`\frac{1}{2}`);
    expect(slides).toContain(String.raw`\begin{frame}`);
    expect(() => validateLectureLatexBody('lecture-notes', notes)).not.toThrow();
    expect(() => validateLectureLatexBody('slides', slides)).not.toThrow();

    const unsupported = normalizeGeneratedLectureLatexBody(
      'lecture-notes',
      '\\section{Transport}\n\u000Coo{value}\n\\section{Sources used}\n[M1] Source.',
    );
    expect(validationError('lecture-notes', unsupported)).toMatchObject({
      reason: 'unsupported_command',
      token: String.raw`\foo`,
    });

    const restoredWrapper = normalizeGeneratedLectureLatexBody(
      'lecture-notes',
      '\u0008egin{document}hidden\\end{document}',
    );
    expect(validationError('lecture-notes', restoredWrapper).reason).toBe('document_wrapper');
  });

  it('fails closed on ambiguous JSON tab, carriage-return, and line-feed escapes', () => {
    for (const [body, token] of [
      ['\\section{Transport}\n\theta', String.raw`\theta`],
      ['\\section{Transport}\n\ref', String.raw`\ref`],
      ['\\section{Transport}\nonumber', String.raw`\nonumber`],
      ['\\section{Transport}\newcommand', String.raw`\newcommand`],
    ] as const) {
      try {
        normalizeGeneratedLectureLatexBody('lecture-notes', body);
        throw new Error('Expected LectureLatexSourceError');
      } catch (error) {
        expect(error).toBeInstanceOf(LectureLatexSourceError);
        expect(error).toMatchObject({
          reason: 'ambiguous_json_backslash_escape',
          token,
        });
      }
    }

    const ordinaryLineBreak = '\\section{Transport}\nNarrative continues [M1].';
    expect(normalizeGeneratedLectureLatexBody('lecture-notes', ordinaryLineBreak)).toBe(
      ordinaryLineBreak,
    );
    const intentionalIndentedEquationLine = '\\begin{align}\n  u &= v.\n\\end{align}';
    expect(
      normalizeGeneratedLectureLatexBody('lecture-notes', intentionalIndentedEquationLine),
    ).toBe(intentionalIndentedEquationLine);
    expect(() =>
      normalizeGeneratedLectureLatexBody('lecture-notes', '\\begin{align}\nu &= v.\n\\end{align}'),
    ).toThrowError(
      expect.objectContaining({
        reason: 'ambiguous_json_backslash_escape',
        token: String.raw`\nu`,
      }),
    );

    const canonicalBody =
      '\\section{Legacy}\nA\tlegacy tab and carriage return\r\nremain valid.\n\\section{Sources used}\n[M1] Source.';
    expect(() => validateLectureLatexBody('lecture-notes', canonicalBody)).not.toThrow();
  });

  it('accepts compiler-backed AMS constructs while keeping note-only proof commands scoped', () => {
    const notes = String.raw`\begin{samepage}
\section{Optimization}
For $x \longmapsto f(x)$, compare $\arg f$ with $\operatorname*{arg\,max}_x f(x)$ [M1].
\begin{subequations}
\begin{alignat}{2}
x &={} y \qquad & z &={} w, \\
u &={} v & q &={} r.
\end{alignat}
\end{subequations}
\begin{proof}
The supplied identity is preserved [M1].
\begin{equation}x=x.\qedhere\end{equation}
\end{proof}
\end{samepage}
\section{Sources used}
[M1] Captured manuscript.`;
    const slides = String.raw`\begin{frame}{Optimization}
\begin{samepage}
\begin{subequations}
\begin{alignat*}{2}
x &={} y \qquad & z &={} w.
\end{alignat*}
\end{subequations}
$x \longmapsto f(x)$ and $\arg f$ [M1].
\end{samepage}
\end{frame}`;

    expect(() => validateLectureLatexBody('lecture-notes', notes)).not.toThrow();
    expect(() => validateLectureLatexBody('slides', slides)).not.toThrow();
    expect(
      validationError('slides', String.raw`\begin{frame}{Proof}$x=x.\qedhere$ [M1].\end{frame}`),
    ).toMatchObject({ reason: 'unsupported_command', token: String.raw`\qedhere` });
    for (const unsupportedOperator of ['argmax', 'argmin']) {
      expect(
        validationError(
          'lecture-notes',
          `\\section{Operator}\n$\\${unsupportedOperator}_x f(x)$ [M1].\n\\section{Sources used}\n[M1] Source.`,
        ),
      ).toMatchObject({ reason: 'unsupported_command', token: `\\${unsupportedOperator}` });
    }
  });

  it('rejects new overlays and automatic frame splitting but reopens legacy canonical slides', () => {
    expect(
      validationError('slides', String.raw`\begin{frame}{Overlay}\pause Evidence [M1].\end{frame}`)
        .reason,
    ).toBe('beamer_overlay');
    expect(
      validationError(
        'slides',
        String.raw`\begin{frame}{Overlay}\begin{itemize}\item<2-> Evidence [M1].\end{itemize}\end{frame}`,
      ).reason,
    ).toBe('beamer_overlay');
    for (const overlayBody of [
      String.raw`\textbf<2->{Evidence}`,
      String.raw`\emph<+->{Evidence}`,
      String.raw`\footnote<2->{Evidence}`,
      `\\item<${Array.from({ length: 40 }, (_, index) => index + 1).join(',')}> Evidence`,
      String.raw`\item<1,
2,
3> Evidence`,
    ]) {
      expect(
        validationError('slides', String.raw`\begin{frame}{Overlay}${overlayBody} [M1].\end{frame}`)
          .reason,
      ).toBe('beamer_overlay');
    }
    expect(
      validationError(
        'slides',
        String.raw`\begin{frame}[allowframebreaks]{Split}Evidence [M1].\end{frame}`,
      ).reason,
    ).toBe('beamer_multipage_frame');
    for (const spacing of ['\n', ' '.repeat(300)]) {
      expect(
        validationError(
          'slides',
          `\\begin{frame}${spacing}[${spacing}allowframebreaks${spacing}]{Split}Evidence [M1].\\end{frame}`,
        ).reason,
      ).toBe('beamer_multipage_frame');
    }
    expect(
      validationError(
        'slides',
        String.raw`\begin{frame}[plain]{Unsupported option}Evidence [M1].\end{frame}`,
      ).reason,
    ).toBe('beamer_frame_option');

    const legacyCanonical = legacyCanonicalSlides(
      'Legacy deck',
      String.raw`\begin{frame}{Result}\pause Evidence [M1].\end{frame}`,
    );
    expect(validateCanonicalLectureLatex('slides', 'Legacy deck', legacyCanonical)).toBe(
      legacyCanonical,
    );
    const legacyTypographyCanonical = legacyCanonicalSlides(
      'Legacy deck',
      String.raw`\begin{frame}{Result}Legacy evidence ([M1], [P2]).\end{frame}`,
    );
    expect(validateCanonicalLectureLatex('slides', 'Legacy deck', legacyTypographyCanonical)).toBe(
      legacyTypographyCanonical,
    );
    const legacyOptionalHeadingCanonical = legacyCanonicalSlides(
      'Legacy deck',
      String.raw`\section[Short]{References}
\begin{frame}{Result}Legacy evidence [M1].\end{frame}`,
    );
    expect(
      validateCanonicalLectureLatex('slides', 'Legacy deck', legacyOptionalHeadingCanonical),
    ).toBe(legacyOptionalHeadingCanonical);
    const legacyMultipageCanonical = legacyCanonicalSlides(
      'Legacy deck',
      String.raw`\begin{frame}{Result}Evidence [M1].\end{frame}`,
    ).replace('\\begin{frame}{Result}', '\\begin{frame}[\n  allowframebreaks\n]{Result}');
    expect(validateCanonicalLectureLatex('slides', 'Legacy deck', legacyMultipageCanonical)).toBe(
      legacyMultipageCanonical,
    );
    const v2Canonical = buildLectureLatexDocument(
      'slides',
      'Current deck',
      String.raw`\begin{frame}{Result}Evidence [M1].\end{frame}`,
    ).replace('Evidence \\gosuevidence{M1}.', '\\pause Evidence \\gosuevidence{M1}.');
    expect(() => validateCanonicalLectureLatex('slides', 'Current deck', v2Canonical)).toThrow(
      expect.objectContaining({ reason: 'beamer_overlay' }),
    );
    expect(() =>
      validateLectureLatexBody(
        'slides',
        String.raw`\begin{frame}{Math}$x<a>$ and $a<p>$ [M1].\end{frame}`,
      ),
    ).not.toThrow();
  });

  it('allows escaped prose specials and math-only subscript or superscript syntax', () => {
    const body = String.raw`\section{Notation}
Use model\_name \& slides in prose, and $x_i^2$ or $$y_j^3$$ in math [M1].
\section{Sources used}
[M1] Captured manuscript.`;

    expect(() => validateLectureLatexBody('lecture-notes', body)).not.toThrow();
  });

  it('keeps article-only and Beamer-only constructs inside their compiler kind', () => {
    const notes = String.raw`\section{Statement}
\begin{theorem}A bounded statement.\end{theorem}
\begin{proof}A bounded proof.\end{proof}
$\bm{x}\in\mathbb{R}$.
\section{Sources used}
[M1] Captured manuscript.`;
    const slides = String.raw`\begin{frame}{Emphasis}
\begin{block}{Result}Evidence [M1].\end{block}
\alert{Bounded claim} [M1].
\end{frame}`;

    expect(() => validateLectureLatexBody('lecture-notes', notes)).not.toThrow();
    expect(() => validateLectureLatexBody('slides', slides)).not.toThrow();
    expect(() => validateLectureLatexBody('lecture-notes', slides)).toThrow(
      LectureLatexSourceError,
    );
    expect(() => validateLectureLatexBody('slides', notes)).toThrow(LectureLatexSourceError);
  });

  it('accepts the bounded AMS matrix dialect, escaped prose, starred sources, and Beamer columns', () => {
    const realisticNotes = String.raw`\section{Bootstrap construction}
For $B\mid n$, the count $\binom{n}{B}$ is evaluated modulo $m$ as $B\pmod m$, with $\|x\|_2$ as a standard norm [M1].
The reported rate is 95\%, bias \& variance use model\_id, C\#, and the literal \textasciitilde{} symbol [M1].
\begin{equation}
\left\lVert
\begin{pmatrix}
B & 0 \\
0 & n
\end{pmatrix}
\right\rVert_2 \coloneqq \max\{B,n\}.
\end{equation}
\section*{Sources used}
[M1] Cheap Bootstrap manuscript.`;
    const realisticSlides = String.raw`\begin{frame}{Bootstrap construction}
\begin{columns}
\begin{column}{0.48\textwidth}
$B\mid n$ and $\binom{n}{B}$ [M1].
\end{column}
\begin{column}{0.48\textwidth}
$\langle B,n\rangle$ with $\lVert(B,n)\rVert_2$ [M1].
\end{column}
\end{columns}
\end{frame}`;

    expect(() => validateLectureLatexBody('lecture-notes', realisticNotes)).not.toThrow();
    expect(() => validateLectureLatexBody('slides', realisticSlides)).not.toThrow();
    expect(buildLectureLatexDocument('lecture-notes', 'Cheap Bootstrap', realisticNotes)).toContain(
      '\\section*{Sources used}',
    );
  });
});
