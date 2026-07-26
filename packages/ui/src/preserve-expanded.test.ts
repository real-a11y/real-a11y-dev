import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";
import { describe, it, expect } from "vitest";

import { preserveExpandedState } from "./preserve-expanded.js";

function node(
  id: string,
  expanded: boolean,
  extras: Partial<SemanticNode> = {},
): SemanticNode {
  return {
    id,
    parentId: null,
    childIds: [],
    depth: 0,
    a11y: {
      role: "generic",
      name: id,
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
    ui: {
      expanded,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
    ...extras,
  };
}

function result(entries: Array<[string, boolean]>): ExtractionResult {
  return {
    nodes: new Map(entries.map(([id, expanded]) => [id, node(id, expanded)])),
    rootId: entries[0]?.[0] ?? "root",
    source: { producer: "dom" },
  };
}

describe("preserveExpandedState", () => {
  it("copies expanded from prev onto matching next ids", () => {
    const prev = result([
      ["a", true],
      ["b", false],
    ]);
    const next = result([
      ["a", false],
      ["b", true],
    ]);
    preserveExpandedState(prev, next);
    expect(next.nodes.get("a")!.ui!.expanded).toBe(true);
    expect(next.nodes.get("b")!.ui!.expanded).toBe(false);
  });

  it("leaves new ids on next untouched", () => {
    const prev = result([["a", true]]);
    const next = result([
      ["a", false],
      ["new", true],
    ]);
    preserveExpandedState(prev, next);
    expect(next.nodes.get("new")!.ui!.expanded).toBe(true);
  });

  it("ignores ids that disappeared from next", () => {
    const prev = result([
      ["a", true],
      ["gone", false],
    ]);
    const next = result([["a", false]]);
    preserveExpandedState(prev, next);
    expect(next.nodes.has("gone")).toBe(false);
    expect(next.nodes.get("a")!.ui!.expanded).toBe(true);
  });
});
