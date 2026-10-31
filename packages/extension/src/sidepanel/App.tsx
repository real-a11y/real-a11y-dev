/// <reference types="chrome" />

import type {
  ActionType,
  SemanticNode,
  ExtractionResult,
  ActionRequest,
} from "@real-a11y-dev/core";
import { getPrimaryAction } from "@real-a11y-dev/core";
import {
  ShowFullNamesSetting,
  useDismissible,
} from "@real-a11y-dev/semantic-navigator-ui";
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
} from "preact/hooks";

import {
  blockedBy,
  explainUnavailable,
  type NativeUnavailableReason,
  type TabCapability,
} from "../native/capability.js";
import {
  isTypableRole,
  masksRetype,
  nativeSelectOptions,
  pickerCurrentOption,
  type NativeNode,
} from "../native/native-actions.js";
import type { NativeAction } from "../native/native-core.js";
import { nativeToExtractionResult } from "../native/native-export.js";
import {
  nativeRowForPageFocus,
  nativeRowsByPageKey,
  type NativePageRows,
} from "../native/native-tree-utils.js";
import { NATIVE_NOTICE_SEEN_KEY } from "../native/setting.js";
import {
  isFieldStateSuccess,
  isPanelWindow,
  isSuccessResponse,
  isTrustedSender,
  isUnreachablePageResponse,
  shouldPanelAcceptMessage,
} from "../routing.js";
import type { ContentToPanel, PanelToContent, TreeRequest } from "../types.js";

import { describeAction, describeSelection } from "./action-feedback.js";
import { asDom } from "./dom-rows.js";
import {
  buildExportMarkdown,
  exportViewsFor,
  pageLabel,
  VIEW_LABELS,
} from "./export.js";
import type { ExportMeta, ExportView, ExportViews } from "./export.js";
import { FOCUSABLE_SELECTOR } from "./focus-hooks.js";
import {
  followAfterRead,
  followChange,
  followDestination,
  followNavigation,
  followPageInput,
  followReadStarted,
  followTyping,
  NOT_FOLLOWING,
  type FollowWindow,
} from "./follow-window.js";
import { SHOW_FULL_NAMES_KEY } from "./full-names.js";
import { InputPanel, domTextInputState } from "./InputPanel.js";
import type { InputPanelState } from "./InputPanel.js";
import {
  AUTO_REFRESH_QUIET_MS,
  decideAutoRefresh,
  FOLLOW_PAGE_CHANGES_KEY,
  NATIVE_SETTLE_MS,
  quietPeriodOnSignal,
} from "./native-auto-refresh.js";
import {
  findNativeModalDialog,
  nativeActionFeedback,
} from "./native-feedback.js";
import { NativeModeNotice } from "./NativeModeNotice.js";
import type { NativeView } from "./NativeTabView.js";
import { NativeTreeView, type NativeReveal } from "./NativeTreeView.js";
import { describeNode } from "./scope.js";
import { KEYS } from "./SendKeyBar.js";
import { useStoredFlag } from "./use-stored-flag.js";
import { useNativeOverlay } from "./useNativeOverlay.js";

/** What the panel keeps of an ACTIVE_TAB_CHANGED. */
type ActiveTabTold = { tabId: number; windowId: number; focus?: boolean };

/**
 * Whether a panel in window `myWindowId` takes an ACTIVE_TAB_CHANGED: one for
 * its own window (`isPanelWindow`), unless the worker told it the window's
 * tab because the user moved to the window, and what they moved to is this
 * panel. Then they came for what it shows (a popup, say), not the page.
 */
function takesActiveTab(m: ActiveTabTold, myWindowId: number | null): boolean {
  return (
    isPanelWindow(m.windowId, myWindowId) && !(m.focus && document.hasFocus())
  );
}

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

/** Chrome's TAB view's tree while the page is still to send it: the one
 *  kept has the stops the page had, not those it has. */
const NO_NODES = new Map<string, SemanticNode>();

export function App() {
  // Chrome's tree, or the page's tab order in its place.
  const [view, setView] = useState<NativeView>("a11y");
  // The in-page walk's tree, which the TAB view lists the page's tab order
  // from: Chrome's tree has none (`NativeTabView.tsx`).
  const [nodes, setNodes] = useState<Map<string, SemanticNode>>(new Map());
  const [rootId, setRootId] = useState<string>("");
  // The page sent its frames' skeleton, not its tree (see `framesOnly`).
  const [treePending, setTreePending] = useState(false);
  const [connected, setConnected] = useState(false);
  // The same, for callbacks that run after a reply. Written during render,
  // like `pickModeOnRef`.
  const connectedRef = useRef(false);
  connectedRef.current = connected;
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
  const [curtainOn, setCurtainOn] = useState(false);
  const [focusTrackerOn, setFocusTrackerOn] = useState(true);
  // For the message listener and the native reads. With Focus sync off, a
  // focus report is dropped here too: one can still be on its way when the
  // toggle flips, and a service worker that restarted turns every tracker
  // back on until this panel's port reconnects and says otherwise.
  const focusTrackerOnRef = useRef(focusTrackerOn);
  focusTrackerOnRef.current = focusTrackerOn;
  // Which popup is open: the export dropdown ("Copy" → pick which view(s) to
  // put on the clipboard) or Settings. Never both: each opens in the other's
  // place, however it is reached.
  const [openPopup, setOpenPopup] = useState<"copy" | "settings" | null>(null);
  const exportMenuOpen = openPopup === "copy";
  const togglePopup = useCallback(
    (popup: "copy" | "settings") =>
      setOpenPopup((open) => (open === popup ? null : popup)),
    [],
  );
  // Only that popup: a listener left over from the other can't close this.
  const closePopup = useCallback(
    (popup: "copy" | "settings") =>
      setOpenPopup((open) => (open === popup ? null : open)),
    [],
  );
  // Picker mode (DevTools-style "select an element in the page"). Off by
  // default; toggled by the toolbar button or Ctrl/Cmd+Shift+C. Chromium's
  // inspect mode owns the actual click capture (`runPick` in
  // debugger-session.ts) — this flag is just the panel's mirror so the button
  // shows the right pressed state.
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
  const [liveAnnouncements, setLiveAnnouncements] = useState<
    Array<{ id: number; text: string; level: string; role: string }>
  >([]);
  const announcementId = useRef(0);

  // ---- Chrome's tree ----
  // The Settings menu.
  const settingsOpen = openPopup === "settings";
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  // Whether the user has acknowledged the note about Chrome's debugging bar
  // (see `NativeModeNotice`). `null` until storage says, or where the panel
  // runs without extension storage: the note shows only on a definite "no".
  const [nativeNoticeSeen, setNativeNoticeSeen] = useState<boolean | null>(
    null,
  );
  // Whether a native read has succeeded in this panel, which is when Chrome's
  // bar has shown: the note about it waits for that.
  const [nativeEverRead, setNativeEverRead] = useState(false);
  const [nativeNodes, setNativeNodes] = useState<Map<string, NativeNode>>(
    new Map(),
  );
  // Read by `dispatchNativeAction` for its feedback wording, through a ref so
  // the callback doesn't change identity on every tree read.
  const nativeNodesRef = useRef(nativeNodes);
  nativeNodesRef.current = nativeNodes;
  // Focus sync for the native tree: the read the tree on screen came from,
  // when that read numbered the page, and its rows by frame and number. The
  // content scripts' focus reports name rows by those numbers
  // (`page-keys.ts`). Set with the tree, both at once, so a report never meets
  // one read's id and another's rows; a ref, for the long-lived message
  // listener.
  const nativePageKeys = useRef<
    { readId: string; rows: NativePageRows } | undefined
  >(undefined);
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
  // The picker's result — NativeTreeView owns its own expand/select state
  // (see that component's own top comment), so the panel can't reach in and
  // set it directly. Passed down as a `reveal` prop instead; `nonce` forces the child's effect to re-fire
  // even when the same node is picked twice in a row.
  const [nativePickReveal, setNativePickReveal] = useState<
    NativeReveal | undefined
  >(undefined);
  // Focus sync's counterpart, for the same reason: the row the page's focus
  // went to, handed down as NativeTreeView's `pageFocus`.
  const [nativePageFocus, setNativePageFocus] = useState<
    NativeReveal | undefined
  >(undefined);
  // The native pick's inspect mode is on (NATIVE_PICK_ARMED arrived). Until
  // then the Pick button is pressed but busy: a page click isn't a pick yet.
  const [nativePickArmed, setNativePickArmed] = useState(false);
  // `nativeOpToken.current` at the moment the in-flight pick was armed —
  // compared against its CURRENT value when NATIVE_PICK_RESULT arrives, same
  // pattern `dispatchNativeAction`/`loadNativeTree` already use for a
  // read/act reply. A pick can take arbitrarily long (it waits on a page
  // click), so a tab switch or a navigation can land while one is
  // outstanding; without this, a result that arrives after
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
  // Bumped by the myTabId effect below — NEVER by PAGE_NAVIGATED. A
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
  // Reads Chrome's tree again, numbered, when Focus sync wants numbers it
  // lacks: see where it is re-pointed, after `loadNativeTree`.
  const numberNativeTree = useRef(() => {});
  // Native auto-refresh: the tree reads itself again once a navigation's new
  // page has settled, and, with "Follow page changes" on, after the page
  // changes and goes quiet — see `native-auto-refresh.ts` for the policy.
  // `armedTab` is the tab a successful read armed it on: a tab switch or a
  // failed read clears it, so nothing but a user's
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
    /** The few seconds after the user acts whose changes are read
     *  whatever the mode (`follow-window.ts`). */
    follow: FollowWindow;
    /** The earliest change since the latest read began. */
    firstUnreadChangeAt: number;
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
    follow: NOT_FOLLOWING,
    firstUnreadChangeAt: Infinity,
    timer: null,
    signalSince: null,
    inFlight: null,
  });
  // The "Follow page changes" setting.
  const [followPageChanges, setFollowPageChanges] = useStoredFlag(
    FOLLOW_PAGE_CHANGES_KEY,
  );
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
  /** Stop auto-refresh until a read succeeds again: a tab switch, or a
   *  failed read. */
  const disarmAutoRefresh = useCallback(() => {
    autoRefresh.current.armedTab = null;
    autoRefresh.current.navigationPending = false;
    autoRefresh.current.follow = NOT_FOLLOWING;
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
  /** An action's or a sent key's re-read has just read the page: what the
   *  page does next, for a while, is read as it lands too — see
   *  `ACTION_FOLLOW_MS`. */
  const followActionAftermath = useCallback(() => {
    const a = autoRefresh.current;
    a.follow = followAfterRead(
      a.follow,
      "action",
      a.lastReadStartedAt,
      a.firstUnreadChangeAt,
      Date.now(),
    );
    // A change reported while that re-read ran was judged before the window
    // opened, and let go if nothing else was due: judge it again.
    if (a.timer === null && a.follow.firstChangeAt < a.follow.until) {
      scheduleAutoRefresh(AUTO_REFRESH_QUIET_MS);
    }
  }, [scheduleAutoRefresh]);
  useEffect(() => cancelAutoRefreshTimer, [cancelAutoRefreshTimer]);
  const toggleFollowPageChanges = useCallback(
    () => setFollowPageChanges(!followPageChangesRef.current),
    [setFollowPageChanges],
  );
  // The "Show full names" setting (in Settings): off, a long name ends in an
  // ellipsis and the tree fits the panel.
  const [showFullNames, setShowFullNames] = useStoredFlag(SHOW_FULL_NAMES_KEY);
  // What had focus as this render began, before its commit could take it
  // away: the note about Chrome's bar goes once it is answered, and a page
  // that disconnects takes the tree with it. Whatever had focus can go with
  // them, which would leave it on the body: a layout effect further down puts it back instead, whichever
  // way it went. Read during render, which runs before the commit, rather
  // than from focus events: a panel without the window's focus (the user is
  // in the page, or in another window) gets none when focus moves.
  const focusBeforeCommit = useRef<Element | null>(null);
  focusBeforeCommit.current = document.activeElement;
  // The popup (Copy, Settings) it was in, if any, found while it is still
  // attached: once a commit removes part of a popup, the removed part no
  // longer leads back to it.
  const popupBeforeCommit = useRef<Element | null>(null);
  popupBeforeCommit.current =
    document.activeElement?.closest("[data-sn-popup]") ?? null;

  /** Drop the native tree and orphan any native read or action in flight.
   *  Bumping `nativeOpToken` makes a late reply recognizably stale to every
   *  `token !== nativeOpToken.current` guard, and because those guards leave
   *  `nativeBusy` set on a stale reply, this is also what clears it. Used by a
   *  tab switch and a navigation — anything that makes the native ids in
   *  hand meaningless. */
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
    // A pick's reveal belongs to the tree it was picked in, and so does a
    // focus report, and the numbering it names rows by.
    setNativePickReveal(undefined);
    setNativePageFocus(undefined);
    nativePageKeys.current = undefined;
  }, []);

  // Chrome's tree reads itself once per panel session, on the first page that
  // connects and that it can read. Not on every tab or navigation after that
  // — each of those would attach the debugger with no fresh gesture: a tab
  // switched to waits for Refresh. Spent by the session's first successful
  // read, the default's or the user's.
  const hasAppliedNativeDefault = useRef(false);
  // The tabs the default has failed on (DevTools owns it, a blocked URL, the
  // service worker didn't answer). The default waits for a tab not in here
  // rather than retrying one that is: every retry would attach again, and
  // flash Chrome's bar, for as long as the page stays unreadable. All of
  // them, not just the last: switching A → B → A would otherwise retry A.
  const nativeDefaultFailedOn = useRef(new Set<number>());

  const exportRef = useRef<HTMLDivElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);

  // The tab this side-panel instance is bound to: the active tab of the
  // window it is in, since Chrome gives each window a side panel of its own.
  // On mount the panel asks for that tab itself, as only it knows which
  // window it is in; after that the background pushes ACTIVE_TAB_CHANGED on
  // every tab or window switch, naming the window it is for. We don't listen
  // for tab switches in the panel context: the side panel's `chrome.tabs`
  // event delivery has been historically quirky, and the background owns the
  // binding.
  const [myTabId, setMyTabId] = useState<number | null>(null);
  // Latest myTabId for use inside the long-lived onMessage listener,
  // which closes over the value at registration time.
  const myTabIdRef = useRef<number | null>(null);
  useEffect(() => {
    myTabIdRef.current = myTabId;
  }, [myTabId]);
  // Chrome's tree needs only each frame's skeleton (`TreeRequest`): the
  // in-page walk's whole tree is wanted while the TAB view shows.
  const framesOnly = view !== "tab";
  // Read by `sendTreeRequest` instead of closing over `framesOnly`, so that
  // callback — and `requestTree`/`reExtract`/`handleActivate` built on it —
  // keeps a stable identity when the view changes. It is a dependency of the
  // tab-change effect below, whose teardown belongs to tab switches alone. A
  // ref rather than a dependency because the view is an input to a request,
  // never a reason to re-send one: SET_VIEW_MODE already makes the content
  // script read the page again.
  const framesOnlyRef = useRef(framesOnly);
  framesOnlyRef.current = framesOnly;
  /** The tree the panel wants of the page now. */
  const askedTree = (): TreeRequest => ({ framesOnly: framesOnlyRef.current });
  // The window this panel is in: an ACTIVE_TAB_CHANGED for another window is
  // that window's panel's (`isPanelWindow`). `undefined` until the look-up
  // below answers. `null` where it can't be learned (no `chrome.tabs` to ask,
  // as in a test's stand-in), and then every one is ours.
  const myWindowIdRef = useRef<number | null | undefined>(undefined);
  // Those that came before the window was known. The latest of ours is newer
  // than the look-up's answer, which was asked for before it came.
  const earlyActiveTabs = useRef<ActiveTabTold[]>([]);
  // The tab last taken, at once: `myTabIdRef` follows `myTabId` only after
  // the render, and a popup can close before that.
  const shownTabRef = useRef<number | null>(null);
  // Counts the tabs taken: a look-up of the window's tab that started before
  // one was taken is older than it, and its answer is dropped.
  const activeTabsTaken = useRef(0);
  // Tabs that closed before the window was known: none of them is shown.
  const earlyClosedTabs = useRef(new Set<number>());
  const showTab = useCallback((tabId: number) => {
    activeTabsTaken.current += 1;
    shownTabRef.current = tabId;
    setMyTabId(tabId);
  }, []);
  /** Show window `windowId`'s active tab, unless a tab is taken after
   *  `taken` was counted, which is when the look-up started: that one is
   *  newer. */
  const showWindowTab = useCallback(
    (windowId: number, taken = activeTabsTaken.current) => {
      chrome.tabs.query({ active: true, windowId }).then(
        ([tab]) => {
          if (taken !== activeTabsTaken.current) return;
          if (tab?.id !== undefined) showTab(tab.id);
        },
        () => {
          // The window is closing with the panel in it; nothing to show.
        },
      );
    },
    [showTab],
  );
  useEffect(() => {
    let mounted = true;
    const learned = (tab: { id?: number; windowId: number } | undefined) => {
      if (!mounted) return;
      const windowId = tab?.windowId ?? null;
      myWindowIdRef.current = windowId;
      const ours = earlyActiveTabs.current.filter((m) =>
        takesActiveTab(m, windowId),
      );
      earlyActiveTabs.current = [];
      const closed = earlyClosedTabs.current;
      earlyClosedTabs.current = new Set();
      const shown = ours.length > 0 ? ours[ours.length - 1].tabId : tab?.id;
      if (shown === undefined) return;
      if (!closed.has(shown)) showTab(shown);
      else if (windowId !== null) showWindowTab(windowId);
    };
    if (chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }).then(
        ([tab]) => learned(tab),
        (err) => {
          console.warn(
            "[SN panel] couldn't learn its window, so it follows every window's tab:",
            err,
          );
          learned(undefined);
        },
      );
    } else {
      learned(undefined);
    }
    return () => {
      mounted = false;
    };
  }, [showTab, showWindowTab]);
  // Moving from the panel to its window's page is a move inside the window,
  // which the worker isn't told of: a panel left on a popup while the user
  // worked in it shows its window's tab again then. Focus that left for
  // another window is the worker's to follow.
  useEffect(() => {
    const onBlur = () => {
      const windowId = myWindowIdRef.current;
      if (typeof windowId !== "number" || !chrome.windows?.get) return;
      // A tab taken from here on, a popup the user moved to, say, is newer.
      const taken = activeTabsTaken.current;
      chrome.windows.get(windowId).then(
        (win) => {
          if (taken !== activeTabsTaken.current) return;
          if (win.focused && !document.hasFocus()) {
            showWindowTab(windowId, taken);
          }
        },
        () => {
          // The window is closing with the panel in it.
        },
      );
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [showWindowTab]);

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

  // The note about Chrome's bar, acknowledged in this window or another.
  useEffect(() => {
    // Absent where the panel runs without extension storage (unit tests).
    if (!chrome.storage?.onChanged) return;
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "local") return;
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
  }, []);
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

  // After every commit (`focusBeforeCommit`): if it took away the element
  // that had focus, and so left focus on the body, focus moves to the tree on
  // screen, or the list shown in its place (the TAB view, or the role
  // filter's). While the panel waits for a page there is none of them, and
  // focus is
  // left as a navigation leaves it. Focus anywhere else stays where
  // it is, and a panel where nothing had focus is left alone. A layout effect
  // rather than an effect, which waits for a paint: a panel in a window that
  // isn't in front can go without one for a long time.
  useLayoutEffect(() => {
    const before = focusBeforeCommit.current;
    if (before === null || before === document.body || before.isConnected) {
      return;
    }
    const active = document.activeElement;
    // A popup's controls (the Copy menu, Settings) are not lost when it
    // closes: Escape returns focus to its button, and a press outside puts
    // focus where the press does (`useDismissible`). One that went while its
    // popup stayed open (Copy's Tab sequence, while the page's tab order is
    // read again) leaves focus in the popup, on its first control.
    const popup = popupBeforeCommit.current;
    if (popup) {
      if (popup.isConnected && (active === null || active === document.body)) {
        popup.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
      }
      return;
    }
    if (active !== null && active !== document.body) return;
    [
      document.querySelector<HTMLElement>('[role="tree"]'),
      document.querySelector<HTMLElement>('.sn-filtered-list[role="listbox"]'),
    ]
      .find((el) => el?.isConnected)
      ?.focus();
  });

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
        void chrome.runtime.sendMessage(stamped);
      }
    },
    [],
  );

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
        { type: "REQUEST_TREE", payload: askedTree() },
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
  // Only `myTabId` may re-run this. `requestTree` and `sendToBoundTab` are in
  // the deps as well but are identity-stable by construction (see
  // `framesOnlyRef`) — the teardown below describes leaving a tab, and nothing
  // else is allowed to trigger it.
  const hasRequestedInitial = useRef(false);
  useEffect(() => {
    if (myTabId === null) return;
    // A new bound tab invalidates the native tree in hand the same way it
    // invalidates the page's own one below — native ids are scoped to the
    // document they were read from. Bumping the token here (rather than only on an
    // explicit native reload) is what makes a reply from the tab just left
    // recognizably stale to the guards in loadNativeTree/dispatchNativeAction
    // — and, since that guard is what leaves `nativeBusy` set on a stale
    // reply (see loadNativeTree/dispatchNativeAction's own comments), this is
    // also the one place responsible for clearing it back to false: nothing
    // else is coming to do it for an operation this tab change just orphaned.
    tabChangeToken.current++;
    resetNativeState();
    // Auto-refresh follows the tab a read succeeded on, never the one the
    // panel just moved to — that one waits for Refresh, as the default read
    // does once it is spent (`hasAppliedNativeDefault`): re-reading on a tab
    // switch would attach chrome.debugger with no user action.
    disarmAutoRefresh();

    // The service worker keeps Focus sync's state by tab, so the tab now
    // bound gets this panel's: a tab first seen here starts out on.
    sendToBoundTab({
      type: "SET_FOCUS_TRACKER",
      payload: { enabled: focusTrackerOnRef.current },
    });

    if (!hasRequestedInitial.current) {
      hasRequestedInitial.current = true;
      requestTree();
      return;
    }
    setNodes(new Map());
    setRootId("");
    setConnected(false);
    // The verdict belonged to the tab we just left; the new one is unknown
    // until it is asked.
    setPageUnreachable(false);
    setPageTitle("");
    setPageUrl("");
  }, [
    myTabId,
    requestTree,
    resetNativeState,
    disarmAutoRefresh,
    sendToBoundTab,
  ]);

  // Keep a port alive so the background knows when the side panel closes.
  // On disconnect the background clears the highlight overlay AND disables
  // the focus tracker across every frame. The tracker starts OFF in
  // content.ts: binding a tab pushes the panel's state to it (the myTabId
  // effect), and a reconnect pushes it again.
  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    const connect = () => {
      port = chrome.runtime.connect({ name: "sidepanel" });
      // Push the panel's focus-tracker state on reconnect: the current
      // state, not the mount's, since a worker that restarted forgot it. A
      // panel with no tab yet has nowhere to push it: one with no tab named
      // would go to the tab last switched to, in any window.
      if (myTabIdRef.current !== null) {
        sendToBoundTab({
          type: "SET_FOCUS_TRACKER",
          payload: { enabled: focusTrackerOnRef.current },
        });
        // And the tree it wants, which such a worker forgot as well.
        sendToBoundTab({ type: "SET_VIEW_MODE", payload: askedTree() });
      }
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
    // sendToBoundTab is stable (empty deps); the toggle is read through its ref.
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
        const mine = myWindowIdRef.current;
        if (mine === undefined) earlyActiveTabs.current.push(message);
        else if (takesActiveTab(message, mine)) showTab(message.tabId);
        return;
      }

      // The tab this panel shows closed: a popup it was showing, say, which
      // switches no tab in this panel's own window. Show that window's tab.
      if (message.type === "TAB_CLOSED") {
        const windowId = myWindowIdRef.current;
        if (windowId === undefined) earlyClosedTabs.current.add(message.tabId);
        else if (message.tabId === shownTabRef.current && windowId !== null) {
          showWindowTab(windowId);
        }
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
        setConnected(false);
        // The old page's verdict says nothing about the new one.
        setPageUnreachable(false);
        setPageTitle("");
        setPageUrl("");
        // A navigation replaces the document, and with it every
        // backendDOMNodeId a native tree's ids are built from — see the
        // myTabId effect's identical teardown for why this has to happen here
        // too, not just on a tab switch. Same reason for clearing nativeBusy: a
        // NATIVE_READ/NATIVE_ACT in flight when the page navigates has its
        // token orphaned by the bump above, so nothing else is coming to
        // clear the busy flag its own finally block intentionally left set.
        resetNativeState();
        // Auto-refresh stays armed: the new page's content script reports it
        // with a TREE_DATA, and that reads it, once. A pending read for the
        // old page is dropped, and the back-off starts over: the gap a quiet
        // page built up must not leave the new page's tree empty that long.
        // A navigation that starts while an action is followed, such as one
        // a click sets off a second later, carries the follow-up to the page
        // it leads to, from that page's first read.
        const a = autoRefresh.current;
        cancelAutoRefreshTimer();
        a.navigationPending = a.armedTab !== null;
        a.leavingDocument = a.readDocument;
        a.lastReadStartedAt = 0;
        a.lastReadEndedAt = 0;
        a.autoReads = 0;
        a.follow = followNavigation(a.follow, Date.now());
        a.firstUnreadChangeAt = Infinity;
        followKeyNavigationRef.current();
        return;
      }

      // The content script sends a tree after every burst of page changes,
      // or its frame's skeleton while Chrome's tree shows, so it is native
      // auto-refresh's "the page changed" signal too: the top frame's, and
      // that of every frame the page shows, which the native read covers as
      // well.
      if (
        message.type === "TREE_DATA" &&
        Array.isArray(message.payload.pageChangedAt)
      ) {
        const a = autoRefresh.current;
        const now = Date.now();
        for (const stamp of message.payload.pageChangedAt) {
          if (typeof stamp !== "number" || !Number.isFinite(stamp)) continue;
          // Never ahead of now, should the page's clock and ours disagree.
          const at = Math.min(stamp, now);
          a.lastChangeAt = Math.min(Math.max(a.lastChangeAt, at), now);
          if (at > a.lastReadStartedAt) {
            a.firstUnreadChangeAt = Math.min(a.firstUnreadChangeAt, at);
            a.follow = followChange(a.follow, at);
          }
        }
        const next = quietPeriodOnSignal(a.signalSince, now);
        if (next.kind === "restart") {
          a.signalSince ??= now;
          scheduleAutoRefresh(next.ms);
        }
      }

      if (message.type === "TREE_DATA" || message.type === "TREE_UPDATED") {
        // A skeleton says the page is there, its title, and where its frames
        // are. It is no tree, and leaves the last one as it was.
        const skeleton =
          message.type === "TREE_DATA" && message.payload.framesOnly === true;
        setTreePending(skeleton);
        if (!skeleton) {
          setNodes(new Map<string, SemanticNode>(message.payload.nodes));
          setRootId(message.payload.rootId);
        }
        setConnected(true);
        // A tree is proof of reach, whoever asked for it — a live update from
        // a frame that loaded late clears the verdict as well as a retry does.
        setPageUnreachable(false);
        if (message.type === "TREE_DATA" && "pageTitle" in message.payload) {
          setPageTitle(message.payload.pageTitle || "");
          setPageUrl(message.payload.pageUrl || "");
        }
      }

      // The user acted on the page itself: follow what it does next, as
      // after an action sent through the tree (`followPageInput`). A page
      // that changes nothing in that time is read no more than before. Not
      // while auto-refresh is paused, which only Refresh resumes.
      if (
        message.type === "PAGE_INPUT" &&
        typeof message.at === "number" &&
        Number.isFinite(message.at) &&
        autoRefresh.current.armedTab !== null &&
        autoRefresh.current.armedTab === myTabIdRef.current
      ) {
        const a = autoRefresh.current;
        const now = Date.now();
        // Never ahead of now, should the page's clock and ours disagree.
        a.follow = followPageInput(
          a.follow,
          Math.min(message.at, now),
          a.lastChangeAt,
          now,
        );
      }
      // The user typed on the page: what they type isn't what a click did.
      if (
        message.type === "PAGE_TYPING" &&
        typeof message.at === "number" &&
        Number.isFinite(message.at)
      ) {
        const a = autoRefresh.current;
        const now = Date.now();
        // Never ahead of now, should the page's clock and ours disagree,
        // and the key never after the edit it made.
        const at = Math.min(message.at, now);
        const pressedAt =
          typeof message.pressedAt === "number" &&
          Number.isFinite(message.pressedAt)
            ? Math.min(message.pressedAt, at)
            : at;
        a.follow = followTyping(a.follow, at, pressedAt, now);
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

      if (message.type === "FOCUS_CHANGED" && focusTrackerOnRef.current) {
        const numbered = nativePageKeys.current;
        const nodeId = numbered
          ? nativeRowForPageFocus(
              message.payload.pageKeys,
              numbered.readId,
              numbered.rows,
              message.payload.frameId ?? 0,
            )
          : undefined;
        if (nodeId !== undefined) {
          setNativePageFocus((prev) => ({
            nodeId,
            nonce: (prev?.nonce ?? 0) + 1,
          }));
        }
      }

      if (message.type === "NATIVE_PICK_RESULT") {
        // Background's reply to NATIVE_PICK_START, for any of three
        // outcomes: a click resolved to a node, the pick was cancelled
        // (Escape, tab switch — see the cleanup effect below), or the
        // attach/dispatch itself failed (DevTools
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
        // mirror comes off here.
        setPickModeOn(false);
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
            // The banner over the tree says why (`nativeCapability`).
            setNativeCapability(blockedBy(message.payload.reason));
            setNativeStatus("native unavailable");
          } else {
            setNativeStatus(`pick failed: ${message.payload.error}`);
          }
        } else if (message.payload.timedOut) {
          announce("Pick ended: nothing was clicked within a minute.", 4000);
        }
      }

      if (message.type === "NATIVE_PICK_ARMED") {
        if (message.requestId !== nativePickRequestId.current) return;
        setNativePickArmed(true);
      }
    };

    chrome.runtime.onMessage.addListener(handler);

    // No initial REQUEST_TREE here — the myTabId effect above sends one as
    // soon as we know which tab we're bound to.

    return () => {
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, [resetNativeState, announce, showTab, showWindowTab]);

  // The tree the page's frames send follows the view. Binding a tab asks for
  // it (`sendTreeRequest`), and until then there's nowhere to ask: with no
  // tab named, it would go to the tab last switched to, in any window.
  useEffect(() => {
    if (myTabIdRef.current !== null) {
      sendToBoundTab({ type: "SET_VIEW_MODE", payload: askedTree() });
    }
    // `askedTree` reads it through a ref, current by now.
  }, [framesOnly, sendToBoundTab]);

  /** A tab stop the TAB view selects: the page outlines its element. */
  const handleSelect = useCallback(
    (id: string) => {
      sendToBoundTab({
        type: "HIGHLIGHT_NODE",
        payload: { nodeId: id },
      });
    },
    [sendToBoundTab],
  );

  /** A tab stop the TAB view activates, through the content script: the
   *  rows are the page's own walk's, not Chrome's tree's. */
  const handleActivate = useCallback(
    (id: string, explicitAction?: ActionType) => {
      const node = asDom(nodes.get(id));
      if (!node) return;

      // Stepper keys (+/−/Shift+Enter) pass their own action, so each
      // dispatches its own step. Every other path (plain Enter, Activate)
      // picks the primary action.
      const primaryAction =
        explicitAction ?? getPrimaryAction(node.interaction.actions);
      if (!primaryAction) return;

      // Text input — open inline input panel
      if (
        primaryAction === "type" ||
        (primaryAction === "focus" && node.interaction.isEditable)
      ) {
        sendToBoundTab(
          { type: "GET_FIELD_STATE", payload: { nodeId: id } },
          (response: unknown) => {
            if (!isFieldStateSuccess(response)) return;
            setInputState(
              domTextInputState(
                id,
                node.a11y.name || node.dom.tagName,
                response,
              ),
            );
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
        // answered and refused — which is how it reports that the action
        // can't run, the element gone since the page was read, say. Without
        // the second, the optimistic banner set above stays on screen
        // claiming something happened.
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
    [nodes, sendToBoundTab, reExtract, announce],
  );

  // ---- Chrome's tree: reads and actions ----
  // Cheap pre-flight (no attach) — refreshed whenever the bound tab changes,
  // so the capability banner tracks the CURRENT tab. Mirrors DogfoodPanel's
  // refreshCapability, driven by App's own authoritative myTabId instead of
  // polling chrome.tabs itself.
  const refreshNativeCapability = useCallback(async (tabId: number) => {
    const token = nativeOpToken.current;
    const cap = (await chrome.runtime.sendMessage({
      type: "NATIVE_CAPABILITY",
      tabId,
    })) as TabCapability;
    if (token !== nativeOpToken.current) return; // superseded by a tab switch
    setNativeCapability(cap);
  }, []);

  useEffect(() => {
    if (myTabId === null) return;
    void refreshNativeCapability(myTabId);
  }, [myTabId, refreshNativeCapability]);

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
   *  Returns whether the read succeeded — the default read's effect below is
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
   *  on Chrome's bar. Any other read starts auto-refresh's back-off over, as
   *  does an automatic one that `followsAction` (`ACTION_FOLLOW_MS`). */
  const loadNativeTreeCore = useCallback(
    async (
      tabId: number,
      {
        auto = false,
        followsAction = false,
      }: { auto?: boolean; followsAction?: boolean } = {},
    ): Promise<boolean> => {
      const token = nativeOpToken.current;
      const a = autoRefresh.current;
      a.lastReadStartedAt = Date.now();
      // Whatever changed before now, this read sees.
      a.firstUnreadChangeAt = Infinity;
      a.follow = followReadStarted(a.follow);
      a.autoReads = auto && !followsAction ? a.autoReads + 1 : 0;
      if (!auto) {
        setNativeBusy(true);
        // A read on a tab with a pick armed queues behind the pick, which
        // ends only with a click, Escape or its time limit. Say so.
        setNativeStatus(
          pickModeOnRef.current
            ? "waiting for the pick to end — click an element on the page, or press Esc"
            : "reading native tree…",
        );
      }
      // Numbered for Focus sync only while it is on: it costs the read a walk
      // of each document, the page's and its frames', twice.
      const numbered = focusTrackerOnRef.current;
      try {
        const r = (await chrome.runtime.sendMessage({
          type: "NATIVE_READ",
          tabId,
          ...(auto ? { auto: true } : {}),
          ...(numbered ? { pageKeys: true } : {}),
        })) as {
          ok?: boolean;
          error?: string;
          reason?: NativeUnavailableReason;
          nodes?: NativeNode[];
          rootId?: string;
          url?: string;
          documentId?: string;
          pageKeysReadId?: string;
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
          nativePageKeys.current = undefined;
          if (r?.reason) {
            // The banner over the tree says why; the status line, which a
            // screen reader hears for certain, says only that it can't.
            setNativeCapability(blockedBy(r.reason));
            setNativeStatus("native unavailable");
          } else {
            setNativeStatus(
              r?.error === "cancelled-by-user"
                ? "you cancelled Chrome's debugging bar"
                : `read failed: ${r?.error ?? "unknown"}`,
            );
          }
          return false;
        }
        const read = new Map((r.nodes ?? []).map((n) => [n.id, n]));
        setNativeNodes(read);
        // Ahead of the render, for a caller that looks at what it just read.
        nativeNodesRef.current = read;
        // A read that didn't number the page leaves this tree unfollowed:
        // the numbers from an earlier read name rows of an earlier tree.
        nativePageKeys.current =
          r.pageKeysReadId !== undefined
            ? { readId: r.pageKeysReadId, rows: nativeRowsByPageKey(read) }
            : undefined;
        // Focus sync was turned on while this read was under way: number the
        // tree now, once this read has let go of the in-flight guard.
        if (!numbered && focusTrackerOnRef.current) {
          setTimeout(() => numberNativeTree.current(), 0);
        }
        setNativeRootId(r.rootId ?? "");
        setNativeTreeTabId(tabId);
        setNativeEverRead(true);
        hasAppliedNativeDefault.current = true;
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
          a.follow = followDestination(
            a.follow,
            a.lastReadStartedAt,
            a.firstUnreadChangeAt,
            Date.now(),
          );
        }
        a.readDocument = r.documentId;
        return true;
      } finally {
        a.lastReadEndedAt = Date.now();
        if (!auto && token === nativeOpToken.current) setNativeBusy(false);
      }
    },
    [disarmAutoRefresh, resumePreviews],
  );

  /** Guarded entry point for a user- or effect-triggered read (refresh
   *  button, auto-load). Excludes a second read/act while one is in flight —
   *  see `nativeInFlight`'s own declaration. Propagates `loadNativeTreeCore`'s
   *  success/failure so the default read's effect can tell them apart. */
  const loadNativeTree = useCallback(
    async (
      tabId: number,
      opts?: { auto?: boolean; followsAction?: boolean },
    ): Promise<boolean> => {
      // The user's read waits for an automatic one rather than being dropped
      // by the in-flight guard below: the user didn't start that one, so it
      // mustn't cost them a click.
      if (!opts?.auto && !(await waitForAutoRead())) return false;
      if (nativeInFlight.current) return false;
      nativeInFlight.current = true;
      try {
        return await loadNativeTreeCore(tabId, opts);
      } finally {
        nativeInFlight.current = false;
      }
    },
    [loadNativeTreeCore, waitForAutoRead],
  );

  // Chrome's tree is numbered for Focus sync only while it is on, so a tree
  // read with it off has nothing to follow focus by: once it is on, read the
  // tree again. Automatically, as auto-refresh does: it keeps the tree on
  // screen if it fails, shows no busy state, and doesn't attach over the
  // user's Cancel on Chrome's bar. While another read is under way it waits:
  // that read's reply calls this again if it wasn't numbered.
  numberNativeTree.current = () => {
    const tabId = myTabIdRef.current;
    if (
      tabId === null ||
      !focusTrackerOnRef.current ||
      nativeNodesRef.current.size === 0 ||
      nativePageKeys.current !== undefined ||
      nativeInFlight.current
    ) {
      return;
    }
    void loadNativeTree(tabId, { auto: true });
  };

  // Re-pointed every render so the timer always decides with the current
  // `loadNativeTree`; everything else it reads is a ref.
  runNativeAutoRefresh.current = () => {
    const a = autoRefresh.current;
    const decision = decideAutoRefresh(
      {
        mode: followPageChangesRef.current ? "changes" : "navigation",
        armedTab: a.armedTab,
        boundTab: myTabIdRef.current,
        navigationPending: a.navigationPending,
        lastChangeAt: a.lastChangeAt,
        firstFollowedChangeAt: a.follow.firstChangeAt,
        lastReadStartedAt: a.lastReadStartedAt,
        lastReadEndedAt: a.lastReadEndedAt,
        autoReads: a.autoReads,
        followUntil: a.follow.until,
        actionFollowUntil: a.follow.actionUntil,
        busy: nativeInFlight.current || pickModeOnRef.current,
      },
      Date.now(),
    );
    if (decision.kind === "wait") scheduleAutoRefresh(decision.ms);
    else if (decision.kind === "read") {
      // A reply that never arrives (an unreachable service worker) attached
      // nothing, so it leaves auto-refresh armed for the next change.
      const read = loadNativeTree(decision.tabId, {
        auto: true,
        followsAction: decision.followsAction === true,
      }).catch(() => false);
      a.inFlight = read;
      void read.finally(() => {
        if (a.inFlight === read) a.inFlight = null;
      });
    }
  };

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
   *  `hasAppliedNativeDefault` exists to prevent elsewhere). If it did NOT move,
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
      // Left the tab: a read now would attach `chrome.debugger` for a tree
      // nobody is looking at.
      const abandoned = () => tabChangeToken.current !== tabChangeAtStart;
      let lastSeenToken = nativeOpToken.current;
      for (let hop = 0; hop < MAX_NAV_RECOVERY_HOPS; hop++) {
        if (abandoned()) return;
        await sleep(NATIVE_SETTLE_MS);
        if (abandoned()) return;
        if (nativeOpToken.current === lastSeenToken) break; // no further nav during the wait — settled
        lastSeenToken = nativeOpToken.current;
      }
      // The destination may go on loading after this read, as the page an
      // action stays on may go on reacting.
      if (await loadNativeTreeCore(tabId)) followActionAftermath();
    },
    [loadNativeTreeCore, followActionAftermath],
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
   *  tab. The caller holds `nativeInFlight`: this reads
   *  through the unguarded core. A read that succeeds, of either page, has
   *  the page's next changes followed for a while (`ACTION_FOLLOW_MS`).
   *  Resolves whether it read the page the operation ran on — not when the
   *  read failed or the page navigated. */
  const settleThenReread = useCallback(
    async (
      tabId: number,
      token: number,
      tabChangeAtStart: number,
    ): Promise<boolean> => {
      const abandoned = () => tabChangeToken.current !== tabChangeAtStart;
      // Always settle before checking staleness or reading again — even when
      // `nativeOpToken` already moved (a same-tab link click can make
      // PAGE_NAVIGATED, fired on `onBeforeNavigate` in background.ts, win the
      // race against the operation's own round trip). Reading immediately
      // would race the navigation and land on the old document, or on a new
      // one that hasn't settled yet. Still a single attempt, not a
      // wait-for-load: what lands later, on this page or a destination slower
      // than NATIVE_SETTLE_MS, is read once the page goes quiet
      // (`followActionAftermath`), and Refresh is there either way.
      await sleep(NATIVE_SETTLE_MS);
      if (abandoned()) return false;
      if (token !== nativeOpToken.current) {
        await recoverFromOwnNavigation(tabId, tabChangeAtStart);
        return false;
      }
      const ok = await loadNativeTreeCore(tabId);
      if (ok) followActionAftermath();
      else if (token !== nativeOpToken.current && !abandoned()) {
        await recoverFromOwnNavigation(tabId, tabChangeAtStart);
      }
      return ok;
    },
    [loadNativeTreeCore, recoverFromOwnNavigation, followActionAftermath],
  );

  // The default read (see `hasAppliedNativeDefault`). It waits for
  // `connected`: the page's content script reaching the panel first is what
  // proves there is a page there at all. A read that fails leaves its reason
  // on screen (the tree's status line and capability banner), and the
  // default for the next tab: Refresh reads this one again. A read some
  // other operation superseded (the `token` check) leaves whatever that
  // operation left alone.
  useEffect(() => {
    if (!connected || myTabId === null) return;
    if (hasAppliedNativeDefault.current) return;
    if (nativeDefaultFailedOn.current.has(myTabId)) return;
    // Another read is in flight (a refresh, an action's re-read). Reading
    // now would come back `false` because it's busy, not because the page
    // can't be read, so wait: `nativeBusy` is a dependency, and this runs
    // again once that read clears.
    if (nativeInFlight.current) return;
    hasAppliedNativeDefault.current = true;
    const tabId = myTabId;
    const token = nativeOpToken.current;
    const failed = () => {
      if (token !== nativeOpToken.current) return false;
      hasAppliedNativeDefault.current = false;
      nativeDefaultFailedOn.current.add(tabId);
      return true;
    };
    void loadNativeTree(tabId).then(
      (ok) => {
        if (!ok) failed();
      },
      // sendMessage rejected outright: the service worker didn't wake, or
      // the context was torn down.
      () => {
        if (failed())
          setNativeStatus("read failed: the extension didn't answer");
      },
    );
  }, [connected, myTabId, nativeBusy, loadNativeTree]);

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
      if (nativeInFlight.current) return;
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
        // Every failure is reported where a TAB row's is, in the feedback
        // bar; the status line alone is easy to miss.
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
          nativePageKeys.current = undefined;
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
      // A real `<select>` opens the same option picker a TAB row's does,
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
      // Typable fields reuse the SAME InputPanel a TAB row's field opens —
      // the point of this integration over DogfoodPanel's crude `prompt()`.
      // No GET_FIELD_STATE round trip needed: unlike a TAB row's, a native
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
      // That holds for every field whose value is withheld (`masksRetype`),
      // not only one that reads `[redacted]`. A withheld field can hold
      // something the tree doesn't show at all: an editor around a card field
      // reads no value, not even `[redacted]`, a field inside a sensitive one
      // loses its own, and one the in-page read couldn't classify shows none.
      // An unedited submit would type "" over all of it — for the editor, its
      // text and the card field inside it.
      //
      // Prefilled from `rawValue`, not `value`: `value` is what a screen
      // reader announces, whitespace-collapsed and capped at 240 characters,
      // so an unedited submit of it would flatten a textarea's line breaks
      // or cut a long value short. `rawValue` is an input's or textarea's
      // text as it is. An editor has none — the tree shows its text, but a
      // retype replaces the whole of it — so it opens empty too, and gets
      // the same empty-submit block: an unedited Enter must not wipe it.
      //
      // The block goes with the box opening empty, whatever the reason: a
      // field nothing withholds that shows no value isn't necessarily empty.
      // Chromium gives an editor no value at all when it holds no text, only
      // an image or a nested control, and an unedited submit would type ""
      // over it, deleting them. A field that really is empty loses nothing
      // when that submit cancels instead.
      const withheld = masksRetype(node);
      const unprefillable =
        withheld || (node.value !== undefined && node.rawValue === undefined);
      const prefill = unprefillable ? "" : (node.rawValue ?? "");
      if (isTypableRole(node.role, node.states)) {
        setInputState({
          type: "text",
          nodeId: node.id,
          label: node.name || node.role,
          value: prefill,
          placeholder: node.placeholder,
          source: "native",
          // A textarea's or an editor's box keeps line breaks, as typed and
          // as `rawValue` holds them.
          ...(node.states?.["multiline"] === true ? { multiline: true } : {}),
          // Mask the retyped replacement the same way a TAB row's box is
          // masked (inputType, set by `domTextInputState`, checked in
          // InputPanel.tsx).
          // The wire carries each field's verdict (`valueWithheld`, beside
          // `redacted`), never the raw `type` attribute behind it, and the
          // policy isn't only type="password" (R1: a sensitive-autocomplete
          // text field is sensitive too). So this masks by the verdict: every
          // field whose value is withheld, an empty one included, not only
          // one that reads `[redacted]` — see the gate's own doc. Erring
          // toward masking more, never less.
          inputType: withheld ? "password" : undefined,
          blockEmptySubmit: prefill === "",
        });
        return;
      }
      void dispatchNativeAction(node.id, "click");
    },
    [dispatchNativeAction],
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
        // An untouched empty submit never gets here: every native box that
        // opens empty sets `blockEmptySubmit`, and InputPanel cancels an
        // untouched submit from it (see `handleNativeActivate`). An empty
        // value that does arrive was typed and cleared on purpose — "empty
        // this field".
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
    // Ahead of the render, for `numberNativeTree` below and the read it
    // sends to see it.
    focusTrackerOnRef.current = next;
    sendToBoundTab({
      type: "SET_FOCUS_TRACKER",
      payload: { enabled: next },
    });
    if (next) numberNativeTree.current();
  }, [focusTrackerOn, sendToBoundTab]);

  // Picker mode toggle, through `chrome.debugger`'s own
  // `Overlay.setInspectMode` (`runPick` in debugger-session.ts):
  // NATIVE_PICK_RESULT comes back, handled in the message handler above.
  const togglePickMode = useCallback(() => {
    const next = !pickModeOn;
    if (nativeTreeTabId === undefined) return; // load a tree first
    // Same guard the toolbar button's own `disabled` enforces, but only for
    // ARMING — without it, the Ctrl/Cmd+Shift+C shortcut could start a pick
    // while a NATIVE_READ/NATIVE_ACT is still in flight, queueing it behind
    // an operation the UI is actively showing as disabled. Stopping an
    // already-armed pick must never be blocked by this: `nativeBusy` is
    // unrelated state that could in principle flip true while a pick is
    // outstanding, and the user still needs a way to cancel it.
    if (next && nativeBusy) return;
    // Snapshot the token this pick is armed under — compared against its
    // current value when the result arrives (see `nativePickToken`'s own
    // comment). Only on arming: a STOP's own result never reveals anything,
    // so it has nothing to stamp.
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
  }, [pickModeOn, nativeTreeTabId, nativeBusy]);

  // Ctrl/Cmd+Shift+C: toggle pick mode, mirroring DevTools' inspector
  // shortcut. Bound to the panel document so it fires whenever the panel
  // has focus. Escape on the page is Chromium's, and Escape in the panel is
  // handled below.
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
  // or `nativeTreeTabId` resetting to `undefined` (a navigation), or the
  // panel unmounting. Otherwise inspect mode stays up on the page and the
  // button stays "on" waiting for a result the panel may never see.
  //
  // It depends on `nativeTreeTabId` alone. `pickModeOn` flips false whenever
  // a pick finishes normally, and re-running the cleanup then would send a
  // STOP for a pick that's already over.
  useEffect(() => {
    const tabId = nativeTreeTabId;
    return () => {
      if (!pickModeOnRef.current || tabId === undefined) return;
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
      if (e.key !== "Escape" || !pickModeOnRef.current) return;
      e.preventDefault();
      togglePickModeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Native's scope, held here rather than in NativeTreeView so Copy can
  // export the same subtree the tree shows.
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
  // Drop a scope whose node a re-read no longer has. Every native teardown
  // (tab switch, navigation) empties `nativeNodes`, so this also
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

  // A navigation that a sent key may still cause, after its re-read has
  // already read the old page: the PAGE_NAVIGATED handler follows one that
  // lands inside the window, through `followKeyNavigationRef`.
  const nativeKeyNavWindow = useRef<{
    tabId: number;
    tabChangeAtStart: number;
    until: number;
  } | null>(null);

  // The native tree's keyboard bar and dialog indicator send through the
  // content script (`sendKeyOnly`), and the native tree is read again
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

  const closeCopyMenu = useCallback(() => closePopup("copy"), [closePopup]);

  // The TAB view's stops, while it shows them: the page's own walk, kept
  // after TAB is left only until the next time the page is read whole.
  const tabOrderShown =
    view === "tab" && !treePending && rootId !== "" && nodes.size > 0;

  // Export the selected view(s) as a Markdown report and copy to clipboard.
  // Serialized entirely panel-side from the trees the panel already holds —
  // so it's exactly what's on screen (Chrome's tree as read, scoped; the TAB
  // view's stops) and never depends on the content script being fresh.
  const doExport = useCallback(
    (selection: ExportView[]) => {
      closeCopyMenu();
      // Back to the button the menu goes with, as a menu button's items do.
      exportButtonRef.current?.focus();

      const tabsWanted = selection.includes("tab");
      // An empty selection asks for the tree, which isn't there either.
      const treeWanted = !tabsWanted || selection.some((v) => v !== "tab");
      if (
        (treeWanted && (!nativeRootId || nativeNodes.size === 0)) ||
        (tabsWanted && !tabOrderShown)
      ) {
        announce("Nothing to export yet", 2000);
        return;
      }

      const views: ExportViews = { tree: "", outline: "" };
      // A report of the tab sequence alone is the page's own walk's, at the
      // click: it follows the page while the TAB view shows.
      let meta: Omit<ExportMeta, "extensionVersion"> = {
        producer: "dom",
        pageTitle,
        pageUrl,
        capturedAt: new Date().toISOString(),
        viewLabel: "Native accessibility tree",
      };
      if (treeWanted) {
        // The subtree the tree shows.
        const nativeScope =
          nativeScopedRootId !== null
            ? nativeNodes.get(nativeScopedRootId)
            : undefined;
        const tree = nativeToExtractionResult(
          nativeNodes,
          nativeScope?.id ?? nativeRootId,
        );
        // `normalizeNativeAX` already drops every bare generic wrapper, so
        // every generic left in a native tree is one the panel shows: a named
        // group, a block of text named from its own text, or a role-less
        // editor. `serializeTree`'s default `includeGeneric: false` doesn't
        // know that and would drop it.
        views.tree = serializeTree(tree, { includeGeneric: true });
        views.outline = serializeOutline(tree);
        meta = {
          producer: tree.source!.producer,
          // The native read's own page, not the content script's, which can
          // lag a navigation or never arrive on a page only native reads. A
          // native tree carries no document title, so the content script's
          // is used only when it describes the same URL; otherwise the
          // header falls back to the URL.
          pageTitle: pageUrl && pageUrl === nativeTreeUrl ? pageTitle : "",
          pageUrl: nativeTreeUrl ?? "",
          // When the tree on screen was read: it doesn't follow the page by
          // itself, so the click's time could describe a stale tree.
          capturedAt: nativeReadAt ?? new Date().toISOString(),
          viewLabel: "Native accessibility tree",
          scope: nativeScope
            ? describeNode(nativeScope.role, nativeScope.name)
            : undefined,
        };
      }
      if (tabsWanted) {
        // Numbered at render, as the TAB view numbers its stops; the numbers
        // are display-only, never stored.
        const walk: ExtractionResult = {
          nodes,
          rootId,
          source: { producer: "dom" },
        };
        views.tabSequence = numberTabStops(serializeTabSequence(walk));
      }

      const markdown = buildExportMarkdown(
        views,
        { ...meta, extensionVersion: chrome.runtime.getManifest().version },
        selection,
      );
      navigator.clipboard.writeText(markdown).then(
        () => announce("Copied to clipboard", 2500),
        () => announce("Clipboard blocked — click the panel, then retry", 2500),
      );
    },
    [
      nativeNodes,
      nativeRootId,
      nativeScopedRootId,
      nodes,
      rootId,
      tabOrderShown,
      pageTitle,
      pageUrl,
      nativeTreeUrl,
      nativeReadAt,
      announce,
      closeCopyMenu,
    ],
  );
  // What the Copy menu offers: the tab sequence too while TAB shows it.
  const exportViews = exportViewsFor(nativeNodes.size > 0, tabOrderShown);

  // Close Settings and the Copy menu on a press outside them, or on Escape.
  const closeSettings = useCallback(() => closePopup("settings"), [closePopup]);
  useDismissible(settingsOpen, closeSettings, settingsRef, settingsButtonRef);
  useDismissible(exportMenuOpen, closeCopyMenu, exportRef, exportButtonRef);

  // The note about Chrome's debugging bar shows with the native tree, once a
  // native read has succeeded (which is when the bar has appeared), until the
  // user acknowledges it, in this window or another. Said once when it
  // appears, since a note that appears is not announced by itself.
  const showNativeNotice =
    connected && nativeEverRead && nativeNoticeSeen === false;
  const announcedNativeNotice = useRef(false);
  useEffect(() => {
    if (!showNativeNotice || announcedNativeNotice.current) return;
    announcedNativeNotice.current = true;
    announce(
      "While the panel reads a page, Chrome shows a bar saying it started debugging this browser. That's expected — see the note below the toolbar.",
      8000,
    );
  }, [showNativeNotice, announce]);

  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const themeClass = prefersDark ? "sn-theme-dark" : "sn-theme-light";

  // Settings, in each header rather than the toolbar, which is drawn only
  // once a page is connected: so it is on screen whether or not a page is
  // connected. A disclosure, not a menu: what it opens is a switch and a line
  // about it.
  const settingsDisclosure = (
    <div class="sn-dropdown" ref={settingsRef}>
      <button
        ref={settingsButtonRef}
        class="sn-toolbar-btn"
        aria-expanded={settingsOpen}
        aria-controls={settingsOpen ? "sn-settings-menu" : undefined}
        onClick={() => togglePopup("settings")}
        title="Settings"
      >
        {"Settings ▾"}
      </button>
      {settingsOpen && (
        <div
          id="sn-settings-menu"
          class="sn-dropdown-popup sn-settings-menu"
          data-sn-popup
          role="group"
          aria-label="Settings"
        >
          {/* As the shared panel's Settings has it. */}
          <ShowFullNamesSetting
            checked={showFullNames}
            onChange={setShowFullNames}
            hintId="sn-settings-full-names-hint"
          />
        </div>
      )}
    </div>
  );

  // Action feedback bar, mounted before there is a message — see the search
  // count below. The explicit `aria-live` is deliberate and overrides what
  // `role="status"` implies: this bar carries failures ("Failed: …",
  // "Clipboard blocked …") that are pulled back out of the DOM after 2.5s,
  // and a polite announcement can still be queued behind the live-relay log
  // when they go. On both screens, keyed so it stays the same element when
  // a page connects: Settings is on both, and says how a change went here.
  const feedbackRegion = (
    <div
      key="sn-feedback"
      class="sn-action-feedback"
      role="status"
      aria-live="assertive"
    >
      {lastAction && <span class="sn-action-feedback-text">{lastAction}</span>}
    </div>
  );

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
          {settingsDisclosure}
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
        {feedbackRegion}
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

  // What the header calls the page: one with no <title> is still named, as
  // the Copy report names it.
  const shownTitle = pageLabel(pageTitle, pageUrl);

  // Extract hostname for display
  const pageHost = (() => {
    try {
      return new URL(pageUrl).hostname;
    } catch {
      return "";
    }
  })();

  return (
    <div class={`sn-root ${themeClass}`}>
      {/* Page info header. Drawn for a page with no <title> too: Settings
          lives here. */}
      <div class="sn-page-header">
        <div class="sn-page-info">
          <span class="sn-page-title" title={shownTitle}>
            {shownTitle}
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
        {settingsDisclosure}
        <button
          class="sn-close-tab-btn"
          onClick={handleCloseTab}
          title="Close this tab"
          aria-label={`Close tab: ${shownTitle}`}
        >
          {"\u2715"}
        </button>
      </div>

      {/* The panel's toolbar. The tree's own controls are in a toolbar of
          their own under it (NativeTreeView's): on one row with these, they
          left the search box no room below about 530px, in a side panel
          usually 320–400px wide.

          Keyed, so that the screen shown while the panel waits for a page
          never takes over its elements: Preact leaves a ref on an element it
          reuses for one with no ref, so the Copy menu's container would
          outlive its toolbar, and the menu come back open
          (`useDismissible`). */}
      <div
        key="sn-toolbar"
        class="sn-toolbar sn-toolbar--wrap"
        role="toolbar"
        aria-label="Tree controls"
      >
        <button
          class="sn-pick-btn"
          aria-pressed={pickModeOn}
          // A pick is pressed as soon as it's asked for, but busy until
          // Chromium's inspect mode is actually on: a page click before then
          // isn't a pick.
          aria-busy={pickModeOn && !nativePickArmed}
          onClick={togglePickMode}
          disabled={
            nativeTreeTabId === undefined || (!pickModeOn && nativeBusy)
          }
          title={
            pickModeOn
              ? !nativePickArmed
                ? "Arming the picker…"
                : "Pick mode ON — click an element in the page to select it in the tree (Esc to cancel)"
              : nativeTreeTabId === undefined
                ? "Load a native tree first"
                : "Pick an element in the page (Ctrl/Cmd+Shift+C)"
          }
          aria-label="Pick element in page"
        >
          {/* Crosshair-on-cursor glyph mirroring DevTools' picker icon. */}
          {"⦿"}
        </button>

        <button
          class="sn-curtain-btn"
          aria-pressed={curtainOn}
          onClick={toggleCurtain}
          title={curtainOn ? "Show page content" : "Hide page content"}
        >
          {curtainOn ? "Curtain ON" : "Curtain"}
        </button>

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

        <div class="sn-dropdown" ref={exportRef}>
          <button
            ref={exportButtonRef}
            class="sn-toolbar-btn sn-export-btn"
            aria-haspopup="true"
            aria-expanded={exportMenuOpen}
            onClick={() => togglePopup("copy")}
            title="Copy the tree as Markdown — paste into a bug report"
          >
            {"Copy ▾"}
          </button>
          {exportMenuOpen && (
            <div
              class="sn-dropdown-popup"
              data-sn-popup
              aria-label="Copy which view"
            >
              <button
                class="sn-export-item"
                onClick={() => doExport(exportViews)}
              >
                Everything
              </button>
              {exportViews.map((item) => (
                <button
                  key={item}
                  class="sn-export-item"
                  onClick={() => doExport([item])}
                >
                  {item === "tree" ? "Native tree" : VIEW_LABELS[item]}
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
        <NativeModeNotice onAcknowledge={acknowledgeNativeNotice} />
      )}

      {feedbackRegion}

      {/* Inline input panel for text / select interactions */}
      {inputState && (
        <InputPanel
          state={inputState}
          onSubmit={handleInputSubmit}
          onCancel={handleInputCancel}
        />
      )}

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
        pageFocus={nativePageFocus}
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
        showFullNames={showFullNames}
        // Its TAB view is the page's own walk's: Chrome's tree has no tab
        // order.
        tabOrder={{
          nodes: treePending ? NO_NODES : nodes,
          rootId,
          pending: treePending,
          onHighlight: handleSelect,
          onActivate: handleActivate,
        }}
        view={view}
        onViewChange={setView}
      />

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
