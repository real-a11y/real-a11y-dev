import { describe, it, expect, afterEach } from "vitest";

import { extractA11yTree } from "@real-a11y-dev/core";

import { fixture, cleanup } from "./fixtures.js";

afterEach(cleanup);

/**
 * Decorative-element assertions. Per ARIA spec, an element with
 * `role="presentation"` (or its synonym `role="none"`) drops out of the
 * accessibility tree — its children are promoted to the parent. Same for
 * `<img alt="">`. These tests double as a recipe: drop them into your own
 * audit suite to verify a syntax-highlighted code block, a decorative
 * image, or a styled wrapper isn't leaking into the tree as noise.
 */
describe("presentational elements drop from the a11y tree", () => {
  it("flattens a syntax-highlighted code block (role='presentation' tokens)", () => {
    const root = fixture(`
      <pre tabindex="0">
        <code>
          <span role="presentation">const</span>
          <span role="presentation">sn</span>
          <span role="presentation">=</span>
          <span role="presentation">createInspector</span>
        </code>
      </pre>
    `);

    const { nodes } = extractA11yTree(root);
    const allNodes = [...nodes.values()];

    // Decorative spans never surface as their own nodes.
    expect(
      allNodes.find((n) => n.a11y.role === "presentation"),
    ).toBeUndefined();
    expect(
      allNodes.find(
        (n) => n.a11y.role === "generic" && n.a11y.name === "createInspector",
      ),
    ).toBeUndefined();

    // The <code> element is still in the tree (meaningful "code" role).
    expect(allNodes.find((n) => n.a11y.role === "code")).toBeDefined();
  });

  it("treats role='none' identically to role='presentation'", () => {
    const root = fixture(`
      <div>
        <span role="none">Decor</span>
        <button>Real action</button>
      </div>
    `);

    const { nodes } = extractA11yTree(root);
    const allNodes = [...nodes.values()];

    expect(
      allNodes.find((n) => n.a11y.role === "presentation"),
    ).toBeUndefined();
    // Decorative text doesn't leak as a standalone generic row.
    expect(
      allNodes.find(
        (n) => n.a11y.role === "generic" && n.a11y.name === "Decor",
      ),
    ).toBeUndefined();
    expect(allNodes.find((n) => n.a11y.role === "button")).toBeDefined();
  });

  it('drops <img alt=""> as decorative', () => {
    const root = fixture(`
      <main>
        <img alt="" src="decor.png" />
        <h1>Real heading</h1>
      </main>
    `);

    const { nodes } = extractA11yTree(root);
    const allNodes = [...nodes.values()];

    expect(allNodes.find((n) => n.dom.tagName === "img")).toBeUndefined();
    expect(allNodes.find((n) => n.a11y.role === "heading")).toBeDefined();
  });
});
