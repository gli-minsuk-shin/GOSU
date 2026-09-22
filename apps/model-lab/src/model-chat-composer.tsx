import { uiText, useUiText } from '@gosu/ui/language';
import { parseChatSlashCommand } from '@gosu/ui/chat-slash-commands';
import { useState, type Ref, type ReactNode, type KeyboardEvent } from 'react';
import { modelChatCommandMenu } from './model-chat-commands';

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
  const command = parseChatSlashCommand(draft);
  const submit = () => {
    // A context command still reaches the workspace while an answer runs, so it can say why it
    // was refused instead of disappearing.
    if (busy && !command) return;
    if (!draft.trim() && !hasAttachments) return;
    onSubmit(draft);
    setDraft('');
    onDraftChange('');
  };
  const suggestions = modelChatCommandMenu(draft);
  return (
    <>
      {suggestions.length > 0 ? (
        <ul className="model-chat__command-menu" aria-label={uiText('Chat commands')}>
          {suggestions.map((suggestion) => (
            <li key={suggestion.command}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setDraft(suggestion.command);
                  onDraftChange(suggestion.command);
                }}
              >
                <strong>{suggestion.command}</strong>
                <span>{suggestion.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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
              // "/c" + Enter completes the command instead of sending "/c" to the model.
              const completion = command ? undefined : suggestions[0]?.command;
              if (completion) {
                setDraft(completion);
                onDraftChange(completion);
              } else submit();
            }
          }}
          placeholder={uiText('모델을 질문하거나 수도 코드·graph 수정을 요청하세요…')}
          aria-label={uiText('Message GOSU Model Assistant')}
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
    </>
  );
}
