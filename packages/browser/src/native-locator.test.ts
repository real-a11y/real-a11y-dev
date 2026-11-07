import { buildCssPath } from "@real-a11y-dev/core";
import { describe, expect, it } from "vitest";

import { createLocatorIndex } from "./native-locator.js";

describe("createLocatorIndex", () => {
  /** A `DOM.getDocument`-shaped `<ul>` of n `<li><a>`; every `nodeName` read is counted. */
  function wideList(n: number) {
    const reads = { count: 0 };
    const make = (name: string, children: DomNodeLike[] = []): DomNodeLike => ({
      get nodeName() {
        reads.count++;
        return name;
      },
      nodeType: 1,
      children,
    });
    const items = Array.from({ length: n }, () => make("LI", [make("A", [])]));
    const ul = make("UL", items);
    const main = make("MAIN", [make("H1"), ul]);
    const body = make("BODY", [main]);
    const html = make("HTML", [body]);
    const doc = { nodeName: "#document", nodeType: 9, children: [html] };
    return { reads, doc, last: items[n - 1].children![0] };
  }
  type DomNodeLike = Parameters<
    ReturnType<typeof createLocatorIndex>["link"]
  >[0];

  /** Link and locate every node the way `enrichFromDom` walks; count reads. */
  function locateAll(n: number) {
    const { reads, doc, last } = wideList(n);
    const index = createLocatorIndex();
    let lastLocator = "";
    const walk = (node: DomNodeLike): void => {
      index.link(node, false);
      const locator = buildCssPath(node, index.adapter);
      if (node === last) lastLocator = locator;
      for (const child of node.children ?? []) walk(child);
    };
    walk(doc);
    return { reads: reads.count, lastLocator };
  }

  it("costs about 10x for 10x the items, not 100x, and keeps the locator", () => {
    const small = locateAll(1_000);
    const large = locateAll(10_000);
    expect(large.reads / small.reads).toBeLessThan(15);
    expect(large.reads / small.reads).toBeGreaterThan(5);
    expect(large.lastLocator).toBe(
      "body > main > ul > li:nth-of-type(10000) > a",
    );
  });

  it("numbers same-tag siblings among their own tag only", () => {
    const el = (name: string, children: DomNodeLike[] = []): DomNodeLike => ({
      nodeName: name,
      nodeType: 1,
      children,
    });
    const target = el("P");
    const body = el("BODY", [el("DIV"), el("P"), el("DIV"), target]);
    const doc = {
      nodeName: "#document",
      nodeType: 9,
      children: [el("HTML", [body])],
    };
    const index = createLocatorIndex();
    const walk = (node: DomNodeLike): void => {
      index.link(node, false);
      for (const child of node.children ?? []) walk(child);
    };
    walk(doc);
    expect(buildCssPath(target, index.adapter)).toBe("body > p:nth-of-type(2)");
  });
});
