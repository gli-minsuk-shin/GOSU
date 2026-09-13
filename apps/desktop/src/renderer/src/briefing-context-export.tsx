import { useState, useEffect } from 'react';
import type { ProjectChatSnapshot } from '../../shared/project-chat-contracts';
import { uiText } from '@gosu/ui/language';
export function projectBriefingContext(
  project: { id: string; name: string },
  snapshot: ProjectChatSnapshot | null,
  summary: string,
  now = new Date().toISOString(),
) {
  if (!snapshot || snapshot.projectId !== project.id || !summary.trim() || summary.length > 3500)
    throw new Error('briefing_context_invalid');
  return {
    type: 'gosu-project-briefing-context',
    version: 1,
    projectId: project.id,
    projectName: project.name,
    summary: summary.trim(),
    memoryRevision: snapshot.agentMemory?.revision ?? 0,
    exportedAt: now,
  };
}
export function BriefingContextExport({
  project,
  snapshot,
}: {
  project: { id: string; name: string };
  snapshot: ProjectChatSnapshot | null;
}) {
  const [open, setOpen] = useState(false),
    [summary, setSummary] = useState('');
  const [base, setBase] = useState<ProjectChatSnapshot | null>(null);
  useEffect(() => {
    setOpen(false);
    setBase(null);
  }, [project.id, snapshot?.session?.id]);
  const exportContext = () => {
    const context = projectBriefingContext(project, base, summary);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(context, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `gosu-briefing-context-${project.id}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setOpen(false);
  };
  return (
    <div className="briefing-context-export">
      <button
        type="button"
        className="ghost-button"
        disabled={!snapshot}
        onClick={() => {
          setBase(
            snapshot
              ? {
                  schemaVersion: 1,
                  projectId: snapshot.projectId,
                  messages: [],
                  ...(snapshot.agentMemory
                    ? { agentMemory: structuredClone(snapshot.agentMemory) }
                    : {}),
                }
              : null,
          );
          setSummary(
            (
              snapshot?.agentMemory?.entries
                .map((entry) => `${entry.userRequest}\n${entry.outcome}`)
                .join('\n\n') ?? ''
            ).slice(0, 3500),
          );
          setOpen(true);
        }}
      >
        {uiText('Export Briefing context')}
      </button>
      {open && (
        <div
          className="briefing-context-review"
          role="dialog"
          aria-label={uiText('Review Briefing project memory')}
        >
          <h3>{project.name} · Briefing context</h3>
          <p>
            {uiText(
              'Review this bounded project-memory snapshot before exporting. It is a plaintext JSON file; import it into Briefing encrypted memory explicitly. No automatic sync or email access.',
            )}
          </p>
          <textarea
            aria-label={uiText('Project summary for Briefing')}
            value={summary}
            maxLength={3500}
            onChange={(e) => setSummary(e.target.value)}
          />
          <small>
            {summary.length} / 3500 ·{' '}
            {uiText('Review and shorten if the initial memory was clipped.')}
          </small>
          <div>
            <button type="button" className="secondary-button" onClick={() => setOpen(false)}>
              {uiText('Cancel')}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!summary.trim()}
              onClick={exportContext}
            >
              {uiText('Download reviewed context')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
