import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import type { ChromeMock } from "./panel-harness.js";
import { TAB_ID, installChromeMock, stubMatchMedia } from "./panel-harness.js";

/**
 * Chrome gives each window a side panel of its own, and a panel shows only
 * its own window's tab. Before, every panel took every ACTIVE_TAB_CHANGED, so
 * moving to another window, or to a tab there, moved this window's panel to
 * that tab: its title, its live-region log and its tree were the other
 * window's.
 */

const MY_WINDOW = 1;
const OTHER_WINDOW = 2;
const POPUP_TAB = 50;

/** A promise the test settles when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Tab = { id: number; windowId: number };

describe("panel: the tab of its own window", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;
  /** Each `chrome.tabs.query` the panel made, answered when the test says. */
  let queries: Array<{
    query: { currentWindow?: boolean; windowId?: number };
    answer: ReturnType<typeof deferred<Tab[]>>;
  }>;

  beforeEach(() => {
    stubMatchMedia();
    chromeMock = installChromeMock();
    queries = [];
    Object.assign((globalThis as unknown as { chrome: object }).chrome, {
      tabs: {
        query: (query: { currentWindow?: boolean; windowId?: number }) => {
          const answer = deferred<Tab[]>();
          queries.push({ query, answer });
          return answer.promise;
        },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    render(null, container);
    container.remove();
  });

  /** The tabs the panel has bound to, in order: each sends the tab its
   *  Focus sync state. */
  function bound(): Array<number | undefined> {
    return chromeMock.sent
      .filter((m) => m.type === "SET_FOCUS_TRACKER" && m.tabId !== undefined)
      .map((m) => m.tabId);
  }

  function emit(message: object): void {
    act(() => {
      chromeMock.emit(message as ContentToPanel);
    });
  }

  function tell(tabId: number, windowId: number, focus?: boolean): void {
    emit({ type: "ACTIVE_TAB_CHANGED", tabId, windowId, focus });
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  function open(): void {
    act(() => {
      render(h(App, {}), container);
    });
  }

  /** Open the panel in `MY_WINDOW`, whose active tab is `TAB_ID`. */
  async function openOnMyTab(): Promise<void> {
    open();
    queries[0]!.answer.resolve([{ id: TAB_ID, windowId: MY_WINDOW }]);
    await settle();
  }

  it("shows its own window's active tab when it opens", async () => {
    open();
    expect(queries.map((q) => q.query)).toEqual([
      { active: true, currentWindow: true },
    ]);
    queries[0]!.answer.resolve([{ id: TAB_ID, windowId: MY_WINDOW }]);
    await settle();
    expect(bound()).toEqual([TAB_ID]);
  });

  it("stays on its tab when the user moves to a tab in another window", async () => {
    await openOnMyTab();

    tell(99, OTHER_WINDOW);
    expect(bound()).toEqual([TAB_ID]);

    // Its own window's switches it still follows.
    tell(8, MY_WINDOW);
    expect(bound()).toEqual([TAB_ID, 8]);
  });

  it("takes the latest of its own window's switches that came before it knew its window", async () => {
    open();
    tell(8, MY_WINDOW);
    tell(99, OTHER_WINDOW);
    expect(bound()).toEqual([]);

    // Asked for before those came: older than they are.
    queries[0]!.answer.resolve([{ id: TAB_ID, windowId: MY_WINDOW }]);
    await settle();
    expect(bound()).toEqual([8]);
  });

  it("leaves out a switch told for a move to this window that came before it knew its window, when the panel has focus", async () => {
    open();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    tell(8, MY_WINDOW, true);
    queries[0]!.answer.resolve([{ id: TAB_ID, windowId: MY_WINDOW }]);
    await settle();
    expect(bound()).toEqual([TAB_ID]);
  });

  it("doesn't show a tab that closed before it knew its window", async () => {
    open();
    tell(POPUP_TAB, MY_WINDOW);
    emit({ type: "TAB_CLOSED", tabId: POPUP_TAB });
    queries[0]!.answer.resolve([{ id: POPUP_TAB, windowId: MY_WINDOW }]);
    await settle();
    expect(bound()).toEqual([]);
    expect(queries.at(-1)!.query).toEqual({
      active: true,
      windowId: MY_WINDOW,
    });
    queries.at(-1)!.answer.resolve([{ id: TAB_ID, windowId: MY_WINDOW }]);
    await settle();
    expect(bound()).toEqual([TAB_ID]);
  });

  it("takes every switch when it can't learn its window", async () => {
    open();
    queries[0]!.answer.reject(new Error("No current window"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await settle();

    tell(99, OTHER_WINDOW);
    expect(bound()).toEqual([99]);
  });

  describe("a popup it shows", () => {
    async function showPopup(): Promise<void> {
      await openOnMyTab();
      tell(POPUP_TAB, MY_WINDOW);
      expect(bound()).toEqual([TAB_ID, POPUP_TAB]);
    }

    it("stays on it when the user moves to the panel itself", async () => {
      await showPopup();
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      tell(TAB_ID, MY_WINDOW, true);
      expect(bound()).toEqual([TAB_ID, POPUP_TAB]);
    });

    it("goes back to its window's tab when the user moves to the page there", async () => {
      await showPopup();
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      tell(TAB_ID, MY_WINDOW, true);
      expect(bound()).toEqual([TAB_ID, POPUP_TAB, TAB_ID]);
    });

    it("goes back to its window's tab when a tab is switched to there, panel focused or not", async () => {
      await showPopup();
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      tell(8, MY_WINDOW);
      expect(bound()).toEqual([TAB_ID, POPUP_TAB, 8]);
    });

    /** The user leaves the panel, for a window in focus or not. */
    function leavePanel(windowFocused: boolean): void {
      Object.assign((globalThis as unknown as { chrome: object }).chrome, {
        windows: {
          get: (id: number) => Promise.resolve({ id, focused: windowFocused }),
        },
      });
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      act(() => {
        window.dispatchEvent(new Event("blur"));
      });
    }

    it("goes back to its window's tab when the user moves from the panel to the page there", async () => {
      await showPopup();
      leavePanel(true);
      await settle();
      expect(queries.at(-1)!.query).toEqual({
        active: true,
        windowId: MY_WINDOW,
      });
      queries.at(-1)!.answer.resolve([{ id: TAB_ID, windowId: MY_WINDOW }]);
      await settle();
      expect(bound()).toEqual([TAB_ID, POPUP_TAB, TAB_ID]);
    });

    it("stays on a popup it was told of while it asked whether its window has focus", async () => {
      await showPopup();
      const focused = deferred<{ id: number; focused: boolean }>();
      Object.assign((globalThis as unknown as { chrome: object }).chrome, {
        windows: { get: () => focused.promise },
      });
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      act(() => {
        window.dispatchEvent(new Event("blur"));
      });
      // The user moved to another popup, which the worker tells first.
      tell(POPUP_TAB + 1, MY_WINDOW);
      focused.resolve({ id: MY_WINDOW, focused: true });
      await settle();
      expect(queries).toHaveLength(1);
      expect(bound()).toEqual([TAB_ID, POPUP_TAB, POPUP_TAB + 1]);
    });

    it("stays on it when the user moves from the panel to another window", async () => {
      await showPopup();
      leavePanel(false);
      await settle();
      expect(queries).toHaveLength(1);
      expect(bound()).toEqual([TAB_ID, POPUP_TAB]);
    });

    it("goes back to its window's tab even when the popup closes before the panel has drawn it", async () => {
      await openOnMyTab();
      act(() => {
        chromeMock.emit({
          type: "ACTIVE_TAB_CHANGED",
          tabId: POPUP_TAB,
          windowId: MY_WINDOW,
        } as ContentToPanel);
        chromeMock.emit({
          type: "TAB_CLOSED",
          tabId: POPUP_TAB,
        } as ContentToPanel);
      });
      queries.at(-1)!.answer.resolve([{ id: TAB_ID, windowId: MY_WINDOW }]);
      await settle();
      expect(bound().at(-1)).toBe(TAB_ID);
      expect(queries.at(-1)!.query).toEqual({
        active: true,
        windowId: MY_WINDOW,
      });
    });

    it("goes back to its window's tab when the popup closes", async () => {
      await showPopup();
      emit({ type: "TAB_CLOSED", tabId: POPUP_TAB });
      expect(queries.at(-1)!.query).toEqual({
        active: true,
        windowId: MY_WINDOW,
      });
      queries.at(-1)!.answer.resolve([{ id: TAB_ID, windowId: MY_WINDOW }]);
      await settle();
      expect(bound()).toEqual([TAB_ID, POPUP_TAB, TAB_ID]);
    });

    it("keeps a switch that came while it looked up its window's tab", async () => {
      await showPopup();
      emit({ type: "TAB_CLOSED", tabId: POPUP_TAB });
      tell(8, MY_WINDOW);
      // The look-up began before the switch: its answer is older.
      queries.at(-1)!.answer.resolve([{ id: TAB_ID, windowId: MY_WINDOW }]);
      await settle();
      expect(bound()).toEqual([TAB_ID, POPUP_TAB, 8]);
    });
  });

  it("looks nothing up when a tab it doesn't show closes", async () => {
    await openOnMyTab();
    emit({ type: "TAB_CLOSED", tabId: 99 });
    expect(queries).toHaveLength(1);
  });
});
