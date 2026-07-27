import type {
  A11yInfo,
  InteractionInfo,
  SemanticNode,
} from "@real-a11y-dev/core";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { useTreeKeyboard } from "./useTreeKeyboard.js";

function a11y(name: string, role = "group"): A11yInfo {
  return {
    role,
    name,
    description: "",
    states: {},
    properties: {},
    isExposedToAT: true,
  };
}

function makeNode(
  id: string,
  opts: {
    name?: string;
    parentId?: string | null;
    childIds?: string[];
    expanded?: boolean;
    depth?: number;
  } = {},
): SemanticNode {
  const interaction: InteractionInfo = {
    isInteractive: false,
    isFocusable: false,
    isEditable: false,
    actions: [],
  };
  return {
    id,
    parentId: opts.parentId === undefined ? "root" : opts.parentId,
    childIds: opts.childIds ?? [],
    depth: opts.depth ?? 1,
    a11y: a11y(opts.name ?? id),
    interaction,
    ui: {
      expanded: opts.expanded ?? false,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

function Harness({
  nodes,
  visibleNodeIds,
  initialSelectedId,
  onSelect,
  onToggle,
  onActivate,
}: {
  nodes: Map<string, SemanticNode>;
  visibleNodeIds: string[];
  initialSelectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onActivate: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId,
  );
  const { handleKeyDown } = useTreeKeyboard({
    nodes,
    visibleNodeIds,
    selectedId,
    onSelect: (id) => {
      setSelectedId(id);
      onSelect(id);
    },
    onToggle,
    onActivate,
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

describe("useTreeKeyboard APG navigation", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  function mount(opts: {
    nodes: Map<string, SemanticNode>;
    visibleNodeIds: string[];
    initialSelectedId: string | null;
    onSelect?: (id: string) => void;
    onToggle?: (id: string) => void;
    onActivate?: (id: string) => void;
  }) {
    const onSelect = opts.onSelect ?? vi.fn();
    const onToggle = opts.onToggle ?? vi.fn();
    const onActivate = opts.onActivate ?? vi.fn();
    act(() => {
      render(
        <Harness
          nodes={opts.nodes}
          visibleNodeIds={opts.visibleNodeIds}
          initialSelectedId={opts.initialSelectedId}
          onSelect={onSelect}
          onToggle={onToggle}
          onActivate={onActivate}
        />,
        container,
      );
    });
    return {
      tree: container.querySelector<HTMLElement>('[role="tree"]')!,
      onSelect,
      onToggle,
      onActivate,
    };
  }

  function press(tree: HTMLElement, key: string) {
    act(() => {
      tree.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  }

  it("moves with ArrowDown/ArrowUp and clamps at the ends", () => {
    const nodes = new Map<string, SemanticNode>([
      ["a", makeNode("a", { name: "A" })],
      ["b", makeNode("b", { name: "B" })],
      ["c", makeNode("c", { name: "C" })],
    ]);
    const { tree, onSelect } = mount({
      nodes,
      visibleNodeIds: ["a", "b", "c"],
      initialSelectedId: "a",
    });

    press(tree, "ArrowDown");
    expect(tree.getAttribute("data-selected")).toBe("b");
    press(tree, "ArrowDown");
    expect(tree.getAttribute("data-selected")).toBe("c");
    press(tree, "ArrowDown");
    expect(tree.getAttribute("data-selected")).toBe("c");
    expect(onSelect).toHaveBeenCalledTimes(2);

    press(tree, "ArrowUp");
    expect(tree.getAttribute("data-selected")).toBe("b");
    press(tree, "Home");
    expect(tree.getAttribute("data-selected")).toBe("a");
    press(tree, "End");
    expect(tree.getAttribute("data-selected")).toBe("c");
  });

  it("selects the first row on ArrowDown/Home when nothing is selected", () => {
    const nodes = new Map<string, SemanticNode>([
      ["a", makeNode("a")],
      ["b", makeNode("b")],
    ]);
    const { tree } = mount({
      nodes,
      visibleNodeIds: ["a", "b"],
      initialSelectedId: null,
    });

    press(tree, "ArrowDown");
    expect(tree.getAttribute("data-selected")).toBe("a");
  });

  it("ArrowRight expands a collapsed parent, then moves to the first child", () => {
    const parent = makeNode("parent", {
      name: "Parent",
      parentId: null,
      childIds: ["child"],
      expanded: false,
      depth: 0,
    });
    const child = makeNode("child", {
      name: "Child",
      parentId: "parent",
      depth: 1,
    });
    const nodes = new Map<string, SemanticNode>([
      ["parent", parent],
      ["child", child],
    ]);
    const onToggle = vi.fn();
    const { tree, onSelect } = mount({
      nodes,
      visibleNodeIds: ["parent"],
      initialSelectedId: "parent",
      onToggle,
    });

    press(tree, "ArrowRight");
    expect(onToggle).toHaveBeenCalledWith("parent");

    // After expand, the child is visible and the parent stays expanded.
    parent.ui!.expanded = true;
    const remount = mount({
      nodes,
      visibleNodeIds: ["parent", "child"],
      initialSelectedId: "parent",
      onSelect,
      onToggle,
    });
    press(remount.tree, "ArrowRight");
    expect(remount.tree.getAttribute("data-selected")).toBe("child");
  });

  it("ArrowLeft collapses an expanded parent, otherwise selects the parent", () => {
    const parent = makeNode("parent", {
      name: "Parent",
      parentId: null,
      childIds: ["child"],
      expanded: true,
      depth: 0,
    });
    const child = makeNode("child", {
      name: "Child",
      parentId: "parent",
      depth: 1,
    });
    const nodes = new Map<string, SemanticNode>([
      ["parent", parent],
      ["child", child],
    ]);
    const onToggle = vi.fn();
    const { tree } = mount({
      nodes,
      visibleNodeIds: ["parent", "child"],
      initialSelectedId: "parent",
      onToggle,
    });

    press(tree, "ArrowLeft");
    expect(onToggle).toHaveBeenCalledWith("parent");

    const fromChild = mount({
      nodes,
      visibleNodeIds: ["parent", "child"],
      initialSelectedId: "child",
      onToggle,
    });
    press(fromChild.tree, "ArrowLeft");
    expect(fromChild.tree.getAttribute("data-selected")).toBe("parent");
  });

  it("Space toggles parents and * expands collapsed siblings", () => {
    const root = makeNode("root", {
      name: "Root",
      parentId: null,
      childIds: ["a", "b", "leaf"],
      expanded: true,
      depth: 0,
    });
    const a = makeNode("a", {
      name: "A",
      parentId: "root",
      childIds: ["a1"],
      expanded: false,
    });
    const b = makeNode("b", {
      name: "B",
      parentId: "root",
      childIds: ["b1"],
      expanded: false,
    });
    const leaf = makeNode("leaf", { name: "Leaf", parentId: "root" });
    const a1 = makeNode("a1", { name: "A1", parentId: "a", depth: 2 });
    const b1 = makeNode("b1", { name: "B1", parentId: "b", depth: 2 });
    const nodes = new Map<string, SemanticNode>([
      ["root", root],
      ["a", a],
      ["b", b],
      ["leaf", leaf],
      ["a1", a1],
      ["b1", b1],
    ]);
    const onToggle = vi.fn();
    const { tree } = mount({
      nodes,
      visibleNodeIds: ["root", "a", "b", "leaf"],
      initialSelectedId: "a",
      onToggle,
    });

    press(tree, " ");
    expect(onToggle).toHaveBeenCalledWith("a");

    onToggle.mockClear();
    press(tree, "*");
    expect(onToggle).toHaveBeenCalledWith("a");
    expect(onToggle).toHaveBeenCalledWith("b");
    expect(onToggle).not.toHaveBeenCalledWith("leaf");
  });

  it("no-ops on an empty visible list", () => {
    const onSelect = vi.fn();
    const { tree } = mount({
      nodes: new Map(),
      visibleNodeIds: [],
      initialSelectedId: null,
      onSelect,
    });
    press(tree, "ArrowDown");
    press(tree, "Home");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
