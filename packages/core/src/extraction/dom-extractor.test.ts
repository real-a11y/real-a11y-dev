import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { resetIdCounter } from "../utils/id-generator.js";

import { extractA11yTree } from "./a11y-extractor.js";
import * as clobberSafe from "./clobber-safe.js";
import {
  extractDomTree,
  getDescendantText,
  isSensitiveField,
} from "./dom-extractor.js";

beforeEach(() => {
  resetIdCounter();
});

function createPage(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("DOM clobbering resilience", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not crash when an element's `id` property is clobbered by a named child", () => {
    // Regression: a <form> (or the other legacy named-property elements) with a
    // child named `id` makes `element.id` return that CHILD ELEMENT instead of a
    // string. The walk did `element.id.startsWith("__sn-")`, which threw
    // "TypeError: y.startsWith is not a function" and crashed the whole
    // extraction — the panel showed "Connecting to page..." forever.
    const root = createPage(`
      <main>
        <form aria-label="Search">
          <input name="id" aria-label="Query" />
          <button type="submit">Go</button>
        </form>
      </main>
    `);

    // Force the clobber deterministically (jsdom's named-property override is
    // not guaranteed) — this mirrors what a real browser does for <form>.
    const form = root.querySelector("form")!;
    Object.defineProperty(form, "id", {
      configurable: true,
      get: () => form.querySelector('[name="id"]'),
    });
    expect(typeof form.id).not.toBe("string"); // sanity: id now returns an element

    expect(() => extractA11yTree(root)).not.toThrow();

    // The form and its controls still make it into the tree.
    const names = [...extractA11yTree(root).nodes.values()].map(
      (n) => n.a11y.name,
    );
    expect(names).toContain("Search");
    expect(names).toContain("Query");
  });

  it("does not crash and keeps the subtree when `children`/`childNodes`/`textContent` are clobbered", () => {
    // e.g. a "number of children" field: <input name="children"> shadows
    // `form.children` so it returns the input, and `for (const c of form.children)`
    // used to throw "children is not iterable", aborting the whole extraction.
    const root = createPage(`
      <main>
        <form aria-label="Household">
          <input name="children" aria-label="Number of children" />
          <input name="textContent" aria-label="Notes" />
          <button type="submit">Save</button>
        </form>
      </main>
    `);

    const form = root.querySelector("form")!;
    // Force the named-property override for each structural prop.
    Object.defineProperty(form, "children", {
      configurable: true,
      get: () => form.querySelector('[name="children"]'),
    });
    Object.defineProperty(form, "childNodes", {
      configurable: true,
      get: () => form.querySelector('[name="children"]'),
    });
    Object.defineProperty(form, "textContent", {
      configurable: true,
      get: () => form.querySelector('[name="textContent"]'),
    });

    expect(() => extractA11yTree(root)).not.toThrow();

    // The form's controls survive — the real children were read through the
    // native accessor, not the clobbered property.
    const names = [...extractA11yTree(root).nodes.values()].map(
      (n) => n.a11y.name,
    );
    expect(names).toContain("Household");
    expect(names).toContain("Number of children");
    expect(names).toContain("Notes");
    expect(names).toContain("Save");
  });

  it("does not drop the subtree when the `hidden` property is clobbered by a named child", () => {
    // Regression: a <form> with <input name="hidden"> (or id="hidden") makes
    // `form.hidden` return that CHILD ELEMENT — a truthy value — so the naive
    // `if (element.hidden)` in isSubtreeHidden treated the form as hidden and
    // silently dropped its ENTIRE subtree. isHiddenFromAT had the same read, so
    // the form would also be filtered out of the a11y view. Not a crash — quiet
    // data loss. Both now read the real state via the prototype getter.
    const root = createPage(`
      <main>
        <form aria-label="Filters">
          <input name="hidden" aria-label="Include archived" />
          <button type="submit">Apply</button>
        </form>
      </main>
    `);

    const form = root.querySelector("form")!;
    // Force the clobber deterministically (jsdom does not auto-override).
    Object.defineProperty(form, "hidden", {
      configurable: true,
      get: () => form.querySelector('[name="hidden"]'),
    });
    expect(typeof form.hidden).not.toBe("boolean"); // sanity: now an element

    // isSubtreeHidden must not be fooled — the form and its controls stay in
    // the raw DOM tree.
    const domTree = extractDomTree(root);
    const domNames = [...domTree.nodes.values()].map((n) => n.a11y.name);
    expect(domNames).toContain("Filters");
    expect(domNames).toContain("Include archived");
    expect(domNames).toContain("Apply");

    // isHiddenFromAT must not be fooled either — the form stays exposed to AT
    // (otherwise the a11y view would filter it back out).
    const formNode = [...domTree.nodes.values()].find(
      (n) => n.a11y.name === "Filters",
    )!;
    expect(formNode.a11y.isExposedToAT).toBe(true);

    // ...and it survives a11y filtering.
    const a11yNames = [...extractA11yTree(root).nodes.values()].map(
      (n) => n.a11y.name,
    );
    expect(a11yNames).toContain("Filters");
    expect(a11yNames).toContain("Apply");
  });

  it("skips only the offending element (and its subtree) when its processing throws, keeping the rest of the tree", () => {
    // The per-element error boundary. If ANY read on ONE element throws — here a
    // clobbered `tagName` (`<input name="tagName">` on a [LegacyOverrideBuiltIns]
    // <form> makes `element.tagName.toLowerCase()` throw) — that element and its
    // subtree are dropped, but siblings and ancestors still extract. Before the
    // boundary a single throw unwound the whole walk and the panel hung forever.
    const root = createPage(`
      <main>
        <h1>Before</h1>
        <section aria-label="Doomed">
          <button>Doomed button</button>
        </section>
        <h2>After</h2>
      </main>
    `);

    const doomed = root.querySelector("section")!;
    // Clobber tagName to a non-string so `.toLowerCase()` throws on this element.
    Object.defineProperty(doomed, "tagName", {
      configurable: true,
      get: () => root.querySelector("h1"), // an element, not a string
    });

    // The boundary warns (outside production) rather than staying silent.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => extractDomTree(root)).not.toThrow();
    const result = extractDomTree(root);
    const names = [...result.nodes.values()].map((n) => n.a11y.name);

    // The rest of the tree survives.
    expect(names).toContain("Before");
    expect(names).toContain("After");

    // The doomed element and its whole subtree are gone.
    expect(names).not.toContain("Doomed");
    expect(names).not.toContain("Doomed button");

    // No orphaned half-built node: every node in the map is reachable from the
    // root through childIds (the caught element committed nothing).
    const reachable = new Set<string>();
    const visit = (id: string): void => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const childId of result.nodes.get(id)!.childIds) visit(childId);
    };
    visit(result.rootId);
    expect(reachable.size).toBe(result.nodes.size);

    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("extractDomTree", () => {
  it("extracts a simple DOM tree", () => {
    const root = createPage(`
      <header>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
      </header>
      <main>
        <h1>Welcome</h1>
        <p>Hello world</p>
      </main>
    `);

    const { nodes, rootId } = extractDomTree(root);

    expect(rootId).toBeTruthy();
    expect(nodes.size).toBeGreaterThan(0);

    const rootNode = nodes.get(rootId);
    expect(rootNode).toBeDefined();
    expect(rootNode!.dom.tagName).toBe("div");
    expect(rootNode!.depth).toBe(0);
    expect(rootNode!.parentId).toBe(null);
  });

  it("normalizes whitespace in accessible names", () => {
    // Pages sometimes leave raw newlines/indentation inside a name; the
    // computed name must collapse them to single spaces (accname §4.3.2)
    // so every surface — panel, search, serializer — sees the same string.
    const root = createPage(
      '<button aria-label="Amazon\n\n\n   Subtotal (2)">x</button>',
    );
    const { nodes } = extractDomTree(root);
    const btn = [...nodes.values()].find((n) => n.a11y.role === "button");
    expect(btn?.a11y.name).toBe("Amazon Subtotal (2)");
  });

  it("assigns correct parent-child relationships", () => {
    const root = createPage("<ul><li>One</li><li>Two</li></ul>");
    const { nodes, rootId } = extractDomTree(root);

    const rootNode = nodes.get(rootId)!;
    // Root div has one child: ul
    expect(rootNode.childIds.length).toBe(1);

    const ulId = rootNode.childIds[0];
    const ulNode = nodes.get(ulId)!;
    expect(ulNode.dom.tagName).toBe("ul");
    expect(ulNode.childIds.length).toBe(2);

    const li1 = nodes.get(ulNode.childIds[0])!;
    const li2 = nodes.get(ulNode.childIds[1])!;
    expect(li1.dom.tagName).toBe("li");
    expect(li2.dom.tagName).toBe("li");
    expect(li1.parentId).toBe(ulId);
    expect(li2.parentId).toBe(ulId);
  });

  it("computes accessible names from aria-label", () => {
    const root = createPage('<button aria-label="Close dialog">X</button>');
    const { nodes, rootId } = extractDomTree(root);

    const rootNode = nodes.get(rootId)!;
    const btnId = rootNode.childIds[0];
    const btn = nodes.get(btnId)!;
    expect(btn.a11y.name).toBe("Close dialog");
  });

  it("prefers aria-labelledby over aria-label (accname §2B before §2D)", () => {
    // When both are present, aria-labelledby wins: the referenced element's
    // text is the name, not the inline aria-label. This matches what browsers
    // and screen readers expose. Attached to the document so the IDREF
    // resolves via getElementById.
    document.body.innerHTML =
      '<h2 id="t">Confirm delete</h2>' +
      '<button aria-label="X" aria-labelledby="t">✕</button>';
    try {
      const btn = [...extractDomTree(document.body).nodes.values()].find(
        (n) => n.a11y.role === "button",
      )!;
      expect(btn.a11y.name).toBe("Confirm delete");
    } finally {
      document.body.innerHTML = "";
    }
  });

  it("computes accessible names from text content", () => {
    const root = createPage("<button>Submit</button>");
    const { nodes, rootId } = extractDomTree(root);

    const rootNode = nodes.get(rootId)!;
    const btn = nodes.get(rootNode.childIds[0])!;
    expect(btn.a11y.name).toBe("Submit");
  });

  it("computes accessible names from alt attribute", () => {
    const root = createPage('<img alt="Logo" src="logo.png">');
    const { nodes, rootId } = extractDomTree(root);

    const rootNode = nodes.get(rootId)!;
    const img = nodes.get(rootNode.childIds[0])!;
    expect(img.a11y.name).toBe("Logo");
  });

  it("detects interactive elements", () => {
    const root = createPage(`
      <a href="/page">Link</a>
      <button>Click me</button>
      <input type="text" placeholder="Name">
      <div>Static</div>
    `);

    const { nodes, rootId } = extractDomTree(root);
    const rootNode = nodes.get(rootId)!;

    const link = nodes.get(rootNode.childIds[0])!;
    const button = nodes.get(rootNode.childIds[1])!;
    const input = nodes.get(rootNode.childIds[2])!;
    const div = nodes.get(rootNode.childIds[3])!;

    expect(link.interaction.isInteractive).toBe(true);
    expect(link.interaction.actions).toContain("navigate");

    expect(button.interaction.isInteractive).toBe(true);
    expect(button.interaction.actions).toContain("click");

    expect(input.interaction.isInteractive).toBe(true);
    expect(input.interaction.actions).toContain("focus");

    expect(div.interaction.isInteractive).toBe(false);
  });

  it("exposes increment/decrement (not type) for ARIA [role='slider']", () => {
    // Radix Slider 1.x and other modern libs render a `<span role="slider">`
    // that listens for ArrowLeft/ArrowRight on itself. Surfacing "type"
    // produced a misleading TYPE badge that no-op'd when clicked. Pair the
    // increment/decrement actions instead so the panel's ▼/▲ stepper drives
    // real key events — works under the Screen Curtain too.
    const root = createPage(`
      <span role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">50</span>
    `);
    const { nodes } = extractDomTree(root);
    const slider = [...nodes.values()].find(
      (n) => n.dom.attributes["role"] === "slider",
    )!;
    expect(slider.interaction.actions).toContain("focus");
    expect(slider.interaction.actions).toContain("increment");
    expect(slider.interaction.actions).toContain("decrement");
    expect(slider.interaction.actions).not.toContain("type");
  });

  it("pairs increment/decrement on native <input type='range'> (no 'type')", () => {
    const root = createPage(
      `<input type="range" min="0" max="100" value="50">`,
    );
    const { nodes, rootId } = extractDomTree(root);
    const input = nodes.get(nodes.get(rootId)!.childIds[0])!;
    expect(input.interaction.actions).toContain("increment");
    expect(input.interaction.actions).toContain("decrement");
    // Sliders aren't typeable — keep the action surface honest.
    expect(input.interaction.actions).not.toContain("type");
  });

  it("pairs increment/decrement AND type on native <input type='number'>", () => {
    // Number inputs accept both — typed value entry AND arrow-key stepping.
    const root = createPage(`<input type="number" value="10">`);
    const { nodes, rootId } = extractDomTree(root);
    const input = nodes.get(nodes.get(rootId)!.childIds[0])!;
    expect(input.interaction.actions).toContain("type");
    expect(input.interaction.actions).toContain("increment");
    expect(input.interaction.actions).toContain("decrement");
  });

  it("classifies an editable (contenteditable) combobox as typeable, not click", () => {
    // Slack's search box: the ARIA 1.2 editable-combobox pattern hosted on a
    // contenteditable <div>. It IS a text field, so it must open the panel's
    // inline input like a textbox.
    const root = createPage(
      `<div role="combobox" contenteditable="true" aria-label="Query"
            aria-autocomplete="list" aria-expanded="true"
            aria-controls="lb"><p>in:new-channel</p></div>`,
    );
    const { nodes, rootId } = extractDomTree(root);
    const combo = nodes.get(nodes.get(rootId)!.childIds[0])!;
    expect(combo.interaction.actions).toContain("type");
    expect(combo.interaction.actions).toContain("focus");
    // "click" would outrank "type" in getPrimaryAction and re-hijack the
    // primary action, so it must NOT be present for an editable combobox.
    expect(combo.interaction.actions).not.toContain("click");
  });

  it('treats a contenteditable="plaintext-only" combobox as typeable', () => {
    const root = createPage(
      `<div role="combobox" contenteditable="plaintext-only" aria-label="Q">x</div>`,
    );
    const { nodes, rootId } = extractDomTree(root);
    const combo = nodes.get(nodes.get(rootId)!.childIds[0])!;
    expect(combo.interaction.actions).toContain("type");
    expect(combo.interaction.actions).not.toContain("click");
  });

  it("keeps a select-only combobox click-driven (no text entry)", () => {
    // No contenteditable → a popup button, not a text field. Opening it is a
    // click; there's nothing to type into on the combobox element itself.
    const root = createPage(
      `<div role="combobox" aria-expanded="false" aria-controls="lb" tabindex="0">Choose a state</div>`,
    );
    const { nodes, rootId } = extractDomTree(root);
    const combo = nodes.get(nodes.get(rootId)!.childIds[0])!;
    expect(combo.interaction.actions).toContain("click");
    expect(combo.interaction.actions).not.toContain("type");
  });

  it("classifies a native <input role='combobox'> as typeable (W3C APG example)", () => {
    // The APG editable-combobox example uses a native input; it already worked
    // via the tag branch. Guard it so splitting the role branch doesn't regress
    // it (and confirm the role branch isn't what handles native inputs).
    const root = createPage(
      `<input type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="lb">`,
    );
    const { nodes, rootId } = extractDomTree(root);
    const combo = nodes.get(nodes.get(rootId)!.childIds[0])!;
    expect(combo.interaction.actions).toContain("type");
    expect(combo.interaction.actions).not.toContain("click");
  });

  it("computes correct roles", () => {
    const root = createPage(`
      <nav aria-label="Main">
        <a href="/">Home</a>
      </nav>
      <main>
        <h1>Title</h1>
        <article>
          <p>Content</p>
        </article>
      </main>
    `);

    const { nodes, rootId } = extractDomTree(root);

    const allNodes = Array.from(nodes.values());
    const nav = allNodes.find((n) => n.dom.tagName === "nav")!;
    const link = allNodes.find((n) => n.dom.tagName === "a")!;
    const main = allNodes.find((n) => n.dom.tagName === "main")!;
    const h1 = allNodes.find((n) => n.dom.tagName === "h1")!;
    const article = allNodes.find((n) => n.dom.tagName === "article")!;
    const p = allNodes.find((n) => n.dom.tagName === "p")!;

    expect(nav.a11y.role).toBe("navigation");
    expect(link.a11y.role).toBe("link");
    expect(main.a11y.role).toBe("main");
    expect(h1.a11y.role).toBe("heading");
    expect(article.a11y.role).toBe("article");
    expect(p.a11y.role).toBe("paragraph");
  });

  it("captures ARIA states", () => {
    const root = createPage(`
      <button aria-expanded="true" aria-pressed="false">Toggle</button>
      <input type="checkbox" checked disabled>
    `);

    const { nodes, rootId } = extractDomTree(root);
    const rootNode = nodes.get(rootId)!;

    const btn = nodes.get(rootNode.childIds[0])!;
    expect(btn.a11y.states["expanded"]).toBe(true);
    expect(btn.a11y.states["pressed"]).toBe(false);

    const checkbox = nodes.get(rootNode.childIds[1])!;
    expect(checkbox.a11y.states["disabled"]).toBe(true);
    expect(checkbox.a11y.states["checked"]).toBe(true);
  });

  it("skips script and style elements", () => {
    const root = createPage(`
      <p>Visible</p>
      <script>alert('hi')</script>
      <style>.x{color:red}</style>
    `);

    const { nodes } = extractDomTree(root);
    const allTags = Array.from(nodes.values()).map((n) => n.dom.tagName);

    expect(allTags).not.toContain("script");
    expect(allTags).not.toContain("style");
    expect(allTags).toContain("p");
  });

  it("records heading levels", () => {
    const root = createPage("<h2>Subtitle</h2>");
    const { nodes, rootId } = extractDomTree(root);
    const rootNode = nodes.get(rootId)!;
    const h2 = nodes.get(rootNode.childIds[0])!;
    expect(h2.a11y.properties["level"]).toBe("2");
  });

  it("stores key attributes", () => {
    const root = createPage(
      '<a id="home-link" class="nav-link active" href="/home">Home</a>',
    );
    const { nodes, rootId } = extractDomTree(root);
    const rootNode = nodes.get(rootId)!;
    const link = nodes.get(rootNode.childIds[0])!;

    expect(link.dom.attributes["id"]).toBe("home-link");
    expect(link.dom.attributes["class"]).toBe("nav-link active");
    expect(link.dom.attributes["href"]).toBe("/home");
  });

  it("computes accessible name from wrapping <label> (implicit association)", () => {
    const root = createPage(`
      <label>Full name<input type="text" /></label>
      <label>Email address<input type="email" /></label>
      <label>Message<textarea></textarea></label>
    `);

    const { nodes } = extractDomTree(root);
    const allNodes = Array.from(nodes.values());

    const textInput = allNodes.find(
      (n) => n.dom.tagName === "input" && n.dom.attributes["type"] === "text",
    )!;
    expect(textInput.a11y.name).toBe("Full name");

    const emailInput = allNodes.find(
      (n) => n.dom.tagName === "input" && n.dom.attributes["type"] === "email",
    )!;
    expect(emailInput.a11y.name).toBe("Email address");

    const textarea = allNodes.find((n) => n.dom.tagName === "textarea")!;
    expect(textarea.a11y.name).toBe("Message");
  });

  it("keeps label[for] association working alongside wrapping labels", () => {
    // label[for] lookup uses ownerDocument.querySelector — requires the
    // elements to be attached to the document (not a detached fragment).
    document.body.innerHTML = `
      <label for="name-input">Name</label>
      <input id="name-input" type="text" />
    `;

    const { nodes } = extractDomTree(document.body);
    const input = Array.from(nodes.values()).find(
      (n) => n.dom.tagName === "input",
    )!;
    expect(input.a11y.name).toBe("Name");

    document.body.innerHTML = ""; // cleanup
  });

  // descendantText is a recursive textContent preview that consumers
  // (and the panel) can use to display "what's in this element" when
  // the accessible name is empty by spec — e.g. a Shiki-highlighted
  // <code> block whose tokens all live inside spans.
  describe("descendantText preview", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("captures recursive text content from nested spans", () => {
      const root = createPage(`
        <pre>
          <code>
            <span>npm</span>
            <span> install</span>
            <span> @real-a11y-dev/inspector</span>
          </code>
        </pre>
      `);

      const { nodes } = extractDomTree(root);
      const code = [...nodes.values()].find((n) => n.dom.tagName === "code")!;

      expect(code.dom.descendantText).toBe(
        "npm install @real-a11y-dev/inspector",
      );
      // Direct textContent stays empty — the spans are children, not text nodes.
      expect(code.dom.textContent).toBe("");
    });

    it("collapses whitespace in descendantText", () => {
      const root = createPage(`
        <div>
          <span>line one</span>
          <span>line two</span>
        </div>
      `);

      const div = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.tagName === "div" && n.parentId !== null,
      )!;

      // Newlines + indentation between spans collapse to a single space.
      expect(div.dom.descendantText).toBe("line one line two");
    });

    it("truncates very long text with an ellipsis", () => {
      const longText = "x".repeat(500);
      const root = createPage(
        `<pre><code><span>${longText}</span></code></pre>`,
      );

      const code = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.tagName === "code",
      )!;

      expect(code.dom.descendantText.length).toBeLessThanOrEqual(240);
      expect(code.dom.descendantText.endsWith("…")).toBe(true);
    });

    it("returns empty string for elements with no text", () => {
      const root = createPage(`<div><img alt="" /><br /></div>`);
      const div = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.tagName === "div" && n.parentId !== null,
      )!;
      expect(div.dom.descendantText).toBe("");
    });

    it("does not add a false ellipsis when collapsed text is exactly 240 chars", () => {
      // Regression (Devin): trailing whitespace after the 240th visible char
      // must not imply hidden content — old code trimmed before the cap check.
      const exact = "x".repeat(240);
      const root = createPage(`<div id="root"><span>${exact}</span>\n</div>`);
      const div = root.querySelector("#root")!;

      expect(getDescendantText(div)).toBe(exact);
      expect(getDescendantText(div).length).toBe(240);
      expect(getDescendantText(div).endsWith("…")).toBe(false);
    });

    it("does not read the full subtree when the preview is capped", () => {
      // Regression: getDescendantText used element.textContent (entire subtree)
      // then regex-scanned it for every node — O(total text × depth). A bounded
      // walk should stop after ~240 chars and skip unread later siblings.
      const paragraph = `${"word ".repeat(400)}`.trim(); // ~2k chars each
      const body = Array.from({ length: 20 }, () => `<p>${paragraph}</p>`).join(
        "",
      );
      const root = createPage(`<div id="root">${body}</div>`);
      const div = root.querySelector("#root")!;

      let totalCharsRead = 0;
      const orig = clobberSafe.safeTextContent;
      vi.spyOn(clobberSafe, "safeTextContent").mockImplementation((node) => {
        const text = orig(node);
        totalCharsRead += text.length;
        return text;
      });

      const preview = getDescendantText(div);
      expect(preview.length).toBeLessThanOrEqual(240);
      expect(preview.endsWith("…")).toBe(true);
      // Full subtree is ~40k chars; a bounded walk must not pull all of it.
      expect(totalCharsRead).toBeLessThan(5000);
    });
  });

  // accname-1.2 §4.3.2 step 2A: hidden subtrees contribute the empty string
  // to name-from-content. The previous extractor used element.textContent
  // directly and walked into aria-hidden / hidden / display:none descendants,
  // producing names that didn't match what real AT (NVDA, JAWS, VoiceOver)
  // reads. See https://github.com/real-a11y/real-a11y-dev/issues/60.
  describe("accessible name skips hidden descendants", () => {
    it("skips an aria-hidden SVG descendant in name-from-content", () => {
      const root = createPage(`
        <a href="/">
          <svg aria-hidden="true"><text>brand</text></svg>
          <span>Go home</span>
        </a>
      `);
      const link = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.tagName === "a",
      )!;
      expect(link.a11y.name.replace(/\s+/g, " ").trim()).toBe("Go home");
    });

    it("skips an aria-hidden span inside a button name", () => {
      const root = createPage(`
        <button>
          <span aria-hidden="true">×</span>
          <span>Close dialog</span>
        </button>
      `);
      const btn = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.tagName === "button",
      )!;
      expect(btn.a11y.name.replace(/\s+/g, " ").trim()).toBe("Close dialog");
    });

    it("skips a [hidden] descendant in a heading's name-from-content", () => {
      const root = createPage(`
        <h1>
          <span hidden>draft</span>
          Real A11y
        </h1>
      `);
      const h1 = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.tagName === "h1",
      )!;
      expect(h1.a11y.name.replace(/\s+/g, " ").trim()).toBe("Real A11y");
    });

    it("skips a display:none descendant in name-from-content", () => {
      const root = createPage(`
        <button>
          <span style="display: none">hidden bit</span>
          Submit
        </button>
      `);
      // Need the element attached to a document so getComputedStyle resolves
      document.body.appendChild(root);
      try {
        const btn = [...extractDomTree(root).nodes.values()].find(
          (n) => n.dom.tagName === "button",
        )!;
        expect(btn.a11y.name.replace(/\s+/g, " ").trim()).toBe("Submit");
      } finally {
        document.body.removeChild(root);
      }
    });

    it("skips aria-hidden subtree of an aria-labelledby target", () => {
      document.body.innerHTML = `
        <div id="lbl">
          Real A11y
          <span aria-hidden="true">decoration</span>
        </div>
        <button aria-labelledby="lbl">x</button>
      `;
      try {
        const btn = [...extractDomTree(document.body).nodes.values()].find(
          (n) => n.dom.tagName === "button",
        )!;
        expect(btn.a11y.name.replace(/\s+/g, " ").trim()).toBe("Real A11y");
      } finally {
        document.body.innerHTML = "";
      }
    });

    it("skips aria-hidden text inside a wrapping label", () => {
      const root = createPage(`
        <label>
          <span>Email</span>
          <span aria-hidden="true">*</span>
          <input type="email" />
        </label>
      `);
      const input = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.tagName === "input",
      )!;
      expect(input.a11y.name.replace(/\s+/g, " ").trim()).toBe("Email");
    });

    it("aria-label override still wins over hidden-skipped content", () => {
      const root = createPage(`
        <a href="/" aria-label="Real A11y — go to home">
          <svg aria-hidden="true"><text>real a11y</text></svg>
        </a>
      `);
      const link = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.tagName === "a",
      )!;
      expect(link.a11y.name).toBe("Real A11y — go to home");
    });

    // Name-from-content for treeitem / menuitem / etc. used to recurse into
    // every descendant — so a treeitem with a nested role="group" of more
    // treeitems concatenated the whole subtree's text into one row's name
    // ("Reports report-1 report-2 report-2A.docx ..."). Real ATs read each
    // row's own label independently. Surfaced by PR #80 on the APG Tree
    // View example. We skip subtrees whose computed role is a structural
    // "name barrier" (group, list, treeitem, row, …) when walking text.
    // Named widgets (link, button, checkbox, radio, switch) are different:
    // per accname §2F.iii they contribute their *computed name* — see the
    // heading/link tests below.
    it("treeitem name does NOT include nested role=group children's text", () => {
      const root = createPage(`
        <ul role="tree" aria-label="Docs">
          <li role="treeitem" id="reports">
            <span>Reports</span>
            <ul role="group">
              <li role="treeitem"><span>report-1</span></li>
              <li role="treeitem"><span>report-2</span></li>
            </ul>
          </li>
        </ul>
      `);
      const reports = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.attributes["id"] === "reports",
      )!;
      expect(reports.a11y.name).toBe("Reports");
      // The nested rows still appear as their own nodes with their own names.
      const inner = [...extractDomTree(root).nodes.values()].filter(
        (n) =>
          n.a11y.role === "treeitem" && n.dom.attributes["id"] !== "reports",
      );
      expect(inner.map((n) => n.a11y.name)).toEqual(["report-1", "report-2"]);
    });

    it("treeitem name does NOT include nested treeitem text even without a wrapping role=group", () => {
      // Some APG variants use [aria-level] siblings instead of a nested
      // role="group" — the nested treeitems sit as direct descendants.
      // The treeitem barrier itself handles that case.
      const root = createPage(`
        <div role="tree">
          <div role="treeitem" id="outer">
            Folder
            <div role="treeitem">child</div>
          </div>
        </div>
      `);
      const outer = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.attributes["id"] === "outer",
      )!;
      expect(outer.a11y.name.trim()).toBe("Folder");
    });

    it("menuitem name does NOT include text from a nested role=menu", () => {
      // Submenu pattern: a menuitem opens a submenu mounted as a child.
      // The parent menuitem's announced label should remain just its own.
      const root = createPage(`
        <ul role="menu">
          <li role="menuitem" id="file">
            File
            <ul role="menu">
              <li role="menuitem">Open</li>
              <li role="menuitem">Save</li>
            </ul>
          </li>
        </ul>
      `);
      const file = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.attributes["id"] === "file",
      )!;
      expect(file.a11y.name.trim()).toBe("File");
    });

    it("button name still picks up inline formatting children (strong/em)", () => {
      // Critical regression-guard: the barrier set must NOT include inline
      // text-formatting roles or a perfectly normal <button>Save <strong>
      // changes</strong></button> loses half its label.
      const root = createPage(`
        <button>Save <strong>changes</strong> <em>now</em></button>
      `);
      const btn = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.tagName === "button",
      )!;
      expect(btn.a11y.name.replace(/\s+/g, " ").trim()).toBe(
        "Save changes now",
      );
    });

    it("button name includes a nested button's name (accname §2F — matches Chrome)", () => {
      // Previously we skipped nested named widgets entirely, which left
      // link-wrapped headings nameless. Per accname §2F.iii a descendant
      // widget contributes its computed name — Chrome and Firefox expose
      // "Outer Inner" for this markup, so we do too.
      const root = createPage(`
        <div role="button" id="outer">
          Outer
          <button>Inner</button>
        </div>
      `);
      const outer = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.attributes["id"] === "outer",
      )!;
      expect(outer.a11y.name).toBe("Outer Inner");
    });

    it("tab role with a heading child still picks up the heading text", () => {
      // Heading is intentionally NOT a barrier — a button/tab whose label
      // is a heading (e.g. card headers in custom UIs) should still get
      // the heading's text.
      const root = createPage(`
        <div role="tab" id="t1"><h3>Overview</h3></div>
      `);
      const tab = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.attributes["id"] === "t1",
      )!;
      expect(tab.a11y.name.trim()).toBe("Overview");
    });

    // A heading whose entire content is a link (GitHub file headers,
    // changelog entries, card titles) takes the link's name as its own —
    // accname §2F.iii. Skipping the link left the heading nameless.
    it("heading names itself from a nested link's content", () => {
      const root = createPage(`
        <h3><a href="#diff"><code>website/.vitepress/config.ts</code></a></h3>
      `);
      const heading = [...extractDomTree(root).nodes.values()].find(
        (n) => n.a11y.role === "heading",
      )!;
      expect(heading.a11y.name).toBe("website/.vitepress/config.ts");
    });

    it("heading uses a nested link's aria-label, not its raw text", () => {
      // The child contributes its *computed name* — aria-label wins over
      // content, exactly as the recursive name algorithm prescribes.
      const root = createPage(`
        <h2><a href="/api" aria-label="API reference">docs</a></h2>
      `);
      const heading = [...extractDomTree(root).nodes.values()].find(
        (n) => n.a11y.role === "heading",
      )!;
      expect(heading.a11y.name).toBe("API reference");
    });

    it("text around a nested link joins with single spaces", () => {
      const root = createPage(`
        <h4>Read <a href="/guide">the guide</a> first</h4>
      `);
      const heading = [...extractDomTree(root).nodes.values()].find(
        (n) => n.a11y.role === "heading",
      )!;
      expect(heading.a11y.name).toBe("Read the guide first");
    });

    it("heading excludes an aria-hidden permalink anchor", () => {
      // The docs-tool pattern done right: an aria-hidden anchor inside a
      // heading contributes nothing (§4.3.2 step 2A beats everything).
      const root = createPage(`
        <h2>Install <a href="#install" aria-hidden="true" aria-label='Permalink to "Install"'>#</a></h2>
      `);
      const heading = [...extractDomTree(root).nodes.values()].find(
        (n) => n.a11y.role === "heading",
      )!;
      expect(heading.a11y.name).toBe("Install");
    });
  });

  // React Portal / Vue Teleport / Headless UI mount overlay content
  // (menus, listboxes, tooltips, toasts, modals) into `document.body`
  // — outside the configured root. The extractor pivots scope so the
  // inspector panel reflects the portal content.
  describe("portal-mounted overlays outside root", () => {
    let appRoot: HTMLElement;

    beforeEach(() => {
      document.body.innerHTML = "";
      appRoot = document.createElement("div");
      appRoot.id = "app-root";
      appRoot.innerHTML = "<button>Open menu</button>";
      document.body.appendChild(appRoot);
    });

    function appendOverlay(html: string): Element {
      const portal = document.createElement("div");
      portal.innerHTML = html;
      const overlay = portal.firstElementChild!;
      document.body.appendChild(portal);
      return overlay;
    }

    it("scopes to body when a [role='menu'] is portal-mounted outside root", () => {
      appendOverlay(`
        <div role="menu">
          <div role="menuitem">Edit profile</div>
          <div role="menuitem">Sign out</div>
        </div>
      `);

      const tree = extractDomTree(appRoot);
      const allNodes = [...tree.nodes.values()];
      // The menu (outside appRoot) is included alongside the trigger.
      expect(allNodes.some((n) => n.a11y.role === "menu")).toBe(true);
      expect(
        allNodes.some(
          (n) => n.a11y.role === "menuitem" && n.a11y.name === "Edit profile",
        ),
      ).toBe(true);
    });

    it("scopes to body when a [role='listbox'] popover is portal-mounted", () => {
      appendOverlay(`
        <div role="listbox">
          <div role="option">One</div>
          <div role="option">Two</div>
        </div>
      `);

      const tree = extractDomTree(appRoot);
      const allNodes = [...tree.nodes.values()];
      expect(allNodes.some((n) => n.a11y.role === "listbox")).toBe(true);
    });

    it("scopes to body when a [role='status'] toast appears outside root", () => {
      appendOverlay(`
        <div role="status">Saved successfully</div>
      `);

      const tree = extractDomTree(appRoot);
      const allNodes = [...tree.nodes.values()];
      expect(allNodes.some((n) => n.a11y.role === "status")).toBe(true);
    });

    it("active modal still wins over portal overlay (modal scope is exclusive)", () => {
      // Both a modal AND a separate menu/toast outside root.
      appendOverlay(`
        <div role="dialog" aria-modal="true">
          <p>Are you sure?</p>
          <button>OK</button>
        </div>
      `);
      appendOverlay(`<div role="status">Pending…</div>`);

      const tree = extractDomTree(appRoot);
      const allNodes = [...tree.nodes.values()];
      // Modal scope is exclusive: dialog yes, status no.
      expect(allNodes.some((n) => n.a11y.role === "dialog")).toBe(true);
      expect(allNodes.some((n) => n.a11y.role === "status")).toBe(false);
    });

    it("pivots exclusively to a MODAL role='dialog' (aria-modal, as Radix/Headless/MUI set)", () => {
      // Real modal dialogs (Radix Dialog, Headless UI, MUI, the APG pattern)
      // set aria-modal="true". AT scopes exclusively to a modal, so we pivot:
      // the dialog appears and the page behind it is dropped.
      appendOverlay(`
        <div role="dialog" aria-modal="true" aria-labelledby="t">
          <h2 id="t">Confirm deletion</h2>
          <p>This action cannot be undone.</p>
          <button>Close</button>
        </div>
      `);

      const tree = extractDomTree(appRoot);
      const allNodes = [...tree.nodes.values()];
      expect(allNodes.some((n) => n.a11y.role === "dialog")).toBe(true);
      expect(
        allNodes.some(
          (n) => n.a11y.role === "button" && n.a11y.name === "Close",
        ),
      ).toBe(true);
      // Modal scope is exclusive — the appRoot "Open menu" trigger is dropped.
      expect(allNodes.some((n) => n.a11y.name === "Open menu")).toBe(false);
    });

    it("does NOT hijack scope for a non-modal role='dialog' (cookie banner / Radix Popover)", () => {
      // A cookie-consent banner and a Radix Popover both render role="dialog"
      // with NO aria-modal and leave the page interactive. Treating them as
      // modal used to collapse the whole page down to just the banner. Now
      // they are additive: the page stays AND the dialog joins the tree.
      appendOverlay(`
        <div role="dialog" aria-labelledby="c">
          <h2 id="c">We use cookies</h2>
          <button>Accept</button>
        </div>
      `);

      const tree = extractDomTree(appRoot);
      const allNodes = [...tree.nodes.values()];
      // Page content is preserved — NOT hijacked.
      expect(allNodes.some((n) => n.a11y.name === "Open menu")).toBe(true);
      // The non-modal dialog is still shown (additive via the portal path).
      expect(
        allNodes.some(
          (n) => n.a11y.role === "button" && n.a11y.name === "Accept",
        ),
      ).toBe(true);
    });

    it("stays scoped to root when no portal overlay is present", () => {
      const tree = extractDomTree(appRoot);
      const rootNode = tree.nodes.get(tree.rootId)!;
      // Without portals, the root is appRoot itself, not body.
      expect(rootNode.dom.attributes["id"]).toBe("app-root");
    });

    it("ignores hidden portal overlays (no pivot)", () => {
      const overlay = appendOverlay(`
        <div role="menu" style="display: none">
          <div role="menuitem">Should not appear</div>
        </div>
      `);
      // Confirm jsdom respects the style
      expect((overlay as HTMLElement).style.display).toBe("none");

      const tree = extractDomTree(appRoot);
      const rootNode = tree.nodes.get(tree.rootId)!;
      // Hidden overlay shouldn't trigger the pivot.
      expect(rootNode.dom.attributes["id"]).toBe("app-root");
    });

    afterEach(() => {
      document.body.innerHTML = "";
    });
  });
});

describe("accessible-name cycle safety (accname visit-once)", () => {
  // Since PR #101, name-from-content recurses into named-widget descendants
  // (getAccessibleTextContent -> computeAccessibleName), and
  // computeRawAccessibleName resolves aria-labelledby by walking the target's
  // content. With no visited guard those two call each other forever when a
  // widget's aria-labelledby points at an ancestor that contains it —
  // "Maximum call stack size exceeded", which threw out of extractA11yTree and
  // froze the panel on a real page (mercadolibre.com.mx signup).
  //
  // The elements MUST be attached to the document: aria-labelledby resolves via
  // document.getElementById, which only sees attached subtrees. A detached
  // fixture (createPage) can't reproduce it.
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    host.remove();
  });

  it("does not overflow when a named widget's aria-labelledby points at its container", () => {
    host.innerHTML = `<div id="outer" role="button">Outer <a href="#" aria-labelledby="outer">Inner</a></div>`;
    let name: string | undefined;
    expect(() => {
      const outer = [...extractDomTree(host).nodes.values()].find(
        (n) => n.dom.attributes["id"] === "outer",
      )!;
      name = outer.a11y.name;
    }).not.toThrow();
    // Cycle broken: a re-entered element contributes "", so the name resolves
    // to finite content rather than recursing forever.
    expect(name).toBeTruthy();
    expect(name!.length).toBeLessThan(200);
  });

  it("does not overflow via the full extractA11yTree pipeline", () => {
    host.innerHTML = `<div id="o" role="button"><a href="#" aria-labelledby="o">x</a></div>`;
    expect(() => extractA11yTree(host)).not.toThrow();
  });

  it("does not overflow on a self-referential aria-labelledby", () => {
    host.innerHTML = `<button id="self" aria-labelledby="self">Go</button>`;
    expect(() => extractDomTree(host)).not.toThrow();
  });
});

describe("isSensitiveField", () => {
  const el = (html: string): Element => {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.firstElementChild!;
  };

  it("flags password inputs", () => {
    expect(isSensitiveField(el(`<input type="password">`))).toBe(true);
  });

  it("flags credential and payment autocomplete tokens", () => {
    expect(
      isSensitiveField(el(`<input autocomplete="current-password">`)),
    ).toBe(true);
    expect(isSensitiveField(el(`<input autocomplete="one-time-code">`))).toBe(
      true,
    );
    expect(isSensitiveField(el(`<input autocomplete="cc-number">`))).toBe(true);
    // autocomplete may carry section/shipping tokens before the field name
    expect(
      isSensitiveField(el(`<input autocomplete="section-a billing cc-csc">`)),
    ).toBe(true);
    expect(
      isSensitiveField(el(`<select autocomplete="cc-exp-month"></select>`)),
    ).toBe(true);
  });

  it("does not flag ordinary text fields", () => {
    expect(isSensitiveField(el(`<input type="text">`))).toBe(false);
    expect(
      isSensitiveField(el(`<input type="email" autocomplete="email">`)),
    ).toBe(false);
    expect(isSensitiveField(el(`<textarea></textarea>`))).toBe(false);
    expect(isSensitiveField(el(`<div>not a field</div>`))).toBe(false);
  });
});

describe("sensitive value redaction", () => {
  const firstChild = (root: Element) => {
    const { nodes, rootId } = extractDomTree(root);
    return nodes.get(nodes.get(rootId)!.childIds[0])!;
  };

  it("redacts a password field's value in the extracted tree", () => {
    const node = firstChild(
      createPage(`<input type="password" value="hunter2">`),
    );
    expect(node.dom.attributes["value"]).toBe("[redacted]");
    expect(JSON.stringify(node)).not.toContain("hunter2");
  });

  it("redacts a credit-card field's value by autocomplete token", () => {
    const node = firstChild(
      createPage(`<input autocomplete="cc-number" value="4111111111111111">`),
    );
    expect(node.dom.attributes["value"]).toBe("[redacted]");
    expect(JSON.stringify(node)).not.toContain("4111111111111111");
  });

  it("preserves ordinary text-input values", () => {
    const node = firstChild(
      createPage(`<input type="text" value="Ada Lovelace">`),
    );
    expect(node.dom.attributes["value"]).toBe("Ada Lovelace");
  });

  it("never uses a sensitive value as the accessible name", () => {
    // Unlabeled password with a typed value: the name must not leak it.
    const bare = firstChild(
      createPage(`<input type="password" value="hunter2">`),
    );
    expect(bare.a11y.name).not.toContain("hunter2");
    expect(bare.a11y.name).not.toBe("[redacted]");

    // With a placeholder, the name falls back to the placeholder, not the value.
    const withPlaceholder = firstChild(
      createPage(
        `<input type="password" placeholder="Password" value="hunter2">`,
      ),
    );
    expect(withPlaceholder.a11y.name).toBe("Password");
    expect(JSON.stringify(withPlaceholder)).not.toContain("hunter2");
  });
});

describe("input accessible name (HTML-AAM)", () => {
  const nameOf = (html: string) => {
    const root = createPage(html);
    const input = [...extractDomTree(root).nodes.values()].find(
      (n) => n.dom.tagName === "input",
    )!;
    return input.a11y.name;
  };

  it("does not use an unlabeled text input's value as its name", () => {
    // The typed value is the user's DATA. Echoing it as the name makes an
    // unlabeled field look labelled, so the testing package would pass a
    // control that real AT announces as unlabeled.
    expect(nameOf('<input type="text" value="John Doe">')).toBe("");
  });

  it('does not give an unlabeled checkbox/radio the default value "on"', () => {
    // A bare checkbox has DOM value "on"; that must not become its name.
    expect(nameOf('<input type="checkbox">')).toBe("");
    expect(nameOf('<input type="radio">')).toBe("");
  });

  it("uses value as the name for button-like inputs (submit/reset/button)", () => {
    expect(nameOf('<input type="submit" value="Send">')).toBe("Send");
    expect(nameOf('<input type="reset" value="Clear">')).toBe("Clear");
    expect(nameOf('<input type="button" value="Go">')).toBe("Go");
  });

  it("orders title before placeholder", () => {
    expect(
      nameOf('<input type="text" title="Your email" placeholder="you@x.com">'),
    ).toBe("Your email");
  });

  it("falls back to placeholder when there is no label or title", () => {
    expect(nameOf('<input type="text" placeholder="Search">')).toBe("Search");
  });

  it("still prefers an associated label over placeholder", () => {
    document.body.innerHTML =
      '<label for="e">Email</label>' +
      '<input id="e" type="text" value="typed" placeholder="you@x.com">';
    try {
      const input = [...extractDomTree(document.body).nodes.values()].find(
        (n) => n.dom.tagName === "input",
      )!;
      expect(input.a11y.name).toBe("Email");
    } finally {
      document.body.innerHTML = "";
    }
  });
});

// Media elements (<video>/<audio>) mirror Chromium's native tree: real
// "video"/"audio" roles, leaf nodes (fallback children + <track>/<source>
// metadata are never exposed), a hoisted `captions` property carrying the
// WCAG 1.2.2 signal from the skipped <track> children, and focusability
// when native controls are present.
describe("media elements (video/audio)", () => {
  function mediaNode(html: string, tagName: string) {
    const root = createPage(html);
    return [...extractDomTree(root).nodes.values()].find(
      (n) => n.dom.tagName === tagName,
    )!;
  }

  it("exposes role=video with the aria-label as accessible name", () => {
    const node = mediaNode(
      `<video controls aria-label="Product tour" src="x.mp4"></video>`,
      "video",
    );
    expect(node.a11y.role).toBe("video");
    expect(node.a11y.name).toBe("Product tour");
  });

  it("exposes role=audio", () => {
    const node = mediaNode(
      `<audio controls aria-label="Podcast episode" src="x.mp3"></audio>`,
      "audio",
    );
    expect(node.a11y.role).toBe("audio");
    expect(node.a11y.name).toBe("Podcast episode");
  });

  it("is a leaf: track/source/fallback children never become nodes", () => {
    const root = createPage(`
      <video controls src="x.mp4">
        <track kind="captions" src="c.vtt" srclang="en" label="EN" default>
        <source src="x.webm" type="video/webm">
        <a href="/download">Download the video instead</a>
      </video>
    `);
    const { nodes } = extractDomTree(root);
    const tags = [...nodes.values()].map((n) => n.dom.tagName);
    expect(tags).toContain("video");
    expect(tags).not.toContain("track");
    expect(tags).not.toContain("source");
    // Fallback link is unrendered content — must not leak into the tree.
    expect(tags).not.toContain("a");

    const video = [...nodes.values()].find((n) => n.dom.tagName === "video")!;
    expect(video.childIds).toEqual([]);
  });

  it("does not take its accessible name or text preview from fallback content", () => {
    const node = mediaNode(
      `<video src="x.mp4">Sorry, your browser doesn't support embedded video.</video>`,
      "video",
    );
    // Chromium exposes an unlabeled <video> with an empty name.
    expect(node.a11y.name).toBe("");
    expect(node.dom.textContent).toBe("");
    expect(node.dom.descendantText).toBe("");
  });

  it("hoists the captions signal onto the media node (WCAG 1.2.2)", () => {
    const withCaptions = mediaNode(
      `<video src="x.mp4"><track kind="captions" src="c.vtt"></video>`,
      "video",
    );
    expect(withCaptions.a11y.properties["captions"]).toBe("true");

    const withSubtitles = mediaNode(
      `<video src="x.mp4"><track kind="subtitles" src="s.vtt"></video>`,
      "video",
    );
    expect(withSubtitles.a11y.properties["captions"]).toBe("true");

    const without = mediaNode(`<video src="x.mp4"></video>`, "video");
    expect(without.a11y.properties["captions"]).toBe("false");

    // A chapters/metadata track is NOT a caption alternative.
    const chaptersOnly = mediaNode(
      `<video src="x.mp4"><track kind="chapters" src="ch.vtt"></video>`,
      "video",
    );
    expect(chaptersOnly.a11y.properties["captions"]).toBe("false");
  });

  it("normalizes track kind the way browsers do (missing → subtitles, case-insensitive, invalid → metadata)", () => {
    // Verified against Chromium's HTMLTrackElement.kind normalization.
    // A kind-less track defaults to the subtitles state — it IS a text
    // alternative and must count.
    const kindless = mediaNode(
      `<video src="x.mp4"><track src="en.vtt" srclang="en" label="English"></video>`,
      "video",
    );
    expect(kindless.a11y.properties["captions"]).toBe("true");

    // The kind attribute is ASCII case-insensitive: "Captions" is valid.
    const mixedCase = mediaNode(
      `<video src="x.mp4"><track kind="Captions" src="c.vtt"></video>`,
      "video",
    );
    expect(mixedCase.a11y.properties["captions"]).toBe("true");

    // The INVALID value default is "metadata" (unlike the missing value
    // default) — a bogus kind is not a caption alternative.
    const bogusKind = mediaNode(
      `<video src="x.mp4"><track kind="bogus" src="b.vtt"></video>`,
      "video",
    );
    expect(bogusKind.a11y.properties["captions"]).toBe("false");
  });

  it("non-media nodes do not carry a captions property", () => {
    const node = mediaNode(`<div>plain</div>`, "div");
    expect("captions" in node.a11y.properties).toBe(false);
  });

  it("is focusable (with a focus action) only when native controls are present", () => {
    const withControls = mediaNode(
      `<video controls src="x.mp4"></video>`,
      "video",
    );
    expect(withControls.interaction.isFocusable).toBe(true);
    expect(withControls.interaction.actions).toContain("focus");

    const withoutControls = mediaNode(`<video src="x.mp4"></video>`, "video");
    expect(withoutControls.interaction.isFocusable).toBe(false);
    expect(withoutControls.interaction.actions).toEqual([]);
  });

  it("surfaces media attributes (controls/autoplay/muted/loop) for the panel", () => {
    const node = mediaNode(
      `<video controls autoplay muted loop src="x.mp4"></video>`,
      "video",
    );
    expect(node.dom.attributes["controls"]).toBe("");
    expect(node.dom.attributes["autoplay"]).toBe("");
    expect(node.dom.attributes["muted"]).toBe("");
    expect(node.dom.attributes["loop"]).toBe("");
  });

  it("does not leak media fallback text into a wrapping container's preview", () => {
    // Devin regression: the media node itself is a clean leaf, but an
    // ancestor kept for a role/name (here <figure>) computed its
    // descendantText from raw textContent, which recursively included the
    // unrendered <video> fallback string.
    const root = createPage(`
      <figure>
        <video src="x.mp4">Sorry, your browser doesn't support embedded video.</video>
        <figcaption>Product tour</figcaption>
      </figure>
    `);
    const figure = [...extractDomTree(root).nodes.values()].find(
      (n) => n.dom.tagName === "figure",
    )!;
    expect(figure.dom.descendantText).toBe("Product tour");
    expect(figure.dom.descendantText).not.toContain("Sorry");
  });

  it("still collects non-media descendant text around a pruned media element", () => {
    const root = createPage(`
      <div>
        Before
        <audio src="a.mp3">audio fallback noise</audio>
        After
      </div>
    `);
    const div = [...extractDomTree(root).nodes.values()].find(
      (n) => n.dom.tagName === "div" && n.parentId !== null,
    )!;
    expect(div.dom.descendantText).toBe("Before After");
    expect(div.dom.descendantText).not.toContain("fallback");
  });

  it("skips <source> inside <picture> too, keeping the <img>", () => {
    const root = createPage(`
      <picture>
        <source srcset="a.webp" type="image/webp">
        <img src="a.jpg" alt="A flower">
      </picture>
    `);
    const tags = [...extractDomTree(root).nodes.values()].map(
      (n) => n.dom.tagName,
    );
    expect(tags).not.toContain("source");
    expect(tags).toContain("img");
  });
});

describe("computed-style cache during extraction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls getComputedStyle at most once per element during extractDomTree", () => {
    // Regression: buildNode used to hit getComputedStyle up to 5 times per
    // kept element (subtree-hidden, visually-hidden, visibility, sr-only,
    // isHiddenFromAT). A per-extraction WeakMap shares one CSSStyleDeclaration.
    const root = createPage(`
      <main>
        <h1>Title</h1>
        <p>Hello <strong>world</strong></p>
        <button type="button">Go</button>
        <div style="display:none"><span>Hidden</span></div>
      </main>
    `);
    document.body.appendChild(root);

    const counts = new Map<Element, number>();
    const original = window.getComputedStyle.bind(window);
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((elt: Element, pseudoElt?: string | null) => {
        const el = elt as Element;
        counts.set(el, (counts.get(el) ?? 0) + 1);
        return original(el, pseudoElt);
      });

    try {
      extractDomTree(root);
      // Every element that had style resolved must have been resolved once.
      for (const [, n] of counts) {
        expect(n).toBeLessThanOrEqual(1);
      }
      // Sanity: we did resolve style for real (not a no-op spy).
      expect(counts.size).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
      root.remove();
    }
  });
});
