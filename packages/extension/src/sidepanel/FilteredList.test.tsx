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
