import { useEffect, useRef, useState } from 'react';
import { trustedAiActivity, type AiActivityMessage } from '@gosu/ui/ai-activity';
import { validBriefingLocation } from '../../shared/briefing-lab-contracts';
import { shortcutLabel } from '../../shared/assistant-shortcut';
import type { FullDiskAccessState } from '../../shared/full-disk-access';
import type { BriefingNotificationTarget } from '../../../../briefing-lab/src/briefing-notifications';
import {
  parseBriefingItemTarget,
  type BriefingItemTarget,
} from '../../../../briefing-lab/src/briefing-item-navigation';
export function GlobalBriefingView({
  onAiActivity,
  onAiReset,
  view,
  navigationRevision = 0,
  runRequest = 0,
  fullDiskAccess = null,
  onPermissionsHelper,
  onSettings,
  onAgentSettings,
  onOpenItem,
  onWorkspaceChanged,
  calendarTarget,
  briefingTarget,
}: {
  onAiActivity?: (scope: string, event: AiActivityMessage) => void;
  onAiReset?: (scope: string, prefix?: string) => void;
  view: 'calendar' | 'history' | 'settings' | 'papers' | 'manage' | 'assistant' | null;
  navigationRevision?: number;
  /** Counts the user's "run a new briefing" shortcut presses while the briefing feed is showing. */
  runRequest?: number;
  /** Whether the fast Apple Mail read can work; shown beside the other macOS permissions. */
  fullDiskAccess?: FullDiskAccessState | null;
  /** Reopens the first-run macOS permissions helper. */
  onPermissionsHelper?: () => void;
  onSettings?: () => void;
  /** Briefing has no model picker: its "AI model" links open Settings → Agent. */
  onAgentSettings?: () => void;
  onOpenItem?: (target: BriefingItemTarget) => void;
  onWorkspaceChanged?: () => void;
  calendarTarget?: { id: string; start: string; requestId: number; routineId?: string } | null;
  briefingTarget?: BriefingNotificationTarget | undefined;
}) {
  const [visited, setVisited] = useState(false),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const value = trustedAiActivity(event, frame.current?.contentWindow ?? null, url);
      if (value && ['assistant', 'briefing', 'papers'].includes(value.workload))
        onAiActivity?.(value.workload, { ...value, runId: `briefing-frame:${value.runId}` });
    };
    window.addEventListener?.('message', receive);
    return () => window.removeEventListener?.('message', receive);
  }, [url, onAiActivity]);
  useEffect(
    () => () => {
      for (const scope of ['assistant', 'briefing', 'papers'])
        onAiReset?.(scope, 'briefing-frame:');
    },
    [onAiReset],
  );
  const configuration = useRef<unknown>(null);
  useEffect(() => {
    if (view) setVisited(true);
  }, [view]);
  useEffect(() => {
    if (!visited) return;
    let active = true;
    setError('');
    void window.gosu.briefingLab
      .open()
      .then((result) => {
        if (!validBriefingLocation(result)) throw Error('invalid');
        if (active) {
          configuration.current = result.configuration;
          setUrl(result.url);
        }
      })
      .catch(() => {
        if (active)
          setError(
            'Briefing Lab을 열지 못했습니다. 별도로 실행 중인 Briefing Lab 서버가 있다면 종료한 뒤 다시 시도해주세요.',
          );
      });
    return () => {
      active = false;
    };
  }, [visited, retry]);
  // The chord is set in Settings → Shortcuts; the frame only shows it on its "브리핑 생성" button.
  const [runShortcut, setRunShortcut] = useState<string | null>(null);
  useEffect(() => {
    if (!view) return;
    let active = true;
    void window.gosu.app
      ?.getAppShortcuts?.()
      .then((shortcuts) => {
        if (active)
          setRunShortcut(shortcuts.briefingRun ? shortcutLabel(shortcuts.briefingRun) : null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [view, navigationRevision]);
  const navigate = () => {
    if (url && view)
      frame.current?.contentWindow?.postMessage(
        {
          type: 'gosu-briefing-navigation',
          view,
          runShortcut,
          configuration: configuration.current,
          ...(view === 'calendar' && calendarTarget ? { calendarTarget } : {}),
          ...(view === 'history' && briefingTarget ? { briefingTarget } : {}),
        },
        new URL(url).origin,
      );
  };
  useEffect(navigate, [url, view, navigationRevision, calendarTarget, briefingTarget, runShortcut]);
  // The main process catches the chord wherever the focus is (page or frame) and the app shell counts
  // it only while the briefing feed shows; here it becomes the frame's "run now".
  useEffect(() => {
    if (!runRequest || !url) return;
    frame.current?.contentWindow?.postMessage(
      { type: 'gosu-briefing-run-now' },
      new URL(url).origin,
    );
  }, [runRequest, url]);
  useEffect(() => {
    if (!view) return;
    const host = frame.current?.closest?.('.desktop-content') as HTMLElement | null | undefined;
    if (host) {
      host.scrollTop = 0;
      host.scrollLeft = 0;
    }
  }, [url, view, navigationRevision, briefingTarget]);
  useEffect(() => {
    const ready = (event: MessageEvent) => {
      if (
        url &&
        event.source === frame.current?.contentWindow &&
        event.origin === new URL(url).origin &&
        event.data?.type === 'gosu-briefing-todo-created'
      )
        onWorkspaceChanged?.();
      if (
        url &&
        view &&
        event.source === frame.current?.contentWindow &&
        event.origin === new URL(url).origin &&
        event.data?.type === 'gosu-briefing-file-drop'
      ) {
        const { requestId, routineId, files } = event.data;
        if (
          typeof requestId !== 'string' ||
          !/^[a-f0-9-]{36}$/.test(requestId) ||
          typeof routineId !== 'string' ||
          routineId.length > 128 ||
          !Array.isArray(files) ||
          files.length < 1 ||
          files.length > 5 ||
          !files.every((file) => file instanceof File)
        )
          return;
        const target = frame.current?.contentWindow,
          origin = event.origin;
        void Promise.resolve()
          .then(() => window.gosu.briefingLab.reserveDroppedAttachments(routineId, files))
          .then(
            ({ ticket }) =>
              target?.postMessage(
                { type: 'gosu-briefing-file-drop-result', requestId, ticket },
                origin,
              ),
            () =>
              target?.postMessage(
                { type: 'gosu-briefing-file-drop-result', requestId, error: true },
                origin,
              ),
          );
      }
      if (
        url &&
        event.source === frame.current?.contentWindow &&
        event.origin === new URL(url).origin &&
        event.data?.type === 'gosu-open-calendar-privacy'
      )
        void window.gosu.briefingLab.openPrivacy('calendar');
      if (
        url &&
        event.source === frame.current?.contentWindow &&
        event.origin === new URL(url).origin &&
        event.data?.type === 'gosu-briefing-open-item'
      ) {
        const target = parseBriefingItemTarget(event.data.target);
        if (target) onOpenItem?.(target);
      }
      if (
        url &&
        event.source === frame.current?.contentWindow &&
        event.origin === new URL(url).origin &&
        event.data?.type === 'gosu-open-briefing-settings'
      )
        onSettings?.();
      if (
        url &&
        event.source === frame.current?.contentWindow &&
        event.origin === new URL(url).origin &&
        event.data?.type === 'gosu-open-agent-settings'
      )
        onAgentSettings?.();
      if (
        url &&
        event.source === frame.current?.contentWindow &&
        event.origin === new URL(url).origin &&
        event.data?.type === 'gosu-briefing-ready'
      )
        navigate();
    };
    window.addEventListener?.('message', ready);
    return () => window.removeEventListener?.('message', ready);
  }, [
    url,
    view,
    navigationRevision,
    onSettings,
    onAgentSettings,
    onOpenItem,
    onWorkspaceChanged,
    calendarTarget,
    briefingTarget,
  ]);
  if (!visited) return null;
  return (
    <section
      className="global-briefing-view"
      data-view={view ?? undefined}
      hidden={!view}
      aria-label={
        view === 'assistant' ? 'AI 비서' : view === 'calendar' ? 'Calendar' : 'Briefing Lab'
      }
    >
      {view === 'settings' && (
        <div className="briefing-system-permissions">
          <button
            title="저장된 서버 설정을 편집 화면에 불러옵니다. 설정 저장 전에는 변경되지 않습니다."
            onClick={() => {
              if (url)
                frame.current?.contentWindow?.postMessage(
                  {
                    type: 'gosu-briefing-navigation',
                    view: 'settings',
                    configuration: configuration.current,
                    restore: true,
                  },
                  new URL(url).origin,
                );
            }}
          >
            기존 연결 설정 불러오기
          </button>
          <span>연결 설정 저장 후에도 접근이 거부되면 macOS 권한을 확인하세요.</span>
          {onPermissionsHelper && (
            <button
              title="GOSU가 쓰는 macOS 권한과 지금 상태를 한 화면에서 보고, 해당 시스템 설정을 엽니다."
              onClick={onPermissionsHelper}
            >
              권한 도우미
            </button>
          )}
          <button onClick={() => void window.gosu.briefingLab.openPrivacy('automation')}>
            Mail 자동화 권한
          </button>
          <button onClick={() => void window.gosu.briefingLab.openPrivacy('calendar')}>
            Calendar 권한
          </button>
          <button
            title="Apple Mail을 빠르게 읽는 데 필요합니다. 한 번 허용하면 GOSU를 업데이트해도 유지되며, 켠 뒤에는 GOSU를 다시 시작해야 적용됩니다."
            onClick={() => void window.gosu.briefingLab.openPrivacy('full-disk')}
          >
            전체 디스크 접근 권한
            {fullDiskAccess === 'granted'
              ? ' · 허용됨'
              : fullDiskAccess === 'missing'
                ? ' · 꺼져 있음'
                : ''}
          </button>
        </div>
      )}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => setRetry((n) => n + 1)}>다시 시도</button>
        </div>
      ) : url ? (
        <iframe
          ref={frame}
          onLoad={() => {
            for (const scope of ['assistant', 'briefing', 'papers'])
              onAiReset?.(scope, 'briefing-frame:');
            navigate();
            if (onAiActivity)
              frame.current?.contentWindow?.postMessage(
                { type: 'gosu-ai-activity-sync' },
                new URL(url).origin,
              );
          }}
          title="공용 Calendar · Briefing Lab"
          src={url}
          sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"
        />
      ) : (
        <p>Briefing Lab 준비 중…</p>
      )}
    </section>
  );
}
