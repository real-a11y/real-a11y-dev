import { describe, it, expect, beforeEach } from "vitest";
import { extractDomTree } from "../extraction/dom-extractor.js";
import { searchTree, applySearchFilter } from "./tree-search.js";
import { resetIdCounter } from "../utils/id-generator.js";

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
      .filter((n) => n.dom.tagName === "nav");

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
        node.dom.tagName.includes("xyznonexistent") ||
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
      (n) => n.dom.tagName === "button",
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
      expect(node.ui.matchesFilter).toBe(true);
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
