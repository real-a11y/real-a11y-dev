import { describe, it, expect } from "vitest";

import type { SemanticNode } from "../types.js";

import { buildControlsIndex } from "./controls-index.js";

function makeNode(
  treeId: string,
  attrs: Record<string, string> = {},
): SemanticNode {
  return {
    id: treeId,
    parentId: null,
    childIds: [],
    depth: 0,
    dom: { tagName: "div", attributes: attrs, textContent: null, isHidden: false },
    a11y: {
      role: "generic",
      name: "",
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
    interaction: {
      isInteractive: false,
      actions: [],
      isFocusable: false,
      isEditable: false,
    },
    ui: {
      expanded: true,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

function tree(...entries: Array<[string, SemanticNode]>) {
  return new Map(entries);
}

describe("buildControlsIndex", () => {
  it("returns empty maps for an empty tree", () => {
    const { forward, reverse } = buildControlsIndex(new Map());
    expect(forward.size).toBe(0);
    expect(reverse.size).toBe(0);
  });

  it("ignores nodes without aria-controls", () => {
    const { forward, reverse } = buildControlsIndex(
      tree(["t1", makeNode("t1", { id: "menu" })]),
    );
    expect(forward.size).toBe(0);
    expect(reverse.size).toBe(0);
  });

  it("resolves aria-controls to the controlled element's tree id", () => {
    const { forward, reverse } = buildControlsIndex(
      tree(
        ["t1", makeNode("t1", { "aria-controls": "menu" })],
        ["t2", makeNode("t2", { id: "menu" })],
      ),
    );
    expect(forward.get("t1")).toEqual(["t2"]);
    expect(reverse.get("t2")).toEqual(["t1"]);
  });

  it("handles aria-controls with multiple space-separated ids", () => {
    const { forward, reverse } = buildControlsIndex(
      tree(
        ["t1", makeNode("t1", { "aria-controls": "panel-a panel-b" })],
        ["t2", makeNode("t2", { id: "panel-a" })],
        ["t3", makeNode("t3", { id: "panel-b" })],
      ),
    );
    expect(forward.get("t1")).toEqual(["t2", "t3"]);
    expect(reverse.get("t2")).toEqual(["t1"]);
    expect(reverse.get("t3")).toEqual(["t1"]);
  });

  it("collects multiple triggers pointing at the same element in reverse", () => {
    const { reverse } = buildControlsIndex(
      tree(
        ["t1", makeNode("t1", { "aria-controls": "panel" })],
        ["t2", makeNode("t2", { "aria-controls": "panel" })],
        ["t3", makeNode("t3", { id: "panel" })],
      ),
    );
    expect(reverse.get("t3")).toEqual(["t1", "t2"]);
  });

  it("drops references to dom ids not present in the tree", () => {
    const { forward, reverse } = buildControlsIndex(
      tree(["t1", makeNode("t1", { "aria-controls": "ghost" })]),
    );
    expect(forward.size).toBe(0);
    expect(reverse.size).toBe(0);
  });

  it("does not include the trigger in forward when none of its references resolve", () => {
    const { forward } = buildControlsIndex(
      tree(
        ["t1", makeNode("t1", { "aria-controls": "ghost-a ghost-b" })],
        ["t2", makeNode("t2", { id: "real" })],
      ),
    );
    expect(forward.has("t1")).toBe(false);
  });
});
