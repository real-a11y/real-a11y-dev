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
 * Decide what the background should broadcast to one tab when the side panel
 * closes. Three things need teardown:
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

/**
 * Expand {@link planPanelDisconnectCleanup} across EVERY tab the panel drove,
 * not just the active one. The focus tracker is enabled on any tab whose
 * frames announce while the panel is connected, and the curtain is tracked per
 * tab — so on disconnect a background tab would otherwise keep its black
 * curtain (with no UI to lift it) and keep drawing focus overlays. `tabIds` is
 * the full set to clean (deduped); the curtain teardown is emitted only for
 * tabs in `curtainTabs`.
 */
export function planPanelDisconnectCleanupAllTabs(opts: {
  tabIds: Iterable<number>;
  curtainTabs: ReadonlySet<number>;
}): PlannedTabMessage[] {
  const seen = new Set<number>();
  const out: PlannedTabMessage[] = [];
  for (const tabId of opts.tabIds) {
    if (seen.has(tabId)) continue;
    seen.add(tabId);
    out.push(
      ...planPanelDisconnectCleanup({
        tabId,
        curtainOn: opts.curtainTabs.has(tabId),
      }),
    );
  }
  return out;
}

// ---- Message-sender trust boundary ----

/**
 * True only when a runtime message originated from THIS extension's own
 * contexts (the background, the side panel, or one of our content scripts).
 *
 * Chrome already scopes `chrome.runtime.onMessage` to the same extension, so
 * under current routing this check is effectively a no-op — `sender.id` is
 * always `chrome.runtime.id`. Its value is to make that trust boundary
 * explicit and self-documenting at each listener (the content-script handlers
 * dispatch clicks/keystrokes and read live field state) rather than silently
 * acting on whatever arrives.
 *
 * It does NOT cover an external surface: messages from other extensions or
 * from `externally_connectable` pages arrive on the separate
 * `onMessageExternal` / `onConnectExternal` listeners, never on the guarded
 * `onMessage`. Adding such a surface later would require its own guard there —
 * this one would never see those messages.
 *
 * `ownExtensionId` is `chrome.runtime.id` at the call site — taking it as an
 * argument (rather than reading `chrome` here) keeps this pure and
 * unit-testable without a Chrome mock. `Boolean(ownExtensionId)` guards the
 * `undefined === undefined` case so an unavailable id never reads as trusted.
 */
export function isTrustedSender(
  sender: { id?: string } | undefined,
  ownExtensionId: string | undefined,
): boolean {
  return Boolean(ownExtensionId) && sender?.id === ownExtensionId;
}

// ---- Side-panel inbound message filtering ----

/**
 * Message types whose payload carries a **frame-local** node id, and which the
 * background therefore re-sends with the id prefixed by its frame.
 *
 * A content script's `chrome.runtime.sendMessage` fans out to every extension
 * context, so each of these reaches the panel twice: once directly from the
 * frame (raw `sn-<n>`) and once relayed by the background (`f<frameId>-sn-<n>`).
 * Only the relayed copy is addressable in the merged tree — see
 * {@link shouldPanelAcceptMessage}.
 */
const BACKGROUND_RELAYED_TYPES: ReadonlySet<string> = new Set([
  "FOCUS_CHANGED",
  "NODE_PICKED",
]);

/**
 * Whether the side panel should act on an inbound runtime message.
 *
 * Two independent rules:
 *
 *   1. **Frame-scoped events must come via the background.** `FOCUS_CHANGED`
 *      and `NODE_PICKED` are sent by the content script with a frame-LOCAL
 *      node id, and the content script's `sendMessage` reaches the panel
 *      directly as well as the background. For a subframe event the direct
 *      copy's `sn-<n>` collides with a *different*, unrelated top-frame node
 *      in the merged tree: the panel selects it and force-expands its
 *      ancestors, and although the background's prefixed forward then corrects
 *      the selection, those expansions stay. Delivery order isn't guaranteed
 *      either way round, so both orders leave the stray expansions behind.
 *      Requiring the background's `tabId` stamp drops the direct copy — the
 *      same shape as the earlier `LIVE_REGION` fix, which no-opped the
 *      *forward* because there the direct copy is the correct one (its payload
 *      is text, not an id).
 *
 *   2. **Tab scoping.** Drop broadcasts belonging to another tab. Relayed
 *      messages carry an explicit `tabId`; content-direct ones (`LIVE_REGION`)
 *      carry theirs in `sender.tab.id`. With neither, accept — panel-internal
 *      and future message types have no tab to compare.
 *
 * `ACTIVE_TAB_CHANGED` is exempt from both: it is intentionally about a tab
 * other than ours, because it is how the panel LEARNS which tab it is bound to.
 *
 * Pure (no `chrome` access) so both rules are unit-tested directly rather than
 * living as inline conditions in the panel's message handler.
 */
export function shouldPanelAcceptMessage(opts: {
  type: string;
  /** `message.tabId` — stamped by the background on everything it relays. */
  messageTabId?: number;
  /** `sender.tab?.id` — set when a content script messaged the panel directly. */
  senderTabId?: number;
  /** The tab the panel is bound to; `null` before it has learned one. */
  myTabId: number | null;
}): boolean {
  if (opts.type === "ACTIVE_TAB_CHANGED") return true;

  if (
    BACKGROUND_RELAYED_TYPES.has(opts.type) &&
    opts.messageTabId === undefined
  ) {
    return false;
  }

  if (opts.myTabId === null) return true;

  const provenance = opts.messageTabId ?? opts.senderTabId;
  return provenance === undefined || provenance === opts.myTabId;
}

/**
 * How a `HIGHLIGHT_NODE` should be applied on the page.
 *
 * Hover is a **preview**: draw the overlay where the element already sits.
 * Only a selection (click / arrow key) may move the viewport or real focus.
 * Sharing one behaviour between the two meant a pointer sweeping down the tree
 * scroll-jumped the host page and fired its focus/blur handlers — flyouts,
 * validation — once per row it crossed.
 *
 * Pure so the distinction is an asserted contract rather than an inline
 * boolean a later edit could quietly collapse back into one behaviour.
 */
export function planHighlight(opts: { hover?: boolean }): {
  scroll: boolean;
  moveFocus: boolean;
} {
  return opts.hover
    ? { scroll: false, moveFocus: false }
    : { scroll: true, moveFocus: true };
}

/**
 * Tab a panel→content command should target.
 *
 * Prefer the panel-stamped `messageTabId` (the tab the panel is bound to)
 * over the background's `activeTabId`. After a tab switch,
 * `chrome.tabs.onActivated` updates `activeTabId` before the panel processes
 * `ACTIVE_TAB_CHANGED` and clears its tree — so routing actions by
 * `activeTabId` alone can fire DISPATCH_ACTION / SEND_KEY / CLOSE_TAB on the
 * newly active tab while the panel still shows the previous tab's nodes
 * (node ids are a per-frame counter, so `sn-3` resolves to an unrelated
 * element there).
 */
export function resolvePanelTargetTab(
  messageTabId: number | undefined,
  activeTabId: number | null,
): number | null {
  return messageTabId ?? activeTabId ?? null;
}

// ---- Panel→content broadcast delivery ----

/**
 * `error` on the reply to a panel→content broadcast that no frame received.
 *
 * One code covers the whole class the panel can act on: pages where a content
 * script cannot run at all (`chrome://`, the Web Store, the built-in PDF
 * viewer) and, transiently, a page whose content script has not loaded yet.
 * The panel treats both the same way — say the page is out of reach and offer
 * a retry — because from its side they are the same fact.
 */
export const RESTRICTED_PAGE_ERROR = "restricted-page";

export type BroadcastDelivery =
  { success: true } | { success: false; error: string };

/**
 * Chrome's `lastError` text for "the message was delivered to nobody".
 *
 * Matching on it is deliberate, and the alternative is worse: `lastError` on a
 * `tabs.sendMessage` also covers a tab that no longer exists ("No tab with
 * id: 42" — a queued re-extract landing after the user closed the tab), and
 * calling that a restricted page would tell the user Chrome forbids
 * extensions here when the page merely went away.
 */
const NO_RECEIVER_PATTERNS = [
  "Receiving end does not exist",
  "Could not establish connection",
];

/**
 * The panel's reply for a broadcast, decided from the `chrome.runtime.lastError`
 * visible inside the `tabs.sendMessage` callback.
 *
 * Delivery is only knowable there. Answering the panel synchronously — as this
 * did — reports success on every restricted page, and since the panel's only
 * other signal is a tree that then never arrives, it waits on "Connecting to
 * page..." indefinitely for what is a platform restriction, not a failure.
 */
export function describeBroadcastDelivery(
  lastError: { message?: string } | undefined,
): BroadcastDelivery {
  if (!lastError) return { success: true };
  const message = lastError.message ?? "";
  const noReceiver = NO_RECEIVER_PATTERNS.some((p) => message.includes(p));
  return {
    success: false,
    error: noReceiver ? RESTRICTED_PAGE_ERROR : message || "send failed",
  };
}

/**
 * True when a panel→content reply reports the page could not be reached.
 *
 * Undefined-safe on purpose: the reply is `undefined` when the MV3 service
 * worker was torn down before answering, which is not the same thing as the
 * page being unreachable and must not render as it.
 */
export function isUnreachablePageResponse(response: unknown): boolean {
  if (typeof response !== "object" || response === null) return false;
  const reply = response as { success?: unknown; error?: unknown };
  return reply.success === false && reply.error === RESTRICTED_PAGE_ERROR;
}
