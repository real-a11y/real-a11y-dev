/// <reference types="chrome" />

/**
 * The service worker's half of the TIMELINE view's recording: Record and
 * Stop, relayed from the panel to the bound tab's top frame, which alone
 * records (`timeline-recording.ts`). Its own `onMessage` listener, as native
 * mode's is (`native/index.ts`); the main router leaves `TIMELINE_*`
 * messages to it (`handledByOwnListener` in routing.ts).
 *
 * Only the extension's own pages may start or stop a recording, never a
 * content script, which runs in the page's process: a page must never be
 * able to start one, and a recording reads everything the user meets on the
 * page. The panel opened as a tab (the e2e harness) has a `sender.tab` too,
 * which is why the test is the sender's URL (`isExtensionPageSender`).
 *
 * The lines themselves never pass through here: the top frame's
 * `chrome.runtime.sendMessage` reaches the panel directly, and a relayed
 * copy would show every line twice.
 */

import { isExtensionPageSender } from "./routing.js";
import type { PanelToContent } from "./types.js";

type TimelineControl = Extract<
  PanelToContent,
  { type: "TIMELINE_START" | "TIMELINE_STOP" }
>;

function isTimelineControl(message: unknown): message is TimelineControl {
  const type = (message as { type?: unknown } | null)?.type;
  return type === "TIMELINE_START" || type === "TIMELINE_STOP";
}

/** Relay a panel's Record or Stop to the top frame of the tab it names, and
 *  answer with the frame's reply. Registered when the service worker
 *  imports this module, once. */
function registerTimelineRelay(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isTimelineControl(message)) return;
    if (
      !isExtensionPageSender(
        sender,
        chrome.runtime.id,
        chrome.runtime.getURL(""),
      )
    ) {
      return false;
    }
    // The panel always names its tab: a recording never goes to whichever
    // tab happens to be active.
    if (typeof message.tabId !== "number") {
      sendResponse({ success: false, error: "No tab named" });
      return false;
    }
    chrome.tabs.sendMessage(
      message.tabId,
      message,
      { frameId: 0 },
      (response: unknown) => {
        sendResponse(
          chrome.runtime.lastError || response === undefined
            ? { success: false, error: "Content script not available" }
            : response,
        );
      },
    );
    return true;
  });
}

registerTimelineRelay();
