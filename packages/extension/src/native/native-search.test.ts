import { describe, expect, it } from "vitest";

import type { NativeNode } from "./native-actions.js";
import { searchNativeTree } from "./native-search.js";

/**
 * A small tree: root > main > [heading "Welcome", button "Submit"], main also
 * has a nested section > link "Learn more". Enough branching to exercise
 * ancestor-inclusion and role-group filtering without a real CDP read.
 */
function buildTree(): Map<string, NativeNode> {
  const nodes: NativeNode[] = [
    {
      id: "root",
      role: "RootWebArea",
      name: "Test page",
      depth: 0,
      childIds: ["main"],
    },
    {
      id: "main",
      role: "main",
      name: "",
      depth: 1,
      childIds: ["heading", "button", "section"],
    },
    { id: "heading", role: "heading", name: "Welcome", depth: 2 },
    { id: "button", role: "button", name: "Submit", depth: 2 },
    { id: "section", role: "region", name: "", depth: 2, childIds: ["link"] },
    { id: "link", role: "link", name: "Learn more", depth: 3 },
  ];
  return new Map(nodes.map((n) => [n.id, n]));
}

function buildParentOf(nodes: Map<string, NativeNode>): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes.values()) {
    for (const childId of node.childIds ?? []) map.set(childId, node.id);
  }
  return map;
}

describe("searchNativeTree", () => {
  it("returns empty sets when neither query nor role filter is active", () => {
    const nodes = buildTree();
    const result = searchNativeTree(nodes, buildParentOf(nodes), "", null);
    expect(result.directIds.size).toBe(0);
    expect(result.visibleIds.size).toBe(0);
  });

  it("matches by accessible name and includes ancestors in visibleIds", () => {
    const nodes = buildTree();
    const result = searchNativeTree(nodes, buildParentOf(nodes), "learn", null);
    expect(result.directIds).toEqual(new Set(["link"]));
    // link's own path to the root, not siblings.
    expect(result.visibleIds).toEqual(
      new Set(["link", "section", "main", "root"]),
    );
  });

  it("matches by role", () => {
    const nodes = buildTree();
    const result = searchNativeTree(
      nodes,
      buildParentOf(nodes),
      "button",
      null,
    );
    expect(result.directIds).toEqual(new Set(["button"]));
  });

  it("matches by state key/value", () => {
    const nodes = buildTree();
    nodes.set("button", {
      ...nodes.get("button")!,
      states: { disabled: true },
    });
    const result = searchNativeTree(
      nodes,
      buildParentOf(nodes),
      "disabled",
      null,
    );
    expect(result.directIds).toEqual(new Set(["button"]));
  });

  it("matches by value and placeholder", () => {
    const nodes = buildTree();
    nodes.set("button", {
      ...nodes.get("button")!,
      role: "textbox",
      value: "hello world",
      placeholder: "Type here",
    });
    expect(
      searchNativeTree(nodes, buildParentOf(nodes), "hello", null).directIds,
    ).toEqual(new Set(["button"]));
    expect(
      searchNativeTree(nodes, buildParentOf(nodes), "type here", null)
        .directIds,
    ).toEqual(new Set(["button"]));
  });

  it("filters by role group, independent of query", () => {
    const nodes = buildTree();
    const result = searchNativeTree(
      nodes,
      buildParentOf(nodes),
      "",
      "landmark",
    );
    // "main" and "region" are both in the landmark group.
    expect(result.directIds).toEqual(new Set(["main", "section"]));
  });

  it("AND-combines query and role filter", () => {
    const nodes = buildTree();
    const result = searchNativeTree(
      nodes,
      buildParentOf(nodes),
      "welcome",
      "heading",
    );
    expect(result.directIds).toEqual(new Set(["heading"]));

    // A query that matches nothing in the role group yields no direct match.
    const noMatch = searchNativeTree(
      nodes,
      buildParentOf(nodes),
      "submit",
      "heading",
    );
    expect(noMatch.directIds.size).toBe(0);
  });

  it("is case-insensitive", () => {
    const nodes = buildTree();
    const result = searchNativeTree(
      nodes,
      buildParentOf(nodes),
      "WELCOME",
      null,
    );
    expect(result.directIds).toEqual(new Set(["heading"]));
  });

  it("returns no matches when the role filter group has no members in the tree", () => {
    const nodes = buildTree();
    const result = searchNativeTree(nodes, buildParentOf(nodes), "", "image");
    expect(result.directIds.size).toBe(0);
  });
});
