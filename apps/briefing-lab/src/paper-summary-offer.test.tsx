import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { PaperSummarySaveOffer, type PaperSaveReplyHandler } from './paper-summary-offer';
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
