import { describe, expect, it } from 'vitest';

import {
  buildLectureLatexDocument,
  countLectureSlidePages,
  LectureLatexSourceError,
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

describe('Lecture LaTeX source', () => {
  it('builds deterministic self-contained notes and slides', () => {
    const notes = buildLectureLatexDocument('lecture-notes', 'Calculus', notesBody);
    const slides = buildLectureLatexDocument('slides', 'Calculus', slidesBody);

    expect(notes).toContain('\\documentclass[11pt]{article}');
    expect(notes).toContain(notesBody);
    expect(slides).toContain('\\documentclass[aspectratio=169]{beamer}');
    expect(slides).toContain(slidesBody);
    expect(countLectureSlidePages(slidesBody)).toBe(3);
    expect(validateCanonicalLectureLatex('lecture-notes', 'Calculus', notes)).toBe(notes);
    expect(validateCanonicalLectureLatex('slides', 'Calculus', slides)).toBe(slides);
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

  it('reports bounded reason IDs and up to eight normalized unsupported tokens', () => {
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
    ]);

    const environments = validationError(
      'lecture-notes',
      String.raw`\section{Unsupported}
\begin{tikzpicture}\end{tikzpicture}
\begin{figure}\end{figure}
\section{Sources used}`,
    );
    expect(environments.reason).toBe('unsupported_environment');
    expect(environments.tokens).toEqual(['tikzpicture', 'figure']);

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

    const canonical = buildLectureLatexDocument(
      'slides',
      'Legacy deck',
      String.raw`\begin{frame}{Result}Evidence [M1].\end{frame}`,
    );
    const legacyCanonical = canonical.replace('Evidence [M1].', '\\pause Evidence [M1].');
    expect(validateCanonicalLectureLatex('slides', 'Legacy deck', legacyCanonical)).toBe(
      legacyCanonical,
    );
    const legacyMultipageCanonical = canonical.replace(
      '\\begin{frame}{Result}',
      '\\begin{frame}[\n  allowframebreaks\n]{Result}',
    );
    expect(validateCanonicalLectureLatex('slides', 'Legacy deck', legacyMultipageCanonical)).toBe(
      legacyMultipageCanonical,
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
