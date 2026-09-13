import { isGosuEmbedded } from './desktop-bridge';
export type BriefingItemTarget =
  { kind: 'task'; id: string } | { kind: 'calendar'; id: string; start: string };
export function parseBriefingItemTarget(value: unknown): BriefingItemTarget | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !v.id || v.id.length > 300) return null;
  if (v.kind === 'task' && Object.keys(v).length === 2) return { kind: 'task', id: v.id };
  if (
    v.kind === 'calendar' &&
    Object.keys(v).length === 3 &&
    typeof v.start === 'string' &&
    v.start.length <= 40 &&
    Number.isFinite(Date.parse(v.start))
  )
    return { kind: 'calendar', id: v.id, start: v.start };
  return null;
}
export function openBriefingItem(target: BriefingItemTarget) {
  if (isGosuEmbedded()) window.parent.postMessage({ type: 'gosu-briefing-open-item', target }, '*');
}
