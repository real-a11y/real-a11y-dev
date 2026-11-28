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
 * A panel holds a port open for each recording it runs (`TIMELINE_PORT`):
 * when the panel goes, which closes the port however it goes, the recording
 * it started is stopped in the page. The service worker's own stop of the
 * page (`SET_OBSERVING`) comes only when the last side panel closes, and a
 * panel's own clean-up doesn't run when Chrome destroys its document.
 *
 * The lines themselves never pass through here: the top frame's
 * `chrome.runtime.sendMessage` reaches the panel directly, and a relayed
 * copy would show every line twice.
 */

import { isExtensionPageSender } from "./routing.js";
import { TIMELINE_PORT, type PanelToContent } from "./types.js";

type TimelineControl = Extract<
  PanelToContent,
  { type: "TIMELINE_START" | "TIMELINE_STOP" }
>;

function isTimelineControl(message: unknown): message is TimelineControl {
  const type = (message as { type?: unknown } | null)?.type;
  return type === "TIMELINE_START" || type === "TIMELINE_STOP";
}

const fromExtensionPage = (sender: chrome.runtime.MessageSender | undefined) =>
  isExtensionPageSender(sender, chrome.runtime.id, chrome.runtime.getURL(""));

/** Tell `tabId`'s top frame to stop `session`'s recording. */
function stopInTab(tabId: number, session: string): void {
  const stop: TimelineControl = {
    type: "TIMELINE_STOP",
    tabId,
    payload: { session },
  };
  chrome.tabs.sendMessage(tabId, stop, { frameId: 0 }, () => {
    // The page may be gone, and the recorder with it.
    void chrome.runtime.lastError;
  });
}

/**
 * Stop the recording a panel's port names when the port closes. The port
 * says which tab and session once the page has started recording; until
 * then there is nothing to stop.
 */
function holdRecordingPort(port: chrome.runtime.Port): void {
  if (port.name !== TIMELINE_PORT) return;
  if (!fromExtensionPage(port.sender)) {
    port.disconnect();
    return;
  }
  let held: { tabId: number; session: string } | null = null;
  port.onMessage.addListener((message: unknown) => {
    const { tabId, session } = (message ?? {}) as Partial<
      Record<"tabId" | "session", unknown>
    >;
    if (typeof tabId === "number" && typeof session === "string") {
      held = { tabId, session };
    }
  });
  port.onDisconnect.addListener(() => {
    if (held) stopInTab(held.tabId, held.session);
  });
}

/** Relay a panel's Record or Stop to the top frame of the tab it names, and
 *  answer with the frame's reply. Registered when the service worker
 *  imports this module, once. */
function registerTimelineRelay(): void {
  chrome.runtime.onConnect.addListener(holdRecordingPort);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isTimelineControl(message)) return;
    if (!fromExtensionPage(sender)) return false;
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
