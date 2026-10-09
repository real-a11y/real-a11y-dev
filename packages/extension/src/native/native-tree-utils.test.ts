import { describe, expect, it } from "vitest";

import type { NativeNode } from "./native-actions.js";
import {
  nativeParentIndex,
  nativeRowForPageFocus,
  nativeRowsByPageKey,
} from "./native-tree-utils.js";

const tree = (nodes: NativeNode[]) => new Map(nodes.map((n) => [n.id, n]));
const node = (id: string, extra: Partial<NativeNode> = {}): NativeNode => ({
  id,
  role: "generic",
  name: "",
  depth: 0,
  ...extra,
});

describe("nativeParentIndex", () => {
  it("maps each child to its parent", () => {
    const parents = nativeParentIndex(
      tree([node("a", { childIds: ["b", "c"] }), node("b"), node("c")]),
    );
    expect(Object.fromEntries(parents)).toEqual({ b: "a", c: "a" });
  });
});

describe("nativeRowsByPageKey", () => {
  it("indexes the rows a read numbered, and only those", () => {
    const rows = nativeRowsByPageKey(
      tree([
        node("ax-dom-1", { pageKey: 0 }),
        node("ax-root"),
        node("ax-dom-9", { pageKey: 4 }),
      ]),
    );
    expect(Object.fromEntries(rows)).toEqual({ 0: "ax-dom-1", 4: "ax-dom-9" });
  });
});

describe("nativeRowForPageFocus", () => {
  const rows = new Map([
    [2, "ax-dom-body"],
    [7, "ax-dom-button"],
  ]);

  it("takes the focused element's row", () => {
    expect(nativeRowForPageFocus({ r1: [7, 2] }, "r1", rows)).toBe(
      "ax-dom-button",
    );
  });

  it("falls back to the nearest element above it with a row", () => {
    expect(nativeRowForPageFocus({ r1: [8, 5, 2] }, "r1", rows)).toBe(
      "ax-dom-body",
    );
  });

  it("reads only what was reported under the read the tree came from", () => {
    expect(nativeRowForPageFocus({ r0: [7] }, "r1", rows)).toBeUndefined();
    expect(nativeRowForPageFocus({ r0: [2], r1: [7] }, "r1", rows)).toBe(
      "ax-dom-button",
    );
  });

  it("finds nothing for a tree that wasn't numbered, a report with nothing in it, or numbers naming no row", () => {
    expect(nativeRowForPageFocus({ r1: [7] }, undefined, rows)).toBeUndefined();
    expect(nativeRowForPageFocus(undefined, "r1", rows)).toBeUndefined();
    expect(nativeRowForPageFocus({ r1: [] }, "r1", rows)).toBeUndefined();
    expect(nativeRowForPageFocus({ r1: [99] }, "r1", rows)).toBeUndefined();
  });

  it("ignores what isn't a list of numbers, or isn't the report's own", () => {
    expect(nativeRowForPageFocus({ r1: 7 }, "r1", rows)).toBeUndefined();
    expect(nativeRowForPageFocus({ r1: ["7", 2] }, "r1", rows)).toBe(
      "ax-dom-body",
    );
    expect(nativeRowForPageFocus({}, "constructor", rows)).toBeUndefined();
    expect(
      nativeRowForPageFocus(
        JSON.parse('{"__proto__": [7]}'),
        "__proto__",
        rows,
      ),
    ).toBe("ax-dom-button");
  });
});
