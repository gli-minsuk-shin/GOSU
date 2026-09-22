import { uiText, useUiText } from '@gosu/ui/language';

import { useEffect, useRef, useState } from 'react';
import { typographyMessage, type UiTextSize } from '@gosu/ui/typography';
import './project-model-lab-view.css';
import { trustedAiActivity, type AiActivityMessage } from '@gosu/ui/ai-activity';
import { isProjectModelLabLocation } from '../../shared/model-lab-contracts';
import { ModelLabChatHandoffSchema } from '../../../../model-lab/model-reference-contracts';

export function parseModelLabChatHandoff(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  frame: Window | null,
  url: string | null,
) {
  if (!frame || !url || event.source !== frame || event.origin !== new URL(url).origin) return null;
  const parsed = ModelLabChatHandoffSchema.safeParse(event.data);
  return parsed.success ? parsed.data.model : null;
}

export function projectModelLabSessionIds(
  visited: readonly string[],
  available: readonly string[],
  activeId: string | null,
) {
  return [...new Set([...visited, ...(activeId ? [activeId] : [])])].filter((id) =>
    available.includes(id),
  );
}

/** One live view per visited project; switching tabs does not discard an agent turn or draft. */
export function ProjectModelLabWorkspaces({
  onAiActivity,
  onAiReset,
  projects,
  activeProjectId,
  textSize = 'default',
  onReferenceModel,
}: {
  onAiActivity?: (scope: string, event: AiActivityMessage) => void;
  onAiReset?: (scope: string) => void;
  projects: readonly { id: string; name: string }[];
  activeProjectId: string | null;
  textSize?: UiTextSize;
  onReferenceModel?: (projectId: string, model: { modelId: string; revision: number }) => void;
}) {
  useUiText();
  const [visited, setVisited] = useState<readonly string[]>([]);
  const available = projects.map((project) => project.id);
  const visibleIds = projectModelLabSessionIds(visited, available, activeProjectId);
  const key = JSON.stringify(visibleIds);
  useEffect(() => {
    setVisited((current) =>
      JSON.stringify(current) === key ? current : (JSON.parse(key) as string[]),
    );
  }, [key]);
  return (
    <div className="project-model-lab-workspaces" hidden={!activeProjectId}>
      {visibleIds.map((id) => (
        <div className="project-model-lab-session" key={id} hidden={id !== activeProjectId}>
          <ProjectModelLabView
            {...(onAiActivity ? { onAiActivity } : {})}
            {...(onAiReset ? { onAiReset } : {})}
            {...(onReferenceModel ? { onReferenceModel } : {})}
            textSize={textSize}
            projectId={id}
            projectName={projects.find((project) => project.id === id)!.name}
          />
        </div>
      ))}
    </div>
  );
}

export function ProjectModelLabView({
  onAiActivity,
  onAiReset,
  projectId,
  projectName,
  textSize = 'default',
  onReferenceModel,
}: {
  onAiActivity?: (scope: string, event: AiActivityMessage) => void;
  onAiReset?: (scope: string) => void;
  projectId: string;
  projectName: string;
  textSize?: UiTextSize;
  onReferenceModel?: (projectId: string, model: { modelId: string; revision: number }) => void;
}) {
  useUiText();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const iframe = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!onAiActivity) return;
    const receive = (event: MessageEvent) => {
      const value = trustedAiActivity(event, iframe.current?.contentWindow ?? null, url);
      if (value?.workload === 'model-lab') onAiActivity?.(`project:${projectId}:model-lab`, value);
    };
    window.addEventListener('message', receive);
    return () => {
      window.removeEventListener('message', receive);
    };
  }, [url, projectId, onAiActivity]);
  useEffect(() => () => onAiReset?.(`project:${projectId}:model-lab`), [projectId, onAiReset]);
  useEffect(() => {
    if (!onReferenceModel || !url) return;
    const receive = (event: MessageEvent) => {
      const model = parseModelLabChatHandoff(event, iframe.current?.contentWindow ?? null, url);
      if (model) onReferenceModel?.(projectId, model);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [projectId, url, onReferenceModel]);
  const sendTextSize = () => {
    if (url)
      iframe.current?.contentWindow?.postMessage(typographyMessage(textSize), new URL(url).origin);
  };
  useEffect(() => {
    if (url)
      iframe.current?.contentWindow?.postMessage(typographyMessage(textSize), new URL(url).origin);
  }, [url, textSize]);
  useEffect(() => {
    let active = true;
    setUrl(null);
    setError(false);
    void window.gosu.modelLab
      .open({ projectId })
      .then((location) => {
        if (!isProjectModelLabLocation(location, projectId))
          throw new Error('Invalid Model Lab location');
        if (active) setUrl(location.url);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [projectId, retry]);
  return (
    <section
      className="project-model-lab"
      aria-label={uiText('{projectName} Model Lab', { projectName: projectName })}
    >
      {url ? (
        <iframe
          ref={iframe}
          onLoad={() => {
            onAiReset?.(`project:${projectId}:model-lab`);
            sendTextSize();
            if (onAiActivity)
              iframe.current?.contentWindow?.postMessage(
                { type: 'gosu-ai-activity-sync' },
                new URL(url).origin,
              );
          }}
          className="project-model-lab__frame"
          title={uiText('{projectName} · Model Lab', { projectName: projectName })}
          src={url}
          sandbox="allow-scripts allow-same-origin allow-downloads"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div role="status">
          {error ? (
            <>
              {uiText('Model Lab could not start.')}{' '}
              <button type="button" onClick={() => setRetry((value) => value + 1)}>
                {uiText('Retry')}
              </button>
            </>
          ) : (
            uiText('Opening project Model Lab…')
          )}
        </div>
      )}
    </section>
  );
}
