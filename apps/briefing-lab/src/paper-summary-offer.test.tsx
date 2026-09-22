import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { PaperSummarySaveOffer, type PaperSaveReplyHandler } from './paper-summary-offer';
import type { PaperSummaryCandidate } from './paper-summary-contract';
it('asks first, saves only on click/explicit reply, reports errors and prevents double submit', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let reply: PaperSaveReplyHandler | null = null;
  const onReplyReady = (handler: PaperSaveReplyHandler | null) => {
    reply = handler;
  };
  const onSave = vi.fn(async () => ({
    id: 'x',
    savedAt: '2026-09-10T00:00:00Z',
    alreadySaved: false,
  }));
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(
        <PaperSummarySaveOffer
          question="https://arxiv.org/abs/2609.00001v1 이 논문 요약해줘"
          answer={'검증용 논문 분석입니다. '.repeat(5)}
          onSave={onSave}
          onReplyReady={onReplyReady}
        />,
      );
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(JSON.stringify(ui.toJSON())).toContain('추가할까요');
    await act(() => {
      expect(reply?.('메일을 찾아줘')).toBe(false);
    });
    expect(onSave).not.toHaveBeenCalled();
    await act(() => {
      expect(reply?.('넣어줘')).toBe(true);
      reply?.('넣어줘');
    });
    expect(onSave).toHaveBeenCalledOnce();
    expect(JSON.stringify(ui.toJSON())).toContain('저장했습니다');
  } finally {
    await act(() => ui.unmount());
    vi.unstubAllGlobals();
  }
});
it('decline performs no write and a rejected save never displays success', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const onSave = vi.fn(async () => {
    throw new Error('unavailable');
  });
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(
        <PaperSummarySaveOffer
          question="https://arxiv.org/abs/2609.00001v1 논문 질문"
          answer="분석 결과입니다."
          onSave={onSave}
        />,
      );
    });
    await act(() => ui.root.findAllByType('button')[0]!.props.onClick());
    expect(JSON.stringify(ui.toJSON())).toContain('결과를 확인하지 못했습니다');
    expect(JSON.stringify(ui.toJSON())).not.toContain('저장했습니다');
    await act(() => ui.root.findAllByType('button')[1]!.props.onClick());
    expect(ui.toJSON()).toBeNull();
    expect(onSave).toHaveBeenCalledOnce();
  } finally {
    await act(() => ui.unmount());
    vi.unstubAllGlobals();
  }
});

it('answers a library question the assistant asked itself with two buttons: 추가 and 나중에', async () => {
  // 2026-09-21: the answer ended with "이 설명도 Briefing Lab 논문 요약 라이브러리에 추가할까요?" and
  // nothing to press; the card was hidden because the paper was already in the library.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const asked =
    'ProvDA는 그래프 데이터를 합성·증강해 APT 탐지에 활용하려는 연구입니다. 구체적인 방법이나 성능은 확인되지 않았습니다.\n\n이 설명도 Briefing Lab 논문 요약 라이브러리에 추가할까요?';
  const onSave = vi.fn(async (_candidate: PaperSummaryCandidate) => ({
    id: 'x',
    savedAt: '2026-09-21T00:00:00Z',
    alreadySaved: false,
  }));
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(
        <PaperSummarySaveOffer
          asked
          question="provenance graph가 뭐야?"
          answer={asked}
          references={[
            {
              title: 'ProvDA: VGAE-Based Synthetic Provenance Data Augmentation for APT Detection',
              url: 'https://arxiv.org/abs/2609.12345',
            },
          ]}
          onSave={onSave}
        />,
      );
    });
    const labels = () => ui.root.findAllByType('button').map((b) => b.props.children);
    expect(labels()).toEqual(['추가', '나중에']);
    // The question is already in the answer above: no second copy, no card text.
    const text = JSON.stringify(ui.toJSON());
    expect(text).not.toContain('추가할까요');
    expect(text).toContain('is-answer');
    expect(ui.root.findAllByType('p')).toHaveLength(0);
    // What pressing 추가 will do stays one hover away.
    expect(ui.root.findAllByType('button')[0]!.props.title).toContain('AI 사용량이 발생할 수');
    await act(() => ui.root.findAllByType('button')[0]!.props.onClick());
    expect(onSave).toHaveBeenCalledOnce();
    const candidate = onSave.mock.calls[0]![0];
    // The saved analysis does not contain the question itself.
    expect(candidate.markdown).toContain('ProvDA는 그래프 데이터를');
    expect(candidate.markdown).not.toContain('추가할까요');
    expect(candidate.sourceUrls).toEqual(['https://arxiv.org/abs/2609.12345']);
    expect(JSON.stringify(ui.toJSON())).toContain('논문 분석 저장됨');
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});

it('removes the two buttons on 나중에 without saving anything', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const onSave = vi.fn();
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(
        <PaperSummarySaveOffer
          asked
          question="이 논문 설명해줘"
          answer={
            '설명입니다. '.repeat(5) + '\n\n이 설명도 Briefing Lab 논문 요약 보관함에 저장할까요?'
          }
          references={[{ title: 'Paper', url: 'https://arxiv.org/abs/2609.00002' }]}
          onSave={onSave}
        />,
      );
    });
    await act(() => ui.root.findAllByType('button')[1]!.props.onClick());
    expect(ui.toJSON()).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});

it('offers one click and 나중에 when the answer holds no link the library can verify', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const onSave = vi.fn();
  const onAsk = vi.fn();
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(
        <PaperSummarySaveOffer
          asked
          question="이 논문들 정리해줘"
          answer={'정리했습니다. '.repeat(5) + '\n\n이 분석도 논문 요약 보관함에 추가할까요?'}
          // A report page: the library opens arXiv, DOI, OpenReview and PMLR only.
          references={[{ title: 'Lab report', url: 'https://example.org/report' }]}
          onSave={onSave}
          onAsk={onAsk}
        />,
      );
    });
    const labels = () => ui.root.findAllByType('button').map((b) => b.children.join(''));
    expect(ui.toJSON()).not.toBeNull();
    expect(labels()).toEqual(['링크 붙여 다시 정리', '나중에']);

    // The one click asks for the links, as the user, instead of leaving them to type the sentence.
    await act(() => ui.root.findAllByType('button')[0]!.props.onClick());
    expect(onAsk).toHaveBeenCalledExactlyOnceWith(
      '논문마다 DOI나 arXiv 링크를 붙여서 다시 정리해줘',
    );
    // Nothing was saved: there is nothing here the library can verify.
    expect(onSave).not.toHaveBeenCalled();

    // 나중에 puts the buttons away and keeps the explanation, so the notice is not lost.
    await act(() => ui.root.findAllByType('button')[1]!.props.onClick());
    expect(ui.root.findAllByType('button')).toHaveLength(0);
    expect(JSON.stringify(ui.toJSON())).toContain('확인할 수 있는 논문 링크가 없습니다');
    expect(onSave).not.toHaveBeenCalled();
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});
