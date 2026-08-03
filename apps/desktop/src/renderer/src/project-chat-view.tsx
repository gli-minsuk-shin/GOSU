import { useEffect, useMemo, useRef, useState } from 'react';

import type { ProjectChatAction, ProjectChatSnapshot } from '../../shared/project-chat-contracts';
import type { ProjectRecord, WorkspaceTask } from '../../shared/workspace-contracts';
import { shouldSendChatMessage } from './chat-keyboard';
import type { CodexModel } from './connections-view';

const QUICK_PROMPTS = [
  '현재 프로젝트 상황을 요약해줘',
  '다음으로 할 연구 작업 3개를 제안해줘',
  '목표 metric 기준으로 가장 중요한 리스크를 찾아줘',
] as const;

export function ProjectChatView({
  project,
  tasks,
  snapshot,
  loading,
  inFlight,
  models,
  selectedModel,
  selectedReasoning,
  applyingActionId,
  onSelectedModel,
  onSelectedReasoning,
  onRefreshModels,
  onSend,
  onCancel,
  onApplyAction,
}: {
  project: ProjectRecord;
  tasks: readonly WorkspaceTask[];
  snapshot: ProjectChatSnapshot | null;
  loading: boolean;
  inFlight: boolean;
  models: readonly CodexModel[];
  selectedModel: string;
  selectedReasoning: string;
  applyingActionId: string | null;
  onSelectedModel: (modelId: string) => void;
  onSelectedReasoning: (reasoningId: string) => void;
  onRefreshModels: () => void;
  onSend: (message: string, retryOfAttemptId?: string) => Promise<boolean>;
  onCancel: () => void;
  onApplyAction: (action: ProjectChatAction) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [retryOfAttemptId, setRetryOfAttemptId] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const selectedDescriptor = useMemo(
    () => models.find((model) => model.modelId === selectedModel),
    [models, selectedModel],
  );
  const reasoningOptions = selectedDescriptor?.reasoningOptions ?? [];
  const selectedModelMissing = selectedModel !== 'auto' && selectedDescriptor === undefined;
  const selectedReasoningMissing =
    selectedReasoning !== 'auto' &&
    !reasoningOptions.some((option) => option.id === selectedReasoning);
  const selectionWarning = selectedModelMissing
    ? 'The selected model is no longer in the live Codex catalog. Choose a model before sending.'
    : selectedReasoningMissing
      ? 'The selected reasoning option is no longer available. Choose another option before sending.'
      : null;

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [inFlight, snapshot?.messages.length]);

  useEffect(() => {
    setDraft('');
    setRetryOfAttemptId(null);
  }, [project.id]);

  const submit = () => {
    const message = draft.trim();
    if (!message || inFlight || selectionWarning) return;
    void onSend(message, retryOfAttemptId ?? undefined).then((accepted) => {
      if (accepted) {
        setDraft('');
        setRetryOfAttemptId(null);
      }
    });
  };

  return (
    <section className="project-chat-shell" aria-label={`${project.name} project chat`}>
      <header className="chat-toolbar">
        <div className="chat-identity">
          <span className="chat-orbit" aria-hidden="true">
            G
          </span>
          <div>
            <strong>GOSU Project Copilot</strong>
            <span>Board와 최신 Objective를 기준으로 대화합니다</span>
          </div>
        </div>
        <div className="chat-model-controls">
          <label>
            Model
            <select
              value={selectedModel}
              onChange={(event) => onSelectedModel(event.target.value)}
              disabled={inFlight}
            >
              <option value="auto">Auto · provider recommended</option>
              {selectedModelMissing && (
                <option value={selectedModel} disabled>
                  Unavailable model · choose again
                </option>
              )}
              {models.map((model) => (
                <option value={model.modelId} key={model.modelId}>
                  {model.displayName}
                  {model.isDefault ? ' · default' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reasoning
            <select
              value={selectedReasoning}
              onChange={(event) => onSelectedReasoning(event.target.value)}
              disabled={inFlight || (reasoningOptions.length === 0 && !selectedReasoningMissing)}
            >
              <option value="auto">Model default</option>
              {selectedReasoningMissing && (
                <option value={selectedReasoning} disabled>
                  Unavailable reasoning · choose again
                </option>
              )}
              {reasoningOptions.map((option) => (
                <option value={option.id} key={option.id}>
                  {option.label}
                  {option.isDefault ? ' · default' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ghost-button chat-refresh"
            onClick={onRefreshModels}
            disabled={inFlight}
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="chat-transcript" ref={transcriptRef} aria-live="polite">
        {loading ? (
          <div className="chat-loading">암호화된 프로젝트 대화를 불러오는 중…</div>
        ) : !snapshot?.messages.length ? (
          <div className="chat-welcome">
            <span className="welcome-kicker">PROJECT CONVERSATION</span>
            <h2>{project.name}를 대화로 진행해보세요</h2>
            <p>
              연구 방향을 논의하거나 작업 생성을 요청할 수 있습니다. Kanban 변경은 AI가 제안하고,
              사용자가 Apply한 뒤에만 반영됩니다.
            </p>
            <div className="quick-prompts">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  type="button"
                  key={prompt}
                  onClick={() => {
                    setDraft(prompt);
                    setRetryOfAttemptId(null);
                  }}
                >
                  {prompt}
                  <span>↗</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          snapshot.messages.map((message, messageIndex) => {
            const retrySource =
              message.role === 'assistant' &&
              (message.status === 'failed' || message.status === 'interrupted')
                ? findRetrySource(snapshot, message, messageIndex)
                : null;
            return (
              <article
                className={`chat-message ${message.role} ${message.status}`}
                key={message.id}
              >
                <header>
                  <strong>{message.role === 'user' ? 'You' : 'GOSU'}</strong>
                  <span>{formatTime(message.completedAt)}</span>
                </header>
                <div className="message-copy">{message.content}</div>
                {message.model && (
                  <footer className="message-provenance">
                    {message.model.resolvedModelId}
                    {message.model.reasoningOptionId
                      ? ` · reasoning ${message.model.reasoningOptionId}`
                      : ''}
                  </footer>
                )}
                {retrySource && (
                  <footer className="failed-turn-recovery">
                    <span>Saved failed attempt · the connection may now be recovered</span>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(retrySource.content);
                        setRetryOfAttemptId(retrySource.attemptId);
                      }}
                    >
                      {retrySource.attemptId ? 'Retry this turn' : 'Use message again'}
                    </button>
                  </footer>
                )}
                {message.actions.length > 0 && (
                  <div className="chat-actions">
                    {message.actions.map((action) => (
                      <ChatActionCard
                        key={action.id}
                        action={action}
                        tasks={tasks}
                        busy={applyingActionId === action.id}
                        onApply={() => void onApplyAction(action)}
                      />
                    ))}
                  </div>
                )}
              </article>
            );
          })
        )}
        {inFlight && (
          <article className="chat-message assistant thinking" role="status">
            <header>
              <strong>GOSU</strong>
              <span>Codex turn active</span>
            </header>
            <div className="thinking-line">
              <i />
              <i />
              <i />
              <span>프로젝트 컨텍스트를 검토하고 있습니다</span>
            </div>
          </article>
        )}
      </div>

      <div className="chat-compose-area">
        <div className="chat-context-note">
          <span>LOCAL CONTEXT</span>
          현재 프로젝트 Board + Objective · Vault/파일 본문 제외
          {retryOfAttemptId && (
            <button
              type="button"
              className="retry-context"
              onClick={() => setRetryOfAttemptId(null)}
              title="Send as a new turn instead"
            >
              Retrying saved attempt ×
            </button>
          )}
        </div>
        {selectionWarning && (
          <div className="chat-selection-warning" role="status">
            {selectionWarning}
          </div>
        )}
        <div className="chat-composer">
          <textarea
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setRetryOfAttemptId(null);
            }}
            onKeyDown={(event) => {
              if (
                shouldSendChatMessage({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  isComposing: event.nativeEvent.isComposing,
                  keyCode: event.keyCode,
                })
              ) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="예: baseline 재현 작업을 Planned에 추가하고, 이번 주 우선순위를 정해줘"
            maxLength={12_000}
            disabled={inFlight}
            aria-label="Message GOSU project copilot"
          />
          {inFlight ? (
            <button type="button" className="danger-button chat-send" onClick={onCancel}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="primary-button chat-send"
              onClick={submit}
              disabled={draft.trim().length === 0 || selectionWarning !== null}
            >
              Send
              <span>Enter</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function ChatActionCard({
  action,
  tasks,
  busy,
  onApply,
}: {
  action: ProjectChatAction;
  tasks: readonly WorkspaceTask[];
  busy: boolean;
  onApply: () => void;
}) {
  const command = action.command;
  const task =
    command.type === 'task.update'
      ? tasks.find((candidate) => candidate.id === command.taskId)
      : undefined;
  const title =
    command.type === 'task.create'
      ? command.title
      : (command.title ?? task?.title ?? `Task ${command.taskId.slice(0, 8)}`);
  const detail =
    command.type === 'task.create'
      ? `Create in ${statusLabel(command.status)}`
      : `Update${command.status ? ` · move to ${statusLabel(command.status)}` : ''}`;
  return (
    <section className={`chat-action-card ${action.status}`}>
      <div>
        <span>{detail}</span>
        <strong>{title}</strong>
      </div>
      {action.status === 'proposed' ? (
        <button type="button" className="secondary-button" onClick={onApply} disabled={busy}>
          {busy ? 'Applying…' : 'Apply'}
        </button>
      ) : (
        <b>{actionStatusLabel(action)}</b>
      )}
    </section>
  );
}

function actionStatusLabel(action: ProjectChatAction) {
  if (action.status === 'applied') return 'Applied';
  if (action.status === 'applying') return 'Applying';
  if (action.errorCode === 'version_conflict') return 'Board changed · ask again';
  if (action.errorCode === 'application_interrupted') return 'Check Board before retry';
  return 'Could not apply';
}

function statusLabel(status: WorkspaceTask['status']) {
  return {
    backlog: 'Backlog',
    planned: 'Planned',
    in_progress: 'In Progress',
    review: 'Review',
    done: 'Done',
  }[status];
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function findRetrySource(
  snapshot: ProjectChatSnapshot,
  assistant: ProjectChatSnapshot['messages'][number],
  beforeIndex: number,
) {
  if (assistant.attemptId) {
    const matchingUser = snapshot.messages.find(
      (message) => message.role === 'user' && message.attemptId === assistant.attemptId,
    );
    if (matchingUser) return { content: matchingUser.content, attemptId: assistant.attemptId };
  }
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message?.role === 'user') return { content: message.content, attemptId: null };
  }
  return null;
}
