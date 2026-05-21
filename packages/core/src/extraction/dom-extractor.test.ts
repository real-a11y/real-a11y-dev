import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { resetIdCounter } from "../utils/id-generator.js";

import { extractDomTree } from "./dom-extractor.js";

beforeEach(() => {
  resetIdCounter();
});

function createPage(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

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
    // View example. We now skip subtrees whose computed role is a "name
    // barrier" (group, list, treeitem, button, link, …) when walking text.
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
        (n) => n.a11y.role === "treeitem" && n.dom.attributes["id"] !== "reports",
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

    it("button name skips a nested button (invalid HTML but possible in custom components)", () => {
      const root = createPage(`
        <div role="button" id="outer">
          Outer
          <button>Inner</button>
        </div>
      `);
      const outer = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom.attributes["id"] === "outer",
      )!;
      expect(outer.a11y.name.trim()).toBe("Outer");
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

    it("pivots to [role='dialog'] without aria-modal (Radix Dialog ≥1.1)", () => {
      // Radix Dialog 1.1+ and several modern libs (Headless UI, Reach UI)
      // omit aria-modal — they enforce modality via sibling-aria-hidden +
      // focus trap instead. The extractor must still recognise a visible
      // role="dialog" as the modal scope, otherwise pivot silently fails
      // and the panel shows page chrome instead of the dialog content.
      appendOverlay(`
        <div role="dialog" aria-labelledby="t">
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
      // Modal scope is exclusive — the original "Open menu" trigger inside
      // appRoot must NOT appear when the dialog is the effective root.
      expect(allNodes.some((n) => n.a11y.name === "Open menu")).toBe(false);
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
