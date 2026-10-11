import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { NativeNode } from "../native/native-actions.js";

import { NATIVE_FOLLOW_DEBOUNCE_MS } from "./native-follow.js";
import { NativeTreeView, type NativeReveal } from "./NativeTreeView.js";

/**
 * Focus sync on the native tree (`pageFocus`): the page's focus moved to a
 * row's element, and the row is selected and brought into view, with
 * nothing sent back to the page.
 */

function node(
  id: string,
  role: string,
  name: string,
  depth: number,
  childIds: string[] = [],
): [string, NativeNode] {
  return [id, { id, role, name, depth, childIds, states: {}, properties: {} }];
}

const NODES = new Map<string, NativeNode>([
  node("root", "document", "", 0, ["main", "footer"]),
  node("main", "main", "", 1, ["h1", "sec", "link"]),
  node("h1", "heading", "Overview", 2),
  node("sec", "region", "Details", 2, ["h3"]),
  node("h3", "heading", "Deep", 3),
  node("link", "link", "Docs", 2),
  node("footer", "contentinfo", "", 1, ["h-foot"]),
  node("h-foot", "heading", "Footer", 2),
]);

describe("NativeTreeView focus sync", () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    vi.useFakeTimers();
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
    vi.useRealTimers();
  });

  /** The tree in a host that holds the scope, as App does, and hands it the
   *  page's focus reports. */
  function mount(initialScope: string | null = null) {
    const onSelectionReveal = vi.fn();
    const scopes: Array<string | null> = [];
    let report: (nodeId: string) => void = () => {};
    function Host() {
      const [scope, setScope] = useState(initialScope);
      const [pageFocus, setPageFocus] = useState<NativeReveal>();
      report = (nodeId) =>
        setPageFocus((prev) => ({ nodeId, nonce: (prev?.nonce ?? 0) + 1 }));
      return (
        <NativeTreeView
          nodes={NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={() => {}}
          onSelectionReveal={onSelectionReveal}
          pageFocus={pageFocus}
          scopedRootId={scope}
          onScope={(id) => {
            scopes.push(id);
            setScope(id);
          }}
        />
      );
    }
    act(() => render(<Host />, container));
    return {
      onSelectionReveal,
      scopes,
      focusOnPage: (nodeId: string) => act(() => report(nodeId)),
    };
  }

  function row(id: string): HTMLElement | null {
    return container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
  }
  const selected = () =>
    container
      .querySelector('[role="treeitem"][aria-selected="true"]')
      ?.getAttribute("data-node-id") ?? null;
  const settle = () =>
    act(() => {
      vi.advanceTimersByTime(NATIVE_FOLLOW_DEBOUNCE_MS * 3);
    });
  function press(key: string) {
    act(() => {
      container
        .querySelector('[role="tree"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  }
  function search(query: string) {
    const input = container.querySelector<HTMLInputElement>(".sn-search")!;
    act(() => {
      input.value = query;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("selects the row, opening what it sits under, and sends nothing back to the page", () => {
    const { onSelectionReveal, focusOnPage } = mount();
    // Under a region the tree first shows collapsed.
    expect(row("h3")).toBeNull();
    focusOnPage("h3");
    expect(selected()).toBe("h3");
    expect(row("sec")!.getAttribute("aria-expanded")).toBe("true");
    settle();
    expect(onSelectionReveal).not.toHaveBeenCalled();
    // Nor does it take focus from the page.
    expect(container.contains(document.activeElement)).toBe(false);
  });

  it("follows each report, and none of them onto the page", () => {
    const { onSelectionReveal, focusOnPage } = mount();
    focusOnPage("h1");
    focusOnPage("link");
    focusOnPage("h1");
    expect(selected()).toBe("h1");
    settle();
    expect(onSelectionReveal).not.toHaveBeenCalled();
  });

  it("still follows a click on the row it selected, and a selection moved away and back", () => {
    const { onSelectionReveal, focusOnPage } = mount();
    focusOnPage("h1");
    settle();
    act(() => row("h1")!.click());
    settle();
    expect(onSelectionReveal).toHaveBeenCalledExactlyOnceWith("h1");

    focusOnPage("link");
    press("ArrowUp");
    settle();
    expect(onSelectionReveal).toHaveBeenLastCalledWith("sec");
    press("ArrowDown");
    settle();
    expect(onSelectionReveal).toHaveBeenLastCalledWith("link");
    expect(onSelectionReveal).toHaveBeenCalledTimes(3);
  });

  it("leaves a scope the row is outside of, and keeps one it is inside", () => {
    const outside = mount("footer");
    outside.focusOnPage("h1");
    expect(outside.scopes).toEqual([null]);
    expect(selected()).toBe("h1");
    act(() => render(null, container));

    const inside = mount("main");
    inside.focusOnPage("h3");
    expect(inside.scopes).toEqual([]);
    expect(selected()).toBe("h3");
  });

  it("leaves the selection where it was when a search hides the row", () => {
    const { focusOnPage } = mount();
    search("docs");
    act(() => row("link")!.click());
    focusOnPage("h1");
    expect(selected()).toBe("link");
    // One the search shows is selected as usual.
    search("o");
    focusOnPage("h1");
    expect(selected()).toBe("h1");
  });

  it("leaves the role filter's list alone, and ignores a row the tree doesn't have", () => {
    const { onSelectionReveal, focusOnPage } = mount();
    focusOnPage("h1");
    focusOnPage("gone");
    expect(selected()).toBe("h1");

    const headings = [
      ...container.querySelectorAll<HTMLButtonElement>(".sn-filter-btn"),
    ].find((b) => b.textContent === "Headings")!;
    act(() => headings.click());
    focusOnPage("link");
    settle();
    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(onSelectionReveal).not.toHaveBeenCalled();
  });
});
