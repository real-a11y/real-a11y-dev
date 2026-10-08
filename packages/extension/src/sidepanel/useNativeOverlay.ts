/**
 * The page outline the native tree draws through `chrome.debugger`, as the
 * DOM tree's select and hover do: a settled selection's `reveal` (outline,
 * scrolled into view, real focus) and a hovered row's `preview` (outline in
 * place, nothing else). One hook, so both share the guards, the request ids
 * the service worker drops a superseded one by, and what is on the page.
 *
 * Both are fire-and-forget and silent on failure: visual aids, not actions
 * anyone waits on. Neither runs while a read or action the user started is
 * in flight (it could steal focus from what that opened), or while Screen
 * Curtain hides the page.
 */

import { useCallback, useRef } from "preact/hooks";

import { backendNodeIdFrom } from "../native/native-core.js";

export interface NativeOverlayInputs {
  enabled: boolean;
  /** The tab the native tree was read from. */
  tabId: number | undefined;
  busy: boolean;
  curtainOn: boolean;
  /** A pick draws its own overlay; a hover draws none over it. */
  pickArmed: boolean;
  /** A read or action the user started is in flight. An automatic read is
   *  not: it changes no ids, and the service worker queues behind it. */
  userOpInFlight: () => boolean;
  announce: (text: string, ms: number) => void;
}

interface OverlayAnswer {
  success?: boolean;
  outlined?: boolean;
  error?: string;
  reason?: string;
}

export function useNativeOverlay(inputs: NativeOverlayInputs) {
  // Read at call time, so the callbacks below keep one identity: the tree
  // view calls them from timers, and a fresh identity there would reveal
  // the same row again whenever `busy` flips.
  const live = useRef(inputs);
  live.current = inputs;

  // One counter for reveals and previews: a queued preview is superseded by
  // any newer overlay request on its tab, a reveal by a newer reveal.
  const lastRequest = useRef(0);
  // The tab it last told the user can't show an outline: said once per tab.
  const noOutlineAnnouncedFor = useRef<number | null>(null);
  // The tab whose previews stopped: one was refused for a reason (DevTools
  // open, a page native mode can't attach to) or by the user's Cancel on
  // Chrome's bar. Every later hover would be refused the same way, or put the
  // bar back after the user dismissed it, so previews wait for the next
  // successful read (`resumePreviews`).
  const previewsPausedFor = useRef<number | null>(null);
  // The row under the pointer now, the tab the last outline was asked for
  // on, and how many times the pointer has left the rows.
  const hovered = useRef<string | null>(null);
  const outlineTab = useRef<number | null>(null);
  const leaves = useRef(0);

  const canDraw = (
    s: NativeOverlayInputs,
  ): s is NativeOverlayInputs & {
    tabId: number;
  } =>
    s.enabled &&
    s.tabId !== undefined &&
    !s.busy &&
    !s.curtainOn &&
    !s.userOpInFlight();

  const ask = (tabId: number, nodeId: string, action: "reveal" | "preview") => {
    const requestId = ++lastRequest.current;
    const answer = chrome.runtime
      .sendMessage({
        type: "NATIVE_ACT",
        tabId,
        nodeId,
        action,
        silent: true,
        requestId,
      })
      .then((r: OverlayAnswer | undefined) => r ?? {})
      .catch((): OverlayAnswer => ({}));
    return { requestId, answer };
  };

  /** Clear the outline on the tab the last one was asked for on — not on
   *  whichever tab the panel is bound to by then. */
  const clearOutline = (tabId = outlineTab.current) => {
    if (tabId === null) return;
    void chrome.runtime
      .sendMessage({ type: "CLEAR_HIGHLIGHT", tabId })
      .catch(() => {});
  };

  const reveal = useCallback((nodeId: string) => {
    const s = live.current;
    if (!canDraw(s)) return;
    const tabId = s.tabId;
    outlineTab.current = tabId;
    const leavesBefore = leaves.current;
    const { requestId, answer } = ask(tabId, nodeId, "reveal");
    void answer.then((r) => {
      // The pointer left the rows while this was on its way (a clicked
      // row's reveal), so the clear went first: clear what it drew.
      if (
        r.success &&
        leaves.current !== leavesBefore &&
        lastRequest.current === requestId
      ) {
        clearOutline(tabId);
      }
      if (!r.success || r.outlined !== false) return;
      if (noOutlineAnnouncedFor.current === tabId) return;
      noOutlineAnnouncedFor.current = tabId;
      live.current.announce(
        "This page can't show the outline (the extension's page script isn't running here; reloading the page usually fixes it).",
        5000,
      );
    });
  }, []);

  /**
   * The pointer rests on `nodeId`, or left the tree's rows (`null`). Leaving
   * clears the outline, whichever row it came from — the selection's too, as
   * the DOM tree's hover does. A preview that settles after the pointer has
   * left clears what it drew, unless a newer overlay was asked for since.
   */
  const preview = useCallback((nodeId: string | null) => {
    hovered.current = nodeId;
    if (nodeId === null) {
      leaves.current++;
      clearOutline();
      return;
    }
    const s = live.current;
    if (
      !canDraw(s) ||
      s.pickArmed ||
      previewsPausedFor.current === s.tabId ||
      // A row with no backing element has nothing to outline.
      backendNodeIdFrom(nodeId) === null
    ) {
      return;
    }
    const tabId = s.tabId;
    outlineTab.current = tabId;
    const { requestId, answer } = ask(tabId, nodeId, "preview");
    void answer.then((r) => {
      // An answer from a tab the panel has left says nothing about this one.
      if (live.current.tabId !== tabId) return;
      if (r.error === "cancelled-by-user" || r.reason !== undefined) {
        previewsPausedFor.current = tabId;
      }
      if (hovered.current === null && lastRequest.current === requestId) {
        clearOutline();
      }
    });
  }, []);

  /** A read succeeded on `tabId`: whatever refused its previews is gone. */
  const resumePreviews = useCallback((tabId: number) => {
    if (previewsPausedFor.current === tabId) previewsPausedFor.current = null;
  }, []);

  return { reveal, preview, resumePreviews };
}
