/** Set once the user has acknowledged the side panel's note about Chrome's
 *  debugging bar, so the note shows until then and never again after, in
 *  every window. */
export const NATIVE_NOTICE_SEEN_KEY = "settings.nativeNoticeSeen";

/** Remove what the native-mode switch stored up to 0.1.17, and the key it
 *  was migrated from: nothing reads them now. Whoever had switched it off
 *  is about to see Chrome's bar again, so the note that explains the bar
 *  shows again too. */
export async function forgetRetiredSettings(): Promise<void> {
  const key = "settings.nativeModeEnabled";
  const wasOff = (await chrome.storage.local.get(key))[key] === false;
  await chrome.storage.local.remove([
    key,
    "devFlags.nativeMode",
    ...(wasOff ? [NATIVE_NOTICE_SEEN_KEY] : []),
  ]);
}
