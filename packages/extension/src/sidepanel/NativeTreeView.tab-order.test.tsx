import { extractA11yTree } from "@real-a11y-dev/core";
import { render, type ComponentProps } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { NativeNode } from "../native/native-actions.js";

import type { NativeTabOrder } from "./NativeTabView.js";
import { NativeTreeView } from "./NativeTreeView.js";

type TreeProps = ComponentProps<typeof NativeTreeView>;

/**
 * Chrome's tree carries no tab order (`tabindex` never reaches a native
 * node), so its TAB view shows the in-page walk's: the A11Y / TAB toggle,
 * the list in the tree's place, and what the rest of the view does while it
 * shows.
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

const NATIVE = new Map<string, NativeNode>([
  node("root", "document", "", 0, ["main"]),
  node("main", "main", "", 1, ["h1", "btn"]),
  node("h1", "heading", "Settings", 2),
  node("btn", "button", "Two", 2),
]);

// A positive tabindex comes first, lowest first; then document order. A
// negative one is focusable but no tab stop.
const PAGE = `
  <main>
    <a href="/one">One</a>
    <button>Two</button>
    <button tabindex="2">Second explicit</button>
    <input aria-label="Name" />
    <div tabindex="-1">Not a stop</div>
    <button tabindex="1">First explicit</button>
  </main>
`;

describe("NativeTreeView — TAB view", () => {
  let container: HTMLDivElement;
  let host: HTMLDivElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
    host = document.createElement("div");
    host.innerHTML = PAGE;
    document.body.appendChild(host);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    host.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  /** The page's tab order, as App hands it over: the in-page tree, and its
   *  own select and activate. */
  function tabOrder(): NativeTabOrder {
    const { nodes, rootId } = extractA11yTree(host);
    return { nodes, rootId, onHighlight: vi.fn(), onActivate: vi.fn() };
  }

  function mount(props: Partial<TreeProps> = {}) {
    act(() => {
      render(
        <NativeTreeView
          nodes={NATIVE}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={() => {}}
          {...props}
        />,
        container,
      );
    });
  }

  const viewGroup = () =>
    container.querySelector('[role="group"][aria-label="Native tree view"]');
  const pressedView = () =>
    viewGroup()?.querySelector('[aria-pressed="true"]')?.textContent;
  const viewButton = (name: "A11Y" | "TAB") =>
    [...(viewGroup()?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === name,
    )!;
  const list = () =>
    container.querySelector<HTMLElement>(
      '[role="listbox"][aria-label="Tab sequence"]',
    );
  const stops = () =>
    [...(list()?.querySelectorAll('[role="option"] .sn-tab-name') ?? [])].map(
      (el) => el.textContent,
    );
  const stop = (name: string) =>
    [...(list()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find(
      (el) => el.querySelector(".sn-tab-name")?.textContent === name,
    )!;
  const idOf = (order: NativeTabOrder, name: string) =>
    [...order.nodes.values()].find((n) => n.a11y.name === name)!.id;
  const searchBox = () =>
    container.querySelector<HTMLInputElement>(
      'input[aria-label="Search native tree nodes"]',
    )!;

  it("offers A11Y and TAB only with a tab order and a way to switch", () => {
    mount();
    expect(viewGroup()).toBeNull();

    mount({ tabOrder: tabOrder() });
    expect(viewGroup()).toBeNull();

    mount({ tabOrder: tabOrder(), onViewChange: vi.fn() });
    expect(pressedView()).toBe("A11Y");
    expect(container.querySelector('[role="tree"]')).not.toBeNull();
  });

  it("asks for the view, and shows the page's tab order in the tree's place", () => {
    const order = tabOrder();
    const onViewChange = vi.fn();
    mount({ tabOrder: order, onViewChange });

    act(() => viewButton("TAB").click());
    expect(onViewChange).toHaveBeenLastCalledWith("tab");

    // App holds the view, and passes it back.
    mount({ tabOrder: order, onViewChange, view: "tab" });
    expect(pressedView()).toBe("TAB");
    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(stops()).toEqual([
      "First explicit",
      "Second explicit",
      "One",
      "Two",
      "Name",
    ]);

    act(() => viewButton("A11Y").click());
    expect(onViewChange).toHaveBeenLastCalledWith("a11y");
  });

  it("selects and activates a stop through the tab order's own handlers", () => {
    const order = tabOrder();
    const onActivate = vi.fn();
    mount({ tabOrder: order, onViewChange: vi.fn(), view: "tab", onActivate });

    act(() => stop("Two").click());
    expect(order.onHighlight).toHaveBeenLastCalledWith(idOf(order, "Two"));

    act(() => {
      list()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(vi.mocked(order.onActivate).mock.lastCall?.[0]).toBe(
      idOf(order, "Two"),
    );
    // Chrome's tree's own activation is for its rows only.
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("searches the tab order, and counts the stops the search leaves", () => {
    mount({ tabOrder: tabOrder(), onViewChange: vi.fn(), view: "tab" });

    act(() => {
      searchBox().value = "explicit";
      searchBox().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(stops()).toEqual(["First explicit", "Second explicit"]);
    // Not Chrome's tree's count: none of its rows is named "explicit".
    expect(container.querySelector(".sn-search-count")?.textContent).toBe(
      "2 matches",
    );

    // `/` in the list goes back to the search box, as in the tree.
    act(() => {
      list()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "/", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(searchBox());
  });

  it("puts the tree's own controls aside while the tab order shows", () => {
    const props: Partial<TreeProps> = {
      tabOrder: tabOrder(),
      onViewChange: vi.fn(),
      scopedRootId: "main",
      onScope: vi.fn(),
      onSendKey: vi.fn(),
    };
    const expandAll = () =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Expand all"]',
      )!;
    const roleFilters = () => [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Filter by role"] button',
      ),
    ];

    mount(props);
    expect(expandAll().disabled).toBe(false);
    expect(roleFilters().some((b) => b.disabled)).toBe(false);
    expect(container.querySelector(".sn-scope-bar")).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Send keyboard events to page"]'),
    ).not.toBeNull();

    // Expand, collapse, the role filters and the scope are the tree's; the
    // tab order covers the whole page, as the in-page tree's TAB view does.
    mount({ ...props, view: "tab" });
    expect(expandAll().disabled).toBe(true);
    expect(roleFilters().every((b) => b.disabled)).toBe(true);
    expect(container.querySelector(".sn-scope-bar")).toBeNull();
    expect(
      container.querySelector('[aria-label="Send keyboard events to page"]'),
    ).toBeNull();
    expect(stops()).toHaveLength(5);
  });

  it("goes back to the tree for a pick, which reveals a row in it", () => {
    const onViewChange = vi.fn();
    const props: Partial<TreeProps> = {
      tabOrder: tabOrder(),
      onViewChange,
      view: "tab",
    };
    mount(props);

    // The page's focus moving is the tree's to follow, as with a role
    // filter's list in its place: neither the view nor the tree's selection
    // changes.
    mount({ ...props, pageFocus: { nodeId: "btn", nonce: 1 } });
    expect(onViewChange).not.toHaveBeenCalled();
    mount({ ...props, view: "a11y", pageFocus: { nodeId: "btn", nonce: 1 } });
    expect(container.querySelector('[aria-selected="true"]')).toBeNull();

    mount({ ...props, reveal: { nodeId: "btn", nonce: 1 } });
    expect(onViewChange).toHaveBeenLastCalledWith("a11y");
  });
});
