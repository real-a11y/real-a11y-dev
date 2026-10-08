/**
 * When the native tree reads itself again without being asked.
 *
 * The DOM tree updates live: the content script's mutation observer sends a
 * fresh `TREE_DATA` after every burst of changes. The native tree is read
 * over `chrome.debugger`, one attach per read, and each attach shows Chrome's
 * "…started debugging this browser" bar. So it follows that signal sparingly,
 * in one of two modes:
 *
 * - **`navigation`, the default.** One read once a same-tab navigation has
 *   settled: the first signal from the new page, then a quiet period. The
 *   page then stays as read until the user acts, refreshes or navigates,
 *   which keeps the attaches, and the bar, to the moments the user caused.
 * - **`changes`, opt-in (the "Follow page changes" setting).** A read after
 *   every burst of changes too, once the page goes quiet, never closer than
 *   {@link AUTO_REFRESH_MIN_GAP_MS} to the previous read of any kind, and
 *   backing off ({@link autoRefreshGapMs}) the longer it runs without the
 *   user, so a page that animates forever doesn't keep the bar up for good.
 *
 * Only the top frame's changes count: the native read covers the top frame.
 *
 * This module only decides. `App.tsx` owns the timer, the reads, and the
 * state the decision is made from.
 */

import {
  DOM_OBSERVER_DEBOUNCE_MS,
  DOM_OBSERVER_MAX_WAIT_MS,
} from "@real-a11y-dev/core";

/** How long to let the page react before re-reading the native tree after an
 *  action or a sent key — same rationale and value as `DogfoodPanel.tsx`'s
 *  `SETTLE_MS`. Shorter than {@link PAGE_SIGNAL_LAG_MS}, so the re-read
 *  starts after the changes the action's own signal reports, and isn't
 *  followed by an automatic read for them (pinned by this module's tests). */
export const NATIVE_SETTLE_MS = 250;

/** How long the page has to stay quiet before the tree is read again. The
 *  content script already batches mutations (`DOM_OBSERVER_DEBOUNCE_MS`, at
 *  most `DOM_OBSERVER_MAX_WAIT_MS`), so this waits out a burst of its
 *  `TREE_DATA` messages, not individual mutations. */
export const AUTO_REFRESH_QUIET_MS = 750;

/** The longest a stream of page-change signals can hold the quiet period
 *  off. A page that changes more often than {@link AUTO_REFRESH_QUIET_MS}
 *  (a ticking clock, a progress bar) never goes quiet, and without a
 *  ceiling would never be read again. */
export const AUTO_REFRESH_MAX_WAIT_MS = 3 * DOM_OBSERVER_MAX_WAIT_MS;

/** The least time between the end of one native read and the start of an
 *  automatic one, before any back-off. Counts every read: a manual refresh,
 *  an action's own re-read, and an earlier automatic one. */
export const AUTO_REFRESH_MIN_GAP_MS = 3000;

/** The longest gap {@link autoRefreshGapMs} backs off to. Long enough that
 *  Chrome's bar, which closes about 5 s after a detach, is gone for most of
 *  it on a page that never stops changing. */
export const AUTO_REFRESH_MAX_GAP_MS = 48_000;

/** Automatic reads in a row at the minimum gap before the back-off starts. */
export const AUTO_REFRESH_FREE_READS = 2;

/**
 * The gap before the next automatic read, after `autoReads` automatic reads
 * in a row with nothing from the user in between. The first
 * {@link AUTO_REFRESH_FREE_READS} come at {@link AUTO_REFRESH_MIN_GAP_MS};
 * after that each doubles, up to {@link AUTO_REFRESH_MAX_GAP_MS}. Counted by
 * attaches rather than by what they found: a page that really changes all
 * the time would otherwise be read every few seconds forever, and keep
 * Chrome's bar up for good. A read the user causes (Refresh, an action, a
 * key) or a navigation starts the count over.
 */
export function autoRefreshGapMs(autoReads: number): number {
  return Math.min(
    AUTO_REFRESH_MIN_GAP_MS *
      2 ** Math.max(0, autoReads - AUTO_REFRESH_FREE_READS + 1),
    AUTO_REFRESH_MAX_GAP_MS,
  );
}

/** How far a page-change signal trails the changes it reports: the content
 *  script's `DomObserver` sends `TREE_DATA` once the page has been quiet for
 *  its debounce. So a signal at `t` reports changes made by
 *  `t - PAGE_SIGNAL_LAG_MS`, and a read that started after that already saw
 *  them. That is what keeps an action's own re-read
 *  ({@link NATIVE_SETTLE_MS} after the action) from being followed by a
 *  second, automatic one.
 *
 *  The observer's ceiling can flush a continuous stream of changes sooner
 *  than that. The stream's next flush reports what this one left out; only
 *  a stream that stops within the lag of a read starting can be missed, and
 *  the next change, or Refresh, reads it. */
export const PAGE_SIGNAL_LAG_MS = DOM_OBSERVER_DEBOUNCE_MS;

export type AutoRefreshMode = "navigation" | "changes";

export interface AutoRefreshState {
  mode: AutoRefreshMode;
  /**
   * The tab whose native tree refreshes itself, or `null`. Set when a read
   * succeeds; cleared by a tab switch, by leaving native mode, and by a
   * failed read, so a refusal or the user's Cancel on Chrome's bar is never
   * answered by another attach. A navigation does not clear it: the new page
   * on the same tab is read once it settles.
   */
  armedTab: number | null;
  /** The tab the panel is bound to now. */
  boundTab: number | null;
  /** Native mode is on and the panel is showing the native tree. */
  native: boolean;
  /** A same-tab navigation happened and its page hasn't been read yet. */
  navigationPending: boolean;
  /** When the page last changed, in ms: the latest top-frame page-change
   *  signal (`TREE_DATA`) less {@link PAGE_SIGNAL_LAG_MS}. */
  lastChangeAt: number;
  /** When the latest native read of any kind started, in ms. A read that
   *  started after a change already describes it. */
  lastReadStartedAt: number;
  /** When the latest native read finished, in ms. */
  lastReadEndedAt: number;
  /** Automatic reads in a row since the user last caused one — see
   *  {@link autoRefreshGapMs}. */
  autoReads: number;
  /** A native read or action is in flight, or a pick is armed. A pick holds
   *  the tab's debugger queue until the user clicks, so a read queued behind
   *  it would wait that long too. */
  busy: boolean;
}

export type AutoRefreshDecision =
  | { kind: "skip" }
  | { kind: "wait"; ms: number }
  | { kind: "read"; tabId: number };

export function decideAutoRefresh(
  s: AutoRefreshState,
  now: number,
): AutoRefreshDecision {
  if (!s.native || s.armedTab === null || s.armedTab !== s.boundTab) {
    return { kind: "skip" };
  }
  // By default only a navigation's new page is read on its own.
  if (s.mode === "navigation" && !s.navigationPending) return { kind: "skip" };
  // Nothing changed since the latest read began.
  if (s.lastChangeAt <= s.lastReadStartedAt) return { kind: "skip" };
  if (s.busy) return { kind: "wait", ms: AUTO_REFRESH_QUIET_MS };
  const gap = s.lastReadEndedAt + autoRefreshGapMs(s.autoReads) - now;
  if (gap > 0) return { kind: "wait", ms: gap };
  return { kind: "read", tabId: s.armedTab };
}

/**
 * What a page-change signal does to the pending timer: restart the quiet
 * period, or, once signals have held a timer pending for
 * {@link AUTO_REFRESH_MAX_WAIT_MS}, leave it to fire. `pendingSince` is when
 * the first signal the pending timer answers arrived, or `null` when no
 * timer is pending.
 */
export function quietPeriodOnSignal(
  pendingSince: number | null,
  now: number,
): { kind: "restart"; ms: number } | { kind: "keep" } {
  if (pendingSince !== null && now - pendingSince >= AUTO_REFRESH_MAX_WAIT_MS) {
    return { kind: "keep" };
  }
  return { kind: "restart", ms: AUTO_REFRESH_QUIET_MS };
}

/** Where the "Follow page changes" setting lives in `chrome.storage.local`.
 *  Absent or false means the default `navigation` mode. */
export const FOLLOW_PAGE_CHANGES_KEY = "settings.nativeFollowPageChanges";
