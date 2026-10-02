import type { SemanticNode } from "@real-a11y-dev/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { FilteredList } from "./FilteredList.js";

/**
 * The panel's role-filtered list view — the heading outline, the link list, the
 * form-control list. Written in JSX rather than `h()` calls because the props
 * are the interesting part of each case and JSX keeps them readable.
 */

function listNode(
  id: string,
  role: string,
  name: string,
  properties: Record<string, string> = {},
): [string, SemanticNode] {
  return [
    id,
    {
      id,
      parentId: "root",
      childIds: [],
      depth: 1,
      a11y: { role, name, description: "", states: {}, properties },
      dom: { tagName: "div", attributes: {}, textContent: name },
      interaction: { actions: [], isEditable: false, focusable: true },
      ui: { expanded: true, selected: false, matchesFilter: true },
    } as unknown as SemanticNode,
  ];
}

const HEADINGS = new Map<string, SemanticNode>([
  listNode("h1", "heading", "Overview", { level: "1" }),
  listNode("h2", "heading", "Install", { level: "2" }),
  listNode("h3", "heading", "Troubleshooting", { level: "3" }),
  listNode("p1", "paragraph", "Not a heading"),
]);

describe("FilteredList", () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    // jsdom does not implement scrollIntoView; stub so the
    // keep-the-selected-option-visible effect can run.
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

  function options(): HTMLElement[] {
    return [...container.querySelectorAll('[role="option"]')] as HTMLElement[];
  }

  function listbox(): HTMLElement {
    const el = container.querySelector('[role="listbox"]');
    if (!el) throw new Error("no listbox rendered");
    return el as HTMLElement;
  }

  function noop() {}

  it("keeps the Move to button for the DOM producer, which can highlight", () => {
    act(() => {
      render(
        <FilteredList
          nodes={HEADINGS}
          roleFilter="heading"
          query=""
          onHighlight={noop}
          onActivate={noop}
          onGoToTree={noop}
        />,
        container,
      );
    });
    const buttons = [...container.querySelectorAll(".sn-list-action-btn")].map(
      (b) => b.textContent,
    );
    expect(buttons).toEqual(["Activate", "Move to"]);
  });

  it("lists only matches inside the scope when scoped", () => {
    // `h3` sits under a `section` the panel is scoped to; `h1` and `h2` are
    // outside it. The list covers the same subtree the scoped tree shows.
    const scoped = new Map<string, SemanticNode>([
      ...HEADINGS,
      listNode("section", "region", "Help"),
    ]);
    (scoped.get("h3") as { parentId: string }).parentId = "section";
    act(() => {
      render(
        <FilteredList
          nodes={scoped}
          scopeRootId="section"
          roleFilter="heading"
          query=""
          onHighlight={noop}
          onActivate={noop}
          onGoToTree={noop}
        />,
        container,
      );
    });
    expect(options().map((o) => o.textContent)).toEqual(["H3Troubleshooting"]);
  });

  describe("a scope change with the list showing", () => {
    // `h2` and `h3` sit under `section`; `h1` is outside it.
    function sectioned(): Map<string, SemanticNode> {
      const nodes = new Map<string, SemanticNode>([
        ...HEADINGS,
        listNode("section", "region", "Help"),
      ]);
      (nodes.get("h2") as { parentId: string }).parentId = "section";
      (nodes.get("h3") as { parentId: string }).parentId = "section";
      return nodes;
    }

    function show(
      nodes: Map<string, SemanticNode>,
      scopeRootId: string | null,
    ) {
      act(() => {
        render(
          <FilteredList
            nodes={nodes}
            scopeRootId={scopeRootId}
            roleFilter="heading"
            query=""
            onHighlight={noop}
            onActivate={noop}
            onGoToTree={noop}
          />,
          container,
        );
      });
    }

    function selectedLabel(): string | null | undefined {
      return container.querySelector('[role="option"][aria-selected="true"]')
        ?.textContent;
    }

    it("keeps the selected item when leaving the scope adds matches ahead of it", () => {
      // Regression (Devin Review): the list kept its index, so leaving the
      // scope moved the selection from Troubleshooting to Install, and
      // Enter would have acted on a row nobody picked.
      const nodes = sectioned();
      show(nodes, "section");
      act(() => {
        listbox().dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      });
      expect(selectedLabel()).toBe("H3Troubleshooting");

      show(nodes, null);
      expect(options()).toHaveLength(3);
      expect(selectedLabel()).toBe("H3Troubleshooting");
    });

    it("falls back to the first item when the selected one leaves the scope", () => {
      const nodes = sectioned();
      show(nodes, null); // Overview is selected
      show(nodes, "section");
      expect(selectedLabel()).toBe("H2Install");
    });
  });

  it("says a scoped list is empty in this scope", () => {
    act(() => {
      render(
        <FilteredList
          nodes={HEADINGS}
          scopeRootId="p1"
          roleFilter="heading"
          query=""
          onHighlight={noop}
          onActivate={noop}
          onGoToTree={noop}
        />,
        container,
      );
    });
    expect(container.querySelector(".sn-empty")?.textContent).toBe(
      "No headings found in this scope",
    );
  });

  it("ignores a scope id the tree doesn't have", () => {
    act(() => {
      render(
        <FilteredList
          nodes={HEADINGS}
          scopeRootId="gone"
          roleFilter="heading"
          query=""
          onHighlight={noop}
          onActivate={noop}
          onGoToTree={noop}
        />,
        container,
      );
    });
    expect(options()).toHaveLength(3);
  });

  it("lists only the nodes in the filtered role group, with heading levels", () => {
    act(() => {
      render(
        <FilteredList
          nodes={HEADINGS}
          roleFilter="heading"
          query=""
          onHighlight={noop}
          onActivate={noop}
          onGoToTree={noop}
        />,
        container,
      );
    });

    // The paragraph is outside the `heading` role group and must not appear.
    expect(options().map((el) => el.textContent)).toEqual([
      "H1Overview",
      "H2Install",
      "H3Troubleshooting",
    ]);
    expect(container.textContent).toContain("3 items");

    // Level drives the indent, so the outline reads as a hierarchy.
    const indents = options().map((el) => el.style.paddingLeft);
    expect(indents).toEqual(["", "24px", "40px"]);
  });

  it("moves the selection with ArrowDown and reports each highlight", () => {
    const highlighted: string[] = [];
    act(() => {
      render(
        <FilteredList
          nodes={HEADINGS}
          roleFilter="heading"
          query=""
          onHighlight={(id) => highlighted.push(id)}
          onActivate={noop}
          onGoToTree={noop}
        />,
        container,
      );
    });

    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");

    act(() => {
      listbox().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(highlighted).toEqual(["h2"]);
    // The rows never hold DOM focus, so the active option is announced through
    // aria-activedescendant on the container instead.
    expect(listbox().getAttribute("aria-activedescendant")).toBe(
      "sn-filtered-opt-1",
    );

    // End jumps to the last match rather than walking off it.
    act(() => {
      listbox().dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
    });
    expect(options()[2]?.getAttribute("aria-selected")).toBe("true");
    expect(highlighted).toEqual(["h2", "h3"]);
  });

  it("narrows by query and shows the empty state when nothing matches", () => {
    act(() => {
      render(
        <FilteredList
          nodes={HEADINGS}
          roleFilter="heading"
          query="install"
          onHighlight={noop}
          onActivate={noop}
          onGoToTree={noop}
        />,
        container,
      );
    });

    // Case-insensitive, matched against the accessible name.
    expect(options().map((el) => el.textContent)).toEqual(["H2Install"]);

    act(() => {
      render(
        <FilteredList
          nodes={HEADINGS}
          roleFilter="heading"
          query="nothing here"
          onHighlight={noop}
          onActivate={noop}
          onGoToTree={noop}
        />,
        container,
      );
    });

    expect(options()).toHaveLength(0);
    expect(container.textContent).toContain(
      'No headings found matching "nothing here"',
    );
  });
});
