import React from 'react';
import ReactDOM from 'react-dom/client';
import { DesktopApp } from './desktop-app';
import { applyUserPreferences, loadUserPreferences } from './user-preferences';

import 'katex/dist/katex.min.css';
import './styles.css';
import { loadCachedApplicationUiLanguage } from './application-language-ui';

const initialPreferences = loadUserPreferences(window.localStorage);
loadCachedApplicationUiLanguage();
applyUserPreferences(document.documentElement, initialPreferences);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesktopApp initialPreferences={initialPreferences} />
  </React.StrictMode>,
);
