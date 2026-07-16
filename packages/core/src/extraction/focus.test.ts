import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { resetIdCounter } from "../utils/id-generator.js";

import { extractA11yTree } from "./a11y-extractor.js";
import { extractDomTree, resolveFocusedElement } from "./dom-extractor.js";

/** Focus needs a connected element — a detached subtree can't hold focus. */
function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

beforeEach(() => resetIdCounter());
afterEach(() => {
  document.body.innerHTML = "";
});

describe("resolveFocusedElement", () => {
  it("returns null when focus rests on <body> (nothing focused)", () => {
    mount(`<button>Go</button>`);
    expect(resolveFocusedElement(document)).toBeNull();
  });

  it("returns null for a null document", () => {
    expect(resolveFocusedElement(null)).toBeNull();
  });

  it("returns the focused element", () => {
    const root = mount(`<button id="go">Go</button>`);
    const btn = root.querySelector<HTMLButtonElement>("#go")!;
    btn.focus();
    expect(resolveFocusedElement(document)).toBe(btn);
  });

  it("pierces shadow roots to the real focused element", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("button");
    inner.textContent = "Inner";
    shadow.appendChild(inner);
    inner.focus();
    // activeElement retargets to the host; the resolver descends to `inner`.
    expect(resolveFocusedElement(document)).toBe(inner);
  });
});

describe("extraction focusedId", () => {
  it("records the focused node in both the a11y and dom trees", () => {
    const root = mount(`<main><button id="go">Go</button></main>`);
    root.querySelector<HTMLButtonElement>("#go")!.focus();

    const a11y = extractA11yTree(root);
    expect(a11y.focusedId).toBeDefined();
    expect(a11y.nodes.get(a11y.focusedId!)?.a11y.role).toBe("button");

    const dom = extractDomTree(root);
    expect(dom.focusedId).toBeDefined();
    expect(dom.nodes.get(dom.focusedId!)?.dom.tagName).toBe("button");
  });

  it("is undefined when nothing is focused", () => {
    const root = mount(`<main><button>Go</button></main>`);
    expect(extractA11yTree(root).focusedId).toBeUndefined();
  });

  it("is undefined when focus is outside the extracted subtree", () => {
    const root = mount(`<main><button>In</button></main>`);
    const outside = document.createElement("button");
    outside.textContent = "Out";
    document.body.appendChild(outside);
    outside.focus();
    expect(extractA11yTree(root).focusedId).toBeUndefined();
  });

  it("records a focused heading (the modal-orientation pattern)", () => {
    const root = mount(
      `<div role="dialog" aria-label="Delete account">
         <h2 tabindex="-1" id="t">Delete account</h2>
       </div>`,
    );
    root.querySelector<HTMLElement>("#t")!.focus();
    const a11y = extractA11yTree(root);
    expect(a11y.nodes.get(a11y.focusedId!)?.a11y.role).toBe("heading");
  });
});
