import { uiText, useUiText } from '@gosu/ui/language';
export function paperSourceHref(value: string | undefined) {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function PaperSourceLink({ url, title }: { url?: string | undefined; title: string }) {
  useUiText();
  const href = paperSourceHref(url);
  const icon = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  );
  return href ? (
    <a
      className="briefing-paper-source-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={uiText('Open original paper · new window')}
      aria-label={`${title} · ${uiText('Open paper source')}`}
      onClick={(event) => event.stopPropagation()}
    >
      {icon}
    </a>
  ) : (
    <span
      className="briefing-paper-source-link is-unavailable"
      role="img"
      aria-label={uiText('Paper source link unavailable')}
      title={uiText('No saved source link. No paper URL will be guessed.')}
    >
      {icon}
    </span>
  );
}
