/**
 * When the native tree reads itself again after the page changes on its own.
 *
 * The DOM tree updates live: the content script's mutation observer sends a
 * fresh `TREE_DATA` after every burst of changes. The native tree is read
 * over `chrome.debugger`, one attach per read, and each attach shows Chrome's
 * "…started debugging this browser" bar. So it follows the same signal, but
 * debounced and spaced out: one read once the page goes quiet, and never
 * closer than {@link AUTO_REFRESH_MIN_GAP_MS} to the previous read of any
 * kind, so a page that animates forever costs an attach every few seconds
 * rather than one per mutation.
 *
 * This module only decides. `App.tsx` owns the timer, the reads, and the
 * state the decision is made from.
 */

/** How long the page has to stay quiet before the tree is read again. The
 *  content script already batches mutations (300 ms, at most 1 s), so this
 *  waits out a burst of its `TREE_DATA` messages, not individual mutations. */
export const AUTO_REFRESH_QUIET_MS = 750;

/** The longest a stream of page-change signals can hold the quiet period
 *  off. A page that changes more often than {@link AUTO_REFRESH_QUIET_MS}
 *  (a ticking clock, a progress bar) never goes quiet, and without a
 *  ceiling would never be read again. */
export const AUTO_REFRESH_MAX_WAIT_MS = 3000;

/** The least time between the end of one native read and the start of an
 *  automatic one, before any back-off. Counts every read: a manual refresh, an action's own
 *  re-read, and an earlier automatic one. */
export const AUTO_REFRESH_MIN_GAP_MS = 3000;

/** The longest gap {@link autoRefreshGapMs} backs off to. */
export const AUTO_REFRESH_MAX_GAP_MS = 48_000;

/**
 * The gap before the next automatic read, after `unchangedReads` automatic
 * reads in a row found the tree exactly as it was. It doubles with each one,
 * up to {@link AUTO_REFRESH_MAX_GAP_MS}, and drops back as soon as a read
 * finds a change. A page can keep changing in ways the accessibility tree
 * never shows, and an attach can itself provoke one: Chrome's debugging bar
 * shrinks the viewport while it shows, and a page that re-renders on resize
 * answers every read with another change signal.
 */
export function autoRefreshGapMs(unchangedReads: number): number {
  return Math.min(
    AUTO_REFRESH_MIN_GAP_MS * 2 ** Math.max(0, unchangedReads),
    AUTO_REFRESH_MAX_GAP_MS,
  );
}

/** How far a page-change signal trails the changes it reports: the content
 *  script's `DomObserver` sends `TREE_DATA` once the page has been quiet for
 *  its debounce (300 ms). So a signal at `t` reports changes made by
 *  `t - PAGE_SIGNAL_LAG_MS`, and a read that started after that already saw
 *  them. That is what keeps an action's own re-read (250 ms after the
 *  action) from being followed by a second, automatic one.
 *
 *  The observer's 1 s ceiling can flush a continuous stream of changes
 *  sooner than that. The stream's next flush reports what this one left
 *  out; only a stream that stops within the lag of a read starting can be
 *  missed, and the next change, or Refresh, reads it. */
export const PAGE_SIGNAL_LAG_MS = 300;

export interface AutoRefreshState {
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
  /** When the page last changed, in ms: the latest page-change signal
   *  (`TREE_DATA`) less {@link PAGE_SIGNAL_LAG_MS}. */
  lastChangeAt: number;
  /** When the latest native read of any kind started, in ms. A read that
   *  started after a change already describes it. */
  lastReadStartedAt: number;
  /** When the latest native read finished, in ms. */
  lastReadEndedAt: number;
  /** Automatic reads in a row that found the tree unchanged — see
   *  {@link autoRefreshGapMs}. */
  unchangedReads: number;
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
  // Nothing changed since the latest read began.
  if (s.lastChangeAt <= s.lastReadStartedAt) return { kind: "skip" };
  if (s.busy) return { kind: "wait", ms: AUTO_REFRESH_QUIET_MS };
  const gap = s.lastReadEndedAt + autoRefreshGapMs(s.unchangedReads) - now;
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
