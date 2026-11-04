/**
 * Which ACTIVE_TAB_CHANGED a side panel takes, out of the many the service
 * worker sends: one per window, to every panel. `App.tsx` binds to the tab
 * it names.
 */

import { isPanelWindow } from "../routing.js";

/** What the panel keeps of an ACTIVE_TAB_CHANGED. */
export type ActiveTabTold = {
  tabId: number;
  windowId: number;
  focus?: boolean;
};

/**
 * Whether a panel in window `myWindowId` takes an ACTIVE_TAB_CHANGED: one for
 * its own window (`isPanelWindow`), unless the worker told it the window's
 * tab because the user moved to the window, and what they moved to is this
 * panel. Then they came for what it shows (a popup, say), not the page.
 */
export function takesActiveTab(
  m: ActiveTabTold,
  myWindowId: number | null,
): boolean {
  return (
    isPanelWindow(m.windowId, myWindowId) && !(m.focus && document.hasFocus())
  );
}
