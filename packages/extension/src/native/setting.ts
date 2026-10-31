/** Set once the user has acknowledged the side panel's note about Chrome's
 *  debugging bar, so the note shows until then and never again after, in
 *  every window. */
export const NATIVE_NOTICE_SEEN_KEY = "settings.nativeNoticeSeen";

/** Remove what the native-mode switch stored up to 0.1.17, and the key it
 *  was migrated from: nothing reads them now. */
export async function forgetRetiredSettings(): Promise<void> {
  await chrome.storage.local.remove([
    "settings.nativeModeEnabled",
    "devFlags.nativeMode",
  ]);
}
