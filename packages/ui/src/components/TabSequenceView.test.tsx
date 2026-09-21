import type {
  ActionType,
  DomSemanticNode,
  SemanticNode,
} from "@real-a11y-dev/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { TabSequenceView } from "./TabSequenceView.js";

function makeFocusable(
  id: string,
  opts: {
    name: string;
    role?: string;
    tagName?: string;
    tabindex?: string;
    actions?: ActionType[];
  },
): DomSemanticNode {
  return {
    id,
    parentId: "root",
    childIds: [],
    depth: 1,
    a11y: {
      role: opts.role ?? "button",
      name: opts.name,
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
    dom: {
      tagName: opts.tagName ?? "BUTTON",
      attributes: opts.tabindex ? { tabindex: opts.tabindex } : {},
      textContent: opts.name,
      descendantText: opts.name,
      isHidden: false,
    },
    interaction: {
      isInteractive: true,
      isFocusable: true,
      isEditable: false,
      actions: opts.actions ?? ["click"],
    },
    ui: {
      expanded: false,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

function makeRoot(childIds: string[]): DomSemanticNode {
  return {
    id: "root",
    parentId: null,
    childIds,
    depth: 0,
    a11y: {
      role: "generic",
      name: "",
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
    dom: {
      tagName: "DIV",
      attributes: {},
      textContent: "",
      descendantText: "",
      isHidden: false,
    },
    interaction: {
      isInteractive: false,
      isFocusable: false,
      isEditable: false,
      actions: [],
    },
    ui: {
      expanded: true,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

describe("TabSequenceView", () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  function mount(
    nodes: Map<string, SemanticNode>,
    props: {
      query?: string;
      onSelect?: (id: string) => void;
      onActivate?: (id: string, action?: ActionType) => void;
      onHover?: (id: string | null) => void;
      onFocusSearch?: () => void;
    } = {},
  ) {
    const onSelect = props.onSelect ?? vi.fn();
    const onActivate = props.onActivate ?? vi.fn();
    const onHover = props.onHover ?? vi.fn();
    act(() => {
      render(
        <TabSequenceView
          nodes={nodes}
          rootId="root"
          query={props.query ?? ""}
          onSelect={onSelect}
          onActivate={onActivate}
          onHover={onHover}
          onFocusSearch={props.onFocusSearch}
        />,
        container,
      );
    });
    return {
      list: container.querySelector<HTMLElement>('[role="listbox"]')!,
      onSelect,
      onActivate,
      onHover,
    };
  }

  function press(list: HTMLElement, key: string) {
    act(() => {
      list.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  }

  /**
   * A `nodes` Map that counts lookups. `linearize` — which `getTabSequence`
   * walks the tree with — does exactly one `get` per visited node, so the
   * counter is a direct, deterministic measure of whether the sequence was
   * rebuilt.
   */
  class CountingMap extends Map<string, SemanticNode> {
    gets = 0;
    override get(key: string): SemanticNode | undefined {
      this.gets++;
      return super.get(key);
    }
  }

  function rerender(nodes: Map<string, SemanticNode>, query: string) {
    act(() => {
      render(
        <TabSequenceView
          nodes={nodes}
          rootId="root"
          query={query}
          onSelect={vi.fn()}
          onActivate={vi.fn()}
          onHover={vi.fn()}
        />,
        container,
      );
    });
  }

  describe("sequence cost", () => {
    function makeCountingTree() {
      const nodes = new CountingMap();
      const ids = Array.from({ length: 20 }, (_, i) => `n${i}`);
      nodes.set("root", makeRoot(ids));
      for (const [i, id] of ids.entries()) {
        nodes.set(id, makeFocusable(id, { name: `Item ${i}` }));
      }
      return nodes;
    }

    it("does not rebuild the tab sequence when only the query changes", () => {
      const nodes = makeCountingTree();
      rerender(nodes, "");
      expect(nodes.gets).toBeGreaterThan(0);

      // Typing "Item 1" one character at a time. The node Map is referentially
      // stable across keystrokes (TreePanel holds it in tree state), so the
      // sequence itself cannot have changed — only the filter over it.
      const afterMount = nodes.gets;
      for (const query of ["I", "It", "Ite", "Item", "Item ", "Item 1"]) {
        rerender(nodes, query);
      }

      expect(nodes.gets).toBe(afterMount);
    });

    it("does rebuild the tab sequence when the nodes change", () => {
      const nodes = makeCountingTree();
      rerender(nodes, "");
      const afterMount = nodes.gets;

      const next = makeCountingTree();
      rerender(next, "");
      expect(next.gets).toBeGreaterThan(0);
      expect(nodes.gets).toBe(afterMount);
    });

    it("still filters correctly across query changes", () => {
      const nodes = makeCountingTree();
      rerender(nodes, "");
      expect(container.querySelectorAll('[role="option"]')).toHaveLength(20);

      rerender(nodes, "Item 1");
      // "Item 1" plus "Item 10".."Item 19".
      expect(container.querySelectorAll('[role="option"]')).toHaveLength(11);

      rerender(nodes, "Item 19");
      expect(
        container.querySelector('[role="option"] .sn-tab-name')?.textContent,
      ).toBe("Item 19");

      rerender(nodes, "");
      expect(container.querySelectorAll('[role="option"]')).toHaveLength(20);
    });
  });

  it("lists focusable nodes in tab order with activedescendant", () => {
    const nodes = new Map<string, SemanticNode>([
      ["root", makeRoot(["second", "first", "zero"])],
      ["zero", makeFocusable("zero", { name: "Zero" })],
      ["first", makeFocusable("first", { name: "First", tabindex: "1" })],
      ["second", makeFocusable("second", { name: "Second", tabindex: "2" })],
    ]);
    const { list } = mount(nodes);
    const options = [...list.querySelectorAll('[role="option"]')];
    expect(
      options.map((o) => o.querySelector(".sn-tab-name")?.textContent),
    ).toEqual(["First", "Second", "Zero"]);
    expect(list.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    expect(
      options[0]!.querySelector(".sn-tab-tabindex-badge")?.textContent,
    ).toContain("tabindex=1");
  });

  it("navigates with arrows/Home/End and filters by query", () => {
    const nodes = new Map<string, SemanticNode>([
      ["root", makeRoot(["a", "b", "c"])],
      ["a", makeFocusable("a", { name: "Alpha" })],
      ["b", makeFocusable("b", { name: "Beta" })],
      ["c", makeFocusable("c", { name: "Gamma", role: "link", tagName: "A" })],
    ]);
    const { list, onSelect } = mount(nodes);

    press(list, "ArrowDown");
    expect(onSelect).toHaveBeenLastCalledWith("b");
    press(list, "End");
    expect(onSelect).toHaveBeenLastCalledWith("c");
    press(list, "Home");
    expect(onSelect).toHaveBeenLastCalledWith("a");

    const filtered = mount(nodes, { query: "link" });
    expect(filtered.list.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(filtered.list.querySelector(".sn-tab-name")?.textContent).toBe(
      "Gamma",
    );
  });

  it("shows empty states and wires Activate / Move to", () => {
    const empty = mount(new Map([["root", makeRoot([])]]));
    expect(empty.list.querySelector(".sn-empty")?.textContent).toContain(
      "No focusable elements found",
    );

    const nodes = new Map<string, SemanticNode>([
      ["root", makeRoot(["a"])],
      ["a", makeFocusable("a", { name: "Only" })],
    ]);
    mount(nodes, { query: "zzz" });
    expect(container.querySelector(".sn-empty")?.textContent).toContain(
      'No tab stops matching "zzz"',
    );

    const live = mount(nodes);
    act(() => {
      container
        .querySelectorAll<HTMLButtonElement>(".sn-list-action-btn")[0]!
        .click();
    });
    expect(live.onActivate).toHaveBeenCalledWith("a");
    act(() => {
      container
        .querySelectorAll<HTMLButtonElement>(".sn-list-action-btn")[1]!
        .click();
    });
    expect(live.onSelect).toHaveBeenCalledWith("a");
  });

  it("focuses search on `/` without modifiers", () => {
    const onFocusSearch = vi.fn();
    const nodes = new Map<string, SemanticNode>([
      ["root", makeRoot(["a"])],
      ["a", makeFocusable("a", { name: "Only" })],
    ]);
    const { list } = mount(nodes, { onFocusSearch });
    press(list, "/");
    expect(onFocusSearch).toHaveBeenCalledTimes(1);

    act(() => {
      list.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "/",
          bubbles: true,
          ctrlKey: true,
        }),
      );
    });
    expect(onFocusSearch).toHaveBeenCalledTimes(1);
  });
});
