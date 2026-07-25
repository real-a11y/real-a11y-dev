// Unit tests for the role+name → node-id targeting policy. The resolver is
// pure data-in/data-out over a native-shaped tree, so the fixture is
// hand-built: a synthesized root (`ax-1`, no backing DOM element) over
// DOM-backed controls (`ax-dom-<n>`), including a duplicate-named pair, a
// disabled button, and an unlabeled one.

import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";
import { describe, expect, it } from "vitest";

import { resolveTarget } from "./resolve-target.js";

function node(
  id: string,
  role: string,
  name: string,
  overrides: Partial<SemanticNode["a11y"]> = {},
): SemanticNode {
  return {
    id,
    parentId: id === "ax-1" ? null : "ax-1",
    childIds: [],
    depth: id === "ax-1" ? 0 : 1,
    a11y: {
      role,
      name,
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
      ...overrides,
    },
  };
}

function tree(): ExtractionResult {
  const nodes = [
    node("ax-1", "RootWebArea", "Fixture"),
    node("ax-dom-10", "button", "Save"),
    node("ax-dom-11", "button", "Save"),
    node("ax-dom-12", "button", "Cancel", { states: { disabled: true } }),
    node("ax-dom-13", "textbox", "Email"),
    node("ax-dom-14", "button", ""),
  ];
  nodes[0].childIds = nodes.slice(1).map((n) => n.id);
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    rootId: "ax-1",
    source: { producer: "native", chrome: "141" },
  };
}

describe("resolveTarget — unique matches", () => {
  it("resolves a unique role+name to its node id", () => {
    const res = resolveTarget(tree(), { role: "textbox", name: "Email" });
    expect(res).toMatchObject({ kind: "resolved", nodeId: "ax-dom-13" });
  });

  it("resolves by role alone when only one node has it", () => {
    const res = resolveTarget(tree(), { role: "textbox" });
    expect(res).toMatchObject({ kind: "resolved", nodeId: "ax-dom-13" });
  });

  it("matches names case-insensitively and whitespace-normalized", () => {
    const res = resolveTarget(tree(), { role: "textbox", name: "  eMAIL \n " });
    expect(res).toMatchObject({ kind: "resolved", nodeId: "ax-dom-13" });
  });

  it('name "" matches only the unlabeled node', () => {
    const res = resolveTarget(tree(), { role: "button", name: "" });
    expect(res).toMatchObject({ kind: "resolved", nodeId: "ax-dom-14" });
  });

  it("nth=1 on a unique match resolves", () => {
    const res = resolveTarget(tree(), { role: "textbox", nth: 1 });
    expect(res).toMatchObject({ kind: "resolved", nodeId: "ax-dom-13" });
  });
});

describe("resolveTarget — ambiguity and nth", () => {
  it("two same-named matches without nth are ambiguous, in document order", () => {
    const res = resolveTarget(tree(), { role: "button", name: "Save" });
    expect(res.kind).toBe("ambiguous");
    if (res.kind !== "ambiguous") return;
    expect(res.candidates.map((c) => c.nth)).toEqual([1, 2]);
    expect(res.candidates.map((c) => c.name)).toEqual(["Save", "Save"]);
  });

  it("nth picks among the role+name-filtered matches", () => {
    const res = resolveTarget(tree(), { role: "button", name: "Save", nth: 2 });
    expect(res).toMatchObject({ kind: "resolved", nodeId: "ax-dom-11" });
  });

  it("nth out of range reports the match count", () => {
    const res = resolveTarget(tree(), { role: "button", name: "Save", nth: 3 });
    expect(res).toEqual({ kind: "nth-out-of-range", nth: 3, matchCount: 2 });
  });

  it("role alone with several matches is ambiguous and lists all candidates", () => {
    const res = resolveTarget(tree(), { role: "button" });
    expect(res.kind).toBe("ambiguous");
    if (res.kind !== "ambiguous") return;
    // Save, Save, Cancel, "" — all four buttons, document order.
    expect(res.candidates).toHaveLength(4);
    expect(res.candidates[2]).toMatchObject({
      nth: 3,
      name: "Cancel",
      disabled: true,
    });
  });
});

describe("resolveTarget — misses and refusals", () => {
  it("unknown role is not-found with zero role matches", () => {
    const res = resolveTarget(tree(), { role: "slider", name: "Volume" });
    expect(res).toEqual({ kind: "not-found", matchesForRole: 0 });
  });

  it("known role with an unknown name counts the role-only matches", () => {
    const res = resolveTarget(tree(), { role: "button", name: "Nope" });
    expect(res).toEqual({ kind: "not-found", matchesForRole: 4 });
  });

  it("a match with no backing DOM element is refused as no-dom-node", () => {
    const res = resolveTarget(tree(), { role: "RootWebArea" });
    expect(res.kind).toBe("no-dom-node");
    if (res.kind !== "no-dom-node") return;
    expect(res.candidate).toMatchObject({ actionable: false, name: "Fixture" });
  });

  it("propagates disabled onto the resolved candidate", () => {
    const res = resolveTarget(tree(), { role: "button", name: "Cancel" });
    expect(res).toMatchObject({
      kind: "resolved",
      nodeId: "ax-dom-12",
      candidate: { disabled: true },
    });
  });
});
