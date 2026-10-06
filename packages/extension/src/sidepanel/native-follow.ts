/** Timings for the native tree's selection follow, kept dependency-free so
 *  the e2e suite can import them rather than copy the numbers. */

/** How long the selection has to rest on a row before it is revealed on the
 *  page. Long enough to swallow a key-repeat burst. */
export const NATIVE_FOLLOW_DEBOUNCE_MS = 150;
