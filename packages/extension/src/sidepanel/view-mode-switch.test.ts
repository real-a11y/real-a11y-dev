import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  NATIVE_TREE,
  TAB_ID,
  installChromeMock,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * Switching Chrome's tree between its A11Y and TAB views must not put the
 * panel through the tab-switch teardown, nor read the page again: the tree,
 * its selection and its scope are all still there when A11Y comes back.
 */

describe("switching Chrome's tree between A11Y and TAB", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  beforeEach(() => {
    stubMatchMedia();
    chromeMock = installChromeMock({ nativeTree: NATIVE_TREE });
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

  function toggleButton(label: string): HTMLButtonElement {
    const btn = [...container.querySelectorAll("button.sn-toggle-btn")].find(
      (b) => b.textContent?.trim() === label,
    );
    if (!btn) throw new Error(`no ${label} toggle button rendered`);
    return btn as HTMLButtonElement;
  }

  function row(nodeId: string): HTMLElement {
    const el = container.querySelector(`[data-node-id="${nodeId}"]`);
    if (!el) throw new Error(`no row rendered for ${nodeId}`);
    return el as HTMLElement;
  }

  const reads = () =>
    chromeMock.sent.filter(
      (m) => (m as { type: string }).type === "NATIVE_READ",
    );

  /** The panel on Chrome's tree, a row selected and the tree scoped to the
   *  toolbar. */
  async function mountLoadedPanel(): Promise<void> {
    act(() => {
      render(h(App, {}), container);
    });
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: TAB_ID,
      } as unknown as ContentToPanel);
    });
    act(() => {
      chromeMock.emit(treeData());
    });
    await flush();
    act(() => {
      row("ax-3").click();
    });
    act(() => {
      row("ax-2").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
  }

  it("keeps Chrome's tree, its selection and its scope through the TAB view", async () => {
    await mountLoadedPanel();
    expect(row("ax-3").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector(".sn-scope-bar")).not.toBeNull();
    const readsBefore = reads().length;

    act(() => {
      toggleButton("TAB").click();
    });
    await flush();
    expect(container.textContent).not.toContain("Connecting to page...");
    expect(toggleButton("TAB").getAttribute("aria-pressed")).toBe("true");
    // The TAB view asks the page for its whole tree, once.
    expect(
      chromeMock.sent.filter((m) => m.type === "SET_VIEW_MODE"),
    ).toHaveLength(1);

    act(() => {
      toggleButton("A11Y").click();
    });
    await flush();
    expect(container.textContent).not.toContain("Connecting to page...");
    expect(row("ax-3").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector(".sn-scope-bar")).not.toBeNull();
    // Chrome's tree came back as it was, without another read.
    expect(reads()).toHaveLength(readsBefore);
  });

  it("still tears the panel down when the bound tab changes", async () => {
    await mountLoadedPanel();

    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: TAB_ID + 1,
      } as unknown as ContentToPanel);
    });

    // A different tab's tree is not this tab's tree: the panel drops it and
    // waits for the new tab's page.
    expect(container.textContent).toContain("Connecting to page...");
    expect(container.querySelector('[data-node-id="ax-3"]')).toBeNull();
  });
});
