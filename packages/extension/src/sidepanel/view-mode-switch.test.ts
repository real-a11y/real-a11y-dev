import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  TAB_ID,
  TREE,
  installChromeMock,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * Switching the DOM/A11Y/TAB view mode must not put the panel through the
 * tab-switch teardown. The two used to share one effect, so a toggle wiped the
 * tree, the selection and the scope, and dropped the panel to the "Connecting
 * to page..." screen until the re-extraction came back.
 */

describe("view-mode switching", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  beforeEach(() => {
    stubMatchMedia();
    chromeMock = installChromeMock();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  function toggleButton(label: string): HTMLButtonElement {
    const btn = [...container.querySelectorAll("button.sn-toggle-btn")].find(
      (b) => b.textContent?.trim() === label,
    );
    if (!btn) throw new Error(`no ${label} toggle button rendered`);
    return btn as HTMLButtonElement;
  }

  function tree(): HTMLElement {
    const el = container.querySelector('[role="tree"]');
    if (!el) throw new Error("no tree rendered");
    return el as HTMLElement;
  }

  function row(nodeId: string): HTMLElement {
    const el = container.querySelector(`[data-node-id="${nodeId}"]`);
    if (!el) throw new Error(`no row rendered for ${nodeId}`);
    return el as HTMLElement;
  }

  /** Panel with a tree loaded, a selected row and a scoped subtree. */
  function mountLoadedPanel(): void {
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
    act(() => {
      // Focus sync from the page is the cheapest way to move the selection.
      chromeMock.emit({
        type: "FOCUS_CHANGED",
        tabId: TAB_ID,
        payload: { nodeId: "n3" },
      } as unknown as ContentToPanel);
    });
    act(() => {
      row("n2").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
  }

  it("keeps the tree, selection and scope when the view mode changes", () => {
    mountLoadedPanel();

    expect(container.textContent).not.toContain("Connecting to page...");
    expect(row("n3").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector(".sn-scope-bar")).not.toBeNull();

    act(() => {
      toggleButton("DOM").click();
    });

    // The tab-switch teardown used to run here, so the panel dropped to the
    // empty state and lost selection and scope until the re-extraction came
    // back — and then came back without them.
    expect(container.textContent).not.toContain("Connecting to page...");
    expect(row("n3").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector(".sn-scope-bar")).not.toBeNull();

    // The toggle's own job still happens: the content script is told to
    // re-extract in the new mode.
    expect(
      chromeMock.sent.filter((m) => m.type === "SET_VIEW_MODE"),
    ).toHaveLength(1);
    expect(toggleButton("DOM").getAttribute("aria-pressed")).toBe("true");
  });

  it("drops a selection the incoming tree no longer contains", () => {
    mountLoadedPanel();
    expect(row("n3").getAttribute("aria-selected")).toBe("true");

    act(() => {
      toggleButton("DOM").click();
    });
    // The re-extraction in the other view mode comes back without the
    // selected node — the two trees disagree about generic wrappers, which is
    // exactly what switching between them is for. A selection pointing into
    // nothing leaves no `aria-activedescendant` and no index for
    // `useTreeKeyboard` to move from, so the tree stops answering keys.
    act(() => {
      chromeMock.emit({
        type: "TREE_DATA",
        tabId: TAB_ID,
        payload: {
          nodes: TREE.filter(([id]) => id !== "n3").map(([id, n]) => [
            id,
            structuredClone(n),
          ]),
          rootId: "n1",
          pageTitle: "Test page",
          pageUrl: "https://example.test/",
        },
      } as unknown as ContentToPanel);
    });

    expect(container.querySelector('[data-node-id="n3"]')).toBeNull();
    expect(container.querySelector('[aria-selected="true"]')).toBeNull();

    // The proof it was dropped rather than merely unrendered: a selection
    // that resolves to no row leaves `useTreeKeyboard` no index to move from,
    // and every key becomes a no-op. Cleared, ArrowDown picks the first row.
    act(() => {
      tree().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(container.querySelector('[aria-selected="true"]')).not.toBeNull();
  });

  it("still tears the panel down when the bound tab changes", () => {
    mountLoadedPanel();

    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: TAB_ID + 1,
      } as unknown as ContentToPanel);
    });

    // A different tab's tree is not this tab's tree: the panel drops it and
    // waits for the user to load the new one.
    expect(container.textContent).toContain("Connecting to page...");
    expect(container.querySelector('[data-node-id="n3"]')).toBeNull();
  });
});
