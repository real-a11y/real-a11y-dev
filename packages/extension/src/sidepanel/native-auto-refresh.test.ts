import { DOM_OBSERVER_DEBOUNCE_MS } from "@real-a11y-dev/core";
import { describe, expect, it } from "vitest";

import {
  AUTO_REFRESH_FREE_READS,
  AUTO_REFRESH_MAX_GAP_MS,
  AUTO_REFRESH_MAX_WAIT_MS,
  AUTO_REFRESH_MIN_GAP_MS,
  AUTO_REFRESH_QUIET_MS,
  autoRefreshGapMs,
  decideAutoRefresh,
  NATIVE_SETTLE_MS,
  PAGE_SIGNAL_LAG_MS,
  quietPeriodOnSignal,
  type AutoRefreshState,
} from "./native-auto-refresh.js";

const NOW = 100_000;

function state(over: Partial<AutoRefreshState> = {}): AutoRefreshState {
  return {
    mode: "changes",
    armedTab: 7,
    boundTab: 7,
    native: true,
    navigationPending: false,
    lastChangeAt: NOW - 5000,
    lastReadStartedAt: NOW - 6000,
    lastReadEndedAt: NOW - AUTO_REFRESH_MIN_GAP_MS - 1,
    autoReads: 0,
    busy: false,
    ...over,
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

  it("counts a change the read started after as already read", () => {
    // An action's re-read starts NATIVE_SETTLE_MS after the action; the
    // page's signal for that action's changes lands PAGE_SIGNAL_LAG_MS after
    // them, i.e. after the re-read began, but it reports changes the re-read
    // already saw.
    const actionAt = NOW - 5000;
    const signalAt = actionAt + PAGE_SIGNAL_LAG_MS;
    expect(
      decideAutoRefresh(
        state({
          lastChangeAt: signalAt - PAGE_SIGNAL_LAG_MS,
          lastReadStartedAt: actionAt + NATIVE_SETTLE_MS,
        }),
        NOW,
      ),
    ).toEqual({ kind: "skip" });
  });

  it("skips when the panel isn't showing the native tree", () => {
    expect(decideAutoRefresh(state({ native: false }), NOW)).toEqual({
      kind: "skip",
    });
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
  it("lags signals by the content script's own debounce", () => {
    expect(PAGE_SIGNAL_LAG_MS).toBe(DOM_OBSERVER_DEBOUNCE_MS);
  });

  it("starts an action's re-read before the action's own signal could count", () => {
    // Otherwise every action is followed by a second, automatic read.
    expect(NATIVE_SETTLE_MS).toBeLessThan(PAGE_SIGNAL_LAG_MS);
  });

  it("waits out at least one signal batch before reading", () => {
    expect(AUTO_REFRESH_QUIET_MS).toBeGreaterThan(DOM_OBSERVER_DEBOUNCE_MS);
  });
});
