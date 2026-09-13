import { uiText, useUiText } from '@gosu/ui/language';
import { useState, type Ref, type ReactNode, type KeyboardEvent } from 'react';

export function shouldSubmitModelChat(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'nativeEvent'>,
) {
  return (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    event.nativeEvent.keyCode !== 229
  );
}

/** Keystrokes belong to this leaf, never to the graph/workspace state. */
export function ModelChatComposer({
  initialDraft,
  busy,
  hasAttachments,
  onDraftChange,
  onSubmit,
  onStop,
  inputRef,
  files,
}: {
  initialDraft: string;
  busy: boolean;
  hasAttachments: boolean;
  onDraftChange: (draft: string) => void;
  onSubmit: (draft: string) => void;
  onStop: () => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  files?: ReactNode;
}) {
  useUiText();
  const [draft, setDraft] = useState(initialDraft);
  const submit = () => {
    if (busy || (!draft.trim() && !hasAttachments)) return;
    onSubmit(draft);
    setDraft('');
    onDraftChange('');
  };
  return (
    <div className="model-chat__composer-row">
      {files}
      <textarea
        ref={inputRef}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onDraftChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (shouldSubmitModelChat(event)) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={uiText('모델을 질문하거나 수도 코드·graph 수정을 요청하세요…')}
        aria-label={uiText('Message GOSU Model Copilot')}
      />
      <button
        type="button"
        className={
          busy
            ? 'model-chat__send-button model-chat__stop-button'
            : 'model-chat__send-button primary-button'
        }
        disabled={!busy && !draft.trim() && !hasAttachments}
        onClick={busy ? onStop : submit}
      >
        {busy ? uiText('Stop') : uiText('Send')}
        <span>{busy ? uiText('Agent run') : uiText('Enter')}</span>
      </button>
    </div>
  );
}
