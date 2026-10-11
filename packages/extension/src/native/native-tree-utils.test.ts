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
  it("indexes the rows a read numbered, and only those, frame by frame", () => {
    const { byFrame, owners } = nativeRowsByPageKey(
      tree([
        node("ax-dom-1", { pageKey: 0 }),
        node("ax-root"),
        node("ax-dom-8", { role: "Iframe", pageKey: 4, embedsPageFrame: 3 }),
        node("ax-dom-9", { pageKey: 5 }),
        // A frame's numbers start again from 0: its 4 is another element.
        node("ax-dom-25", { pageKey: 4, pageFrame: 3 }),
      ]),
    );
    expect(
      Object.fromEntries(
        [...byFrame].map(([frame, rows]) => [frame, Object.fromEntries(rows)]),
      ),
    ).toEqual({
      0: { 0: "ax-dom-1", 4: "ax-dom-8", 5: "ax-dom-9" },
      3: { 4: "ax-dom-25" },
    });
    expect(Object.fromEntries(owners)).toEqual({ 3: "ax-dom-8" });
  });
});

describe("nativeRowForPageFocus", () => {
  const rows = nativeRowsByPageKey(
    tree([
      node("ax-dom-body", { pageKey: 2 }),
      node("ax-dom-button", { pageKey: 7 }),
      node("ax-dom-frame", { role: "Iframe", pageKey: 9, embedsPageFrame: 3 }),
      node("ax-dom-inner", { pageKey: 7, pageFrame: 3 }),
    ]),
  );

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

  it("looks a frame's report up among that frame's rows alone", () => {
    expect(nativeRowForPageFocus({ r1: [7, 2] }, "r1", rows, 3)).toBe(
      "ax-dom-inner",
    );
    expect(nativeRowForPageFocus({ r1: [7, 2] }, "r1", rows, 0)).toBe(
      "ax-dom-button",
    );
  });

  it("lands on the frame's own row when nothing focused in the frame has one", () => {
    // Focus on the frame's <body>, say, which the tree has no row for.
    expect(nativeRowForPageFocus({ r1: [2] }, "r1", rows, 3)).toBe(
      "ax-dom-frame",
    );
    // Or on an element of a document the frame's page wrote since the read,
    // none of whose elements the read numbered: the report is empty.
    expect(nativeRowForPageFocus({ r1: [] }, "r1", rows, 3)).toBe(
      "ax-dom-frame",
    );
    expect(nativeRowForPageFocus({ r1: [] }, "r1", rows, 0)).toBeUndefined();
    // Never in the top frame, which no row shows, nor in a frame the read
    // numbered no document of.
    expect(nativeRowForPageFocus({ r1: [99] }, "r1", rows, 0)).toBeUndefined();
    expect(nativeRowForPageFocus({ r1: [7] }, "r1", rows, 5)).toBeUndefined();
    // Nor for a report under another read.
    expect(nativeRowForPageFocus({ r0: [2] }, "r1", rows, 3)).toBeUndefined();
  });

  it("finds nothing for a frame that isn't a number", () => {
    expect(nativeRowForPageFocus({ r1: [7] }, "r1", rows, "3")).toBeUndefined();
    expect(nativeRowForPageFocus({ r1: [7] }, "r1", rows, undefined)).toBe(
      "ax-dom-button",
    );
  });
});
