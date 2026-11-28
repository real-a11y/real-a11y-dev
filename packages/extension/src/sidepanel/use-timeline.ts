/**
 * The TIMELINE view's recording, from the panel's side: Record, Stop, Clear
 * and Copy, the runs the top frame sends, and the ends the panel learns of
 * itself (a navigation, another tab). The lines stay in this hook's state,
 * the panel's memory, and go nowhere else.
 */

import type { Dispatch } from "preact/hooks";
import { useCallback, useEffect, useReducer, useRef } from "preact/hooks";

import { isTrustedSender, shouldPanelAcceptMessage } from "../routing.js";
import {
  TIMELINE_PORT,
  type ContentToPanel,
  type PanelToContent,
} from "../types.js";

import {
  initialTimeline,
  isRecording,
  timelineReducer,
  timelineText,
  type TimelineAction,
  type TimelineState,
} from "./timeline-state.js";

type Send = (
  message: PanelToContent,
  responseCallback?: (response: unknown) => void,
) => void;

export interface Timeline {
  state: TimelineState;
  record: () => void;
  stop: () => void;
  clear: () => void;
  copy: () => void;
  highlight: (nodeId: string) => void;
}

/** A session id no earlier recording has: what keeps a stopped recorder's
 *  last run out of the next recording. */
function newSession(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** What a message means for the recording, or null when it is none of its
 *  business. Only the top frame records: a run from anywhere else is
 *  no one's. */
export function timelineActionFor(
  message: ContentToPanel,
  frameId: number | undefined,
): TimelineAction | null {
  if (message.type === "PAGE_NAVIGATED") {
    return { type: "ended", cause: "navigated" };
  }
  if (message.type !== "TIMELINE_EVENTS" && message.type !== "TIMELINE_ENDED") {
    return null;
  }
  const payload = message.payload as Partial<
    Record<"session" | "items" | "reason", unknown>
  > | null;
  if ((frameId ?? 0) !== 0 || typeof payload?.session !== "string") {
    return null;
  }
  const { session, items, reason } = payload;
  if (message.type === "TIMELINE_EVENTS") {
    return Array.isArray(items) ? { type: "events", session, items } : null;
  }
  return reason === "navigated" ||
    reason === "document" ||
    reason === "replaced"
    ? { type: "ended", session, cause: reason }
    : null;
}

/**
 * Hear the page's runs and ends for the bound tab: the same trust and tab
 * gates the panel's own listener applies. A navigation ends the recording
 * too: the page usually says so itself as it goes (`pagehide`), and this
 * covers one whose word never arrives. One that doesn't happen after all (a
 * download) would leave a recorder running, so it is told to stop as well.
 */
function useTimelineMessages(
  myTabId: number | null,
  dispatch: Dispatch<TimelineAction>,
  stopInPage: () => void,
): void {
  useEffect(() => {
    const listener = (
      message: ContentToPanel,
      sender: chrome.runtime.MessageSender,
    ) => {
      if (
        !isTrustedSender(sender, chrome.runtime.id) ||
        !shouldPanelAcceptMessage({
          type: message.type,
          messageTabId: (message as { tabId?: number }).tabId,
          senderTabId: sender.tab?.id,
          myTabId,
        })
      ) {
        return;
      }
      const action = timelineActionFor(message, sender.frameId);
      if (!action) return;
      if (message.type === "PAGE_NAVIGATED") stopInPage();
      dispatch(action);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [myTabId, dispatch, stopInPage]);
}

/**
 * The port held open while a recording runs (`TIMELINE_PORT`): the service
 * worker stops the recording in the page when it closes, which it does
 * however the panel goes. Held again if the service worker restarts, which
 * closes it too, while the recording still runs.
 */
function useRecordingPort(stateRef: { current: TimelineState }) {
  const port = useRef<chrome.runtime.Port | null>(null);
  const release = useCallback(() => {
    const held = port.current;
    port.current = null;
    held?.disconnect();
  }, []);
  const hold = useCallback(
    function holdPort(tabId: number, session: string) {
      release();
      const opened = chrome.runtime.connect({ name: TIMELINE_PORT });
      port.current = opened;
      opened.postMessage({ tabId, session });
      opened.onDisconnect.addListener(() => {
        if (port.current !== opened) return;
        port.current = null;
        const now = stateRef.current;
        if (isRecording(now) && now.session === session) {
          holdPort(tabId, session);
        }
      });
    },
    [release, stateRef],
  );
  return { hold, release };
}

/** Record and Stop, and the stops the panel makes itself. */
function useRecordStop(
  myTabId: number | null,
  sendToBoundTab: Send,
  stateRef: { current: TimelineState },
  dispatch: Dispatch<TimelineAction>,
) {
  // The tab the recording runs in, where a Stop goes whichever tab the panel
  // shows by then.
  const recordingTab = useRef<number | null>(null);
  // The latest Record's session, until Stop: what a start's answer is
  // checked against, whenever it comes.
  const awaitedSession = useRef<string | null>(null);
  const { hold, release } = useRecordingPort(stateRef);

  /** Tell the recording's tab to stop, if it still runs. */
  const stopInPage = useCallback(() => {
    const { session } = stateRef.current;
    const tabId = recordingTab.current;
    if (session === null || tabId === null || !isRecording(stateRef.current)) {
      return;
    }
    // Named outright rather than stamped: the panel may show another tab.
    const message: PanelToContent = {
      type: "TIMELINE_STOP",
      tabId,
      payload: { session },
    };
    void Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => {
      // The service worker or the page is gone, and the recorder with it.
    });
  }, [stateRef]);

  const record = useCallback(() => {
    if (myTabId === null) return;
    const session = newSession();
    recordingTab.current = myTabId;
    awaitedSession.current = session;
    dispatch({ type: "start", session });
    sendToBoundTab(
      { type: "TIMELINE_START", payload: { session } },
      (response) => {
        const reply = response as { success?: boolean; error?: string };
        const started = reply?.success === true;
        // Before the state says so: a panel that goes now still stops it.
        if (started && awaitedSession.current === session) {
          hold(myTabId, session);
        }
        dispatch(
          started
            ? { type: "started", session }
            : { type: "failed", session, error: reply?.error },
        );
      },
    );
  }, [myTabId, sendToBoundTab, dispatch, hold]);

  const stop = useCallback(() => {
    awaitedSession.current = null;
    stopInPage();
    dispatch({ type: "stop" });
  }, [stopInPage, dispatch]);

  // Another tab: the recording is the last tab's, and stops there.
  useEffect(() => {
    if (recordingTab.current === null || recordingTab.current === myTabId) {
      return;
    }
    stopInPage();
    dispatch({ type: "ended", cause: "tab" });
    recordingTab.current = null;
  }, [myTabId, stopInPage, dispatch]);

  // No recording, no port. A panel closing closes it anyway, which stops
  // the recording in the page (`useRecordingPort`).
  const running = isRecording(stateRef.current);
  useEffect(() => {
    if (!running) release();
  }, [running, release]);
  useEffect(() => () => stopInPage(), [stopInPage]);

  return { record, stop, stopInPage };
}

export function useTimeline(
  myTabId: number | null,
  sendToBoundTab: Send,
  announce: (text: string, ms: number) => void,
): Timeline {
  const [state, dispatch] = useReducer(timelineReducer, initialTimeline);
  const stateRef = useRef(state);
  stateRef.current = state;
  const { record, stop, stopInPage } = useRecordStop(
    myTabId,
    sendToBoundTab,
    stateRef,
    dispatch,
  );
  useTimelineMessages(myTabId, dispatch, stopInPage);

  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  const copy = useCallback(() => {
    let text: string;
    try {
      text = timelineText(stateRef.current);
    } catch {
      announce("Couldn't write the timeline's lines", 2500);
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => announce("Copied the timeline", 2500),
      () => announce("Clipboard blocked — click the panel, then retry", 2500),
    );
  }, [announce]);

  // Shows where the node is, and leaves the page's focus alone: moving it
  // would record a focus move of the panel's own.
  const highlight = useCallback(
    (nodeId: string) =>
      sendToBoundTab({
        type: "HIGHLIGHT_NODE",
        payload: { nodeId, keepFocus: true },
      }),
    [sendToBoundTab],
  );

  return { state, record, stop, clear, copy, highlight };
}
