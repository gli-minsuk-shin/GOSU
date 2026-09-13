import { useEffect, useRef, useState } from 'react';
import {
  PAPER_SAVE_QUESTION,
  paperSummaryCandidate,
  paperSaveReply,
  type PaperSummaryCandidate,
  type PaperSummarySaveReceipt,
} from './paper-summary-contract';
import './paper-summary-offer.css';
export type PaperSaveReplyHandler = (text: string) => boolean;
export function PaperSummarySaveOffer({
  question,
  answer,
  references,
  onSave,
  onReplyReady,
  allowBareYes = true,
}: {
  question: string;
  answer: string;
  references?: readonly { title: string; url: string }[] | undefined;
  onSave: (candidate: PaperSummaryCandidate) => Promise<PaperSummarySaveReceipt>;
  onReplyReady?: ((handler: PaperSaveReplyHandler | null) => void) | undefined;
  allowBareYes?: boolean;
}) {
  const candidate = paperSummaryCandidate(question, answer, references);
  const [state, setState] = useState<'pending' | 'saving' | 'saved' | 'declined' | 'error'>(
    'pending',
  );
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const latest = useRef<() => Promise<void>>(async () => undefined);
  latest.current = async () => {
    if (!candidate || lock.current || state === 'saved') return;
    lock.current = true;
    setState('saving');
    setNotice('');
    try {
      const receipt = await onSave(candidate);
      if (!receipt?.id || !receipt.savedAt) throw new Error('save_unconfirmed');
      setState('saved');
      if (typeof window !== 'undefined')
        window.dispatchEvent?.(new Event('gosu-paper-library-updated'));
      setNotice(
        receipt.alreadySaved
          ? '이 분석은 이미 보관함에 저장되어 있습니다.'
          : '확인된 논문을 요약해 보관함에 저장했습니다.',
      );
    } catch (error) {
      setState('error');
      setNotice(
        error instanceof Error
          ? `저장 결과를 확인하지 못했습니다. ${error.message}`
          : '저장 결과를 확인하지 못했습니다.',
      );
    } finally {
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
  if (!candidate || state === 'declined') return null;
  return (
    <section className="gosu-paper-save-offer" aria-label="논문 요약 저장 확인">
      <strong>{state === 'saved' ? '논문 분석 저장됨' : PAPER_SAVE_QUESTION}</strong>
      {state !== 'saved' && (
        <>
          <p>
            연결된 논문을 확인하고 설정된 논문 요약 모델로 분석해 논문별로 저장합니다. 원문 조회·AI
            사용량이 발생할 수 있습니다. 이미 저장된 논문은 재사용합니다.
          </p>
          <div>
            <button
              type="button"
              disabled={state === 'saving'}
              onClick={() => void latest.current()}
            >
              {state === 'saving' ? '논문 확인·요약 중…' : '보관함에 추가'}
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
