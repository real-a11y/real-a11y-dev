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
  JUMP_KEYS,
  JUMP_KEYSHORTCUTS,
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
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
  useId,
} from "preact/hooks";

import type { FieldState } from "../field-state.js";
import {
  blockedBy,
  explainUnavailable,
  type NativeUnavailableReason,
  type TabCapability,
} from "../native/capability.js";
import {
  isTypableRole,
  nativeSelectOptions,
  pickerCurrentOption,
  type NativeNode,
} from "../native/native-actions.js";
import type { NativeAction } from "../native/native-core.js";
import { nativeToExtractionResult } from "../native/native-export.js";
import { NATIVE_MODE_KEY, NATIVE_NOTICE_SEEN_KEY } from "../native/setting.js";
import {
  isTrustedSender,
  isUnreachablePageResponse,
  shouldPanelAcceptMessage,
} from "../routing.js";
import type { ContentToPanel, PanelToContent } from "../types.js";

import { describeAction, describeSelection } from "./action-feedback.js";
import { ControlsChip, JUMP_FLASH_MS } from "./ControlsChip.js";
import {
  buildExportMarkdown,
  ALL_VIEWS,
  NATIVE_VIEWS,
  VIEW_LABELS,
} from "./export.js";
import type { ExportMeta, ExportView, ExportViews } from "./export.js";
import { announcedValueLabel, rawValueLabel } from "./field-value.js";
import { FilteredList } from "./FilteredList.js";
import { InputPanel } from "./InputPanel.js";
import type { InputPanelState } from "./InputPanel.js";
import {
  decideAutoRefresh,
  FOLLOW_PAGE_CHANGES_KEY,
  NATIVE_SETTLE_MS,
  PAGE_SIGNAL_LAG_MS,
  quietPeriodOnSignal,
} from "./native-auto-refresh.js";
import {
  findNativeModalDialog,
  nativeActionFeedback,
} from "./native-feedback.js";
import { NativeTreeView, type NativeReveal } from "./NativeTreeView.js";
import {
  arrowLeftStopsAtScopeRoot,
  describeNode,
  hasChildren,
  isInScope,
  matchCountLabel,
  SCOPE_KEY_HINT,
  scopeKeyAction,
  scopePath,
  subtreeNodes,
} from "./scope.js";
import { ScopeBar } from "./ScopeBar.js";
import {
  DialogIndicator,
  KEYS,
  SendKeyBar,
  sendKeySpec,
} from "./SendKeyBar.js";
import { TabSequenceView } from "./TabSequenceView.js";
import { useNativeOverlay } from "./useNativeOverlay.js";

/** How many settle windows (~5s) `whenNativeIdle` waits for a native read or
 *  action in flight: a sent key's re-read, or an option picked while one ran.
 *  If one is still running after that, the key's read is skipped as any
 *  other would be (Refresh is the way back), and the pick says so. */
const MAX_NATIVE_IDLE_WAITS = 20;

/** How long after a sent key is acknowledged a navigation still counts as the
 *  key's own, and gets the destination read. An async submit handler can
 *  navigate well after the settle window, once the key's re-read has already
 *  read the old page. */
const NATIVE_KEY_NAV_WINDOW_MS = 3_000;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Bound on how many additional navigations `recoverFromOwnNavigation` will
 *  wait out (a login page that immediately client-redirects to a dashboard,
 *  say) before giving up and leaving the recovery to a manual refresh. Caps
 *  the worst case at `MAX_NAV_RECOVERY_HOPS * NATIVE_SETTLE_MS` rather than
 *  waiting on a chain that never settles. */
const MAX_NAV_RECOVERY_HOPS = 5;

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
 * Whether a row may print the node's own text. Never a `<textarea>`'s, in
 * either view: its text content is its markup DEFAULT, not what it holds now
 * (the value line shows that), and for a sensitive field
 * (`autocomplete="one-time-code"`) the default is the secret itself.
 */
function showsTextContent(node: DomSemanticNode): boolean {
  return node.dom.tagName !== "textarea";
}

/**
 * Whether the A11y view may print a leaf's text preview. Not for a node with
 * an announced value (an editor, an ARIA textbox or combobox, a slider's
 * fallback text): the value line already shows what a screen reader reads,
 * and the two are computed differently (block spacing), so comparing them
 * misses and an editor's text prints twice.
 */
function showsTextPreview(node: DomSemanticNode): boolean {
  return node.a11y.value === undefined && showsTextContent(node);
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

/** The name Chrome's debugging bar quotes. */
function extensionName(): string {
  try {
    return chrome.runtime.getManifest().name;
  } catch {
    return "Semantic Navigator";
  }
}

/**
 * The one-time note about Chrome's debugging bar, shown above the native tree
 * until the user acknowledges it. Native mode is on by default and nothing
 * asks first, so this is where the bar gets explained: a bar reading "…
 * started debugging this browser" that nobody mentioned looks like something
 * is wrong. Not a dialog: it takes no focus and blocks nothing, and Turn off
 * is the same switch as the Settings checkbox.
 */
function NativeModeNotice({
  onAcknowledge,
  onTurnOff,
}: {
  onAcknowledge: () => void;
  onTurnOff: () => void;
}) {
  const textId = useId();
  return (
    <div
      class="sn-native-consent-banner"
      role="note"
      aria-label="About Chrome's debugging bar"
    >
      <p id={textId}>
        While {extensionName()} reads a page, Chrome shows a bar across every
        window: “{extensionName()}” started debugging this browser. That's
        expected: it's how the panel reads the tree Chrome itself gives
        assistive technology. Turn it off to have the panel read the page
        itself, with no bar.
      </p>
      <div class="sn-native-consent-actions">
        <button class="sn-toolbar-btn" onClick={onAcknowledge}>
          Got it
        </button>
        <button
          class="sn-toolbar-btn"
          aria-describedby={textId}
          onClick={onTurnOff}
        >
          Turn off
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
  // Whether a page has connected to this panel at all since it opened.
  const everConnected = useRef(false);
  if (connected) everConnected.current = true;
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
  // Latest `pickModeOn`, for listeners and cleanups that must not re-subscribe
  // when it changes. Written during render, not from an effect: an effect
  // runs after the commit, so a click that arms a pick and an Escape right
  // behind it could read the old value.
  const pickModeOnRef = useRef(pickModeOn);
  pickModeOnRef.current = pickModeOn;
  const [inputState, setInputState] = useState<InputPanelState | null>(null);
  const [pageTitle, setPageTitle] = useState<string>("");
  const [pageUrl, setPageUrl] = useState<string>("");
  const [scopedRootId, setScopedRootId] = useState<string | null>(null);
  const [liveAnnouncements, setLiveAnnouncements] = useState<
    Array<{ id: number; text: string; level: string; role: string }>
  >([]);
  const announcementId = useRef(0);

  // ---- Native producer (RFC PR H/#229) ----
  // The capability ships in every build (see background.ts), and is on
  // unless the user turns this setting off — a real `chrome.storage`-backed
  // flag now, not a build-time one. Fetched once on mount via the same
  // NATIVE_FLAG_GET message DogfoodPanel.tsx already used for its own
  // checkbox; NATIVE_FLAG_SET flips it (see `requestNativeMode` below).
  // Every open panel also follows it in storage (see `followNativeSetting`),
  // so a panel in one window agrees with a change made in another.
  const [nativeModeEnabled, setNativeModeEnabledRaw] = useState(false);
  // The same value for callbacks, updated with the state rather than on the
  // next render: two storage changes can land before that render.
  const nativeModeEnabledRef = useRef(false);
  const setNativeModeEnabledState = useCallback((on: boolean) => {
    nativeModeEnabledRef.current = on;
    setNativeModeEnabledRaw(on);
  }, []);
  // The Settings menu (the "Read pages through Chrome" switch), and the turn
  // on or off it has asked for and not had answered: the switch shows that
  // value meanwhile, and goes back if it doesn't take.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [nativeSettingPending, setNativeSettingPending] = useState<
    boolean | null
  >(null);
  // Whether the user has acknowledged the note about Chrome's debugging bar
  // (see `NativeModeNotice`). `null` until storage says, or where the panel
  // runs without extension storage: the note shows only on a definite "no".
  const [nativeNoticeSeen, setNativeNoticeSeen] = useState<boolean | null>(
    null,
  );
  // Whether a native read has succeeded in this panel, which is when Chrome's
  // bar has shown: the note about it waits for that.
  const [nativeEverRead, setNativeEverRead] = useState(false);
  // Setting writes this panel has sent and not yet had answered. Their echo
  // in storage can arrive before the reply, and the reply is what updates
  // this panel, in order, so `followNativeSetting` holds back every change
  // that lands meanwhile, and applies the last one once the writes are
  // answered (`ownWriteDone`): it may have been another window's. Storage
  // reports changes in the order they were written, so the last one held is
  // the setting as it then stood.
  const ownSettingWrites = useRef(0);
  const heldSetting = useRef<{ value: unknown } | null>(null);
  // Bumped each time the panel learns the setting from something newer than
  // its mount-time read: a change in storage, or the reply to its own write.
  // That read's reply is dropped if it lands after one.
  const settingLearned = useRef(0);
  useEffect(() => {
    const learned = settingLearned.current;
    const apply = (on: boolean) => {
      if (settingLearned.current !== learned) return;
      setNativeModeEnabledState(on);
    };
    // The service worker didn't say (not woken yet, a context torn down
    // mid-reload, an internal failure): read the key itself, so Settings
    // shows the setting every other window follows. Where even that fails,
    // the panel stays on the DOM tree, which reads without either.
    const fromStorage = () => {
      void chrome.storage?.local
        ?.get(NATIVE_MODE_KEY)
        .then((r) => apply(r[NATIVE_MODE_KEY] !== false))
        .catch(() => {});
    };
    void chrome.runtime
      .sendMessage({ type: "NATIVE_FLAG_GET" })
      .then((r: { enabled?: unknown } | undefined) => {
        if (typeof r?.enabled === "boolean") apply(r.enabled);
        else fromStorage();
      })
      .catch(fromStorage);
  }, [setNativeModeEnabledState]);

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
  // Written during render, like `pickModeOnRef`, for the same reason.
  const producerRef = useRef<"dom" | "native">(producer);
  producerRef.current = producer;
  const [nativeNodes, setNativeNodes] = useState<Map<string, NativeNode>>(
    new Map(),
  );
  // Read by `dispatchNativeAction` for its feedback wording, through a ref so
  // the callback doesn't change identity on every tree read.
  const nativeNodesRef = useRef(nativeNodes);
  nativeNodesRef.current = nativeNodes;
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
  // When the native tree on screen was read (ISO), for the export's header.
  const [nativeReadAt, setNativeReadAt] = useState<string | undefined>(
    undefined,
  );
  // Native picker's counterpart to `requestReveal`/DOM's `selectedId` +
  // ancestor-expand dance above — NativeTreeView owns its own expand/select
  // state (see that component's own top comment), so the panel can't reach
  // in and set it directly the way it does for the DOM tree. Passed down as
  // a `reveal` prop instead; `nonce` forces the child's effect to re-fire
  // even when the same node is picked twice in a row.
  const [nativePickReveal, setNativePickReveal] = useState<
    NativeReveal | undefined
  >(undefined);
  // A reveal is consumed when the native tree mounts with it, so it must not
  // outlive that tree: switching to DOM and back would remount the tree and
  // apply an old pick again, clearing its search and selecting that row.
  useEffect(() => {
    if (producer !== "native") setNativePickReveal(undefined);
  }, [producer]);
  // The native pick's inspect mode is on (NATIVE_PICK_ARMED arrived). Until
  // then the Pick button is pressed but busy: a page click isn't a pick yet.
  const [nativePickArmed, setNativePickArmed] = useState(false);
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
  // Bumped by the myTabId effect below and by `showNativeOff` (native mode
  // turned off, here or in another window) — NEVER by PAGE_NAVIGATED. A
  // snapshot of this taken before a native op, compared after, tells apart
  // "something that isn't this action's own navigation invalidated it" from
  // "nativeOpToken moved only because PAGE_NAVIGATED fired for the
  // navigation this action itself caused", which `myTabId` equality alone
  // cannot: a rapid tab switch away and back leaves `myTabId` (and a ref
  // mirroring it) reading the same tab id again even though the effect fired
  // twice and cleared the tree — see `dispatchNativeAction`'s own recovery
  // path for why that distinction matters.
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
  // Native auto-refresh: the tree reads itself again once a navigation's new
  // page has settled, and, with "Follow page changes" on, after the page
  // changes and goes quiet — see `native-auto-refresh.ts` for the policy.
  // `armedTab` is the tab a successful read armed it on: a tab switch,
  // leaving native mode, or a failed read clears it, so nothing but a user's
  // Refresh attaches to a tab the user hasn't read, and a refusal or the
  // user's Cancel on Chrome's debugging bar is never answered by another
  // attach. A same-tab navigation leaves it armed.
  const autoRefresh = useRef<{
    armedTab: number | null;
    navigationPending: boolean;
    /** The document the last successful read described (its loader id). */
    readDocument: string | undefined;
    /** The document a pending navigation is leaving: a read that still finds
     *  it, before the new page commits, leaves the navigation pending. */
    leavingDocument: string | undefined;
    lastChangeAt: number;
    lastReadStartedAt: number;
    lastReadEndedAt: number;
    autoReads: number;
    timer: ReturnType<typeof setTimeout> | null;
    /** When the first signal the pending timer answers arrived. */
    signalSince: number | null;
    /** The automatic read in flight, if any. */
    inFlight: Promise<boolean> | null;
  }>({
    armedTab: null,
    navigationPending: false,
    readDocument: undefined,
    leavingDocument: undefined,
    lastChangeAt: 0,
    lastReadStartedAt: 0,
    lastReadEndedAt: 0,
    autoReads: 0,
    timer: null,
    signalSince: null,
    inFlight: null,
  });
  const [followPageChanges, setFollowPageChanges] = useState(false);
  const followPageChangesRef = useRef(followPageChanges);
  followPageChangesRef.current = followPageChanges;
  // Set below, once `loadNativeTree` exists; the timer calls it.
  const runNativeAutoRefresh = useRef<() => void>(() => {});
  const cancelAutoRefreshTimer = useCallback(() => {
    const a = autoRefresh.current;
    a.signalSince = null;
    if (a.timer !== null) {
      clearTimeout(a.timer);
      a.timer = null;
    }
  }, []);
  /** Stop auto-refresh until a read succeeds again: a tab switch, leaving
   *  native mode, or a failed read. */
  const disarmAutoRefresh = useCallback(() => {
    autoRefresh.current.armedTab = null;
    autoRefresh.current.navigationPending = false;
    cancelAutoRefreshTimer();
  }, [cancelAutoRefreshTimer]);
  const scheduleAutoRefresh = useCallback((ms: number) => {
    const a = autoRefresh.current;
    if (a.timer !== null) clearTimeout(a.timer);
    a.timer = setTimeout(() => {
      a.timer = null;
      a.signalSince = null;
      runNativeAutoRefresh.current();
    }, ms);
  }, []);
  useEffect(() => cancelAutoRefreshTimer, [cancelAutoRefreshTimer]);
  // The "Follow page changes" setting, kept in `chrome.storage.local` with
  // native mode's own, and followed while the panel is open.
  useEffect(() => {
    // Absent where the panel runs without extension storage (unit tests).
    if (!chrome.storage?.local || !chrome.storage.onChanged) return;
    const read = (value: unknown) => setFollowPageChanges(value === true);
    void chrome.storage.local
      .get(FOLLOW_PAGE_CHANGES_KEY)
      .then((r) => read(r[FOLLOW_PAGE_CHANGES_KEY]))
      .catch(() => {});
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && FOLLOW_PAGE_CHANGES_KEY in changes) {
        read(changes[FOLLOW_PAGE_CHANGES_KEY]!.newValue);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  const toggleFollowPageChanges = useCallback(() => {
    const next = !followPageChangesRef.current;
    setFollowPageChanges(next);
    void chrome.storage?.local
      ?.set({ [FOLLOW_PAGE_CHANGES_KEY]: next })
      .catch(() => {});
  }, []);
  // Turning native mode off, here or in another window, takes away the native
  // tree and the DOM/NATIVE toggle, and dismissing the note about Chrome's bar
  // takes the note away: whatever had focus can go with them. Each such swap
  // asks (`focusAfterSwap`) for focus to move to the tree on screen (or to
  // Settings, if there is none), and the layout effect below does that as
  // soon as the swap commits, only if focus was lost: focus somewhere that
  // survived the swap stays where the user put it. A layout effect rather
  // than an effect, which waits for a paint: a panel in a window that isn't
  // in front can go without one for a long time.
  const focusSwapPending = useRef(false);
  const [focusSwaps, setFocusSwaps] = useState(0);
  const focusAfterSwap = useCallback(() => {
    focusSwapPending.current = true;
    setFocusSwaps((n) => n + 1);
  }, []);

  /** Drop the native tree and orphan any native read or action in flight.
   *  Bumping `nativeOpToken` makes a late reply recognizably stale to every
   *  `token !== nativeOpToken.current` guard, and because those guards leave
   *  `nativeBusy` set on a stale reply, this is also what clears it. Used by a
   *  tab switch, a navigation and turning native mode off — anything that
   *  makes the native ids in hand meaningless. */
  const resetNativeState = useCallback(() => {
    nativeOpToken.current++;
    setNativeNodes(new Map());
    setNativeRootId("");
    setNativeTreeTabId(undefined);
    setNativeTreeUrl(undefined);
    setNativeReadAt(undefined);
    setNativeStatus("");
    setNativeCapability(undefined);
    setNativeBusy(false);
    // A pick's reveal belongs to the tree it was picked in.
    setNativePickReveal(undefined);
  }, []);

  /** Native mode is off: drop the native tree and return the view to DOM.
   *  For this panel's own Disable, and for one in another window. */
  const showNativeOff = useCallback(() => {
    setNativeModeEnabledState(false);
    // Disabling mid-recovery must also abort `recoverFromOwnNavigation`'s
    // settle loop, the same way a real tab switch does.
    tabChangeToken.current++;
    resetNativeState();
    setProducer("dom");
    // The service worker cancels an armed native pick when native mode goes
    // off, but its NATIVE_PICK_RESULT arrives after `producerRef` has already
    // flipped to "dom", and the handler drops a native result then. Clear
    // the button here instead of waiting for a message that won't land. A
    // DOM pick is the content script's, and carries on in the DOM tree.
    if (producerRef.current === "native") setPickModeOn(false);
    // An edit box or option picker opened from the native tree acts through
    // native mode, which is off now: submitting it would do nothing.
    setInputState((open) => (open?.source === "native" ? null : open));
  }, [resetNativeState, setNativeModeEnabledState]);
  // Native as the default view, on unless the user turned it off: once per
  // panel session, on the first page that connects and that native mode can
  // read. Not on every tab or navigation after that — each of those would
  // attach the debugger with no fresh gesture. Spent by a successful default
  // read, and by turning native mode on in this session (the Settings switch
  // is its own gesture, and its own read).
  const hasAppliedNativeDefault = useRef(false);
  // The tabs the default has failed on (DevTools owns it, a blocked URL, the
  // service worker didn't answer). The default waits for a tab not in here
  // rather than retrying one that is: every retry would attach again, and
  // flash Chrome's bar, for as long as the page stays unreadable. All of
  // them, not just the last: switching A → B → A would otherwise retry A.
  const nativeDefaultFailedOn = useRef(new Set<number>());
  // Why the last native read failed, in words for the fallback announcement.
  // A ref because the default's revert runs after the read, in a promise.
  const lastNativeFailure = useRef("");

  const treeRef = useRef<HTMLDivElement>(null);
  // The role filter's list or the Tab view, whichever shows in the tree's
  // place: where focus goes after leaving the scope from the breadcrumb.
  const listViewRef = useRef<HTMLElement | null>(null);
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

  // The tab this side-panel instance is bound to. Source of truth lives in
  // the background — it pushes ACTIVE_TAB_CHANGED on port connect and on
  // every tab/window activation. We don't try to read tab state from the
  // panel context directly: the side panel's `chrome.tabs` event delivery has
  // been historically quirky, and the background already owns the binding.
  // (The manifest's `tabs` permission exists for native mode's URL reads, not
  // for this.)
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

  /** Show the setting as it stands after a change made outside this panel:
   *  another window's panel turned native mode on or off in its Settings
   *  (each window has its own side panel), or the dogfood build's checkbox
   *  did. A removed key is the default again, which is on. */
  const applyNativeSetting = useCallback(
    (value: unknown) => {
      const on = value !== false;
      settingLearned.current++;
      if (on === nativeModeEnabledRef.current) return;
      if (on) {
        // Not a gesture in this window. A panel that has shown a page
        // doesn't read the next one natively on its own, so its default read
        // is spent: the toolbar offers NATIVE, and nothing attaches until
        // it's pressed. One that has never connected reads the first page
        // that does, as a panel opened with native mode on would.
        if (everConnected.current) hasAppliedNativeDefault.current = true;
        setNativeModeEnabledState(true);
        announce(
          "Reading pages through Chrome is on — NATIVE in the toolbar shows its tree.",
          4000,
        );
        return;
      }
      // The service worker has already detached, and refuses reads, so show
      // what this panel's own turn-off would.
      focusAfterSwap();
      showNativeOff();
      announce(
        "Not reading pages through Chrome — showing the DOM tree.",
        4000,
      );
    },
    [announce, focusAfterSwap, showNativeOff, setNativeModeEnabledState],
  );
  /** A change to the setting in storage. Held while this panel has a write
   *  of its own on its way (see `ownSettingWrites`). */
  const followNativeSetting = useCallback(
    (value: unknown) => {
      if (ownSettingWrites.current > 0) {
        heldSetting.current = { value };
        return;
      }
      applyNativeSetting(value);
    },
    [applyNativeSetting],
  );
  useEffect(() => {
    // Absent where the panel runs without extension storage (unit tests).
    if (!chrome.storage?.onChanged) return;
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "local") return;
      if (NATIVE_MODE_KEY in changes) {
        followNativeSetting(changes[NATIVE_MODE_KEY]!.newValue);
      }
      if (NATIVE_NOTICE_SEEN_KEY in changes) {
        setNativeNoticeSeen(changes[NATIVE_NOTICE_SEEN_KEY]!.newValue === true);
      }
    };
    // Read before a change `onChanged` may already have applied, so it can
    // only add a "seen", never take one back.
    void chrome.storage.local
      ?.get(NATIVE_NOTICE_SEEN_KEY)
      .then((r) =>
        setNativeNoticeSeen(
          (seen) => seen === true || r[NATIVE_NOTICE_SEEN_KEY] === true,
        ),
      )
      .catch(() => {});
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [followNativeSetting]);
  /** One of this panel's own setting writes is answered, or failed, and its
   *  answer applied. Once none is left on its way, the last change held back
   *  meanwhile is applied after it: that write's own echo, which changes
   *  nothing, or another window's answer. */
  const ownWriteDone = useCallback(() => {
    ownSettingWrites.current--;
    if (ownSettingWrites.current > 0) return;
    const held = heldSetting.current;
    heldSetting.current = null;
    if (held) applyNativeSetting(held.value);
  }, [applyNativeSetting]);
  /** Send one of this panel's own writes to the setting. `onReply` gets the
   *  service worker's reply, or `undefined` if it never answered, and runs
   *  before a change held meanwhile is applied (`ownWriteDone`), so what it
   *  does can't undo that change. */
  const ownWrite = useCallback(
    (
      message: { type: "NATIVE_FLAG_SET"; enabled: boolean },
      onReply: (reply: { enabled?: boolean } | undefined) => void,
    ): void => {
      ownSettingWrites.current++;
      let sent: Promise<unknown>;
      try {
        sent = chrome.runtime.sendMessage(message);
      } catch {
        // Thrown rather than rejected, by a torn-down context: never sent.
        sent = Promise.resolve(undefined);
      }
      void sent
        // Never reached the service worker, so nothing was persisted.
        .catch(() => undefined)
        .then((reply) => {
          try {
            onReply(reply as { enabled?: boolean } | undefined);
          } finally {
            ownWriteDone();
          }
        });
    },
    [ownWriteDone],
  );
  /** Asks the service worker to persist the setting. A request, not a state
   *  setter: it can fail, and `answered` hears whether the setting really
   *  changed. `NATIVE_FLAG_SET` replies `{ok: false}` from its outer catch on
   *  an internal failure rather than rejecting, so a reply alone doesn't mean
   *  it took. Turning native mode off also drops the native tree and returns
   *  the view to DOM; the service worker detaches the debugger as soon as any
   *  operation in flight finishes. */
  const requestNativeMode = useCallback(
    (next: boolean, answered: (took: boolean) => void): void => {
      ownWrite({ type: "NATIVE_FLAG_SET", enabled: next }, (reply) => {
        const took = reply?.enabled === next;
        if (took) {
          settingLearned.current++;
          if (next) {
            setNativeModeEnabledState(true);
          } else {
            focusAfterSwap();
            showNativeOff();
          }
        }
        answered(took);
      });
    },
    [ownWrite, focusAfterSwap, showNativeOff, setNativeModeEnabledState],
  );
  /** The Settings switch, and the note's Turn off: turn native mode on or off
   *  in every window. Turning it on here is this panel's gesture, so it reads
   *  the page natively at once; turning it off detaches as soon as anything
   *  in flight finishes. `took` runs once the change is stored. */
  const setNativeModeFromSettings = useCallback(
    (next: boolean, took?: () => void) => {
      if (
        nativeSettingPending !== null ||
        next === nativeModeEnabledRef.current
      ) {
        return;
      }
      setNativeSettingPending(next);
      // This switch is the session's gesture, and the read it starts below is
      // the session's first native read, so the default has nothing left to
      // do. Set before the request: the default's effect runs as soon as the
      // setting flips.
      const defaultWasApplied = hasAppliedNativeDefault.current;
      if (next) hasAppliedNativeDefault.current = true;
      requestNativeMode(next, (stored) => {
        setNativeSettingPending(null);
        if (!stored) {
          hasAppliedNativeDefault.current = defaultWasApplied;
          announce("Couldn't change that setting — try again.", 3000);
          return;
        }
        took?.();
        if (next) {
          setProducer("native");
          announce("Reading pages through Chrome — showing its tree.", 3000);
        } else {
          announce(
            "Not reading pages through Chrome — showing the DOM tree.",
            3000,
          );
        }
      });
    },
    [announce, nativeSettingPending, requestNativeMode],
  );
  const acknowledgeNativeNotice = useCallback(() => {
    setNativeNoticeSeen(true);
    void chrome.storage?.local
      ?.set({ [NATIVE_NOTICE_SEEN_KEY]: true })
      .catch(() => {});
  }, []);

  // The native tree's page outline: a settled selection's reveal and a
  // hovered row's preview (see `useNativeOverlay`).
  const {
    reveal: revealNativeRow,
    preview: previewNativeRow,
    resumePreviews,
  } = useNativeOverlay({
    enabled: nativeModeEnabled,
    tabId: nativeTreeTabId,
    busy: nativeBusy,
    curtainOn,
    pickArmed: pickModeOn,
    // An automatic read doesn't change the ids an overlay names (same
    // document), and the service worker queues the overlay behind it, so
    // only a read or action the user started holds one back.
    userOpInFlight: () =>
      nativeInFlight.current && autoRefresh.current.inFlight === null,
    announce,
  });

  /** Focus lost to something that went away (left on the body) moves to the
   *  tree on screen, or the list shown in its place, or Settings if there is
   *  neither. Focus anywhere else stays where the user put it. */
  const refocusIfLost = useCallback(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    [
      document.querySelector<HTMLElement>('[role="tree"]'),
      listViewRef.current,
      settingsButtonRef.current,
    ]
      .find((el) => el?.isConnected)
      ?.focus();
  }, []);
  // See `focusAfterSwap`.
  useLayoutEffect(() => {
    if (!focusSwapPending.current) return;
    focusSwapPending.current = false;
    refocusIfLost();
  }, [focusSwaps, refocusIfLost]);

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
    tabChangeToken.current++;
    resetNativeState();
    // Auto-refresh follows the tab a read succeeded on, never the one the
    // panel just moved to — that one waits for Refresh, like the auto-load.
    disarmAutoRefresh();
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
  }, [myTabId, requestTree, resetNativeState, disarmAutoRefresh]);

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
        resetNativeState();
        // Auto-refresh stays armed: the new page's content script reports it
        // with a TREE_DATA, and that reads it, once. A pending read for the
        // old page is dropped, and the back-off starts over: the gap a quiet
        // page built up must not leave the new page's tree empty that long.
        const a = autoRefresh.current;
        cancelAutoRefreshTimer();
        a.navigationPending = a.armedTab !== null;
        a.leavingDocument = a.readDocument;
        a.lastReadStartedAt = 0;
        a.lastReadEndedAt = 0;
        a.autoReads = 0;
        followKeyNavigationRef.current();
        return;
      }

      // The content script sends a tree after every burst of page changes,
      // whichever producer the panel shows, so it is native auto-refresh's
      // "the page changed" signal too — the top frame's only, since the
      // native read covers the top frame.
      if (
        message.type === "TREE_DATA" &&
        message.payload.topFrameChanged === true &&
        producerRef.current === "native"
      ) {
        const a = autoRefresh.current;
        const now = Date.now();
        a.lastChangeAt = now - PAGE_SIGNAL_LAG_MS;
        const next = quietPeriodOnSignal(a.signalSince, now);
        if (next.kind === "restart") {
          a.signalSince ??= now;
          scheduleAutoRefresh(next.ms);
        }
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

      // Only while the DOM tree is the one showing. Focus tracking keeps
      // reporting while native is on screen (its toggle is hidden there, not
      // off), and following it would move the hidden DOM selection, and leave
      // a hidden DOM scope that doesn't hold the focused node: "Showing the
      // full tree" announced over a native tree that is still scoped, and the
      // DOM scope gone when the user switches back.
      if (message.type === "FOCUS_CHANGED" && producerRef.current === "dom") {
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
        setNativePickArmed(false);
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
        } else if (message.payload.timedOut) {
          announce("Pick ended: nothing was clicked within a minute.", 4000);
        }
      }

      if (message.type === "NATIVE_PICK_ARMED") {
        if (message.requestId !== nativePickRequestId.current) return;
        if (producerRef.current === "native") setNativePickArmed(true);
      }
    };

    chrome.runtime.onMessage.addListener(handler);

    // No initial REQUEST_TREE here — the myTabId effect above sends one as
    // soon as we know which tab we're bound to.

    return () => {
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, [resetNativeState, announce]);

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
    let count = applySearchFilter(nodes, query, viewMode, roleFilter);
    // Scoped, the count covers only what the scoped tree can show. The
    // whole-tree pass above still runs first so every node's `matchesFilter`
    // is right the moment the scope is left; the second pass over just the
    // subtree sets the same flags for the nodes inside it (their visibility
    // depends only on their own subtree) and returns the scoped count.
    if (scopedRootId && nodes.has(scopedRootId)) {
      count = applySearchFilter(
        subtreeNodes(nodes, scopedRootId),
        query,
        viewMode,
        roleFilter,
      );
    }
    updateMatchCount(count);
    forceRender((n) => n + 1);
  }, [query, nodes, viewMode, roleFilter, scopedRootId, updateMatchCount]);

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
      // A row the search hides is not in the visible list, so the selection
      // would point at nothing a keyboard or screen reader can reach: clear
      // the search, as the native tree's jump does.
      if (asDom(nodes.get(targetId))?.ui.matchesFilter === false) {
        updateQuery("");
      }
      // Through the ordinary selection path, so the page highlights the
      // target as it does for any other selection.
      handleSelect(targetId);
      setFlashingId(targetId);
      setTimeout(() => setFlashingId(null), JUMP_FLASH_MS);
      // Reveal the row even if it is already the selection (jump chips can
      // target the current node); the reveal effect scrolls once ancestors
      // are expanded and `visibleNodeIds` recomputed.
      requestReveal(targetId);
    },
    [nodes, requestReveal, handleSelect, updateQuery],
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
              valueWithheld: response.valueWithheld === true,
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
        // Worded by the same `describeAction` as the native tree's.
        const feedback = describeAction(
          { role, name, checked: node.a11y.states.checked },
          primaryAction,
        );
        if (feedback) announce(feedback, 2000);
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

  /**
   * Wait out an automatic read in flight, for an operation the user started
   * that would otherwise be dropped by `nativeInFlight`. Resolves false when
   * the tab or document changed meanwhile, so the operation, which named
   * nodes and a tab as they stood, no longer applies.
   */
  const waitForAutoRead = useCallback(async (): Promise<boolean> => {
    const pending = autoRefresh.current.inFlight;
    if (!pending) return true;
    const op = nativeOpToken.current;
    const tab = tabChangeToken.current;
    await pending.catch(() => false);
    return nativeOpToken.current === op && tabChangeToken.current === tab;
  }, []);

  /** Read the native tree into state. Mirrors DogfoodPanel's readTreeInto,
   *  minus its own flat-list bookkeeping — NativeTreeView owns expand state.
   *  Returns whether the read succeeded — the native-default effect below is
   *  the one caller that needs to tell a real failure apart from a read that
   *  just got superseded by something else.
   *
   *  UNGUARDED by `nativeInFlight` — `dispatchNativeAction`'s own re-read
   *  step calls this directly (not the guarded `loadNativeTree` below) so
   *  that its own held guard doesn't make its post-action re-read a silent
   *  no-op. Never call this one from anywhere else; call `loadNativeTree`.
   *
   *  `auto` marks a read auto-refresh started rather than the user. It runs
   *  unseen: no busy state (which would disable the toolbar and row buttons
   *  under the user's focus), no "reading…" or node-count status (the status
   *  line is a live region, so that would be announced on every read), and
   *  on failure the tree stays as it was. The service worker doesn't retry a
   *  dropped attach for it either, since the drop may be the user's Cancel
   *  on Chrome's bar. Any other read starts auto-refresh's back-off over. */
  const loadNativeTreeCore = useCallback(
    async (
      tabId: number,
      { auto = false }: { auto?: boolean } = {},
    ): Promise<boolean> => {
      if (!nativeModeEnabled) return false;
      const token = nativeOpToken.current;
      const a = autoRefresh.current;
      a.lastReadStartedAt = Date.now();
      a.autoReads = auto ? a.autoReads + 1 : 0;
      if (!auto) {
        setNativeBusy(true);
        // A read on a tab with a pick armed queues behind the pick, which
        // ends only with a click, Escape or its time limit. Say so.
        setNativeStatus(
          pickModeOnRef.current && producerRef.current === "native"
            ? "waiting for the pick to end — click an element on the page, or press Esc"
            : "reading native tree…",
        );
      }
      try {
        const r = (await chrome.runtime.sendMessage({
          type: "NATIVE_READ",
          tabId,
          ...(auto ? { auto: true } : {}),
        })) as {
          ok?: boolean;
          error?: string;
          reason?: NativeUnavailableReason;
          nodes?: NativeNode[];
          rootId?: string;
          url?: string;
          documentId?: string;
        };
        if (token !== nativeOpToken.current) return false; // tab switched mid-flight
        if (!r?.ok) {
          // Any failed read stops auto-refresh until the next one succeeds:
          // answering a refusal, or the user's Cancel, with another attach
          // is exactly what it must not do.
          disarmAutoRefresh();
          if (auto) {
            const why = r?.reason
              ? explainUnavailable(r.reason)
              : r?.error === "cancelled-by-user"
                ? "you cancelled Chrome's debugging bar"
                : `read failed: ${r?.error ?? "unknown"}`;
            if (r?.reason) setNativeCapability(blockedBy(r.reason));
            setNativeStatus(`auto-refresh paused — ${why}; Refresh to resume`);
            return false;
          }
          setNativeNodes(new Map());
          setNativeRootId("");
          if (r?.reason) {
            setNativeCapability(blockedBy(r.reason));
            lastNativeFailure.current = explainUnavailable(r.reason);
            setNativeStatus(
              `native unavailable — ${lastNativeFailure.current}`,
            );
          } else {
            lastNativeFailure.current =
              r?.error === "cancelled-by-user"
                ? "you cancelled Chrome's debugging bar"
                : `read failed: ${r?.error ?? "unknown"}`;
            setNativeStatus(lastNativeFailure.current);
          }
          return false;
        }
        const read = new Map((r.nodes ?? []).map((n) => [n.id, n]));
        setNativeNodes(read);
        // Ahead of the render, for a caller that looks at what it just read.
        nativeNodesRef.current = read;
        setNativeRootId(r.rootId ?? "");
        setNativeTreeTabId(tabId);
        setNativeEverRead(true);
        setNativeTreeUrl(r.url);
        setNativeReadAt(new Date().toISOString());
        // A successful read is proof any standing refusal no longer holds —
        // same reasoning as DogfoodPanel's identical line — previews too.
        setNativeCapability(undefined);
        resumePreviews(tabId);
        if (!auto) setNativeStatus(`${r.nodes?.length ?? 0} nodes`);
        a.armedTab = tabId;
        // Only a read of another document answers a pending navigation. The
        // panel hears of one before the new page commits, and until then the
        // old page can still change and be read — that read must not stand
        // for the new page's, or the new page is never read at all.
        if (r.documentId === undefined || r.documentId !== a.leavingDocument) {
          a.navigationPending = false;
        }
        a.readDocument = r.documentId;
        return true;
      } finally {
        a.lastReadEndedAt = Date.now();
        if (!auto && token === nativeOpToken.current) setNativeBusy(false);
      }
    },
    [nativeModeEnabled, disarmAutoRefresh, resumePreviews],
  );

  /** Guarded entry point for a user- or effect-triggered read (refresh
   *  button, auto-load). Excludes a second read/act while one is in flight —
   *  see `nativeInFlight`'s own declaration. Propagates `loadNativeTreeCore`'s
   *  success/failure so the native-default effect can tell them apart. */
  const loadNativeTree = useCallback(
    async (tabId: number, opts?: { auto?: boolean }): Promise<boolean> => {
      // The user's read waits for an automatic one rather than being dropped
      // by the in-flight guard below: the user didn't start that one, so it
      // mustn't cost them a click.
      if (!opts?.auto && !(await waitForAutoRead())) return false;
      if (!nativeModeEnabled || nativeInFlight.current) return false;
      nativeInFlight.current = true;
      try {
        return await loadNativeTreeCore(tabId, opts);
      } finally {
        nativeInFlight.current = false;
      }
    },
    [nativeModeEnabled, loadNativeTreeCore, waitForAutoRead],
  );

  // Re-pointed every render so the timer always decides with the current
  // `loadNativeTree` and mode; everything else it reads is a ref.
  runNativeAutoRefresh.current = () => {
    const a = autoRefresh.current;
    const decision = decideAutoRefresh(
      {
        mode: followPageChangesRef.current ? "changes" : "navigation",
        armedTab: a.armedTab,
        boundTab: myTabIdRef.current,
        native: nativeModeEnabled && producerRef.current === "native",
        navigationPending: a.navigationPending,
        lastChangeAt: a.lastChangeAt,
        lastReadStartedAt: a.lastReadStartedAt,
        lastReadEndedAt: a.lastReadEndedAt,
        autoReads: a.autoReads,
        busy: nativeInFlight.current || pickModeOnRef.current,
      },
      Date.now(),
    );
    if (decision.kind === "wait") scheduleAutoRefresh(decision.ms);
    else if (decision.kind === "read") {
      // A reply that never arrives (an unreachable service worker) attached
      // nothing, so it leaves auto-refresh armed for the next change.
      const read = loadNativeTree(decision.tabId, { auto: true }).catch(
        () => false,
      );
      a.inFlight = read;
      void read.finally(() => {
        if (a.inFlight === read) a.inFlight = null;
      });
    }
  };

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
  // Leaving native mode also disarms auto-refresh, so re-entering starts from
  // that one read.
  useEffect(() => {
    if (producer !== "dom") return;
    hasAutoLoadedNative.current = false;
    disarmAutoRefresh();
  }, [producer, disarmAutoRefresh]);

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
      // Left the tab or native mode: a read now would attach
      // `chrome.debugger` for a tree nobody is looking at.
      const abandoned = () =>
        tabChangeToken.current !== tabChangeAtStart ||
        producerRef.current !== "native";
      let lastSeenToken = nativeOpToken.current;
      for (let hop = 0; hop < MAX_NAV_RECOVERY_HOPS; hop++) {
        if (abandoned()) return;
        await sleep(NATIVE_SETTLE_MS);
        if (abandoned()) return;
        if (nativeOpToken.current === lastSeenToken) break; // no further nav during the wait — settled
        lastSeenToken = nativeOpToken.current;
      }
      await loadNativeTreeCore(tabId);
    },
    [loadNativeTreeCore],
  );

  /** Wait, bounded (~5 s), for a native read or action in flight to finish,
   *  for an operation that mustn't be skipped just because one is running.
   *  Resolves false if one is still running after that. */
  const whenNativeIdle = useCallback(async (): Promise<boolean> => {
    for (let wait = 0; nativeInFlight.current; wait++) {
      if (wait >= MAX_NATIVE_IDLE_WAITS) return false;
      await sleep(NATIVE_SETTLE_MS);
    }
    return true;
  }, []);

  /** The tail every native operation that can change the page shares (an
   *  action, a sent key): let the page settle, then read it again — or, when
   *  the operation navigated, read the destination through
   *  `recoverFromOwnNavigation`. `token` and `tabChangeAtStart` are taken
   *  before the operation, so its own navigation shows as a moved token. A
   *  navigation that starts while the re-read is under way supersedes the
   *  read, and is followed the same way. Skipped once the panel has left the
   *  tab or native mode. The caller holds `nativeInFlight`: this reads
   *  through the unguarded core. Resolves whether it read the page the
   *  operation ran on — not when the read failed or the page navigated. */
  const settleThenReread = useCallback(
    async (
      tabId: number,
      token: number,
      tabChangeAtStart: number,
    ): Promise<boolean> => {
      const abandoned = () =>
        tabChangeToken.current !== tabChangeAtStart ||
        producerRef.current !== "native";
      // Always settle before checking staleness or reading again — even when
      // `nativeOpToken` already moved (a same-tab link click can make
      // PAGE_NAVIGATED, fired on `onBeforeNavigate` in background.ts, win the
      // race against the operation's own round trip). Reading immediately
      // would race the navigation and land on the old document, or on a new
      // one that hasn't settled yet. Still a single best-effort attempt, not
      // a wait-for-load: a destination slower than NATIVE_SETTLE_MS can come
      // back sparse, and Refresh is there either way.
      await sleep(NATIVE_SETTLE_MS);
      if (abandoned()) return false;
      if (token !== nativeOpToken.current) {
        await recoverFromOwnNavigation(tabId, tabChangeAtStart);
        return false;
      }
      const ok = await loadNativeTreeCore(tabId);
      if (!ok && token !== nativeOpToken.current && !abandoned()) {
        await recoverFromOwnNavigation(tabId, tabChangeAtStart);
      }
      return ok;
    },
    [loadNativeTreeCore, recoverFromOwnNavigation],
  );

  // The default itself (see `hasAppliedNativeDefault`). It waits for
  // `connected`, as the producer toggle does: the DOM producer reaching the
  // tab first is what proves there is a page there at all.
  //
  // It reads through the guarded `loadNativeTree` itself rather than leaving
  // the auto-load effect to do it, because it has to know whether the read
  // worked: setting `hasAutoLoadedNative` up front stops a duplicate read, and
  // a failure reverts to DOM, says why, and leaves the default for the next
  // tab. A read some other operation superseded (the `token` check) leaves
  // whatever that operation left alone.
  useEffect(() => {
    if (!nativeModeEnabled || !connected || myTabId === null) return;
    if (hasAppliedNativeDefault.current) return;
    // Already native by another path in the same window (a manual NATIVE
    // click): nothing is left to default, and a second read here could only
    // undo the user's choice if it failed. The session's default is spent.
    if (producerRef.current === "native") {
      hasAppliedNativeDefault.current = true;
      return;
    }
    if (nativeDefaultFailedOn.current.has(myTabId)) return;
    // Another read is in flight (a refresh, an action's re-read). Reading
    // now would come back `false` because it's busy, not because the page
    // can't be read, so wait: `nativeBusy` is a dependency, and this runs
    // again once that read clears.
    if (nativeInFlight.current) return;
    hasAppliedNativeDefault.current = true;
    const tabId = myTabId;
    const token = nativeOpToken.current;
    const revertDefault = (why: string) => {
      if (token !== nativeOpToken.current) return;
      hasAppliedNativeDefault.current = false;
      hasAutoLoadedNative.current = false;
      nativeDefaultFailedOn.current.add(tabId);
      setProducer("dom");
      // NativeTreeView, where the reason would otherwise show, unmounts with
      // the switch, so announce it.
      announce(`Native mode: showing the DOM tree — ${why}`, 8000);
    };
    setProducer("native");
    hasAutoLoadedNative.current = true;
    void loadNativeTree(tabId)
      .then((ok) => {
        if (!ok) revertDefault(lastNativeFailure.current || "read failed");
      })
      // sendMessage rejected outright: the service worker didn't wake, or the
      // context was torn down.
      .catch(() => revertDefault("the extension didn't answer"));
  }, [
    nativeModeEnabled,
    connected,
    myTabId,
    nativeBusy,
    loadNativeTree,
    announce,
  ]);

  /** Dispatch one native action and, on success, settle + re-read — the same
   *  two-step DogfoodPanel's runAct uses, so a click that opens a menu or
   *  re-renders a list doesn't leave the tree showing backendDOMNodeIds the
   *  page has already discarded. */
  const dispatchNativeAction = useCallback(
    async (
      nodeId: string,
      // A preview is `useNativeOverlay`'s, never a user's action.
      action: Exclude<NativeAction, "preview">,
      value?: string,
      opts: {
        /** Say this on success instead of the action's own wording — a
         *  sensitive select's choice, which mustn't name the option. */
        feedback?: string;
      } = {},
    ) => {
      // The click named a node of the tree as it stood (see
      // `waitForAutoRead`).
      if (!(await waitForAutoRead())) return;
      if (!nativeModeEnabled || nativeInFlight.current) return;
      nativeInFlight.current = true;
      try {
        const token = nativeOpToken.current;
        const tabChangeAtStart = tabChangeToken.current;
        // Worded from the node as it is before the action, so a checked
        // checkbox reads "Unchecked" — and from its name, never its id.
        const feedback =
          opts.feedback ??
          nativeActionFeedback(
            nativeNodesRef.current.get(nodeId),
            action,
            nativeNodesRef.current,
          );
        // Every failure is reported where the DOM tree reports its own, in
        // the feedback bar; the status line alone is easy to miss.
        const fail = (why: string) => {
          setNativeStatus(why);
          announce(`Failed: ${why}`, 3000);
        };
        if (nativeTreeTabId === undefined) {
          fail("load a tree first");
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
          fail("page navigated — reload the native tree");
          return;
        }
        setNativeBusy(true);
        try {
          type ActReply = {
            success?: boolean;
            error?: string;
            reason?: NativeUnavailableReason;
          };
          let r: ActReply | undefined;
          try {
            r = (await chrome.runtime.sendMessage({
              type: "NATIVE_ACT",
              tabId,
              nodeId,
              action,
              ...(value !== undefined ? { value } : {}),
            })) as ActReply;
          } catch {
            // The service worker didn't wake, or the context was torn down.
            if (token === nativeOpToken.current) {
              fail("the extension didn't answer");
            }
            return;
          }
          if (!r?.success) {
            // Only report a failure that still describes the tab we asked
            // about — a reply superseded by a tab switch or navigation is
            // dropped silently, matching every other stale-token check in
            // this file, rather than surfacing an error for an action whose
            // page may already be gone.
            if (token === nativeOpToken.current) {
              if (r?.reason) {
                setNativeCapability(blockedBy(r.reason));
                fail(`native unavailable — ${explainUnavailable(r.reason)}`);
              } else if (r?.error === "cancelled-by-user") {
                fail("you cancelled Chrome's debugging bar");
              } else {
                fail(r?.error ?? "unknown");
              }
            }
            return;
          }
          // Only toast a still-fresh success — a reply that arrived after
          // the token already moved (a real tab switch racing the round
          // trip) belongs to a tab the panel has since left, and toasting it
          // would name an action for a page no longer on screen.
          if (token === nativeOpToken.current && feedback) {
            announce(feedback, 2000);
          }
          await settleThenReread(tabId, token, tabChangeAtStart);
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
      settleThenReread,
      announce,
      waitForAutoRead,
    ],
  );

  const handleNativeActivate = useCallback(
    (
      node: NativeNode,
      explicitAction?: "increment" | "decrement" | "select",
    ) => {
      if (!nativeModeEnabled) return;
      // A real `<select>` opens the same option picker the DOM tree's does,
      // listing its own option rows from the tree already read. Checked
      // before an explicit `select`, which a role-filter list passes for any
      // row it offers selection on: dispatched on the `<select>` itself it
      // would only be refused, since only an option can be selected.
      if (explicitAction === undefined || explicitAction === "select") {
        const options = nativeSelectOptions(node, nativeNodesRef.current);
        if (options.length > 0) {
          // A disabled select can't be changed on the page, so it can't be
          // here either.
          if (node.states?.["disabled"] === true) {
            announce(`${node.name || node.role} is disabled`, 2500);
            return;
          }
          // No current option for a select whose value is withheld — see
          // the gate's own doc.
          const current = pickerCurrentOption(node, options);
          setInputState({
            type: "select",
            nodeId: node.id,
            label: node.name || node.role,
            value: current?.name ?? "",
            // Each option is named by its own row id, which a submit
            // dispatches `select` on.
            options: options.map((o) => ({
              value: o.id,
              label: o.name || o.role,
              selected: o === current,
              ...(o.states?.["disabled"] === true ? { disabled: true } : {}),
            })),
            source: "native",
            valueWithheld: node.valueWithheld !== false,
          });
          return;
        }
      }
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
      //
      // Prefilled from `rawValue`, not `value`: `value` is what a screen
      // reader announces, whitespace-collapsed and capped at 240 characters,
      // so an unedited submit of it would flatten a textarea's line breaks
      // or cut a long value short. `rawValue` is an input's or textarea's
      // text as it is. An editor has none — the tree shows its text, but a
      // retype replaces the whole of it — so it opens empty too, and gets
      // the same empty-submit block: an unedited Enter must not wipe it.
      const isRedacted = node.redacted === true;
      const unprefillable =
        isRedacted || (node.value !== undefined && node.rawValue === undefined);
      if (isTypableRole(node.role, node.states)) {
        setInputState({
          type: "text",
          nodeId: node.id,
          label: node.name || node.role,
          value: isRedacted ? "" : (node.rawValue ?? ""),
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
          blockEmptySubmit: unprefillable,
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
        // A native option picker's value is the chosen option's row id, and
        // selecting means acting on that option, not on the `<select>`. The
        // picker has closed, so a choice made while another native operation
        // holds the line waits for it rather than being dropped unseen.
        if (inputState.type === "select") {
          const option =
            inputState.options?.find((o) => o.value === value)?.label ?? "";
          const feedback = describeSelection(
            inputState.label,
            option,
            inputState.valueWithheld === true,
          );
          // The option's id belongs to the tree it was chosen from. A tab
          // switch or a navigation while this waits drops that tree, and
          // the choice with it: `dispatchNativeAction` below is this
          // render's, still bound to the tab the panel has left.
          const token = nativeOpToken.current;
          void whenNativeIdle().then((idle) => {
            if (token !== nativeOpToken.current) return;
            if (!idle) {
              announce(
                "Failed: the panel is busy — choose the option again",
                3000,
              );
              return;
            }
            void dispatchNativeAction(value, "select", undefined, { feedback });
          });
          return;
        }
        // An untouched empty submit never gets here: InputPanel cancels it
        // when `blockEmptySubmit` is set (see its doc). An empty value that
        // does arrive was typed and cleared on purpose — "empty this field".
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
          const option =
            inputState?.options?.find((o) => o.value === value)?.label ?? value;
          announce(
            actionType === "select"
              ? describeSelection(
                  inputState?.label ?? name,
                  option,
                  inputState?.valueWithheld === true,
                )
              : `Typed in ${name}`,
            2000,
          );
          // Re-extract tree to reflect new values
          setTimeout(reExtract, 100);
        },
      );
      setInputState(null);
    },
    [
      nodes,
      inputState,
      sendToBoundTab,
      reExtract,
      dispatchNativeAction,
      whenNativeIdle,
      announce,
    ],
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
      setNativePickArmed(false);
      void chrome.runtime
        .sendMessage({
          type: next ? "NATIVE_PICK_START" : "NATIVE_PICK_STOP",
          tabId: nativeTreeTabId,
          requestId: nativePickRequestId.current,
        })
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

  // Cancel an armed native pick when the panel leaves its tab: a tab switch,
  // or `nativeTreeTabId` resetting to `undefined` (which covers turning
  // native mode off), or the panel unmounting. Otherwise inspect mode stays
  // up on the page and the button stays "on" waiting for a result the panel
  // may never see.
  //
  // It depends on `nativeTreeTabId` alone. `pickModeOn` flips false whenever
  // a pick finishes normally, and re-running the cleanup then would send a
  // STOP for a pick that's already over. `producer` is left out because
  // `switchProducer` sends its own STOP for the producer being left.
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
      setNativePickArmed(false);
      void chrome.runtime
        .sendMessage({
          type: "NATIVE_PICK_STOP",
          tabId,
          requestId: nativePickRequestId.current,
        })
        .catch(() => {});
    };
  }, [nativeTreeTabId]);

  // Escape in the panel cancels an armed native pick. (Escape on the page is
  // Chromium's: `runPick` hears `Overlay.inspectModeCanceled`.) Mounted once
  // and reading refs, so the listener is in place before the click that arms
  // a pick, rather than subscribing after the commit that turns it on.
  const togglePickModeRef = useRef(togglePickMode);
  togglePickModeRef.current = togglePickMode;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (producerRef.current !== "native" || !pickModeOnRef.current) return;
      e.preventDefault();
      togglePickModeRef.current();
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
      const node = id ? asDom(nodes.get(id)) : undefined;
      if (node) node.ui.expanded = true;
      setScopedRootId(id);
      forceRender((n) => n + 1);
      // Scoping swaps the whole tree out from under a screen reader, and the
      // bar that shows it sits outside the tree — say what happened.
      announce(
        node
          ? `Scoped to ${describeNode(getDisplayRole(node), node.a11y.name)}`
          : "Showing the full tree",
        2500,
      );
    },
    [nodes, announce],
  );

  // Native's scope, held here rather than in NativeTreeView so Copy can
  // export the same subtree the tree shows, as it does for DOM.
  const [nativeScopedRootId, setNativeScopedRootId] = useState<string | null>(
    null,
  );
  const handleNativeScope = useCallback(
    (id: string | null) => {
      const node = id ? nativeNodes.get(id) : undefined;
      setNativeScopedRootId(node ? node.id : null);
      announce(
        node
          ? `Scoped to ${describeNode(node.role, node.name)}`
          : "Showing the full tree",
        2500,
      );
    },
    [nativeNodes, announce],
  );
  // Drop a scope whose node a re-read no longer has — the same rule DOM's
  // TREE_DATA handler applies. Every native teardown (tab switch,
  // navigation, leaving native mode) empties `nativeNodes`, so this also
  // covers all of those without each one clearing the scope itself.
  useEffect(() => {
    setNativeScopedRootId((prev) =>
      prev && !nativeNodes.has(prev) ? null : prev,
    );
  }, [nativeNodes]);

  /** Send a key to whatever has focus on the page, through the content
   *  script's `SEND_KEY`, and say so once it lands. `onDone` runs when the
   *  content script answers, or fails to: the moment the key has been
   *  dispatched, which is where a re-read's settle window starts. */
  const sendKeyOnly = useCallback(
    (
      key: string,
      code: string,
      keyCode: number,
      modifiers?: { shift?: boolean },
      onDone?: () => void,
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
          onDone?.();
        },
      );
    },
    [sendToBoundTab, announce],
  );

  const handleSendKey = useCallback(
    (
      key: string,
      code: string,
      keyCode: number,
      modifiers?: { shift?: boolean },
    ) => {
      sendKeyOnly(key, code, keyCode, modifiers);
      setTimeout(reExtract, 300);
    },
    [sendKeyOnly, reExtract],
  );

  // A navigation that a sent key may still cause, after its re-read has
  // already read the old page: the PAGE_NAVIGATED handler follows one that
  // lands inside the window, through `followKeyNavigationRef`.
  const nativeKeyNavWindow = useRef<{
    tabId: number;
    tabChangeAtStart: number;
    until: number;
  } | null>(null);

  // The native tree's keyboard bar and dialog indicator send through the
  // same content-script path, and only the native tree is read again
  // afterwards: a key can change the page (Escape closing a dialog, Enter
  // submitting a form), and a native tree is read only on request. The
  // settle window starts once the content script has dispatched the key. An
  // action still in flight would make the read skip silently, and that
  // action's own re-read may land before the key took effect (Escape after a
  // click that opened a dialog), so wait it out — bounded — then read. A key
  // that navigates is followed to its destination, as a native click that
  // navigates is; one that navigates later than that (an async submit
  // handler) is followed by the PAGE_NAVIGATED handler for a few seconds.
  // `afterRead` runs only after a re-read that read this page.
  const handleNativeSendKey = useCallback(
    (
      key: string,
      code: string,
      keyCode: number,
      modifiers?: { shift?: boolean },
      afterRead?: () => void,
    ) => {
      const tabId = nativeTreeTabId;
      const token = nativeOpToken.current;
      const tabChangeAtStart = tabChangeToken.current;
      sendKeyOnly(key, code, keyCode, modifiers, () => {
        if (tabId === undefined) return;
        nativeKeyNavWindow.current = {
          tabId,
          tabChangeAtStart,
          until: Date.now() + NATIVE_KEY_NAV_WINDOW_MS,
        };
        void (async () => {
          if (!(await whenNativeIdle())) return;
          // Only a re-read of this page says what the key did. A skipped one
          // leaves the tree from before the key, and a failed one clears it
          // only once its render lands: neither is for `afterRead` to judge.
          nativeInFlight.current = true;
          const read = await settleThenReread(
            tabId,
            token,
            tabChangeAtStart,
          ).finally(() => {
            nativeInFlight.current = false;
          });
          if (read) afterRead?.();
        })();
      });
    },
    [sendKeyOnly, nativeTreeTabId, settleThenReread, whenNativeIdle],
  );

  // Follow a navigation inside a sent key's window (see above). A native
  // operation still in flight follows it itself, through
  // `settleThenReread`'s moved-token check.
  const followKeyNavigationRef = useRef(() => {});
  followKeyNavigationRef.current = () => {
    const w = nativeKeyNavWindow.current;
    if (!w || Date.now() > w.until) return;
    if (w.tabId !== myTabIdRef.current || nativeInFlight.current) return;
    nativeKeyNavWindow.current = null;
    nativeInFlight.current = true;
    void recoverFromOwnNavigation(w.tabId, w.tabChangeAtStart).finally(() => {
      nativeInFlight.current = false;
    });
  };

  // The dialog indicator's Escape. A `<dialog>` closes on it, but an
  // `aria-modal` one closes only if a listener of the page's own handles the
  // key where it lands, which needn't be inside the dialog. Say so when the
  // re-read still has it open, rather than leaving the button looking broken.
  const handleNativeDialogEscape = useCallback(
    (dialogId: string) => {
      const { key, code, keyCode } = KEYS.Escape;
      handleNativeSendKey(key, code, keyCode, undefined, () => {
        if (findNativeModalDialog(nativeNodesRef.current)?.id === dialogId) {
          announce(
            "The dialog is still open — this page doesn't close it on Escape. Use the dialog's own close button.",
            5000,
          );
        }
      });
    },
    [handleNativeSendKey, announce],
  );

  // Export the selected view(s) as a Markdown report and copy to clipboard.
  // Serialized entirely panel-side from the merged snapshot the panel already
  // holds — so it's exactly what's on screen (current view, scoped) and never
  // depends on the content script being fresh.
  const doExport = useCallback(
    (selection: ExportView[]) => {
      setExportMenuOpen(false);

      /** Put the report on the clipboard and say whether it worked. */
      const copyReport = (
        views: ExportViews,
        meta: Omit<ExportMeta, "extensionVersion">,
      ) => {
        const markdown = buildExportMarkdown(
          views,
          { ...meta, extensionVersion: chrome.runtime.getManifest().version },
          selection,
        );
        navigator.clipboard.writeText(markdown).then(
          () => announce("Copied to clipboard", 2500),
          () =>
            announce("Clipboard blocked — click the panel, then retry", 2500),
        );
      };

      if (producer === "native") {
        if (!nativeRootId || nativeNodes.size === 0) {
          announce("Nothing to export yet", 2000);
          return;
        }
        // Native exports the subtree its tree shows, the same as DOM below.
        const nativeScope =
          nativeScopedRootId !== null
            ? nativeNodes.get(nativeScopedRootId)
            : undefined;
        const tree = nativeToExtractionResult(
          nativeNodes,
          nativeScope?.id ?? nativeRootId,
        );
        copyReport(
          {
            // `normalizeNativeAX` already drops every UNNAMED generic
            // wrapper, so every generic left in a native tree is a named
            // group the panel shows. `serializeTree`'s default
            // `includeGeneric: false` doesn't know that and would drop it.
            tree: serializeTree(tree, { includeGeneric: true }),
            outline: serializeOutline(tree),
          },
          {
            producer: tree.source!.producer,
            // The native read's own page, not the DOM producer's, which can
            // lag a navigation or never arrive on a page only native reads.
            // A native tree carries no document title, so the DOM
            // producer's is used only when it describes the same URL;
            // otherwise the header falls back to the URL.
            pageTitle: pageUrl && pageUrl === nativeTreeUrl ? pageTitle : "",
            pageUrl: nativeTreeUrl ?? "",
            // When the tree on screen was read: it doesn't follow the page
            // by itself, so the click's time could describe a stale tree.
            capturedAt: nativeReadAt ?? new Date().toISOString(),
            viewLabel: "Native accessibility tree",
            scope: nativeScope
              ? describeNode(nativeScope.role, nativeScope.name)
              : undefined,
          },
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

      // No de-indent: `serializeTree` counts each line's indent in PRINTED
      // ancestors, so the scope root is already at column 0. Slicing
      // `2 * depth` more off every line, as this once did, cut the role off
      // the scope root and the start of every line under it.
      //
      // Field values stay OUT of the report (the serializers' `values`
      // option, off by default), although the tree on screen shows them: a
      // report gets pasted into issues and PRs, and ADR-0001 leaves values
      // out of anything posted unless asked.
      const scopeNode = scopedRootId ? nodes.get(scopedRootId) : null;
      const treeStr = serializeTree(tree);
      const scopeLabel = scopeNode
        ? describeNode(scopeNode.a11y.role, scopeNode.a11y.name)
        : undefined;

      copyReport(
        {
          tree: treeStr,
          outline: serializeOutline(tree),
          // Number the export's tab-order section at render — it mirrors the
          // numbered on-screen panel; the numbers are display-only, never stored.
          tabSequence: numberTabStops(serializeTabSequence(tree)),
        },
        {
          producer: tree.source!.producer,
          pageTitle,
          pageUrl,
          capturedAt: new Date().toISOString(),
          viewLabel: viewMode === "dom" ? "DOM tree" : "Accessibility tree",
          scope: scopeLabel,
        },
      );
    },
    [
      producer,
      nativeNodes,
      nativeRootId,
      nativeScopedRootId,
      nodes,
      scopedRootId,
      rootId,
      viewMode,
      pageTitle,
      pageUrl,
      nativeTreeUrl,
      nativeReadAt,
      announce,
    ],
  );
  // What the Copy menu offers for the tree on screen.
  const exportViews = producer === "native" ? NATIVE_VIEWS : ALL_VIEWS;

  // Close the Settings menu on outside-click or Escape, which returns focus to
  // its button when it was inside the menu.
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      ) {
        setSettingsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inside = settingsRef.current?.contains(document.activeElement);
      setSettingsOpen(false);
      if (inside) settingsButtonRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen]);

  // The note about Chrome's debugging bar shows with the native tree, once a
  // native read has succeeded (which is when the bar has appeared), until the
  // user acknowledges it, in this window or another. Said once when it
  // appears, since a note that appears is not announced by itself.
  const showNativeNotice =
    nativeModeEnabled &&
    producer === "native" &&
    nativeEverRead &&
    nativeNoticeSeen === false;
  const announcedNativeNotice = useRef(false);
  useEffect(() => {
    if (!showNativeNotice || announcedNativeNotice.current) return;
    announcedNativeNotice.current = true;
    announce(
      "While the panel reads a page, Chrome shows a bar saying it started debugging this browser. That's expected — see the note below the toolbar.",
      8000,
    );
  }, [showNativeNotice, announce]);
  // However the note goes (Got it or Turn off, here or in another window, or
  // the panel falling back to the DOM tree), focus on its buttons goes with
  // it, so it moves to the tree.
  const nativeNoticeShown = useRef(false);
  useLayoutEffect(() => {
    if (showNativeNotice) {
      nativeNoticeShown.current = true;
      return;
    }
    if (!nativeNoticeShown.current) return;
    nativeNoticeShown.current = false;
    refocusIfLost();
  }, [showNativeNotice, refocusIfLost]);

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

  const jumpKeys = useMemo(
    () => ({ links: controlsIndex, onJump: handleJumpToNode }),
    [controlsIndex, handleJumpToNode],
  );
  const { handleKeyDown } = useTreeKeyboard({
    nodes,
    visibleNodeIds,
    selectedId,
    onSelect: handleSelect,
    onToggle: handleToggle,
    onActivate: handleActivate,
    onFocusSearch: focusSearch,
    // A jump outside the scope leaves it, as a click on a chip does.
    jump: jumpKeys,
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
  //
  // A target outside the current scope (a pick, a focus sync or a jump chip
  // can each land anywhere on the page) leaves the scope first and
  // re-requests the reveal, which then resolves against the full tree.
  // `scopedRootId` and `nodes` are read through a ref for the same reason
  // the visible list is: depending on them would re-scroll on every scope
  // change or tree update.
  const revealScopeRef = useRef({ scopedRootId, nodes, handleScopeToNode });
  revealScopeRef.current = { scopedRootId, nodes, handleScopeToNode };
  useEffect(() => {
    if (revealNonce === 0) return;
    const target = revealTargetRef.current;
    if (!target) return;
    const scope = revealScopeRef.current;
    if (
      scope.scopedRootId &&
      scope.nodes.has(target) &&
      !isInScope(
        target,
        scope.scopedRootId,
        (id) => scope.nodes.get(id)?.parentId,
      )
    ) {
      scope.handleScopeToNode(null);
      requestReveal(target);
      return;
    }
    const index = visibleIndexByIdRef.current.get(target) ?? -1;
    if (index !== -1) scrollToIndex(index, "nearest");
  }, [revealNonce, scrollToIndex, requestReveal]);

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
  const scopeBreadcrumb = scopedRootId
    ? scopePath(
        scopedRootId,
        (id) => nodes.get(id)?.parentId,
        (id) => {
          const current = asDom(nodes.get(id));
          if (!current) return undefined;
          return viewMode === "a11y"
            ? describeNode(getDisplayRole(current), current.a11y.name)
            : `<${current.dom.tagName}>`;
        },
      )
    : [];

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
          {/* In the header rather than the toolbar, whose controls don't wrap
              and run past a narrow panel's edge: this is where native mode
              turns off and back on, so it must always be on screen. A
              disclosure, not a menu: what it opens is a switch and a line
              about it. */}
          <div class="sn-export" ref={settingsRef}>
            <button
              ref={settingsButtonRef}
              class="sn-toolbar-btn sn-export-btn"
              aria-expanded={settingsOpen}
              aria-controls={settingsOpen ? "sn-settings-menu" : undefined}
              onClick={() => setSettingsOpen((o) => !o)}
              title="Settings"
            >
              {"Settings ▾"}
            </button>
            {settingsOpen && (
              <div
                id="sn-settings-menu"
                class="sn-export-menu sn-settings-menu"
                role="group"
                aria-label="Settings"
              >
                <label class="sn-settings-item">
                  <input
                    type="checkbox"
                    checked={nativeSettingPending ?? nativeModeEnabled}
                    aria-describedby="sn-settings-native-hint"
                    aria-disabled={nativeSettingPending !== null}
                    onChange={(e) => {
                      const input = e.target as HTMLInputElement;
                      const wanted = input.checked;
                      // Back to what it showed until the panel takes the
                      // click: none is taken while a change is on its way.
                      input.checked = nativeSettingPending ?? nativeModeEnabled;
                      setNativeModeFromSettings(wanted);
                    }}
                  />
                  <span>Read pages through Chrome (recommended)</span>
                </label>
                <p id="sn-settings-native-hint" class="sn-settings-hint">
                  Shows the tree Chrome itself gives assistive technology. While
                  it reads, Chrome shows a bar: “{extensionName()}” started
                  debugging this browser. Off, the panel reads the page itself.
                </p>
              </div>
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
              matchCountLabel(matchCount, scopedRootId !== null)}
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

            Only rendered while native mode is on (the default; Settings
            turns it off). Kept absent (not merely disabled) while off: a
            visible DOM/NATIVE choice implies NATIVE is one click away, which
            isn't true while the user has turned native mode off, and every
            other producer-scoped control below reads `producer` to decide
            whether it applies. */}
        {nativeModeEnabled && (
          <div class="sn-toggle-group" role="group" aria-label="Tree producer">
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
            // A native pick is pressed as soon as it's asked for, but busy
            // until Chromium's inspect mode is actually on: a page click
            // before then isn't a pick.
            aria-busy={producer === "native" && pickModeOn && !nativePickArmed}
            onClick={togglePickMode}
            disabled={
              producer === "native" &&
              (nativeTreeTabId === undefined || (!pickModeOn && nativeBusy))
            }
            title={
              pickModeOn
                ? producer === "native" && !nativePickArmed
                  ? "Arming the picker…"
                  : "Pick mode ON — click an element in the page to select it in the tree (Esc to cancel)"
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
                onClick={() => doExport(exportViews)}
              >
                Everything
              </button>
              {exportViews.map((view) => (
                <button
                  key={view}
                  class="sn-export-item"
                  onClick={() => doExport([view])}
                >
                  {view === "tree"
                    ? producer === "native"
                      ? "Native tree"
                      : viewMode === "dom"
                        ? "DOM tree"
                        : "A11y tree"
                    : VIEW_LABELS[view]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Block-level, NOT a toolbar flex child: its paragraph would otherwise
          squeeze every other toolbar control (search box, curtain, refresh,
          zoom, copy) into a cramped, wrapped mess. Same placement pattern as
          NativeTreeView's own capability banner. */}
      {showNativeNotice && (
        <NativeModeNotice
          onAcknowledge={acknowledgeNativeNotice}
          // Marked as seen only once native mode is really off: if it isn't,
          // the note stays to say what's still happening.
          onTurnOff={() =>
            setNativeModeFromSettings(false, acknowledgeNativeNotice)
          }
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
      {producer === "dom" && (
        <DialogIndicator
          dialog={isDialogScoped ? { name: rootNode?.a11y.name ?? "" } : null}
          onEscape={() => sendKeySpec(handleSendKey, KEYS.Escape)}
        />
      )}

      {/* Scope breadcrumb (when user scoped to a subtree). Native renders
          its own, inside NativeTreeView, from the same component. */}
      {producer === "dom" && scopedRootId && (
        <ScopeBar
          path={scopeBreadcrumb}
          rootId={rootId}
          onScope={handleScopeToNode}
          focusAfterExit={() => treeRef.current ?? listViewRef.current}
        />
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
          onRevealMiss={() =>
            announce(
              "The picked element isn't in this tree — refresh the native tree, then pick again.",
              5000,
            )
          }
          onSelectionReveal={revealNativeRow}
          onHoverPreview={previewNativeRow}
          scopedRootId={nativeScopedRootId}
          onScope={handleNativeScope}
          pickArmed={pickModeOn}
          onSendKey={handleNativeSendKey}
          onDialogEscape={handleNativeDialogEscape}
          followPageChanges={followPageChanges}
          onToggleFollowPageChanges={toggleFollowPageChanges}
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
          scoped={scopedRootId !== null}
          onExitScope={() => handleScopeToNode(null)}
          listRef={listViewRef}
        />
      ) : roleFilter ? (
        /* ---- Filtered list view ---- */
        <FilteredList
          nodes={nodes}
          scopeRootId={scopedRootId}
          roleFilter={roleFilter}
          query={query}
          onHighlight={handleSelect}
          onActivate={handleActivate}
          onGoToTree={handleGoToTree}
          onFocusSearch={focusSearch}
          onExitScope={() => handleScopeToNode(null)}
          listRef={listViewRef}
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
              aria-label={`Semantic tree — press Enter to activate interactive elements; +/− or Shift+Enter to step sliders and spinbuttons; ${SCOPE_KEY_HINT}; Alt+J to follow a row's aria-controls links one by one and Alt+Shift+J to go back`}
              aria-keyshortcuts={JUMP_KEYSHORTCUTS}
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
                const scopeAction = scopeKeyAction(e, {
                  scoped: scopedRootId !== null,
                  // A DOM pick is cancelled by Escape on the PAGE (the
                  // content script owns it); the panel's own Escape never
                  // reaches it, so here Escape always leaves the scope.
                  pickArmed: false,
                });
                if (scopeAction) {
                  e.preventDefault();
                  if (scopeAction === "exit") {
                    handleScopeToNode(null);
                  } else if (selectedId && hasChildren(nodes.get(selectedId))) {
                    handleScopeToNode(selectedId);
                  }
                  return;
                }
                if (e.key === "ArrowLeft" && selectedId) {
                  const selected = asDom(nodes.get(selectedId));
                  const isOpen =
                    !!selected?.ui.expanded && hasChildren(selected);
                  if (
                    arrowLeftStopsAtScopeRoot(selectedId, scopedRootId, isOpen)
                  ) {
                    e.preventDefault();
                    return;
                  }
                }
                handleKeyDown(e);
              }}
            >
              {visibleNodeIds.slice(startIndex, endIndex).map((id) => {
                const node = asDom(nodes.get(id));
                if (!node) return null;

                const isParent = hasChildren(node);
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
                    aria-expanded={isParent ? node.ui.expanded : undefined}
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
                      if (isParent && !node.interaction.isInteractive) {
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
                      class={`sn-toggle ${!isParent ? "sn-toggle--leaf" : ""}`}
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isParent) handleToggle(id);
                      }}
                    >
                      {isParent ? (node.ui.expanded ? "\u25BE" : "\u25B8") : ""}
                    </button>

                    <span class="sn-label">
                      {viewMode === "dom" ? (
                        <>
                          <span class="sn-tag">
                            {"<"}
                            {node.dom.tagName}
                            {">"}
                          </span>
                          {/* The raw DOM value — a select's `value`, not
                              its label. A sensitive field's is already
                              `[redacted]`. */}
                          {node.dom.attributes.value !== undefined && (
                            <span class="sn-field-value">
                              {rawValueLabel(node.dom.attributes.value)}
                            </span>
                          )}
                          {node.dom.textContent && showsTextContent(node) && (
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
                              in @real-a11y-dev/semantic-navigator-ui.
                              Skipped for a field — see `showsTextPreview`. */}
                          {node.childIds.length === 0 &&
                            node.dom.descendantText !== "" &&
                            node.dom.descendantText !== node.a11y.name &&
                            showsTextPreview(node) && (
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
                          {/* The value a screen reader announces
                              (ADR-0001) \u2014 on any node that has one, not only
                              editable fields: a select's option label, a
                              slider's valuetext, an editor's text. A
                              sensitive field's is already `[redacted]`. */}
                          {node.a11y.value !== undefined && (
                            <span class="sn-field-value">
                              {announcedValueLabel(node.a11y.value)}
                            </span>
                          )}
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
                          {/* Cross-links (aria-controls or heuristic): to the
                              rows this one controls, and back to those that
                              control it. */}
                          {controlsIndex.forward.get(id)?.map((targetId) => {
                            const target = asDom(nodes.get(targetId));
                            if (!target) return null;
                            return (
                              <ControlsChip
                                key={`controls-${targetId}`}
                                role={getDisplayRole(target)}
                                name={target.a11y.name}
                                direction="forward"
                                inferred={controlsIndex.inferred.has(id)}
                                keyHint={JUMP_KEYS.forward}
                                onJump={() => handleJumpToNode(targetId)}
                              />
                            );
                          })}
                          {controlsIndex.reverse
                            .get(id)
                            ?.map((triggerId, i) => {
                              const trigger = asDom(nodes.get(triggerId));
                              if (!trigger) return null;
                              return (
                                <ControlsChip
                                  key={`controlled-by-${triggerId}`}
                                  role={getDisplayRole(trigger)}
                                  name={trigger.a11y.name}
                                  direction="reverse"
                                  inferred={controlsIndex.inferred.has(
                                    triggerId,
                                  )}
                                  // Alt+Shift+J reaches the first one.
                                  keyHint={i === 0 ? JUMP_KEYS.back : undefined}
                                  onJump={() => handleJumpToNode(triggerId)}
                                />
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

          <SendKeyBar onSendKey={handleSendKey} />

          <div class="sn-hints">
            <kbd>Enter</kbd> activate &middot; <kbd>+/−</kbd> step &middot;{" "}
            <kbd>Space</kbd> expand &middot; <kbd>Arrow</kbd> navigate &middot;{" "}
            <kbd>DblClick</kbd> scope &middot; <kbd>Alt+(Shift)+J</kbd> jump
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
