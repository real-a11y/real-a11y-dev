import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { NativeNode } from "../native/native-actions.js";

import { NativeTreeView } from "./NativeTreeView.js";

/**
 * Subtree scope on the native tree: the same double-click, breadcrumb and
 * keyboard behaviour the DOM tree has, with App.tsx's scope state stood in for
 * by a small wrapper that holds it.
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

describe("NativeTreeView scope", () => {
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

  interface MountOptions {
    initialScope?: string | null;
    pickArmed?: boolean;
    reveal?: { nodeId: string; nonce: number };
    onActivate?: () => void;
  }

  function mount(options: MountOptions = {}) {
    const scopes: Array<string | null> = [];
    function Host() {
      const [scope, setScope] = useState<string | null>(
        options.initialScope ?? null,
      );
      return (
        <NativeTreeView
          nodes={NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={options.onActivate ?? (() => {})}
          scopedRootId={scope}
          onScope={(id) => {
            scopes.push(id);
            setScope(id);
          }}
          pickArmed={options.pickArmed ?? false}
          reveal={options.reveal}
        />
      );
    }
    act(() => {
      render(<Host />, container);
    });
    return scopes;
  }

  function row(id: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (!el) throw new Error(`no row for ${id}`);
    return el;
  }

  function rowIds(): string[] {
    return [
      ...container.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    ].map((r) => r.dataset.nodeId!);
  }

  function tree(): HTMLElement {
    return container.querySelector<HTMLElement>('[role="tree"]')!;
  }

  function press(key: string, init: KeyboardEventInit = {}) {
    act(() => {
      tree().dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
      );
    });
  }

  function dblclick(el: HTMLElement) {
    act(() => {
      el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
  }

  it("double-clicking a container row scopes the tree to it", () => {
    const scopes = mount();
    dblclick(row("sec"));

    expect(scopes).toEqual(["sec"]);
    // Only the subtree, opened, and indented from its own root.
    expect(rowIds()).toEqual(["sec", "h3"]);
    expect(row("sec").getAttribute("aria-level")).toBe("1");
    expect(row("h3").getAttribute("aria-level")).toBe("2");
    expect(
      container.querySelector(".sn-tree-container--scoped"),
    ).not.toBeNull();
  });

  it("double-clicking an actionable row still activates it, not scopes", () => {
    const onActivate = vi.fn();
    const scopes = mount({ onActivate });
    dblclick(row("link"));
    expect(onActivate).toHaveBeenCalledOnce();
    expect(scopes).toEqual([]);
  });

  it("shows the breadcrumb, and ✕ brings the whole tree back", () => {
    const scopes = mount({ initialScope: "sec" });
    const crumbs = [...container.querySelectorAll(".sn-breadcrumb-item")].map(
      (b) => b.textContent,
    );
    expect(crumbs).toEqual(["document", "main", 'region "Details"']);

    act(() =>
      container.querySelector<HTMLButtonElement>(".sn-scope-exit")!.click(),
    );
    expect(scopes).toEqual([null]);
    expect(rowIds()).toContain("footer");
    expect(container.querySelector(".sn-scope-bar")).toBeNull();
  });

  it("Ctrl+Enter scopes to the selected row", () => {
    const scopes = mount();
    act(() => row("main").click());
    press("Enter", { ctrlKey: true });
    expect(scopes).toEqual(["main"]);
    expect(rowIds()[0]).toBe("main");
  });

  it("Ctrl+Enter on a row with nothing under it neither scopes nor activates", () => {
    const onActivate = vi.fn();
    const scopes = mount({ onActivate });
    act(() => row("link").click());
    press("Enter", { metaKey: true });
    expect(scopes).toEqual([]);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("Escape leaves the scope", () => {
    const scopes = mount({ initialScope: "sec" });
    press("Escape");
    expect(scopes).toEqual([null]);
    expect(rowIds()).toContain("footer");
  });

  it("Escape leaves an armed pick alone", () => {
    const scopes = mount({ initialScope: "sec", pickArmed: true });
    press("Escape");
    expect(scopes).toEqual([]);
  });

  it("ArrowLeft stops at the scope root instead of selecting a row it hides", () => {
    mount({ initialScope: "sec" });
    act(() => row("sec").click());
    press("ArrowLeft"); // collapses it
    press("ArrowLeft"); // would select `main`, which isn't rendered
    expect(row("sec").getAttribute("aria-selected")).toBe("true");
  });

  it("a pick outside the scope leaves it and selects the picked row", () => {
    const scopes = mount({
      initialScope: "sec",
      reveal: { nodeId: "h-foot", nonce: 1 },
    });
    expect(scopes).toEqual([null]);
    expect(row("h-foot").getAttribute("aria-selected")).toBe("true");
  });

  it("a pick inside the scope keeps it", () => {
    const scopes = mount({
      initialScope: "sec",
      reveal: { nodeId: "h3", nonce: 1 },
    });
    expect(scopes).toEqual([]);
    expect(row("h3").getAttribute("aria-selected")).toBe("true");
  });

  it("go-to-tree from a list item outside the scope leaves it", () => {
    const scopes = mount({ initialScope: "sec" });
    const headings = [
      ...container.querySelectorAll<HTMLButtonElement>(".sn-filter-btn"),
    ].find((b) => b.textContent === "Headings")!;
    act(() => headings.click());
    const footer = [
      ...container.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((o) => o.textContent?.includes("Footer"))!;
    dblclick(footer);

    expect(scopes).toEqual([null]);
    expect(row("h-foot").getAttribute("aria-selected")).toBe("true");
  });

  it("treats a scope id the tree doesn't have as no scope", () => {
    mount({ initialScope: "gone" });
    expect(rowIds()[0]).toBe("root");
    expect(container.querySelector(".sn-scope-bar")).toBeNull();
  });
});
