import { uiText, useUiText } from '@gosu/ui/language';

import { useState } from 'react';

import {
  DEFAULT_WORKSPACE_BOARD_SETTINGS,
  WORKSPACE_TASK_STATUSES,
  WorkspaceBoardSettingsSchema,
  type WorkspaceBoardSettings,
  type WorkspaceTaskStatus,
} from '../../shared/workspace-contracts';

type BoardSettingsFormProps = {
  initial: WorkspaceBoardSettings;
  busy?: boolean;
  saveLabel: string;
  busyLabel?: string;
  focusStatus?: WorkspaceTaskStatus | null;
  onSave: (settings: WorkspaceBoardSettings) => unknown;
  onCancel?: (() => void) | undefined;
};

export function BoardSettingsForm({
  initial,
  busy = false,
  saveLabel,
  busyLabel = 'Saving…',
  focusStatus = null,
  onSave,
  onCancel,
}: BoardSettingsFormProps) {
  useUiText();
  const [title, setTitle] = useState(initial.title);
  const [columnLabels, setColumnLabels] = useState({ ...initial.columnLabels });
  const [columnOrder, setColumnOrder] = useState([...initial.columnOrder]);
  const [wipLimits, setWipLimits] = useState(() => wipLimitDraft(initial));
  const parsedSettings = WorkspaceBoardSettingsSchema.safeParse({
    title,
    columnLabels,
    columnOrder,
    wipLimits: Object.fromEntries(
      WORKSPACE_TASK_STATUSES.map((status) => [
        status,
        wipLimits[status] === '' ? null : Number(wipLimits[status]),
      ]),
    ),
  });
  const valid = parsedSettings.success;

  const loadSettings = (settings: WorkspaceBoardSettings) => {
    setTitle(settings.title);
    setColumnLabels({ ...settings.columnLabels });
    setColumnOrder([...settings.columnOrder]);
    setWipLimits(wipLimitDraft(settings));
  };

  return (
    <form
      className="board-settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!parsedSettings.success || busy) return;
        void onSave(parsedSettings.data);
      }}
    >
      <label className="board-title-field">
        {uiText('Board title')}
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          minLength={1}
          maxLength={120}
          disabled={busy}
        />
      </label>
      <div className="board-column-settings">
        {columnOrder.map((status, index) => (
          <div className="column-setting-row" key={status}>
            <span>{index + 1}</span>
            <label>
              <span className="column-setting-label">
                {uiText('Column name')}{' '}
                <small>
                  {uiText('Canonical:')} {status}
                </small>
              </span>
              <input
                value={columnLabels[status]}
                onChange={(event) =>
                  setColumnLabels((current) => ({ ...current, [status]: event.target.value }))
                }
                minLength={1}
                maxLength={40}
                autoFocus={focusStatus === status}
                disabled={busy}
              />
            </label>
            <label>
              {uiText('WIP limit')}
              <input
                type="number"
                value={wipLimits[status]}
                onChange={(event) =>
                  setWipLimits((current) => ({ ...current, [status]: event.target.value }))
                }
                min={1}
                max={999}
                placeholder={uiText('None')}
                disabled={busy}
              />
            </label>
            <div
              className="column-order-actions"
              aria-label={uiText('Move {value1}', { value1: columnLabels[status] })}
            >
              <button
                type="button"
                onClick={() => setColumnOrder((current) => moveItem(current, index, index - 1))}
                disabled={busy || index === 0}
                title={uiText('Move column left')}
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => setColumnOrder((current) => moveItem(current, index, index + 1))}
                disabled={busy || index === columnOrder.length - 1}
                title={uiText('Move column right')}
              >
                →
              </button>
            </div>
          </div>
        ))}
      </div>
      {!valid && (
        <p className="settings-validation">
          {uiText('Use unique names and WIP limits from 1–999.')}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={busy || !valid}>
          {busy ? busyLabel : saveLabel}
        </button>
        {onCancel && (
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
            {uiText('Cancel')}
          </button>
        )}
        <button
          type="button"
          className="ghost-button"
          onClick={() => loadSettings(structuredClone(DEFAULT_WORKSPACE_BOARD_SETTINGS))}
          disabled={busy}
        >
          {uiText('Load GOSU defaults')}
        </button>
      </div>
    </form>
  );
}

function wipLimitDraft(settings: WorkspaceBoardSettings) {
  return Object.fromEntries(
    WORKSPACE_TASK_STATUSES.map((status) => [status, settings.wipLimits[status]?.toString() ?? '']),
  ) as Record<WorkspaceTaskStatus, string>;
}

function moveItem<T>(items: readonly T[], from: number, to: number) {
  if (to < 0 || to >= items.length || from === to) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}
