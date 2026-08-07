import { describe, it, expect, beforeEach } from "vitest";

import { extractDomTree } from "../extraction/dom-extractor.js";

import type { SemanticNode } from "../types.js";

import { resetIdCounter } from "../utils/id-generator.js";

import { searchTree, applySearchFilter } from "./tree-search.js";

beforeEach(() => {
  resetIdCounter();
});

function createPage(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("searchTree", () => {
  it("finds nodes by tag name in DOM mode", () => {
    const root = createPage(
      "<nav><a href='/'>Home</a></nav><main><p>Text</p></main>",
    );
    const { nodes } = extractDomTree(root);

    const results = searchTree(nodes, "nav", "dom");
    const matchedNodes = Array.from(results)
      .map((id) => nodes.get(id)!)
      .filter((n) => n.dom?.tagName === "nav");

    expect(matchedNodes.length).toBe(1);
  });

  it("finds nodes by role in A11Y mode", () => {
    const root = createPage("<nav><a href='/'>Home</a></nav>");
    const { nodes } = extractDomTree(root);

    const results = searchTree(nodes, "navigation", "a11y");
    const matchedNodes = Array.from(results)
      .map((id) => nodes.get(id)!)
      .filter((n) => n.a11y.role === "navigation");

    expect(matchedNodes.length).toBe(1);
  });

  it("finds nodes by accessible name", () => {
    const root = createPage(
      '<button aria-label="Close">X</button><button>Submit</button>',
    );
    const { nodes } = extractDomTree(root);

    const results = searchTree(nodes, "close", "a11y");
    const matchedNodes = Array.from(results)
      .map((id) => nodes.get(id)!)
      .filter((n) => n.a11y.name.toLowerCase().includes("close"));

    expect(matchedNodes.length).toBe(1);
  });

  it("returns empty set for no matches", () => {
    const root = createPage("<div><p>Hello</p></div>");
    const { nodes } = extractDomTree(root);

    const results = searchTree(nodes, "xyznonexistent", "dom");
    // Only matches (not ancestors) should be checked
    const directMatches = Array.from(results).filter((id) => {
      const node = nodes.get(id)!;
      return (
        node.dom?.tagName.includes("xyznonexistent") ||
        node.a11y.name.includes("xyznonexistent")
      );
    });
    expect(directMatches.length).toBe(0);
  });

  it("is case insensitive", () => {
    const root = createPage("<button>Submit Form</button>");
    const { nodes } = extractDomTree(root);

    const results = searchTree(nodes, "SUBMIT", "a11y");
    expect(results.size).toBeGreaterThan(0);
  });

  it("includes ancestor nodes in results", () => {
    const root = createPage(
      "<div><section><p><button>Deep</button></p></section></div>",
    );
    const { nodes } = extractDomTree(root);

    const results = searchTree(nodes, "button", "dom");

    // The button, plus all its ancestors should be in the result
    const buttonNode = Array.from(nodes.values()).find(
      (n) => n.dom?.tagName === "button",
    )!;
    expect(results.has(buttonNode.id)).toBe(true);

    // Check that parent is also included
    if (buttonNode.parentId) {
      expect(results.has(buttonNode.parentId)).toBe(true);
    }
  });
});

describe("applySearchFilter", () => {
  it("marks all nodes as matching when query is empty", () => {
    const root = createPage("<div><p>Text</p><span>More</span></div>");
    const { nodes } = extractDomTree(root);

    applySearchFilter(nodes, "", "dom");

    for (const node of nodes.values()) {
      expect(node.ui?.matchesFilter).toBe(true);
    }
  });

  it("returns count of direct matches", () => {
    const root = createPage(
      "<button>A</button><button>B</button><div>Static text</div>",
    );
    const { nodes } = extractDomTree(root);

    const count = applySearchFilter(nodes, "button", "dom");
    expect(count).toBe(2);
  });
});

/**
 * A node map that counts its own lookups. The ancestor-marking walk is the only
 * thing that calls `get`, so one lookup is one step of a climb toward the root.
 */
class CountingNodeMap extends Map<string, SemanticNode> {
  parentLookups = 0;

  override get(id: string): SemanticNode | undefined {
    this.parentLookups++;
    return super.get(id);
  }
}

/**
 * A tree that reports how much work the search machinery did on it.
 *
 * The match predicate reads `a11y.name` before anything else, so one name read
 * is one predicate run. Together with the map's lookup count, that is what a
 * keystroke pays for — and both used to be paid more than once: the predicate
 * over the whole tree twice, the climb once per match instead of once per path.
 */
interface InstrumentedTree {
  nodes: CountingNodeMap;
  nameReads: number;
}

function addNode(
  tree: InstrumentedTree,
  id: string,
  parentId: string | null,
  name: string,
  role = "generic",
): void {
  tree.nodes.set(id, {
    id,
    parentId,
    childIds: [],
    depth: 0,
    a11y: {
      role,
      get name() {
        tree.nameReads++;
        return name;
      },
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
    ui: {
      expanded: true,
      highlighted: false,
      matchesFilter: false,
      selected: false,
    },
  });
}

/** A chain `c0 → c1 → … → c{depth-1}` with `leaves` buttons hanging off the end. */
function buildChainWithLeaves(depth: number, leaves: number): InstrumentedTree {
  const tree: InstrumentedTree = { nodes: new CountingNodeMap(), nameReads: 0 };
  addNode(tree, "c0", null, "chain");
  for (let i = 1; i < depth; i++) {
    addNode(tree, `c${i}`, `c${i - 1}`, "chain");
  }
  for (let i = 0; i < leaves; i++) {
    addNode(tree, `leaf${i}`, `c${depth - 1}`, `Button ${i}`, "button");
  }
  return tree;
}

describe("search cost", () => {
  it("runs the match predicate once per node, not twice", () => {
    const tree = buildChainWithLeaves(4, 3);

    const count = applySearchFilter(tree.nodes, "button", "a11y");

    expect(count).toBe(3);
    expect(tree.nameReads).toBe(tree.nodes.size);
  });

  it("climbs a shared ancestor path once, not once per match", () => {
    const depth = 20;
    const tree = buildChainWithLeaves(depth, 5);

    applySearchFilter(tree.nodes, "button", "a11y");

    // The five leaves share one chain to the root, so marking the path is one
    // climb. Without an early exit it is one full climb per leaf.
    expect(tree.nodes.parentLookups).toBeLessThanOrEqual(depth);
  });

  it("keeps the full ancestor path of matches on separate branches", () => {
    const tree: InstrumentedTree = {
      nodes: new CountingNodeMap(),
      nameReads: 0,
    };
    addNode(tree, "root", null, "page");
    addNode(tree, "a", "root", "middle");
    addNode(tree, "b", "a", "left");
    addNode(tree, "c", "a", "right");
    addNode(tree, "leafB", "b", "Button one", "button");
    addNode(tree, "leafC", "c", "Button two", "button");

    const visible = searchTree(tree.nodes, "button", "a11y");

    // `c` is only reachable via `a`, which the first branch already marked —
    // the early exit must not cut the second branch short before adding it.
    expect([...visible].sort()).toEqual([
      "a",
      "b",
      "c",
      "leafB",
      "leafC",
      "root",
    ]);
  });

  it("counts only nodes matching both the query and the role filter", () => {
    const tree: InstrumentedTree = {
      nodes: new CountingNodeMap(),
      nameReads: 0,
    };
    addNode(tree, "root", null, "page");
    addNode(tree, "btn", "root", "Save item", "button");
    addNode(tree, "lnk", "root", "Save item", "link");

    const count = applySearchFilter(tree.nodes, "save", "a11y", "button");

    expect(count).toBe(1);
    // The link matches the query but not the role filter; the root matches
    // neither directly but stays visible as the matching button's ancestor.
    expect(tree.nodes.get("btn")?.ui?.matchesFilter).toBe(true);
    expect(tree.nodes.get("lnk")?.ui?.matchesFilter).toBe(false);
    expect(tree.nodes.get("root")?.ui?.matchesFilter).toBe(true);
  });
});
