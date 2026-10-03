// Extraction follows the FLAT tree — what the browser renders and Chromium's
// accessibility tree is built from — through open shadow roots and slots.
// Motivating case: the APG pages' SkipTo.js button lives in an open shadow
// root on <skip-to-content>, so the native tree had it and the DOM tree didn't.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExtractionResult, SemanticNode } from "../types.js";
import { resetIdCounter } from "../utils/id-generator.js";

import { extractA11yTree } from "./a11y-extractor.js";
import {
  extractDomTree,
  getDescendantText,
  getElementRefs,
} from "./dom-extractor.js";
import { flatChildren, flatParent, isRenderedInFlatTree } from "./flat-tree.js";

let page: HTMLElement;

beforeEach(() => {
  resetIdCounter();
  page = document.createElement("div");
  document.body.appendChild(page);
});

afterEach(() => {
  page.remove();
});

/** Attach an open (or closed) shadow root with `html` to `host`. */
function shadow(
  host: Element,
  html: string,
  mode: ShadowRootMode = "open",
): ShadowRoot {
  const root = host.attachShadow({ mode });
  root.innerHTML = html;
  return root;
}

function nodes(result: ExtractionResult): SemanticNode[] {
  return Array.from(result.nodes.values());
}

function find(
  result: ExtractionResult,
  role: string,
  name?: string,
): SemanticNode | undefined {
  return nodes(result).find(
    (n) => n.a11y.role === role && (name === undefined || n.a11y.name === name),
  );
}

/** Serialize a tree as indented `role "name"` lines, for order assertions. */
function outline(result: ExtractionResult): string {
  const lines: string[] = [];
  const visit = (id: string, depth: number): void => {
    const n = result.nodes.get(id)!;
    const label = n.a11y.name ? `${n.a11y.role} "${n.a11y.name}"` : n.a11y.role;
    lines.push(`${"  ".repeat(depth)}${label}`);
    for (const c of n.childIds) visit(c, depth + 1);
  };
  visit(result.rootId, 0);
  return lines.join("\n");
}

describe("open shadow roots", () => {
  it("extracts a button that lives in a shadow root (the SkipTo.js shape)", () => {
    page.innerHTML = `<skip-to-content></skip-to-content><main><h1>Title</h1></main>`;
    shadow(
      page.querySelector("skip-to-content")!,
      `<div class="container"><button aria-label="Skip To Content, shortcut Alt + 0">Skip To Content</button></div>`,
    );

    const tree = extractA11yTree(page);
    expect(
      find(tree, "button", "Skip To Content, shortcut Alt + 0"),
    ).toBeTruthy();
    // Unnamed generic host and wrapper flatten away, as for any div.
    expect(outline(tree)).toBe(
      [
        "generic",
        '  button "Skip To Content, shortcut Alt + 0"',
        "  main",
        '    heading "Title"',
      ].join("\n"),
    );
  });

  it("registers shadow elements in the element ref map, so actions can reach them", () => {
    page.innerHTML = `<x-host></x-host>`;
    const root = shadow(page.querySelector("x-host")!, `<button>Go</button>`);
    const tree = extractDomTree(page);
    const btn = find(tree, "button", "Go")!;
    expect(getElementRefs().get(btn.id)).toBe(root.querySelector("button"));
  });

  it("walks nested hosts", () => {
    page.innerHTML = `<outer-el></outer-el>`;
    const outer = shadow(
      page.querySelector("outer-el")!,
      `<inner-el></inner-el>`,
    );
    shadow(outer.querySelector("inner-el")!, `<a href="/deep">Deep link</a>`);
    expect(find(extractA11yTree(page), "link", "Deep link")).toBeTruthy();
  });

  it("leaves a closed shadow root opaque — the host is a leaf", () => {
    page.innerHTML = `<x-closed></x-closed>`;
    shadow(
      page.querySelector("x-closed")!,
      `<button>Hidden</button>`,
      "closed",
    );
    const tree = extractDomTree(page);
    expect(find(tree, "button")).toBeUndefined();
  });

  it("names a host from the text its shadow tree renders", () => {
    page.innerHTML = `<x-btn role="button" tabindex="0"></x-btn>`;
    shadow(page.querySelector("x-btn")!, `<span>Save draft</span>`);
    expect(find(extractA11yTree(page), "button", "Save draft")).toBeTruthy();
  });

  it("survives a <form> whose field clobbers `shadowRoot`", () => {
    page.innerHTML = `<form aria-label="Search"><input name="shadowRoot" aria-label="Query"><button>Go</button></form>`;
    const tree = extractA11yTree(page);
    expect(find(tree, "form", "Search")).toBeTruthy();
    expect(find(tree, "textbox", "Query")).toBeTruthy();
    expect(find(tree, "button", "Go")).toBeTruthy();
  });
});

describe("this project's own panel", () => {
  it("skips a container marked as a panel host, shadow content and all", () => {
    page.innerHTML = `<main><h1>App</h1></main><div id="panel" data-real-a11y-panel></div>`;
    shadow(page.querySelector("#panel")!, `<button>Expand all</button>`);
    const tree = extractDomTree(page);
    expect(find(tree, "button")).toBeUndefined();
    expect(find(tree, "heading", "App")).toBeTruthy();
  });
});

describe("slots", () => {
  it("renders slotted light content at the slot's position", () => {
    page.innerHTML = `<x-card><a href="/more">More</a></x-card>`;
    shadow(
      page.querySelector("x-card")!,
      `<h2>Card title</h2><slot></slot><button>Close</button>`,
    );
    expect(outline(extractA11yTree(page))).toBe(
      [
        "generic",
        '  heading "Card title"',
        '  link "More"',
        '  button "Close"',
      ].join("\n"),
    );
  });

  it("routes named slots by the slot attribute", () => {
    page.innerHTML = `<x-layout><button slot="end">End</button><button slot="start">Start</button></x-layout>`;
    shadow(
      page.querySelector("x-layout")!,
      `<slot name="start"></slot><hr><slot name="end"></slot>`,
    );
    expect(outline(extractA11yTree(page))).toBe(
      ["generic", '  button "Start"', "  separator", '  button "End"'].join(
        "\n",
      ),
    );
  });

  it("drops light children no slot takes — the browser doesn't render them", () => {
    page.innerHTML = `<x-noslot><button>Unrendered</button></x-noslot>`;
    shadow(page.querySelector("x-noslot")!, `<p>Only this</p>`);
    const tree = extractDomTree(page);
    expect(find(tree, "button")).toBeUndefined();
    expect(find(tree, "paragraph")).toBeTruthy();
  });

  it("uses a slot's fallback content when nothing is assigned", () => {
    page.innerHTML = `<x-fallback></x-fallback>`;
    shadow(
      page.querySelector("x-fallback")!,
      `<slot><button>Default action</button></slot>`,
    );
    expect(
      find(extractA11yTree(page), "button", "Default action"),
    ).toBeTruthy();
  });

  it.each([
    ["hidden", `<slot hidden></slot>`],
    ["aria-hidden", `<slot aria-hidden="true"></slot>`],
    ["inert", `<slot inert></slot>`],
    ["display:none", `<slot style="display:none"></slot>`],
  ])("drops the assignment of a %s slot — it renders nothing", (_, markup) => {
    page.innerHTML = `<x-box><button>Delete</button></x-box>`;
    shadow(page.querySelector("x-box")!, markup);
    expect(find(extractDomTree(page), "button")).toBeUndefined();
  });

  it("keeps the assignment of a visibility:hidden slot", () => {
    // visibility is inherited but not subtree-hiding: an assigned child may
    // set `visibility:visible` and render. The child's own computed style
    // decides, exactly as it does for any other element.
    page.innerHTML = `<x-box><button style="visibility:visible">Still here</button></x-box>`;
    shadow(
      page.querySelector("x-box")!,
      `<slot style="visibility:hidden"></slot>`,
    );
    expect(find(extractDomTree(page), "button", "Still here")).toBeTruthy();
  });

  it("forwards a slot through a nested host", () => {
    page.innerHTML = `<x-outer><a href="/x">Forwarded</a></x-outer>`;
    const outer = shadow(
      page.querySelector("x-outer")!,
      `<x-inner><slot></slot></x-inner>`,
    );
    shadow(
      outer.querySelector("x-inner")!,
      `<nav aria-label="Inner"><slot></slot></nav>`,
    );
    const tree = extractA11yTree(page);
    const nav = find(tree, "navigation", "Inner")!;
    const link = find(tree, "link", "Forwarded")!;
    expect(nav.childIds).toContain(link.id);
  });
});

describe("IDREFs are scoped to the shadow tree", () => {
  it("resolves aria-labelledby inside the shadow root", () => {
    page.innerHTML = `<x-field></x-field>`;
    shadow(
      page.querySelector("x-field")!,
      `<span id="lbl">Email address</span><input aria-labelledby="lbl">`,
    );
    expect(
      find(extractA11yTree(page), "textbox", "Email address"),
    ).toBeTruthy();
  });

  it("resolves label[for] inside the shadow root", () => {
    page.innerHTML = `<x-field></x-field>`;
    shadow(
      page.querySelector("x-field")!,
      `<label for="q">Search</label><input id="q">`,
    );
    expect(find(extractA11yTree(page), "textbox", "Search")).toBeTruthy();
  });

  it("does not resolve a shadow IDREF against a same-id element in the document", () => {
    page.innerHTML = `<span id="lbl">Wrong (document)</span><x-field></x-field>`;
    shadow(
      page.querySelector("x-field")!,
      `<span id="lbl">Right (shadow)</span><input aria-labelledby="lbl">`,
    );
    expect(
      find(extractA11yTree(page), "textbox", "Right (shadow)"),
    ).toBeTruthy();
  });

  it("describes from aria-describedby inside the shadow root, and folds the target", () => {
    page.innerHTML = `<x-field></x-field>`;
    shadow(
      page.querySelector("x-field")!,
      `<input aria-label="Password" aria-describedby="hint"><p id="hint">8+ characters</p>`,
    );
    const tree = extractDomTree(page);
    expect(find(tree, "textbox", "Password")?.a11y.description).toBe(
      "8+ characters",
    );
    // The pre-pass saw the reference, so the text-only target is folded.
    expect(find(tree, "paragraph")).toBeUndefined();
  });
});

describe("description-target folding respects tree scope", () => {
  it("does not drop a page element that shares an id with a component's internal hint", () => {
    page.innerHTML = `<div id="hint"><p>Shipping is free over $50</p></div><x-input></x-input>`;
    shadow(
      page.querySelector("x-input")!,
      `<input aria-label="Coupon" aria-describedby="hint"><span id="hint">Case sensitive</span>`,
    );
    const tree = extractDomTree(page);
    // The page's own #hint is referenced by nothing in the document: keep it.
    expect(
      nodes(tree).some(
        (n) => n.dom?.textContent === "Shipping is free over $50",
      ),
    ).toBe(true);
    // The component's own hint is still folded into its input's description.
    expect(find(tree, "textbox", "Coupon")?.a11y.description).toBe(
      "Case sensitive",
    );
    expect(
      nodes(tree).some((n) => n.dom?.textContent === "Case sensitive"),
    ).toBe(false);
  });

  it("keeps a target whose only referrer is an unslotted (unrendered) child", () => {
    page.innerHTML = `<p id="hint">Visible help</p><x-box><input aria-label="Q" aria-describedby="hint"></x-box>`;
    // No <slot>: the input is never rendered, so its reference reaches nobody.
    shadow(page.querySelector("x-box")!, `<p>Box body</p>`);
    const tree = extractDomTree(page);
    expect(nodes(tree).some((n) => n.dom?.textContent === "Visible help")).toBe(
      true,
    );
  });

  it("folds a target that another tree merely labels", () => {
    page.innerHTML = `<button aria-labelledby="hint">Go</button><x-input></x-input>`;
    shadow(
      page.querySelector("x-input")!,
      `<input aria-label="Coupon" aria-describedby="hint"><span id="hint">Case sensitive</span>`,
    );
    const tree = extractDomTree(page);
    // The page's labelledby names a DIFFERENT tree's id; it must not keep the
    // component's own hint as standalone content beside the description.
    expect(find(tree, "textbox", "Coupon")?.a11y.description).toBe(
      "Case sensitive",
    );
    expect(
      nodes(tree).some((n) => n.dom?.textContent === "Case sensitive"),
    ).toBe(false);
  });

  it("still folds a document-level target in a detached subtree", () => {
    const detached = document.createElement("div");
    detached.innerHTML = `<input aria-label="Password" aria-describedby="pw"><p id="pw">8+ characters</p>`;
    const tree = extractDomTree(detached);
    expect(find(tree, "paragraph")).toBeUndefined();
  });
});

// A <form> lets a control named after a DOM property shadow that property, so
// the form's `parentElement`, `assignedSlot` or `parentNode` can read as the
// control. A walk up the flat tree through such a form must still reach the
// real ancestors: reading the control instead cycles back into the form, and a
// loop over ancestors then never ends, hanging the page.
describe("the flat tree around a clobbered <form>", () => {
  /** Shadow `prop` on `form` with its control, as a browser's form does. */
  function clobber(form: Element, prop: string): void {
    const control = form.querySelector(`[name="${prop}"]`);
    Object.defineProperty(form, prop, {
      configurable: true,
      get: () => control,
    });
  }

  it.each(["parentElement", "assignedSlot"])(
    "reads past a control named %s",
    (prop) => {
      page.innerHTML = `<div id="outer"><form aria-label="Pay"><input name="${prop}" aria-label="Card"></form></div>`;
      const form = page.querySelector("form")!;
      clobber(form, prop);
      expect(flatParent(form)).toBe(page.querySelector("#outer"));
    },
  );

  it("reads past a control named parentNode, up to a shadow host", () => {
    page.innerHTML = `<x-checkout></x-checkout>`;
    const host = page.querySelector("x-checkout")!;
    const root = shadow(
      host,
      `<form aria-label="Pay"><input name="parentNode" aria-label="Card"></form>`,
    );
    const form = root.querySelector("form")!;
    clobber(form, "parentNode");
    expect(flatParent(form)).toBe(host);
  });

  it("climbs from inside a form whose control is named nodeType", () => {
    // `form.nodeType` reads as the control, not 1, so a check of the parent's
    // type that read it plainly took the form for no element at all and
    // ended the climb below it.
    page.innerHTML = `<div id="outer"><form aria-label="Pay"><input name="nodeType" aria-label="Card"><span>Total</span></form></div>`;
    const form = page.querySelector("form")!;
    const span = form.querySelector("span")!;
    clobber(form, "nodeType");
    const ancestors: string[] = [];
    for (let el = flatParent(span); el; el = flatParent(el)) {
      ancestors.push(el.id ? `${el.localName}#${el.id}` : el.localName);
    }
    expect(ancestors).toEqual(["form", "div#outer", "div", "body", "html"]);
  });

  it("passes aria-disabled down through such a form", () => {
    page.innerHTML = `
      <div role="group" aria-label="Checkout" aria-disabled="true">
        <form aria-label="Pay">
          <input name="parentElement" aria-label="Card">
          <input name="assignedSlot" aria-label="Name">
          <button>Pay</button>
          <a href="/terms">Terms</a>
        </form>
      </div>`;
    const form = page.querySelector("form")!;
    clobber(form, "parentElement");
    clobber(form, "assignedSlot");
    const tree = extractDomTree(page);
    expect(find(tree, "button", "Pay")?.a11y.states["disabled"]).toBe(true);
    // A link asks whether it sits in editable content, a walk up of its own.
    expect(find(tree, "link", "Terms")?.a11y.states["disabled"]).toBe(true);
  });

  it("scopes a <header> inside such a form", () => {
    page.innerHTML = `
      <form aria-label="Pay">
        <input name="parentElement" aria-label="Card">
        <header>Checkout</header>
      </form>`;
    clobber(page.querySelector("form")!, "parentElement");
    expect(find(extractDomTree(page), "banner")).toBeTruthy();
  });

  // `form.nodeType` reads as the control, not 1, so a walk that keeps a child
  // by testing `nodeType === 1` took the form for no element at all and
  // dropped it with everything inside it. jsdom's own selector engine reads
  // it too, and throws on it, so these stop short of a full extraction;
  // packages/testing/e2e pins that in Chromium.
  it("keeps a form whose control is named nodeType among the flat children", () => {
    page.innerHTML = `<main><form aria-label="Pay"><input type="hidden" name="nodeType"><label>Card <input></label><button>Pay</button></form></main>`;
    const form = page.querySelector("form")!;
    clobber(form, "nodeType");
    expect(flatChildren(page.querySelector("main")!)).toEqual([form]);
  });

  it("reads the text inside such a form", () => {
    page.innerHTML = `<div id="d"><form><input type="hidden" name="nodeType"><span>Hello world</span></form></div>`;
    clobber(page.querySelector("form")!, "nodeType");
    expect(getDescendantText(page.querySelector("#d")!)).toBe("Hello world");
  });

  // Once the walks enter such a form, a second shadowing control can throw on
  // what they read of it. That costs the form's text, as the boundary costs
  // the form itself, and never the host whose name or value it was building.
  const BOTH = `<input type="hidden" name="nodeType"><input type="hidden" name="getAttribute"><span>inside</span>`;
  const shadowBoth = (): void => {
    const form = page.querySelector("form")!;
    clobber(form, "nodeType");
    clobber(form, "getAttribute");
  };

  it("keeps a heading named from content that holds a form shadowing getAttribute too", () => {
    page.innerHTML = `<h2>Checkout <form>${BOTH}</form></h2>`;
    shadowBoth();
    expect(find(extractDomTree(page), "heading")?.a11y.name).toBe("Checkout");
  });

  it("keeps a wrapping label's name when it holds such a form", () => {
    page.innerHTML = `<label>Card <form>${BOTH}</form><input></label>`;
    shadowBoth();
    expect(find(extractDomTree(page), "textbox")?.a11y.name).toBe("Card");
  });

  it("keeps a combobox's value when it holds such a form", () => {
    // A combobox you can't type into is valued by its accessible text, which
    // asks each element in it for aria-hidden. (An editor's value is its
    // rendered text, which asks nothing a form can shadow.)
    page.innerHTML = `<div role="combobox" aria-label="Fruit" aria-expanded="false">Apple <form>${BOTH}</form></div>`;
    shadowBoth();
    expect(find(extractDomTree(page), "combobox", "Fruit")?.a11y.value).toBe(
      "Apple",
    );
  });
});

// A `<details>`' summary is its first `<summary>` DOM child. Content slotted
// into a shadow `<details>` is a flat-tree child only, so it is body, and
// Chromium 151 hides it while the details is closed.
describe("a closed <details> in a shadow tree", () => {
  it("hides a light summary slotted into it, since that is body, not its summary", () => {
    page.innerHTML = `<x-d><summary>Slotted S</summary><button>Slotted B</button></x-d>`;
    shadow(page.querySelector("x-d")!, `<details><slot></slot></details>`);
    const names = nodes(extractDomTree(page)).map((n) => n.a11y.name);
    expect(names).not.toContain("Slotted B");
    expect(
      nodes(extractDomTree(page)).map((n) => n.dom!.tagName),
    ).not.toContain("summary");
  });

  it("renders content slotted into its own summary, and hides the default slot", () => {
    page.innerHTML = `<x-e><span slot="s">Named</span><button>Slotted B</button></x-e>`;
    shadow(
      page.querySelector("x-e")!,
      `<details><summary><slot name="s"></slot></summary><slot></slot></details>`,
    );
    const tree = extractDomTree(page);
    expect(nodes(tree).some((n) => n.dom?.textContent === "Named")).toBe(true);
    expect(find(tree, "button", "Slotted B")).toBeUndefined();
  });

  it("renders the default slot once it is open", () => {
    page.innerHTML = `<x-f><span slot="s">Named</span><button>Slotted B</button></x-f>`;
    shadow(
      page.querySelector("x-f")!,
      `<details open><summary><slot name="s"></slot></summary><slot></slot></details>`,
    );
    expect(find(extractDomTree(page), "button", "Slotted B")).toBeTruthy();
  });

  it("keeps a description target whose only referrer is slotted into its body", () => {
    page.innerHTML = `<x-h><input aria-label="Code" aria-describedby="help"></x-h><p id="help">Help text</p>`;
    shadow(
      page.querySelector("x-h")!,
      `<details><summary>S</summary><slot></slot></details>`,
    );
    expect(
      nodes(extractDomTree(page)).some(
        (n) => n.dom?.textContent === "Help text",
      ),
    ).toBe(true);
  });
});

// `isRenderedInFlatTree` climbs to the document. On a <form> whose fields
// shadow what that climb reads, a plain read goes round the form and the field
// forever, so each read goes through the prototype.
describe("isRenderedInFlatTree on a clobbered <form>", () => {
  function clobber(form: Element, name: string): void {
    Object.defineProperty(form, name, {
      configurable: true,
      get: () => form.querySelector(`[name="${name}"]`),
    });
  }

  it("reads parentElement past a field named parentElement", () => {
    page.innerHTML = `<details><summary>S</summary><form><input name="parentElement"><span id="t"></span></form></details>`;
    clobber(page.querySelector("form")!, "parentElement");
    expect(isRenderedInFlatTree(page.querySelector("#t")!)).toBe(false);
  });

  it("reads assignedSlot past a field named assignedSlot", () => {
    page.innerHTML = `<x-d><form><input name="assignedSlot"><span id="t"></span></form></x-d>`;
    shadow(
      page.querySelector("x-d")!,
      `<details><summary>S</summary><slot></slot></details>`,
    );
    clobber(page.querySelector("form")!, "assignedSlot");
    expect(isRenderedInFlatTree(page.querySelector("#t")!)).toBe(false);
  });

  it("reads getRootNode past a field named getRootNode", () => {
    const host = document.createElement("x-top");
    page.appendChild(host);
    const root = shadow(
      host,
      `<form><input name="getRootNode"><span id="t"></span></form>`,
    );
    clobber(root.querySelector("form")!, "getRootNode");
    expect(isRenderedInFlatTree(root.querySelector("#t")!)).toBe(true);
  });
});

describe("landmark scoping reads flat-tree ancestors", () => {
  it("does not make a header inside a component within <main> a banner", () => {
    page.innerHTML = `<main><x-page-header></x-page-header></main>`;
    shadow(page.querySelector("x-page-header")!, `<header><h1>T</h1></header>`);
    const roles = nodes(extractDomTree(page)).map((n) => n.a11y.role);
    expect(roles).not.toContain("banner");
  });
});
