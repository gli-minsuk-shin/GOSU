export const BRIEFING_LAB_OPEN_CHANNEL = 'briefing-lab:open-global';
export const BRIEFING_NOTIFICATIONS_CHANNEL = 'briefing-lab:notifications';
export const BRIEFING_LAB_URL = 'http://127.0.0.1:4318/?embedded=gosu';
export const validBriefingLocation = (v: unknown): v is { url: string } =>
  Boolean(v && typeof v === 'object' && 'url' in v && v.url === BRIEFING_LAB_URL);
