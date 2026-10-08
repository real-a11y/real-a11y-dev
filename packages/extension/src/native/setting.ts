/** Where the native-mode setting lives in `chrome.storage.local`: written by
 *  the service worker (`index.ts`), which also enforces it, and followed by
 *  every open side panel, so a panel in one window agrees with an answer
 *  given in another. Absent until the user answers the panel's question. */
export const NATIVE_MODE_KEY = "settings.nativeModeEnabled";
