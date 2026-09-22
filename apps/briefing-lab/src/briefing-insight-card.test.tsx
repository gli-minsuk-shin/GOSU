import { describe, it, expect } from 'vitest';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';
import { BriefingMarkdown, BriefingInsightCard } from './briefing-insight-card';
import type { LiveItem } from './live-types';
import { BriefingHistoryItem } from './briefing-history-view';
describe('compact evidence rendering', () => {
  it('identifies a stored Scholar-derived paper without presenting it as an email', () => {
    const html = renderToStaticMarkup(
      <BriefingHistoryItem
        item={{
          id: 'scholar-paper',
          kind: 'papers',
          title: 'Alert paper',
          summary: 'Alert excerpt summary',
          readScope: 'mail-preview',
          importance: 'medium',
          relevance: '',
          discoverySource: 'google-scholar-alert',
        }}
      />,
    );
    expect(html).toContain('Google Scholar 알림');
    expect(html).toContain('briefing-paper-disclosure');
    expect(html).not.toContain('briefing-email-disclosure');
  });
  it('shows a saved email whose summary failed: subject, sender and received time, marked as not summarized', () => {
    // 2026-09-21: "이메일 요약이 실패해도 제목, 보낸이, 보낸 시간은 뜨게 해줘. 요약만 빠지게."
    const html = renderToStaticMarkup(
      <BriefingHistoryItem
        timeZone="Asia/Seoul"
        item={{
          id: 'a'.repeat(64),
          kind: 'email',
          title: 'Budget approval needed',
          summary: '',
          readScope: 'mail-preview',
          importance: 'uncertain',
          relevance: '',
          mailSender: 'Dana Kim <dana@example.test>',
          receivedAt: '2026-09-21T03:15:00.000Z',
        }}
      />,
    );
    expect(html).toContain('Budget approval needed');
    expect(html).toContain('Dana Kim');
    expect(html).toContain('12:15');
    expect(html).toContain('요약 실패 · 원본 확인');
    expect(html).toContain('AI 요약 실패 · 메일이 온 것만 표시합니다 · 다음 브리핑에서 다시 요약');
    expect(html).toContain('제목·보낸 사람·받은 시각만 기록했습니다');
    // It is not dressed up as a stored summary.
    expect(html).not.toContain('이전에 저장한 AI 요약');
    // A summarized email is unchanged.
    const summarized = renderToStaticMarkup(
      <BriefingHistoryItem
        item={{
          id: 'b'.repeat(64),
          kind: 'email',
          title: 'Summarized',
          summary: 'Reply before Friday.',
          readScope: 'mail-preview',
          importance: 'medium',
          relevance: '',
        }}
      />,
    );
    expect(summarized).toContain('Reply before Friday.');
    expect(summarized).not.toContain('요약 실패');
    expect(summarized).toContain('이전에 저장한 AI 요약');
  });
  it.each(['live', 'history'] as const)(
    'shows read/unread/unknown status beside the collapsed %s email title',
    (mode) => {
      for (const unread of [true, false, undefined]) {
        const item = {
          id: 'm',
          kind: 'email' as const,
          title: 'Status email',
          readScope: 'mail-metadata' as const,
          ...(unread === undefined ? {} : { mailUnread: unread }),
        };
        const html = renderToStaticMarkup(
          mode === 'history' ? (
            <BriefingHistoryItem
              item={{ ...item, summary: 'Saved summary', importance: 'high', relevance: '' }}
            />
          ) : (
            <BriefingInsightCard
              item={{ ...item, text: '', source: 'Mail', details: [] }}
              memory={null}
              routineId="r"
            />
          ),
        );
        const header =
          html.match(/<summary class="briefing-email-summary"[^]*?<\/summary>/)?.[0] ?? '';
        expect(header).toContain('briefing-mail-read-status');
        expect(header).toContain(
          unread === true ? '읽지 않음' : unread === false ? '읽음' : '상태 미확인',
        );
        if (mode === 'history') expect(header).toContain('브리핑 당시');
        expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
      }
    },
  );
  it('displays a prior live receipt’s exact reader status, never inferring it from a subject or summary', () => {
    const html = renderToStaticMarkup(
      <BriefingInsightCard
        item={{
          id: 'm',
          kind: 'email',
          title: '읽지 않음이라는 제목',
          text: '읽지 않음',
          source: 'Mail',
          readScope: 'mail-metadata',
          details: ['Sender', '읽음'],
        }}
        memory={null}
        routineId="r"
      />,
    );
    expect(html).toMatch(/class="briefing-mail-read-status is-read"/);
  });
  it.each(['live', 'history'] as const)(
    'shows receiving account and received time in the collapsed %s email',
    (mode) => {
      const mailAccount = {
        id: 'receiving-account',
        name: 'Google',
        addresses: ['work@example.test'],
      };
      const source = {
        id: 'm',
        kind: 'email' as const,
        title: 'Notice',
        readScope: 'mail-metadata' as const,
        mailAccount,
      };
      const html = renderToStaticMarkup(
        mode === 'history' ? (
          <BriefingHistoryItem
            item={{
              ...source,
              receivedAt: '2026-09-09T04:22:00Z',
              summary: 'Saved',
              importance: 'high',
              relevance: '',
            }}
            savedAt="2026-09-09T11:00:00Z"
          />
        ) : (
          <BriefingInsightCard
            item={{
              ...source,
              publishedAt: '2026-09-09T04:22:00Z',
              text: '',
              source: 'Apple Mail',
              details: ['sender@example.test'],
            }}
            memory={null}
            routineId="r"
          />
        ),
      );
      const header =
        html.match(/<summary class="briefing-email-summary"[^]*?<\/summary>/)?.[0] ?? '';
      expect(header).toContain('work@example.test');
      expect(header).toContain('오후 1:22');
      expect(header).not.toContain('오후 8:00');
    },
  );
  it.each(['live', 'history'] as const)(
    'keeps the %s original Mail link next to the collapsed title, not inside expanded evidence',
    (mode) => {
      const mailMessageUrl = 'message://%3Coriginal%40example.test%3E';
      const source = {
        id: 'm',
        title: 'Original email',
        kind: 'email' as const,
        readScope: 'mail-metadata' as const,
        mailMessageUrl,
      };
      const html = renderToStaticMarkup(
        mode === 'history' ? (
          <BriefingHistoryItem
            item={{ ...source, summary: 'Saved', importance: 'high', relevance: '' }}
            mailOpenTarget={{ routineId: 'r', historyId: 'h', itemId: source.id }}
          />
        ) : (
          <BriefingInsightCard
            item={{ ...source, text: '', source: 'Apple Mail', details: [] }}
            mailOpenTarget={{
              routineId: 'r',
              receiptId: '11111111-1111-4111-8111-111111111111',
              itemId: source.id,
            }}
            memory={null}
            routineId="r"
          />
        ),
      );
      const header =
        html.match(/<summary class="briefing-email-summary"[^]*?<\/summary>/)?.[0] ?? '';
      expect(header).toContain('briefing-email-title-row');
      expect(header).not.toContain('href="message:');
      expect(header).toContain('Apple Mail에서 원본 메일 열기');
      expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    },
  );
  const analysis = {
    id: 'p',
    summary: 'Short summary',
    detail: 'Detailed method and limitations',
    keywords: ['Optimization', 'Gradient stability'],
    importance: 'high' as const,
    importanceReason: 'Matches the research project',
    relevance: 'Direct research relevance',
    action: 'Inspect experiments',
    evidenceQuote: 'Abstract',
    equationIds: [],
    equationExplanations: [],
    figureIds: [],
    memorySuggestion: null,
  };
  it('shows only title, keywords and adjacent feedback in a collapsed paper row; priority/detail remain expanded', () => {
    const html = renderToStaticMarkup(
      <BriefingInsightCard
        item={{
          id: 'p',
          kind: 'papers',
          title: 'A research paper',
          text: 'Abstract',
          readScope: 'abstract',
          source: 'arXiv',
          details: [],
        }}
        insight={analysis}
        memory={null}
        routineId="r"
        onFeedback={async () => undefined}
      />,
    );
    const summary =
      html.match(/<summary class="briefing-paper-summary"[^]*?<\/summary>/)?.[0] ?? '';
    expect(summary).toContain('A research paper');
    expect(summary).toContain('Optimization');
    expect(summary).toContain('aria-label="연구 우선순위 · 높음"');
    expect(summary).toContain('briefing-importance-icon high');
    expect(summary).toContain('briefing-item-meta');
    expect(summary).toContain('aria-label="관심 있음"');
    expect(summary).not.toContain('Short summary');
    expect(summary).not.toContain('Detailed method');
    expect(html).toContain('Detailed method and limitations');
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
  });
  it('does not show forced research relevance for email, including previously stored legacy analyses', () => {
    const html = renderToStaticMarkup(
      <BriefingInsightCard
        item={{
          id: 'p',
          kind: 'email',
          title: 'Meeting reply needed',
          text: 'Abstract',
          readScope: 'mail-preview',
          source: 'Apple Mail',
          details: [],
        }}
        insight={analysis}
        memory={null}
        routineId="r"
      />,
    );
    expect(html).not.toContain('내 연구와의 연결');
    expect(html).not.toContain('Direct research relevance');
    expect(html).not.toContain('연구 우선순위');
    expect(html).toContain('다음 행동');
    expect(html).toContain('Short summary');
  });
  it.each(['live', 'history'] as const)(
    'keeps %s email collapsed with a short summary and feedback; actions and source detail require expansion',
    (mode) => {
      const props = {
        id: 'm',
        title: 'Meeting reply needed',
        readScope: 'mail-preview',
        summary: '**Reply requested.** Please confirm attendance.',
        importance: 'high',
        relevance: '',
        importanceReason: 'Explicit response deadline',
        action: 'Reply by Friday',
        kind: 'email' as const,
      };
      const html = renderToStaticMarkup(
        mode === 'history' ? (
          <BriefingHistoryItem
            item={props}
            onFeedback={async () => undefined}
            onRefresh={async () => undefined}
          />
        ) : (
          <BriefingInsightCard
            item={{
              ...props,
              readScope: 'mail-preview',
              source: 'Apple Mail',
              text: 'Original private source',
              details: ['Team <team@example.test>'],
            }}
            insight={{ ...analysis, id: 'm', summary: props.summary, action: props.action }}
            memory={null}
            routineId="r"
            onFeedback={async () => undefined}
          />
        ),
      );
      expect(html).toContain('<details class="briefing-email-disclosure">');
      expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
      const header =
        html.match(/<summary class="briefing-email-summary"[^]*?<\/summary>/)?.[0] ?? '';
      expect(header).toContain('Meeting reply needed');
      expect(header).toContain('Reply requested.');
      expect(header).toContain('aria-label="관심 있음"');
      expect(header).not.toContain('Reply by Friday');
      expect(header).not.toContain('Original private source');
      expect(html).toContain('Reply by Friday');
      if (mode === 'live') expect(header).toContain('team@example.test');
      if (mode === 'history')
        expect(html.indexOf('briefing-summary-refresh')).toBeGreaterThan(
          html.lastIndexOf('</details>'),
        );
    },
  );
  it('links the paper title and original-source action to the exact source metadata URL', () => {
    const url = 'https://arxiv.org/abs/2609.05382v1';
    const html = renderToStaticMarkup(
      <BriefingInsightCard
        item={{
          id: 'p',
          kind: 'papers',
          title: 'A research paper',
          text: 'Abstract',
          source: 'arXiv',
          readScope: 'abstract',
          details: [],
          sourceUrl: url,
        }}
        memory={null}
        routineId="r"
      />,
    );
    expect(html).toMatch(
      /<h3><a [^>]*href="https:\/\/arxiv.org\/abs\/2609.05382v1"[^>]*>A research paper<\/a><\/h3>/,
    );
    expect(html.match(/href="https:\/\/arxiv.org\/abs\/2609.05382v1"/g)).toHaveLength(3);
    expect(html.indexOf('briefing-paper-source-link')).toBeLessThan(html.indexOf('</summary>'));
    expect(html).toContain('원문 열기');
    expect(html).not.toContain('원문 링크 미확인');
  });
  it.each([undefined, 'javascript:alert(1)', 'https://user:password@arxiv.org/abs/2609.05382'])(
    'labels missing or unsafe original links without fabricating one: %s',
    (sourceUrl) => {
      const item: LiveItem = {
        id: 'scholar:p',
        kind: 'papers',
        title: 'Scholar alert',
        text: 'Partial alert',
        source: 'Scholar-style mail',
        readScope: 'mail-preview',
        details: [],
        ...(sourceUrl ? { sourceUrl } : {}),
      };
      const html = renderToStaticMarkup(
        <BriefingInsightCard item={item} memory={null} routineId="r" />,
      );
      expect(html).toContain('원문 링크 미확인');
      expect(html).not.toContain('href=');
    },
  );
  it('renders LaTeX without loading model-invented links, images, or raw HTML', () => {
    const html = renderToStaticMarkup(
      <BriefingMarkdown
        text={
          'Relevant $x^2$ [link](https://invalid.example/secret) ![image](https://invalid.example/pixel) <img src="https://invalid.example/raw" />'
        }
      />,
    );
    expect(html).toContain('katex');
    expect(html).not.toContain('src=');
    expect(html).not.toContain('href=');
  });
  it('renders the five paper-template sections, inline/block math and selected source figures', () => {
    const html = renderToStaticMarkup(
      <BriefingInsightCard
        item={{
          id: 'p',
          kind: 'papers',
          title: 'A templated paper',
          text: 'The source reports x.',
          readScope: 'abstract',
          source: 'arXiv',
          details: [],
        }}
        insight={{
          ...analysis,
          researchQuestion: 'Does $x$ improve the target?',
          strengths: 'Clear setup.',
          limitations: 'Limited evidence.',
          methodsAndAssumptions: 'Assumes $x > 0$.',
          reportedResults: 'The result is shown as $$y=x^2$$.',
          equationIds: ['eq-1'],
          figureIds: ['fig-1'],
        }}
        paper={{
          readScope: 'html-excerpt',
          excerpt: 'The source reports x.',
          equations: [{ id: 'eq-1', latex: 'y=x^2' }],
          figures: [
            {
              id: 'fig-1',
              caption: 'Reported result figure',
              assetUrl: 'https://arxiv.org/html/test/figure.webp',
              imageData: 'data:image/webp;base64,fixture',
            },
          ],
          sourceUrl: 'https://arxiv.org/html/test',
          note: 'HTML excerpt',
        }}
        memory={null}
        routineId="r"
        onFeedback={async () => undefined}
      />,
    );
    for (const heading of [
      '1. 연구 질문',
      '2. 강점',
      '3. 약점과 한계',
      '4. 방법과 가정',
      '5. 보고된 결과',
    ])
      expect(html).toContain(heading);
    expect(html).toContain('katex');
    expect(html).toContain('Reported result figure');
    expect(html).toContain('data:image/webp;base64,fixture');
    expect(html).toContain('aria-label="관심 있음"');
    expect(html).toContain('aria-label="관심 없음"');
  });
  it.each(['papers', 'email'] as const)(
    'visually marks the selected %s preference without toggling its disclosure',
    async (kind) => {
      const onFeedback = vi.fn(async () => undefined);
      let renderer!: ReturnType<typeof create>;
      await act(() => {
        renderer = create(
          <BriefingInsightCard
            item={{
              id: 'p',
              kind,
              title: 'Paper',
              text: 'Abstract',
              readScope: 'abstract',
              source: 'arXiv',
              details: [],
            }}
            insight={analysis}
            memory={null}
            routineId="r"
            onFeedback={onFeedback}
          />,
        );
      });
      const buttons = renderer.root
        .findAllByType('button')
        .filter((b) => typeof b.props['aria-pressed'] === 'boolean');
      const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      await act(() => buttons[0]!.props.onClick(event));
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
      expect(onFeedback).toHaveBeenCalledWith('important', analysis.keywords);
      expect(buttons[0]!.props['aria-pressed']).toBe(true);
      expect(buttons[0]!.props.className).toContain('selected');
      expect(buttons[1]!.props['aria-pressed']).toBe(false);
      renderer.unmount();
    },
  );
  it('keeps email feedback in the header even before AI succeeds', () => {
    const html = renderToStaticMarkup(
      <BriefingInsightCard
        item={{
          id: 'mail',
          kind: 'email',
          title: 'Waiting for summary',
          text: 'Source',
          source: 'Apple Mail',
          readScope: 'mail-preview',
          details: [],
        }}
        memory={null}
        routineId="r"
        onFeedback={async () => undefined}
      />,
    );
    expect(html).toContain('aria-label="관심 있음"');
    expect(html).toContain('aria-label="관심 없음"');
    expect(html.indexOf('aria-label="관심 있음"')).toBeLessThan(html.indexOf('AI 요약 전'));
    expect(html).toContain('briefing-item-meta');
  });
  it('does not pretend abstract text is an AI summary and hides it behind a disclosure', () => {
    const html = renderToStaticMarkup(
      <BriefingInsightCard
        item={{
          id: 'p',
          kind: 'papers',
          title: 'Paper',
          text: 'Original abstract',
          readScope: 'abstract',
          source: 'arXiv',
          details: [],
        }}
        memory={null}
        routineId="r"
      />,
    );
    expect(html).toContain('AI 요약 전');
    expect(html).toContain('원문 발췌 보기');
    expect(html).not.toContain('<details open');
  });
  it('uses the same compact disclosure for stored papers and does not reintroduce relevance on old email history', () => {
    const stored = {
      id: 'old',
      title: 'Earlier paper',
      readScope: 'abstract',
      summary: 'Saved summary',
      importance: 'high',
      relevance: 'Only for papers',
    };
    const paperHtml = renderToStaticMarkup(
      <BriefingHistoryItem
        item={{
          ...stored,
          kind: 'papers',
          keywords: ['Optimization'],
          detail: 'Saved detailed explanation',
          equations: [{ latex: 'x^2', explanation: 'Saved equation explanation' }],
        }}
      />,
    );
    expect(paperHtml).toContain('briefing-paper-summary');
    expect(paperHtml).toContain('Saved detailed explanation');
    expect(paperHtml).toContain('katex');
    expect(paperHtml).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    const mailHtml = renderToStaticMarkup(
      <BriefingHistoryItem item={{ ...stored, readScope: 'mail-preview' }} />,
    );
    expect(mailHtml).not.toContain('Only for papers');
    expect(mailHtml).not.toContain('연구 우선순위');
  });
});
