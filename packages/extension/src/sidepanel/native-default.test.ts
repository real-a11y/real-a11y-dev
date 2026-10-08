import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  installChromeMock,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * Native as the default view, for a user who opted in during an earlier
 * session. A default that can't read a tab falls back to DOM and must not try
 * that tab again: each retry attaches the debugger, and flashes Chrome's bar,
 * with no gesture behind it.
 */

describe("native default", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  beforeEach(() => {
    stubMatchMedia();
    chromeMock = installChromeMock({
      respond: (message) => {
        const type = (message as { type: string }).type;
        if (type === "NATIVE_FLAG_GET") return { enabled: true };
        // DevTools holds every tab, so every native read fails.
        if (type === "NATIVE_READ") {
          return {
            ok: false,
            error: "unavailable",
            reason: "devtools-conflict",
          };
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
  });
});
