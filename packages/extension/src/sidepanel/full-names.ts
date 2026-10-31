/** Where the "Show full names" setting lives in `chrome.storage.local`, with
 *  the panel's other settings, and followed by every open side panel, so a
 *  panel in one window agrees with a change made in another. Only `true`
 *  turns it on: unset, a long name ends in an ellipsis and the tree fits the
 *  panel. */
export const SHOW_FULL_NAMES_KEY = "settings.showFullNames";
