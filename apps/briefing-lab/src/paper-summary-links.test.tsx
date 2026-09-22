import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { PaperSummarySaveOffer } from './paper-summary-offer';
import {
  paperSummaryCandidate,
  paperSummaryOffer,
  verifiablePaperLink,
  type PaperSummaryCandidate,
} from './paper-summary-contract';

const QUESTION = 'TabPFN 클래스 확장 관련 논문 찾아서 정리해줘';
const ANSWER = [
  '관련 문헌입니다.',
  '1. [TabPFN: A Transformer That Solves Small Tabular Classification Problems](https://arxiv.org/abs/2207.01848) 은 출발점입니다.',
  '2. [Sparse inverse covariance estimation with the graphical lasso](https://doi.org/10.1093/biostatistics/kxm045) 는 공분산 추정의 기준입니다.',
  '3. 자세한 비교는 [보고서 §2.2](https://example.com/report#2-2)에 있습니다.',
  '4. [검색 결과](https://www.semanticscholar.org/search?q=tabpfn) 도 참고하세요.',
  '',
  '이 문헌별 분석을 Briefing Lab 논문 요약 라이브러리에도 추가할까요?',
].join('\n');

describe('links the paper library can verify', () => {
  it('accepts exactly the four source forms of the ingestion gate', () => {
    for (const url of [
      'https://arxiv.org/abs/2207.01848',
      'https://arxiv.org/abs/2207.01848v3',
      'https://arxiv.org/pdf/2207.01848.pdf',
      'https://doi.org/10.1093/biostatistics/kxm045',
      'https://openreview.net/forum?id=cp5PvcI6w8_',
      'https://proceedings.mlr.press/v235/mueller24a.html',
    ])
      expect(verifiablePaperLink(url), url).toBe(true);
    for (const url of [
      'https://example.com/report#2-2',
      'https://www.semanticscholar.org/paper/abc',
      'https://doi.org/10.1093/biostatistics/kxm045?utm=1',
      'https://scholar.google.com/scholar?q=tabpfn',
      'http://arxiv.org/abs/2207.01848',
    ])
      expect(verifiablePaperLink(url), url).toBe(false);
  });

  it('keeps only verifiable links, so one report link can no longer fail the whole save', () => {
    const candidate = paperSummaryCandidate(QUESTION, ANSWER);

    expect(candidate?.sourceUrls).toEqual([
      'https://arxiv.org/abs/2207.01848',
      'https://doi.org/10.1093/biostatistics/kxm045',
    ]);
  });

  it('pairs every paper with its own link text so each can be saved by itself', () => {
    const offer = paperSummaryOffer(QUESTION, ANSWER);

    expect(offer?.kind).toBe('papers');
    expect(offer?.kind === 'papers' ? offer.papers : []).toEqual([
      {
        url: 'https://arxiv.org/abs/2207.01848',
        title: 'TabPFN: A Transformer That Solves Small Tabular Classification Problems',
      },
      {
        url: 'https://doi.org/10.1093/biostatistics/kxm045',
        title: 'Sparse inverse covariance estimation with the graphical lasso',
      },
    ]);
  });

  it('says that links are missing only when the assistant itself offered the library', () => {
    const named =
      'TabPFN-3, Mundra 2024, Ledoit–Wolf 순서로 읽으세요.\n\n이 문헌별 분석을 Briefing Lab 논문 요약 라이브러리에도 추가할까요?';

    expect(paperSummaryOffer(QUESTION, named)).toEqual({ kind: 'no-verifiable-link' });
    expect(paperSummaryOffer(QUESTION, 'TabPFN-3, Mundra 2024 순서로 읽으세요.')).toBeNull();
    expect(paperSummaryCandidate(QUESTION, named)).toBeNull();
  });
});

describe('paper summary card with several papers', () => {
  async function mount(onSave: (candidate: PaperSummaryCandidate) => Promise<unknown>) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let ui!: ReturnType<typeof create>;
    await act(() => {
      ui = create(
        <PaperSummarySaveOffer
          question={QUESTION}
          answer={ANSWER}
          asked
          onSave={onSave as never}
        />,
      );
    });
    return ui;
  }

  it('saves each paper in its own call and retries only the one that failed', async () => {
    const onSave = vi
      .fn<(candidate: PaperSummaryCandidate) => Promise<unknown>>()
      .mockResolvedValueOnce({ id: 'a', savedAt: '2026-09-22T00:00:00Z', alreadySaved: false })
      .mockRejectedValueOnce(
        new Error('논문 원문 정보를 확인하지 못했습니다. 저장하지 않았습니다.'),
      )
      .mockResolvedValueOnce({ id: 'b', savedAt: '2026-09-22T00:01:00Z', alreadySaved: true });
    const ui = await mount(onSave);
    try {
      await act(() => ui.root.findAllByType('button')[0]!.props.onClick());

      expect(onSave.mock.calls.map(([candidate]) => candidate.sourceUrls)).toEqual([
        ['https://arxiv.org/abs/2207.01848'],
        ['https://doi.org/10.1093/biostatistics/kxm045'],
      ]);
      expect(onSave.mock.calls[1]?.[0].title).toBe(
        'Sparse inverse covariance estimation with the graphical lasso',
      );
      const partial = JSON.stringify(ui.toJSON());
      expect(partial).toContain('2편 중 1편을 보관함에 저장했습니다');
      expect(partial).toContain('Sparse inverse covariance estimation with the graphical lasso');
      expect(partial).toContain('논문 원문 정보를 확인하지 못했습니다');
      expect(partial).toContain('실패한 1편 다시 시도');

      await act(() => ui.root.findAllByType('button')[0]!.props.onClick());

      expect(onSave).toHaveBeenCalledTimes(3);
      expect(onSave.mock.calls[2]?.[0].sourceUrls).toEqual([
        'https://doi.org/10.1093/biostatistics/kxm045',
      ]);
      expect(JSON.stringify(ui.toJSON())).toContain('논문 2편을 보관함에 저장했습니다');
    } finally {
      await act(() => ui.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('offers the follow-up and 나중에 instead of a save that must fail', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const onSave = vi.fn();
    let ui!: ReturnType<typeof create>;
    try {
      await act(() => {
        ui = create(
          <PaperSummarySaveOffer
            question={QUESTION}
            answer={
              'TabPFN-3, Mundra 2024 순서로 읽으세요.\n\n이 문헌별 분석을 Briefing Lab 논문 요약 라이브러리에도 추가할까요?'
            }
            asked
            onSave={onSave}
          />,
        );
      });
      const html = JSON.stringify(ui.toJSON());

      expect(html).toContain('확인할 수 있는 논문 링크가 없습니다');
      expect(html).toContain('arXiv');
      // Nothing here is savable, so the card never offers 추가. Without a chat that can send the
      // follow-up, 나중에 is the only thing it can honestly offer.
      expect(ui.root.findAllByType('button').map((b) => b.children.join(''))).toEqual(['나중에']);
      expect(html).not.toContain('추가할까요');
      expect(onSave).not.toHaveBeenCalled();
      await act(() => ui.root.findByType('button').props.onClick());
      expect(ui.root.findAllByType('button')).toHaveLength(0);
      expect(onSave).not.toHaveBeenCalled();
    } finally {
      await act(() => ui.unmount());
      vi.unstubAllGlobals();
    }
  });
});
