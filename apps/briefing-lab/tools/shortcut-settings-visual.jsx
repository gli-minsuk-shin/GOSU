import React from 'react';
import { createRoot } from 'react-dom/client';
import { ShortcutSettings } from '../../desktop/src/renderer/src/shortcut-settings';
import '../../desktop/src/renderer/src/styles.css';
let saved = 'CommandOrControl+Shift+Space';
Object.assign(window, {
  gosu: {
    app: {
      getAssistantShortcut: async () => saved,
      setAssistantShortcut: async (value) => (saved = value),
    },
  },
});
createRoot(document.getElementById('root')).render(
  <main style={{ maxWidth: 760, margin: '40px auto', padding: 24 }}>
    <ShortcutSettings />
  </main>,
);
