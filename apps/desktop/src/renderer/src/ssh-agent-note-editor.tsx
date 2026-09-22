import { uiText, useUiText } from '@gosu/ui/language';
import { useEffect, useId, useState } from 'react';

import {
  SSH_AGENT_NOTE_MAX_LENGTH,
  type SetSshAgentNoteInput,
  type SshAgentNotes,
} from '../../shared/ssh-agent-notes-contracts';

export type SshAgentNotesApi = Readonly<{
  get: () => Promise<SshAgentNotes>;
  set: (input: SetSshAgentNoteInput) => Promise<SshAgentNotes>;
}>;

// A preview or an older preload has no bridge; that is a failure to report, not a crash.
const bridge = () =>
  (typeof window === 'undefined' ? undefined : window.gosu?.sshAgentNotes) ?? null;
const hostApi: SshAgentNotesApi = {
  get: () => bridge()?.get() ?? Promise.reject(new Error('ssh_agent_notes_unavailable')),
  set: (input) => bridge()?.set(input) ?? Promise.reject(new Error('ssh_agent_notes_unavailable')),
};

function noteErrorMessage(error: unknown, loading: boolean) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'ssh_agent_notes_unreadable') {
    return uiText(
      'The notes file is damaged, so nothing was changed. Move ssh-agent-notes.v1.json out of the GOSU data folder to start over.',
    );
  }
  if (code === 'ssh_connection_not_found') return uiText('This server is no longer registered.');
  return loading
    ? uiText('The instructions for this server could not be loaded, so they cannot be edited now.')
    : uiText('The instructions could not be saved. Nothing was changed.');
}

/**
 * What the user wants the project AI to keep in mind on one server, for example the name to run
 * jobs under on a shared machine. The text reaches the model with the workspace list; it cannot
 * grant access or skip an approval.
 */
export function SshAgentNoteEditor({
  connectionId,
  serverLabel,
  api = hostApi,
  disabled = false,
}: {
  connectionId: string;
  serverLabel: string;
  api?: SshAgentNotesApi;
  disabled?: boolean;
}) {
  useUiText();
  const helpId = useId();
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get().then(
      (notes) => {
        if (!active) return;
        const text = notes.notes[connectionId]?.text ?? '';
        setSaved(text);
        setDraft(text);
      },
      (reason: unknown) => active && setError(noteErrorMessage(reason, true)),
    );
    return () => {
      active = false;
    };
  }, [api, connectionId]);

  const loaded = saved !== null;
  const changed = loaded && draft.trim() !== saved;
  return (
    // Always open. A closed panel hid the field so well that the instructions looked missing.
    <section className="ssh-agent-note">
      <p className="ssh-agent-note-title">
        {saved ? uiText('Instructions for AI · set') : uiText('Instructions for AI')}
      </p>
      <textarea
        aria-label={uiText('Instructions for AI on {server}', { server: serverLabel })}
        aria-describedby={helpId}
        value={draft}
        rows={3}
        maxLength={SSH_AGENT_NOTE_MAX_LENGTH}
        placeholder={uiText(
          'e.g. Run experiments under the name minsuk so others can tell the jobs are mine.',
        )}
        disabled={disabled || busy || !loaded}
        onChange={(event) => {
          setDraft(event.target.value);
          setStatus('');
          setError('');
        }}
      />
      <p className="privacy" id={helpId}>
        {uiText(
          'Given to the project AI whenever it works on this server. It cannot grant access or skip an approval.',
        )}
      </p>
      <div className="form-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || busy || !changed}
          onClick={() => {
            setBusy(true);
            setStatus('');
            setError('');
            api.set({ connectionId, text: draft }).then(
              (notes) => {
                const text = notes.notes[connectionId]?.text ?? '';
                setSaved(text);
                setDraft(text);
                setStatus(text ? uiText('Saved') : uiText('Instructions removed'));
                setBusy(false);
              },
              (reason: unknown) => {
                setError(noteErrorMessage(reason, false));
                setBusy(false);
              },
            );
          }}
        >
          {busy ? uiText('Saving…') : uiText('Save instructions')}
        </button>
        <small>
          {draft.length} / {SSH_AGENT_NOTE_MAX_LENGTH}
        </small>
        {status && <small role="status">{status}</small>}
      </div>
      {error && (
        <p className="settings-validation" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
