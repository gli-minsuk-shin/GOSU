import { describe, expect, it } from 'vitest';

import {
  buildLectureLatexDocument,
  countLectureSlidePages,
  LectureLatexSourceError,
  validateCanonicalLectureLatex,
  validateLectureLatexBody,
} from '../src/main/lecture-latex-source';

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
});
