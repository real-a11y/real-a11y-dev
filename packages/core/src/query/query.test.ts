import { describe, it, expect, beforeEach } from "vitest";

import { extractDomTree } from "../extraction/dom-extractor.js";
import { resetIdCounter } from "../utils/id-generator.js";

import { diffTrees } from "./diff.js";
import { findByRole, findAllByRole } from "./find-by-role.js";
import { linearize } from "./linearize.js";
import { getOutline } from "./outline.js";
import { getTabSequence } from "./tab-sequence.js";

beforeEach(() => {
  resetIdCounter();
});

function createPage(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("findByRole", () => {
  it("finds the first node with a matching role in document order", () => {
    const root = createPage(`
      <button>First</button>
      <button>Second</button>
    `);
    const tree = extractDomTree(root);
    const button = findByRole(tree, "button");
    expect(button?.a11y.name).toBe("First");
  });

  it("filters by accessible name (string = exact, case-insensitive)", () => {
    const root = createPage(`
      <button>Save</button>
      <button>Save changes</button>
    `);
    const tree = extractDomTree(root);
    expect(findByRole(tree, "button", { name: "save" })?.a11y.name).toBe(
      "Save",
    );
    expect(
      findByRole(tree, "button", { name: "SAVE CHANGES" })?.a11y.name,
    ).toBe("Save changes");
  });

  it("filters by accessible name (RegExp)", () => {
    const root = createPage(`
      <button>Save</button>
      <button>Save changes</button>
    `);
    const tree = extractDomTree(root);
    const match = findByRole(tree, "button", { name: /changes/i });
    expect(match?.a11y.name).toBe("Save changes");
  });

  it("filters headings by level", () => {
    const root = createPage(`
      <h1>Top</h1>
      <h2>Section A</h2>
      <h2>Section B</h2>
      <h3>Sub</h3>
    `);
    const tree = extractDomTree(root);
    const h2s = findAllByRole(tree, "heading", { level: 2 });
    expect(h2s.map((h) => h.a11y.name)).toEqual(["Section A", "Section B"]);
  });

  it("filters by aria state (checked)", () => {
    const root = createPage(`
      <input type="checkbox" aria-label="a" />
      <input type="checkbox" checked aria-label="b" />
    `);
    const tree = extractDomTree(root);
    const checked = findAllByRole(tree, "checkbox", { checked: true });
    expect(checked.map((n) => n.a11y.name)).toEqual(["b"]);
  });

  it("returns null when nothing matches", () => {
    const root = createPage(`<p>No buttons here</p>`);
    const tree = extractDomTree(root);
    expect(findByRole(tree, "button")).toBeNull();
  });
});

describe("linearize", () => {
  it("returns nodes in pre-order", () => {
    const root = createPage(`
      <main>
        <h1>Title</h1>
        <p>Body</p>
      </main>
    `);
    const tree = extractDomTree(root);
    const order = linearize(tree).map((n) => n.a11y.role);
    // root (generic) → main → heading → paragraph
    expect(order).toContain("main");
    const mainIdx = order.indexOf("main");
    const headingIdx = order.indexOf("heading");
    const paragraphIdx = order.indexOf("paragraph");
    expect(mainIdx).toBeLessThan(headingIdx);
    expect(headingIdx).toBeLessThan(paragraphIdx);
  });
});

describe("getOutline", () => {
  it("returns headings in document order with their levels", () => {
    const root = createPage(`
      <h1>Top</h1>
      <h2>A</h2>
      <h3>A.1</h3>
      <h2>B</h2>
    `);
    const tree = extractDomTree(root);
    expect(getOutline(tree)).toEqual([
      expect.objectContaining({ level: 1, name: "Top" }),
      expect.objectContaining({ level: 2, name: "A" }),
      expect.objectContaining({ level: 3, name: "A.1" }),
      expect.objectContaining({ level: 2, name: "B" }),
    ]);
  });

  it("respects aria-level for role=heading", () => {
    const root = createPage(`
      <div role="heading" aria-level="2">Custom</div>
    `);
    const tree = extractDomTree(root);
    const [entry] = getOutline(tree);
    expect(entry).toEqual(
      expect.objectContaining({ level: 2, name: "Custom" }),
    );
  });
});

describe("getTabSequence", () => {
  it("places positive tabindexes first, in ascending order", () => {
    const root = createPage(`
      <button>Zero</button>
      <button tabindex="2">Second</button>
      <button tabindex="1">First</button>
    `);
    const tree = extractDomTree(root);
    const names = getTabSequence(tree).map((n) => n.a11y.name);
    expect(names).toEqual(["First", "Second", "Zero"]);
  });

  it("skips tabindex=-1 and disabled nodes", () => {
    const root = createPage(`
      <button>A</button>
      <button tabindex="-1">Skipped</button>
      <button disabled>Disabled</button>
      <button>B</button>
    `);
    const tree = extractDomTree(root);
    const names = getTabSequence(tree).map((n) => n.a11y.name);
    expect(names).toEqual(["A", "B"]);
  });
});

describe("diffTrees", () => {
  it("detects added, removed, and changed nodes across extractions", () => {
    const root = createPage(`
      <button aria-expanded="false">Menu</button>
      <div id="drop"></div>
    `);
    const before = extractDomTree(root);

    // Mutate the DOM: open the menu, add a list, remove the empty div
    const btn = root.querySelector("button")!;
    btn.setAttribute("aria-expanded", "true");
    const ul = document.createElement("ul");
    ul.setAttribute("role", "menu");
    ul.innerHTML = `<li role="menuitem">New</li>`;
    root.replaceChild(ul, root.querySelector("#drop")!);

    const after = extractDomTree(root);
    const diff = diffTrees(before, after);

    // Menu button's expanded state changed
    const btnChange = diff.changed.find((c) => c.before.a11y.role === "button");
    expect(btnChange?.changes).toContain("a11y.states.expanded");

    // New menuitem added
    expect(diff.added.some((n) => n.a11y.role === "menuitem")).toBe(true);

    // Empty <div> removed
    expect(diff.removed.length).toBeGreaterThan(0);
  });
});
