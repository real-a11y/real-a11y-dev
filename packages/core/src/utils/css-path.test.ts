// The locator algorithm is shared by two producers that walk different node
// shapes, so it is tested twice over: once through the real-DOM adapter (what
// the in-page producer uses) and once through a plain-object adapter standing
// in for the native producer's CDP node shape. Both must agree — that agreement
// is the whole point of extracting this.

import { describe, it, expect } from "vitest";

import {
  buildCssPath,
  isValidCssId,
  DOM_ELEMENT_ADAPTER,
  type CssPathAdapter,
} from "./css-path.js";

/** A CDP-shaped node: no live DOM, parent links recorded on the way down. */
interface PlainNode {
  tag: string;
  id?: string;
  /** False for the node kinds a CSS path can't cross — a shadow root. */
  isElement?: boolean;
  children?: PlainNode[];
  parent?: PlainNode;
}

function plainTree(root: PlainNode): CssPathAdapter<PlainNode> {
  const link = (node: PlainNode): void => {
    for (const child of node.children ?? []) {
      child.parent = node;
      link(child);
    }
  };
  link(root);
  return {
    tagName: (n) => n.tag,
    id: (n) => n.id ?? null,
    parent: (n) => n.parent ?? null,
    children: (n) => n.children ?? [],
    isRoot: (n) => n.isElement === false || n.tag === "html",
  };
}

/** Build the same document twice and assert both adapters produce one path. */
function bothWays(html: string, pick: (doc: Document) => Element): string {
  document.body.innerHTML = html;
  const el = pick(document);
  const fromDom = buildCssPath(el, DOM_ELEMENT_ADAPTER);

  // Mirror the live document into plain nodes, then find the twin of `el` by
  // walking both trees in lockstep.
  const mirror = (source: Element): PlainNode => ({
    tag: source.tagName.toLowerCase(),
    ...(source.getAttribute("id") ? { id: source.getAttribute("id")! } : {}),
    children: Array.from(source.children).map(mirror),
  });
  const root = mirror(document.documentElement);
  const adapter = plainTree(root);

  const twinOf = (source: Element, mirrored: PlainNode): PlainNode | null => {
    if (source === el) return mirrored;
    const kids = Array.from(source.children);
    for (const [i, kid] of kids.entries()) {
      const found = twinOf(kid, (mirrored.children ?? [])[i]);
      if (found) return found;
    }
    return null;
  };
  const twin = twinOf(document.documentElement, root);
  expect(
    twin,
    "the mirrored tree must contain a twin of the target",
  ).toBeTruthy();

  const fromPlain = buildCssPath(twin!, adapter);
  expect(fromPlain, "both adapters must produce the same locator").toBe(
    fromDom,
  );
  return fromDom;
}

describe("isValidCssId", () => {
  it("accepts ids usable as a bare #selector", () => {
    expect(isValidCssId("go")).toBe(true);
    expect(isValidCssId("Submit-btn_2")).toBe(true);
  });

  it("rejects ids that would need escaping, and non-strings", () => {
    expect(isValidCssId("2fa")).toBe(false); // leading digit
    expect(isValidCssId("has space")).toBe(false);
    expect(isValidCssId("has.dot")).toBe(false);
    expect(isValidCssId("")).toBe(false);
    expect(isValidCssId(null)).toBe(false);
    expect(isValidCssId(undefined)).toBe(false);
  });
});

describe("buildCssPath", () => {
  it("prefers the element's own id and stops there", () => {
    expect(
      bothWays(`<main><button id="go"></button></main>`, (d) =>
        d.querySelector("#go")!,
      ),
    ).toBe("#go");
  });

  it("falls back to a tag path when there is no usable id", () => {
    expect(
      bothWays(`<main><button></button></main>`, (d) =>
        d.querySelector("button")!,
      ),
    ).toBe("body > main > button");
  });

  it("ignores an id that isn't a bare selector", () => {
    const path = bothWays(`<main><button id="2fa"></button></main>`, (d) =>
      d.querySelector("button")!,
    );
    expect(path).toBe("body > main > button");
    expect(path).not.toContain("#");
  });

  it("disambiguates same-tag siblings with 1-based nth-of-type", () => {
    const html = `<main><button></button><button></button><button></button></main>`;
    expect(bothWays(html, (d) => d.querySelectorAll("button")[1]!)).toBe(
      "body > main > button:nth-of-type(2)",
    );
  });

  it("does not add nth-of-type when the tag is unique among its siblings", () => {
    const html = `<main><span></span><button></button></main>`;
    expect(bothWays(html, (d) => d.querySelector("button")!)).toBe(
      "body > main > button",
    );
  });

  it("counts only same-tag siblings, not position among all children", () => {
    const html = `<main><span></span><span></span><button></button><button></button></main>`;
    expect(bothWays(html, (d) => d.querySelectorAll("button")[0]!)).toBe(
      "body > main > button:nth-of-type(1)",
    );
  });

  it("anchors on the nearest ancestor id and stops the walk there", () => {
    const html = `<main><section id="panel"><div><button></button></div></section></main>`;
    const path = bothWays(html, (d) => d.querySelector("button")!);
    expect(path).toBe("#panel > div > button");
    expect(path).not.toContain("main");
  });

  it("caps the path depth rather than emitting an unbounded chain", () => {
    const deep = "<div>".repeat(12) + "<button></button>" + "</div>".repeat(12);
    const path = bothWays(`<main>${deep}</main>`, (d) =>
      d.querySelector("button")!,
    );
    expect(path.split(" > ")).toHaveLength(6);
    expect(path.endsWith("button")).toBe(true);
    // Depth-capped, so it never reaches <body> — a partial path is still a
    // useful "where", and an unbounded one is not.
    expect(path).not.toContain("body");
  });

  it("stops before the document element", () => {
    document.body.innerHTML = "";
    expect(buildCssPath(document.body, DOM_ELEMENT_ADAPTER)).toBe("body");
  });

  it("handles a detached element with no parent", () => {
    const orphan = document.createElement("button");
    expect(buildCssPath(orphan, DOM_ELEMENT_ADAPTER)).toBe("button");
  });

  // The native producer's walk pierces shadow roots, so it reaches nodes that
  // have no whole-document selector. It must stop at the boundary rather than
  // emit the shadow root as a segment: `#document-fragment > button` looks
  // queryable and matches nothing, which is worse than a partial path.
  it("stops at a boundary node instead of emitting it as a segment", () => {
    const shadowRoot: PlainNode = {
      tag: "#document-fragment",
      isElement: false,
      children: [{ tag: "span" }, { tag: "button" }, { tag: "button" }],
    };
    const host: PlainNode = {
      tag: "html",
      children: [{ tag: "body", id: "host", children: [shadowRoot] }],
    };
    const adapter = plainTree(host);
    const target = shadowRoot.children![2];

    // Still disambiguated among its siblings — the boundary ends the walk
    // upward, it doesn't degrade the segment the node itself contributes.
    expect(buildCssPath(target, adapter)).toBe("button:nth-of-type(2)");
    expect(buildCssPath(shadowRoot, adapter)).toBe("");
  });
});
