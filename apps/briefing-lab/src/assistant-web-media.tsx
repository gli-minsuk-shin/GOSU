import { useState, type ReactNode } from 'react';

export function publicWebUrl(raw: string | undefined) {
  try {
    const u = new URL(raw ?? '');
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port ||
      u.href.length > 2000 ||
      !u.hostname.includes('.') ||
      /^[\d.]+$/.test(u.hostname) ||
      u.hostname.includes(':') ||
      /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)
    )
      return null;
    return u;
  } catch {
    return null;
  }
}
export function mapPreviewUrl(raw: string | undefined) {
  const u = publicWebUrl(raw);
  if (
    !u ||
    u.hostname !== 'www.openstreetmap.org' ||
    u.pathname !== '/' ||
    !u.searchParams.has('mlat') ||
    !u.searchParams.has('mlon')
  )
    return null;
  if (
    !/^-?\d+(?:\.\d+)?$/.test(u.searchParams.get('mlat')!) ||
    !/^-?\d+(?:\.\d+)?$/.test(u.searchParams.get('mlon')!)
  )
    return null;
  const lat = Number(u.searchParams.get('mlat')),
    lon = Number(u.searchParams.get('mlon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180)
    return null;
  const embed = new URL('https://www.openstreetmap.org/export/embed.html');
  embed.search = new URLSearchParams({
    bbox: `${Math.max(-180, lon - 0.006)},${lat - 0.004},${Math.min(180, lon + 0.006)},${lat + 0.004}`,
    layer: 'mapnik',
    marker: `${lat},${lon}`,
  }).toString();
  return embed.href;
}
export function AssistantWebLink({
  href,
  children,
}: {
  href?: string | undefined;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const url = publicWebUrl(href),
    map = mapPreviewUrl(href);
  if (!url) return <span>{children}</span>;
  return (
    <span className="assistant-web-link">
      <a href={url.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
        {children}
      </a>
      {map && (
        <>
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? '지도 접기' : '지도 표시'}
          </button>
          {open && (
            <iframe
              title="검색한 장소의 지도 · 실내 호실 위치는 별도 확인"
              src={map}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin"
            />
          )}
          <small>© OpenStreetMap contributors · 지도 표시 시 외부 서비스에 연결</small>
        </>
      )}
    </span>
  );
}
export function AssistantWebImage({
  src,
  alt,
}: {
  src?: string | undefined;
  alt?: string | undefined;
}) {
  const [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false);
  const url = publicWebUrl(src);
  if (!url) return null;
  return (
    <span className="assistant-web-image">
      {loaded && !failed ? (
        <img
          src={url.href}
          alt={alt ?? '검색 이미지'}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setLoaded(true);
          }}
        >
          {failed ? '이미지 로드 실패 · 다시 보기' : `이미지 보기 · ${alt ?? url.hostname}`}
        </button>
      )}
      <small>{url.hostname} · 외부 이미지 · 출처와 이용 조건 확인</small>
    </span>
  );
}
