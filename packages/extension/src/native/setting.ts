/** Where the native-mode setting lives in `chrome.storage.local`: written by
 *  the service worker (`index.ts`), which also enforces it, and followed by
 *  every open side panel, so a panel in one window agrees with a change made
 *  in another. Absent until the user changes it in the panel's Settings;
 *  native mode is on unless it is `false`. */
export const NATIVE_MODE_KEY = "settings.nativeModeEnabled";

/** Whether the setting's stored value means native mode is on: anything but
 *  `false`, so a setting never touched (unset) reads as on. The one rule the
 *  service worker's attach gate and every side panel read it by. */
export function nativeModeOn(value: unknown): boolean {
  return value !== false;
}

/** Set once the user has acknowledged the side panel's note about Chrome's
 *  debugging bar, so the note shows until then and never again after, in
 *  every window. */
export const NATIVE_NOTICE_SEEN_KEY = "settings.nativeNoticeSeen";
