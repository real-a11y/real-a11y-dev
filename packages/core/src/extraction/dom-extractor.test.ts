import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getTabSequence } from "../query/tab-sequence.js";
import { clobber, shadow } from "../test-support/clobber.js";
import type { SemanticNode } from "../types.js";
import { resetIdCounter } from "../utils/id-generator.js";

import { extractA11yTree } from "./a11y-extractor.js";
import * as clobberSafe from "./clobber-safe.js";
import {
  extractDomTree,
  fieldValueOwner,
  getDescendantText,
  getElementRefs,
  htmlAamNameOwner,
  isNameBarrierElement,
  isNameFromContentHost,
  isSensitiveField,
  isSensitiveFieldAttributes,
  SENSITIVE_AUTOCOMPLETE_TOKENS,
} from "./dom-extractor.js";
import { idScope } from "./flat-tree.js";

beforeEach(() => {
  resetIdCounter();
});

/**
 * jsdom has no `showModal()`, and `:modal` never matches there — so open a
 * `<dialog>` as a browser modal by answering `:modal` for it alone.
 */
function fakeShowModal(dialog: Element): void {
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, "matches").mockImplementation(function (
    this: Element,
    selector: string,
  ) {
    return selector === ":modal"
      ? this === dialog
      : matches.call(this, selector);
  });
  dialog.setAttribute("open", "");
}

/**
 * jsdom has no `showPopover()`, and `:popover-open` never matches there — so
 * show these popovers by answering `:popover-open` for them alone. jsdom still
 * styles each one `display: none`, so a test that needs one's content in the
 * tree renders it with an inline style.
 */
function fakeShowPopovers(...popovers: Element[]): void {
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, "matches").mockImplementation(function (
    this: Element,
    selector: string,
  ) {
    return selector === ":popover-open"
      ? popovers.includes(this)
      : matches.call(this, selector);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
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

  describe("a <form> field that shadows `parentElement`", () => {
    // A real browser returns the field for `form.parentElement`, and the
    // field's own parent is the form again. Deciding whether a link or an
    // editor is inside editable content climbs the ancestors, and a plain climb
    // cycles between the two forever: the page freezes, and no error boundary
    // can catch a loop.
    function clobberParentElement(root: Element): void {
      const form = root.querySelector("form")!;
      Object.defineProperty(form, "parentElement", {
        configurable: true,
        get: () => form.querySelector('[name="parentElement"]'),
      });
    }
    const byName = (root: Element, name: string) =>
      [...extractDomTree(root).nodes.values()].find(
        (n) => n.a11y.name === name,
      );

    it("keeps a link inside the form live and an editor inside it focusable", () => {
      const root = createPage(`
        <main>
          <form aria-label="Compose">
            <input name="parentElement" aria-label="Subject" />
            <div contenteditable="true" role="textbox" aria-label="Body">Hi</div>
            <a href="/help">Help</a>
          </form>
        </main>
      `);
      clobberParentElement(root);

      expect(byName(root, "Help")?.interaction?.actions).toEqual(
        expect.arrayContaining(["click", "navigate"]),
      );
      expect(byName(root, "Body")?.interaction?.isFocusable).toBe(true);
    });

    it("reads the form's real parent, so an editable form is an editing host", () => {
      // Read through the field, the form's "parent" is editable — the form
      // itself — so the form looked like an editor's inner element rather
      // than the host that takes focus.
      const root = createPage(`
        <main>
          <form contenteditable="true" aria-label="Note">
            <input name="parentElement" aria-label="Title" />
          </form>
        </main>
      `);
      clobberParentElement(root);

      expect(byName(root, "Note")?.interaction?.isFocusable).toBe(true);
    });

    it("checks a portal's visibility up through the form", () => {
      // Without `checkVisibility()` (jsdom, and older browsers) the check
      // walks the ancestors itself. The portal pivots extraction to <body>, so
      // use a throwaway one: `resetIdCounter()` keeps the node→id map, and a
      // shared <body> that kept this test's id would collide with a node a
      // later test mints.
      const original = document.body;
      const body = document.createElement("body");
      body.innerHTML = `
        <div id="app"><button>Checkout</button></div>
        <form>
          <input type="hidden" name="parentElement" />
          <div role="dialog" aria-label="Cookies"><button>Accept</button></div>
        </form>
      `;
      document.documentElement.replaceChild(body, original);
      try {
        clobberParentElement(body);
        const app = document.getElementById("app")!;
        // The visible portal widens the scope to body, as outside a form.
        expect(byName(app, "Cookies")).toBeTruthy();
        expect(byName(app, "Checkout")).toBeTruthy();
      } finally {
        document.documentElement.replaceChild(original, body);
      }
    });
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

  // The boundary above is what a shadowed `tagName` costs the form itself.
  // Nothing around the form should pay for it — yet these reads land on the
  // form while ANOTHER element is being built, so a throw there was charged
  // to that element: an ancestor whose name walk entered the form, or a
  // descendant whose role or state climbed through it.
  describe("around a form whose control shadows `tagName`", () => {
    /** Forced: jsdom doesn't shadow a form's own members. */
    function shadowEveryForm(root: Element): void {
      for (const form of root.querySelectorAll("form")) shadow(form, "tagName");
    }

    const TAG_FIELD = `<input name="tagName" aria-label="Tag name" />`;

    beforeEach(() => {
      // The walk warns about each form it skips.
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("keeps a host whose name walk passes through the form", () => {
      const root = createPage(`
        <main>
          <h2>Orders <form>${TAG_FIELD}</form></h2>
          <table>
            <tr><th>Order</th><th>Actions</th></tr>
            <tr><td>#1001</td><td>Ready <form>${TAG_FIELD}</form></td></tr>
          </table>
          <h3>Labels <form role="button">${TAG_FIELD}Edit</form></h3>
          <label>Owner <form>${TAG_FIELD}</form><input /></label>
        </main>
      `);
      shadowEveryForm(root);

      const nodes = [...extractDomTree(root).nodes.values()];
      const named = (role: string) =>
        nodes.filter((n) => n.a11y.role === role).map((n) => n.a11y.name);
      expect(named("heading")).toEqual(["Orders", "Labels Edit"]);
      expect(named("cell")).toEqual(["#1001", "Ready"]);
      expect(named("textbox")).toContain("Owner");
    });

    it("keeps the help text the form sits in, and the link beside it", () => {
      const root = createPage(`
        <main>
          <input aria-label="Password" aria-describedby="help" />
          <div id="help">
            <form>${TAG_FIELD}</form>
            <a href="/rules">Full rules</a>
          </div>
        </main>
      `);
      shadowEveryForm(root);

      const names = [...extractDomTree(root).nodes.values()].map(
        (n) => n.a11y.name,
      );
      expect(names).toContain("Full rules");
    });

    // The walk skips the form, its field with it, so the field reaches no one.
    // Help text holding nothing else is then text-only, and shows once, as the
    // input's description, rather than also as a node of its own.
    it("folds help text whose only control is in the form", () => {
      const root = createPage(`
        <main>
          <input aria-label="Password" aria-describedby="help" />
          <div id="help">Must be 8+ chars. <form>${TAG_FIELD}</form></div>
        </main>
      `);
      shadowEveryForm(root);
      // In the document, so `aria-describedby` resolves.
      document.body.appendChild(root);

      try {
        const nodes = [...extractDomTree(root).nodes.values()];
        expect(nodes.some((n) => n.dom?.attributes?.id === "help")).toBe(false);
        const password = nodes.find((n) => n.a11y.name === "Password")!;
        expect(password.a11y.description).toBe("Must be 8+ chars.");
      } finally {
        root.remove();
      }
    });

    it("keeps what an extraction rooted inside the form holds", () => {
      const root = createPage(`
        <form>
          ${TAG_FIELD}
          <div id="scope">
            <header>Filters</header>
            <button>Apply</button>
          </div>
        </form>
      `);
      shadowEveryForm(root);

      const nodes = [
        ...extractDomTree(root.querySelector("#scope")!).nodes.values(),
      ];
      // A header outside any sectioning element is a banner; a button nothing
      // disables is enabled.
      expect(nodes.map((n) => n.a11y.role)).toContain("banner");
      const apply = nodes.find((n) => n.a11y.name === "Apply")!;
      expect(apply.a11y.states?.["disabled"]).toBeUndefined();
    });

    it("keeps an option whose parent is the form", () => {
      const root = createPage(
        `<form>${TAG_FIELD}<option>Small</option></form>`,
      );
      shadowEveryForm(root);

      const result = extractDomTree(root.querySelector("option")!);
      const option = result.nodes.get(result.rootId)!;
      expect(option.a11y.role).toBe("option");
      expect(option.a11y.states?.["disabled"]).toBeUndefined();
    });

    it("keeps a summary whose parent is the form", () => {
      const root = createPage(
        `<form>${TAG_FIELD}<summary>More</summary></form>`,
      );
      shadowEveryForm(root);

      const result = extractDomTree(root.querySelector("summary")!);
      const summary = result.nodes.get(result.rootId)!;
      expect(summary.a11y.name).toBe("More");
      // Not a details' summary, so it discloses nothing.
      expect(summary.a11y.states?.["expanded"]).toBeUndefined();
    });

    it("answers the live climb's questions about the form", () => {
      const root = createPage(`
        <form>${TAG_FIELD}<legend>Search</legend><span>Hint</span></form>
      `);
      shadowEveryForm(root);
      const form = root.querySelector("form")!;

      expect(htmlAamNameOwner(form)).toBeNull();
      // A legend names a fieldset, and its parent here is a form.
      expect(htmlAamNameOwner(root.querySelector("legend")!)).toBeNull();
      expect(isNameFromContentHost(form)).toBe(false);
      expect(isNameBarrierElement(form)).toBe(false);
      expect(fieldValueOwner(root.querySelector("span")!)).toBeNull();
      // A barrier role is where a native <details> is told apart by its tag.
      form.setAttribute("role", "group");
      expect(isNameBarrierElement(form)).toBe(true);
    });
  });
});

// A <form> lets a control named after one of its members shadow it, and that
// includes methods: with `<input name="getRootNode">`, `form.getRootNode()`
// throws, because the input is not a function. Finding the tree an IDREF
// resolves in must still work for such a form, or the per-element boundary
// drops it with everything inside it.
describe("tree scope of a clobbered <form>", () => {
  let page: HTMLElement;

  beforeEach(() => {
    page = document.createElement("div");
    document.body.appendChild(page);
  });

  afterEach(() => {
    page.remove();
  });

  const nodeNamed = (
    root: Element,
    role: string,
    name: string,
  ): SemanticNode | undefined =>
    [...extractDomTree(root).nodes.values()].find(
      (n) => n.a11y.role === role && n.a11y.name === name,
    );

  it("resolves the scope of a form in a shadow root", () => {
    const host = document.createElement("x-checkout");
    page.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<form aria-label="Pay"><input type="hidden" name="getRootNode"></form>`;
    const form = root.querySelector("form")!;
    clobber(form, "getRootNode");
    expect(idScope(form)).toBe(root);
  });

  it("names a form labelled by a heading", () => {
    page.innerHTML = `
      <h2 id="pay-title">Payment</h2>
      <form aria-labelledby="pay-title">
        <input type="hidden" name="getRootNode">
        <button>Pay</button>
      </form>`;
    clobber(page.querySelector("form")!, "getRootNode");
    expect(nodeNamed(page, "form", "Payment")).toBeTruthy();
    expect(nodeNamed(page, "button", "Pay")).toBeTruthy();
  });

  it("keeps a description target that is itself such a form", () => {
    page.innerHTML = `
      <input aria-label="Email" aria-describedby="terms">
      <form id="terms">
        <input type="hidden" name="getRootNode">
        We never share it. <button>Read the terms</button>
      </form>`;
    clobber(page.querySelector("form")!, "getRootNode");
    // Its button keeps it in the tree: folding it would lose a control.
    expect(nodeNamed(page, "button", "Read the terms")).toBeTruthy();
  });

  it("folds a description whose referrer sits in a form with a control named parentElement", () => {
    page.innerHTML = `
      <form aria-label="Pay">
        <input type="hidden" name="parentElement">
        <input aria-label="Code" aria-describedby="hint">
      </form>
      <p id="hint">Six digits</p>`;
    clobber(page.querySelector("form")!, "parentElement");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nodes = [...extractDomTree(page).nodes.values()];
    expect(nodes.find((n) => n.a11y.name === "Code")?.a11y.description).toBe(
      "Six digits",
    );
    expect(nodes.some((n) => n.a11y.role === "paragraph")).toBe(false);
    // Folded because the referrer was found rendered, not skipped because
    // a walk up from it threw.
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("a shadowed method on something every element shares", () => {
  // `Document` has [LegacyOverrideBuiltIns] too: a named `<img>`, `<form>`,
  // `<embed>` or `<object>` shadows the document member of that name, so
  // `<img name="getElementById">` makes `document.getElementById` the image. A
  // `<form>` whose control does the same may lose itself — the per-element
  // boundary skips it — but a read on something every element depends on (the
  // document the id lookups run against, the overlay scan, the extraction
  // root) took the rest of the page with it, silently or all at once.
  const shadowed: string[] = [];
  const clobberDocument = (prop: string): void => {
    clobber(document, prop);
    shadowed.push(prop);
  };
  afterEach(() => {
    for (const prop of shadowed.splice(0)) {
      delete (document as unknown as Record<string, unknown>)[prop];
    }
    document.body.innerHTML = "";
  });

  const attach = (html: string): Element => {
    document.body.innerHTML = html;
    return document.body.firstElementChild!;
  };
  const nodes = (root: Element) => [...extractA11yTree(root).nodes.values()];
  const named = (root: Element, role: string) =>
    nodes(root).find((n) => n.a11y.role === role)?.a11y;

  it("names and describes through the id scope when the document's getElementById is shadowed", () => {
    // Every aria-labelledby / -describedby element on the page was dropped.
    const root = attach(`
      <main>
        <img name="getElementById" alt="" />
        <span id="lbl">Save</span>
        <span id="hint">Saves the draft</span>
        <button aria-labelledby="lbl" aria-describedby="hint">x</button>
      </main>
    `);
    clobberDocument("getElementById");

    expect(named(root, "button")).toMatchObject({
      name: "Save",
      description: "Saves the draft",
    });
  });

  it("finds a control's <label for> when the document's querySelector is shadowed", () => {
    // Every control with an id was dropped.
    const root = attach(`
      <main>
        <img name="querySelector" alt="" />
        <label for="email">Email</label>
        <input id="email" />
      </main>
    `);
    clobberDocument("querySelector");

    expect(named(root, "textbox")?.name).toBe("Email");
  });

  it("extracts at all when the document's querySelectorAll is shadowed", () => {
    // The modal and overlay scans threw before the walk began.
    const root = attach(`
      <main><img name="querySelectorAll" alt="" /><button>Go</button></main>
    `);
    clobberDocument("querySelectorAll");

    expect(named(root, "button")?.name).toBe("Go");
  });

  it("keeps an image map's areas when the document's querySelectorAll is shadowed", () => {
    // An area looks its image up among the document's images, and a shadowed
    // search threw, which lost the area and its stop.
    const root = attach(`
      <main>
        <img name="querySelectorAll" alt="" />
        <img src="x.gif" alt="Site map" usemap="#nav" />
        <map name="nav"><area href="/home" alt="Home" /></map>
      </main>
    `);
    clobberDocument("querySelectorAll");

    expect(
      getTabSequence(extractA11yTree(root)).map((n) => n.a11y.name),
    ).toEqual(["Home"]);
  });

  it("keeps an image map's areas when a form around the image shadows getAttribute", () => {
    // Whether an area is hidden from AT reads aria-hidden up its image's
    // ancestors, and a form among them answered with its control instead.
    const root = attach(`
      <main>
        <form>
          <input name="getAttribute" aria-label="Query" />
          <img src="x.gif" alt="Site map" usemap="#nav" />
        </form>
        <map name="nav"><area href="/home" alt="Home" /></map>
      </main>
    `);
    clobber(document.querySelector("form")!, "getAttribute");

    expect(
      nodes(root).find((n) => n.a11y.name === "Home")?.a11y.isExposedToAT,
    ).toBe(true);
  });

  it("keeps a description target that also labels a control when the document's querySelectorAll is shadowed", () => {
    // Folding a description target away searches its tree for referrers. A
    // shadowed search read as "described and not labelled", so this visible
    // span went missing although it names the button.
    const root = attach(`
      <main>
        <img name="querySelectorAll" alt="" />
        <span id="hint">Save</span>
        <button aria-labelledby="hint" aria-describedby="hint">x</button>
      </main>
    `);
    clobberDocument("querySelectorAll");

    const ids = [...extractDomTree(root).nodes.values()].map(
      (n) => n.dom?.attributes?.id,
    );
    expect(ids).toContain("hint");
  });

  it("scopes to an open modal when the document's contains is shadowed", () => {
    const root = attach(`
      <main><img name="contains" alt="" /><button>Behind</button></main>
    `);
    const dialog = document.createElement("dialog");
    dialog.innerHTML = "<button>In dialog</button>";
    document.body.append(dialog);
    fakeShowModal(dialog);
    clobberDocument("contains");

    const names = nodes(root).map((n) => n.a11y.name);
    expect(names).toContain("In dialog");
    expect(names).not.toContain("Behind");
  });

  it("skips an overlay candidate it cannot read, and still pivots for the next", () => {
    // `<form role="search">` is an overlay-scan candidate like any [role]
    // element; one whose control shadows `getAttribute` threw out of the scan.
    document.body.innerHTML = `
      <form role="search"><input name="getAttribute" aria-label="Query" /></form>
      <main id="app"><button>Open menu</button></main>
      <div role="menu"><button role="menuitem">Rename</button></div>
    `;
    const root = document.getElementById("app")!;
    clobber(document.querySelector("form")!, "getAttribute");

    const names = nodes(root).map((n) => n.a11y.name);
    expect(names).toContain("Open menu");
    expect(names).toContain("Rename");
  });

  it("extracts a form root whose control shadows querySelectorAll", () => {
    const root = attach(`
      <form aria-label="Signup">
        <input name="querySelectorAll" aria-label="Nickname" />
        <button aria-describedby="terms">Join</button>
        <span id="terms">You agree to the terms</span>
      </form>
    `);
    clobber(root, "querySelectorAll");

    expect(named(root, "button")).toMatchObject({
      name: "Join",
      description: "You agree to the terms",
    });
  });

  it("resolves a detached form root's ids when the form's ownerDocument is shadowed", () => {
    // A detached subtree has no id scope of its own and falls back to its
    // owner document — read off the form, where `<input name="ownerDocument">`
    // answers instead. In Chromium the form's aria-labelledby lookup then threw
    // and the per-element boundary dropped the root: an empty tree. Pinned at
    // `idScope` because jsdom cannot extract such a root at all — its selector
    // engine reads `ownerDocument` off the form in script, which Chromium's
    // never does.
    const form = document.createElement("form");
    form.innerHTML = `<input name="ownerDocument" />`;
    clobber(form, "ownerDocument");

    expect(idScope(form)).toBe(document);
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
    expect(rootNode!.dom?.tagName).toBe("div");
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
    expect(ulNode.dom?.tagName).toBe("ul");
    expect(ulNode.childIds.length).toBe(2);

    const li1 = nodes.get(ulNode.childIds[0])!;
    const li2 = nodes.get(ulNode.childIds[1])!;
    expect(li1.dom?.tagName).toBe("li");
    expect(li2.dom?.tagName).toBe("li");
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

    expect(link.interaction?.isInteractive).toBe(true);
    expect(link.interaction?.actions).toContain("navigate");

    expect(button.interaction?.isInteractive).toBe(true);
    expect(button.interaction?.actions).toContain("click");

    expect(input.interaction?.isInteractive).toBe(true);
    expect(input.interaction?.actions).toContain("focus");

    expect(div.interaction?.isInteractive).toBe(false);
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
      (n) => n.dom?.attributes["role"] === "slider",
    )!;
    expect(slider.interaction?.actions).toContain("focus");
    expect(slider.interaction?.actions).toContain("increment");
    expect(slider.interaction?.actions).toContain("decrement");
    expect(slider.interaction?.actions).not.toContain("type");
  });

  it("pairs increment/decrement on native <input type='range'> (no 'type')", () => {
    const root = createPage(
      `<input type="range" min="0" max="100" value="50">`,
    );
    const { nodes, rootId } = extractDomTree(root);
    const input = nodes.get(nodes.get(rootId)!.childIds[0])!;
    expect(input.interaction?.actions).toContain("increment");
    expect(input.interaction?.actions).toContain("decrement");
    // Sliders aren't typeable — keep the action surface honest.
    expect(input.interaction?.actions).not.toContain("type");
  });

  it("pairs increment/decrement AND type on native <input type='number'>", () => {
    // Number inputs accept both — typed value entry AND arrow-key stepping.
    const root = createPage(`<input type="number" value="10">`);
    const { nodes, rootId } = extractDomTree(root);
    const input = nodes.get(nodes.get(rootId)!.childIds[0])!;
    expect(input.interaction?.actions).toContain("type");
    expect(input.interaction?.actions).toContain("increment");
    expect(input.interaction?.actions).toContain("decrement");
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
    expect(combo.interaction?.actions).toContain("type");
    expect(combo.interaction?.actions).toContain("focus");
    // "click" would outrank "type" in getPrimaryAction and re-hijack the
    // primary action, so it must NOT be present for an editable combobox.
    expect(combo.interaction?.actions).not.toContain("click");
  });

  it('treats a contenteditable="plaintext-only" combobox as typeable', () => {
    const root = createPage(
      `<div role="combobox" contenteditable="plaintext-only" aria-label="Q">x</div>`,
    );
    const { nodes, rootId } = extractDomTree(root);
    const combo = nodes.get(nodes.get(rootId)!.childIds[0])!;
    expect(combo.interaction?.actions).toContain("type");
    expect(combo.interaction?.actions).not.toContain("click");
  });

  it("keeps a select-only combobox click-driven (no text entry)", () => {
    // No contenteditable → a popup button, not a text field. Opening it is a
    // click; there's nothing to type into on the combobox element itself.
    const root = createPage(
      `<div role="combobox" aria-expanded="false" aria-controls="lb" tabindex="0">Choose a state</div>`,
    );
    const { nodes, rootId } = extractDomTree(root);
    const combo = nodes.get(nodes.get(rootId)!.childIds[0])!;
    expect(combo.interaction?.actions).toContain("click");
    expect(combo.interaction?.actions).not.toContain("type");
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
    expect(combo.interaction?.actions).toContain("type");
    expect(combo.interaction?.actions).not.toContain("click");
  });

  describe("an input whose list names a <datalist>", () => {
    // The datalist makes it a combobox (see role-map), but it is still a text
    // field: typed into, valued and named exactly as the textbox it was.
    function field(html: string) {
      document.body.innerHTML = `${html}<datalist id="fruits"><option value="Apple"><option value="Pear"></datalist>`;
      const { nodes } = extractDomTree(document.body);
      return [...nodes.values()].find((n) => n.dom?.tagName === "input")!;
    }

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("is a combobox, typed into, valued and named like a textbox", () => {
      const input = field(
        `<label>Fruit <input list="fruits" value="Apple"></label>`,
      );
      expect(input.a11y.role).toBe("combobox");
      expect(input.a11y.name).toBe("Fruit");
      expect(input.a11y.value).toBe("Apple");
      expect(input.interaction?.actions).toEqual(["focus", "type"]);
    });

    it("still withholds a sensitive one's value", () => {
      // Redaction keys on tag, type and autocomplete, never the role.
      const input = field(
        `<input aria-label="Card" list="fruits" autocomplete="cc-number" value="secret-value">`,
      );
      expect(input.a11y.role).toBe("combobox");
      expect(input.a11y.value).toBe("[redacted]");
      expect(input.dom?.attributes["value"]).toBe("[redacted]");
    });

    it("keeps a number input's stepping", () => {
      const input = field(
        `<input type="number" aria-label="Count" list="fruits">`,
      );
      expect(input.a11y.role).toBe("combobox");
      expect(input.interaction?.actions).toEqual([
        "focus",
        "type",
        "increment",
        "decrement",
      ]);
    });

    it("reports the expanded state its author sets", () => {
      // Chromium gives a combobox an expanded state and a textbox none, so
      // this rides on the role: `aria-expanded="true"` here is `expanded:
      // true` in Chromium 151 and 153, and nothing on a list naming no
      // datalist.
      const input = field(
        `<input aria-label="Fruit" list="fruits" aria-expanded="true">`,
      );
      expect(input.a11y.role).toBe("combobox");
      expect(input.a11y.states["expanded"]).toBe(true);
    });
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

    const { nodes } = extractDomTree(root);

    const allNodes = Array.from(nodes.values());
    const nav = allNodes.find((n) => n.dom?.tagName === "nav")!;
    const link = allNodes.find((n) => n.dom?.tagName === "a")!;
    const main = allNodes.find((n) => n.dom?.tagName === "main")!;
    const h1 = allNodes.find((n) => n.dom?.tagName === "h1")!;
    const article = allNodes.find((n) => n.dom?.tagName === "article")!;
    const p = allNodes.find((n) => n.dom?.tagName === "p")!;

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

  /** Each node carrying an `id` attribute, mapped to its `disabled` state. */
  function disabledById(page: string | Element): Record<string, unknown> {
    const root = typeof page === "string" ? createPage(page) : page;
    const byId: Record<string, unknown> = {};
    for (const node of extractDomTree(root).nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id) byId[id] = node.a11y.states["disabled"];
    }
    return byId;
  }

  it("reports a control disabled by its <fieldset> as disabled", () => {
    expect(
      disabledById(`
        <fieldset disabled>
          <legend><button id="unlock">Unlock</button></legend>
          <button id="save">Save</button>
        </fieldset>
      `),
    ).toEqual({
      // A disabled fieldset's first legend is exempt, as HTML defines it.
      unlock: undefined,
      save: true,
    });
  });

  it("disables every control kind outside the first legend, at any depth", () => {
    expect(
      disabledById(`
        <fieldset disabled>
          <legend><span><button id="first-legend">Unlock</button></span></legend>
          <legend><button id="second-legend">Help</button></legend>
          <input id="input" aria-label="Title">
          <input id="checkbox" type="checkbox" aria-label="Agree">
          <select id="select" aria-label="Size"><option>M</option></select>
          <textarea id="textarea" aria-label="Notes"></textarea>
          <fieldset><div><button id="nested">Nested</button></div></fieldset>
        </fieldset>
        <fieldset><button id="enabled-fieldset">Send</button></fieldset>
        <button id="aria-disabled" aria-disabled="true">Publish</button>
      `),
    ).toEqual({
      "first-legend": undefined,
      // Only the first legend is exempt.
      "second-legend": true,
      input: true,
      checkbox: true,
      select: true,
      textarea: true,
      nested: true,
      "enabled-fieldset": undefined,
      // aria-disabled still reads through as authored.
      "aria-disabled": true,
    });
  });

  // The expectations from here to the end of the `disabled` tests were each
  // checked against the `disabled` property of Chromium 151's own tree.
  it("disables an option by its own attribute, its optgroup or its select", () => {
    expect(
      disabledById(`
        <select aria-label="Size">
          <option id="enabled">S</option>
          <option id="own" disabled>M</option>
          <optgroup id="optgroup" label="Large" disabled>
            <option id="in-optgroup">L</option>
          </optgroup>
        </select>
        <select aria-label="Color" disabled>
          <option id="in-select">Red</option>
        </select>
        <select aria-label="Fit" multiple aria-disabled="true">
          <option id="in-aria-disabled-select">Slim</option>
        </select>
        <fieldset disabled>
          <legend>
            <select aria-label="Cut"><option id="in-legend">Long</option></select>
          </legend>
          <select aria-label="Hem"><option id="in-fieldset">Raw</option></select>
        </fieldset>
      `),
    ).toEqual({
      enabled: undefined,
      own: true,
      // Chromium marks the options of a disabled optgroup, never the optgroup.
      optgroup: undefined,
      "in-optgroup": true,
      // `:disabled` misses these two: HTML's rule for an option reads the
      // option and its optgroup, never the select.
      "in-select": true,
      "in-fieldset": true,
      "in-aria-disabled-select": true,
      // A select in a disabled fieldset's first legend is enabled, and so are
      // its options.
      "in-legend": undefined,
    });
  });

  it("stops inheriting at an explicit aria-disabled, never at a native one", () => {
    // Answer `:disabled` as Chromium 151 does and jsdom doesn't: for every
    // option in a disabled select too. Its tree still counts that option's
    // state as inherited, so reading it from `:disabled` gets this test wrong
    // in a browser while passing here.
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      if (selector === ":disabled" && this.tagName === "OPTION") {
        let el = this.parentElement;
        while (el && el.tagName !== "SELECT") el = el.parentElement;
        if (el?.hasAttribute("disabled")) return true;
      }
      return matches.call(this, selector);
    });
    expect(
      disabledById(`
        <select aria-label="Size" disabled>
          <option id="option-opts-out" aria-disabled="false">S</option>
          <optgroup label="Large" aria-disabled="false">
            <option id="optgroup-opts-out">L</option>
          </optgroup>
        </select>
        <select aria-label="Color">
          <optgroup label="Warm" disabled>
            <option id="disabled-optgroup-wins" aria-disabled="false">Red</option>
          </optgroup>
        </select>
        <select aria-label="Fit" disabled aria-disabled="false">
          <option id="disabled-select-wins">Slim</option>
        </select>
      `),
    ).toEqual({
      // What an option inherits from its select, its own `false` overrides...
      "option-opts-out": false,
      // ...and so does the `false` of an ancestor nearer than the select.
      "optgroup-opts-out": undefined,
      // A `disabled` attribute is not overridden: not the optgroup's, which
      // disables the option itself...
      "disabled-optgroup-wins": true,
      // ...and not the select's, which aria-disabled="false" can't re-enable.
      "disabled-select-wins": true,
    });
  });

  it("disables a focusable descendant of aria-disabled, at any depth", () => {
    expect(
      disabledById(`
        <div role="group" aria-label="Shipping" aria-disabled="true">
          <button id="button">Quote</button>
          <a id="link" href="/rates">Rates</a>
          <input id="input" aria-label="Zip">
          <div id="tabbable" role="button" tabindex="0">Estimate</div>
          <div id="scripted" role="menuitem" tabindex="-1">Copy</div>
          <select aria-label="Speed"><option id="option">Fast</option></select>
          <div role="group" aria-label="Extras">
            <button id="nested">Insure</button>
          </div>
          <p id="paragraph">Ships in 2 days</p>
          <h2 id="heading">Carriers</h2>
          <div id="untabbable" role="button">Track</div>
          <div id="aria-option" role="option">Ground</div>
          <a id="anchor">Returns</a>
          <button id="opts-out" aria-disabled="false">Help</button>
          <div aria-disabled="false">
            <button id="under-opt-out">Chat</button>
          </div>
        </div>
      `),
    ).toEqual({
      button: true,
      link: true,
      input: true,
      tabbable: true,
      scripted: true,
      // A native option counts as focusable here. An ARIA one does not.
      option: true,
      nested: true,
      // Only focusable descendants inherit it, as CORE-AAM says.
      paragraph: undefined,
      heading: undefined,
      untabbable: undefined,
      "aria-option": undefined,
      anchor: undefined,
      // The nearest explicit aria-disabled wins.
      "opts-out": false,
      "under-opt-out": undefined,
    });
  });

  it("reads an ancestor's aria-disabled value the way Chromium does", () => {
    expect(
      disabledById(`
        <div role="group" aria-label="Upper" aria-disabled="TRUE">
          <button id="upper-true">Save</button>
        </div>
        <div role="group" aria-label="Other" aria-disabled="yes">
          <button id="other-value">Send</button>
        </div>
        <div role="group" aria-label="Outer" aria-disabled="true">
          <div aria-disabled="FALSE"><button id="upper-false">Undo</button></div>
          <div aria-disabled=""><button id="empty">Redo</button></div>
          <div aria-disabled="undefined"><button id="undefined">Copy</button></div>
          <button id="own-empty" aria-disabled="">Cut</button>
        </div>
      `),
    ).toEqual({
      // Any value but `false`, empty or `undefined` disables, in any case.
      "upper-true": true,
      "other-value": true,
      "upper-false": undefined,
      // Empty and `undefined` pass the ancestor's state through, on an
      // ancestor or on the element itself.
      empty: true,
      undefined: true,
      "own-empty": true,
    });
  });

  it("counts an editing host as focusable, and a link inside one as not", () => {
    expect(
      disabledById(`
        <div role="group" aria-label="Compose" aria-disabled="true">
          <div id="textbox" contenteditable="true" role="textbox" aria-label="Note"></div>
          <div id="plaintext" contenteditable="plaintext-only" aria-label="Plain">P</div>
          <div id="upper" contenteditable="TRUE" aria-label="Upper">U</div>
          <div id="invalid" contenteditable="bogus" aria-label="Bogus">B</div>
          <div id="host" contenteditable="" aria-label="Body">
            <p id="child">Hi</p>
            <span id="nested" contenteditable="true">there</span>
            <a id="link" href="/terms">terms</a>
            <a id="tabbable-link" href="/help" tabindex="0">help</a>
            <button id="button">Send</button>
            <div contenteditable="false">
              <span id="island-host" contenteditable="true">island</span>
              <a id="island-link" href="/faq">faq</a>
            </div>
          </div>
        </div>
      `),
    ).toEqual({
      // Chromium focuses an editing host with no tabindex, so it inherits.
      textbox: true,
      plaintext: true,
      upper: true,
      host: true,
      // An invalid value inherits editing, here none.
      invalid: undefined,
      // Editable content inside a host is not a host itself.
      child: undefined,
      nested: undefined,
      // Editing takes a link's focus away, unless a tabindex gives it back.
      link: undefined,
      "tabbable-link": true,
      button: true,
      // A `contenteditable="false"` island ends the editing.
      "island-host": true,
      "island-link": true,
    });
  });

  it("disables a focusable descendant of a disabled control, not of a fieldset", () => {
    expect(
      disabledById(`
        <button disabled>
          Save <span id="in-button" role="button" tabindex="0">now</span>
        </button>
        <button disabled aria-disabled="false">
          Send <span id="in-opted-out-button" role="button" tabindex="0">now</span>
        </button>
        <fieldset id="fieldset" disabled>
          <legend><button id="legend-button">Unlock</button></legend>
          <div id="div-button" role="button" tabindex="0">Custom</div>
          <a id="link" href="/help">Help</a>
          <button>
            Go <span id="in-fieldset-button" role="button" tabindex="0">now</span>
          </button>
        </fieldset>
      `),
    ).toEqual({
      "in-button": true,
      // aria-disabled="false" doesn't re-enable the button, or what it holds.
      "in-opted-out-button": true,
      // A disabled fieldset disables its form controls and nothing else: not
      // itself, and not a focusable element that isn't a form control...
      fieldset: undefined,
      "legend-button": undefined,
      "div-button": undefined,
      link: undefined,
      // ...though a control it disables passes that on like any other.
      "in-fieldset-button": true,
    });
  });

  it("inherits aria-disabled from above the extraction root", () => {
    const page = createPage(`
      <div role="group" aria-label="Billing" aria-disabled="true">
        <section id="root"><button id="pay">Pay</button></section>
      </div>
    `);
    // The live extractor re-extracts only a mutated subtree, from a root
    // like this one, so the ancestors above it still have to count.
    expect(disabledById(page.querySelector("#root")!)).toEqual({
      root: undefined,
      pay: true,
    });
  });

  it("inherits aria-disabled through the flat tree", () => {
    const page = createPage(`
      <div role="group" aria-label="Billing" aria-disabled="true">
        <div id="host"></div>
      </div>
      <div id="slot-host"><button id="slotted">Refund</button></div>
    `);
    page.querySelector("#host")!.attachShadow({ mode: "open" }).innerHTML =
      `<button id="in-shadow">Split</button>`;
    // Nothing in the light tree disables the slotted button. Its slot's
    // ancestor in the shadow tree does.
    page.querySelector("#slot-host")!.attachShadow({ mode: "open" }).innerHTML =
      `<div role="group" aria-label="Refunds" aria-disabled="true"><slot></slot></div>`;
    expect(disabledById(page)).toEqual({
      host: undefined,
      "in-shadow": true,
      "slot-host": undefined,
      slotted: true,
    });
  });

  /** Each node carrying an `id` attribute, mapped to one of its states. */
  function stateById(
    page: string | Element,
    state: string,
  ): Record<string, unknown> {
    const root = typeof page === "string" ? createPage(page) : page;
    const byId: Record<string, unknown> = {};
    for (const node of extractDomTree(root).nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id) byId[id] = node.a11y.states[state];
    }
    return byId;
  }

  // The expectations from here to "skips script and style elements" were
  // each checked against Chromium 151's own tree: CDP `getFullAXTree`, and
  // chrome://accessibility for `aria-current`, which CDP doesn't expose.
  it("reads an element's own aria-disabled the way Chromium does", () => {
    expect(
      disabledById(`
        <div id="upper" role="group" aria-disabled="TRUE">a</div>
        <div id="mixed" role="group" aria-disabled="mixed">b</div>
        <div id="yes" role="group" aria-disabled="yes">c</div>
        <div id="zero" role="group" aria-disabled="0">d</div>
        <div id="null" role="group" aria-disabled="null">e</div>
        <div id="padded-true" role="group" aria-disabled=" true">f</div>
        <div id="padded-false" role="group" aria-disabled=" false">g</div>
        <div id="false-padded" role="group" aria-disabled="false ">h</div>
        <div id="space" role="group" aria-disabled=" ">i</div>
        <div id="false" role="group" aria-disabled="False">j</div>
        <div id="upper-false" role="group" aria-disabled="FALSE">k</div>
        <div id="empty" role="group" aria-disabled="">l</div>
        <div id="undefined" role="group" aria-disabled="undefined">m</div>
        <div id="upper-undefined" role="group" aria-disabled="UNDEFINED">n</div>
      `),
    ).toEqual({
      // Anything but `false`, empty or `undefined` disables, in any case and
      // untrimmed.
      upper: true,
      mixed: true,
      yes: true,
      zero: true,
      null: true,
      "padded-true": true,
      "padded-false": true,
      "false-padded": true,
      space: true,
      false: false,
      "upper-false": false,
      // Empty and `undefined` leave it unset.
      empty: undefined,
      undefined: undefined,
      "upper-undefined": undefined,
    });
  });

  it("never marks an <optgroup> disabled, but still disables its options", () => {
    expect(
      disabledById(`
        <select aria-label="Size">
          <optgroup id="aria" label="Large" aria-disabled="true">
            <option id="in-aria">L</option>
          </optgroup>
          <optgroup id="role" role="group" label="Small" aria-disabled="TRUE">
            <option id="in-role">S</option>
          </optgroup>
          <optgroup id="false" label="Medium" aria-disabled="false">
            <option id="in-false">M</option>
          </optgroup>
        </select>
      `),
    ).toEqual({
      aria: undefined,
      "in-aria": true,
      role: undefined,
      "in-role": true,
      false: undefined,
      "in-false": undefined,
    });
  });

  it.each([
    ["busy", `<div role="group" X>x</div>`],
    ["required", `<div role="textbox" tabindex="0" X>x</div>`],
    ["readonly", `<div role="textbox" tabindex="0" X>x</div>`],
    ["expanded", `<div role="button" tabindex="0" X>x</div>`],
    ["selected", `<div role="tablist"><div role="tab" X>x</div></div>`],
  ])("reads aria-%s the way Chromium does", (state, template) => {
    const tokens = {
      upper: "TRUE",
      yes: "yes",
      mixed: "mixed",
      "padded-false": " false",
      false: "False",
      "upper-false": "FALSE",
      empty: "",
      undefined: "undefined",
      "upper-undefined": "UNDEFINED",
    };
    const page = Object.entries(tokens)
      .map(([id, value]) =>
        template.replace("X", `id="${id}" aria-${state}="${value}"`),
      )
      .join("");
    expect(stateById(page, state)).toEqual({
      upper: true,
      yes: true,
      mixed: true,
      "padded-false": true,
      false: false,
      "upper-false": false,
      empty: undefined,
      undefined: undefined,
      "upper-undefined": undefined,
    });
  });

  it("reads aria-checked the way Chromium does, mixed where the role has it", () => {
    expect(
      stateById(
        `
        <div id="upper" role="checkbox" aria-checked="TRUE">a</div>
        <div id="yes" role="checkbox" aria-checked="yes">b</div>
        <div id="false" role="checkbox" aria-checked="FALSE">c</div>
        <div id="mixed" role="checkbox" aria-checked="MIXED">d</div>
        <div id="padded-mixed" role="checkbox" aria-checked=" mixed">e</div>
        <div id="empty" role="checkbox" aria-checked="">f</div>
        <div id="undefined" role="checkbox" aria-checked="undefined">g</div>
        <div id="upper-undefined" role="checkbox" aria-checked="UNDEFINED">h</div>
        <div role="menu">
          <div id="menuitemcheckbox" role="menuitemcheckbox" aria-checked="mixed">i</div>
          <div id="menuitemradio" role="menuitemradio" aria-checked="mixed">j</div>
        </div>
        <div role="listbox"><div id="option" role="option" aria-checked="Mixed">k</div></div>
        <div role="tree"><div id="treeitem" role="treeitem" aria-checked="mixed">l</div></div>
        <div role="radiogroup"><div id="radio" role="radio" aria-checked="mixed">m</div></div>
        <div id="switch" role="switch" aria-checked="mixed">n</div>
      `,
        "checked",
      ),
    ).toEqual({
      upper: true,
      yes: true,
      false: false,
      mixed: "mixed",
      "padded-mixed": true,
      empty: undefined,
      undefined: undefined,
      // Unlike every boolean state, only a lowercase `undefined` leaves it
      // unset.
      "upper-undefined": true,
      menuitemcheckbox: "mixed",
      option: "mixed",
      treeitem: "mixed",
      // These three roles have no mixed state, and Chromium reads it as false.
      menuitemradio: false,
      radio: false,
      switch: false,
    });
  });

  it("reads aria-pressed the way Chromium does", () => {
    expect(
      stateById(
        `
        <button id="upper" aria-pressed="TRUE">a</button>
        <button id="yes" aria-pressed="yes">b</button>
        <button id="false" aria-pressed="False">c</button>
        <button id="mixed" aria-pressed="MIXED">d</button>
        <button id="padded-mixed" aria-pressed=" mixed">e</button>
        <button id="empty" aria-pressed="">f</button>
        <button id="undefined" aria-pressed="undefined">g</button>
        <button id="upper-undefined" aria-pressed="UNDEFINED">h</button>
      `,
        "pressed",
      ),
    ).toEqual({
      upper: true,
      yes: true,
      false: false,
      mixed: "mixed",
      "padded-mixed": true,
      empty: undefined,
      undefined: undefined,
      "upper-undefined": true,
    });
  });

  it("reads aria-current the way Chromium does", () => {
    expect(
      stateById(
        `
        <a id="page" href="#a" aria-current="PAGE">a</a>
        <a id="step" href="#b" aria-current="Step">b</a>
        <a id="location" href="#c" aria-current="LOCATION">c</a>
        <a id="date" href="#d" aria-current="date">d</a>
        <a id="time" href="#e" aria-current="Time">e</a>
        <a id="true" href="#f" aria-current="TRUE">f</a>
        <a id="unknown" href="#g" aria-current="yes">g</a>
        <a id="padded-page" href="#h" aria-current=" page">h</a>
        <a id="two-tokens" href="#i" aria-current="page step">i</a>
        <a id="false" href="#j" aria-current="False">j</a>
        <a id="empty" href="#k" aria-current="">k</a>
        <a id="undefined" href="#l" aria-current="undefined">l</a>
        <a id="upper-undefined" href="#m" aria-current="UNDEFINED">m</a>
      `,
        "current",
      ),
    ).toEqual({
      // The five tokens match in any case, and come out lowercase.
      page: "page",
      step: "step",
      location: "location",
      date: "date",
      time: "time",
      // Anything else Chromium reads as true, untrimmed.
      true: true,
      unknown: true,
      "padded-page": true,
      "two-tokens": true,
      false: false,
      empty: undefined,
      undefined: undefined,
      "upper-undefined": true,
    });
  });

  it("reads a native checkbox's and radio's checkedness, never aria-checked", () => {
    const root = createPage(`
      <input id="unchecked" type="checkbox" aria-label="a">
      <input id="checked" type="checkbox" checked aria-label="b">
      <input id="aria-true" type="checkbox" aria-checked="true" aria-label="c">
      <input id="aria-mixed" type="checkbox" aria-checked="mixed" aria-label="d">
      <input id="aria-false" type="checkbox" checked aria-checked="false" aria-label="e">
      <input id="indeterminate" type="checkbox" aria-label="f">
      <input id="indeterminate-checked" type="checkbox" checked aria-label="g">
      <input id="indeterminate-aria-false" type="checkbox" aria-checked="false" aria-label="h">
      <input id="switch" type="checkbox" role="switch" aria-checked="true" aria-label="i">
      <input id="switch-indeterminate" type="checkbox" role="switch" aria-label="j">
      <div role="menu">
        <input id="menuitemcheckbox" type="checkbox" role="menuitemcheckbox" aria-checked="true" aria-label="k">
        <input id="menuitemradio-indeterminate" type="checkbox" role="menuitemradio" aria-label="l">
      </div>
      <input id="radio" type="radio" name="r1" aria-checked="true" aria-label="m">
      <input id="radio-checked" type="radio" name="r2" checked aria-checked="false" aria-label="n">
      <input id="radio-indeterminate" type="radio" name="r3" aria-label="o">
      <input id="text-checkbox" type="text" role="checkbox" aria-checked="true" aria-label="p">
      <input id="button-switch" type="button" role="switch" aria-checked="mixed" value="q">
    `);
    // A property with no attribute: only script can set it.
    for (const id of [
      "indeterminate",
      "indeterminate-checked",
      "indeterminate-aria-false",
      "switch-indeterminate",
      "menuitemradio-indeterminate",
      "radio-indeterminate",
    ])
      (root.querySelector(`#${id}`) as HTMLInputElement).indeterminate = true;

    expect(stateById(root, "checked")).toEqual({
      // Always set: a native checkbox is checked or it isn't.
      unchecked: false,
      checked: true,
      "aria-true": false,
      "aria-mixed": false,
      "aria-false": true,
      // An indeterminate checkbox is mixed, checked or not, whatever its
      // role: native checkedness outranks a role with no mixed state.
      indeterminate: "mixed",
      "indeterminate-checked": "mixed",
      "indeterminate-aria-false": "mixed",
      switch: false,
      "switch-indeterminate": "mixed",
      menuitemcheckbox: false,
      "menuitemradio-indeterminate": "mixed",
      radio: false,
      "radio-checked": true,
      // A radio is never mixed.
      "radio-indeterminate": false,
      // Any other input with a checkable role reads aria-checked as usual.
      "text-checkbox": true,
      "button-switch": false,
    });
  });

  it("exposes a native checkbox's checkedness only on a role that has the state", () => {
    const root = createPage(`
      <input id="button" type="checkbox" role="button" checked aria-label="a">
      <input id="toggle" type="checkbox" role="button" checked aria-pressed="false" aria-label="b">
      <input id="toggle-indeterminate" type="checkbox" role="button" aria-pressed="true" aria-label="c">
      <input id="link" type="checkbox" role="link" checked aria-label="d">
      <input id="pressed" type="checkbox" aria-pressed="true" aria-label="e">
      <div role="listbox">
        <input id="option" type="checkbox" role="option" checked aria-label="f">
        <input id="option-aria" type="checkbox" role="option" checked aria-checked="false" aria-label="g">
        <input id="option-empty" type="checkbox" role="option" checked aria-checked="" aria-label="h">
      </div>
      <div role="tree">
        <input id="treeitem-aria" type="checkbox" role="treeitem" aria-checked="true" aria-label="i">
      </div>
    `);
    (
      root.querySelector("#toggle-indeterminate") as HTMLInputElement
    ).indeterminate = true;
    const states = (id: string) => {
      for (const node of extractDomTree(root).nodes.values())
        if (node.dom?.attributes["id"] === id)
          return [node.a11y.states["checked"], node.a11y.states["pressed"]];
    };
    // [checked, pressed]
    expect(states("button")).toEqual([undefined, undefined]);
    // A toggle button presses by the checkedness, aria-pressed aside.
    expect(states("toggle")).toEqual([undefined, true]);
    expect(states("toggle-indeterminate")).toEqual([undefined, "mixed"]);
    expect(states("link")).toEqual([undefined, undefined]);
    // A checkbox is no toggle button.
    expect(states("pressed")).toEqual([false, undefined]);
    // An option or treeitem has the state only while aria-checked is set,
    // and then reads it from the checkedness.
    expect(states("option")).toEqual([undefined, undefined]);
    expect(states("option-aria")).toEqual([true, undefined]);
    expect(states("option-empty")).toEqual([undefined, undefined]);
    expect(states("treeitem-aria")).toEqual([false, undefined]);
  });

  it("ignores aria-expanded on a <select> in its own role", () => {
    expect(
      stateById(
        `
        <select id="plain" aria-label="a"><option>o</option></select>
        <select id="true" aria-label="b" aria-expanded="true"><option>o</option></select>
        <select id="upper" aria-label="c" aria-expanded="TRUE"><option>o</option></select>
        <select id="combobox" role="combobox" aria-label="d" aria-expanded="true"><option>o</option></select>
        <select id="multiple" multiple aria-label="e" aria-expanded="true"><option>o</option></select>
        <select id="listbox" role="listbox" aria-label="f" aria-expanded="true"><option>o</option></select>
        <select id="listbox-plain" role="listbox" aria-label="f2"><option>o</option></select>
        <select id="rows" size="3" aria-label="f3"><option>o</option></select>
        <select id="rows-true" size="3" aria-label="f4" aria-expanded="true"><option>o</option></select>
        <select id="button" role="button" aria-label="g" aria-expanded="true"><option>o</option></select>
        <select id="button-false" role="button" aria-label="h" aria-expanded="false"><option>o</option></select>
      `,
        "expanded",
      ),
    ).toEqual({
      // A drop-down is expanded while its picker is open, which it can't be
      // here, and collapsed otherwise.
      plain: false,
      true: false,
      upper: false,
      combobox: false,
      // A list box has no expanded state, nor does a select showing more than
      // one row, which has no picker.
      multiple: undefined,
      listbox: undefined,
      "listbox-plain": undefined,
      rows: undefined,
      "rows-true": undefined,
      // An author role that isn't the select's own reads it as usual.
      button: true,
      "button-false": false,
    });
  });

  it("reads a <select>'s shape from its display size, and a list box's author combobox role as ARIA", () => {
    expect(
      stateById(
        `
        <select id="multiple-one" multiple size="1" role="combobox" aria-label="a" aria-expanded="true"><option>o</option></select>
        <select id="zero" size="0" aria-label="b" aria-expanded="true"><option>o</option></select>
        <select id="multiple-zero" multiple size="0" role="combobox" aria-label="c"><option>o</option></select>
        <select id="multiple-combobox" multiple role="combobox" aria-label="d" aria-expanded="true"><option>o</option></select>
        <select id="rows-combobox" size="3" role="combobox" aria-label="e" aria-expanded="false"><option>o</option></select>
      `,
        "expanded",
      ),
    ).toEqual({
      // One row is a drop-down, multiple or not; size 0 is no size at all.
      "multiple-one": false,
      zero: false,
      // A list box's combobox role is the author's, read as usual: here unset.
      "multiple-zero": undefined,
      "multiple-combobox": true,
      "rows-combobox": false,
    });
    expect(
      stateById(
        `<select id="s" multiple role="combobox" aria-label="a" aria-pressed="true"><option>o</option></select>`,
        "pressed",
      ),
    ).toEqual({ s: undefined });
  });

  it("ignores aria-pressed on a drop-down <select>", () => {
    expect(
      stateById(
        `<select id="s" aria-label="a" aria-pressed="true"><option>o</option></select>`,
        "pressed",
      ),
    ).toEqual({ s: undefined });
  });

  it("takes a details' summary's expanded state from the details", () => {
    expect(
      stateById(
        `
        <details><summary id="closed">a</summary>x</details>
        <details open><summary id="open">b</summary>x</details>
        <details><summary id="closed-true" aria-expanded="true">c</summary>x</details>
        <details open><summary id="open-false" aria-expanded="false">d</summary>x</details>
        <details open><summary>e</summary><summary id="second" aria-expanded="false">f</summary></details>
        <details open>Lead<summary id="after-text" aria-expanded="false">g</summary></details>
        <details><summary id="button" role="button" aria-expanded="true">h</summary>x</details>
        <details open><summary id="button-open" role="button">i</summary>x</details>
        <details><summary id="none" role="none" aria-expanded="true">j</summary>x</details>
        <details open><summary id="link" role="link">k</summary>x</details>
        <details open><summary id="checkbox" role="checkbox">l</summary>x</details>
        <details open><summary id="heading" role="heading" aria-level="2" aria-expanded="true">m</summary>x</details>
        <details open><summary id="generic" role="generic" aria-expanded="true">n</summary>x</details>
        <details open><summary id="radio" role="radio">o</summary>x</details>
      `,
        "expanded",
      ),
    ).toEqual({
      closed: false,
      open: true,
      "closed-true": false,
      "open-false": true,
      // Every summary child of a details, not only the one that toggles it.
      second: true,
      "after-text": true,
      // An author role with an expanded state takes it from the details too.
      button: false,
      "button-open": true,
      none: false,
      link: true,
      checkbox: true,
      // A role without one has none, whatever aria-expanded says.
      heading: undefined,
      generic: undefined,
      radio: undefined,
    });
  });

  it("ignores aria-pressed on a details' summary unless a role makes it a button", () => {
    expect(
      stateById(
        `
        <details><summary id="true" aria-pressed="true">a</summary>x</details>
        <details open><summary id="mixed" aria-pressed="mixed">b</summary>x</details>
        <details><summary id="false" aria-pressed="false">c</summary>x</details>
        <details><summary id="none" role="none" aria-pressed="true">d</summary>x</details>
        <details><summary id="button" role="button" aria-pressed="true">e</summary>x</details>
        <details open><summary id="button-false" role="button" aria-pressed="false">f</summary>x</details>
        <details open><summary id="link" role="link" aria-pressed="true">g</summary>x</details>
      `,
        "pressed",
      ),
    ).toEqual({
      // A summary is a disclosure, not a toggle button.
      true: undefined,
      mixed: undefined,
      false: undefined,
      none: undefined,
      button: true,
      "button-false": false,
      link: undefined,
    });
  });

  describe("a popover invoker's expanded state", () => {
    /**
     * `expanded` by id, on a connected page: an invoker resolves its popover
     * by id in its own tree. The popovers named in `open` are showing.
     */
    function expandedOnPage(
      html: string,
      ...open: string[]
    ): Record<string, unknown> {
      document.body.innerHTML = html;
      try {
        fakeShowPopovers(
          ...open.map((id) => document.getElementById(id) as Element),
        );
        return stateById(document.body, "expanded");
      } finally {
        document.body.innerHTML = "";
      }
    }

    const POPOVERS = `
      <div id="closed" popover>x</div>
      <div id="open" popover>x</div>
      <div id="plain">x</div>
    `;

    it("is whether the popover is showing, whatever aria-expanded says", () => {
      expect(
        expandedOnPage(
          `
          <button id="collapsed" popovertarget="closed">a</button>
          <button id="collapsed-true" popovertarget="closed" aria-expanded="true">b</button>
          <button id="expanded" popovertarget="open">c</button>
          <button id="expanded-false" popovertarget="open" aria-expanded="false">d</button>
          <input id="input-button" type="button" popovertarget="closed" value="e" aria-expanded="true">
          <input id="input-submit" type="submit" popovertarget="closed" value="f" aria-expanded="true">
          <input id="input-reset" type="reset" popovertarget="closed" value="g" aria-expanded="true">
          <input id="input-image" type="image" popovertarget="open" alt="h" aria-expanded="false">
          <button id="action-show" popovertarget="closed" popovertargetaction="show" aria-expanded="true">i</button>
          <button id="action-hide" popovertarget="open" popovertargetaction="hide">j</button>
          <button id="aria-disabled" aria-disabled="true" popovertarget="closed" aria-expanded="true">k</button>
          <button id="submit-no-form" type="submit" popovertarget="closed" aria-expanded="true">l</button>
          <form><button id="form-button" type="button" popovertarget="closed" aria-expanded="true">m</button></form>
          <form><button id="form-reset" type="RESET" popovertarget="closed" aria-expanded="true">n</button></form>
          <form><input id="form-input-button" type="button" popovertarget="closed" value="o" aria-expanded="true"></form>
          <button id="form-missing" form="nowhere" popovertarget="closed" aria-expanded="true">p</button>
          <div id="manual" popover="manual">x</div>
          <button id="to-manual" popovertarget="manual" aria-expanded="true">q</button>
          <div id="hint" popover="hint">x</div>
          <button id="to-hint" popovertarget="hint">r</button>
          <div id="bogus" popover="bogus">x</div>
          <button id="to-bogus" popovertarget="bogus" aria-expanded="true">s</button>
          ${POPOVERS}
        `,
          "open",
        ),
      ).toEqual({
        collapsed: false,
        "collapsed-true": false,
        expanded: true,
        "expanded-false": true,
        // Each input type that can invoke a popover.
        "input-button": false,
        "input-submit": false,
        "input-reset": false,
        "input-image": true,
        // Whatever the click would do to it.
        "action-show": false,
        "action-hide": true,
        // Only a disabled control stops invoking.
        "aria-disabled": false,
        // A submit button submits its form instead, but only with one.
        "submit-no-form": false,
        "form-button": false,
        "form-reset": false,
        "form-input-button": false,
        "form-missing": false,
        // Every popover type, and an invalid one, which is manual.
        "to-manual": false,
        "to-hint": false,
        "to-bogus": false,
      });
    });

    it("falls back to aria-expanded when the control invokes no popover", () => {
      expect(
        expandedOnPage(
          `
          <button id="missing" popovertarget="nowhere" aria-expanded="true">a</button>
          <button id="missing-unset" popovertarget="nowhere">b</button>
          <button id="not-a-popover" popovertarget="plain" aria-expanded="true">c</button>
          <button id="disabled" disabled popovertarget="open" aria-expanded="false">d</button>
          <button id="disabled-unset" disabled popovertarget="open">e</button>
          <fieldset disabled><button id="fieldset-disabled" popovertarget="closed" aria-expanded="true">f</button></fieldset>
          <form><button id="form-submit" popovertarget="closed" aria-expanded="true">g</button></form>
          <form><button id="form-invalid-type" type="bogus" popovertarget="closed" aria-expanded="true">h</button></form>
          <form><input id="form-input-submit" type="submit" popovertarget="closed" value="i" aria-expanded="true"></form>
          <form><input id="form-input-image" type="image" popovertarget="closed" alt="j" aria-expanded="true"></form>
          <form id="owner"></form>
          <button id="form-attribute" form="owner" popovertarget="closed" aria-expanded="true">k</button>
          <input id="checkbox" type="checkbox" popovertarget="closed" aria-label="l" aria-expanded="true">
          <a id="link" href="#" popovertarget="closed" aria-expanded="true">m</a>
          <div id="div-button" role="button" tabindex="0" popovertarget="closed" aria-expanded="true">n</div>
          ${POPOVERS}
        `,
          "open",
        ),
      ).toEqual({
        missing: true,
        "missing-unset": undefined,
        "not-a-popover": true,
        plain: undefined,
        // A disabled control invokes nothing, even from a disabled fieldset.
        disabled: false,
        "disabled-unset": undefined,
        "fieldset-disabled": true,
        // A submit button with a form, a <button> by default and with an
        // invalid type, submits it instead.
        "form-submit": true,
        "form-invalid-type": true,
        "form-input-submit": true,
        "form-input-image": true,
        "form-attribute": true,
        // Not a button: an input of another type, an element of another tag.
        checkbox: true,
        link: true,
        "div-button": true,
      });
    });

    it("takes the state from commandfor's popover, which outranks popovertarget", () => {
      expect(
        expandedOnPage(
          `
          <button id="toggle" commandfor="closed" command="toggle-popover" aria-expanded="true">a</button>
          <button id="show" commandfor="open" command="show-popover">b</button>
          <button id="hide" commandfor="open" command="hide-popover" aria-expanded="false">c</button>
          <button id="upper" commandfor="open" command="TOGGLE-POPOVER">d</button>
          <button id="not-a-popover" commandfor="plain" command="toggle-popover" aria-expanded="true">e</button>
          <button id="outranks" commandfor="closed" command="toggle-popover" popovertarget="open">f</button>
          <button id="custom" commandfor="closed" command="--custom" popovertarget="open">g</button>
          <dialog id="dialog">x</dialog>
          <button id="dialog-command" commandfor="dialog" command="show-modal" popovertarget="open">h</button>
          <button id="unresolved" commandfor="nowhere" command="toggle-popover" popovertarget="open">i</button>
          <button id="no-command" commandfor="open">j</button>
          <form><button id="form-plain" commandfor="closed" command="toggle-popover" aria-expanded="true">k</button></form>
          <form><button id="form-invalid-type" type="bogus" commandfor="closed" command="toggle-popover" aria-expanded="true">l</button></form>
          <form><button id="form-popovertarget" commandfor="nowhere" popovertarget="closed" aria-expanded="true">m</button></form>
          <form><button id="form-submit" type="submit" commandfor="closed" command="toggle-popover" aria-expanded="true">n</button></form>
          <button id="disabled" disabled commandfor="closed" command="toggle-popover" aria-expanded="true">o</button>
          <input id="input" type="button" commandfor="closed" command="toggle-popover" value="p" aria-expanded="true">
          ${POPOVERS}
        `,
          "open",
        ),
      ).toEqual({
        toggle: false,
        show: true,
        hide: true,
        upper: true,
        // Any element it resolves to decides, collapsed unless a popover shows.
        "not-a-popover": false,
        plain: undefined,
        outranks: false,
        // Not a popover command, or no element: popovertarget decides.
        custom: true,
        "dialog-command": true,
        unresolved: true,
        "no-command": undefined,
        // A commandfor attribute makes a typeless <button> a plain button,
        // so a form doesn't take it over.
        "form-plain": false,
        "form-invalid-type": false,
        "form-popovertarget": false,
        "form-submit": true,
        disabled: true,
        // Only a <button> takes commandfor.
        input: true,
      });
    });

    it("falls back to aria-expanded inside its own popover, but not as it", () => {
      // jsdom styles every popover `display: none`, showing or not.
      const shown = `style="display: block"`;
      expect(
        expandedOnPage(
          `
          <div id="own" popover ${shown}>
            <button id="close" popovertarget="own" aria-expanded="false">a</button>
            <button id="close-unset" popovertarget="own" popovertargetaction="hide">b</button>
            <span><button id="close-command" commandfor="own" command="hide-popover" aria-expanded="true">c</button></span>
            <button id="other" popovertarget="closed" aria-expanded="true">d</button>
          </div>
          <button id="self" popover popovertarget="self" aria-expanded="false" ${shown}>e</button>
          ${POPOVERS}
        `,
          "own",
          "self",
          "open",
        ),
      ).toEqual({
        own: undefined,
        close: false,
        "close-unset": undefined,
        "close-command": true,
        other: false,
        self: true,
      });
    });

    it("reads a <form> popover whose fields shadow the methods it is read through", () => {
      document.body.innerHTML = `
        <button id="open" popovertarget="f">a</button>
        <button id="inside-check" popovertarget="g" aria-expanded="true">b</button>
        <form id="f" popover>
          <input name="hasAttribute" aria-label="c" />
          <input name="contains" aria-label="d" />
          <input name="matches" aria-label="e" />
        </form>
      `;
      try {
        const form = document.getElementById("f")!;
        fakeShowPopovers(form);
        for (const prop of ["hasAttribute", "contains", "matches"])
          clobber(form, prop);
        expect(stateById(document.body, "expanded")).toEqual({
          open: true,
          // No element named g: aria-expanded decides.
          "inside-check": true,
        });
      } finally {
        document.body.innerHTML = "";
      }
    });

    it("resolves the popover in the invoker's own tree", () => {
      document.body.innerHTML = `
        <div id="same-scope"></div>
        <button id="light-to-shadow" popovertarget="shadow-popover" aria-expanded="true">a</button>
        <div id="shadow-to-light"></div>
        <div id="closed" popover>x</div>
      `;
      try {
        document
          .getElementById("same-scope")!
          .attachShadow({ mode: "open" }).innerHTML = `
          <button id="in-scope" popovertarget="shadow-popover" aria-expanded="true">b</button>
          <div id="shadow-popover" popover>x</div>
        `;
        document
          .getElementById("shadow-to-light")!
          .attachShadow({ mode: "open" }).innerHTML =
          `<button id="to-light" popovertarget="closed" aria-expanded="true">c</button>`;
        expect(stateById(document.body, "expanded")).toEqual({
          "in-scope": false,
          // An id in another tree names nothing.
          "light-to-shadow": true,
          "to-light": true,
        });
      } finally {
        document.body.innerHTML = "";
      }
    });

    it("only for a role Chromium can mark expanded", () => {
      expect(
        expandedOnPage(
          `
          <div role="menu"><button id="menuitem" role="menuitem" popovertarget="closed" aria-expanded="true">a</button></div>
          <div role="tablist"><button id="tab" role="tab" popovertarget="open">b</button></div>
          <button id="link" role="link" popovertarget="closed" aria-expanded="true">c</button>
          <button id="checkbox" role="checkbox" aria-checked="false" popovertarget="open">d</button>
          <button id="switch" role="switch" aria-checked="false" popovertarget="closed">e</button>
          <button id="combobox" role="combobox" popovertarget="closed" aria-expanded="true">f</button>
          <div role="tree"><button id="treeitem" role="treeitem" popovertarget="open">g</button></div>
          <div role="grid"><div role="row"><button id="gridcell" role="gridcell" popovertarget="closed">h</button></div></div>
          <button id="application" role="application" popovertarget="open">i</button>
          <button id="none" role="none" popovertarget="closed" aria-expanded="true">j</button>
          <button id="radio" role="radio" aria-checked="false" popovertarget="open">k</button>
          <button id="heading" role="heading" popovertarget="open">l</button>
          <button id="slider" role="slider" popovertarget="open" aria-valuenow="1">m</button>
          <div role="listbox"><button id="option" role="option" popovertarget="open">n</button></div>
          ${POPOVERS}
        `,
          "open",
        ),
      ).toEqual({
        menuitem: false,
        tab: true,
        link: false,
        checkbox: true,
        switch: false,
        combobox: false,
        treeitem: true,
        gridcell: false,
        application: true,
        // A focusable button ignores a presentational role.
        none: false,
        // Chromium has no expanded state for these roles.
        radio: undefined,
        heading: undefined,
        slider: undefined,
        option: undefined,
      });
    });
  });

  it("hides an element for every aria-hidden value Chromium hides it for", () => {
    const { nodes } = extractDomTree(
      createPage(`
        <div id="upper" role="group" aria-hidden="TRUE">a</div>
        <div id="yes" role="group" aria-hidden="yes">b</div>
        <div id="padded-false" role="group" aria-hidden=" false">c</div>
        <div id="false" role="group" aria-hidden="FALSE">d</div>
        <div id="empty" role="group" aria-hidden="">e</div>
        <div id="undefined" role="group" aria-hidden="UNDEFINED">f</div>
      `),
    );
    const byId: Record<string, unknown> = {};
    for (const node of nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id) byId[id] = [node.a11y.isExposedToAT, node.a11y.states["hidden"]];
    }
    expect(byId).toEqual({
      upper: [false, true],
      yes: [false, true],
      "padded-false": [false, true],
      false: [true, false],
      empty: [true, undefined],
      undefined: [true, undefined],
    });
  });

  it("skips script and style elements", () => {
    const root = createPage(`
      <p>Visible</p>
      <script>alert('hi')</script>
      <style>.x{color:red}</style>
    `);

    const { nodes } = extractDomTree(root);
    const allTags = Array.from(nodes.values()).map((n) => n.dom?.tagName);

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

    expect(link.dom?.attributes["id"]).toBe("home-link");
    expect(link.dom?.attributes["class"]).toBe("nav-link active");
    expect(link.dom?.attributes["href"]).toBe("/home");
  });

  // The testing matcher decides a select's role from these alone.
  it("stores a select's size and multiple", () => {
    const root = createPage(
      '<select aria-label="Tags" multiple size="3"><option>A</option></select>',
    );
    const { nodes, rootId } = extractDomTree(root);
    const select = nodes.get(nodes.get(rootId)!.childIds[0])!;

    expect(select.a11y.role).toBe("listbox");
    expect(select.dom?.attributes["size"]).toBe("3");
    expect(select.dom?.attributes["multiple"]).toBe("");
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
      (n) => n.dom?.tagName === "input" && n.dom?.attributes["type"] === "text",
    )!;
    expect(textInput.a11y.name).toBe("Full name");

    const emailInput = allNodes.find(
      (n) =>
        n.dom?.tagName === "input" && n.dom?.attributes["type"] === "email",
    )!;
    expect(emailInput.a11y.name).toBe("Email address");

    const textarea = allNodes.find((n) => n.dom?.tagName === "textarea")!;
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
      (n) => n.dom?.tagName === "input",
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
      const code = [...nodes.values()].find((n) => n.dom?.tagName === "code")!;

      expect(code.dom?.descendantText).toBe(
        "npm install @real-a11y-dev/inspector",
      );
      // Direct textContent stays empty — the spans are children, not text nodes.
      expect(code.dom?.textContent).toBe("");
    });

    it("collapses whitespace in descendantText", () => {
      const root = createPage(`
        <div>
          <span>line one</span>
          <span>line two</span>
        </div>
      `);

      const div = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom?.tagName === "div" && n.parentId !== null,
      )!;

      // Newlines + indentation between spans collapse to a single space.
      expect(div.dom?.descendantText).toBe("line one line two");
    });

    it("truncates very long text with an ellipsis", () => {
      const longText = "x".repeat(500);
      const root = createPage(
        `<pre><code><span>${longText}</span></code></pre>`,
      );

      const code = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom?.tagName === "code",
      )!;

      expect(code.dom?.descendantText.length).toBeLessThanOrEqual(240);
      expect(code.dom?.descendantText.endsWith("…")).toBe(true);
    });

    it("returns empty string for elements with no text", () => {
      const root = createPage(`<div><img alt="" /><br /></div>`);
      const div = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom?.tagName === "div" && n.parentId !== null,
      )!;
      expect(div.dom?.descendantText).toBe("");
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

  // accname-1.2 §4.3.2 step 2F appends each descendant's contribution "with a
  // space". The extractor used to concatenate element children with no
  // separator at all, so a button whose label is split across two blocks came
  // out as one glued word ("Savenow" where Chromium reads "Save now").
  // Spacing follows computed `display`, so children that flow inline still read
  // as one word. Every expectation here is what Chromium 141 computes for the
  // same markup, read back over CDP.
  //
  // Not covered here, because jsdom cannot see it: CSS blockifies a flex or grid
  // item, a float and an absolutely positioned child, so those arrive at the
  // check as `block` in a browser and are spaced (Chromium spaces them too).
  // jsdom reports the authored `inline` instead, so a test would assert the
  // opposite of the shipped behaviour.
  describe("name-from-content separates children that render as blocks", () => {
    function nameOfTag(html: string, tag: string): string {
      const root = createPage(html);
      // Attached so getComputedStyle resolves the default display values.
      document.body.appendChild(root);
      try {
        const node = [...extractDomTree(root).nodes.values()].find(
          (n) => n.dom?.tagName === tag,
        )!;
        return node.a11y.name;
      } finally {
        document.body.removeChild(root);
      }
    }

    it("spaces two block children of a button", () => {
      expect(
        nameOfTag("<button><div>Save</div><div>now</div></button>", "button"),
      ).toBe("Save now");
    });

    it("spaces block children of a heading", () => {
      expect(nameOfTag("<h1><p>One</p><p>Two</p></h1>", "h1")).toBe("One Two");
    });

    it("spaces across a <br>, which ends the line from inside an inline box", () => {
      expect(nameOfTag('<a href="/">Read<br>more</a>', "a")).toBe("Read more");
    });

    it("spaces an atomic inline-level box", () => {
      expect(
        nameOfTag(
          '<button><span style="display: inline-block">Sa</span><span style="display: inline-block">ve</span></button>',
          "button",
        ),
      ).toBe("Sa ve");
    });

    it("lets an empty block separate the text either side of it", () => {
      expect(nameOfTag("<button>Save<div></div>now</button>", "button")).toBe(
        "Save now",
      );
    });

    it("lets a name-barrier child's box separate the text around it", () => {
      // <input> lends no text to a name, but Chromium still reads "Save now".
      expect(nameOfTag("<h1>Save<input>now</h1>", "h1")).toBe("Save now");
    });

    it("lets a name-barrier container's box separate the text around it", () => {
      expect(
        nameOfTag(
          '<h1>Save<div role="group"><span>x</span></div>now</h1>',
          "h1",
        ),
      ).toBe("Save now");
    });

    it("lets a rendered aria-hidden child separate the text around it", () => {
      expect(
        nameOfTag('<h1>Save<div aria-hidden="true">x</div>now</h1>', "h1"),
      ).toBe("Save now");
    });

    it("does not separate across a child with no box at all", () => {
      expect(
        nameOfTag('<h1>Save<div style="display: none">x</div>now</h1>', "h1"),
      ).toBe("Savenow");
    });

    it("does not space an inline named widget's contributed name", () => {
      // The link lends the button its computed name; an inline link flows with
      // the text beside it, so Chromium reads one word.
      expect(nameOfTag('<button><a href="#">Sa</a>ve</button>', "button")).toBe(
        "Save",
      );
    });

    it("keeps an inline named widget out of the middle of a word", () => {
      expect(
        nameOfTag(`<h2>Signed in as <a href="/u">Ada</a>'s profile</h2>`, "h2"),
      ).toBe("Signed in as Ada's profile");
    });

    it("spaces a named widget that renders as its own block", () => {
      expect(
        nameOfTag(
          '<button><a href="#" style="display: block">Sa</a>ve</button>',
          "button",
        ),
      ).toBe("Sa ve");
    });

    it("spaces a <summary> however it is styled", () => {
      // Chromium separates the disclosure's label whatever its display is:
      // an author's `display: inline` on it still reads "Note S Body".
      expect(
        nameOfTag(
          '<h3>Note<details open><summary style="display: inline">S</summary>Body</details></h3>',
          "h3",
        ),
      ).toBe("Note S Body");
    });

    it("does not space inline children, which read as one word", () => {
      expect(
        nameOfTag("<button><span>Sa</span><span>ve</span></button>", "button"),
      ).toBe("Save");
    });

    it("follows an inline override on a block element", () => {
      expect(
        nameOfTag(
          '<button><div style="display: inline">Sa</div><div style="display: inline">ve</div></button>',
          "button",
        ),
      ).toBe("Save");
    });

    it("keeps a single space around a nested inline child", () => {
      expect(
        nameOfTag('<a href="/"><div>Read <span>more</span></div></a>', "a"),
      ).toBe("Read more");
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
        (n) => n.dom?.tagName === "a",
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
        (n) => n.dom?.tagName === "button",
      )!;
      expect(btn.a11y.name.replace(/\s+/g, " ").trim()).toBe("Close dialog");
    });

    // Checked against Chromium 151, which hides for any aria-hidden value
    // but `false`, empty or `undefined`, in any case.
    it("skips a descendant for every aria-hidden value Chromium hides it for", () => {
      const root = createPage(`
        <button id="button">
          <span aria-hidden="TRUE">×</span>
          <span aria-hidden="yes">✓</span>
          <span aria-hidden="FALSE">Close</span>
          <span aria-hidden="">dialog</span>
        </button>
        <label>
          Email <span aria-hidden="True">*</span>
          <input id="input" type="email">
        </label>
        <table id="table">
          <caption aria-hidden="yes">Decorative</caption>
          <tr><td>1</td></tr>
        </table>
      `);
      const byId: Record<string, string> = {};
      for (const node of extractDomTree(root).nodes.values()) {
        const id = node.dom?.attributes["id"];
        if (id) byId[id] = node.a11y.name.replace(/\s+/g, " ").trim();
      }
      expect(byId).toEqual({
        button: "Close dialog",
        input: "Email",
        table: "",
      });
    });

    it("skips a [hidden] descendant in a heading's name-from-content", () => {
      const root = createPage(`
        <h1>
          <span hidden>draft</span>
          Real A11y
        </h1>
      `);
      const h1 = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom?.tagName === "h1",
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
          (n) => n.dom?.tagName === "button",
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
          (n) => n.dom?.tagName === "button",
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
        (n) => n.dom?.tagName === "input",
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
        (n) => n.dom?.tagName === "a",
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
        (n) => n.dom?.attributes["id"] === "reports",
      )!;
      expect(reports.a11y.name).toBe("Reports");
      // The nested rows still appear as their own nodes with their own names.
      const inner = [...extractDomTree(root).nodes.values()].filter(
        (n) =>
          n.a11y.role === "treeitem" && n.dom?.attributes["id"] !== "reports",
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
        (n) => n.dom?.attributes["id"] === "outer",
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
        (n) => n.dom?.attributes["id"] === "file",
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
        (n) => n.dom?.tagName === "button",
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
        (n) => n.dom?.attributes["id"] === "outer",
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
        (n) => n.dom?.attributes["id"] === "t1",
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
      fakeShowModal(
        appendOverlay(`
          <dialog aria-label="Confirm">
            <p>Are you sure?</p>
            <button>OK</button>
          </dialog>
        `),
      );
      appendOverlay(`<div role="status">Pending…</div>`);

      const tree = extractDomTree(appRoot);
      const allNodes = [...tree.nodes.values()];
      // Modal scope is exclusive: dialog yes, status no.
      expect(allNodes.some((n) => n.a11y.role === "dialog")).toBe(true);
      expect(allNodes.some((n) => n.a11y.role === "status")).toBe(false);
    });

    it("pivots exclusively to a <dialog> opened with showModal()", () => {
      // The browser makes the page behind a :modal dialog inert, and
      // Chromium's own tree drops it — so we pivot: the dialog appears and
      // the page behind it is dropped.
      fakeShowModal(
        appendOverlay(`
          <dialog aria-labelledby="t">
            <h2 id="t">Confirm deletion</h2>
            <p>This action cannot be undone.</p>
            <button>Close</button>
          </dialog>
        `),
      );

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

    it("treats aria-modal as an ordinary overlay, as Chromium's tree does", () => {
      // aria-modal is an author's claim, not something the browser enforces,
      // and Chromium keeps the page behind it. A cookie bar marked
      // aria-modal="true" must not collapse an interactive page to its
      // buttons: the page stays AND the dialog joins the tree.
      appendOverlay(`
        <div role="alertdialog" aria-modal="true" aria-label="Privacy Preferences">
          <button>I accept</button>
        </div>
      `);

      const tree = extractDomTree(appRoot);
      const allNodes = [...tree.nodes.values()];
      expect(allNodes.some((n) => n.a11y.name === "Open menu")).toBe(true);
      expect(
        allNodes.some(
          (n) => n.a11y.role === "button" && n.a11y.name === "I accept",
        ),
      ).toBe(true);
    });

    it("a closed aria-hidden aria-modal drawer does not blank the page", () => {
      // A nav drawer left mounted while closed — aria-hidden, and moved
      // off-screen with a transform, so it passes a CSS visibility check.
      // It used to win the modal scope, and since everything in it is
      // aria-hidden, the whole page extracted as an EMPTY tree.
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div role="dialog" aria-modal="true" aria-hidden="true"
              aria-label="Navigation Bar" style="transform: translateX(1280px)">
           <a href="/menu">Menu link</a>
         </div>`,
      );

      const tree = extractA11yTree(document.body);
      const allNodes = [...tree.nodes.values()];
      expect(allNodes.some((n) => n.a11y.name === "Open menu")).toBe(true);
      expect(allNodes.some((n) => n.a11y.name === "Menu link")).toBe(false);
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
      expect(rootNode.dom?.attributes["id"]).toBe("app-root");
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
      expect(rootNode.dom?.attributes["id"]).toBe("app-root");
    });

    // A tree that pivoted to body swallows every body child, so the honest
    // probe for "did the scope pivot?" is whether content outside `root`
    // came along — NOT the root node's id. When body is the effective root,
    // `walk` returns body's first child as `rootId`, which is the app root
    // either way.
    const idsIn = (root: Element) =>
      [...extractDomTree(root).nodes.values()].map(
        (n) => n.dom?.attributes["id"],
      );

    it("ignores an empty live-region announcer shell (no pivot)", () => {
      // Toast libraries (Sonner, react-hot-toast, Radix Toast) and most
      // component kits mount a PERMANENT, usually-empty announcer at body
      // level on mount. It is display-visible, so a visibility-only check
      // treats it as a showing overlay — and because it never goes away, the
      // pivot never goes away either: the caller's `root` is dead for the
      // rest of the session rather than just while a toast is up.
      appendOverlay(`<div id="announcer" aria-live="polite"></div>`);

      expect(idsIn(appRoot)).not.toContain("announcer");
    });

    it("ignores an empty toast/status container (no pivot)", () => {
      // Same shell, spelled with role= instead of aria-live, and nested the
      // way a real toast viewport is (an empty stack inside a wrapper).
      appendOverlay(
        `<div id="toaster" role="status"><ol class="toast-viewport"></ol></div>`,
      );

      expect(idsIn(appRoot)).not.toContain("toaster");
    });

    it("ignores an empty viewport that carries tabindex for focus management", () => {
      // The shape Radix Toast and Sonner actually render while holding zero
      // toasts: the stack gets `tabindex="-1"` so focus can be moved into it
      // later. Counting a bare tabindex as content would let precisely the
      // shells this guard exists to catch straight back through.
      appendOverlay(
        `<div id="toaster" role="status" aria-live="polite"><ol tabindex="-1"></ol></div>`,
      );

      expect(idsIn(appRoot)).not.toContain("toaster");
    });

    it("still pivots once the announcer actually holds a message", () => {
      // The other half of the contract: an announcer with content IS a
      // showing overlay, so the pivot must still happen. Guards against
      // over-correcting the empty-shell case into "never pivot for a live
      // region".
      appendOverlay(`<div id="announcer" aria-live="polite">Saved</div>`);

      expect(idsIn(appRoot)).toContain("announcer");
    });

    it("still pivots for an empty overlay that is interactive", () => {
      // "Has no text" is not the same as "has nothing". A menu whose items
      // are icon-only buttons has no collapsed text but is absolutely
      // showing, so a text-only emptiness test would regress it.
      appendOverlay(
        `<div id="menu" role="menu"><button aria-label="Delete"></button></div>`,
      );

      expect(idsIn(appRoot)).toContain("menu");
    });

    afterEach(() => {
      document.body.innerHTML = "";
    });
  });
});

describe("name from content covers the whole ARIA 1.2 role set", () => {
  // The role whitelist behind step 8 of the name computation used to hold only
  // button/link/heading/option/treeitem/tab/menuitem/cell, so a widget whose
  // label sat inside a child element — the normal shape for a custom control,
  // `<div role="checkbox"><span>Accept terms</span></div>` — came out nameless
  // while Chrome announced "Accept terms". Only markup with DIRECT text
  // children was unaffected, because the step-9 fallback catches that; that
  // near-miss is why this went unnoticed.
  const nameOf = (html: string): string => {
    const root = createPage(html);
    const node = [...extractDomTree(root).nodes.values()].find(
      (n) => n.dom?.attributes["id"] === "target",
    )!;
    return node.a11y.name;
  };

  it.each([
    ["checkbox", `<span>Accept terms</span>`, "Accept terms"],
    ["radio", `<span>Small</span>`, "Small"],
    ["switch", `<span>Dark mode</span>`, "Dark mode"],
    ["menuitemcheckbox", `<span>Word wrap</span>`, "Word wrap"],
    ["menuitemradio", `<span>Compact</span>`, "Compact"],
    ["gridcell", `<span>42</span>`, "42"],
    ["columnheader", `<span>Name</span>`, "Name"],
    ["rowheader", `<span>Row 1</span>`, "Row 1"],
    ["row", `<span>Totals</span>`, "Totals"],
    ["tooltip", `<span>Saves the file</span>`, "Saves the file"],
  ])("names a role=%s from wrapped content", (role, inner, expected) => {
    expect(nameOf(`<div id="target" role="${role}">${inner}</div>`)).toBe(
      expected,
    );
  });

  // Naming from content is the opposite direction to NAME_BARRIER_ROLES, and
  // most of these roles are in both sets. Adding them here must not start
  // leaking their text into a container's name.
  it("does not let a named-from-content cell leak into its row's name", () => {
    expect(
      nameOf(
        `<div id="target" role="row"><div role="cell">A</div><div role="cell">B</div></div>`,
      ),
    ).toBe("");
  });

  it("does not let a tooltip leak into the name of the widget hosting it", () => {
    expect(
      nameOf(
        `<button id="target">Save<span role="tooltip">Saves the file</span></button>`,
      ),
    ).toBe("Save");
  });

  // The barrier is what keeps a real grid's rows quiet: ARIA requires a row's
  // children to be cells, and a gridcell contributes nothing upward, so the
  // checkbox inside it never reaches the row's name however deeply it nests.
  it("keeps a row silent when its widget sits in a gridcell, as ARIA requires", () => {
    expect(
      nameOf(
        `<div id="target" role="row"><div role="gridcell"><div role="checkbox"><span>Accept</span></div></div></div>`,
      ),
    ).toBe("");
  });

  // A widget as a row's DIRECT child is malformed grid markup, and there the
  // named-widget recursion of accname §2F.iii applies: the checkbox
  // contributes its computed name, which is what Chrome exposes. Not new
  // behaviour — `<div role="cell"><div role="checkbox">…` took this same path
  // before — but `row` reaches it now, so pin it rather than leave it to be
  // rediscovered as a surprise.
  it("takes a directly-nested widget's computed name into a row's name", () => {
    expect(
      nameOf(
        `<div id="target" role="row"><div role="checkbox"><span>Accept</span></div></div>`,
      ),
    ).toBe("Accept");
  });
});

// The last step of the name computation takes an element's DIRECT text. That is
// right for a paragraph or list item, whose text is their content, and it is
// what keeps a text-bearing generic in the a11y view. It is wrong for a role
// only an author can name: Chromium leaves every one below unnamed, and a name
// taken from a loose sentence made `dialog-labeled`, `image-alt` and
// `no-unlabeled-interactive` pass markup AT announces with no name at all.
// Every expectation is what Chromium 151 computes for the same markup (CDP).
describe("the direct-text fallback skips author-named roles", () => {
  const target = (html: string) => {
    const root = createPage(html);
    document.body.appendChild(root);
    try {
      return [...extractA11yTree(root).nodes.values()].find(
        (n) => n.dom?.attributes["id"] === "t",
      )!;
    } finally {
      root.remove();
    }
  };

  it.each([
    [
      "dialog",
      `<div id="t" role="dialog">Delete this project? <button>Cancel</button></div>`,
    ],
    [
      "dialog",
      `<dialog id="t" open>Discard changes? <button>OK</button></dialog>`,
    ],
    [
      "alertdialog",
      `<div id="t" role="alertdialog">Session expired <button>Renew</button></div>`,
    ],
    ["img", `<div id="t" role="img">text img</div>`],
    // ARIA 1.3's `image` is a synonym of `img`: same role, same unnamed text.
    ["img", `<span id="t" role="image">🎉</span>`],
    ["form", `<form id="t">Search: <input></form>`],
    ["navigation", `<nav id="t">Menu: <a href="#">Home</a></nav>`],
    ["main", `<main id="t">Welcome <a href="#">x</a></main>`],
    ["banner", `<header id="t">Site <a href="#">x</a></header>`],
    ["contentinfo", `<footer id="t">Copyright <a href="#">x</a></footer>`],
    ["complementary", `<aside id="t">Aside <a href="#">x</a></aside>`],
    ["search", `<search id="t">Find: <input></search>`],
    ["article", `<article id="t">Article text</article>`],
    ["figure", `<figure id="t">Loose <img alt="a"></figure>`],
    ["group", `<div id="t" role="group">Shipping <input></div>`],
    ["group", `<address id="t">Contact <a href="#">x</a></address>`],
    // A closed <details> with no <summary>: its loose text is the hidden BODY.
    ["group", `<details id="t">Hidden body</details>`],
    ["application", `<div id="t" role="application">App</div>`],
    ["document", `<div id="t" role="document">Doc</div>`],
    ["feed", `<div id="t" role="feed">Feed <article>a</article></div>`],
    ["note", `<div id="t" role="note">Note text</div>`],
    ["tabpanel", `<div id="t" role="tabpanel">Panel text</div>`],
    ["textbox", `<textarea id="t">typed text</textarea>`],
    [
      "textbox",
      `<div id="t" role="textbox" contenteditable="true">typed text</div>`,
    ],
    [
      "searchbox",
      `<div id="t" role="searchbox" contenteditable="true">query</div>`,
    ],
    ["combobox", `<div id="t" role="combobox" tabindex="0">Selected</div>`],
    [
      "listbox",
      `<div id="t" role="listbox">Pick: <div role="option">A</div></div>`,
    ],
    ["slider", `<div id="t" role="slider" tabindex="0">5 units</div>`],
    ["spinbutton", `<div id="t" role="spinbutton" tabindex="0">5</div>`],
    ["scrollbar", `<div id="t" role="scrollbar">sb</div>`],
    ["progressbar", `<progress id="t" value="3" max="10">30%</progress>`],
    ["meter", `<meter id="t" value="3" max="10">3 of 10</meter>`],
    ["separator", `<div id="t" role="separator" tabindex="0">sep</div>`],
    ["menu", `<div id="t" role="menu">Menu <div role="menuitem">a</div></div>`],
    [
      "menubar",
      `<div id="t" role="menubar">Bar <div role="menuitem">a</div></div>`,
    ],
    [
      "tablist",
      `<div id="t" role="tablist">Tabs: <div role="tab">a</div></div>`,
    ],
    ["toolbar", `<div id="t" role="toolbar">Tools: <button>a</button></div>`],
    ["tree", `<div id="t" role="tree">Tree <div role="treeitem">a</div></div>`],
    [
      "treegrid",
      `<div id="t" role="treegrid">TG <div role="row"><div role="gridcell">a</div></div></div>`,
    ],
    [
      "grid",
      `<div id="t" role="grid">G <div role="row"><div role="gridcell">a</div></div></div>`,
    ],
    [
      "table",
      `<div id="t" role="table">T <div role="row"><div role="cell">a</div></div></div>`,
    ],
    [
      "rowgroup",
      `<div id="t" role="rowgroup">RG <div role="row"><div role="cell">a</div></div></div>`,
    ],
    [
      "radiogroup",
      `<div id="t" role="radiogroup">Size: <input type="radio"></div>`,
    ],
    ["list", `<div id="t" role="list">List <div role="listitem">a</div></div>`],
  ])("leaves a %s unnamed by its loose text", (role, html) => {
    const node = target(html);
    expect(node.a11y.role).toBe(role);
    expect(node.a11y.name).toBe("");
  });

  // What the fallback is FOR. The prose roles' text is their content — the
  // native producer takes it too (NATIVE_AX_OWN_TEXT_ROLES) — and a generic's
  // direct text is what keeps it in the a11y view. A live region's text is
  // the announcement itself, and no audit reads its name: blanking it would
  // blank every toast and error message in a snapshot.
  it.each([
    ["paragraph", `<p id="t">Para <a href="#">x</a></p>`, "Para"],
    ["listitem", `<ul><li id="t">Item <a href="#">x</a></li></ul>`, "Item"],
    [
      "blockquote",
      `<blockquote id="t">Quote <a href="#">x</a></blockquote>`,
      "Quote",
    ],
    ["term", `<dl><dt id="t">Term</dt><dd>d</dd></dl>`, "Term"],
    [
      "definition",
      `<dl><dt>t</dt><dd id="t">Def <a href="#">x</a></dd></dl>`,
      "Def",
    ],
    ["code", `<code id="t">npm i <a href="#">x</a></code>`, "npm i"],
    ["time", `<time id="t">today <b>x</b></time>`, "today"],
    ["generic", `<div id="t">Loose text <a href="#">x</a></div>`, "Loose text"],
    [
      "alert",
      `<div id="t" role="alert">Email is required</div>`,
      "Email is required",
    ],
    ["status", `<div id="t" role="status">3 results</div>`, "3 results"],
    ["status", `<output id="t">42</output>`, "42"],
    ["log", `<div id="t" role="log">connected</div>`, "connected"],
    ["timer", `<div id="t" role="timer">0:30</div>`, "0:30"],
    ["marquee", `<div id="t" role="marquee">ticker</div>`, "ticker"],
  ])("still names a %s from its own text", (role, html, expected) => {
    const node = target(html);
    expect(node.a11y.role).toBe(role);
    expect(node.a11y.name).toBe(expected);
  });

  // Only the LOOSE-TEXT step is skipped: every author mechanism still names
  // these roles, and an alt/labelledby/title is never mistaken for loose text.
  it.each([
    [
      `<div id="t" role="dialog" aria-label="Delete project">Sure? <button>OK</button></div>`,
      "Delete project",
    ],
    [
      `<h2 id="h">Delete project</h2><div id="t" role="dialog" aria-labelledby="h">Sure? <button>OK</button></div>`,
      "Delete project",
    ],
    [`<nav id="t" title="Primary">Menu: <a href="#">Home</a></nav>`, "Primary"],
    [
      `<fieldset id="t"><legend>Shipping</legend>Loose <input></fieldset>`,
      "Shipping",
    ],
    [`<details id="t" open><summary>More</summary>Body</details>`, "More"],
  ])("keeps an author-given name: %s", (html, expected) => {
    expect(target(html).a11y.name).toBe(expected);
  });

  // An authored role outranks a name-from-content TAG, so these never reach
  // the text-content step either. The first is the Radix Select trigger,
  // whose text is the selected value.
  it.each([
    [
      "combobox",
      `<button id="t" role="combobox" aria-expanded="false">Apple</button>`,
    ],
    ["img", `<a id="t" href="#" role="img">logo text</a>`],
    // The synonym has to be folded before the name-from-content test too, or
    // the tag wins it back: this was `image "🎉"` while Chromium says unnamed.
    ["img", `<button id="t" role="image">🎉</button>`],
    ["img", `<a id="t" href="#" role="image">logo text</a>`],
    ["dialog", `<a id="t" href="#" role="dialog">Dialog text</a>`],
    ["tabpanel", `<h2 id="t" role="tabpanel">Panel</h2>`],
  ])("leaves a %s on a name-from-content tag unnamed", (role, html) => {
    const node = target(html);
    expect(node.a11y.role).toBe(role);
    expect(node.a11y.name).toBe("");
  });

  it("still names a name-from-content role on such a tag", () => {
    expect(target(`<button id="t" role="tab">Tab A</button>`).a11y.name).toBe(
      "Tab A",
    );
  });
});

// A `<details>` inside a heading/button/link. Its implicit role is `group`,
// a name barrier, so the whole disclosure used to vanish from the ancestor's
// name — e.g. a GitHub comment header read "user commented •" without the
// "edited by …" summary. Every expectation below is what Chromium's own
// accessibility tree computes for the same markup (measured over CDP).
describe("name from content through a <details>", () => {
  function nameOf(html: string): string {
    const root = createPage(html);
    document.body.appendChild(root);
    try {
      const target = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom?.attributes["id"] === "t",
      )!;
      return target.a11y.name;
    } finally {
      root.remove();
    }
  }

  it("includes a closed details' summary, but not its hidden body", () => {
    expect(
      nameOf(`<h3 id="t">A <details><summary>S</summary>Body</details> Z</h3>`),
    ).toBe("A S Z");
  });

  it("includes the whole disclosure once it is open", () => {
    expect(
      nameOf(
        `<h3 id="t">A <details open><summary>S</summary>Body</details> Z</h3>`,
      ),
    ).toBe("A S Body Z");
  });

  it("names a GitHub-style edited comment header in full", () => {
    expect(
      nameOf(`<h3 id="t">user commented <span>•</span>
        <details class="details-overlay"><summary role="button" aria-haspopup="menu">
          <div><span> edited by bot <span>Bot</span></span><svg aria-hidden="true"></svg></div>
        </summary><div>menu body</div></details></h3>`),
    ).toBe("user commented • edited by bot Bot");
  });

  it("uses only the first summary of a closed details", () => {
    expect(
      nameOf(
        `<h3 id="t">A <details><summary>S1</summary><summary>S2</summary>Body</details> Z</h3>`,
      ),
    ).toBe("A S1 Z");
  });

  it("hides a closed inner details' body inside an open outer one", () => {
    expect(
      nameOf(
        `<h3 id="t">A <details open><summary>S</summary><details><summary>T</summary>Inner</details></details> Z</h3>`,
      ),
    ).toBe("A S T Z");
  });

  it("works inside a button too", () => {
    expect(
      nameOf(
        `<button id="t">A <details><summary>S</summary>Body</details> Z</button>`,
      ),
    ).toBe("A S Z");
  });

  it("keeps an explicit role=group a barrier, as Chromium does", () => {
    expect(
      nameOf(
        `<h3 id="t">A <details role="group"><summary>S</summary>Body</details> Z</h3>`,
      ),
    ).toBe("A Z");
  });

  it("hides a closed body even when the details is role=none", () => {
    expect(
      nameOf(
        `<h3 id="t">A <details role="none"><summary>S</summary>Body</details> Z</h3>`,
      ),
    ).toBe("A S Z");
  });

  it("describes through a details without doubling the space", () => {
    const root = createPage(
      `<button id="t" aria-describedby="d">Go</button><div id="d">X <details><summary>S</summary>Body</details></div>`,
    );
    document.body.appendChild(root);
    try {
      const btn = [...extractDomTree(root).nodes.values()].find(
        (n) => n.dom?.attributes["id"] === "t",
      )!;
      expect(btn.a11y.description).toBe("X S");
    } finally {
      root.remove();
    }
  });

  it("still skips an aria-hidden summary", () => {
    expect(
      nameOf(
        `<h3 id="t">A <details><summary aria-hidden="true">S</summary>Body</details> Z</h3>`,
      ),
    ).toBe("A Z");
  });
});

// Chromium renders a closed `<details>` as its summary alone: the body sits in
// a UA slot that hides it, so its accessibility tree omits the body and Tab
// never reaches a control in it. Nothing on the body's own nodes says so, so
// the walk has to know the rule. Every expectation below is Chromium 151's
// own tree for the same markup, read over CDP.
describe("a closed <details> renders only its summary", () => {
  function tags(html: string): string[] {
    return [...extractDomTree(createPage(html)).nodes.values()].map(
      (n) => n.dom!.tagName,
    );
  }

  function namesOf(html: string): string[] {
    return [...extractDomTree(createPage(html)).nodes.values()].map(
      (n) => n.a11y.name,
    );
  }

  it("walks the summary but not the body", () => {
    const names = namesOf(
      `<main><details><summary>S</summary><a href="/x">Hidden link</a><button>Hidden button</button></details><a href="/y">Visible</a></main>`,
    );
    expect(names).not.toContain("Hidden link");
    expect(names).not.toContain("Hidden button");
    expect(names).toContain("Visible");
    expect(tags(`<details><summary>S</summary><p>Body</p></details>`)).toEqual([
      "div",
      "details",
      "summary",
    ]);
  });

  it("walks the whole disclosure once it is open", () => {
    const names = namesOf(
      `<details open><summary>S</summary><a href="/x">Body link</a><button>Body button</button></details>`,
    );
    expect(names).toContain("Body link");
    expect(names).toContain("Body button");
  });

  it("hides a details nested in a closed body, summary and all", () => {
    const html = `<details><summary>Outer</summary><details><summary>Inner</summary><a href="/i">Inner link</a></details></details>`;
    expect(tags(html)).toEqual(["div", "details", "summary"]);
    expect(namesOf(html)).not.toContain("Inner");
  });

  it("walks a closed inner details' summary inside an open outer one", () => {
    const html = `<details open><summary>Outer</summary><details><summary>Inner</summary><a href="/i">Inner link</a></details></details>`;
    expect(tags(html)).toEqual([
      "div",
      "details",
      "summary",
      "details",
      "summary",
    ]);
  });

  it("walks the first summary child, even after other content", () => {
    const tree = extractDomTree(
      createPage(
        `<details>Loose text<a href="/l">Before</a><summary>First</summary><summary>Second</summary><button>After</button></details>`,
      ),
    );
    const nodes = [...tree.nodes.values()];
    expect(nodes.map((n) => n.dom!.tagName)).toEqual([
      "div",
      "details",
      "summary",
    ]);
    expect(nodes[2]!.dom!.textContent).toBe("First");
  });

  it("hides a closed body whatever the details' role is", () => {
    for (const role of ["none", "group", "button"]) {
      expect(
        namesOf(
          `<details role="${role}" aria-label="G"><summary>S</summary><button>Hidden B</button></details>`,
        ),
      ).not.toContain("Hidden B");
    }
  });

  it("keeps the summary's own content, controls included", () => {
    const names = namesOf(
      `<details><summary>S <a href="/in">In summary</a></summary><a href="/x">Body</a></details>`,
    );
    expect(names).toContain("In summary");
    expect(names).not.toContain("Body");
  });

  it("gives a closed details with no summary no children", () => {
    const tree = extractDomTree(
      createPage(`<details><a href="/n">No-summary link</a></details>`),
    );
    const details = [...tree.nodes.values()].find(
      (n) => n.dom!.tagName === "details",
    )!;
    expect(details.childIds).toEqual([]);
  });

  it("leaves the hidden body's text out of the details' text previews", () => {
    const tree = extractDomTree(
      createPage(
        `<details>Loose text<summary>S</summary>More text<p>Body</p></details>`,
      ),
    );
    const details = [...tree.nodes.values()].find(
      (n) => n.dom!.tagName === "details",
    )!;
    expect(details.dom!.textContent).toBe("");
    expect(details.dom!.descendantText).toBe("S");
  });

  it("keeps a description target whose only referrer is in a closed body", () => {
    // The input is never rendered, so its aria-describedby reaches nobody and
    // the help text is ordinary visible content. Folding it into a node that
    // is no longer in the tree lost it altogether.
    const root = createPage(
      `<details><summary>S</summary><input aria-label="Code" aria-describedby="help"></details><p id="help">Help text</p>`,
    );
    document.body.appendChild(root);
    try {
      const names = [...extractDomTree(root).nodes.values()].map(
        (n) => n.dom?.textContent,
      );
      expect(names).toContain("Help text");
    } finally {
      root.remove();
    }
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
        (n) => n.dom?.attributes["id"] === "outer",
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
    expect(node.dom?.attributes["value"]).toBe("[redacted]");
    expect(JSON.stringify(node)).not.toContain("hunter2");
  });

  it("redacts a credit-card field's value by autocomplete token", () => {
    const node = firstChild(
      createPage(`<input autocomplete="cc-number" value="4111111111111111">`),
    );
    expect(node.dom?.attributes["value"]).toBe("[redacted]");
    expect(JSON.stringify(node)).not.toContain("4111111111111111");
  });

  it("preserves ordinary text-input values", () => {
    const node = firstChild(
      createPage(`<input type="text" value="Ada Lovelace">`),
    );
    expect(node.dom?.attributes["value"]).toBe("Ada Lovelace");
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

describe("a <textarea>'s markup text is its default value, never text (ADR-0001)", () => {
  const SECRET = "4111111111111111";
  const extracted = (root: Element) =>
    JSON.stringify([...extractDomTree(root).nodes.values()]);
  /** The node for the element matching `selector`, from one extraction. */
  function nodeFor(root: Element, selector: string) {
    const target = root.querySelector(selector)!;
    const tree = extractDomTree(root);
    const refs = getElementRefs();
    return [...tree.nodes.values()].find((n) => refs.get(n.id) === target)!;
  }

  it("keeps a sensitive textarea's default out of its own text facets", () => {
    const root = createPage(
      `<textarea autocomplete="cc-number" aria-label="Card">${SECRET}</textarea>`,
    );
    const node = nodeFor(root, "textarea");
    expect(node.a11y.value).toBe("[redacted]");
    expect(node.dom?.textContent).toBe("");
    expect(node.dom?.descendantText).toBe("");
    expect(extracted(root)).not.toContain(SECRET);
  });

  it("keeps it out of every ancestor's text preview", () => {
    const root = createPage(
      `<div contenteditable="true" role="textbox" aria-label="C">Pay <span aria-hidden="true"><textarea autocomplete="cc-number" aria-label="Card">${SECRET}</textarea></span> now</div>`,
    );
    expect(extracted(root)).not.toContain(SECRET);
    expect(nodeFor(root, "[contenteditable]").dom?.descendantText).toBe(
      "Pay now",
    );
    expect(nodeFor(root, "span").dom?.descendantText).toBe("");
  });

  it("keeps it out of a name or description that references the field", () => {
    // In the document, so the IDREFs resolve.
    const root = createPage(
      `<input aria-labelledby="otp"><button aria-describedby="otp">Verify</button>` +
        `<textarea id="otp" autocomplete="one-time-code">${SECRET}</textarea>`,
    );
    document.body.appendChild(root);
    try {
      expect(nodeFor(root, "input").a11y.name).toBe("");
      expect(nodeFor(root, "button").a11y.description).toBe("");
      expect(extracted(root)).not.toContain(SECRET);
    } finally {
      root.remove();
    }
  });

  it("keeps it out whatever role the author gives the field", () => {
    const root = createPage(
      `<h2>Pay <textarea role="generic" autocomplete="cc-number">${SECRET}</textarea></h2>`,
    );
    expect(extracted(root)).not.toContain(SECRET);
  });

  it("reads an ordinary textarea's text as its value alone", () => {
    // The default is what it holds until edited — then it's stale as well.
    const root = createPage(
      `<p>Notes <textarea aria-label="Notes">first draft</textarea></p>`,
    );
    (root.querySelector("textarea") as HTMLTextAreaElement).value = "edited";
    const field = nodeFor(root, "textarea");
    expect(field.a11y.value).toBe("edited");
    expect(field.dom?.textContent).toBe("");
    expect(field.dom?.descendantText).toBe("");
    expect(nodeFor(root, "p").dom?.descendantText).toBe("Notes");
    expect(extracted(root)).not.toContain("first draft");
  });

  it("renders nothing a script puts inside one, so it can't fold a description target", () => {
    const root = createPage(
      `<textarea aria-label="Notes"></textarea><p id="help">Help text</p>`,
    );
    const ghost = document.createElement("input");
    ghost.setAttribute("aria-describedby", "help");
    root.querySelector("textarea")!.appendChild(ghost);
    const tags = [...extractDomTree(root).nodes.values()].map(
      (n) => n.dom?.tagName,
    );
    expect(tags).toContain("p");
    expect(tags).not.toContain("input");
  });
});

describe("isSensitiveFieldAttributes — the policy over markup alone (ADR-0001)", () => {
  it("flags a password input whatever the attribute's case", () => {
    expect(isSensitiveFieldAttributes("input", { type: "password" })).toBe(
      true,
    );
    expect(isSensitiveFieldAttributes("INPUT", { type: " Password " })).toBe(
      true,
    );
  });

  it("flags every credential and payment token, and nothing else", () => {
    for (const token of SENSITIVE_AUTOCOMPLETE_TOKENS) {
      expect(isSensitiveFieldAttributes("input", { autocomplete: token })).toBe(
        true,
      );
    }
    expect(
      isSensitiveFieldAttributes("select", {
        autocomplete: "section-a billing CC-EXP-MONTH",
      }),
    ).toBe(true);
    for (const autocomplete of ["email", "username", "off", "name", ""]) {
      expect(isSensitiveFieldAttributes("input", { autocomplete })).toBe(false);
    }
  });

  it("only ever flags a form field", () => {
    expect(
      isSensitiveFieldAttributes("div", {
        type: "password",
        autocomplete: "current-password",
      }),
    ).toBe(false);
    // A textarea's `type` is not a password type; its autocomplete still is.
    expect(isSensitiveFieldAttributes("textarea", { type: "password" })).toBe(
      false,
    );
    expect(
      isSensitiveFieldAttributes("textarea", { autocomplete: "one-time-code" }),
    ).toBe(true);
  });

  it("agrees with isSensitiveField on the same markup", () => {
    const fixtures = [
      `<input type="password">`,
      `<input autocomplete="cc-number">`,
      `<input type="text" autocomplete="email">`,
      `<select autocomplete="cc-exp"></select>`,
      `<textarea></textarea>`,
      `<div contenteditable="true"></div>`,
    ];
    for (const html of fixtures) {
      const div = document.createElement("div");
      div.innerHTML = html;
      const el = div.firstElementChild!;
      expect(
        isSensitiveFieldAttributes(el.tagName, {
          type: el.getAttribute("type"),
          autocomplete: el.getAttribute("autocomplete"),
        }),
        html,
      ).toBe(isSensitiveField(el));
    }
  });
});

describe("a11y.value — what a screen reader announces (ADR-0001)", () => {
  /** Extract `html` and return the node for the element matching `selector`. */
  function nodeFor(root: Element, selector: string) {
    const target = root.querySelector(selector)!;
    const tree = extractDomTree(root);
    const refs = getElementRefs();
    const node = [...tree.nodes.values()].find(
      (n) => refs.get(n.id) === target,
    );
    if (!node) throw new Error(`no node for ${selector}`);
    return node;
  }
  const valueOf = (html: string, selector: string) =>
    nodeFor(createPage(html), selector).a11y.value;

  it("reads a text field's current text, not its initial attribute", () => {
    const root = createPage(`<input aria-label="City" value="Lima">`);
    (root.querySelector("input") as HTMLInputElement).value = "Quito";
    expect(nodeFor(root, "input").a11y.value).toBe("Quito");
  });

  it("has no value when a field is empty", () => {
    expect(valueOf(`<input aria-label="City">`, "input")).toBeUndefined();
    expect(
      valueOf(`<textarea aria-label="Notes"></textarea>`, "textarea"),
    ).toBe(undefined);
  });

  it("collapses a textarea's whitespace", () => {
    expect(
      valueOf(
        `<textarea aria-label="Notes">line one\n\n   line two</textarea>`,
        "textarea",
      ),
    ).toBe("line one line two");
  });

  it("announces a <select>'s option LABEL, while dom.attributes keeps the raw value", () => {
    const root = createPage(
      `<select aria-label="Country"><option value="pt">Portugal</option><option value="es" selected>Spain</option></select>`,
    );
    const node = nodeFor(root, "select");
    expect(node.a11y.value).toBe("Spain");
    expect(node.dom?.attributes.value).toBe("es");
  });

  it("joins a multi-select's selected labels", () => {
    expect(
      valueOf(
        `<select multiple aria-label="Toppings"><option selected>Cheese</option><option>Ham</option><option selected>Basil</option></select>`,
        "select",
      ),
    ).toBe("Cheese, Basil");
  });

  it("reads a range widget's valuetext, else valuenow, else its native value", () => {
    expect(
      valueOf(
        `<div role="slider" aria-label="Rating" aria-valuenow="4" aria-valuetext="4 of 5 stars" tabindex="0"></div>`,
        "div",
      ),
    ).toBe("4 of 5 stars");
    expect(
      valueOf(
        `<div role="spinbutton" aria-label="Qty" aria-valuenow="3" tabindex="0"></div>`,
        "div",
      ),
    ).toBe("3");
    expect(
      valueOf(
        `<input type="range" aria-label="Volume" min="0" max="100" value="50">`,
        "input",
      ),
    ).toBe("50");
    expect(
      valueOf(
        `<progress aria-label="Upload" max="100" value="30"></progress>`,
        "progress",
      ),
    ).toBe("30");
    // Indeterminate: no value attribute, nothing announced.
    expect(
      valueOf(`<progress aria-label="Loading"></progress>`, "progress"),
    ).toBeUndefined();
  });

  it("has no value for controls whose state or name says it", () => {
    expect(
      valueOf(
        `<input type="checkbox" aria-label="Agree" value="yes" checked>`,
        "input",
      ),
    ).toBeUndefined();
    expect(
      valueOf(`<input type="radio" aria-label="Small" value="s">`, "input"),
    ).toBeUndefined();
    expect(valueOf(`<input type="submit" value="Send">`, "input")).toBe(
      undefined,
    );
    expect(
      valueOf(
        `<div role="switch" aria-checked="true" aria-label="Wi-Fi" tabindex="0">On</div>`,
        "div",
      ),
    ).toBeUndefined();
  });

  it("reads a file input's file names", () => {
    const root = createPage(`<input type="file" aria-label="Attach" multiple>`);
    Object.defineProperty(root.querySelector("input")!, "files", {
      value: [{ name: "report.pdf" }, { name: "photo.png" }],
    });
    expect(nodeFor(root, "input").a11y.value).toBe("report.pdf, photo.png");
  });

  it("reads an editor's text across its blocks, on the host only", () => {
    const root = createPage(
      `<div contenteditable="true" role="textbox" aria-label="Message"><p>Hello <b>team</b></p><p>second line</p></div>`,
    );
    expect(nodeFor(root, "[contenteditable]").a11y.value).toBe(
      "Hello team second line",
    );
    // The paragraph inside is part of the editor, not a field of its own.
    expect(nodeFor(root, "p").a11y.value).toBeUndefined();
  });

  it("reads a role-less editor host, and a plain ARIA textbox or combobox", () => {
    expect(
      valueOf(`<div contenteditable="plaintext-only">just typed</div>`, "div"),
    ).toBe("just typed");
    expect(
      valueOf(
        `<div role="combobox" aria-label="Fruit" tabindex="0">Apple</div>`,
        "div",
      ),
    ).toBe("Apple");
  });

  it("skips hidden text and a widget's own popup, which aren't announced as the value", () => {
    expect(
      valueOf(
        `<div role="combobox" aria-label="Fruit" tabindex="0">Apple<span hidden>(3 results)</span><span aria-hidden="true">▾</span></div>`,
        "[role=combobox]",
      ),
    ).toBe("Apple");
    // Checked against Chromium 151, which skips any aria-hidden value but
    // `false`, empty or `undefined`, in any case.
    expect(
      valueOf(
        `<div role="combobox" aria-label="Fruit" tabindex="0">Apple<span aria-hidden="TRUE">▾</span><span aria-hidden="yes">(3)</span><span aria-hidden="FALSE">!</span></div>`,
        "[role=combobox]",
      ),
    ).toBe("Apple!");
    expect(
      valueOf(
        `<div role="combobox" aria-label="Fruit" tabindex="0">Apple<ul role="listbox"><li role="option">Apple</li><li role="option">Pear</li></ul></div>`,
        "[role=combobox]",
      ),
    ).toBe("Apple");
  });

  // Chromium 151 reads an editor's value, and any ARIA textbox's or
  // searchbox's, as its RENDERED text, which knows nothing of ARIA: the
  // aria-hidden text and the popup stay in. Only a combobox you can't type
  // into is read as accessible text, as above. Measured over CDP
  // `Accessibility.getFullAXTree`.
  it("keeps aria-hidden text in an editor's value, as Chromium does", () => {
    expect(
      valueOf(
        `<div contenteditable="true" role="textbox" aria-label="C">Hello <span aria-hidden="true">[x]</span>world</div>`,
        "[contenteditable]",
      ),
    ).toBe("Hello [x]world");
    // A role-less host, a plaintext-only one, and a whole hidden paragraph.
    expect(
      valueOf(
        `<div contenteditable="true">Hello <span aria-hidden="true">[x]</span>world</div>`,
        "div",
      ),
    ).toBe("Hello [x]world");
    expect(
      valueOf(
        `<div contenteditable="plaintext-only" role="textbox" aria-label="C"><p>one</p><p aria-hidden="true">two</p><p>three</p></div>`,
        "[contenteditable]",
      ),
    ).toBe("one two three");
    // Inside a contenteditable="false" island, and under a nested textbox
    // whose text the host announces for it.
    expect(
      valueOf(
        `<div contenteditable="true" role="textbox" aria-label="C">a <span contenteditable="false">b <span aria-hidden="true">c</span></span> d</div>`,
        "[aria-label=C]",
      ),
    ).toBe("a b c d");
    expect(
      valueOf(
        `<div contenteditable="true" role="textbox" aria-label="C"><p>intro</p><div role="textbox" aria-label="Cell">cell <span aria-hidden="true">[x]</span>text</div></div>`,
        "[aria-label=C]",
      ),
    ).toBe("intro cell [x]text");
  });

  it("keeps aria-hidden text in an editable combobox's or searchbox's value", () => {
    expect(
      valueOf(
        `<div contenteditable="true" role="combobox" aria-label="C">Hello <span aria-hidden="true">[x]</span>world</div>`,
        "[role=combobox]",
      ),
    ).toBe("Hello [x]world");
    expect(
      valueOf(
        `<div contenteditable="true" role="searchbox" aria-label="C">Hello <span aria-hidden="true">[x]</span>world</div>`,
        "[role=searchbox]",
      ),
    ).toBe("Hello [x]world");
  });

  it("keeps aria-hidden text in an ARIA textbox's value even when it isn't editable", () => {
    expect(
      valueOf(
        `<div role="textbox" aria-label="C" tabindex="0">Hello <span aria-hidden="true">[x]</span>world</div>`,
        "[role=textbox]",
      ),
    ).toBe("Hello [x]world");
    expect(
      valueOf(
        `<div role="searchbox" aria-label="C" tabindex="0">Hello <span aria-hidden="true">[x]</span>world</div>`,
        "[role=searchbox]",
      ),
    ).toBe("Hello [x]world");
  });

  it("keeps a popup's text in an editor's or textbox's value", () => {
    expect(
      valueOf(
        `<div contenteditable="true" role="textbox" aria-label="C">Apple<ul role="listbox"><li role="option">Pear</li></ul></div>`,
        "[aria-label=C]",
      ),
    ).toBe("Apple Pear");
    expect(
      valueOf(
        `<div contenteditable="true" role="combobox" aria-label="C">Apple<ul role="listbox"><li role="option">Pear</li></ul></div>`,
        "[role=combobox]",
      ),
    ).toBe("Apple Pear");
    expect(
      valueOf(
        `<div role="textbox" aria-label="C" tabindex="0">Apple<ul role="listbox"><li role="option">Pear</li></ul></div>`,
        "[role=textbox]",
      ),
    ).toBe("Apple Pear");
  });

  it("still skips what isn't rendered in an editor, aria-hidden or not", () => {
    expect(
      valueOf(
        `<div contenteditable="true" role="textbox" aria-label="C">Hi <span aria-hidden="true" hidden>[x]</span><span aria-hidden="true" style="visibility:hidden">[v]</span><span aria-hidden="true" style="display:none">[d]</span>there</div>`,
        "[contenteditable]",
      ),
    ).toBe("Hi there");
  });

  it("never lets a sensitive control's text into an editor's value, even under aria-hidden", () => {
    const root = createPage(
      `<div contenteditable="true" role="textbox" aria-label="C">Pay <span aria-hidden="true"><textarea autocomplete="cc-number" aria-label="Card">4111111111111111</textarea><select autocomplete="cc-exp-month" aria-label="Month"><option selected>12</option></select><input type="password" aria-label="PIN" value="hunter2"></span> now</div>`,
    );
    expect(nodeFor(root, "[contenteditable]").a11y.value).toBe("Pay now");
    expect(nodeFor(root, "textarea").a11y.value).toBe("[redacted]");
    expect(nodeFor(root, "select").a11y.value).toBe("[redacted]");
    expect(nodeFor(root, "input").a11y.value).toBe("[redacted]");
  });

  it("skips visibility:hidden text, but reads a child that sets itself visible again", () => {
    expect(
      valueOf(
        `<div contenteditable="true">Visible <span style="visibility:hidden">secret <b style="visibility:visible">shown</b></span></div>`,
        "div",
      ),
    ).toBe("Visible shown");
  });

  it("reads only a closed <details>'s summary, and its body once opened", () => {
    expect(
      valueOf(
        `<div contenteditable="true">Note <details><summary>More</summary>Private text</details></div>`,
        "div",
      ),
    ).toBe("Note More");
    expect(
      valueOf(
        `<div contenteditable="true">Note <details open><summary>More</summary>Private text</details></div>`,
        "div",
      ),
    ).toBe("Note More Private text");
  });

  it("counts an editor's text once: a textbox nested inside it has no value of its own", () => {
    const root = createPage(
      `<div contenteditable="true" role="textbox" aria-label="Doc"><p>intro</p><div role="textbox" aria-label="Cell">cell text</div></div>`,
    );
    expect(nodeFor(root, "[aria-label=Doc]").a11y.value).toBe(
      "intro cell text",
    );
    expect(nodeFor(root, "[aria-label=Cell]").a11y.value).toBeUndefined();
  });

  it("keeps an editor's value when it contains native controls, like a task list's checkboxes", () => {
    expect(
      valueOf(
        `<div contenteditable="true" role="textbox" aria-label="Tasks"><ul><li><input type="checkbox"> Buy milk</li><li><input type="checkbox" checked> Call Ana</li></ul><input type="hidden" value="doc-1"></div>`,
        "[aria-label=Tasks]",
      ),
    ).toBe("Buy milk Call Ana");
  });

  it("leaves a nested <select>'s options and a <textarea>'s default text out of an editor's value", () => {
    const root = createPage(
      `<div contenteditable="true" role="textbox" aria-label="Form doc">Size: <select aria-label="Size"><option>Small</option><option selected>Large</option></select> Notes: <textarea aria-label="Notes">default text</textarea></div>`,
    );
    expect(nodeFor(root, "[aria-label='Form doc']").a11y.value).toBe(
      "Size: Notes:",
    );
    // Each control still announces its own value.
    expect(nodeFor(root, "select").a11y.value).toBe("Large");
  });

  it("lets an ARIA combobox read its own text when all it wraps is a hidden input", () => {
    expect(
      valueOf(
        `<div role="combobox" aria-label="Fruit" tabindex="0">Apple<input type="hidden" name="fruit" value="apple"></div>`,
        "[role=combobox]",
      ),
    ).toBe("Apple");
  });

  it("leaves the value to the native control an ARIA combobox wraps", () => {
    const root = createPage(
      `<div role="combobox" aria-label="State"><input aria-label="State" value="Ohio"><ul role="listbox"><li role="option">Ohio</li><li role="option">Utah</li></ul></div>`,
    );
    expect(nodeFor(root, "[role=combobox]").a11y.value).toBeUndefined();
    expect(nodeFor(root, "input").a11y.value).toBe("Ohio");
  });

  it("caps a long value at 240 characters with an ellipsis", () => {
    const value = nodeFor(
      createPage(
        `<textarea aria-label="Essay">${"word ".repeat(100)}</textarea>`,
      ),
      "textarea",
    ).a11y.value!;
    expect(value).toHaveLength(240);
    expect(value.endsWith("…")).toBe(true);
  });

  it("reads [redacted] for a filled sensitive field, and nothing for an empty one", () => {
    const filled = nodeFor(
      createPage(
        `<input type="password" aria-label="Password" value="hunter2">`,
      ),
      "input",
    );
    expect(filled.a11y.value).toBe("[redacted]");
    expect(JSON.stringify(filled)).not.toContain("hunter2");

    const card = nodeFor(
      createPage(
        `<input autocomplete="cc-number" aria-label="Card" value="4111111111111111">`,
      ),
      "input",
    );
    expect(card.a11y.value).toBe("[redacted]");
    expect(JSON.stringify(card)).not.toContain("4111111111111111");

    expect(
      valueOf(`<input type="password" aria-label="Password">`, "input"),
    ).toBeUndefined();
  });

  it("never names a field after its value", () => {
    const node = nodeFor(createPage(`<input value="typed">`), "input");
    expect(node.a11y.value).toBe("typed");
    expect(node.a11y.name).toBe("");
    // A role-less editor too: its loose text is what was typed, not a name.
    const editor = nodeFor(
      createPage(`<div contenteditable="true">typed here</div>`),
      "div",
    );
    expect(editor.a11y.value).toBe("typed here");
    expect(editor.a11y.name).toBe("");
  });

  it("drops only the value when a hostile getter throws, never the node", () => {
    const root = createPage(`<input aria-label="Trap">`);
    Object.defineProperty(root.querySelector("input")!, "value", {
      get() {
        throw new Error("gotcha");
      },
    });
    const node = nodeFor(root, "input");
    expect(node.a11y.name).toBe("Trap");
    expect(node.a11y.value).toBeUndefined();
  });
});

describe("input accessible name (HTML-AAM)", () => {
  const nameOf = (html: string) => {
    const root = createPage(html);
    const input = [...extractDomTree(root).nodes.values()].find(
      (n) => n.dom?.tagName === "input",
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
        (n) => n.dom?.tagName === "input",
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
      (n) => n.dom?.tagName === tagName,
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
    const tags = [...nodes.values()].map((n) => n.dom?.tagName);
    expect(tags).toContain("video");
    expect(tags).not.toContain("track");
    expect(tags).not.toContain("source");
    // Fallback link is unrendered content — must not leak into the tree.
    expect(tags).not.toContain("a");

    const video = [...nodes.values()].find((n) => n.dom?.tagName === "video")!;
    expect(video.childIds).toEqual([]);
  });

  it("does not take its accessible name or text preview from fallback content", () => {
    const node = mediaNode(
      `<video src="x.mp4">Sorry, your browser doesn't support embedded video.</video>`,
      "video",
    );
    // Chromium exposes an unlabeled <video> with an empty name.
    expect(node.a11y.name).toBe("");
    expect(node.dom?.textContent).toBe("");
    expect(node.dom?.descendantText).toBe("");
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
    expect(withControls.interaction?.isFocusable).toBe(true);
    expect(withControls.interaction?.actions).toContain("focus");

    const withoutControls = mediaNode(`<video src="x.mp4"></video>`, "video");
    expect(withoutControls.interaction?.isFocusable).toBe(false);
    expect(withoutControls.interaction?.actions).toEqual([]);
  });

  it("surfaces media attributes (controls/autoplay/muted/loop) for the panel", () => {
    const node = mediaNode(
      `<video controls autoplay muted loop src="x.mp4"></video>`,
      "video",
    );
    expect(node.dom?.attributes["controls"]).toBe("");
    expect(node.dom?.attributes["autoplay"]).toBe("");
    expect(node.dom?.attributes["muted"]).toBe("");
    expect(node.dom?.attributes["loop"]).toBe("");
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
      (n) => n.dom?.tagName === "figure",
    )!;
    expect(figure.dom?.descendantText).toBe("Product tour");
    expect(figure.dom?.descendantText).not.toContain("Sorry");
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
      (n) => n.dom?.tagName === "div" && n.parentId !== null,
    )!;
    expect(div.dom?.descendantText).toBe("Before After");
    expect(div.dom?.descendantText).not.toContain("fallback");
  });

  it("skips <source> inside <picture> too, keeping the <img>", () => {
    const root = createPage(`
      <picture>
        <source srcset="a.webp" type="image/webp">
        <img src="a.jpg" alt="A flower">
      </picture>
    `);
    const tags = [...extractDomTree(root).nodes.values()].map(
      (n) => n.dom?.tagName,
    );
    expect(tags).not.toContain("source");
    expect(tags).toContain("img");
  });
});

describe("interaction.isFocusable follows Chromium", () => {
  // Every expectation here was checked in Chromium 151, where a Tab walk,
  // scripted focus() and CDP's `focusable` property all agree.
  function focusableById(html: string): Record<string, boolean> {
    const byId: Record<string, boolean> = {};
    for (const node of extractDomTree(createPage(html)).nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id) byId[id] = node.interaction!.isFocusable;
    }
    return byId;
  }

  it("counts a link only when it has an href", () => {
    expect(
      focusableById(`
        <a id="fragment-target" name="top">Back to top</a>
        <a id="fake-button" role="button">Save</a>
        <a id="link" href="/docs">Docs</a>
        <a id="empty-href" href="">Reload</a>
        <a id="tabindexed" tabindex="0">Card</a>
        <svg>
          <a id="svg-href" href="/a"><text>A</text></a>
          <a id="svg-xlink" xlink:href="/b"><text>B</text></a>
          <a id="svg-bare"><text>C</text></a>
        </svg>
      `),
    ).toEqual({
      "fragment-target": false,
      "fake-button": false,
      link: true,
      "empty-href": true,
      tabindexed: true,
      // SVG 1.1's xlink:href still makes an SVG link, in Chromium too.
      "svg-href": true,
      "svg-xlink": true,
      "svg-bare": false,
    });
  });

  it("does not count a disabled control, however it came to be disabled", () => {
    expect(
      focusableById(`
        <button id="disabled" disabled>Save</button>
        <button id="disabled-tabindexed" disabled tabindex="0">Save</button>
        <fieldset disabled>
          <legend><span><button id="in-legend">Unlock</button></span></legend>
          <button id="in-fieldset">Save</button>
          <select id="select-in-fieldset"><option>A</option></select>
        </fieldset>
        <button id="aria-disabled" aria-disabled="true">Publish</button>
      `),
    ).toEqual({
      disabled: false,
      "disabled-tabindexed": false,
      // A disabled fieldset's first legend is exempt, as HTML defines it.
      "in-legend": true,
      "in-fieldset": false,
      "select-in-fieldset": false,
      // aria-disabled announces a state; it takes no focus away.
      "aria-disabled": true,
    });
  });

  it("reads tabindex the way HTML parses an integer", () => {
    expect(
      focusableById(`
        <div id="empty" tabindex="">Card</div>
        <div id="word" tabindex="abc">Card</div>
        <div id="nbsp" tabindex="&#160;0">Card</div>
        <div id="negative" tabindex="-1">Card</div>
        <div id="padded" tabindex=" 0">Card</div>
        <div id="signed" tabindex="+0">Card</div>
        <div id="fraction" tabindex="0.5">Card</div>
        <div id="trailing" tabindex="1abc">Card</div>
        <button id="button-word" tabindex="abc">Save</button>
      `),
    ).toEqual({
      // Not an integer at all: the attribute is ignored. ASCII whitespace
      // only, so a leading no-break space makes it invalid too.
      empty: false,
      word: false,
      nbsp: false,
      // Focusable, just not a Tab stop.
      negative: true,
      // Leading whitespace and a sign are allowed; parsing stops at the first
      // non-digit, so "0.5" is 0 and "1abc" is 1.
      padded: true,
      signed: true,
      fraction: true,
      trailing: true,
      // An invalid tabindex leaves a natively focusable control focusable.
      "button-word": true,
    });
  });

  it("counts a details' summary: its first summary child, wherever it sits", () => {
    expect(
      focusableById(`
        <details><summary id="closed">Shipping</summary><p>Body</p></details>
        <details open><summary id="open">Returns</summary><p>Body</p></details>
        <details open>
          <summary id="first">A</summary>
          <summary id="second">B</summary>
        </details>
        <details open><p>Lead</p><summary id="after-text">C</summary></details>
        <details open><div><summary id="nested">D</summary></div></details>
        <div><summary id="stray">E</summary></div>
        <div><summary id="stray-tabindexed" tabindex="0">F</summary></div>
        <details><summary id="scripted" tabindex="-1">G</summary></details>
        <fieldset disabled>
          <details><summary id="in-fieldset">H</summary></details>
        </fieldset>
        <details open><summary id="role-button" role="button">I</summary></details>
        <details open><summary id="aria-disabled" aria-disabled="true">J</summary></details>
      `),
    ).toEqual({
      closed: true,
      open: true,
      // Only the first summary child is the details' summary, even when
      // other content comes before it. (Open, so the second one is in the
      // tree at all: a closed details' body is left out.)
      first: true,
      second: false,
      "after-text": true,
      // A summary that is not a details' child is plain text.
      nested: false,
      stray: false,
      "stray-tabindexed": true,
      // Focusable, just not a Tab stop.
      scripted: true,
      // A summary is no form control, so a disabled fieldset leaves it be.
      "in-fieldset": true,
      "role-button": true,
      "aria-disabled": true,
    });
  });

  it("reads a summary's details from the DOM, not from where it is slotted", () => {
    const root = createPage(
      `<div id="direct-host"></div>` +
        `<div id="slot-host"><summary id="slotted">Slotted</summary></div>`,
    );
    root
      .querySelector("#direct-host")!
      .attachShadow({ mode: "open" }).innerHTML =
      `<details><summary id="in-shadow">In shadow</summary></details>`;
    // Rendered inside the details, but its parent is the host, so Chromium
    // gives the details its default summary and leaves this one unfocusable.
    root.querySelector("#slot-host")!.attachShadow({ mode: "open" }).innerHTML =
      `<details open><slot></slot></details>`;
    const byId: Record<string, boolean> = {};
    for (const node of extractDomTree(root).nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id) byId[id] = node.interaction!.isFocusable;
    }
    expect(byId).toMatchObject({ "in-shadow": true, slotted: false });
  });
});

// An <area> has no box of its own. Chromium's UA sheet rendered one inline up
// to 151 and gives it `display: none` since 153, and neither decides anything:
// Chromium focuses an area, and its accessibility tree exposes one, while the
// image using its map is rendered. So every case runs under both sheets, and
// each was checked in Chromium 151 and 153 with a Tab walk, scripted focus()
// and CDP's accessibility tree. jsdom's own sheet hides areas too; the style
// below says so on purpose rather than leaning on it.
describe.each(["inline", "none"])(
  "image map areas, with `area { display: %s }`",
  (display) => {
    let sheet: HTMLStyleElement;
    beforeEach(() => {
      sheet = document.createElement("style");
      sheet.textContent = `area { display: ${display} }`;
      document.head.append(sheet);
    });
    afterEach(() => {
      sheet.remove();
      document.body.innerHTML = "";
    });

    /** The area nodes of `html`, rendered in the document, by id. */
    function areas(html: string): Record<string, SemanticNode> {
      document.body.innerHTML = `<main>${html}</main>`;
      const byId: Record<string, SemanticNode> = {};
      for (const node of extractDomTree(document.body).nodes.values()) {
        if (node.dom?.tagName === "area")
          byId[node.dom.attributes["id"]] = node;
      }
      return byId;
    }

    it("emits an area where its map sits, as a link its image renders", () => {
      const { home } = areas(`
        <img src="x.gif" alt="Site map" usemap="#nav">
        <map name="nav"><area id="home" href="/home" alt="Home"></map>
      `);
      expect(home).toBeDefined();
      expect(home.a11y).toMatchObject({
        role: "link",
        name: "Home",
        isExposedToAT: true,
      });
      expect(home.dom!.isHidden).toBe(false);
      expect(home.interaction!.isFocusable).toBe(true);
    });

    it("leaves an area out while the image using its map is not rendered", () => {
      const found = areas(`
        <img src="x.gif" alt="A" usemap="#shown">
        <map name="shown"><area id="shown" href="/a" alt="A"></map>

        <img src="x.gif" alt="B" usemap="#b" style="display: none">
        <map name="b"><area id="img-display-none" href="/b" alt="B"></map>
        <img src="x.gif" alt="C" usemap="#c" hidden>
        <map name="c"><area id="img-hidden" href="/c" alt="C"></map>
        <img src="x.gif" alt="D" usemap="#d" style="visibility: hidden">
        <map name="d"><area id="img-invisible" href="/d" alt="D"></map>
        <img src="x.gif" alt="E" usemap="#e" inert>
        <map name="e"><area id="img-inert" href="/e" alt="E"></map>
        <div style="display: none"><img src="x.gif" alt="F" usemap="#f"></div>
        <map name="f"><area id="in-display-none" href="/f" alt="F"></map>
        <div inert><img src="x.gif" alt="G" usemap="#g"></div>
        <map name="g"><area id="in-inert" href="/g" alt="G"></map>
        <div style="visibility: hidden"><img src="x.gif" alt="H" usemap="#h"></div>
        <map name="h"><area id="in-invisible" href="/h" alt="H"></map>
        <details><summary>More</summary><img src="x.gif" alt="M" usemap="#m"></details>
        <map name="m"><area id="in-closed-details" href="/m" alt="M"></map>

        <div style="visibility: hidden">
          <img src="x.gif" alt="I" usemap="#i" style="visibility: visible">
        </div>
        <map name="i"><area id="made-visible" href="/i" alt="I"></map>

        <map name="unused"><area id="unused" href="/j" alt="J"></map>
        <area id="no-map" href="/k" alt="K">

        <img src="x.gif" alt="L1" usemap="#l" style="display: none">
        <img src="x.gif" alt="L2" usemap="#l">
        <map name="l"><area id="first-image-hidden" href="/l" alt="L"></map>
      `);
      // Only the first image using a map counts, so a second, rendered one
      // doesn't bring back the areas of a map whose first image is hidden.
      expect(Object.keys(found).sort()).toEqual(["made-visible", "shown"]);
    });

    it("keeps an area whatever its own style says, as Chromium does", () => {
      const found = areas(`
        <img src="x.gif" alt="Site map" usemap="#nav">
        <map name="nav">
          <area id="hidden" href="/a" alt="A" hidden>
          <area id="display-none" href="/b" alt="B" style="display: none">
          <area id="invisible" href="/c" alt="C" style="visibility: hidden">
          <area id="skipped" href="/d" alt="D" style="content-visibility: hidden">
        </map>
        <img src="x.gif" alt="Floor plan" usemap="#floor">
        <div style="visibility: hidden">
          <map name="floor"><area id="in-invisible-map" href="/e" alt="E"></map>
        </div>
      `);
      for (const id of [
        "hidden",
        "display-none",
        "invisible",
        "skipped",
        "in-invisible-map",
      ]) {
        expect(found[id], id).toBeDefined();
        expect(found[id].a11y.isExposedToAT, id).toBe(true);
        expect(found[id].dom!.isHidden, id).toBe(false);
        expect(found[id].interaction!.isFocusable, id).toBe(true);
      }
    });

    it("hides an inert area from AT, where Chromium still focuses it", () => {
      const { inert } = areas(`
        <img src="x.gif" alt="Site map" usemap="#nav">
        <map name="nav"><area id="inert" href="/a" alt="A" inert></map>
      `);
      // Chromium tabs to it, and leaves it out of its accessibility tree. So
      // it stays focusable here, and hidden from AT like an aria-hidden
      // button (query.test.ts pins what that does to the tab sequence).
      expect(inert.a11y.isExposedToAT).toBe(false);
      expect(inert.dom!.isHidden).toBe(false);
      expect(inert.interaction!.isFocusable).toBe(true);
    });

    it("hides an area from AT with its image, which it belongs to in Chromium's tree", () => {
      const found = areas(`
        <img src="x.gif" alt="A" usemap="#a" aria-hidden="true">
        <map name="a"><area id="img-aria-hidden" href="/a" alt="A"></map>
        <div aria-hidden="true"><img src="x.gif" alt="B" usemap="#b"></div>
        <map name="b"><area id="in-aria-hidden" href="/b" alt="B"></map>
        <img src="x.gif" alt="C" usemap="#c" aria-hidden="YES">
        <map name="c"><area id="img-aria-hidden-yes" href="/c" alt="C"></map>
      `);
      // Any value but false hides, in any case, as Chromium reads it.
      for (const id of [
        "img-aria-hidden",
        "in-aria-hidden",
        "img-aria-hidden-yes",
      ]) {
        expect(found[id].a11y.isExposedToAT, id).toBe(false);
        // Still focusable: Chromium tabs to it all the same.
        expect(found[id].interaction!.isFocusable, id).toBe(true);
      }
    });

    it("follows the accessibility tree for an area in a hidden or inert map", () => {
      // Chromium still tabs to these, but its accessibility tree leaves them
      // out, and the walk never enters a hidden or inert subtree.
      const found = areas(`
        <img src="x.gif" alt="Site map" usemap="#a">
        <map name="a" hidden><area id="map-hidden" href="/a" alt="A"></map>
        <img src="x.gif" alt="Site map" usemap="#b">
        <div style="display: none">
          <map name="b"><area id="in-hidden" href="/b" alt="B"></map>
        </div>
        <img src="x.gif" alt="Site map" usemap="#c">
        <map name="c" inert><area id="map-inert" href="/c" alt="C"></map>
      `);
      expect(found).toEqual({});
    });

    it("follows the slot that renders the image, as Chromium does", () => {
      // An image slotted into a component renders only through its slot, so
      // a hidden, display:none or inert slot hides it, and Chromium neither
      // focuses its areas nor exposes them. An aria-hidden slot leaves it
      // rendered: Chromium still focuses the area, but hides it from AT.
      const slots: Record<string, string> = {
        shown: "<slot></slot>",
        hidden: "<slot hidden></slot>",
        "display-none": '<slot style="display: none"></slot>',
        inert: "<slot inert></slot>",
        "aria-hidden": '<slot aria-hidden="true"></slot>',
      };
      document.body.innerHTML = `<main>${Object.keys(slots)
        .map(
          (name) =>
            `<div id="host-${name}"><img src="x.gif" alt="${name}" usemap="#${name}"></div>` +
            `<map name="${name}"><area id="${name}" href="/${name}" alt="${name}"></map>`,
        )
        .join("")}</main>`;
      for (const [name, html] of Object.entries(slots)) {
        document
          .getElementById(`host-${name}`)!
          .attachShadow({ mode: "open" }).innerHTML = html;
      }
      const byId: Record<string, SemanticNode> = {};
      for (const node of extractDomTree(document.body).nodes.values()) {
        if (node.dom?.tagName === "area")
          byId[node.dom.attributes["id"]] = node;
      }
      expect(Object.keys(byId).sort()).toEqual(["aria-hidden", "shown"]);
      expect(byId.shown.a11y.isExposedToAT).toBe(true);
      expect(byId["aria-hidden"].a11y.isExposedToAT).toBe(false);
      expect(byId["aria-hidden"].interaction!.isFocusable).toBe(true);
    });

    it("takes an area's image from the document, as Chromium does", () => {
      document.body.innerHTML = `<main>
        <img src="x.gif" alt="Site map" usemap="#nav">
        <div id="map-host"></div>
        <div id="image-host"></div>
      </main>`;
      const mapHost = document.getElementById("map-host")!;
      mapHost.attachShadow({ mode: "open" }).innerHTML =
        `<map name="nav"><area id="map-in-shadow" href="/a" alt="A"></map>`;
      document
        .getElementById("image-host")!
        .attachShadow({ mode: "open" }).innerHTML =
        `<img src="x.gif" alt="Plan" usemap="#floor">` +
        `<map name="floor"><area id="image-in-shadow" href="/b" alt="B"></map>`;
      const ids = [...extractDomTree(document.body).nodes.values()]
        .filter((n) => n.dom?.tagName === "area")
        .map((n) => [n.dom!.attributes["id"], n.interaction!.isFocusable]);
      // An image inside a shadow root lends its map's areas nothing, while a
      // map inside one still takes its image from the document.
      expect(ids).toEqual([["map-in-shadow", true]]);
    });

    it("keeps an area out of the name of the element its map sits in", () => {
      document.body.innerHTML = `<main>
        <h2>Title <map name="m"><area href="/h" alt="Home"></map>end</h2>
        <div role="button" tabindex="0">Go <map name="n"><area href="/x" alt="Away"></map>now</div>
        <img src="x.gif" alt="Site map" usemap="#m">
        <img src="x.gif" alt="Plan" usemap="#n">
      </main>`;
      const names = Object.fromEntries(
        [...extractDomTree(document.body).nodes.values()].map((n) => [
          n.a11y.role,
          n.a11y.name,
        ]),
      );
      // Chromium's tree puts an area under its image, never under its map's
      // parent, so no ancestor of the map takes its text.
      expect(names).toMatchObject({ heading: "Title end", button: "Go now" });
    });
  },
);

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

describe("aria-describedby target suppression", () => {
  it("suppresses a text-only description target", () => {
    // The reason the suppression exists: the target's text is already shown
    // inline on the referencing element as its description, so surfacing the
    // <p> as its own node is pure redundancy.
    const root = createPage(`
      <input aria-label="Password" aria-describedby="pw-help" />
      <p id="pw-help">Must be 8+ characters.</p>
    `);

    const { nodes } = extractDomTree(root);

    expect([...nodes.values()].some((n) => n.dom?.tagName === "p")).toBe(false);
  });

  it("keeps a description target that contains interactive content", () => {
    // Regression: the whole target subtree was dropped, so the "Full rules"
    // link — visible, focusable page content an AT user can tab to and
    // activate — vanished from the tree, and with it from the panel, audits,
    // and everything else derived from the tree.
    const root = createPage(`
      <input aria-label="Password" aria-describedby="pw-help" />
      <p id="pw-help">Must be 8+ characters. <a href="/rules">Full rules</a></p>
    `);

    const { nodes } = extractDomTree(root);

    const link = [...nodes.values()].find((n) => n.dom?.tagName === "a");
    expect(link).toBeDefined();
    expect(link!.a11y.name).toBe("Full rules");
    // The target itself has to survive too — it is the link's parent.
    const p = [...nodes.values()].find((n) => n.dom?.tagName === "p");
    expect(p).toBeDefined();
    expect(p!.childIds).toContain(link!.id);
  });

  it("keeps a description target whose interactive content is nested deeper", () => {
    const root = createPage(`
      <input aria-label="Card" aria-describedby="card-help" />
      <div id="card-help">
        <span>Where do I find this? <button type="button">Show me</button></span>
      </div>
    `);

    const { nodes } = extractDomTree(root);

    const button = [...nodes.values()].find((n) => n.dom?.tagName === "button");
    expect(button).toBeDefined();
    expect(button!.a11y.name).toBe("Show me");
  });

  it("still suppresses a target whose only control is hidden", () => {
    // The walk drops a display:none control, so counting it would keep the
    // target for a node that never gets emitted — the redundant description
    // node this suppression exists to avoid, with none of the control the
    // exception was added for. The two decisions have to agree.
    const root = createPage(`
      <input aria-label="Password" aria-describedby="pw-help" />
      <p id="pw-help">
        Must be 8+ characters.
        <button type="button" style="display: none">Show rules</button>
      </p>
    `);

    const { nodes } = extractDomTree(root);

    expect([...nodes.values()].some((n) => n.dom?.tagName === "button")).toBe(
      false,
    );
    expect([...nodes.values()].some((n) => n.dom?.tagName === "p")).toBe(false);
  });

  it("still suppresses a tabindex='-1' target holding only text", () => {
    // `getActions` hands any [tabindex] element a click action as a catch-all,
    // but tabindex="-1" is programmatic-focus plumbing — the standard way to
    // move focus to an error container — not something a user can tab to.
    // Counting it would defeat suppression for plain help/error text.
    const root = createPage(`
      <input aria-label="Password" aria-describedby="pw-err" />
      <div id="pw-err" tabindex="-1" role="alert">Password is required.</div>
    `);

    const { nodes } = extractDomTree(root);

    expect(
      [...nodes.values()].some((n) => n.dom?.attributes?.id === "pw-err"),
    ).toBe(false);
  });

  it("still suppresses a target whose only control is hidden from AT", () => {
    // aria-hidden (and visibility:hidden) survive the DOM view but are pruned
    // from the a11y view, so counting one would bring the redundant
    // description node back in a11y mode with no control behind it.
    const root = createPage(`
      <input aria-label="Password" aria-describedby="pw-help" />
      <p id="pw-help">Must be 8+ characters. <button aria-hidden="true">i</button></p>
    `);

    const { nodes } = extractDomTree(root);

    expect([...nodes.values()].some((n) => n.dom?.tagName === "p")).toBe(false);
  });

  it("still suppresses a target whose only control is media fallback", () => {
    // The walk treats media as a leaf — its light-DOM children are fallback
    // content no browser renders — so a control in there is never emitted.
    const root = createPage(`
      <input aria-label="Clip" aria-describedby="clip-help" />
      <p id="clip-help">
        See the <video src="x.mp4"><a href="/transcript">transcript</a></video>
      </p>
    `);

    const { nodes } = extractDomTree(root);

    expect([...nodes.values()].some((n) => n.dom?.tagName === "a")).toBe(false);
    expect([...nodes.values()].some((n) => n.dom?.tagName === "p")).toBe(false);
  });

  it("keeps a target holding a media element that is itself a tab stop", () => {
    // <video controls> IS emitted and IS focusable, so it is a real reason to
    // keep the target — unlike the fallback content above.
    const root = createPage(`
      <input aria-label="Clip" aria-describedby="clip-help" />
      <p id="clip-help">Watch: <video src="x.mp4" controls></video></p>
    `);

    const { nodes } = extractDomTree(root);

    expect([...nodes.values()].some((n) => n.dom?.tagName === "video")).toBe(
      true,
    );
    expect([...nodes.values()].some((n) => n.dom?.tagName === "p")).toBe(true);
  });

  it("keeps a target whose control is reachable via tabindex='0'", () => {
    const root = createPage(`
      <input aria-label="Password" aria-describedby="pw-help" />
      <p id="pw-help">
        Must be 8+ characters.
        <span tabindex="0" role="button">Show rules</span>
      </p>
    `);

    const { nodes } = extractDomTree(root);

    const widget = [...nodes.values()].find((n) => n.a11y.role === "button");
    expect(widget).toBeDefined();
    expect(widget!.a11y.name).toBe("Show rules");
  });

  it("surfaces the kept interactive content in the a11y view too", () => {
    const root = createPage(`
      <input aria-label="Password" aria-describedby="pw-help" />
      <p id="pw-help">Must be 8+ characters. <a href="/rules">Full rules</a></p>
    `);

    const { nodes } = extractA11yTree(root);

    const link = [...nodes.values()].find((n) => n.a11y.role === "link");
    expect(link).toBeDefined();
    expect(link!.a11y.name).toBe("Full rules");
  });
});

// Chromium 151 is the reference for every expectation here: an editing host
// is a tab stop that takes typing, a link inside editable content can't be
// focused at all (not even by script) unless it carries its own tabindex, and
// a contenteditable="false" island hands a link its focusability back.
describe("contenteditable editing hosts", () => {
  const nodeBy = (root: Element, id: string) => {
    const { nodes } = extractDomTree(root);
    const node = [...nodes.values()].find((n) => n.dom?.attributes.id === id);
    if (!node) throw new Error(`no node with id="${id}"`);
    return node;
  };

  it("makes a role-less editor a focusable text field, unnamed by what was typed", () => {
    const root = createPage(
      `<div id="ed" contenteditable="true">my password is hunter2</div>`,
    );
    const ed = nodeBy(root, "ed");
    expect(ed.a11y.role).toBe("generic");
    // What was typed is the editor's content, not its label.
    expect(ed.a11y.name).toBe("");
    expect(ed.interaction?.isFocusable).toBe(true);
    expect(ed.interaction?.actions).toEqual(["focus", "type"]);
    expect(ed.interaction?.isInteractive).toBe(true);
  });

  // Not even a role that names from content: Chromium leaves an editable
  // heading, button or link unnamed, and names one only by its author.
  it("never names a host from its content, whatever its role", () => {
    const root = createPage(`
      <h3 id="title" contenteditable="true">Draft title</h3>
      <button id="btn" contenteditable="true">Button text</button>
      <a id="link" href="/l" contenteditable="true">Link text</a>
      <h3 id="labelled" contenteditable="true" aria-label="Label">Typed</h3>
      <h3 id="titled" contenteditable="true" title="Tip">Typed</h3>
      <div contenteditable="true"><h3 id="inner">Inner heading</h3></div>
    `);
    const title = nodeBy(root, "title");
    expect(title.a11y.name).toBe("");
    expect(title.interaction?.isFocusable).toBe(true);
    expect(title.interaction?.actions).toEqual(["focus", "type"]);
    expect(nodeBy(root, "btn").a11y.name).toBe("");
    expect(nodeBy(root, "link").a11y.name).toBe("");
    expect(nodeBy(root, "labelled").a11y.name).toBe("Label");
    expect(nodeBy(root, "titled").a11y.name).toBe("Tip");
    // Only the host: a heading inside an editor is named as usual.
    expect(nodeBy(root, "inner").a11y.name).toBe("Inner heading");
  });

  it("still reads a host's text into an ancestor's name", () => {
    const root = createPage(
      `<h2 id="h">Before <button contenteditable="true">Save</button> after</h2>`,
    );
    expect(nodeBy(root, "h").a11y.name).toBe("Before Save after");
  });

  it("marks only an editing host as editable", () => {
    const root = createPage(`
      <div id="empty" contenteditable="">x</div>
      <div id="plain" contenteditable="plaintext-only">y</div>
      <div id="outer" contenteditable="true"><div id="nested" contenteditable="true">n</div></div>
    `);
    expect(nodeBy(root, "empty").interaction?.isEditable).toBe(true);
    expect(nodeBy(root, "plain").interaction?.isEditable).toBe(true);
    expect(nodeBy(root, "outer").interaction?.isEditable).toBe(true);
    expect(nodeBy(root, "nested").interaction?.isEditable).toBe(false);
  });

  it("types into an upper-case contenteditable combobox", () => {
    const root = createPage(
      `<div id="cb" role="combobox" contenteditable="TRUE" aria-label="Q"></div>`,
    );
    expect(nodeBy(root, "cb").interaction?.actions).toEqual(["focus", "type"]);
  });

  // A contenteditable="false" island ends the outer editor, so an editor
  // reopened inside one is its own field with its own value, as in Chromium
  // 151 (`textbox "Re"` value "island text").
  it("gives an editor reopened inside an island its own value", () => {
    const root = createPage(`
      <div contenteditable="true" role="textbox" aria-label="Outer">intro
        <span contenteditable="false">chip
          <span id="re" contenteditable="true" role="textbox" aria-label="Re">island text</span>
        </span>
      </div>
    `);
    expect(nodeBy(root, "re").a11y.value).toBe("island text");
  });

  it("still lends a host's text to a name that references it", () => {
    const root = createPage(`
      <span id="src" contenteditable="true">Draft</span>
      <button id="ref" aria-labelledby="src"></button>
    `);
    // Attached, so the IDREF resolves.
    document.body.appendChild(root);
    try {
      expect(nodeBy(root, "ref").a11y.name).toBe("Draft");
    } finally {
      root.remove();
    }
  });

  it("does not let an editor override a role's own actions", () => {
    const root = createPage(`
      <div id="tb" role="textbox" contenteditable="true" aria-label="T"></div>
      <div id="btn" role="button" contenteditable="true">Go</div>
      <div id="ti" contenteditable="true" tabindex="0"></div>
    `);
    expect(nodeBy(root, "tb").interaction?.actions).toEqual(["focus", "type"]);
    expect(nodeBy(root, "btn").interaction?.actions).toEqual(["click"]);
    // The tabindex catch-all is a `click`, which would outrank `type`.
    expect(nodeBy(root, "ti").interaction?.actions).toEqual(["focus", "type"]);
  });

  // Chromium doesn't follow one either, not even on a scripted click().
  it("gives a link inside an editor no actions, except in an island", () => {
    const root = createPage(`
      <div contenteditable="true" role="textbox" aria-label="Message">
        <a id="inside" href="#inside">reset</a>
        <a id="island" contenteditable="false" href="#island">@alice</a>
      </div>
    `);
    expect(nodeBy(root, "inside").interaction?.actions).toEqual([]);
    expect(nodeBy(root, "island").interaction?.actions).toEqual([
      "click",
      "navigate",
    ]);
  });

  // role="none" on a link Chromium can't focus is honored, so the link
  // flattens away instead of surviving as a bare presentation node.
  it("flattens a decorative link inside an editor out of the a11y view", () => {
    const root = createPage(
      `<div contenteditable="true" role="textbox" aria-label="Message"><a href="/x" role="none">Help</a></div>`,
    );
    const roles = [...extractA11yTree(root).nodes.values()].map(
      (n) => n.a11y.role,
    );
    expect(roles).not.toContain("presentation");
    expect(roles).not.toContain("link");
  });

  it("does not make a link inside an editor focusable, except in an island", () => {
    const root = createPage(`
      <div contenteditable="true" role="textbox" aria-label="Message">
        <a id="inside" href="https://x.test/reset?token=abc123">reset</a>
        <a id="island" contenteditable="false" href="/u/alice">@alice</a>
        <a id="own-ti" href="/t" tabindex="0">tabbable</a>
      </div>
    `);
    expect(nodeBy(root, "inside").interaction?.isFocusable).toBe(false);
    expect(nodeBy(root, "island").interaction?.isFocusable).toBe(true);
    expect(nodeBy(root, "own-ti").interaction?.isFocusable).toBe(true);
  });

  it("does not treat a contenteditable nested in an editor as a host", () => {
    const root = createPage(`
      <div id="outer" contenteditable="true">
        <div id="nested" contenteditable="true">n</div>
      </div>
    `);
    expect(nodeBy(root, "outer").interaction?.isFocusable).toBe(true);
    const nested = nodeBy(root, "nested");
    expect(nested.interaction?.isFocusable).toBe(false);
    expect(nested.interaction?.actions).toEqual([]);
  });

  it("ignores contenteditable=false and an invalid value", () => {
    const root = createPage(`
      <div id="off" contenteditable="false">x</div>
      <div id="bogus" contenteditable="bogus">y</div>
    `);
    for (const id of ["off", "bogus"]) {
      const node = nodeBy(root, id);
      expect(node.interaction?.isFocusable).toBe(false);
      expect(node.interaction?.actions).toEqual([]);
    }
  });
});
