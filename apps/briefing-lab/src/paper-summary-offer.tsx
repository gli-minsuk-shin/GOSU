import { useEffect, useRef, useState } from 'react';
import { beginAiActivity } from '@gosu/ui/ai-activity';
import {
  PAPER_SAVE_QUESTION,
  paperSummaryOffer,
  paperSaveReply,
  type PaperSummaryCandidate,
  type PaperSummarySaveReceipt,
} from './paper-summary-contract';
import './paper-summary-offer.css';
export type PaperSaveReplyHandler = (text: string) => boolean;
/** The follow-up that turns an unsavable answer into a savable one, in the user's own voice. */
export const LINK_REQUEST = '논문마다 DOI나 arXiv 링크를 붙여서 다시 정리해줘';
export function PaperSummarySaveOffer({
  question,
  answer,
  references,
  onSave,
  onReplyReady,
  onAsk,
  allowBareYes = true,
  activityWorkload = 'papers',
  asked = false,
}: {
  question: string;
  answer: string;
  references?: readonly { title: string; url: string }[] | undefined;
  onSave: (candidate: PaperSummaryCandidate) => Promise<PaperSummarySaveReceipt>;
  onReplyReady?: ((handler: PaperSaveReplyHandler | null) => void) | undefined;
  /**
   * Sends a follow-up question as the user. Only used in the state where the answer holds no link
   * the library can verify, so the one thing that can be done there is one click instead of typing.
   */
  onAsk?: ((prompt: string) => void) | undefined;
  allowBareYes?: boolean;
  activityWorkload?: 'papers' | 'model-lab';
  /**
   * The answer above already asks the library question in its own words. Then only the two answers
   * are shown, right under it, instead of a card that repeats the question.
   */
  asked?: boolean;
}) {
  const offer = paperSummaryOffer(question, answer, references);
  const candidate = offer?.kind === 'papers' ? offer.candidate : null;
  const papers = offer?.kind === 'papers' ? offer.papers : [];
  const [state, setState] = useState<'pending' | 'saving' | 'saved' | 'declined' | 'error'>(
    'pending',
  );
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState('');
  // Papers already in the library after an earlier click; a retry only repeats the failed ones.
  const done = useRef(new Set<string>());
  const [failedCount, setFailedCount] = useState(0);
  const lock = useRef(false);
  const latest = useRef<() => Promise<void>>(async () => undefined);
  latest.current = async () => {
    if (!candidate || lock.current || state === 'saved') return;
    lock.current = true;
    setState('saving');
    setNotice('');
    const reportActivity = beginAiActivity(activityWorkload);
    const pending = papers.filter((paper) => !done.current.has(paper.url));
    const failures: { title: string; reason: string }[] = [];
    try {
      // One call per paper: each gets the library's full time budget and is committed by itself,
      // so a slow or unreadable paper no longer costs the ones that worked.
      for (const [index, paper] of pending.entries()) {
        if (papers.length > 1)
          setProgress(`${done.current.size + index + 1 - failures.length}/${papers.length}`);
        try {
          const receipt = await onSave({
            title: paper.title,
            question: candidate.question,
            markdown: candidate.markdown,
            sourceUrls: [paper.url],
          });
          if (!receipt?.id || !receipt.savedAt) throw new Error('save_unconfirmed');
          done.current.add(paper.url);
        } catch (error) {
          failures.push({
            title: paper.title,
            reason: error instanceof Error ? error.message : '저장 결과를 확인하지 못했습니다.',
          });
        }
      }
      if (done.current.size > 0 && typeof window !== 'undefined')
        window.dispatchEvent?.(new Event('gosu-paper-library-updated'));
      setFailedCount(failures.length);
      if (failures.length === 0) {
        setState('saved');
        reportActivity('completed');
        setNotice(
          papers.length > 1
            ? `논문 ${papers.length}편을 보관함에 저장했습니다. 이미 있던 논문은 다시 요약하지 않았습니다.`
            : '확인된 논문을 요약해 보관함에 저장했습니다. 이미 있던 논문은 다시 요약하지 않습니다.',
        );
      } else {
        setState('error');
        const details = failures
          .map((failure) => `「${failure.title}」 ${failure.reason}`)
          .join(' · ');
        setNotice(
          papers.length > 1
            ? `${papers.length}편 중 ${done.current.size}편을 보관함에 저장했습니다. 저장하지 못한 논문: ${details}`
            : `저장 결과를 확인하지 못했습니다. ${failures[0]!.reason}`,
        );
      }
    } finally {
      reportActivity('failed');
      setProgress('');
      lock.current = false;
    }
  };
  useEffect(() => {
    if (!candidate || state === 'declined') {
      onReplyReady?.(null);
      return;
    }
    onReplyReady?.((text) => {
      const choice = paperSaveReply(text, allowBareYes);
      if (!choice) return false;
      if (choice === 'decline') {
        if (!lock.current) setState('declined');
      } else void latest.current();
      return true;
    });
    return () => onReplyReady?.(null);
  }, [Boolean(candidate), question, answer, state, allowBareYes, onReplyReady]);
  if (offer?.kind === 'no-verifiable-link')
    return (
      <section className="gosu-paper-save-offer is-answer" aria-label="논문 요약 저장 안내">
        <small role="status">
          이 답변에는 보관함이 확인할 수 있는 논문 링크가 없습니다. arXiv, DOI, OpenReview, PMLR
          링크가 있는 논문만 저장할 수 있습니다.
        </small>
        {state !== 'declined' && (
          <div>
            {/* Not "추가": there is nothing here the library can add yet. One click asks for the
                links that would make it addable, instead of leaving the user to type the sentence.
                Only where the chat can send it: a dead button explains nothing. */}
            {onAsk && (
              <button type="button" title={LINK_REQUEST} onClick={() => onAsk(LINK_REQUEST)}>
                링크 붙여 다시 정리
              </button>
            )}
            <button type="button" onClick={() => setState('declined')}>
              나중에
            </button>
          </div>
        )}
      </section>
    );
  if (!candidate || state === 'declined') return null;
  const explanation =
    '연결된 논문을 확인하고 설정된 논문 요약 모델로 분석해 논문별로 저장합니다. 원문 조회·AI 사용량이 발생할 수 있습니다. 이미 저장된 논문은 재사용합니다.';
  return (
    <section
      className={`gosu-paper-save-offer${asked ? ' is-answer' : ''}`}
      aria-label="논문 요약 저장 확인"
    >
      {(!asked || state === 'saved') && (
        <strong>{state === 'saved' ? '논문 분석 저장됨' : PAPER_SAVE_QUESTION}</strong>
      )}
      {state !== 'saved' && (
        <>
          {!asked && <p>{explanation}</p>}
          <div>
            <button
              type="button"
              disabled={state === 'saving'}
              title={asked ? explanation : undefined}
              onClick={() => void latest.current()}
            >
              {state === 'saving'
                ? `논문 확인·요약 중…${progress ? ` ${progress}` : ''}`
                : failedCount > 0
                  ? `실패한 ${failedCount}편 다시 시도`
                  : papers.length > 1
                    ? `${papers.length}편 추가`
                    : '추가'}
            </button>
            <button
              type="button"
              disabled={state === 'saving'}
              onClick={() => setState('declined')}
            >
              나중에
            </button>
          </div>
        </>
      )}
      {notice && <small role={state === 'error' ? 'alert' : 'status'}>{notice}</small>}
    </section>
  );
}
