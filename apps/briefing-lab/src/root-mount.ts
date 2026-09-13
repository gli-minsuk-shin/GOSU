import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type HotRootData = { briefingRoot?: Root };

/** Reuse the root across Vite entry-module updates; never mount two roots on one element. */
export function mountBriefingRoot(
  container: HTMLElement,
  element: ReactNode,
  hotData?: HotRootData,
): Root {
  const root = hotData?.briefingRoot ?? createRoot(container);
  if (hotData) hotData.briefingRoot = root;
  root.render(element);
  return root;
}
