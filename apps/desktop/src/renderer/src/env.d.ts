/// <reference types="vite/client" />

import type { GosuDesktopApi } from '../../preload';

declare global {
  interface Window {
    gosu: GosuDesktopApi;
  }
}
export {};
