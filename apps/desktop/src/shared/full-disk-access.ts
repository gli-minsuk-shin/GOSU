/**
 * Apple Mail's index lives under ~/Library/Mail, which macOS lets an app read only with Full Disk
 * Access. macOS grants it to the app's code signing requirement, and every GOSU build is signed with
 * the same local certificate (`verify-update-continuity.mjs` gates on it), so one approval survives
 * updates. Only the user can give it, in System Settings; GOSU can only notice that it is missing
 * and open the right pane.
 */
export const FULL_DISK_ACCESS_CHANNEL = 'gosu:privacy:full-disk-access';
export const FULL_DISK_ACCESS_STATES = ['granted', 'missing', 'not-needed', 'unknown'] as const;
export type FullDiskAccessState = (typeof FULL_DISK_ACCESS_STATES)[number];
export const FULL_DISK_ACCESS_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';
/** The notice is per Mac and not a preference worth a settings file: it lives in localStorage. */
export const FULL_DISK_ACCESS_DISMISSED_KEY = 'gosu.full-disk-access.notice-dismissed.v1';
/** The first-run permissions helper was shown once on this Mac (it stays reachable from Settings). */
export const PERMISSIONS_HELPER_SEEN_KEY = 'gosu.permissions-helper.seen.v1';
