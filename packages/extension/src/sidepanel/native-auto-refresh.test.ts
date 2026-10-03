import { describe, expect, it } from "vitest";

import {
  AUTO_REFRESH_MIN_GAP_MS,
  AUTO_REFRESH_QUIET_MS,
  decideAutoRefresh,
  PAGE_SIGNAL_LAG_MS,
  type AutoRefreshState,
} from "./native-auto-refresh.js";

const NOW = 100_000;

function state(over: Partial<AutoRefreshState> = {}): AutoRefreshState {
  return {
    armedTab: 7,
    boundTab: 7,
    native: true,
    lastChangeAt: NOW - 5000,
    lastReadStartedAt: NOW - 6000,
    lastReadEndedAt: NOW - AUTO_REFRESH_MIN_GAP_MS - 1,
    busy: false,
    ...over,
  };
}

describe("decideAutoRefresh", () => {
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
    // An action's re-read starts 250 ms after the action; the page's signal
    // for that action's changes lands 300 ms after them, i.e. after the
    // re-read began, but it reports changes the re-read already saw.
    const actionAt = NOW - 5000;
    const signalAt = actionAt + PAGE_SIGNAL_LAG_MS;
    expect(
      decideAutoRefresh(
        state({
          lastChangeAt: signalAt - PAGE_SIGNAL_LAG_MS,
          lastReadStartedAt: actionAt + 250,
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

  it("reads once the gap has passed exactly", () => {
    expect(
      decideAutoRefresh(
        state({ lastReadEndedAt: NOW - AUTO_REFRESH_MIN_GAP_MS }),
        NOW,
      ),
    ).toEqual({ kind: "read", tabId: 7 });
  });
});
