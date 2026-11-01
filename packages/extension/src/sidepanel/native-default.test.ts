import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  installChromeMock,
  nativeRead,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * The read the panel makes by itself, of the first page that connects. A
 * read that can't happen on a tab says why, and the panel must not try that
 * tab again by itself: each retry attaches the debugger, and flashes
 * Chrome's bar, with no gesture behind it. Refresh still reads it.
 */

describe("the panel's own first read", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;
  /** Whether Chrome lets the debugger attach. */
  let refused: boolean;

  beforeEach(() => {
    // DevTools holds every tab, so every native read fails.
    refused = true;
    stubMatchMedia();
    chromeMock = installChromeMock({
      respond: (message) => {
        const type = (message as { type: string }).type;
        if (type === "NATIVE_READ") {
          return refused
            ? { ok: false, error: "unavailable", reason: "devtools-conflict" }
            : nativeRead();
        }
        return undefined;
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  /** Let the promise-form replies land and the effects they trigger run. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  /** The panel's bound tab becomes `tabId`, and its page connects. */
  async function showTab(tabId: number): Promise<void> {
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId,
      } as unknown as ContentToPanel);
    });
    act(() => {
      chromeMock.emit({ ...treeData(), tabId } as ContentToPanel);
    });
    await flush();
  }

  /** The tabs the panel has sent a NATIVE_READ for, in order. */
  function nativeReadTabs(): Array<number | undefined> {
    return chromeMock.sent
      .map((m) => m as unknown as { type: string; tabId?: number })
      .filter((m) => m.type === "NATIVE_READ")
      .map((m) => m.tabId);
  }

  it("doesn't retry any tab it failed on, switching A → B → A", async () => {
    act(() => {
      render(h(App, {}), container);
    });
    await flush();

    await showTab(7);
    await showTab(8);
    expect(nativeReadTabs()).toEqual([7, 8]);

    // Back on the first tab: it failed there, so no new attach.
    await showTab(7);
    expect(nativeReadTabs()).toEqual([7, 8]);

    // Refresh is a gesture: it reads the tab again.
    act(() => refresh().click());
    await flush();
    expect(nativeReadTabs()).toEqual([7, 8, 7]);
  });

  it("reads once by itself: once a read succeeds, another tab waits for Refresh", async () => {
    refused = false;
    act(() => {
      render(h(App, {}), container);
    });
    await flush();

    await showTab(7);
    expect(nativeReadTabs()).toEqual([7]);
    await showTab(8);
    expect(nativeReadTabs()).toEqual([7]);

    act(() => refresh().click());
    await flush();
    expect(nativeReadTabs()).toEqual([7, 8]);
  });

  /** Tab 8 comes forward, its page silent, and Load tree is pressed. */
  async function loadSilentTab(): Promise<void> {
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: 8,
      } as unknown as ContentToPanel);
    });
    await flush();
    expect(nativeReadTabs()).toEqual([7]);
    act(() => button("Load tree").click());
    await flush();
  }

  it("reads a tab switched to when Load tree is pressed: the press is the gesture", async () => {
    refused = false;
    act(() => {
      render(h(App, {}), container);
    });
    await flush();
    await showTab(7);

    await loadSilentTab();
    // Read at once, not left for a Refresh once the page answers.
    expect(nativeReadTabs()).toEqual([7, 8]);
  });

  it("reads nothing through Chrome on Load tree while the TAB view shows", async () => {
    refused = false;
    act(() => {
      render(h(App, {}), container);
    });
    await flush();
    await showTab(7);
    act(() => button("TAB").click());
    await flush();

    // The TAB view needs no debugger: Load tree asks the page alone.
    await loadSilentTab();
    expect(nativeReadTabs()).toEqual([7]);
  });

  const refresh = () =>
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="Refresh native tree"]',
    )!;
  const button = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === label,
    )!;
});
