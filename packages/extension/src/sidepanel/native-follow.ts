/** Timings for the native tree's selection follow and hover preview, kept
 *  dependency-free so the e2e suite can import them rather than copy the
 *  numbers. */

/** How long the selection has to rest on a row before it is revealed on the
 *  page. Long enough to swallow a key-repeat burst. */
export const NATIVE_FOLLOW_DEBOUNCE_MS = 150;

/** How long the pointer has to rest on a row before its element is outlined
 *  on the page. The same wait: long enough that a sweep across the tree
 *  outlines only the row it stops on. */
export const NATIVE_HOVER_DWELL_MS = NATIVE_FOLLOW_DEBOUNCE_MS;
