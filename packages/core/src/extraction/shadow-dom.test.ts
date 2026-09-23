// Extraction follows the FLAT tree — what the browser renders and Chromium's
// accessibility tree is built from — through open shadow roots and slots.
// Motivating case: the APG pages' SkipTo.js button lives in an open shadow
// root on <skip-to-content>, so the native tree had it and the DOM tree didn't.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExtractionResult, SemanticNode } from "../types.js";
import { resetIdCounter } from "../utils/id-generator.js";

import { extractA11yTree } from "./a11y-extractor.js";
import { extractDomTree, getElementRefs } from "./dom-extractor.js";

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

describe("landmark scoping reads flat-tree ancestors", () => {
  it("does not make a header inside a component within <main> a banner", () => {
    page.innerHTML = `<main><x-page-header></x-page-header></main>`;
    shadow(page.querySelector("x-page-header")!, `<header><h1>T</h1></header>`);
    const roles = nodes(extractDomTree(page)).map((n) => n.a11y.role);
    expect(roles).not.toContain("banner");
  });
});
