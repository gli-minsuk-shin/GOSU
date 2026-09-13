import { uiText } from '@gosu/ui/language';
import { CRITICAL_REVIEW_MODES, type CriticalReviewMode } from '../../shared/critical-review';
import type { ProjectChatSession } from '../../shared/project-chat-contracts';
import './critical-review.css';

export function CriticalReviewHeader({
  mode,
  sessions,
  selectedSessionId,
  busy,
  onMode,
  onSession,
  onCreate,
}: {
  mode: CriticalReviewMode;
  sessions: readonly ProjectChatSession[];
  selectedSessionId: string | null;
  busy: boolean;
  onMode: (mode: CriticalReviewMode) => void;
  onSession: (id: string) => void;
  onCreate: () => void;
}) {
  const history = sessions.filter((session) => session.criticalReviewMode === mode);
  return (
    <section className="critical-review-header" aria-label="Critical Review">
      <div className="critical-review-title">
        <strong>Critical Review</strong>
        <small>{uiText('Advice only · your research stays unchanged')}</small>
      </div>
      <div className="critical-review-modes" aria-label={uiText('Review mode')}>
        {CRITICAL_REVIEW_MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={mode === item.id}
            disabled={busy}
            onClick={() => onMode(item.id)}
          >
            <strong>{uiText(item.title)}</strong>
            <span>{uiText(item.description)}</span>
          </button>
        ))}
      </div>
      <div className="critical-review-history">
        <label>
          {uiText('Review history')}{' '}
          <select
            value={history.some((s) => s.id === selectedSessionId) ? selectedSessionId! : ''}
            disabled={busy}
            onChange={(event) => {
              if (event.target.value) onSession(event.target.value);
            }}
          >
            <option value="">{uiText('Choose a saved review')}</option>
            {history.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title} · {new Date(session.updatedAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={onCreate}>
          {uiText('New review')}
        </button>
      </div>
      <p>
        {mode === 'direction'
          ? uiText(
              'Share your research question or outline. The critic checks the contribution, assumptions and smallest decisive experiment.',
            )
          : uiText(
              'Attach the manuscript and appendix, or ask to review a captured Manuscript checkpoint. Missing or unread material is explicitly marked.',
            )}
      </p>
      <small>
        {uiText(
          'AI feedback can be wrong. Source-linked concerns and actionable repairs are not acceptance predictions.',
        )}
      </small>
    </section>
  );
}
