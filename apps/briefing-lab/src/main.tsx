import { StrictMode, useState, useEffect, useRef } from 'react';
import { parseBriefingWorkspace } from '@gosu/briefing-core';
import { isDesktopNavigation, isGosuEmbedded } from './desktop-bridge';
import { shouldImportDesktopConfiguration } from './desktop-bootstrap';
import type { BriefingWorkspace } from '@gosu/briefing-core';
import { BriefingApp } from './briefing-app';
import { loadWorkspace, saveWorkspace } from './state';
import { mountBriefingRoot } from './root-mount';
import { ConnectionRecovery } from './connection-recovery';

function App() {
  const [imported, setImported] = useState(false);
  const bootstrapped = useRef(false);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        !isDesktopNavigation(event) ||
        !shouldImportDesktopConfiguration(
          { getItem: (key) => window.localStorage.getItem(key) },
          bootstrapped.current,
          event.data.restore === true,
        )
      )
        return;
      const configuration = parseBriefingWorkspace(event.data.configuration);
      if (configuration) {
        bootstrapped.current = true;
        if (event.data.restore === true) setWorkspace(configuration);
        else change(configuration);
        setImported(true);
      }
    };
    if (isGosuEmbedded()) document.documentElement.dataset.gosuEmbedded = 'true';
    window.addEventListener('message', receive);
    // Readiness contains no data; the parent replies only to the exact frame/origin.
    if (isGosuEmbedded()) window.parent.postMessage({ type: 'gosu-briefing-ready' }, '*');
    return () => window.removeEventListener('message', receive);
  }, []);
  const [initial] = useState(() =>
    loadWorkspace({ getItem: (key) => window.localStorage.getItem(key) }, new Date().toISOString()),
  );
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [storageError, setStorageError] = useState(initial.error);
  const writable = initial.writable;
  const change = (next: BriefingWorkspace) => {
    setWorkspace(next);
    if (writable)
      setStorageError(
        saveWorkspace({ setItem: (key, value) => window.localStorage.setItem(key, value) }, next),
      );
  };
  return (
    <>
      <ConnectionRecovery routines={workspace.routines} revision={imported} />
      <BriefingApp
        workspace={workspace}
        onChange={change}
        storageError={storageError ?? undefined}
      />
    </>
  );
}

mountBriefingRoot(
  document.getElementById('root')!,
  <StrictMode>
    <App />
  </StrictMode>,
  import.meta.hot?.data,
);
