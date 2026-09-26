/// <reference types="chrome" />

import type {
  ActionType,
  SemanticNode,
  DomSemanticNode,
  ExtractionResult,
  TreeViewMode,
  RoleFilter,
  ActionRequest,
} from "@real-a11y-dev/core";
import {
  getPrimaryAction,
  ACTION_LABELS,
  applySearchFilter,
  ROLE_FILTER_LABELS,
  buildControlsIndex,
} from "@real-a11y-dev/core";
import {
  useTreeKeyboard,
  useInputModality,
  useVirtualTree,
  useIndexById,
} from "@real-a11y-dev/semantic-navigator-ui";
import { useSearch } from "@real-a11y-dev/semantic-navigator-ui";
import {
  serializeTree,
  serializeOutline,
  serializeTabSequence,
  numberTabStops,
} from "@real-a11y-dev/serialize";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "preact/hooks";

import type { FieldState } from "../field-state.js";
import {
  blockedBy,
  explainUnavailable,
  type NativeUnavailableReason,
  type TabCapability,
} from "../native/capability.js";
import { isTypableRole, type NativeNode } from "../native/native-actions.js";
import {
  NATIVE_REDACTED_VALUE,
  type NativeAction,
} from "../native/native-core.js";
import { toExtractionResult as nativeToExtractionResult } from "../native/native-export.js";
import {
  isTrustedSender,
  isUnreachablePageResponse,
  shouldPanelAcceptMessage,
} from "../routing.js";
import type { ContentToPanel, PanelToContent } from "../types.js";

import { buildExportMarkdown, ALL_VIEWS, NATIVE_VIEWS } from "./export.js";
import type { ExportView } from "./export.js";
import { FilteredList } from "./FilteredList.js";
import {
  InputPanel,
  useFocusTrap,
  useRestoreFocusOnClose,
} from "./InputPanel.js";
import type { InputPanelState } from "./InputPanel.js";
import { NativeTreeView } from "./NativeTreeView.js";
import { TabSequenceView } from "./TabSequenceView.js";

/** How long to let the page react before re-reading the native tree after an
 *  action — same rationale and value as `DogfoodPanel.tsx`'s `SETTLE_MS`. */
const NATIVE_SETTLE_MS = 250;

/** Bound on how many additional navigations `recoverFromOwnNavigation` will
 *  wait out (a login page that immediately client-redirects to a dashboard,
 *  say) before giving up and leaving the recovery to a manual refresh. Caps
 *  the worst case at `MAX_NAV_RECOVERY_HOPS * NATIVE_SETTLE_MS` rather than
 *  waiting on a chain that never settles. */
const MAX_NAV_RECOVERY_HOPS = 5;

/** Bound on how long the native-as-default effect waits out a read already
 *  in flight (a manual toggle or refresh that raced it) before giving up on
 *  this connect and just going with whichever producer wins. Caps the worst
 *  case at `NATIVE_DEFAULT_BUSY_RETRIES * NATIVE_SETTLE_MS`. */
const NATIVE_DEFAULT_BUSY_RETRIES = 5;

/**
 * Map HTML tag names to a human-readable display role when the ARIA role
 * ("generic" / "group") doesn't convey enough semantic information.
 *
 * Elements that already have a descriptive ARIA role (heading, button, link,
 * checkbox, etc.) are NOT listed here — the ARIA role is already meaningful.
 *
 * We use the HTML tag name as the display label for elements whose ARIA role
 * is "generic" or "group" but whose tag carries real semantic meaning,
 * following the principle of showing only valid HTML names (no invented labels).
 */
const TAG_DISPLAY_OVERRIDES: Record<string, string> = {
  // Structural elements that map to "group" in ARIA
  details: "details",
  address: "address",
  hgroup: "hgroup",
  optgroup: "optgroup",
  // Structural wrapper that frames a self-contained piece of content
  iframe: "iframe",
  // Form grouping element (has its own name from <legend>)
  fieldset: "fieldset",
  // Inline/block elements that map to "generic" in ARIA
  // but carry meaningful HTML semantics worth surfacing
  pre: "pre",
  abbr: "abbr",
  kbd: "kbd",
  samp: "samp",
  q: "q",
  var: "var",
  data: "data",
  small: "small",
  b: "b",
  i: "i",
  u: "u",
  s: "s",
  figcaption: "figcaption",
  // Media / embedded content
  video: "video",
  audio: "audio",
  canvas: "canvas",
  picture: "picture",
};

/**
 * The panel only ever renders DOM-produced trees, so every node carries all
 * facets. Narrow a looked-up node to {@link DomSemanticNode} at read sites that
 * need `dom` / `interaction` / `ui` (the `nodes` Map itself stays
 * `SemanticNode`-typed so it can still be passed to core helpers).
 */
const asDom = (n: SemanticNode | undefined): DomSemanticNode | undefined =>
  n as DomSemanticNode | undefined;

/** Return the role label to display for a node in A11Y view */
function getDisplayRole(node: DomSemanticNode): string {
  const override = TAG_DISPLAY_OVERRIDES[node.dom.tagName];
  if (override) return override;
  return node.a11y.role;
}

/**
 * Narrow a chrome.runtime.sendMessage reply that reports `{ success: true }`.
 * The callback can receive `undefined` when chrome.runtime.lastError is set
 * (e.g. the MV3 service worker was torn down before responding) — never
 * dereference the reply without this (or equivalent) guard.
 */
function isSuccessResponse(response: unknown): response is { success: true } {
  return (
    typeof response === "object" &&
    response !== null &&
    "success" in response &&
    (response as { success: unknown }).success === true
  );
}

/** GET_FIELD_STATE success reply — same undefined-safe gate as isSuccessResponse. */
function isFieldStateSuccess(
  response: unknown,
): response is Extract<FieldState, { success: true }> {
  return isSuccessResponse(response);
}

/**
 * The one-time consent step before native mode's setting flips on. A separate
 * component (not inline JSX in App) so its own mount/unmount is what drives
 * `useFocusTrap`/`useRestoreFocusOnClose` — those hooks key off first-mount
 * effects, which only fires at the right moment when the banner itself is
 * what mounts and unmounts, not a `showNativeConsent` boolean toggling inside
 * an already-mounted `App`. Mirrors `InputPanel.tsx`'s `TextInput`/
 * `SelectPicker` shape for the identical reason.
 */
function NativeConsentBanner({
  onEnable,
  onCancel,
  error,
}: {
  onEnable: () => void;
  onCancel: () => void;
  /** Shown inline when a previous Enable attempt failed — the banner stays
   *  open on failure (see App's own `onEnable` handler), so this is the only
   *  place left to surface it; `nativeStatus` renders only inside
   *  `NativeTreeView`, which never mounts unless the flip already
   *  succeeded. */
  error?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const enableRef = useRef<HTMLButtonElement>(null);

  useRestoreFocusOnClose();
  useFocusTrap(dialogRef);

  useEffect(() => {
    enableRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [onCancel],
  );

  return (
    <div
      ref={dialogRef}
      class="sn-native-consent-banner"
      role="dialog"
      aria-modal="true"
      aria-label="Enable native mode"
    >
      <p>
        <strong>Native mode</strong> reads Chromium's own accessibility tree
        over the <code>debugger</code> API — full fidelity, including UA-shadow
        content the DOM producer can't see. While it's attached, Chrome shows
        its own "is debugging this browser" notice.
      </p>
      {error && (
        <p class="sn-native-consent-error" role="alert">
          {error}
        </p>
      )}
      <div class="sn-native-consent-actions">
        <button
          ref={enableRef}
          class="sn-toolbar-btn"
          onClick={onEnable}
          onKeyDown={handleKeyDown}
        >
          Enable
        </button>
        <button
          class="sn-toolbar-btn"
          onClick={onCancel}
          onKeyDown={handleKeyDown}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function App() {
  const [viewMode, setViewMode] = useState<TreeViewMode>("a11y");
  // Read by `sendTreeRequest` instead of closing over `viewMode`, so that
  // callback — and `requestTree`/`reExtract`/`handleActivate` built on it —
  // keeps a stable identity when the mode changes. It is a dependency of the
  // tab-change effect below, whose teardown belongs to tab switches alone: a
  // view-mode toggle that re-ran it wiped the tree, the selection and the
  // scope and dropped the panel to "Connecting to page..." until the
  // re-extraction landed. A ref rather than a dependency because the mode is
  // an input to a request, never a reason to re-send one — SET_VIEW_MODE
  // already makes the content script re-extract.
  const viewModeRef = useRef<TreeViewMode>(viewMode);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);
  const [nodes, setNodes] = useState<Map<string, SemanticNode>>(new Map());
  const [rootId, setRootId] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renderCount, forceRender] = useState(0);
  const [connected, setConnected] = useState(false);
  // The last REQUEST_TREE came back saying no content script could receive it.
  // Distinct from `!connected`: that is "no tree yet", which on a restricted
  // page never resolves, and rendering the two the same is what left the panel
  // saying "Connecting to page..." forever on chrome:// and the PDF viewer.
  const [pageUnreachable, setPageUnreachable] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  // One pending clear for the whole action-feedback bar, because there is one
  // bar. Each caller used to arm its own untracked timer, so the FIRST to fire
  // blanked whatever the LATEST caller had just put there — a 2s "Click: Save"
  // wiping a 3s "Failed: …" raised a second later. See `announce`.
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(null);
  const [curtainOn, setCurtainOn] = useState(false);
  const [focusTrackerOn, setFocusTrackerOn] = useState(true);
  // Export dropdown ("Copy" → pick which view(s) to put on the clipboard).
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  // Picker mode (DevTools-style "select an element in the page"). Off by
  // default; toggled by the toolbar button or Ctrl/Cmd+Shift+C. The
  // content script owns the actual click capture — this flag is just the
  // panel's mirror so the button shows the right pressed state.
  const [pickModeOn, setPickModeOn] = useState(false);
  // Latest `pickModeOn` for the native-pick tab-switch cleanup effect below,
  // which must not re-arm just because a pick's own ordinary completion
  // flips this state — see that effect's own comment for why it reads this
  // via ref instead of depending on the state directly.
  const pickModeOnRef = useRef(pickModeOn);
  useEffect(() => {
    pickModeOnRef.current = pickModeOn;
  }, [pickModeOn]);
  const [inputState, setInputState] = useState<InputPanelState | null>(null);
  const [pageTitle, setPageTitle] = useState<string>("");
  const [pageUrl, setPageUrl] = useState<string>("");
  const [scopedRootId, setScopedRootId] = useState<string | null>(null);
  const [liveAnnouncements, setLiveAnnouncements] = useState<
    Array<{ id: number; text: string; level: string; role: string }>
  >([]);
  const announcementId = useRef(0);

  // ---- Native producer (RFC PR H/#229) ----
  // The capability ships in every build (see background.ts), but stays off
  // until the user turns on this setting — a real `chrome.storage`-backed
  // flag now, not a build-time one. Fetched once on mount via the same
  // NATIVE_FLAG_GET message DogfoodPanel.tsx already used for its own
  // checkbox; NATIVE_FLAG_SET flips it (see setNativeModeEnabled below).
  const [nativeModeEnabled, setNativeModeEnabledState] = useState(false);
  // Shown in place of the producer toggle the first time a user reaches for
  // NATIVE while the setting is still off — explains the debugger banner
  // before anything attaches, rather than surprising them with it. Dismissed
  // by either button; never shown again once the setting is on.
  const [showNativeConsent, setShowNativeConsent] = useState(false);
  // Set only when an Enable attempt actually fails (the message never
  // reached the service worker, or its handler replied with a logical
  // failure) — cleared on every fresh attempt so a stale error never
  // outlives the retry it was about.
  const [nativeConsentError, setNativeConsentError] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    void chrome.runtime
      .sendMessage({ type: "NATIVE_FLAG_GET" })
      .then((r: { enabled?: boolean }) =>
        setNativeModeEnabledState(r?.enabled === true),
      )
      .catch(() => {
        // Service worker not woken yet / context torn down mid-reload —
        // leave the setting at its default (off); the toggle just stays
        // available to try again.
      });
  }, []);

  /** Flips the persisted setting. Turning it off also drops any live
   *  attachment (mirrors DogfoodPanel's own `toggle`) and returns the view to
   *  DOM — leaving `producer` at "native" with the capability just revoked
   *  would strand the panel on a tree it can no longer refresh.
   *
   *  Returns whether the flip actually took: callers that follow success
   *  with another state change (the consent banner's own `onEnable` flips
   *  `producer` to "native" right after) need that signal, not just a
   *  resolved promise — `NATIVE_FLAG_SET`'s own handler (`native/index.ts`)
   *  replies `{ok: false, ...}` from its outer catch on an internal failure
   *  WITHOUT rejecting the message, so "the promise resolved" alone doesn't
   *  mean the setting was persisted. */
  const setNativeMode = useCallback(async (next: boolean): Promise<boolean> => {
    let r: { enabled?: boolean; ok?: boolean } | undefined;
    try {
      r = await chrome.runtime.sendMessage({
        type: "NATIVE_FLAG_SET",
        enabled: next,
      });
    } catch {
      // Message never reached the service worker — nothing was persisted,
      // so leave the UI as it was rather than claiming a flip that didn't
      // happen.
      return false;
    }
    // A resolved reply can still be a logical failure — `native/index.ts`'s
    // outer catch replies `{ok: false, error: "native mode error"}` rather
    // than rejecting, so `enabled` (only present on the success path) is
    // what actually distinguishes the two, not just "did the promise
    // resolve".
    if (r?.enabled !== next) return false;
    setNativeModeEnabledState(next);
    setShowNativeConsent(false);
    if (!next) {
      // Same teardown the myTabId effect and PAGE_NAVIGATED both do on
      // their own producer-invalidating transitions, for the identical
      // reason: bumping `nativeOpToken` is what makes a NATIVE_READ/
      // NATIVE_ACT already in flight when the user disables native mode
      // recognizably stale to every guard in this file (`if (token !==
      // nativeOpToken.current) return`) — without it, a later re-enable
      // could start a fresh read under the SAME token, and whichever of
      // the two replies resolves last would win, clobbering a current read
      // with a stale one (or vice versa). Clearing `nativeBusy` here is
      // what unsticks it: that stale reply's own `finally` only clears it
      // when its token still matches, which a bump here now guarantees it
      // won't. `tabChangeToken` bumps too — disabling mid-recovery has to
      // abort `recoverFromOwnNavigation`'s own settle loop the same way a
      // real tab switch does, or that loop would keep waiting and
      // eventually re-read (a `NATIVE_READ` the disabled flag would refuse
      // server-side, but the reply would still land and overwrite
      // `nativeStatus`/`nativeCapability` with a refusal for a producer the
      // panel has already left).
      nativeOpToken.current++;
      tabChangeToken.current++;
      setNativeBusy(false);
      setProducer("dom");
      setNativeNodes(new Map());
      setNativeRootId("");
      setNativeCapability(undefined);
      setNativeStatus("");
      // If a native pick was armed, the background's own NATIVE_FLAG_SET
      // handler cancels it server-side, but that cancellation's own
      // NATIVE_PICK_RESULT is a separate, later message — and by the time
      // it arrives `producerRef.current` has already flipped to "dom" here,
      // so the message handler's `producerRef.current === "native"` guard
      // (it must not clear a pick that's since been re-armed under a
      // different producer) silently drops the reset. Clear it directly
      // instead of waiting on a message that can no longer land.
      setPickModeOn(false);
    }
    return true;
  }, []);

  // Which tree the panel is currently showing. Only ever leaves "dom" when
  // `nativeModeEnabled` is true — the toggle that flips it is itself gated on
  // that setting below.
  const [producer, setProducer] = useState<"dom" | "native">("dom");
  // Latest `producer` for use inside the long-lived onMessage listener,
  // which closes over the value at registration time — same pattern as
  // `myTabIdRef` below. Needed because a producer switch sends the OLD
  // producer's picker an async disable (`switchProducer`'s own
  // `togglePickMode()` call) whose acknowledgement can arrive after the
  // switch — a late DOM `PICK_MODE_CHANGED` must not clear a native pick
  // that's since been armed, and the mirror case (a late `NATIVE_PICK_
  // RESULT`) must not clear a DOM one.
  const producerRef = useRef<"dom" | "native">(producer);
  useEffect(() => {
    producerRef.current = producer;
  }, [producer]);
  const [nativeNodes, setNativeNodes] = useState<Map<string, NativeNode>>(
    new Map(),
  );
  const [nativeRootId, setNativeRootId] = useState<string>("");
  const [nativeStatus, setNativeStatus] = useState<string>("");
  const [nativeBusy, setNativeBusy] = useState(false);
  const [nativeCapability, setNativeCapability] = useState<
    TabCapability | undefined
  >(undefined);
  // The tab/document the CURRENT native tree describes — native node ids
  // encode Chromium `backendDOMNodeId`s, scoped to that document, so acting
  // against a stale pair would click an unrelated element. Same staleness
  // guard `DogfoodPanel.tsx` uses, adapted to App's own tab-binding.
  const [nativeTreeTabId, setNativeTreeTabId] = useState<number | undefined>(
    undefined,
  );
  const [nativeTreeUrl, setNativeTreeUrl] = useState<string | undefined>(
    undefined,
  );
  // Native picker's counterpart to `requestReveal`/DOM's `selectedId` +
  // ancestor-expand dance above — NativeTreeView owns its own expand/select
  // state (see that component's own top comment), so the panel can't reach
  // in and set it directly the way it does for the DOM tree. Passed down as
  // a `reveal` prop instead; `nonce` forces the child's effect to re-fire
  // even when the same node is picked twice in a row.
  const [nativePickReveal, setNativePickReveal] = useState<
    { nodeId: string; ancestorIds?: string[]; nonce: number } | undefined
  >(undefined);
  // `nativeOpToken.current` at the moment the in-flight pick was armed —
  // compared against its CURRENT value when NATIVE_PICK_RESULT arrives, same
  // pattern `dispatchNativeAction`/`loadNativeTree` already use for a
  // read/act reply. A pick can take arbitrarily long (it waits on a page
  // click), so a tab switch, navigation, or disabling native mode can all
  // land while one is outstanding; without this, a result that arrives after
  // any of those applies stale `backendDOMNodeId`-derived ids to whatever
  // tree the panel has loaded by then. Chromium's backend node ids are
  // small, renderer-scoped integers that a new document can plausibly reuse
  // — this is a real collision risk, not just a defensive habit.
  const nativePickToken = useRef<number | null>(null);
  // Monotonic id for the CURRENTLY ARMED pick, bumped on every arm — a
  // second, independent staleness check from `nativePickToken` above. That
  // one guards against a tab switch/navigation/disable landing mid-pick;
  // this one guards the narrower case neither it nor `nativeOpToken`
  // catches at all: a STOP immediately followed by a new START on the SAME
  // tab, same document. Nothing about the tab or document moved, so every
  // other staleness token stays put, yet the STOP's own pick can still
  // deliver its result (a cancellation, or a click that resolved just
  // before the STOP reached the background) after the new pick has already
  // armed. Comparing this against the result's own echoed `requestId` is
  // what tells that late arrival apart from the pick actually in flight.
  const nativePickRequestId = useRef(0);
  // Bumped whenever the bound tab changes (see the myTabId effect below).
  // Read-gates a NATIVE_READ/NATIVE_CAPABILITY reply against a tab switch
  // that happened while it was in flight — same purpose as DogfoodPanel's
  // `capabilityRequest`, one counter shared across both message types since
  // both answer "does this reply still describe the tab we're looking at".
  const nativeOpToken = useRef(0);
  // Bumped by the myTabId effect below and by `setNativeMode` turning
  // native mode off — NEVER by PAGE_NAVIGATED. A snapshot of this taken
  // before a native op, compared after, tells apart "something that isn't
  // this action's own navigation invalidated it" from "nativeOpToken moved
  // only because PAGE_NAVIGATED fired for the navigation this action
  // itself caused", which `myTabId` equality alone cannot: a rapid tab
  // switch away and back leaves `myTabId` (and a ref mirroring it) reading
  // the same tab id again even though the effect fired twice and cleared
  // the tree — see `dispatchNativeAction`'s own recovery path for why that
  // distinction matters.
  const tabChangeToken = useRef(0);
  // Excludes a second native read/act from starting while one is already in
  // flight. Has to be a ref, not state driving a `disabled` attribute alone:
  // `setNativeBusy(true)` only lands after the first `await` inside the
  // guarded functions below, so two fast clicks (or a click plus a keyboard
  // Enter) both read this as false before either sets it — the same double-
  // dispatch DogfoodPanel's own `inFlight` ref exists to prevent, and for the
  // identical reason (see its own comment). ALWAYS cleared unconditionally in
  // a `finally`, never token-gated like `nativeBusy` below: unlike that
  // display flag, a stale token here must not leave this permanently stuck
  // true, or no native action could ever dispatch again.
  const nativeInFlight = useRef(false);
  // Auto-load the native tree once per transition into native mode (mirrors
  // the DOM producer's own `hasRequestedInitial` restraint below — a later
  // tab switch while already in native mode clears the tree and waits for an
  // explicit refresh rather than re-attaching automatically).
  const hasAutoLoadedNative = useRef(false);
  // RFC PR H's "native as default on attachable pages" (execution plan PR 5):
  // fires exactly ONCE per panel session, the first time the DOM producer
  // connects while the user already has native mode enabled — never again
  // after that, on purpose. This is deliberately narrower than "default on
  // every attachable page": re-checking on every later tab switch or
  // navigation would re-open exactly the silent-reattach hole
  // `hasAutoLoadedNative`'s own comment above describes fixing (the debugger
  // banner reappearing with no fresh user gesture). A session's first connect
  // is the one moment a default can stand in for that gesture — the user
  // opened the panel on an already-opted-in browser; every subsequent tab or
  // page is a fresh moment that still asks for one.
  const hasAppliedNativeDefault = useRef(false);

  const treeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const { query, matchCount, updateQuery, updateMatchCount } = useSearch();

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  // aria-controls cross-link index (trigger ↔ controlled element). Used to
  // render clickable jump chips on disclosure pairs (button ↔ menu, tab ↔
  // panel, etc.) so the relationship is reachable without scroll-hunting.
  const controlsIndex = useMemo(() => buildControlsIndex(nodes), [nodes]);

  // Tree-node id currently flashing after a cross-link jump. Cleared by a
  // timeout so the flash plays once.
  const [flashingId, setFlashingId] = useState<string | null>(null);

  // Explicit "reveal this row" requests from jump / pick / focus / go-to-tree
  // flows. These must scroll the target into view even when it is already the
  // selection (so the selectedId-keyed effect wouldn't re-run). Bumping the
  // nonce triggers the reveal effect below; the target is stashed in a ref and
  // resolved against the post-expansion visible list. `requestReveal` keeps a
  // stable identity so callbacks defined here can depend on it safely.
  const [revealNonce, setRevealNonce] = useState(0);
  const revealTargetRef = useRef<string | null>(null);
  const requestReveal = useCallback((id: string) => {
    revealTargetRef.current = id;
    setRevealNonce((n) => n + 1);
  }, []);

  const handleJumpToNode = useCallback(
    (targetId: string) => {
      // Expand every collapsed ancestor so the target is in `visibleNodeIds`
      // before we try to scroll to it.
      let cur: DomSemanticNode | undefined = asDom(nodes.get(targetId));
      let mutated = false;
      while (cur && cur.parentId) {
        const parent = asDom(nodes.get(cur.parentId));
        if (parent && !parent.ui.expanded) {
          parent.ui.expanded = true;
          mutated = true;
        }
        cur = parent;
      }
      if (mutated) forceRender((c) => c + 1);
      setSelectedId(targetId);
      setFlashingId(targetId);
      setTimeout(() => setFlashingId(null), 700);
      // Reveal the row even if it is already the selection (jump chips can
      // target the current node); the reveal effect scrolls once ancestors
      // are expanded and `visibleNodeIds` recomputed.
      requestReveal(targetId);
    },
    [nodes, requestReveal],
  );

  // The tab this side-panel instance is bound to. Source of truth lives in
  // the background — it pushes ACTIVE_TAB_CHANGED on port connect and on
  // every tab/window activation. We don't try to read tab state from the
  // panel context directly because `chrome.tabs.onActivated` doesn't
  // reliably fire here (the manifest doesn't request the `"tabs"`
  // permission, and the side-panel context's event delivery has been
  // historically quirky regardless).
  const [myTabId, setMyTabId] = useState<number | null>(null);
  // Latest myTabId for use inside the long-lived onMessage listener,
  // which closes over the value at registration time.
  const myTabIdRef = useRef<number | null>(null);
  useEffect(() => {
    myTabIdRef.current = myTabId;
  }, [myTabId]);

  /**
   * Put a line in the action-feedback bar for `ms`, then clear it.
   *
   * Every caller goes through here so the bar has exactly one pending clear:
   * arming a new message cancels the old timer, which is what stops an
   * earlier, shorter-lived message from blanking a later one mid-display.
   */
  const announce = useCallback((text: string, ms: number) => {
    if (feedbackTimer.current !== undefined) {
      clearTimeout(feedbackTimer.current);
    }
    setLastAction(text);
    feedbackTimer.current = setTimeout(() => {
      feedbackTimer.current = undefined;
      setLastAction(null);
    }, ms);
  }, []);

  // Don't leave a clear pending on a panel that is going away.
  useEffect(
    () => () => {
      if (feedbackTimer.current !== undefined) {
        clearTimeout(feedbackTimer.current);
      }
    },
    [],
  );

  // Stamp every panel→content command with the tab this panel instance is
  // bound to. The background prefers that over its global `activeTabId`,
  // which races `chrome.tabs.onActivated` after a tab switch — without the
  // stamp, DISPATCH_ACTION / SEND_KEY / HIGHLIGHT_NODE can hit the newly
  // active tab while this panel still shows (or is clearing) the previous
  // tab's tree.
  const sendToBoundTab = useCallback(
    (
      message: PanelToContent,
      responseCallback?: (response: unknown) => void,
    ) => {
      const stamped: PanelToContent = {
        ...message,
        tabId: myTabIdRef.current ?? undefined,
      };
      if (responseCallback) {
        chrome.runtime.sendMessage(stamped, responseCallback);
      } else {
        chrome.runtime.sendMessage(stamped);
      }
    },
    [],
  );

  /**
   * Leave pick mode across the whole tab.
   *
   * A picker only ever disables itself in ITS OWN document — on a tracked
   * click, on a click that hit nothing tracked, and on Escape — so the other
   * frames stay armed and keep swallowing pointer events while the panel's
   * per-tab ⦿ already reads off, leaving no enabled control to switch them
   * back. Broadcasting converges them.
   *
   * Deliberately unconditional rather than guarded on the panel's own mirror
   * of the mode. The frames this has to reach are exactly the ones the mirror
   * can be wrong about, so a guard would skip the broadcast in the case it
   * exists for. It terminates on its own instead: `setEnabled` is idempotent
   * and only reports a real transition, so the frames disarmed by one
   * broadcast answer with a PICK_MODE_CHANGED that provokes at most one more,
   * and that one silences everybody.
   */
  const exitPickMode = useCallback(() => {
    setPickModeOn(false);
    sendToBoundTab({ type: "SET_PICK_MODE", payload: { enabled: false } });
  }, [sendToBoundTab]);

  // Every REQUEST_TREE goes through here so its reply is always read. The
  // background can only tell whether a page is reachable from inside its
  // `tabs.sendMessage` callback, and that reply is the panel's ONLY signal for
  // a page where no content script can run: no tree ever arrives, which is
  // indistinguishable from one still on its way.
  //
  // `applyVerdict` is what separates the two callers, and it is not a
  // refinement — an unreachable reply does NOT mean "restricted page" on its
  // own. The content script is injected at `document_idle`, so between a new
  // document committing and the script loading the tab has no receiver and
  // Chrome reports the very same "receiving end does not exist". The
  // automatic re-extracts below fire 100-300ms after an action that commonly
  // navigates, which lands squarely in that gap — acting on their verdict
  // would blank an ordinary page's tree and accuse Chrome of forbidding it.
  // Only a request the user made (opening the panel, ↻, Load tree / Try
  // again) is allowed to move that state, because only there does the answer
  // describe a page they are looking at and waiting on.
  const sendTreeRequest = useCallback(
    (applyVerdict: boolean) => {
      sendToBoundTab(
        { type: "REQUEST_TREE", payload: { viewMode: viewModeRef.current } },
        (response: unknown) => {
          // Read lastError even though the reply carries the verdict: an
          // unread one logs "Unchecked runtime.lastError" to the panel
          // console on every MV3 worker teardown. `response` is `undefined`
          // in exactly that case, which is not a restricted page and must not
          // render as one — hence the undefined-safe gate rather than a
          // truthiness test.
          void chrome.runtime.lastError;
          if (!applyVerdict) return;
          const unreachable = isUnreachablePageResponse(response);
          setPageUnreachable(unreachable);
          // A page nothing can be delivered to is not one we are attached to.
          // Without this the restricted screen — which lives behind
          // `!connected` — stays unreachable after a SAME-TAB navigation to a
          // PDF or the Web Store: no tab switch fires, so `connected` is
          // still true and the panel keeps rendering the previous page's tree.
          if (unreachable) setConnected(false);
        },
      );
    },
    [sendToBoundTab],
  );

  /** The user asked for the tree. Its answer decides what they are shown. */
  const requestTree = useCallback(
    () => sendTreeRequest(true),
    [sendTreeRequest],
  );

  /**
   * Follow-up extraction after an action, to pick up the state it changed.
   * Nobody is waiting on it, and it races page navigation by construction, so
   * an unreachable reply here is ignored — the next `TREE_DATA` is the answer.
   */
  const reExtract = useCallback(
    () => sendTreeRequest(false),
    [sendTreeRequest],
  );

  // First time we learn our tab: auto-fetch the tree so the panel
  // populates on open. On subsequent tab changes we deliberately do NOT
  // auto-fetch — too many edge cases made it unreliable (restricted
  // pages with no content script, lazy-injected content scripts that
  // aren't ready, races between the panel learning about the tab change
  // and the content script being reachable). Instead we clear the stale
  // tree so the user sees the empty state, and they hit the refresh
  // button to load the new tab's tree explicitly.
  //
  // Only `myTabId` may re-run this. `requestTree` is in the deps as well but
  // is identity-stable by construction (see `viewModeRef`) — the teardown
  // below describes leaving a tab, and nothing else is allowed to trigger it.
  const hasRequestedInitial = useRef(false);
  useEffect(() => {
    if (myTabId === null) return;
    // A new bound tab invalidates any native tree in hand the same way it
    // invalidates the DOM one below — native ids are scoped to the document
    // they were read from. Bumping the token here (rather than only on an
    // explicit native reload) is what makes a reply from the tab just left
    // recognizably stale to the guards in loadNativeTree/dispatchNativeAction
    // — and, since that guard is what leaves `nativeBusy` set on a stale
    // reply (see loadNativeTree/dispatchNativeAction's own comments), this is
    // also the one place responsible for clearing it back to false: nothing
    // else is coming to do it for an operation this tab change just orphaned.
    nativeOpToken.current++;
    tabChangeToken.current++;
    setNativeNodes(new Map());
    setNativeRootId("");
    setNativeTreeTabId(undefined);
    setNativeTreeUrl(undefined);
    setNativeStatus("");
    setNativeCapability(undefined);
    setNativeBusy(false);
    // Deliberately NOT resetting hasAutoLoadedNative here — this effect fires
    // on EVERY tab change, including a plain tab switch while already in
    // native mode, and resetting it here would immediately re-trigger the
    // auto-load effect below on the new tab, silently re-attaching
    // chrome.debugger with no user action. That flag only re-arms when the
    // user actually leaves and re-enters native mode (see the producer effect
    // right below the auto-load effect).

    if (!hasRequestedInitial.current) {
      hasRequestedInitial.current = true;
      requestTree();
      return;
    }
    setNodes(new Map());
    setRootId("");
    setSelectedId(null);
    setScopedRootId(null);
    setConnected(false);
    // The verdict belonged to the tab we just left; the new one is unknown
    // until it is asked.
    setPageUnreachable(false);
    setPageTitle("");
    setPageUrl("");
  }, [myTabId, requestTree]);

  // Keep a port alive so the background knows when the side panel closes.
  // On disconnect the background clears the highlight overlay AND disables
  // the focus tracker across every frame. On mount we push the panel's
  // current focus-tracker state to the content script — the tracker starts
  // OFF in content.ts, so this first SET_FOCUS_TRACKER is what turns it on.
  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    const connect = () => {
      port = chrome.runtime.connect({ name: "sidepanel" });
      // Push the panel's focus-tracker state on (re)connect — the tracker
      // starts OFF in content.ts, so this is what turns it on.
      sendToBoundTab({
        type: "SET_FOCUS_TRACKER",
        payload: { enabled: focusTrackerOn },
      });
      port.onDisconnect.addListener(() => {
        // The MV3 service worker was torn down (its port drops while the panel
        // is still open). Reconnect to revive it and re-run the background's
        // onConnect, which re-broadcasts SET_OBSERVING(true) so extraction
        // resumes rather than silently stopping.
        connect();
      });
    };
    connect();
    return () => port?.disconnect();
    // Intentionally empty deps: toggleFocusTracker handles subsequent changes;
    // this effect owns the port lifecycle + the service-worker-death reconnect.
    // sendToBoundTab is stable (empty deps); focusTrackerOn is the mount value.
  }, []);

  // Listen for tree data and focus changes from content script
  useEffect(() => {
    const handler = (
      message: ContentToPanel,
      sender: chrome.runtime.MessageSender,
    ) => {
      // Only accept messages from our own extension's contexts (background,
      // content scripts). Same-extension scoping already holds; this makes
      // the trust boundary explicit before we mutate panel state.
      if (!isTrustedSender(sender, chrome.runtime.id)) return;

      // Drop broadcasts for another tab, and drop the content script's
      // direct copy of the frame-scoped events (it carries a frame-local
      // node id that collides with the top frame's). Rules are in
      // routing.ts — unit-tested there.
      if (
        !shouldPanelAcceptMessage({
          type: message.type,
          messageTabId: (message as { tabId?: number }).tabId,
          senderTabId: sender.tab?.id,
          myTabId: myTabIdRef.current,
        })
      ) {
        return;
      }

      if (message.type === "ACTIVE_TAB_CHANGED") {
        setMyTabId(message.tabId);
        return;
      }

      // The document under us is leaving. Drop the tree rather than keep
      // showing one that describes a page the user has left: node ids are a
      // per-frame counter, so its rows resolve to unrelated elements on the
      // new page, and every row stays clickable. On an ordinary page the new
      // content script announces within moments and this empty state is a
      // blink; on one that cannot run a content script — the Web Store, a
      // PDF, a chrome:// page — nothing announces, and Load tree is then the
      // honest answer instead of a tree that quietly lies.
      if (message.type === "PAGE_NAVIGATED") {
        setNodes(new Map());
        setRootId("");
        setSelectedId(null);
        setScopedRootId(null);
        setConnected(false);
        // The old page's verdict says nothing about the new one.
        setPageUnreachable(false);
        setPageTitle("");
        setPageUrl("");
        // A navigation replaces the document, and with it every
        // backendDOMNodeId a native tree's ids are built from — see the
        // myTabId effect's identical teardown (including why hasAutoLoadedNative
        // is deliberately NOT reset here) for why this has to happen here too,
        // not just on a tab switch. Same reason for clearing nativeBusy: a
        // NATIVE_READ/NATIVE_ACT in flight when the page navigates has its
        // token orphaned by the bump above, so nothing else is coming to
        // clear the busy flag its own finally block intentionally left set.
        nativeOpToken.current++;
        setNativeNodes(new Map());
        setNativeRootId("");
        setNativeTreeTabId(undefined);
        setNativeTreeUrl(undefined);
        setNativeStatus("");
        setNativeCapability(undefined);
        setNativeBusy(false);
        return;
      }

      if (message.type === "TREE_DATA" || message.type === "TREE_UPDATED") {
        const nodeMap = new Map<string, SemanticNode>(message.payload.nodes);

        // Preserve user's expand/collapse state from previous tree
        setNodes((prev) => {
          for (const [id, node] of nodeMap.entries() as IterableIterator<
            [string, DomSemanticNode]
          >) {
            const prevNode = asDom(prev.get(id));
            if (prevNode) {
              node.ui.expanded = prevNode.ui.expanded;
              node.ui.selected = prevNode.ui.selected;
            }
          }
          return nodeMap;
        });

        setRootId(message.payload.rootId);
        setConnected(true);
        // A tree is proof of reach, whoever asked for it — a live update from
        // a frame that loaded late clears the verdict as well as a retry does.
        setPageUnreachable(false);
        // Reset scope if scoped node no longer exists in tree
        setScopedRootId((prev) => (prev && !nodeMap.has(prev) ? null : prev));
        // Same for the selection, and for the same reason. A selection that
        // survives into a tree without it is worse than none: no row carries
        // `aria-selected`, `aria-activedescendant` points at nothing, and
        // `useTreeKeyboard` can't find an index to move from — so every key
        // is dead until the user clicks a row. It goes stale exactly where
        // the two views disagree, which is where switching them is useful:
        // a generic wrapper picked in DOM view is pruned from the a11y tree.
        setSelectedId((prev) => (prev && !nodeMap.has(prev) ? null : prev));
        if (message.type === "TREE_DATA" && "pageTitle" in message.payload) {
          setPageTitle(message.payload.pageTitle || "");
          setPageUrl(message.payload.pageUrl || "");
        }
      }

      if (message.type === "LIVE_REGION") {
        const id = ++announcementId.current;
        const entry = { id, ...message.payload };
        setLiveAnnouncements((prev) => [...prev.slice(-4), entry]);
        // Auto-remove after 8 seconds
        setTimeout(() => {
          setLiveAnnouncements((prev) => prev.filter((a) => a.id !== id));
        }, 8000);
      }

      if (message.type === "FOCUS_CHANGED") {
        const nodeId = message.payload.nodeId;
        setSelectedId(nodeId);

        // Expand ancestors so the node is visible
        setNodes((prev) => {
          let current = asDom(prev.get(nodeId));
          while (current?.parentId) {
            const parent = asDom(prev.get(current.parentId));
            if (parent && !parent.ui.expanded) {
              parent.ui.expanded = true;
            }
            current = parent;
          }
          return prev;
        });
        forceRender((n) => n + 1);
        // Reveal even if the focused node is already the selection (re-focusing
        // the current node after scrolling away should still bring it back).
        requestReveal(nodeId);
      }

      if (message.type === "NODE_PICKED") {
        // User picked an element on the page via the picker. Select the
        // matching tree node, expand ancestors so it's visible, scroll it
        // into view, and turn pick mode off in our local mirror (content
        // already exited on its side after the click).
        const nodeId = message.payload.nodeId;
        setSelectedId(nodeId);
        // Content already exited on its side after the click — but only in
        // the frame that resolved it, so this takes the rest of the tab with
        // it. The PICK_MODE_CHANGED that follows this same click is then a
        // no-op, as are the ones the other frames send back.
        exitPickMode();
        setNodes((prev) => {
          let current = asDom(prev.get(nodeId));
          while (current?.parentId) {
            const parent = asDom(prev.get(current.parentId));
            if (parent && !parent.ui.expanded) {
              parent.ui.expanded = true;
            }
            current = parent;
          }
          return prev;
        });
        forceRender((n) => n + 1);
        // Reveal even if the picked node is already the selection.
        requestReveal(nodeId);
      }

      if (message.type === "PICK_MODE_CHANGED") {
        // Content authoritatively reports its own pick-mode state. This
        // covers the case where the user pressed Escape on the page to
        // exit — without it the panel button would stay stuck "on". Gated
        // on the producer STILL being "dom": `switchProducer` sends the
        // content script an async disable when leaving DOM with a pick
        // armed, and that acknowledgement can arrive after the panel has
        // already switched to native and armed a pick there — an
        // unconditional apply would clear the (still-live) native pick's
        // "on" indicator for an ack that belongs to a producer nobody is
        // looking at anymore.
        //
        // A frame reporting itself OFF is reporting only for itself, and
        // Escape (like a click that hit nothing tracked) sends no
        // NODE_PICKED, so this is the only notice the panel gets that a
        // picker somewhere has closed. Take the rest of the tab with it.
        if (producerRef.current === "dom") {
          if (message.payload.enabled) setPickModeOn(true);
          else exitPickMode();
        }
      }

      if (message.type === "NATIVE_PICK_RESULT") {
        // Background's reply to NATIVE_PICK_START, for any of three
        // outcomes: a click resolved to a node, the pick was cancelled
        // (Escape, tab switch, disabling native mode — see the cleanup
        // effect below), or the attach/dispatch itself failed (DevTools
        // already attached, an unattachable navigation mid-arm, a
        // connection drop).
        //
        // A STOP immediately followed by a new START on the same tab moves
        // neither `nativeOpToken` nor `nativePickToken` — nothing about the
        // tab or document changed — so the STOP's own now-cancelled pick
        // can still deliver its result after the new one has armed. Applied
        // unchecked, its "cancelled" would turn the NEW pick's indicator
        // off while it's still armed and consuming clicks, or its "picked"
        // would reveal the OLD pick's node under the new one's name. Check
        // this before anything else below reads the result, including the
        // indicator clear.
        if (message.requestId !== nativePickRequestId.current) return;
        // Pick mode is inherently one-shot server-side (`runPick` always
        // resolves and turns Overlay.setInspectMode back off), so the local
        // mirror comes off here whenever the producer is still native — the
        // mirror image of the `PICK_MODE_CHANGED` guard above: a result
        // that outlives a switch back to DOM must not clear a pick the DOM
        // producer has since armed.
        if (producerRef.current === "native") setPickModeOn(false);
        // Everything past this point describes a SPECIFIC document (a
        // picked node's backendDOMNodeId, or a capability tied to the tab
        // that was current when the pick was armed) — gate it against
        // `nativePickToken`, the same "does this reply still describe what
        // we're looking at" check every other native reply already makes.
        // Chromium's backend node ids are small enough that a new document
        // reusing one and landing on the WRONG row is a real risk, not a
        // theoretical one.
        if (nativePickToken.current !== nativeOpToken.current) return;
        if ("nodeId" in message.payload) {
          setNativePickReveal({
            nodeId: message.payload.nodeId,
            ancestorIds: message.payload.ancestorIds,
            nonce: Date.now(),
          });
        } else if ("error" in message.payload) {
          // Distinct from a plain cancel (the `else` — nothing to say, the
          // user asked for exactly this) so a real failure doesn't read as
          // Escape having silently worked.
          if (message.payload.reason) {
            setNativeCapability(blockedBy(message.payload.reason));
            setNativeStatus(
              `native unavailable — ${explainUnavailable(message.payload.reason)}`,
            );
          } else {
            setNativeStatus(`pick failed: ${message.payload.error}`);
          }
        }
      }
    };

    chrome.runtime.onMessage.addListener(handler);

    // No initial REQUEST_TREE here — the myTabId effect above sends one as
    // soon as we know which tab we're bound to.

    return () => {
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, []);

  const handleViewModeChange = useCallback(
    (mode: TreeViewMode) => {
      setViewMode(mode);
      sendToBoundTab({
        type: "SET_VIEW_MODE",
        payload: { viewMode: mode },
      });
    },
    [sendToBoundTab],
  );

  // Apply search + role filter
  useEffect(() => {
    if (nodes.size === 0) return;
    const count = applySearchFilter(nodes, query, viewMode, roleFilter);
    updateMatchCount(count);
    forceRender((n) => n + 1);
  }, [query, nodes, viewMode, roleFilter, updateMatchCount]);

  // Compute visible nodes
  const effectiveRootId = scopedRootId || rootId;
  const scopedRootNode = scopedRootId ? nodes.get(scopedRootId) : null;
  const scopedDepthOffset = scopedRootNode ? scopedRootNode.depth : 0;
  // Memoized so the flattened list keeps a stable identity across unrelated
  // re-renders. `renderCount` bumps on every forceRender() — expand/collapse,
  // filter application, incoming messages — which is exactly when the visible
  // set (driven by mutated `ui.expanded`/`ui.matchesFilter`) can change.
  // Without this, effects keyed on `visibleNodeIds` would re-run every render.
  //
  // INVARIANT: node visibility is mutated in place, so the memo only stays
  // fresh if every site that touches `ui.expanded`/`ui.matchesFilter` calls
  // `forceRender()` afterwards — a mutation without the bump silently renders
  // a stale window.
  //
  // `visiblePositions` records each row's `aria-posinset`/`aria-setsize` within
  // its visible sibling group: virtualization keeps only the windowed rows in
  // the DOM, so screen readers need those explicit set markers to perceive the
  // full tree size and position (WAI-ARIA TreeView).
  const { visibleNodeIds, visiblePositions } = useMemo(() => {
    const ids: string[] = [];
    const positions = new Map<string, { posinset: number; setsize: number }>();
    function walkVisible(nodeId: string, posinset: number, setsize: number) {
      const node = asDom(nodes.get(nodeId));
      if (!node || !node.ui.matchesFilter) return;
      ids.push(nodeId);
      positions.set(nodeId, { posinset, setsize });
      if (node.ui.expanded) {
        const visibleChildren = node.childIds.filter(
          (childId) => asDom(nodes.get(childId))?.ui.matchesFilter,
        );
        visibleChildren.forEach((childId, i) => {
          walkVisible(childId, i + 1, visibleChildren.length);
        });
      }
    }
    if (effectiveRootId) walkVisible(effectiveRootId, 1, 1);
    return { visibleNodeIds: ids, visiblePositions: positions };
    // renderCount changes on every forceRender() call — intentional invalidation.
  }, [nodes, effectiveRootId, renderCount]);

  // Row id → position in `visibleNodeIds`, so resolving the selection to an
  // index (aria-activedescendant on every keypress, scroll-into-view, reveal)
  // is a lookup rather than a scan of the whole list. Kept in a ref as well,
  // read by the effects below so they resolve against the post-expansion list
  // without listing `visibleNodeIds` as a dependency (which would re-fire the
  // scroll on every expand/collapse).
  const visibleIndexById = useIndexById(visibleNodeIds);
  const visibleIndexByIdRef = useRef(visibleIndexById);
  visibleIndexByIdRef.current = visibleIndexById;

  const {
    containerRef,
    startIndex,
    endIndex,
    totalHeight,
    offset,
    onScroll,
    scrollToIndex,
  } = useVirtualTree(visibleNodeIds.length);

  // aria-activedescendant may only point at a DOM-present row. Offscreen
  // virtualized rows are unmounted, so require the selection to sit in the
  // current window (keyboard selection scrolls it in via scrollToIndex).
  const activeDescendantId = (() => {
    if (selectedId === null) return undefined;
    const i = visibleIndexById.get(selectedId) ?? -1;
    return i >= startIndex && i < endIndex ? `snrow-${selectedId}` : undefined;
  })();

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      sendToBoundTab({
        type: "HIGHLIGHT_NODE",
        payload: { nodeId: id },
      });
    },
    [sendToBoundTab],
  );

  const handleToggle = useCallback(
    (id: string) => {
      const node = asDom(nodes.get(id));
      if (node) {
        node.ui.expanded = !node.ui.expanded;
        forceRender((n) => n + 1);
      }
    },
    [nodes],
  );

  // Switch from filtered list to tree view, selecting and revealing a node
  const handleGoToTree = useCallback(
    (id: string) => {
      setRoleFilter(null);
      setSelectedId(id);
      // Expand ancestors so the node is visible in the tree
      setNodes((prev) => {
        let current = asDom(prev.get(id));
        while (current?.parentId) {
          const parent = asDom(prev.get(current.parentId));
          if (parent && !parent.ui.expanded) {
            parent.ui.expanded = true;
          }
          current = parent;
        }
        return prev;
      });
      forceRender((n) => n + 1);
      // Highlight on the page
      sendToBoundTab({
        type: "HIGHLIGHT_NODE",
        payload: { nodeId: id },
      });
      // Reveal the row (even if already selected). Wait an extra frame after
      // the filter → tree transition so focus lands on a rendered tree.
      requestReveal(id);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          treeRef.current?.focus();
        });
      });
    },
    [nodes, requestReveal, sendToBoundTab],
  );

  const handleActivate = useCallback(
    (id: string, explicitAction?: ActionType) => {
      const node = asDom(nodes.get(id));
      if (!node) return;

      // The slider/spinbutton ▼/▲ pair passes its own action so each
      // button dispatches its own step. Stepper keys (+/−/Shift+Enter)
      // from the tree, FilteredList, and TabSequenceView do the same.
      // All other paths (plain Enter, single-action button click,
      // Activate) let us pick the primary so existing single-action
      // ergonomics keep working unchanged.
      const primaryAction =
        explicitAction ?? getPrimaryAction(node.interaction.actions);
      if (!primaryAction) {
        // Not interactive — toggle expand instead
        if (node.childIds.length > 0) handleToggle(id);
        return;
      }

      // Text input — open inline input panel
      if (
        primaryAction === "type" ||
        (primaryAction === "focus" && node.interaction.isEditable)
      ) {
        sendToBoundTab(
          { type: "GET_FIELD_STATE", payload: { nodeId: id } },
          (response: unknown) => {
            if (!isFieldStateSuccess(response)) return;
            setInputState({
              type: "text",
              nodeId: id,
              label: node.a11y.name || node.dom.tagName,
              value: response.value || "",
              inputType: response.type,
              placeholder: response.placeholder,
            });
          },
        );
        return;
      }

      // Select — open option picker
      if (primaryAction === "select") {
        sendToBoundTab(
          { type: "GET_FIELD_STATE", payload: { nodeId: id } },
          (response: unknown) => {
            if (!isFieldStateSuccess(response) || !response.options) return;
            setInputState({
              type: "select",
              nodeId: id,
              label: node.a11y.name || node.dom.tagName,
              value: response.value || "",
              options: response.options,
            });
          },
        );
        return;
      }

      // All other actions — dispatch immediately
      const request: ActionRequest = {
        nodeId: id,
        action: primaryAction,
      };

      const name = node.a11y.name || node.dom.tagName;
      const role = node.a11y.role;

      // Stepper actions (slider/spinbutton ▼/▲) skip the feedback banner.
      // The visible value change on the page IS the confirmation, and
      // they're rapid-fire — flashing the banner on every click would
      // shove the tree down and pop it back over and over, leaving the
      // cursor over the wrong row by the second click. Errors still
      // surface via the failure-path setLastAction below.
      const isStepper =
        primaryAction === "increment" || primaryAction === "decrement";

      if (!isStepper) {
        // Contextual feedback based on role
        let feedback: string;
        if (role === "checkbox" || role === "switch") {
          const wasChecked = node.a11y.states.checked === true;
          feedback = wasChecked ? `Unchecked: ${name}` : `Checked: ${name}`;
        } else if (role === "radio") {
          feedback = `Selected: ${name}`;
        } else {
          feedback = `${ACTION_LABELS[primaryAction]}: ${name}`;
        }

        announce(feedback, 2000);
      }

      sendToBoundTab({ type: "DISPATCH_ACTION", payload: request }, (res) => {
        // Two ways an action fails to land, and both have to be read: the
        // message never reached a content script (lastError), or one
        // answered and refused — which is how it reports that the page is
        // in a state the action cannot run in, such as an armed picker
        // holding the pointer events. Without the second, the optimistic
        // banner set above stays on screen claiming something happened.
        const refusal = res as
          { success?: boolean; error?: string } | undefined;
        const failure = chrome.runtime.lastError
          ? chrome.runtime.lastError.message
          : refusal && refusal.success === false
            ? (refusal.error ?? "the page refused the action")
            : null;
        // Replaces the optimistic banner set above, whose own clear
        // `announce` cancels — otherwise that 2s timer wipes this 3s
        // message a second early.
        if (failure) announce(`Failed: ${failure}`, 3000);
        // Re-extract to reflect state change (checked, expanded, etc.)
        setTimeout(reExtract, 100);
      });
    },
    [nodes, handleToggle, sendToBoundTab, reExtract],
  );

  // ---- Native producer actions ----
  // Cheap pre-flight (no attach) — refreshed whenever the bound tab changes
  // while native is the active producer, so the capability banner tracks the
  // CURRENT tab. Mirrors DogfoodPanel's refreshCapability, driven by App's
  // own authoritative myTabId instead of polling chrome.tabs itself.
  //
  // Every native-action function below opens with
  // `if (!nativeModeEnabled) return;`. This used to be load-bearing for
  // dead-code elimination when the whole capability was build-time gated
  // (`dogfood` collapsed to a literal in the store build); now that
  // `nativeModeEnabled` is a real runtime value, the check is a genuine
  // runtime guard instead — the setting being off is what keeps
  // `chrome.debugger` from ever being touched, same as
  // `NativeDebuggerSession.attach()`'s own gate does one layer down.
  const refreshNativeCapability = useCallback(
    async (tabId: number) => {
      if (!nativeModeEnabled) return;
      const token = nativeOpToken.current;
      const cap = (await chrome.runtime.sendMessage({
        type: "NATIVE_CAPABILITY",
        tabId,
      })) as TabCapability;
      if (token !== nativeOpToken.current) return; // superseded by a tab switch
      setNativeCapability(cap);
    },
    [nativeModeEnabled],
  );

  useEffect(() => {
    if (!nativeModeEnabled || producer !== "native" || myTabId === null) return;
    void refreshNativeCapability(myTabId);
  }, [nativeModeEnabled, producer, myTabId, refreshNativeCapability]);

  /** Read the native tree into state. Mirrors DogfoodPanel's readTreeInto,
   *  minus its own flat-list bookkeeping — NativeTreeView owns expand state.
   *  Returns whether the read succeeded — the native-default effect below is
   *  the one caller that needs to tell a real failure apart from a read that
   *  just got superseded by something else.
   *
   *  UNGUARDED by `nativeInFlight` — `dispatchNativeAction`'s own re-read
   *  step calls this directly (not the guarded `loadNativeTree` below) so
   *  that its own held guard doesn't make its post-action re-read a silent
   *  no-op. Never call this one from anywhere else; call `loadNativeTree`. */
  const loadNativeTreeCore = useCallback(
    async (tabId: number): Promise<boolean> => {
      if (!nativeModeEnabled) return false;
      const token = nativeOpToken.current;
      setNativeBusy(true);
      setNativeStatus("reading native tree…");
      try {
        const r = (await chrome.runtime.sendMessage({
          type: "NATIVE_READ",
          tabId,
        })) as {
          ok?: boolean;
          error?: string;
          reason?: NativeUnavailableReason;
          nodes?: NativeNode[];
          rootId?: string;
          url?: string;
        };
        if (token !== nativeOpToken.current) return false; // tab switched mid-flight
        if (!r?.ok) {
          setNativeNodes(new Map());
          setNativeRootId("");
          if (r?.reason) {
            setNativeCapability(blockedBy(r.reason));
            setNativeStatus(
              `native unavailable — ${explainUnavailable(r.reason)}`,
            );
          } else {
            setNativeStatus(`read failed: ${r?.error ?? "unknown"}`);
          }
          return false;
        }
        setNativeNodes(new Map((r.nodes ?? []).map((n) => [n.id, n])));
        setNativeRootId(r.rootId ?? "");
        setNativeTreeTabId(tabId);
        setNativeTreeUrl(r.url);
        // A successful read is proof any standing refusal no longer holds —
        // same reasoning as DogfoodPanel's identical line.
        setNativeCapability(undefined);
        setNativeStatus(`${r.nodes?.length ?? 0} nodes`);
        return true;
      } finally {
        if (token === nativeOpToken.current) setNativeBusy(false);
      }
    },
    [nativeModeEnabled],
  );

  /** Guarded entry point for a user- or effect-triggered read (refresh
   *  button, auto-load). Excludes a second read/act while one is in flight —
   *  see `nativeInFlight`'s own declaration. Propagates `loadNativeTreeCore`'s
   *  success/failure so the native-default effect can tell them apart. */
  const loadNativeTree = useCallback(
    async (tabId: number): Promise<boolean> => {
      if (!nativeModeEnabled || nativeInFlight.current) return false;
      nativeInFlight.current = true;
      try {
        return await loadNativeTreeCore(tabId);
      } finally {
        nativeInFlight.current = false;
      }
    },
    [nativeModeEnabled, loadNativeTreeCore],
  );

  // Auto-load once per transition into native mode — see hasAutoLoadedNative's
  // declaration for why this deliberately does NOT also fire on a later tab
  // switch while already in native mode.
  useEffect(() => {
    if (!nativeModeEnabled || producer !== "native" || myTabId === null) return;
    if (hasAutoLoadedNative.current) return;
    hasAutoLoadedNative.current = true;
    void loadNativeTree(myTabId);
  }, [nativeModeEnabled, producer, myTabId, loadNativeTree]);

  // The ONLY place hasAutoLoadedNative re-arms: leaving native mode. Neither
  // the myTabId effect (a tab switch) nor PAGE_NAVIGATED (a same-tab
  // navigation) reset it — both fire while producer can still be "native",
  // and resetting it there would race straight into the effect above,
  // silently re-attaching chrome.debugger with no fresh user gesture. Only
  // flipping producer back to "dom" and then to "native" again — a real,
  // deliberate re-entry — earns the tree another free auto-load.
  useEffect(() => {
    if (producer === "dom") hasAutoLoadedNative.current = false;
  }, [producer]);

  /** Called after a successful action finds `nativeOpToken` bumped out from
   *  under it once the settle wait (below) has passed. `tabChangeAtStart` is
   *  a snapshot of `tabChangeToken` — the counter ONLY the myTabId effect
   *  bumps — taken at the same moment as `nativeOpToken`. Comparing that
   *  snapshot, not `myTabId` itself, is what makes this reliable: a rapid
   *  switch away and back leaves `myTabId` (and a ref mirroring it) reading
   *  the same tab id again even though a real switch happened and the effect
   *  ran, clearing the tree both times — so equality on the id alone cannot
   *  tell "no tab switch occurred" from "one occurred and reverted". The
   *  counter can't: ANY switch bumps it, round trip or not.
   *
   *  If it moved, a real tab switch (or another native op) beat us to it —
   *  leave it alone, same as every other token check in this file (re-
   *  reading here would be exactly the silent reattach-with-no-gesture
   *  `hasAutoLoadedNative` exists to prevent elsewhere). If it did NOT move,
   *  nothing but PAGE_NAVIGATED could have bumped `nativeOpToken` — firing
   *  for the navigation this action itself just caused (a link activated
   *  through the tree, a form submit, …), not an unrelated tab switch, but
   *  the same user gesture this function is still handling, continuing onto
   *  the page it navigated to. Read that new page rather than leaving the
   *  tree empty until a manual refresh.
   *
   *  A single navigation is the common case, but not the only one: a link to
   *  a page that itself client-redirects onward (a login page landing on a
   *  dashboard) fires PAGE_NAVIGATED again while — or right after — this
   *  reads the intermediate document, which unconditionally clears
   *  `nativeNodes` on every fire and would make a one-shot read here land on
   *  a document already gone, or get its own result silently discarded by
   *  `loadNativeTreeCore`'s own token check. So this waits out the settle
   *  window and re-checks: if `nativeOpToken` moved again during the wait,
   *  another navigation is still in flight (still THIS tab, still no real
   *  tab switch — `tabChangeToken` is re-checked every pass) and it waits
   *  again rather than reading a document already being replaced. Bounded by
   *  `MAX_NAV_RECOVERY_HOPS` so a page that never stops redirecting doesn't
   *  hold this open forever — the manual refresh button is always the
   *  fallback past that. */
  const recoverFromOwnNavigation = useCallback(
    async (tabId: number, tabChangeAtStart: number) => {
      let lastSeenToken = nativeOpToken.current;
      for (let hop = 0; hop < MAX_NAV_RECOVERY_HOPS; hop++) {
        if (tabChangeToken.current !== tabChangeAtStart) return;
        await new Promise((res) => setTimeout(res, NATIVE_SETTLE_MS));
        if (tabChangeToken.current !== tabChangeAtStart) return;
        if (nativeOpToken.current === lastSeenToken) break; // no further nav during the wait — settled
        lastSeenToken = nativeOpToken.current;
      }
      await loadNativeTreeCore(tabId);
    },
    [loadNativeTreeCore],
  );

  // The default itself (see `hasAppliedNativeDefault`'s own declaration:
  // fires at most ONCE per panel session, full stop — not once per tab).
  // Gated on `connected`, not just `myTabId`, for the same reason the
  // producer toggle itself waits for it (see the toolbar's own comment
  // below): reaching for native before the DOM producer has proven the tab
  // is even reachable would default into a capability check with nothing to
  // fall back to yet.
  //
  // Deliberately no pre-flight NATIVE_CAPABILITY check here — neither the
  // manual NATIVE toggle nor the consent banner's own "Enable native mode…"
  // flow does one either; both just flip `producer`. But unlike those two,
  // THIS effect does have to tell a real failure apart from success: it's
  // spending a one-shot the user never asked for, on a page they didn't
  // pick, so a page that merely can't attach (DevTools already owns that
  // tab, a blocked URL, ...) reverts to DOM rather than leaving the panel
  // stuck on a producer with an empty tree. `hasAppliedNativeDefault` is
  // consumed up front and — on purpose — never un-marked on failure: an
  // earlier version reset it so a later, different tab could get its own
  // shot, but that reset used `nativeBusy`/`producer` as effect
  // dependencies to know when to retry, and both of those flip as a direct
  // side effect of the retry attempt itself (`loadNativeTreeCore` toggles
  // `nativeBusy`, a failure calls `setProducer("dom")`) — so a page that
  // persistently can't attach (DevTools already on it, a permanently
  // blocked URL) retried forever, re-attaching `chrome.debugger` and
  // reflashing the "…is debugging this browser" banner with no further user
  // gesture. Once per session, unconditionally, is the guarantee that
  // actually holds.
  //
  // The busy wait below is a bounded poll, not a dependency-driven re-fire,
  // for the same reason: `loadNativeTree` returns `false` when
  // `nativeInFlight` is already held by something else (a manual toggle
  // that raced this effect, a refresh, an in-flight action's own re-read),
  // purely because it's busy, not because this attempt actually failed —
  // waiting it out here (rather than bailing and relying on a later
  // re-evaluation) is what keeps that from being misread as a genuine
  // attach failure. Setting `hasAutoLoadedNative` up front makes the
  // auto-load effect below a no-op once `producer` does flip (no duplicate
  // NATIVE_READ). The `token` re-check on the way out is the same guard
  // every other native op in this file uses (see `nativeOpToken`'s own
  // declaration): if a tab switch (or any other native op) has superseded
  // this attempt by the time it resolves, leave whatever that other
  // operation left behind alone rather than stomping it with a stale
  // revert.
  useEffect(() => {
    if (!nativeModeEnabled || !connected || myTabId === null) return;
    if (hasAppliedNativeDefault.current) return;
    if (producerRef.current === "native") {
      // Already native by some other path that raced this effect — the
      // consent banner's own onEnable (which flips producer straight to
      // "native" on a real success), or a manual toggle click landing in
      // the same window as nativeModeEnabled first turning true. There is
      // nothing left to default, and reading again here would be exactly
      // the redundant, user-never-asked-for NATIVE_READ this effect exists
      // to avoid elsewhere — one whose own failure could revert the
      // producer the user (or the other flow) already established. Once
      // per session means once: consume the one-shot without reading.
      hasAppliedNativeDefault.current = true;
      return;
    }
    hasAppliedNativeDefault.current = true;
    const tabId = myTabId;
    const token = nativeOpToken.current;
    void (async () => {
      for (
        let i = 0;
        nativeInFlight.current && i < NATIVE_DEFAULT_BUSY_RETRIES;
        i++
      ) {
        await new Promise((res) => setTimeout(res, NATIVE_SETTLE_MS));
        if (token !== nativeOpToken.current) return; // superseded meanwhile
      }
      // Re-check: producer may have gone native via another path (the same
      // race the guard above closes) while this was waiting out someone
      // else's in-flight read.
      if (producerRef.current === "native") return;
      setProducer("native");
      hasAutoLoadedNative.current = true;
      try {
        const ok = await loadNativeTree(tabId);
        if (ok || token !== nativeOpToken.current) return;
        setProducer("dom");
      } catch {
        // sendMessage rejected outright (service worker not yet woken, a
        // torn-down context) — loadNativeTreeCore has no catch of its own
        // for this, so without one here the rejection would strand the
        // panel on "native" with an empty tree. Same revert as an ordinary
        // `ok === false` above.
        if (token !== nativeOpToken.current) return;
        setProducer("dom");
      }
    })();
  }, [nativeModeEnabled, connected, myTabId, loadNativeTree]);

  /** Dispatch one native action and, on success, settle + re-read — the same
   *  two-step DogfoodPanel's runAct uses, so a click that opens a menu or
   *  re-renders a list doesn't leave the tree showing backendDOMNodeIds the
   *  page has already discarded. */
  const dispatchNativeAction = useCallback(
    async (nodeId: string, action: NativeAction, value?: string) => {
      if (!nativeModeEnabled || nativeInFlight.current) return;
      nativeInFlight.current = true;
      try {
        const token = nativeOpToken.current;
        const tabChangeAtStart = tabChangeToken.current;
        if (nativeTreeTabId === undefined) {
          setNativeStatus("load a tree first");
          return;
        }
        const tabId = nativeTreeTabId;
        // A navigation replaces the document, and with it every
        // backendDOMNodeId this tree's ids are built from — refuse rather
        // than dispatch into the dark. Same check DogfoodPanel's runAct
        // makes; undefined either side (URL unreadable, or no baseline yet)
        // means "can't tell" and does not block. Best-effort only: it
        // catches an ordinary same-tab navigation, not every way a document
        // can change (a same-URL reload isn't caught by the URL compare
        // below — the token re-check right after is what catches THAT: the
        // PAGE_NAVIGATED handler bumps it unconditionally, same-URL or not).
        const nowUrl = await chrome.tabs
          .get(tabId)
          .then((t) => t.url)
          .catch(() => undefined);
        if (token !== nativeOpToken.current) return; // invalidated during the lookup
        if (nativeTreeUrl && nowUrl && nowUrl !== nativeTreeUrl) {
          setNativeNodes(new Map());
          setNativeRootId("");
          setNativeTreeTabId(undefined);
          setNativeTreeUrl(undefined);
          setNativeStatus("page navigated — reload the native tree");
          return;
        }
        setNativeBusy(true);
        try {
          const r = (await chrome.runtime.sendMessage({
            type: "NATIVE_ACT",
            tabId,
            nodeId,
            action,
            ...(value !== undefined ? { value } : {}),
          })) as {
            success?: boolean;
            error?: string;
            reason?: NativeUnavailableReason;
          };
          if (!r?.success) {
            // Only report a failure that still describes the tab we asked
            // about — a reply superseded by a tab switch or navigation is
            // dropped silently, matching every other stale-token check in
            // this file, rather than surfacing an error for an action whose
            // page may already be gone.
            if (token === nativeOpToken.current) {
              if (r?.reason) {
                setNativeCapability(blockedBy(r.reason));
                setNativeStatus(
                  `native unavailable — ${explainUnavailable(r.reason)}`,
                );
              } else {
                setNativeStatus(`act failed: ${r?.error ?? "unknown"}`);
              }
            }
            return;
          }
          // Only toast a still-fresh success — a reply that arrived after
          // the token already moved (a real tab switch racing the round
          // trip) belongs to a tab the panel has since left, and toasting it
          // would name an action for a page no longer on screen.
          if (token === nativeOpToken.current) {
            announce(`Native: ${action} on ${nodeId}`, 2000);
          }
          // Always settle before checking staleness or reading again,
          // regardless of the toast above — even when `nativeOpToken`
          // already moved by the time `r` arrived (a same-tab link click can
          // make PAGE_NAVIGATED, fired on `onBeforeNavigate` in
          // background.ts, win the race against this message's own round
          // trip). Reading immediately would race the navigation itself and
          // land on the old document, or on a new one that hasn't settled
          // yet — the same reason every other action here waits before its
          // own re-read. This is still a single best-effort attempt, not a
          // wait-for-load: a destination slower than NATIVE_SETTLE_MS to
          // become CDP-navigable can still come back sparse, same as the
          // existing risk of refreshing too early elsewhere in this file —
          // an accepted tradeoff here rather than a load-event wait, since
          // an empty/partial recovery read is strictly better than never
          // getting the request at all (the bug status quo before this
          // fix), and the user's own "Refresh native tree" button remains
          // available either way.
          await new Promise((res) => setTimeout(res, NATIVE_SETTLE_MS));
          if (token !== nativeOpToken.current) {
            await recoverFromOwnNavigation(tabId, tabChangeAtStart);
            return;
          }
          // The unguarded core, not `loadNativeTree` — this function already
          // holds `nativeInFlight`, so calling the guarded wrapper here
          // would see it held and silently skip the re-read.
          await loadNativeTreeCore(tabId);
        } finally {
          if (token === nativeOpToken.current) setNativeBusy(false);
        }
      } finally {
        nativeInFlight.current = false;
      }
    },
    [
      nativeModeEnabled,
      nativeTreeTabId,
      nativeTreeUrl,
      loadNativeTreeCore,
      recoverFromOwnNavigation,
    ],
  );

  const handleNativeActivate = useCallback(
    (
      node: NativeNode,
      explicitAction?: "increment" | "decrement" | "select",
    ) => {
      if (!nativeModeEnabled) return;
      if (explicitAction) {
        void dispatchNativeAction(node.id, explicitAction);
        return;
      }
      // Typable fields reuse the SAME InputPanel the DOM producer uses — the
      // point of this integration over DogfoodPanel's crude `prompt()`. No
      // GET_FIELD_STATE round trip needed: unlike the DOM path, a native
      // node's value/placeholder are already loaded eagerly at read time.
      //
      // NEVER prefill with the redaction sentinel itself. A sensitive
      // field's `value` on the wire IS the literal string
      // NATIVE_REDACTED_VALUE, not the real value (R1) — InputPanel has no
      // way to tell "the page's real value happens to be this text" apart
      // from "this is the marker, not data", so a submit with no edit would
      // silently dispatch the word "[redacted]" over the user's real value.
      // Opening empty instead means only a value the user actually typed can
      // ever be submitted — and blockEmptySubmit (below) closes the other
      // half: an unedited (still empty) submit must not blank the real
      // value either, since that's just as silent and just as destructive.
      const isRedacted = node.value === NATIVE_REDACTED_VALUE;
      if (isTypableRole(node.role, node.states)) {
        setInputState({
          type: "text",
          nodeId: node.id,
          label: node.name || node.role,
          value: isRedacted ? "" : (node.value ?? ""),
          placeholder: node.placeholder,
          source: "native",
          // Mask the retyped replacement the same way InputPanel already
          // masks a DOM password field (inputType, checked in InputPanel.tsx)
          // — the wire only carries a redacted/not-redacted boolean (as the
          // sentinel), never the raw `type` attribute that produced it (R1:
          // it's not just type="password" — a sensitive-autocomplete text
          // field redacts too), so this masks every redacted field's retype
          // rather than trying to distinguish which specific rule fired.
          // Erring toward masking more, never less.
          inputType: isRedacted ? "password" : undefined,
          blockEmptySubmit: isRedacted,
        });
        return;
      }
      void dispatchNativeAction(node.id, "click");
    },
    [nativeModeEnabled, dispatchNativeAction],
  );

  const handleInputSubmit = useCallback(
    (nodeId: string, value: string) => {
      if (inputState?.source === "native") {
        setInputState(null);
        // See InputPanelState.blockEmptySubmit's own doc — a redacted field
        // opened empty; submitting it still-empty is "didn't type anything",
        // not "clear the field", so it's a no-op rather than a dispatch.
        if (inputState.blockEmptySubmit && value === "") return;
        void dispatchNativeAction(nodeId, "type", value);
        return;
      }
      const node = nodes.get(nodeId);
      const actionType = inputState?.type === "select" ? "select" : "type";

      sendToBoundTab(
        {
          type: "DISPATCH_ACTION",
          payload: { nodeId, action: actionType, payload: { value } },
        },
        () => {
          const name = node?.a11y.name || nodeId;
          announce(
            actionType === "select" ? `Selected: ${value}` : `Typed in ${name}`,
            2000,
          );
          // Re-extract tree to reflect new values
          setTimeout(reExtract, 100);
        },
      );
      setInputState(null);
    },
    [nodes, inputState, sendToBoundTab, reExtract, dispatchNativeAction],
  );

  const handleInputCancel = useCallback(() => {
    setInputState(null);
  }, []);

  const toggleCurtain = useCallback(() => {
    const next = !curtainOn;
    setCurtainOn(next);
    sendToBoundTab({
      type: "TOGGLE_CURTAIN",
      payload: { visible: next },
    });
  }, [curtainOn, sendToBoundTab]);

  const toggleFocusTracker = useCallback(() => {
    const next = !focusTrackerOn;
    setFocusTrackerOn(next);
    sendToBoundTab({
      type: "SET_FOCUS_TRACKER",
      payload: { enabled: next },
    });
  }, [focusTrackerOn, sendToBoundTab]);

  // Picker mode toggle. DOM: tells the content script to install / remove
  // its capture-phase click handler — PICK_MODE_CHANGED comes back when the
  // content script confirms (or when the user pressed Escape on the page to
  // exit), and we mirror state from that message handler below. Native has
  // no content script to install a page-side handler in, so it goes through
  // `chrome.debugger`'s own `Overlay.setInspectMode` instead (`runPick` in
  // debugger-session.ts) — NATIVE_PICK_RESULT is that path's counterpart to
  // PICK_MODE_CHANGED/NODE_PICKED, handled in the same message handler above.
  const togglePickMode = useCallback(() => {
    const next = !pickModeOn;
    if (producer === "native") {
      if (nativeTreeTabId === undefined) return; // load a tree first
      // Same guard the toolbar button's own `disabled` enforces, but only
      // for ARMING — without it, the Ctrl/Cmd+Shift+C shortcut could start a
      // pick while a NATIVE_READ/NATIVE_ACT is still in flight, queueing it
      // behind an operation the UI is actively showing as disabled. Stopping
      // an already-armed pick must never be blocked by this: `nativeBusy` is
      // unrelated state that could in principle flip true while a pick is
      // outstanding, and the user still needs a way to cancel it.
      if (next && nativeBusy) return;
      // Snapshot the token this pick is armed under — compared against its
      // current value when the result arrives (see `nativePickToken`'s own
      // comment). Only on arming: a STOP's own result never reveals
      // anything, so it has nothing to stamp.
      if (next) {
        nativePickToken.current = nativeOpToken.current;
        nativePickRequestId.current++;
      }
      setPickModeOn(next);
      void chrome.runtime
        .sendMessage(
          next
            ? {
                type: "NATIVE_PICK_START",
                tabId: nativeTreeTabId,
                requestId: nativePickRequestId.current,
              }
            : { type: "NATIVE_PICK_STOP", tabId: nativeTreeTabId },
        )
        .catch(() => {
          // Service worker not reachable — nothing was armed/cancelled
          // server-side, so don't strand the button showing "on".
          setPickModeOn(false);
        });
      return;
    }
    if (!next) {
      // Goes through the same path as a frame exiting on its own, so the
      // mirror and the broadcast stay in one place.
      exitPickMode();
      return;
    }
    setPickModeOn(true);
    sendToBoundTab({
      type: "SET_PICK_MODE",
      payload: { enabled: true },
    });
  }, [
    pickModeOn,
    producer,
    nativeTreeTabId,
    nativeBusy,
    sendToBoundTab,
    exitPickMode,
  ]);

  // Switching producers while a pick is armed left the OLD producer's picker
  // running (the DOM content script's click capture, or the native Overlay
  // inspect mode) with nothing to turn it off — the toolbar's own pick
  // button just started reflecting the NEW producer's state (always "off",
  // since neither ever auto-arms), so the running picker became invisible to
  // the UI while still live. Cancelling first, on the producer the pick
  // actually belongs to, avoids that: `togglePickMode` reads `producer` from
  // its own closure, so calling it before `setProducer` targets the right
  // one.
  const switchProducer = useCallback(
    (next: "dom" | "native") => {
      if (pickModeOn) togglePickMode();
      setProducer(next);
    },
    [pickModeOn, togglePickMode],
  );

  // Ctrl/Cmd+Shift+C: toggle pick mode, mirroring DevTools' inspector
  // shortcut. Bound to the panel document so it fires whenever the panel
  // has focus. Page-level shortcuts are handled by the content script's own
  // Escape listener while pick mode is active (DOM only — see the native
  // Escape handling below, which the panel itself owns instead).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === "C" || e.key === "c")) {
        e.preventDefault();
        togglePickMode();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [togglePickMode]);

  // Cancel an in-flight native pick if the panel leaves it behind — a tab
  // switch (including `nativeTreeTabId` resetting to `undefined`, which
  // covers disabling native mode too) or the panel unmounting entirely.
  // `runPick` on the background side never leaks past a single pick (it
  // always resolves and turns `Overlay.setInspectMode` back off), but
  // without this the OVERLAY stays up on the page and the panel's own
  // `pickModeOn` stays stuck "on" until a result — which, once the panel
  // has moved off that tab, may never arrive for it to see.
  //
  // Deliberately depends on `nativeTreeTabId` ALONE, not `[producer,
  // pickModeOn, nativeTreeTabId]` the way this used to read: `pickModeOn`
  // flips false on every ORDINARY pick completion too (the NATIVE_PICK_
  // RESULT handler above sets it), and depending on it re-armed this
  // effect's cleanup on that transition as well — sending a STOP for a pick
  // that had already resolved normally. `cancelPick` on the background side
  // treats a STOP with nothing currently armed as "record a pending cancel
  // for whatever starts next on this tab" (see its own comment), so that
  // redundant STOP silently cancelled the NEXT pick the user armed, before
  // its own click could ever reach it — a real, observed regression this
  // dependency change fixes. `nativeTreeTabId` itself never changes as part
  // of an ordinary pick completing, only on a genuine tab switch, so it's
  // the correct sole trigger; `producer` is dropped too, since
  // `switchProducer` already sends its own explicit STOP for the producer
  // being left, and this effect firing a SECOND one for the same pick would
  // reintroduce the identical poisoning bug one layer up.
  useEffect(() => {
    const tabId = nativeTreeTabId;
    return () => {
      if (
        producerRef.current !== "native" ||
        !pickModeOnRef.current ||
        tabId === undefined
      ) {
        return;
      }
      // Clear the local mirror immediately rather than waiting on this
      // message's own reply — the panel is leaving this tab either way, and
      // a rejected send (service worker momentarily unreachable) would
      // otherwise leave the toolbar's Pick button stuck showing "on" with
      // no armed pick and no NATIVE_PICK_RESULT ever coming to clear it.
      setPickModeOn(false);
      void chrome.runtime
        .sendMessage({ type: "NATIVE_PICK_STOP", tabId })
        .catch(() => {});
    };
  }, [nativeTreeTabId]);

  // Escape cancels an active native pick. The DOM picker's Escape handling
  // lives in the content script because it owns the page-side click capture;
  // native has no content script in the loop at all (`runPick` talks to the
  // page only over CDP), so there's nothing there to listen on. Scoped to
  // the panel document instead — the inspected page's own keystrokes never
  // reach here, but a pick is themselves initiated from (and cancelled from)
  // the panel, so requiring the panel to have focus for Escape to cancel it
  // matches Ctrl/Cmd+Shift+C above needing the same.
  //
  // Mounted once (empty deps) rather than re-subscribed on `[producer,
  // pickModeOn, togglePickMode]` the way this used to read: attaching the
  // listener only while `pickModeOn` is true means the very click that turns
  // picking on has to wait for THIS effect to run before Escape does
  // anything — and a passive effect is deferred past the same render/commit
  // an e2e test's `toHaveAttribute` assertion can already observe, so a
  // script-driven click-then-Escape can race it. That raced for real in
  // practice, intermittently. Reading current state off a ref kept fresh
  // during render (not via its own effect, which would have the identical
  // gap) sidesteps the whole class of race: the listener is already there
  // before the click that arms it ever happens.
  const pickEscapeStateRef = useRef({ producer, pickModeOn, togglePickMode });
  pickEscapeStateRef.current = { producer, pickModeOn, togglePickMode };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const state = pickEscapeStateRef.current;
      if (state.producer !== "native" || !state.pickModeOn) return;
      e.preventDefault();
      state.togglePickMode();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Modality flag — see useInputModality for the full rationale. Hover
  // handlers gate on isMouseModality() so keyboard-driven scroll doesn't
  // produce spurious mouseenter events that clobber the selection.
  const { isMouseModality, markKeyboard } = useInputModality();

  const handleHover = useCallback(
    (id: string | null) => {
      if (!isMouseModality()) return;
      if (id) {
        // `hover` keeps this a preview: overlay only, no page scroll and no
        // real focus change. Without it, sweeping the pointer down the tree
        // scroll-jumped the page and fired a focus event on the host page for
        // every row it passed over.
        sendToBoundTab({
          type: "HIGHLIGHT_NODE",
          payload: { nodeId: id, hover: true },
        });
      } else {
        sendToBoundTab({ type: "CLEAR_HIGHLIGHT" });
      }
    },
    [isMouseModality, sendToBoundTab],
  );

  const handleExpandAll = useCallback(() => {
    for (const node of nodes.values() as IterableIterator<DomSemanticNode>) {
      if (node.childIds.length > 0) node.ui.expanded = true;
    }
    forceRender((n) => n + 1);
  }, [nodes]);

  const handleCollapseAll = useCallback(() => {
    for (const node of nodes.values() as IterableIterator<DomSemanticNode>) {
      if (node.depth > 0) node.ui.expanded = false;
    }
    forceRender((n) => n + 1);
  }, [nodes]);

  const handleScopeToNode = useCallback(
    (id: string | null) => {
      if (id) {
        const node = asDom(nodes.get(id));
        if (node) node.ui.expanded = true;
      }
      setScopedRootId(id);
      forceRender((n) => n + 1);
    },
    [nodes],
  );

  const handleSendKey = useCallback(
    (
      key: string,
      code: string,
      keyCode: number,
      modifiers?: { shift?: boolean },
    ) => {
      sendToBoundTab(
        { type: "SEND_KEY", payload: { key, code, keyCode, modifiers } },
        (response: unknown) => {
          if (isSuccessResponse(response)) {
            const label = modifiers?.shift
              ? `Shift+${key === "Tab" ? "Tab" : key}`
              : key;
            announce(`Sent key: ${label}`, 1500);
          }
        },
      );
      setTimeout(reExtract, 300);
    },
    [sendToBoundTab, reExtract],
  );

  // Export the selected view(s) as a Markdown report and copy to clipboard.
  // Serialized entirely panel-side from the merged snapshot the panel already
  // holds — so it's exactly what's on screen (current view, scoped) and never
  // depends on the content script being fresh.
  const doExport = useCallback(
    (selection: ExportView[]) => {
      setExportMenuOpen(false);

      // Native has no subtree scoping (that's a DOM-tree-only concept — see
      // the `producer === "dom" && scopedRootId` breadcrumb gate below), so
      // it always exports the whole last-read tree; no scope de-indent, no
      // scope label.
      if (producer === "native") {
        if (!nativeRootId || nativeNodes.size === 0) {
          announce("Nothing to export yet", 2000);
          return;
        }
        const tree = nativeToExtractionResult(nativeNodes, nativeRootId);
        const markdown = buildExportMarkdown(
          {
            // `normalizeNativeAX` already drops every UNNAMED generic
            // wrapper as noise, keeping a bare `role: "generic"` node only
            // when it's a meaningfully named group (see
            // `ax-normalize.ts`'s own comment) — so unlike a DOM tree,
            // every generic node that survives into a native tree is one
            // the panel actually shows. `serializeTree`'s default
            // `includeGeneric: false` doesn't know that distinction and
            // would silently drop it from the export.
            tree: serializeTree(tree, { includeGeneric: true }),
            outline: serializeOutline(tree),
            // Native has no tab-order data at all (see NATIVE_VIEWS) —
            // never selected, so this value never renders.
            tabSequence: "",
          },
          {
            pageTitle,
            pageUrl,
            capturedAt: new Date().toISOString(),
            extensionVersion: chrome.runtime.getManifest().version,
            viewLabel: "Native accessibility tree",
          },
          selection,
        );
        navigator.clipboard.writeText(markdown).then(
          () => announce("Copied to clipboard", 2500),
          () =>
            announce("Clipboard blocked — click the panel, then retry", 2500),
        );
        return;
      }

      const exportRootId = scopedRootId || rootId;
      if (!exportRootId || nodes.size === 0) {
        announce("Nothing to export yet", 2000);
        return;
      }
      // The panel renders the extension's own DOM-producer tree, so stamp the
      // export with that provenance (the panel keeps nodes in a bare Map rather
      // than a full ExtractionResult).
      const tree: ExtractionResult = {
        nodes,
        rootId: exportRootId,
        source: { producer: "dom" },
      };

      // A scoped subtree serializes at its absolute depth; de-indent so the
      // scope root sits at column 0 in the report.
      const scopeNode = scopedRootId ? nodes.get(scopedRootId) : null;
      const scopeDepth = scopeNode?.depth ?? 0;
      const treeStr =
        scopeDepth > 0
          ? serializeTree(tree)
              .split("\n")
              .map((line) => line.slice(2 * scopeDepth))
              .join("\n")
          : serializeTree(tree);
      const scopeLabel = scopeNode
        ? `${scopeNode.a11y.role}${scopeNode.a11y.name ? ` "${scopeNode.a11y.name}"` : ""}`
        : undefined;

      const markdown = buildExportMarkdown(
        {
          tree: treeStr,
          outline: serializeOutline(tree),
          // Number the export's tab-order section at render — it mirrors the
          // numbered on-screen panel; the numbers are display-only, never stored.
          tabSequence: numberTabStops(serializeTabSequence(tree)),
        },
        {
          pageTitle,
          pageUrl,
          capturedAt: new Date().toISOString(),
          extensionVersion: chrome.runtime.getManifest().version,
          viewLabel: viewMode === "dom" ? "DOM tree" : "Accessibility tree",
          scope: scopeLabel,
        },
        selection,
      );

      navigator.clipboard.writeText(markdown).then(
        () => announce("Copied to clipboard", 2500),
        () => announce("Clipboard blocked — click the panel, then retry", 2500),
      );
    },
    [
      producer,
      nativeNodes,
      nativeRootId,
      nodes,
      scopedRootId,
      rootId,
      viewMode,
      pageTitle,
      pageUrl,
    ],
  );

  // Close the export menu on outside-click or Escape.
  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExportMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [exportMenuOpen]);

  const { handleKeyDown } = useTreeKeyboard({
    nodes,
    visibleNodeIds,
    selectedId,
    onSelect: handleSelect,
    onToggle: handleToggle,
    onActivate: handleActivate,
    onFocusSearch: focusSearch,
  });

  // Scroll the selected tree item into view whenever the selection changes
  // (covers keyboard navigation, focus-sync from the page, jump/pick/go-to-tree
  // flows that call setSelectedId). Keyed on `selectedId` only — depending on
  // `visibleNodeIds` would re-fire on every expand/collapse and yank the
  // viewport back to an off-screen selection. The list is read from a ref so
  // the index resolves against the post-expansion list without adding it as a
  // dependency.
  useEffect(() => {
    if (!selectedId) return;
    const index = visibleIndexByIdRef.current.get(selectedId) ?? -1;
    if (index !== -1) scrollToIndex(index, "nearest");
  }, [selectedId, scrollToIndex]);

  // Reveal a row on explicit request (jump/pick/focus/go-to-tree), even when it
  // is already the selection. Keyed on the reveal nonce, not visibleNodeIds, so
  // ordinary expand/collapse never scrolls; the target is resolved against the
  // post-expansion list via the ref.
  useEffect(() => {
    if (revealNonce === 0) return;
    const target = revealTargetRef.current;
    if (!target) return;
    const index = visibleIndexByIdRef.current.get(target) ?? -1;
    if (index !== -1) scrollToIndex(index, "nearest");
  }, [revealNonce, scrollToIndex]);

  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const themeClass = prefersDark ? "sn-theme-dark" : "sn-theme-light";

  if (!connected) {
    return (
      <div class={`sn-root ${themeClass}`}>
        <div class="sn-page-header">
          <div class="sn-page-info">
            <span class="sn-page-title">
              Semantic Navigator
              <span
                class="sn-beta-pill"
                title="Semantic Navigator is in public beta. Feedback welcome on GitHub."
                aria-label="Beta version"
              >
                BETA
              </span>
            </span>
          </div>
        </div>
        <div class="sn-empty">
          <div class="sn-empty-stack">
            {/*
              Two different states share this screen, and saying "connecting"
              for both is the bug: on a page where no content script can run,
              nothing is connecting and nothing ever will. The retry stays on
              the restricted branch too, because the same reply comes back for
              a content script that simply hasn't loaded yet.
            */}
            {pageUnreachable ? (
              <span>
                This page can't be inspected.
                <br />
                <small>
                  Chrome doesn't allow extensions on pages like chrome://, the
                  Web Store, or the built-in PDF viewer. Open a regular http(s)
                  page — or, if this is one, reload it and try again.
                </small>
              </span>
            ) : (
              <span>
                Connecting to page...
                <br />
                <small>
                  Switched tabs? Load this tab's tree — or reload the page.
                </small>
              </span>
            )}
            {/*
              Switching tabs clears the tree and drops us here, but the
              toolbar's refresh button lives in the connected UI below this
              early return — so the recovery path the code comment points at
              was unreachable, and the panel only healed if the new page
              happened to mutate. This is that affordance. Tagged with
              `myTabId` for the same reason the toolbar button is: so it can't
              race the background's activeTabId update after a tab switch.
            */}
            <button
              class="sn-input-panel-btn sn-input-panel-btn--primary"
              onClick={() => requestTree()}
            >
              {pageUnreachable ? "Try again" : "Load tree"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleCloseTab = useCallback(() => {
    sendToBoundTab({ type: "CLOSE_TAB" }, (response: unknown) => {
      if (isSuccessResponse(response)) {
        announce("Tab closed", 2000);
      }
    });
  }, [sendToBoundTab]);

  // Extract hostname for display
  const pageHost = (() => {
    try {
      return new URL(pageUrl).hostname;
    } catch {
      return "";
    }
  })();

  // Detect if tree root is a dialog (modal scoping from dom-extractor)
  const rootNode = rootId ? nodes.get(rootId) : null;
  const isDialogScoped =
    rootNode?.a11y.role === "dialog" || rootNode?.a11y.role === "alertdialog";

  // Build scope breadcrumb path
  const scopeBreadcrumb: Array<{ id: string; label: string }> = [];
  if (scopedRootId) {
    let current: DomSemanticNode | undefined = asDom(nodes.get(scopedRootId));
    while (current) {
      const lbl =
        viewMode === "a11y"
          ? `${getDisplayRole(current)}${current.a11y.name ? ` "${current.a11y.name}"` : ""}`
          : `<${current.dom.tagName}>`;
      scopeBreadcrumb.unshift({ id: current.id, label: lbl });
      current = current.parentId
        ? asDom(nodes.get(current.parentId))
        : undefined;
    }
  }

  return (
    <div class={`sn-root ${themeClass}`}>
      {/* Page info header */}
      {pageTitle && (
        <div class="sn-page-header">
          <div class="sn-page-info">
            <span class="sn-page-title" title={pageTitle}>
              {pageTitle}
              <span
                class="sn-beta-pill"
                title="Semantic Navigator is in public beta. Feedback welcome on GitHub."
                aria-label="Beta version"
              >
                BETA
              </span>
            </span>
            {pageHost && (
              <span class="sn-page-url" title={pageUrl}>
                {pageHost}
              </span>
            )}
          </div>
          <button
            class="sn-close-tab-btn"
            onClick={handleCloseTab}
            title="Close this tab"
            aria-label={`Close tab: ${pageTitle}`}
          >
            {"\u2715"}
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div class="sn-toolbar" role="toolbar" aria-label="Tree controls">
        {producer === "dom" && (
          <input
            ref={searchInputRef}
            class="sn-search"
            type="search"
            placeholder="Search nodes..."
            aria-label="Search tree nodes"
            value={query}
            onInput={(e) => updateQuery((e.target as HTMLInputElement).value)}
          />
        )}
        {/* Mounted before there is a count to report: a live region that
            arrives already holding its text is not announced by most screen
            reader / browser pairs. Only the text swaps. */}
        {producer === "dom" && (
          <span class="sn-search-count" aria-live="polite">
            {(query || roleFilter) &&
              `${matchCount} match${matchCount !== 1 ? "es" : ""}`}
          </span>
        )}

        {/* Producer toggle. Reaching NATIVE requires the DOM producer to have
            connected once first (this toolbar lives past the `!connected`
            early return above) — a deliberate scope cut, not a capability
            gap: every page Chrome actually blocks the content script on
            (chrome://, the Web Store, an extension page) blocks native's
            attach for the identical reason (capability.ts's DOM_FALLBACK
            table), so the two producers' reachability already coincides in
            practice. Wider capability-surfacing UX is later work (RFC PR H's
            "done enough for C" checklist), not this slice.

            Only rendered once `nativeModeEnabled` is on — same structural gate
            `dogfood` used to be, just a runtime setting now instead of a
            build-time one. Kept absent (not merely disabled) while off: a
            visible DOM/NATIVE choice implies NATIVE is one click away, which
            isn't true before the user has actually opted in, and every other
            producer-scoped control below reads `producer` to decide whether
            it applies — introducing a THIRD "not yet decided" state for all of
            them would cost far more than the one small entry-point button
            below costs to add.

            The "Disable" button alongside it is the only in-panel way back to
            off once enabled — without it, a user who opted in has no way to
            revoke the setting short of chrome://extensions, which contradicts
            CHANGELOG.md's own "turning it back off immediately detaches".
            No consent step to turn it off: revoking is the safe direction,
            same as DogfoodPanel's own checkbox. */}
        {nativeModeEnabled ? (
          <>
            <div
              class="sn-toggle-group"
              role="group"
              aria-label="Tree producer"
            >
              <button
                class="sn-toggle-btn"
                aria-pressed={producer === "dom"}
                onClick={() => switchProducer("dom")}
              >
                DOM
              </button>
              <button
                class="sn-toggle-btn"
                aria-pressed={producer === "native"}
                onClick={() => switchProducer("native")}
              >
                NATIVE
              </button>
            </div>
            <button
              class="sn-toolbar-btn"
              onClick={() => {
                void setNativeMode(false).then((ok) => {
                  // A failed disable (message never reached the service
                  // worker, or its reply didn't confirm `enabled: false`)
                  // leaves the setting — and the attached debugger — as
                  // they were; without this the button gives no sign the
                  // click didn't take, asymmetric with the Enable flow's
                  // own inline error.
                  if (!ok) {
                    announce("Couldn't disable native mode — try again.", 3000);
                  }
                });
              }}
              title="Turn off native mode and detach the debugger"
            >
              Disable native mode
            </button>
          </>
        ) : (
          <button
            class="sn-toolbar-btn"
            onClick={() => setShowNativeConsent(true)}
            title="Read Chromium's own accessibility tree over the debugger API"
          >
            Enable native mode…
          </button>
        )}

        {producer === "dom" && (
          <div class="sn-toggle-group" role="group" aria-label="Tree view mode">
            <button
              class="sn-toggle-btn"
              aria-pressed={viewMode === "dom"}
              onClick={() => handleViewModeChange("dom")}
            >
              DOM
            </button>
            <button
              class="sn-toggle-btn"
              aria-pressed={viewMode === "a11y"}
              onClick={() => handleViewModeChange("a11y")}
            >
              A11Y
            </button>
            <button
              class="sn-toggle-btn"
              aria-pressed={viewMode === "tab"}
              onClick={() => handleViewModeChange("tab")}
            >
              TAB
            </button>
          </div>
        )}

        {(producer === "dom" ||
          (producer === "native" && nativeModeEnabled)) && (
          <button
            class="sn-pick-btn"
            aria-pressed={pickModeOn}
            onClick={togglePickMode}
            disabled={
              producer === "native" &&
              (nativeTreeTabId === undefined || (!pickModeOn && nativeBusy))
            }
            title={
              pickModeOn
                ? "Pick mode ON — click an element in the page to select it in the tree (Esc to cancel)"
                : producer === "native" && nativeTreeTabId === undefined
                  ? "Load a native tree first"
                  : "Pick an element in the page (Ctrl/Cmd+Shift+C)"
            }
            aria-label="Pick element in page"
          >
            {/* Crosshair-on-cursor glyph mirroring DevTools' picker icon. */}
            {"⦿"}
          </button>
        )}

        <button
          class="sn-curtain-btn"
          aria-pressed={curtainOn}
          onClick={toggleCurtain}
          title={curtainOn ? "Show page content" : "Hide page content"}
        >
          {curtainOn ? "Curtain ON" : "Curtain"}
        </button>

        {producer === "dom" && (
          <button
            class="sn-focus-tracker-btn"
            aria-pressed={focusTrackerOn}
            onClick={toggleFocusTracker}
            title={
              focusTrackerOn
                ? "Focus sync ON — click to disable (useful on focus-heavy pages)"
                : "Focus sync OFF — click to enable"
            }
          >
            {focusTrackerOn ? "Focus sync" : "Focus OFF"}
          </button>
        )}

        {producer === "dom" && (
          <button
            class="sn-toolbar-btn"
            onClick={() => {
              // requestTree stamps myTabId (via sendToBoundTab) so this doesn't
              // race the background's activeTabId update — without that, hitting
              // refresh right after a tab switch would route to the wrong tab.
              requestTree();
              announce("Tree refreshed", 1500);
            }}
            aria-label="Refresh tree"
            title="Refresh tree"
          >
            {"\u21BB"}
          </button>
        )}

        {producer === "dom" && (
          <button
            class="sn-toolbar-btn"
            onClick={handleExpandAll}
            disabled={viewMode === "tab"}
            aria-label="Expand all"
            title="Expand all"
          >
            +
          </button>
        )}
        {producer === "dom" && (
          <button
            class="sn-toolbar-btn"
            onClick={handleCollapseAll}
            disabled={viewMode === "tab"}
            aria-label="Collapse all"
            title="Collapse all"
          >
            -
          </button>
        )}

        <div class="sn-export" ref={exportRef}>
          <button
            class="sn-toolbar-btn sn-export-btn"
            aria-haspopup="true"
            aria-expanded={exportMenuOpen}
            onClick={() => setExportMenuOpen((o) => !o)}
            title="Copy the tree as Markdown — paste into a bug report"
          >
            {"Copy ▾"}
          </button>
          {exportMenuOpen && (
            <div class="sn-export-menu" aria-label="Copy which view">
              <button
                class="sn-export-item"
                onClick={() =>
                  doExport(producer === "native" ? NATIVE_VIEWS : ALL_VIEWS)
                }
              >
                Everything
              </button>
              <button
                class="sn-export-item"
                onClick={() => doExport(["tree"] as ExportView[])}
              >
                {producer === "native"
                  ? "Native tree"
                  : viewMode === "dom"
                    ? "DOM tree"
                    : "A11y tree"}
              </button>
              <button
                class="sn-export-item"
                onClick={() => doExport(["outline"] as ExportView[])}
              >
                Headings
              </button>
              {producer === "dom" && (
                <button
                  class="sn-export-item"
                  onClick={() => doExport(["tab"] as ExportView[])}
                >
                  Tab sequence
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Block-level, NOT a toolbar flex child: its paragraph of consent text
          would otherwise squeeze every other toolbar control (search box,
          curtain, refresh, zoom, copy) into a cramped, wrapped mess. Same
          placement pattern as NativeTreeView's own capability banner. */}
      {showNativeConsent && (
        <NativeConsentBanner
          error={nativeConsentError}
          onEnable={() => {
            setNativeConsentError(undefined);
            void setNativeMode(true).then((ok) => {
              // Only follow a REAL flip with the producer switch — on
              // failure `setNativeMode` already left `showNativeConsent`
              // and `nativeModeEnabled` untouched, so switching to "native"
              // here would show a view the setting was never actually
              // enabled for. Surface the failure inline instead and leave
              // the banner open for a retry.
              if (ok) setProducer("native");
              else
                setNativeConsentError(
                  "Couldn't enable native mode — try again.",
                );
            });
          }}
          onCancel={() => {
            setShowNativeConsent(false);
            setNativeConsentError(undefined);
          }}
        />
      )}

      {/* Role filters — DOM producer only; disabled in tab sequence view */}
      {producer === "dom" && (
        <div class="sn-filters" role="toolbar" aria-label="Filter by role">
          {(
            Object.keys(ROLE_FILTER_LABELS) as Array<Exclude<RoleFilter, null>>
          ).map((key) => (
            <button
              key={key}
              class="sn-filter-btn"
              aria-pressed={roleFilter === key}
              disabled={viewMode === "tab"}
              onClick={() => setRoleFilter(roleFilter === key ? null : key)}
            >
              {ROLE_FILTER_LABELS[key]}
            </button>
          ))}
        </div>
      )}

      {/* Dialog scope indicator — DOM producer only */}
      {producer === "dom" && isDialogScoped && (
        <div class="sn-dialog-indicator" role="status">
          <span class="sn-dialog-label">
            Dialog: {rootNode?.a11y.name || "Modal"}
          </span>
          <button
            class="sn-key-btn"
            onClick={() => handleSendKey("Escape", "Escape", 27)}
            title="Send Escape key to close dialog"
          >
            Press ESC
          </button>
        </div>
      )}

      {/* Scope breadcrumb (when user scoped to a subtree) — DOM producer only */}
      {producer === "dom" && scopedRootId && (
        <div class="sn-scope-bar">
          <button
            class="sn-scope-exit"
            onClick={() => handleScopeToNode(null)}
            title="Exit scope — show full tree"
            aria-label="Exit scope"
          >
            {"\u2715"}
          </button>
          <nav class="sn-breadcrumb" aria-label="Scope path">
            {scopeBreadcrumb.map((item, i) => (
              <span key={item.id} class="sn-breadcrumb-segment">
                {i > 0 && <span class="sn-breadcrumb-sep">{"\u203A"}</span>}
                <button
                  class={`sn-breadcrumb-item${item.id === scopedRootId ? " sn-breadcrumb-item--current" : ""}`}
                  onClick={() => {
                    if (item.id === scopedRootId) return;
                    if (item.id === rootId) {
                      handleScopeToNode(null);
                    } else {
                      handleScopeToNode(item.id);
                    }
                  }}
                  aria-current={
                    item.id === scopedRootId ? "location" : undefined
                  }
                >
                  {item.label}
                </button>
              </span>
            ))}
          </nav>
        </div>
      )}

      {/* Action feedback bar, mounted before there is a message — see the
          search count above. The explicit `aria-live` is deliberate and
          overrides what `role="status"` implies: this bar carries failures
          ("Failed: …", "Clipboard blocked …") that are pulled back out of the
          DOM after 2.5s, and a polite announcement can still be queued behind
          the live-relay log when they go. */}
      <div class="sn-action-feedback" role="status" aria-live="assertive">
        {lastAction && (
          <span class="sn-action-feedback-text">{lastAction}</span>
        )}
      </div>

      {/* Inline input panel for text / select interactions */}
      {inputState && (
        <InputPanel
          state={inputState}
          onSubmit={handleInputSubmit}
          onCancel={handleInputCancel}
        />
      )}

      {nativeModeEnabled && producer === "native" ? (
        /* ---- Native tree view ---- */
        <NativeTreeView
          nodes={nativeNodes}
          rootId={nativeRootId}
          busy={nativeBusy}
          capability={nativeCapability}
          status={nativeStatus}
          onRefresh={() => {
            if (myTabId !== null) void loadNativeTree(myTabId);
          }}
          onActivate={handleNativeActivate}
          reveal={nativePickReveal}
        />
      ) : viewMode === "tab" ? (
        /* ---- Tab sequence view ---- */
        <TabSequenceView
          nodes={nodes}
          rootId={scopedRootId ?? rootId}
          query={query}
          onHighlight={handleSelect}
          onActivate={handleActivate}
          onFocusSearch={focusSearch}
        />
      ) : roleFilter ? (
        /* ---- Filtered list view ---- */
        <FilteredList
          nodes={nodes}
          roleFilter={roleFilter}
          query={query}
          onHighlight={handleSelect}
          onActivate={handleActivate}
          onGoToTree={handleGoToTree}
          onFocusSearch={focusSearch}
        />
      ) : (
        /* ---- Tree view ---- */
        <>
          <div
            ref={containerRef}
            class={`sn-tree-container${isDialogScoped ? " sn-tree-container--dialog" : ""}${scopedRootId ? " sn-tree-container--scoped" : ""}`}
            onScroll={onScroll}
          >
            <div
              ref={treeRef}
              class="sn-tree"
              role="tree"
              aria-label="Semantic tree — press Enter to activate interactive elements; +/− or Shift+Enter to step sliders"
              tabIndex={0}
              style={{
                minHeight: totalHeight,
                paddingTop: offset,
                boxSizing: "border-box",
              }}
              // Focus stays on this container (rows are non-focusable divs), so
              // the active row must be announced via aria-activedescendant —
              // otherwise arrowing through the tree just flips aria-selected on
              // rows the screen reader isn't looking at, and the user hears
              // nothing. Point it at the selected row only while that row is
              // in the virtualized window (offscreen rows are not in the DOM).
              aria-activedescendant={activeDescendantId}
              onKeyDown={(e) => {
                markKeyboard();
                handleKeyDown(e);
              }}
            >
              {visibleNodeIds.slice(startIndex, endIndex).map((id) => {
                const node = asDom(nodes.get(id));
                if (!node) return null;

                const hasChildren = node.childIds.length > 0;
                const actions = node.interaction.actions;
                // Slider / spinbutton rows surface a paired ▼/▲ stepper
                // instead of the single primary-action button — works
                // under the Screen Curtain because the dispatcher drives
                // the value end-to-end without the user touching the
                // page. Suppress the primary button to avoid duplicating
                // "Increment" alongside ▲. Mirrors TreeNode in
                // @real-a11y-dev/semantic-navigator-ui.
                const showStepPair =
                  actions.includes("increment") &&
                  actions.includes("decrement");
                const primaryAction = showStepPair
                  ? null
                  : getPrimaryAction(actions);
                const isSelected = id === selectedId;
                const position = visiblePositions.get(id);
                const displayDepth = scopedRootId
                  ? node.depth - scopedDepthOffset
                  : node.depth;

                return (
                  <div
                    key={id}
                    // id is the aria-activedescendant target for this row. Node
                    // ids are `sn-<n>` / `f<n>-sn-<n>` — already selector- and
                    // id-safe — so `snrow-<id>` is a valid, unique element id.
                    id={`snrow-${id}`}
                    class={[
                      "sn-node",
                      isSelected && "sn-node--selected",
                      node.dom.isHidden && "sn-node--hidden",
                      node.interaction.isInteractive && "sn-node--interactive",
                      id === flashingId && "sn-node--flash",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    role="treeitem"
                    aria-expanded={hasChildren ? node.ui.expanded : undefined}
                    aria-selected={isSelected}
                    aria-level={displayDepth + 1}
                    aria-posinset={position?.posinset}
                    aria-setsize={position?.setsize}
                    data-node-id={id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelect(id);
                    }}
                    onDblClick={(e) => {
                      e.stopPropagation();
                      if (hasChildren && !node.interaction.isInteractive) {
                        handleScopeToNode(id);
                      } else if (node.interaction.isInteractive) {
                        handleActivate(id);
                      }
                    }}
                    onMouseEnter={() => handleHover(id)}
                    onMouseLeave={() => handleHover(null)}
                  >
                    <span class="sn-indent">
                      {Array.from({ length: displayDepth }, (_, i) => (
                        <span key={i} class="sn-indent-unit" />
                      ))}
                    </span>

                    <button
                      class={`sn-toggle ${!hasChildren ? "sn-toggle--leaf" : ""}`}
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasChildren) handleToggle(id);
                      }}
                    >
                      {hasChildren
                        ? node.ui.expanded
                          ? "\u25BE"
                          : "\u25B8"
                        : ""}
                    </button>

                    <span class="sn-label">
                      {viewMode === "dom" ? (
                        <>
                          <span class="sn-tag">
                            {"<"}
                            {node.dom.tagName}
                            {">"}
                          </span>
                          {node.dom.textContent && (
                            <span class="sn-text-content">
                              {node.dom.textContent}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {/* Role — semantic display name */}
                          <span class="sn-role">{getDisplayRole(node)}</span>
                          {/* Heading level badge */}
                          {node.a11y.properties.level && (
                            <span class="sn-level-badge">
                              H{node.a11y.properties.level}
                            </span>
                          )}
                          {/* Iframe embedded content badge */}
                          {node.dom.tagName === "iframe" && (
                            <span class="sn-iframe-badge">embedded</span>
                          )}
                          {node.a11y.name && (
                            <span class="sn-name">{node.a11y.name}</span>
                          )}
                          {/* Descendant-text preview — leaf-only to avoid
                              duplicating what's already in child rows
                              (table/rowgroup, paragraphs with strong/em
                              children, etc.). Fires for `<code>` whose
                              role=presentation spans flattened, `<svg>`
                              with descendant `<text>`, decorative
                              wrappers, etc. Mirrors the shared TreeNode
                              in @real-a11y-dev/semantic-navigator-ui. */}
                          {node.childIds.length === 0 &&
                            node.dom.descendantText !== "" &&
                            node.dom.descendantText !== node.a11y.name && (
                              <span class="sn-name-preview">
                                {node.dom.descendantText}
                              </span>
                            )}
                          {/* Accessible description — from aria-describedby / aria-description */}
                          {node.a11y.description && (
                            <span
                              class="sn-description"
                              title={node.a11y.description}
                            >
                              {node.a11y.description.length > 80
                                ? node.a11y.description.slice(0, 80) + "\u2026"
                                : node.a11y.description}
                            </span>
                          )}
                          {/* Current value for editable fields */}
                          {node.interaction.isEditable &&
                            (() => {
                              const val = node.dom.attributes.value;
                              const inputType =
                                node.dom.attributes.type || "text";
                              if (val) {
                                const display =
                                  inputType === "password"
                                    ? "\u2022".repeat(val.length)
                                    : val;
                                return (
                                  <span class="sn-field-value">
                                    = "{display}"
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          {/* State badges: disabled, checked, required, expanded, etc. */}
                          {(() => {
                            const states = node.a11y.states;
                            const badges: Array<{
                              label: string;
                              cls: string;
                            }> = [];
                            if (states.disabled === true)
                              badges.push({
                                label: "disabled",
                                cls: "sn-state--disabled",
                              });
                            if (states.checked === true)
                              badges.push({
                                label: "checked",
                                cls: "sn-state--on",
                              });
                            if (states.checked === "mixed")
                              badges.push({
                                label: "mixed",
                                cls: "sn-state--mixed",
                              });
                            if (states.pressed === true)
                              badges.push({
                                label: "pressed",
                                cls: "sn-state--on",
                              });
                            if (states.selected === true)
                              badges.push({
                                label: "selected",
                                cls: "sn-state--on",
                              });
                            if (states.expanded === true)
                              badges.push({
                                label: "expanded",
                                cls: "sn-state--info",
                              });
                            if (states.expanded === false)
                              badges.push({
                                label: "collapsed",
                                cls: "sn-state--info",
                              });
                            if (states.required === true)
                              badges.push({
                                label: "required",
                                cls: "sn-state--required",
                              });
                            if (states.readonly === true)
                              badges.push({
                                label: "readonly",
                                cls: "sn-state--info",
                              });
                            if (states.busy === true)
                              badges.push({
                                label: "busy",
                                cls: "sn-state--info",
                              });
                            if (states.current)
                              badges.push({
                                label: `current: ${states.current}`,
                                cls: "sn-state--info",
                              });
                            if (badges.length === 0) return null;
                            return (
                              <span class="sn-state-badges">
                                {badges.map((b) => (
                                  <span
                                    key={b.label}
                                    class={`sn-state-badge ${b.cls}`}
                                  >
                                    {b.label}
                                  </span>
                                ))}
                              </span>
                            );
                          })()}
                          {/* Forward cross-links (aria-controls or heuristic): jump to controlled element(s) */}
                          {controlsIndex.forward.get(id)?.map((targetId) => {
                            const target = asDom(nodes.get(targetId));
                            if (!target) return null;
                            const role = getDisplayRole(target);
                            const name = target.a11y.name;
                            const isInferred = controlsIndex.inferred.has(id);
                            return (
                              <button
                                key={`controls-${targetId}`}
                                class={`sn-controls-link${isInferred ? " sn-controls-link--inferred" : ""}`}
                                tabIndex={-1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleJumpToNode(targetId);
                                }}
                                title={
                                  isInferred
                                    ? `Likely controls this ${role} (inferred from aria-haspopup + aria-expanded; no aria-controls set)`
                                    : `Jump to the ${role} this element controls`
                                }
                              >
                                {"→ "}
                                {role}
                                {name &&
                                  ` "${name.length > 24 ? name.slice(0, 24) + "…" : name}"`}
                              </button>
                            );
                          })}
                          {/* Reverse cross-links: jump back to the trigger(s) controlling this element */}
                          {controlsIndex.reverse.get(id)?.map((triggerId) => {
                            const trigger = asDom(nodes.get(triggerId));
                            if (!trigger) return null;
                            const role = getDisplayRole(trigger);
                            const name = trigger.a11y.name;
                            const isInferred =
                              controlsIndex.inferred.has(triggerId);
                            return (
                              <button
                                key={`controlled-by-${triggerId}`}
                                class={`sn-controls-link sn-controls-link--reverse${isInferred ? " sn-controls-link--inferred" : ""}`}
                                tabIndex={-1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleJumpToNode(triggerId);
                                }}
                                title={
                                  isInferred
                                    ? `Likely controlled by this ${role} (inferred; no aria-controls set on the trigger)`
                                    : `Jump to the ${role} that controls this element`
                                }
                              >
                                {"← "}
                                {role}
                                {name &&
                                  ` "${name.length > 24 ? name.slice(0, 24) + "…" : name}"`}
                              </button>
                            );
                          })}
                        </>
                      )}

                      {primaryAction && (
                        <span class="sn-action-tag">
                          {ACTION_LABELS[primaryAction]}
                        </span>
                      )}
                    </span>

                    {primaryAction && (
                      <button
                        class="sn-action sn-action--visible"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleActivate(id);
                        }}
                        title={`${ACTION_LABELS[primaryAction]} (Enter)`}
                      >
                        {"\u23CE"}
                      </button>
                    )}

                    {/* Slider / spinbutton paired stepper. Order is
                        decrement-then-increment so the visible glyphs
                        read as a single range control. Each button
                        passes its own action to handleActivate so the
                        dispatcher knows which way to step. */}
                    {showStepPair && (
                      <span class="sn-action-pair">
                        <button
                          class="sn-action sn-action--visible sn-action--step"
                          tabIndex={-1}
                          aria-label={ACTION_LABELS.decrement}
                          title={ACTION_LABELS.decrement}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleActivate(id, "decrement");
                          }}
                        >
                          {"\u25BC"}
                        </button>
                        <button
                          class="sn-action sn-action--visible sn-action--step"
                          tabIndex={-1}
                          aria-label={ACTION_LABELS.increment}
                          title={ACTION_LABELS.increment}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleActivate(id, "increment");
                          }}
                        >
                          {"\u25B2"}
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}

              {visibleNodeIds.length === 0 && (
                <div class="sn-empty">
                  {query ? "No matching nodes" : "Empty tree"}
                </div>
              )}
            </div>
          </div>

          <div
            class="sn-keyboard-bar"
            role="toolbar"
            aria-label="Send keyboard events to page"
          >
            <span class="sn-keyboard-label">Send key:</span>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey("Escape", "Escape", 27)}
              title="Send Escape key"
            >
              Esc
            </button>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey("Tab", "Tab", 9)}
              title="Send Tab key"
            >
              Tab
            </button>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey("Tab", "Tab", 9, { shift: true })}
              title="Send Shift+Tab"
            >
              Shift+Tab
            </button>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey("Enter", "Enter", 13)}
              title="Send Enter key"
            >
              Enter
            </button>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey(" ", "Space", 32)}
              title="Send Space key"
            >
              Space
            </button>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey("ArrowDown", "ArrowDown", 40)}
              title="Send Down arrow"
            >
              {"\u2193"}
            </button>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey("ArrowUp", "ArrowUp", 38)}
              title="Send Up arrow"
            >
              {"\u2191"}
            </button>
          </div>

          <div class="sn-hints">
            <kbd>Enter</kbd> activate &middot; <kbd>+/−</kbd> step &middot;{" "}
            <kbd>Space</kbd> expand &middot; <kbd>Arrow</kbd> navigate &middot;{" "}
            <kbd>DblClick</kbd> scope
          </div>
        </>
      )}

      {/* Live region announcements, mounted before the first one arrives —
          see the search count above. Relaying the page's live regions through
          one that is not itself announced defeats the whole feature. */}
      <div class="sn-live-log" role="log" aria-label="Live announcements">
        {liveAnnouncements.map((a) => (
          <div
            key={a.id}
            class={`sn-live-entry ${a.level === "assertive" ? "sn-live-entry--assertive" : ""}`}
          >
            <span class="sn-live-role">{a.role}</span>
            <span class="sn-live-text">{a.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
