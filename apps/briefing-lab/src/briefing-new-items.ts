import { useEffect, useState } from 'react';
const KEY = 'gosu.briefing.seen-updates.v1';
function loadSeen(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, at]) => typeof at === 'string' && Number.isFinite(Date.parse(at)),
      ),
    );
  } catch {
    return {};
  }
}
export function hasNewBriefingItem(
  addedAt: string | undefined,
  seenThrough?: string,
  newItemsSince?: string,
) {
  return Boolean(
    addedAt &&
    Date.parse(addedAt) > (seenThrough ? Date.parse(seenThrough) : 0) &&
    (!newItemsSince || Date.parse(addedAt) >= Date.parse(newItemsSince)),
  );
}
export function useBriefingNewItems() {
  const [seen, setSeen] = useState(loadSeen);
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === KEY) setSeen(loadSeen());
    };
    if (typeof window !== 'undefined') window.addEventListener?.('storage', update);
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener?.('storage', update);
    };
  }, []);
  const acknowledge = (runKey: string, addedAt: string[]) => {
    const at = [...addedAt].sort().at(-1);
    if (!at) return;
    const merged: Record<string, string> = {};
    for (const [key, value] of [
      ...Object.entries(loadSeen()),
      ...Object.entries(seen),
      [runKey, at],
    ])
      if (!merged[key!] || Date.parse(value!) > Date.parse(merged[key!]!)) merged[key!] = value!;
    const next = Object.fromEntries(
      Object.entries(merged)
        .sort((a, b) => b[1].localeCompare(a[1]))
        .slice(0, 1000),
    );
    setSeen(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* Retain per-page acknowledgement when browser storage is unavailable. */
    }
  };
  return {
    isNew: (runKey: string, at?: string, newItemsSince?: string) =>
      hasNewBriefingItem(at, seen[runKey], newItemsSince),
    acknowledge,
  };
}
