import { describe, it, expect, beforeEach } from "vitest";

import { extractA11yTree } from "../extraction/a11y-extractor.js";
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

// The visually-hidden ("sr-only") pattern: clipped to 1px and positioned out
// of flow, but read by every screen reader. The extractor flags it
// `dom.isHidden` (it is not visible) while keeping it `a11y.isExposedToAT`.
// Queries follow what AT reads, so they keep it; content hidden from AT too
// (`visibility: hidden`, `aria-hidden`) stays out.
describe("screen-reader-only content", () => {
  const SR_ONLY =
    "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)";

  function attached(html: string) {
    const root = createPage(html);
    document.body.appendChild(root);
    return {
      tree: extractDomTree(root),
      [Symbol.dispose]: () => root.remove(),
    };
  }

  it("is flagged visually hidden but exposed to AT", () => {
    using page = attached(`<h2 style="${SR_ONLY}">Navigation Menu</h2>`);
    const h2 = findAllByRole(page.tree, "heading", { includeHidden: true })[0];
    expect(h2?.dom?.isHidden).toBe(true);
    expect(h2?.a11y.isExposedToAT).toBe(true);
  });

  it("stays in the heading outline", () => {
    using page = attached(`
      <h2 style="${SR_ONLY}">Navigation Menu</h2>
      <h1>Title</h1>
    `);
    expect(getOutline(page.tree).map((e) => e.name)).toEqual([
      "Navigation Menu",
      "Title",
    ]);
  });

  it("is found by findByRole and kept by linearize", () => {
    using page = attached(`<h1 style="${SR_ONLY}">Only heading</h1>`);
    expect(findByRole(page.tree, "heading")?.a11y.name).toBe("Only heading");
    expect(
      linearize(page.tree).some((n) => n.a11y.name === "Only heading"),
    ).toBe(true);
  });

  // The DOM view keeps an aria-hidden subtree and records exposure per
  // element, so a heading inside one still reads `isExposedToAT: true`. No
  // descendant can escape an aria-hidden ancestor, so the walk inherits it.
  it("leaves out an sr-only heading inside an aria-hidden ancestor", () => {
    using page = attached(`
      <div aria-hidden="true"><h2 style="${SR_ONLY}">Private</h2></div>
      <h2>Shown</h2>
    `);
    expect(getOutline(page.tree).map((e) => e.name)).toEqual(["Shown"]);
  });

  // A heading outline is what AT navigates by, so on a DOM-view tree (which
  // keeps aria-hidden subtrees) it leaves out headings AT can't reach, even
  // visible ones.
  it("leaves AT-hidden headings out of the outline of a DOM-view tree", () => {
    using page = attached(`
      <h2 aria-hidden="true">Decorative</h2>
      <div aria-hidden="true"><h2>Behind a modal</h2></div>
      <h2>Shown</h2>
    `);
    expect(getOutline(page.tree).map((e) => e.name)).toEqual(["Shown"]);
  });

  it("does not find an aria-hidden heading by default", () => {
    using page = attached(
      `<h2 aria-hidden="true">Decorative</h2><h2>Shown</h2>`,
    );
    expect(findAllByRole(page.tree, "heading").map((n) => n.a11y.name)).toEqual(
      ["Shown"],
    );
    expect(findByRole(page.tree, "heading")?.a11y.name).toBe("Shown");
  });

  it("does not find a visible heading inside an aria-hidden ancestor", () => {
    using page = attached(`
      <div aria-hidden="true"><h2>Behind a modal</h2></div>
      <h2>Shown</h2>
    `);
    expect(findAllByRole(page.tree, "heading").map((n) => n.a11y.name)).toEqual(
      ["Shown"],
    );
    expect(
      findAllByRole(page.tree, "heading", { includeHidden: true }).map(
        (n) => n.a11y.name,
      ),
    ).toEqual(["Behind a modal", "Shown"]);
  });

  it("still leaves out visibility:hidden and aria-hidden headings", () => {
    using page = attached(`
      <h2 style="visibility:hidden">Invisible</h2>
      <h2 aria-hidden="true" style="${SR_ONLY}">Hidden from AT</h2>
      <h2>Shown</h2>
    `);
    expect(getOutline(page.tree).map((e) => e.name)).toEqual(["Shown"]);
    expect(
      findAllByRole(page.tree, "heading", { includeHidden: true }).map(
        (n) => n.a11y.name,
      ),
    ).toEqual(["Invisible", "Hidden from AT", "Shown"]);
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

  it("skips the controls in a closed details' body, as Chromium's Tab does", () => {
    // Chromium 151 tabs to the summaries and "Visible" only. Whether a summary
    // is itself a stop is a rule of its own, so only the rest is compared.
    const root = createPage(`
      <details><summary>S</summary>
        <a href="/x">Hidden link</a><button>Hidden button</button>
        <details><summary>Nested</summary><a href="/n">Nested link</a></details>
      </details>
      <details open><summary>O</summary><a href="/o">Open link</a></details>
      <a href="/y">Visible</a>
    `);
    const names = getTabSequence(extractDomTree(root))
      .filter((n) => n.dom?.tagName !== "summary")
      .map((n) => n.a11y.name);
    expect(names).toEqual(["Open link", "Visible"]);
  });

  // Every expectation below was recorded by pressing Tab through the same
  // markup in Chromium 151 and reading `document.activeElement`.
  describe("contenteditable", () => {
    const stops = (tree: ReturnType<typeof extractDomTree>) =>
      getTabSequence(tree).map((n) =>
        n.a11y.name ? `${n.a11y.role} "${n.a11y.name}"` : n.a11y.role,
      );

    const COMPOSER = `
      <h1>Compose</h1>
      <div contenteditable="true" role="textbox" aria-label="Message">
        <p>Reset link: <a href="https://x.test/reset?token=abc123">https://x.test/reset?token=abc123</a></p>
        <h3>Q3 layoffs plan</h3>
        <p>cc <a contenteditable="false" href="/u/alice" aria-label="Mention Alice">@alice</a></p>
      </div>
      <article><div contenteditable="true">my password is hunter2</div></article>
    `;

    // The a11y view is what `tabs` and `get_tab_order` serialize. The
    // role-less editor is a stop there too, and it is not named after what
    // was typed into it.
    it("lists each editing host and skips a link inside one (a11y view)", () => {
      const tree = extractA11yTree(createPage(COMPOSER));
      expect(stops(tree)).toEqual([
        'textbox "Message"',
        'link "Mention Alice"',
        "generic",
      ]);
    });

    it("lists each editing host and skips a link inside one (DOM view)", () => {
      const tree = extractDomTree(createPage(COMPOSER));
      expect(stops(tree)).toEqual([
        'textbox "Message"',
        'link "Mention Alice"',
        "generic",
      ]);
    });

    it("keeps an empty role-less editor as a stop", () => {
      const tree = extractA11yTree(
        createPage(`<button>Before</button><div contenteditable></div>`),
      );
      expect(stops(tree)).toEqual(['button "Before"', "generic"]);
    });

    // A link loses its focusability to editing; nothing else does.
    it("keeps controls and explicit tabindexes inside an editor", () => {
      const tree = extractDomTree(
        createPage(`
          <div contenteditable="true" role="textbox" aria-label="Doc">
            <a href="/plain">Plain link</a>
            <a href="/ti" tabindex="0">Tabbable link</a>
            <button>Inside button</button>
            <input aria-label="Inside input">
            <span role="button" tabindex="0">Chip</span>
          </div>
        `),
      );
      expect(stops(tree)).toEqual([
        'textbox "Doc"',
        'link "Tabbable link"',
        'button "Inside button"',
        'textbox "Inside input"',
        'button "Chip"',
      ]);
    });

    it("counts only the outermost host; a contenteditable=false island reopens one", () => {
      const tree = extractDomTree(
        createPage(`
          <div contenteditable="true" role="textbox" aria-label="Outer">
            <div contenteditable="true" role="textbox" aria-label="Nested">n</div>
            <div contenteditable="false">
              <a href="/island">Island link</a>
              <div contenteditable="true" role="textbox" aria-label="Reopened">
                <a href="/re">Link in reopened</a>
              </div>
            </div>
            <div contenteditable="bogus"><a href="/b">Link under invalid value</a></div>
          </div>
        `),
      );
      expect(stops(tree)).toEqual([
        'textbox "Outer"',
        'link "Island link"',
        'textbox "Reopened"',
      ]);
    });

    it("reads the attribute as HTML does: '', plaintext-only, any case; invalid inherits", () => {
      const tree = extractDomTree(
        createPage(`
          <div contenteditable="" role="textbox" aria-label="Empty string"></div>
          <div contenteditable="plaintext-only" role="textbox" aria-label="Plaintext"></div>
          <div contenteditable="TRUE" role="textbox" aria-label="Upper case"></div>
          <div contenteditable="bogus" role="textbox" aria-label="Invalid"></div>
          <div contenteditable="true" role="textbox" aria-label="Opted out" tabindex="-1"></div>
          <a href="/host" contenteditable="true">Link that is the host</a>
          <div contenteditable="false"><a href="/f">Link under false</a></div>
        `),
      );
      expect(stops(tree)).toEqual([
        'textbox "Empty string"',
        'textbox "Plaintext"',
        'textbox "Upper case"',
        // An editing host takes no name from its content, a link included.
        "link",
        'link "Link under false"',
      ]);
    });

    it("orders a positive-tabindex host first, like any other stop", () => {
      const tree = extractDomTree(
        createPage(`
          <button>Zero</button>
          <div contenteditable="true" role="textbox" aria-label="First" tabindex="1"></div>
        `),
      );
      expect(stops(tree)).toEqual(['textbox "First"', 'button "Zero"']);
    });

    // A light-DOM link slotted into a component inside an editor is still
    // editable content, so it is not a stop either.
    it("skips a link slotted into a component inside an editor", () => {
      const root = createPage(
        `<div contenteditable="true" role="textbox" aria-label="Editor"><span id="c"><a href="/s">Slotted link</a></span></div>`,
      );
      root.querySelector("#c")!.attachShadow({ mode: "open" }).innerHTML =
        "<b><slot></slot></b>";
      expect(stops(extractDomTree(root))).toEqual(['textbox "Editor"']);
    });

    // Editing does not cross into a shadow tree: a link a component renders
    // inside an editor is still a stop.
    it("does not reach into a shadow root under an editor", () => {
      const root = createPage(
        `<div contenteditable="true" role="textbox" aria-label="Editor"><span id="w"></span></div>`,
      );
      root.querySelector("#w")!.attachShadow({ mode: "open" }).innerHTML =
        `<a href="/s">Shadow link</a>`;
      expect(stops(extractDomTree(root))).toEqual([
        'textbox "Editor"',
        'link "Shadow link"',
      ]);
    });
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

  it("reports what a field holds changing (ADR-0001)", () => {
    const root = createPage(`<input aria-label="Search">`);
    const before = extractDomTree(root);
    (root.querySelector("input") as HTMLInputElement).value = "hello";
    const diff = diffTrees(before, extractDomTree(root));
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].changes).toEqual(["a11y.value"]);
    expect(diff.changed[0].before.a11y.value).toBeUndefined();
    expect(diff.changed[0].after.a11y.value).toBe("hello");
  });
});
