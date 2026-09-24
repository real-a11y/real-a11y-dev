import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { NativeNode } from "../native/native-actions.js";

import { NativeTreeView } from "./NativeTreeView.js";

/**
 * The native producer's role filter shows the same flat list the DOM
 * producer's does (`FilteredList`), not a filtered tree.
 */

function node(
  id: string,
  role: string,
  name: string,
  depth: number,
  childIds: string[] = [],
  properties: Record<string, string> = {},
): [string, NativeNode] {
  return [id, { id, role, name, depth, childIds, states: {}, properties }];
}

// Map order deliberately differs from document order: the list must follow
// the tree, not the map.
const NODES = new Map<string, NativeNode>([
  node("root", "document", "", 0, ["main", "footer"]),
  node("footer", "contentinfo", "", 1, ["h-foot"]),
  node("h-foot", "heading", "Footer", 2, [], { level: "2" }),
  node("main", "main", "", 1, ["h1", "sec", "link"]),
  node("h1", "heading", "Overview", 2, [], { level: "1" }),
  node("sec", "region", "Details", 2, ["h3"]),
  node("h3", "heading", "Deep", 3, [], { level: "3" }),
  node("link", "link", "Docs", 2),
]);

describe("NativeTreeView role filter", () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  function mount(onActivate = vi.fn()) {
    act(() => {
      render(
        <NativeTreeView
          nodes={NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={onActivate}
        />,
        container,
      );
    });
    return onActivate;
  }

  function pill(label: string): HTMLButtonElement {
    const btn = [
      ...container.querySelectorAll<HTMLButtonElement>(".sn-filter-btn"),
    ].find((b) => b.textContent === label);
    if (!btn) throw new Error(`no ${label} pill`);
    return btn;
  }

  function options(): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
  }

  function listbox(): HTMLElement {
    const el = container.querySelector<HTMLElement>('[role="listbox"]');
    if (!el) throw new Error("no listbox rendered");
    return el;
  }

  it("swaps the tree for a flat list of matches in document order", () => {
    mount();
    expect(container.querySelector('[role="tree"]')).not.toBeNull();

    act(() => pill("Headings").click());

    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(options().map((o) => o.textContent)).toEqual([
      "H1Overview",
      "H3Deep",
      "H2Footer",
    ]);
    expect(container.querySelector(".sn-list-count")?.textContent).toBe(
      "3 items",
    );
    // Native has no page highlight, so no "Move to" that would do nothing.
    const buttons = [...container.querySelectorAll(".sn-list-action-btn")].map(
      (b) => b.textContent,
    );
    expect(buttons).toEqual(["Activate"]);
  });

  it("narrows the list with the search query", () => {
    mount();
    act(() => pill("Headings").click());
    const search = container.querySelector<HTMLInputElement>(".sn-search")!;
    act(() => {
      search.value = "dee";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(options().map((o) => o.textContent)).toEqual(["H3Deep"]);
  });

  it("activates a link through the native onActivate", () => {
    const onActivate = mount();
    act(() => pill("Links").click());
    expect(options().map((o) => o.textContent)).toEqual(["Docs"]);

    act(() => {
      listbox().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onActivate).toHaveBeenCalledWith(NODES.get("link"), undefined);
  });

  it("steps a slider on Enter rather than clicking it", () => {
    const slider = node("vol", "slider", "Volume", 1);
    const nodes = new Map<string, NativeNode>([
      node("root", "document", "", 0, ["vol"]),
      slider,
    ]);
    const onActivate = vi.fn();
    act(() => {
      render(
        <NativeTreeView
          nodes={nodes}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={onActivate}
        />,
        container,
      );
    });
    act(() => pill("Forms").click());
    act(() => {
      listbox().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onActivate).toHaveBeenCalledWith(slider[1], "increment");
  });

  it("goes back to the tree on Enter over a heading, with the heading selected", () => {
    mount();
    act(() => pill("Headings").click());
    act(() => {
      listbox().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    act(() => {
      listbox().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(pill("Headings").getAttribute("aria-pressed")).toBe("false");
    // "Deep" sits under a collapsed region; going to it must open the way.
    const selected = container.querySelector('[aria-selected="true"]');
    expect(selected?.getAttribute("data-node-id")).toBe("h3");
  });
});
