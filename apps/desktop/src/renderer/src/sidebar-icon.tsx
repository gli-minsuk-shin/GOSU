import type { ReactNode } from 'react';

import type { WorkspaceTabId } from './workspace-views';

export type SidebarIconName =
  WorkspaceTabId | 'review' | 'settings' | 'notifications' | 'assistant';

// One optical grid and stroke style, independent of the installed text/emoji fonts.
// These small, local SVGs are decorative; navigation labels remain the accessible names.
const ICONS: Record<SidebarIconName, ReactNode> = {
  assistant: (
    <>
      <path d="M6.5 7h8a3.5 3.5 0 0 1 3.5 3.5v4a3.5 3.5 0 0 1-3.5 3.5H8l-5 3V10.5A3.5 3.5 0 0 1 6.5 7Z" />
      <circle cx="7" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
      <path
        data-assistant-sparkle="true"
        d="M20 1.5l.85 2.15L23 4.5l-2.15.85L20 7.5l-.85-2.15L17 4.5l2.15-.85Z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3M7 18h3" />
    </>
  ),
  'briefing-lab': (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h8M8 15h4M8 18h8" />
    </>
  ),
  notifications: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM9 20a3 3 0 0 0 6 0" />,
  chat: <path d="M8 18 4 21V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8ZM8 9h8M8 13h5" />,
  'model-lab': (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  repository: (
    <>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M6 7.5v9M18 7.5v1a5 5 0 0 1-5 5H6" />
    </>
  ),
  manuscript: (
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8M8 17h6" />
  ),
  board: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16M15 4v16M6 8v5M12 8v8M18 8v3" />
    </>
  ),
  objective: (
    <>
      <circle cx="11" cy="13" r="8" />
      <circle cx="11" cy="13" r="4" />
      <path d="m11 13 9-9M16 4h4v4" />
    </>
  ),
  experiments: (
    <>
      <path d="M9 3h6M10 3v6l-6 9a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3l-6-9V3M7 14h10" />
      <path d="M10 17h.01M14 18h.01" />
    </>
  ),
  literature: (
    <path d="M12 5C9 3 6 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15M6 8h3M6 12h3M15 8h3M15 12h3" />
  ),
  notes: (
    <>
      <rect x="5" y="3" width="15" height="18" rx="2.5" />
      <path d="M3 7h4M3 12h4M3 17h4M10 8h6M10 12h6M10 16h4" />
    </>
  ),
  tasks: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="m6 8 1.5 1.5L10 7M13 8h5m-12 7 1.5 1.5L10 14M13 15h5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  lecture: (
    <>
      <rect x="3" y="3" width="18" height="13" rx="2" />
      <path d="M12 16v5m-4 0h8M8 7l5 3-5 3V7Zm8 0h1m-1 4h1" />
    </>
  ),
  connections: (
    <path d="m8 7 9 9M10 5l9 9M5 10l3-3 9 9-3 3a4.2 4.2 0 0 1-6 0l-3-3a4.2 4.2 0 0 1 0-6Zm8-2 3-3m0 6 3-3M6 18l-3 3" />
  ),
  usage: <path d="M4 4v16h17M8 16v-5m5 5V7m5 9v-7" />,
  review: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m7.5 12 3 3 6-6" />
    </>
  ),
  settings: (
    <>
      <path d="M3 6h3m4 0h11M3 12h11m4 0h3M3 18h5m4 0h9" />
      <circle cx="8" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="10" cy="18" r="2" />
    </>
  ),
};

export function SidebarIcon({ name }: { name: SidebarIconName }) {
  return (
    <span className="sidebar-nav-icon" aria-hidden="true">
      <svg
        className={`sidebar-nav-icon-graphic sidebar-nav-icon-${name}`}
        data-sidebar-icon={name}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        {ICONS[name]}
      </svg>
    </span>
  );
}
