import { useEffect, useRef, useState } from 'react';
import { validBriefingLocation } from '../../shared/briefing-lab-contracts';
import type { BriefingNotificationTarget } from '../../../../briefing-lab/src/briefing-notifications';
import {
  parseBriefingItemTarget,
  type BriefingItemTarget,
} from '../../../../briefing-lab/src/briefing-item-navigation';
export function GlobalBriefingView({
  view,
  navigationRevision = 0,
  onSettings,
  onOpenItem,
  calendarTarget,
  briefingTarget,
}: {
  view: 'calendar' | 'history' | 'settings' | 'papers' | 'manage' | 'assistant' | null;
  navigationRevision?: number;
  onSettings?: () => void;
  onOpenItem?: (target: BriefingItemTarget) => void;
  calendarTarget?: { id: string; start: string; requestId: number; routineId?: string } | null;
  briefingTarget?: BriefingNotificationTarget | undefined;
}) {
  const [visited, setVisited] = useState(false),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
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
  const navigate = () => {
    if (url && view)
      frame.current?.contentWindow?.postMessage(
        {
          type: 'gosu-briefing-navigation',
          view,
          configuration: configuration.current,
          ...(view === 'calendar' && calendarTarget ? { calendarTarget } : {}),
          ...(view === 'history' && briefingTarget ? { briefingTarget } : {}),
        },
        new URL(url).origin,
      );
  };
  useEffect(navigate, [url, view, navigationRevision, calendarTarget, briefingTarget]);
  useEffect(() => {
    const ready = (event: MessageEvent) => {
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
        event.data?.type === 'gosu-briefing-ready'
      )
        navigate();
    };
    window.addEventListener?.('message', ready);
    return () => window.removeEventListener?.('message', ready);
  }, [url, view, navigationRevision, onSettings, onOpenItem, calendarTarget, briefingTarget]);
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
          <button onClick={() => void window.gosu.briefingLab.openPrivacy('automation')}>
            Mail 자동화 권한
          </button>
          <button onClick={() => void window.gosu.briefingLab.openPrivacy('calendar')}>
            Calendar 권한
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
          onLoad={navigate}
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
