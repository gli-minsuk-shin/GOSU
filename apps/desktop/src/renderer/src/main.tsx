import React from 'react';
import ReactDOM from 'react-dom/client';
import { DesktopApp } from './desktop-app';
import { applyUserPreferences, loadUserPreferences } from './user-preferences';
import './styles.css';

const initialPreferences = loadUserPreferences(window.localStorage);
applyUserPreferences(document.documentElement, initialPreferences);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesktopApp initialPreferences={initialPreferences} />
  </React.StrictMode>,
);
