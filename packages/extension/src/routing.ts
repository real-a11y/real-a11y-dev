/**
 * Pure routing helpers for the Chrome extension background script.
 *
 * Extracted into their own module so they can be unit-tested without
 * pulling in the Chrome APIs that the background uses elsewhere.
 */

// ---- Node ID prefixing to avoid collisions between frames ----

/**
 * Prefix a node id with its owning frame id.  Frame 0 (the top frame) gets
 * no prefix — its ids are used as-is — so the tree of a single-frame page
 * reads identically to how it was extracted.
 */
export function prefixNodeId(frameId: number, nodeId: string): string {
  return frameId === 0 ? nodeId : `f${frameId}-${nodeId}`;
}

/**
 * Inverse of `prefixNodeId`.  A bare `"abc"` parses as frame 0; `"f5-abc"`
 * parses as frame 5 with local id `"abc"`.  Local ids are allowed to
 * contain hyphens (`"f5-abc-def"` → `{frameId:5, localId:"abc-def"}`).
 */
export function parseNodeId(prefixedId: string): {
  frameId: number;
  localId: string;
} {
  const match = prefixedId.match(/^f(\d+)-(.+)$/);
  if (match) return { frameId: parseInt(match[1], 10), localId: match[2] };
  return { frameId: 0, localId: prefixedId };
}

// ---- URL comparison for iframe → frame association ----

/**
 * Normalize a URL for comparison.  Strips the hash, the search, and any
 * trailing slash so two references to the same document compare equal.
 * Returns the input unchanged when it can't be meaningfully normalized
 * (non-http(s) schemes like `about:blank`, `chrome:`, or non-URL strings).
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return url;
    return (u.origin + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

/**
 * True if an `<iframe src>` refers to the same document as a frame whose
 * url we already know.  Handles relative-to-parent `src` attributes when
 * `parentUrl` is supplied.
 */
export function urlsMatch(
  iframeSrc: string,
  frameUrl: string,
  parentUrl?: string,
): boolean {
  if (!iframeSrc || iframeSrc === "about:blank") return false;

  try {
    const resolvedSrc = parentUrl
      ? new URL(iframeSrc, parentUrl).href
      : iframeSrc;
    return normalizeUrl(resolvedSrc) === normalizeUrl(frameUrl);
  } catch {
    return normalizeUrl(iframeSrc) === normalizeUrl(frameUrl);
  }
}

// ---- Frame-announcement response planning ----

/**
 * A single chrome.tabs.sendMessage call the background intends to make.
 * Expressed as data so `planFrameAnnouncementResponse` can be unit-tested
 * without mocking the Chrome APIs.
 */
export interface PlannedTabMessage {
  tabId: number;
  /** Omit for tab-wide broadcasts (only the top frame needs the message). */
  frameId?: number;
  body: { type: string; payload?: unknown };
}

/**
 * Decide what the background should send to a content script that just
 * announced itself via `FRAME_TREE_DATA`.
 *
 * Two decisions live here:
 *
 *   1. **Re-apply the curtain** if the tab's top frame just navigated and
 *      the curtain was on. The new top frame wouldn't have it otherwise.
 *
 *   2. **Re-assert the focus tracker** to the announcing frame if the
 *      side panel is currently open. Closes the cold-start race where the
 *      panel's one-shot `SET_FOCUS_TRACKER` could land before the content
 *      script was listening. Tying the enable signal to "content script
 *      announced itself" turns the tracker on the moment the frame is
 *      reachable — and every subframe or new navigation gets the current
 *      state automatically.
 */
export function planFrameAnnouncementResponse(opts: {
  tabId: number;
  frameId: number;
  isNewTopFrame: boolean;
  sidepanelConnected: boolean;
  curtainOn: boolean;
}): PlannedTabMessage[] {
  const out: PlannedTabMessage[] = [];

  if (opts.isNewTopFrame && opts.curtainOn) {
    out.push({
      tabId: opts.tabId,
      body: { type: "TOGGLE_CURTAIN", payload: { visible: true } },
    });
  }

  if (opts.sidepanelConnected) {
    // Re-assert observation (idempotent — content's startObserving() early-
    // returns if already observing) so a frame that keeps announcing after a
    // service-worker revival stays armed, and re-assert the focus tracker.
    out.push({
      tabId: opts.tabId,
      frameId: opts.frameId,
      body: { type: "SET_OBSERVING", payload: { enabled: true } },
    });
    out.push({
      tabId: opts.tabId,
      frameId: opts.frameId,
      body: { type: "SET_FOCUS_TRACKER", payload: { enabled: true } },
    });
  }

  return out;
}

/**
 * Decide what to send a frame that just sent a lightweight `FRAME_HELLO`
 * (content-script load announce — it is NOT yet observing). If a panel is
 * connected for the tab, tell the frame to start observing and enable the
 * focus tracker. When no panel is connected this returns nothing, so a page
 * whose panel was never opened does zero extraction.
 *
 * Curtain re-application is intentionally NOT handled here — it rides the
 * `FRAME_TREE_DATA` path (planFrameAnnouncementResponse), which the frame
 * reaches as soon as it starts observing.
 */
export function planFrameHello(opts: {
  tabId: number;
  frameId: number;
  sidepanelConnected: boolean;
}): PlannedTabMessage[] {
  if (!opts.sidepanelConnected) return [];
  return [
    {
      tabId: opts.tabId,
      frameId: opts.frameId,
      body: { type: "SET_OBSERVING", payload: { enabled: true } },
    },
    {
      tabId: opts.tabId,
      frameId: opts.frameId,
      body: { type: "SET_FOCUS_TRACKER", payload: { enabled: true } },
    },
  ];
}

/**
 * Decide what the background should broadcast to the active tab when the
 * side panel closes. Three things need teardown:
 *
 *   1. **Focus tracker**: turn it off so the `focusin` listener in the
 *      content script stops redrawing the highlight overlay on tab keystrokes
 *      with no panel to receive the focus updates.
 *   2. **Highlight overlay**: clear any lingering highlight so the page
 *      doesn't keep a stale focus ring after the user closed the panel.
 *   3. **Screen curtain**: lift it. Leaving the curtain up after the panel
 *      closed strands the user staring at a black overlay with no UI to
 *      dismiss it. Only emitted when the curtain was actually on.
 *
 * Callers should also reset their per-tab curtain state to `false` after
 * dispatching, since the curtain is no longer on the page.
 */
export function planPanelDisconnectCleanup(opts: {
  tabId: number;
  curtainOn: boolean;
}): PlannedTabMessage[] {
  const out: PlannedTabMessage[] = [
    {
      tabId: opts.tabId,
      body: { type: "SET_OBSERVING", payload: { enabled: false } },
    },
    {
      tabId: opts.tabId,
      body: { type: "SET_FOCUS_TRACKER", payload: { enabled: false } },
    },
    { tabId: opts.tabId, body: { type: "CLEAR_HIGHLIGHT" } },
  ];

  if (opts.curtainOn) {
    out.push({
      tabId: opts.tabId,
      body: { type: "TOGGLE_CURTAIN", payload: { visible: false } },
    });
  }

  return out;
}
