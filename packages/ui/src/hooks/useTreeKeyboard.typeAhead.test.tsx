import type { A11yInfo, SemanticNode } from "@real-a11y-dev/core";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { TYPE_AHEAD_TIMEOUT_MS } from "./typeAhead.js";
import { useTreeKeyboard, treeNodeTypeAheadLabel } from "./useTreeKeyboard.js";

function a11y(name: string, role = "button"): A11yInfo {
  return {
    role,
    name,
    description: "",
    states: {},
    properties: {},
    isExposedToAT: true,
  };
}

function makeNode(id: string, name: string): SemanticNode {
  return {
    id,
    parentId: "root",
    childIds: [],
    depth: 1,
    a11y: a11y(name),
    ui: {
      expanded: false,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

function Harness({
  nodes,
  visibleNodeIds,
  onSelect,
  onFocusSearch,
}: {
  nodes: Map<string, SemanticNode>;
  visibleNodeIds: string[];
  onSelect: (id: string) => void;
  onFocusSearch?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    visibleNodeIds[0] ?? null,
  );
  const { handleKeyDown } = useTreeKeyboard({
    nodes,
    visibleNodeIds,
    selectedId,
    onSelect: (id) => {
      setSelectedId(id);
      onSelect(id);
    },
    onToggle: () => {},
    onActivate: () => {},
    onFocusSearch,
  });
  return (
    <div
      role="tree"
      tabIndex={0}
      data-selected={selectedId ?? ""}
      onKeyDown={handleKeyDown}
    />
  );
}

describe("treeNodeTypeAheadLabel", () => {
  it("prefers accessible name, then text content, then role", () => {
    expect(
      treeNodeTypeAheadLabel({
        id: "1",
        parentId: null,
        childIds: [],
        depth: 0,
        a11y: a11y("Save"),
      }),
    ).toBe("Save");
    expect(
      treeNodeTypeAheadLabel({
        id: "1",
        parentId: null,
        childIds: [],
        depth: 0,
        a11y: a11y(""),
        dom: {
          tagName: "BUTTON",
          textContent: "  Click  ",
          descendantText: "Click",
          attributes: {},
          isHidden: false,
        },
      }),
    ).toBe("Click");
    expect(
      treeNodeTypeAheadLabel({
        id: "1",
        parentId: null,
        childIds: [],
        depth: 0,
        a11y: a11y("", "img"),
      }),
    ).toBe("img");
  });
});

describe("useTreeKeyboard type-ahead", () => {
  let container: HTMLDivElement;
  let selected: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    selected = [];
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
  });

  function mount(onFocusSearch?: () => void) {
    const nodes = new Map<string, SemanticNode>([
      ["a", makeNode("a", "Apple")],
      ["b", makeNode("b", "Banana")],
      ["c", makeNode("c", "Cherry")],
      ["d", makeNode("d", "Blueberry")],
    ]);
    const visibleNodeIds = ["a", "b", "c", "d"];
    act(() => {
      render(
        <Harness
          nodes={nodes}
          visibleNodeIds={visibleNodeIds}
          onSelect={(id) => selected.push(id)}
          onFocusSearch={onFocusSearch}
        />,
        container,
      );
    });
    return container.querySelector<HTMLElement>('[role="tree"]')!;
  }

  function press(tree: HTMLElement, key: string) {
    act(() => {
      tree.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  }

  it("moves selection to the next node starting with the typed character", () => {
    const tree = mount();
    press(tree, "b");
    expect(tree.getAttribute("data-selected")).toBe("b");
    expect(selected.at(-1)).toBe("b");
  });

  it("cycles through same-letter matches on repeated keystrokes", () => {
    const tree = mount();
    press(tree, "b");
    expect(tree.getAttribute("data-selected")).toBe("b"); // Banana
    press(tree, "b");
    expect(tree.getAttribute("data-selected")).toBe("d"); // Blueberry
    press(tree, "b");
    expect(tree.getAttribute("data-selected")).toBe("b"); // wrap
  });

  it("supports multi-character type-ahead within the idle window", () => {
    const tree = mount();
    // From Apple, "b" "l" → Blueberry (starts with "bl")
    press(tree, "b");
    press(tree, "l");
    expect(tree.getAttribute("data-selected")).toBe("d");
  });

  it("clears the type-ahead buffer after the idle timeout", () => {
    const tree = mount();
    press(tree, "b");
    expect(tree.getAttribute("data-selected")).toBe("b");
    act(() => {
      vi.advanceTimersByTime(TYPE_AHEAD_TIMEOUT_MS);
    });
    // Fresh "c" after timeout — not continuing a "bc" buffer
    press(tree, "c");
    expect(tree.getAttribute("data-selected")).toBe("c");
  });

  it("clears the buffer when an arrow key is pressed", () => {
    const tree = mount();
    press(tree, "b");
    press(tree, "ArrowDown");
    expect(tree.getAttribute("data-selected")).toBe("c"); // Banana → Cherry
    // Buffer was cleared: a fresh "b" searches from Cherry → next "b*" is Blueberry
    // (not continuing a prior multi-char buffer).
    press(tree, "b");
    expect(tree.getAttribute("data-selected")).toBe("d");
  });

  it("focuses search on `/` instead of type-ahead", () => {
    const focusSearch = vi.fn();
    const tree = mount(focusSearch);
    press(tree, "/");
    expect(focusSearch).toHaveBeenCalledTimes(1);
    expect(tree.getAttribute("data-selected")).toBe("a");
    expect(selected).toEqual([]);
  });
});
