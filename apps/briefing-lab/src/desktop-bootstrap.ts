import { BRIEFING_STORAGE_KEY, LEGACY_BRIEFING_STORAGE_KEY } from './state';
/** Presence, not resemblance to defaults, determines whether user settings already exist. */
export function shouldImportDesktopConfiguration(
  storage: Pick<Storage, 'getItem'>,
  bootstrapped: boolean,
  explicitRestore: boolean,
) {
  if (explicitRestore) return true;
  if (bootstrapped) return false;
  try {
    return (
      storage.getItem(BRIEFING_STORAGE_KEY) === null &&
      storage.getItem(LEGACY_BRIEFING_STORAGE_KEY) === null
    );
  } catch {
    return false;
  }
}
