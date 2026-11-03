import { DOM_OBSERVER_DEBOUNCE_MS } from "@real-a11y-dev/core";
import { describe, expect, it } from "vitest";

import {
  ACTION_FOLLOW_MS,
  AUTO_REFRESH_FREE_READS,
  AUTO_REFRESH_MAX_GAP_MS,
  AUTO_REFRESH_MAX_WAIT_MS,
  AUTO_REFRESH_MIN_GAP_MS,
  AUTO_REFRESH_QUIET_MS,
  autoRefreshGapMs,
  decideAutoRefresh,
  NATIVE_SETTLE_MS,
  quietPeriodOnSignal,
  type AutoRefreshState,
} from "./native-auto-refresh.js";

const NOW = 100_000;

function state(over: Partial<AutoRefreshState> = {}): AutoRefreshState {
  const s = {
    mode: "changes" as const,
    armedTab: 7,
    boundTab: 7,
    navigationPending: false,
    lastChangeAt: NOW - 5000,
    lastReadStartedAt: NOW - 6000,
    lastReadEndedAt: NOW - AUTO_REFRESH_MIN_GAP_MS - 1,
    autoReads: 0,
    followUntil: 0,
    busy: false,
    ...over,
  };
  // One unread change unless a test says otherwise: the latest, followed
  // when it falls in the window, which an action's re-read opened unless a
  // test says the user's input on the page did.
  return {
    ...s,
    firstFollowedChangeAt:
      over.firstFollowedChangeAt ??
      (s.lastChangeAt > s.lastReadStartedAt && s.lastChangeAt < s.followUntil
        ? s.lastChangeAt
        : Infinity),
    actionFollowUntil: over.actionFollowUntil ?? s.followUntil,
  };
}

describe("decideAutoRefresh in the default navigation mode", () => {
  it("reads the page a navigation brought, once it has changed", () => {
    expect(
      decideAutoRefresh(
        state({ mode: "navigation", navigationPending: true }),
        NOW,
      ),
    ).toEqual({ kind: "read", tabId: 7 });
  });

  it("leaves an ordinary page change alone", () => {
    // Only the "Follow page changes" setting reads on every change.
    expect(decideAutoRefresh(state({ mode: "navigation" }), NOW)).toEqual({
      kind: "skip",
    });
  });

  it("waits for the new page's first signal after a navigation", () => {
    expect(
      decideAutoRefresh(
        state({
          mode: "navigation",
          navigationPending: true,
          lastChangeAt: NOW - 7000,
        }),
        NOW,
      ),
    ).toEqual({ kind: "skip" });
  });
});

describe("decideAutoRefresh in changes mode", () => {
  it("reads the armed tab once the page changed after the last read", () => {
    expect(decideAutoRefresh(state(), NOW)).toEqual({
      kind: "read",
      tabId: 7,
    });
  });

  it("skips when nothing changed since the last read began", () => {
    expect(
      decideAutoRefresh(state({ lastReadStartedAt: NOW - 5000 }), NOW),
    ).toEqual({ kind: "skip" });
  });

  it("counts a change made before a read started as read", () => {
    // An action's re-read starts NATIVE_SETTLE_MS after the action. The
    // page's signal for what the action did at once arrives after that, but
    // carries when the page changed, which is before the re-read began.
    const actionAt = NOW - 5000;
    expect(
      decideAutoRefresh(
        state({
          lastChangeAt: actionAt + 50,
          lastReadStartedAt: actionAt + NATIVE_SETTLE_MS,
        }),
        NOW,
      ),
    ).toEqual({ kind: "skip" });
  });

  it("skips when no read has armed it, or a failed read disarmed it", () => {
    expect(decideAutoRefresh(state({ armedTab: null }), NOW)).toEqual({
      kind: "skip",
    });
  });

  it("never reads a tab the panel has switched away from", () => {
    expect(decideAutoRefresh(state({ boundTab: 9 }), NOW)).toEqual({
      kind: "skip",
    });
  });

  it("waits out a read, an action or a pick in flight", () => {
    expect(decideAutoRefresh(state({ busy: true }), NOW)).toEqual({
      kind: "wait",
      ms: AUTO_REFRESH_QUIET_MS,
    });
  });

  it("keeps the minimum gap after the previous read of any kind", () => {
    expect(
      decideAutoRefresh(state({ lastReadEndedAt: NOW - 1000 }), NOW),
    ).toEqual({ kind: "wait", ms: AUTO_REFRESH_MIN_GAP_MS - 1000 });
  });

  it("backs off once automatic reads run on without the user", () => {
    expect(
      decideAutoRefresh(
        state({
          autoReads: AUTO_REFRESH_FREE_READS + 2,
          lastReadEndedAt: NOW - AUTO_REFRESH_MIN_GAP_MS,
        }),
        NOW,
      ),
    ).toEqual({
      kind: "wait",
      ms:
        autoRefreshGapMs(AUTO_REFRESH_FREE_READS + 2) - AUTO_REFRESH_MIN_GAP_MS,
    });
  });
});

describe("decideAutoRefresh after an action", () => {
  // The action's own re-read ran from 4 s to 3.8 s ago, which opened the
  // window it follows the page for.
  const reread = { lastReadStartedAt: NOW - 4000, lastReadEndedAt: NOW - 3800 };
  const followUntil = reread.lastReadEndedAt + ACTION_FOLLOW_MS;

  it("reads what the page does next in the default mode too", () => {
    // A form the click loads over the network, after the re-read.
    expect(
      decideAutoRefresh(
        state({
          mode: "navigation",
          ...reread,
          lastChangeAt: NOW - 1000,
          followUntil,
        }),
        NOW,
      ),
    ).toEqual({ kind: "read", tabId: 7, followsAction: true });
  });

  it("reads it at once, whatever gap the back-off had reached", () => {
    expect(
      decideAutoRefresh(
        state({
          ...reread,
          lastReadEndedAt: NOW - 100,
          autoReads: AUTO_REFRESH_FREE_READS + 3,
          lastChangeAt: NOW - 1000,
          followUntil,
        }),
        NOW,
      ),
    ).toEqual({ kind: "read", tabId: 7, followsAction: true });
  });

  it("goes by when the page changed, not by when it went quiet", () => {
    // Changed inside the window; quiet only after it closed.
    expect(
      decideAutoRefresh(
        state({
          mode: "navigation",
          ...reread,
          lastChangeAt: followUntil - 1,
          followUntil,
        }),
        followUntil + AUTO_REFRESH_QUIET_MS,
      ),
    ).toEqual({ kind: "read", tabId: 7, followsAction: true });
  });

  it("reads a change made in the window though a later one came after it", () => {
    // Two changes arrive together, or one soon after the other: the first
    // inside the window, the latest just past it.
    expect(
      decideAutoRefresh(
        state({
          mode: "navigation",
          ...reread,
          firstFollowedChangeAt: followUntil - 1,
          lastChangeAt: followUntil + 1,
          followUntil,
        }),
        NOW,
      ),
    ).toEqual({ kind: "read", tabId: 7, followsAction: true });
  });

  it("leaves a change after the window to the mode's own rules", () => {
    const later = {
      ...reread,
      lastReadEndedAt: NOW - 100,
      lastChangeAt: followUntil,
      followUntil,
    };
    expect(
      decideAutoRefresh(state({ mode: "navigation", ...later }), NOW),
    ).toEqual({ kind: "skip" });
    expect(decideAutoRefresh(state(later), NOW)).toEqual({
      kind: "wait",
      ms: AUTO_REFRESH_MIN_GAP_MS - 100,
    });
  });

  it("doesn't read again what the action's own re-read saw", () => {
    expect(
      decideAutoRefresh(
        state({
          mode: "navigation",
          ...reread,
          lastChangeAt: reread.lastReadStartedAt - 1,
          followUntil,
        }),
        NOW,
      ),
    ).toEqual({ kind: "skip" });
  });

  it("waits out a read or an action in flight", () => {
    expect(
      decideAutoRefresh(
        state({
          mode: "navigation",
          ...reread,
          lastChangeAt: NOW - 1000,
          followUntil,
          busy: true,
        }),
        NOW,
      ),
    ).toEqual({ kind: "wait", ms: AUTO_REFRESH_QUIET_MS });
  });

  it("follows only the tab it is armed on", () => {
    expect(
      decideAutoRefresh(
        state({
          mode: "navigation",
          ...reread,
          lastChangeAt: NOW - 1000,
          followUntil,
          boundTab: 9,
        }),
        NOW,
      ),
    ).toEqual({ kind: "skip" });
  });
});

describe("decideAutoRefresh after the user's click on the page", () => {
  // A click 1 s ago opened the window; nothing read the page for it.
  const clicked = {
    mode: "navigation" as const,
    lastReadStartedAt: NOW - 8000,
    lastReadEndedAt: NOW - 7800,
    followUntil: NOW - 1000 + ACTION_FOLLOW_MS,
    actionFollowUntil: 0,
  };

  it("reads what the page does next at once, a while after the last read", () => {
    expect(
      decideAutoRefresh(state({ ...clicked, lastChangeAt: NOW - 500 }), NOW),
    ).toEqual({ kind: "read", tabId: 7, followsAction: true });
  });

  it("keeps the minimum gap after the read before it", () => {
    // Read a moment ago, for an earlier burst in the same window.
    expect(
      decideAutoRefresh(
        state({
          ...clicked,
          lastReadStartedAt: NOW - 1200,
          lastReadEndedAt: NOW - 1000,
          lastChangeAt: NOW - 500,
        }),
        NOW,
      ),
    ).toEqual({ kind: "wait", ms: AUTO_REFRESH_MIN_GAP_MS - 1000 });
  });

  it("but no back-off, however many automatic reads came before", () => {
    expect(
      decideAutoRefresh(
        state({
          ...clicked,
          mode: "changes",
          autoReads: AUTO_REFRESH_FREE_READS + 3,
          lastReadEndedAt: NOW - AUTO_REFRESH_MIN_GAP_MS,
          lastChangeAt: NOW - 500,
        }),
        NOW,
      ),
    ).toEqual({ kind: "read", tabId: 7, followsAction: true });
  });

  it("reads at once a change made while an action was followed", () => {
    // The click stretched an action's window: what the action did is still
    // read at once.
    expect(
      decideAutoRefresh(
        state({
          ...clicked,
          lastReadStartedAt: NOW - 1200,
          lastReadEndedAt: NOW - 1000,
          actionFollowUntil: NOW - 200,
          lastChangeAt: NOW - 500,
        }),
        NOW,
      ),
    ).toEqual({ kind: "read", tabId: 7, followsAction: true });
  });

  it("leaves a change the click didn't make to the mode's own rules", () => {
    // Heard of before the click, so the panel never followed it.
    expect(
      decideAutoRefresh(
        state({
          ...clicked,
          lastChangeAt: NOW - 1500,
          firstFollowedChangeAt: Infinity,
        }),
        NOW,
      ),
    ).toEqual({ kind: "skip" });
  });
});

describe("autoRefreshGapMs", () => {
  it("keeps the minimum gap for the first few automatic reads", () => {
    for (let n = 0; n < AUTO_REFRESH_FREE_READS; n++) {
      expect(autoRefreshGapMs(n)).toBe(AUTO_REFRESH_MIN_GAP_MS);
    }
  });

  it("then doubles per read, up to the cap", () => {
    expect(autoRefreshGapMs(AUTO_REFRESH_FREE_READS)).toBe(
      2 * AUTO_REFRESH_MIN_GAP_MS,
    );
    expect(autoRefreshGapMs(AUTO_REFRESH_FREE_READS + 1)).toBe(
      4 * AUTO_REFRESH_MIN_GAP_MS,
    );
    expect(autoRefreshGapMs(100)).toBe(AUTO_REFRESH_MAX_GAP_MS);
  });

  it("lets a page that never stops changing attach only a few times a minute", () => {
    // Reads back to back at whatever gap the policy allows, for 10 minutes:
    // the attach rate it settles to is what keeps Chrome's bar, which closes
    // about 5 s after a detach, down for most of the time.
    let t = 0;
    let reads = 0;
    while (t < 10 * 60_000) {
      t += autoRefreshGapMs(reads);
      reads++;
    }
    expect(reads).toBeLessThan(20);
  });
});

describe("quietPeriodOnSignal", () => {
  it("restarts the quiet period on a signal", () => {
    expect(quietPeriodOnSignal(null, NOW)).toEqual({
      kind: "restart",
      ms: AUTO_REFRESH_QUIET_MS,
    });
    expect(quietPeriodOnSignal(NOW - 1000, NOW)).toEqual({
      kind: "restart",
      ms: AUTO_REFRESH_QUIET_MS,
    });
  });

  it("stops restarting once signals have held it off for the ceiling", () => {
    expect(quietPeriodOnSignal(NOW - AUTO_REFRESH_MAX_WAIT_MS, NOW)).toEqual({
      kind: "keep",
    });
  });
});

describe("timings the policy depends on", () => {
  it("waits out at least one signal batch before reading", () => {
    expect(AUTO_REFRESH_QUIET_MS).toBeGreaterThan(DOM_OBSERVER_DEBOUNCE_MS);
  });
});
