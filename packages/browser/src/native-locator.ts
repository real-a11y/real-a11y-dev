import type { CssPathAdapter } from "@real-a11y-dev/core";

import { attributeOf, type DomNode } from "./dom-document.js";

const ELEMENT_NODE = 1;

/**
 * The locator step of `enrichFromDom` (native-tree.ts), as a pure helper over `DomNode`s.
 * `link(node, inside)` is called once per node, parents before children; it
 * records the parent links the path walks back up, and — in the same visit of
 * the node's element children — each child's 1-based position among its
 * same-tag siblings and their count. `adapter` answers `nthOfType` from that
 * record, so no segment of any path rescans its parent's children: O(n) for the
 * whole payload, where the scan was O(k²) under a parent with k children.
 *
 * `inside` marks a node below an editable root, whose `id`s are ignored, as
 * documented on `enrichFromDom` (native-tree.ts).
 */
export function createLocatorIndex(): {
  adapter: CssPathAdapter<DomNode>;
  link(node: DomNode, inside: boolean): void;
} {
  // Parent links aren't in the payload — record them on the way down so the
  // locator walk can go back up.
  const parents = new Map<DomNode, DomNode>();
  const positions = new Map<DomNode, { index: number; count: number }>();
  // Everything strictly below an editable root — the user's content.
  const insideEditable = new Set<DomNode>();
  const elementChildren = (node: DomNode): DomNode[] =>
    (node.children ?? []).filter((c) => c.nodeType === ELEMENT_NODE);
  const tagOf = (n: DomNode): string => (n.nodeName ?? "").toLowerCase();

  const adapter: CssPathAdapter<DomNode> = {
    tagName: tagOf,
    id: (n) => (insideEditable.has(n) ? null : attributeOf(n, "id")),
    parent: (n) => parents.get(n) ?? null,
    children: (n) => elementChildren(n),
    nthOfType: (n) => positions.get(n),
    // Two kinds of stop. `<html>` is the document element — the path stops
    // before including it, matching the DOM producer. Anything that isn't an
    // element (`#document`, and a `#document-fragment` shadow root) is a
    // boundary a CSS path cannot cross: this walk pierces shadow roots and the
    // in-page one does not, so native alone reaches nodes with no whole-document
    // selector. Those stop too, yielding a partial path anchored inside the
    // shadow root rather than a `#document-fragment > …` selector that would
    // look queryable and match nothing.
    isRoot: (n) => n.nodeType !== ELEMENT_NODE || tagOf(n) === "html",
  };

  return {
    adapter,
    link(node, inside) {
      if (inside) insideEditable.add(node);
      const kids = elementChildren(node);
      if (kids.length === 0) return;
      const totals = new Map<string, number>();
      for (const child of kids) {
        const tag = tagOf(child);
        totals.set(tag, (totals.get(tag) ?? 0) + 1);
      }
      const seen = new Map<string, number>();
      for (const child of kids) {
        parents.set(child, node);
        const tag = tagOf(child);
        const index = (seen.get(tag) ?? 0) + 1;
        seen.set(tag, index);
        positions.set(child, { index, count: totals.get(tag)! });
      }
    },
  };
}
