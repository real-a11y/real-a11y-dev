// Unit tests for the Node-side native checkpoint. The module is pure — two
// trees and a URL in, a verdict out — so the fixtures are hand-built native
// shapes (`ax-dom-<backendNodeId>` under the synthesized `ax-root`), no
// browser.
//
// The load-bearing case is document replacement. A real navigation reallocates
// every backendDOMNodeId, so the two trees share no backend-derived id and the
// checkpoint no longer describes anything; a same-document change always keeps
// at least one element. These pin two things the detector must get right:
//
//   1. the verdict follows shared ids, NOT the URL — which the measured
//      scenarios showed to be wrong in three of five cases; and
//   2. `ax-root` doesn't count. It is minted for any page with more than one
//      top-level node (the ordinary header/main/footer shape) and its id is a
//      CONSTANT, so two unrelated documents both carry it. Counting it made
//      every navigation between two normal pages read as an in-place change.
//      The fixtures below therefore ALWAYS include it.

import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";
import { describe, expect, it } from "vitest";

import {
  captureNativeCheckpoint,
  diffNativeCheckpoint,
  documentWasReplaced,
} from "./native-checkpoint.js";

function node(
  id: string,
  role: string,
  name: string,
  overrides: Partial<SemanticNode["a11y"]> = {},
): SemanticNode {
  return {
    id,
    parentId: id === "ax-root" ? null : "ax-root",
    childIds: [],
    depth: id === "ax-root" ? 0 : 1,
    a11y: {
      role,
      name,
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
      ...overrides,
    },
  };
}

function tree(nodes: SemanticNode[], focusedId?: string): ExtractionResult {
  const root = node("ax-root", "document", "");
  root.childIds = nodes.map((n) => n.id);
  const map = new Map<string, SemanticNode>([["ax-root", root]]);
  for (const n of nodes) map.set(n.id, n);
  return {
    rootId: "ax-root",
    nodes: map,
    ...(focusedId ? { focusedId } : {}),
    source: { producer: "native" },
  } as ExtractionResult;
}

const URL_A = "https://example.com/a";
const URL_B = "https://example.com/b";

describe("documentWasReplaced", () => {
  it("is false when the trees share nodes — the document survived", () => {
    const before = tree([node("ax-dom-10", "button", "Open")]);
    const after = tree([
      node("ax-dom-10", "button", "Open", { states: { expanded: true } }),
      node("ax-dom-11", "link", "Alpha"),
    ]);
    expect(documentWasReplaced(before, after)).toBe(false);
  });

  it("is true when no node id survives — every backendNodeId reallocated", () => {
    const before = tree([node("ax-dom-10", "button", "Go")]);
    const after = tree([node("ax-dom-90", "button", "On B")]);
    // Both trees carry `ax-root` — that is exactly the case that used to be
    // misread as "same document". Only backend-derived ids may count.
    expect(documentWasReplaced(before, after)).toBe(true);
  });

  it("holds even when a single node survives — one shared id means same document", () => {
    // The SPA-route case measured 14% overlap: `main` survived while all of its
    // children were replaced. That is a diff worth showing, not a navigation.
    const before = tree([
      node("ax-dom-10", "main", ""),
      node("ax-dom-11", "heading", "Route 1"),
    ]);
    const after = tree([
      node("ax-dom-10", "main", ""),
      node("ax-dom-99", "heading", "Route 2"),
    ]);
    expect(documentWasReplaced(before, after)).toBe(false);
  });

  it("ignores the synthesized root — two unrelated pages both carry ax-root", () => {
    // The regression. Every header/main/footer page gets `ax-root`, so a
    // navigation between two ordinary pages shares exactly that one id. Reading
    // it as a survivor rendered the whole old page removed and the whole new
    // page added — the precise noise this detector exists to suppress.
    const before = tree([
      node("ax-dom-7", "banner", ""),
      node("ax-dom-8", "main", ""),
      node("ax-dom-9", "contentinfo", ""),
    ]);
    const after = tree([
      node("ax-dom-25", "banner", ""),
      node("ax-dom-26", "main", ""),
      node("ax-dom-27", "contentinfo", ""),
    ]);
    expect(before.nodes.has("ax-root")).toBe(true);
    expect(after.nodes.has("ax-root")).toBe(true);
    expect(documentWasReplaced(before, after)).toBe(true);
  });

  it("ignores ax-<n> ids too — per-document numbering that collides", () => {
    // AX nodes with no backing DOM node are keyed by Chromium's AX node id,
    // which restarts per document, so the same string can name two unrelated
    // nodes. Same reasoning as `ax-root`: not backend-derived, doesn't count.
    const before = tree([
      node("ax-4", "generic", ""),
      node("ax-dom-7", "main", ""),
    ]);
    const after = tree([
      node("ax-4", "generic", ""),
      node("ax-dom-25", "main", ""),
    ]);
    expect(documentWasReplaced(before, after)).toBe(true);
  });

  it("cannot answer without backend-derived ids, and says so conservatively", () => {
    // Nothing to compare — report "not replaced" rather than guess. Wrongly
    // claiming a replacement silently swallows the user's diff; wrongly diffing
    // shows them something they can judge. Also right for about:blank, where
    // "everything was added" IS the honest report.
    const rootOnly = tree([]);
    const real = tree([node("ax-dom-7", "main", "")]);
    expect(documentWasReplaced(rootOnly, real)).toBe(false);
    expect(documentWasReplaced(real, rootOnly)).toBe(false);
  });

  it("does not call an empty capture a replacement", () => {
    const empty = tree([]);
    empty.nodes.clear();
    expect(
      documentWasReplaced(empty, tree([node("ax-dom-1", "button", "A")])),
    ).toBe(false);
    expect(
      documentWasReplaced(tree([node("ax-dom-1", "button", "A")]), empty),
    ).toBe(false);
  });
});

describe("diffNativeCheckpoint", () => {
  it("renders what changed when the document survived", () => {
    const before = tree([node("ax-dom-10", "button", "Open menu")]);
    const cp = captureNativeCheckpoint(before, URL_A);
    const after = tree([
      node("ax-dom-10", "button", "Open menu", {
        states: { expanded: true },
      }),
      node("ax-dom-11", "link", "Alpha"),
    ]);

    const out = diffNativeCheckpoint(cp, after, URL_A);
    expect(out.kind).toBe("diff");
    if (out.kind !== "diff") return;
    expect(out.changed).toBe(true);
    expect(out.rendered).toContain('+ link "Alpha"');
    expect(out.rendered).toContain("expanded");
  });

  it("reports no change without claiming a navigation", () => {
    const before = tree([node("ax-dom-10", "button", "Save")]);
    const out = diffNativeCheckpoint(
      captureNativeCheckpoint(before, URL_A),
      tree([node("ax-dom-10", "button", "Save")]),
      URL_A,
    );
    expect(out.kind).toBe("diff");
    if (out.kind !== "diff") return;
    expect(out.changed).toBe(false);
  });

  it("renders the focus move, which is the whole output of a focus step", () => {
    const target = node("ax-dom-11", "textbox", "Email");
    const before = tree([node("ax-dom-10", "button", "Save"), target]);
    const after = tree(
      [
        node("ax-dom-10", "button", "Save"),
        node("ax-dom-11", "textbox", "Email"),
      ],
      "ax-dom-11",
    );

    const out = diffNativeCheckpoint(
      captureNativeCheckpoint(before, URL_A),
      after,
      URL_A,
    );
    expect(out.kind).toBe("diff");
    if (out.kind !== "diff") return;
    // Nothing was added, removed, or field-changed — the focus line is the only
    // reason this isn't reported as "no changes".
    expect(out.changed).toBe(true);
    expect(out.rendered).toMatch(/focus/i);
    expect(out.rendered).toContain("Email");
  });

  it("reports a replacement, carrying both URLs", () => {
    const before = tree([node("ax-dom-10", "link", "Go to B")]);
    const after = tree([node("ax-dom-90", "button", "On B")]);

    const out = diffNativeCheckpoint(
      captureNativeCheckpoint(before, URL_A),
      after,
      URL_B,
    );
    expect(out).toEqual({ kind: "replaced", from: URL_A, to: URL_B });
  });

  it("reports a replacement when the URL did NOT change — a reload", () => {
    // Measured: `location.reload()` keeps the URL and shares zero ids. A URL
    // comparison would diff two unrelated documents and render the whole page
    // as removed-then-added.
    const before = tree([node("ax-dom-10", "button", "Reload")]);
    const after = tree([node("ax-dom-70", "button", "Reload")]);

    const out = diffNativeCheckpoint(
      captureNativeCheckpoint(before, URL_A),
      after,
      URL_A,
    );
    expect(out).toEqual({ kind: "replaced", from: URL_A, to: URL_A });
  });

  it("diffs normally when the URL DID change but the document didn't — a hash or SPA route", () => {
    const before = tree([
      node("ax-dom-10", "main", ""),
      node("ax-dom-11", "heading", "Route 1"),
    ]);
    const after = tree([
      node("ax-dom-10", "main", ""),
      node("ax-dom-99", "heading", "Route 2"),
    ]);

    const out = diffNativeCheckpoint(
      captureNativeCheckpoint(before, URL_A),
      after,
      `${URL_A}?route=2`,
    );
    expect(out.kind).toBe("diff");
    if (out.kind !== "diff") return;
    expect(out.changed).toBe(true);
    expect(out.rendered).toContain('+ heading "Route 2"');
    expect(out.rendered).toContain('- heading "Route 1"');
  });

  it("records the node count at capture time", () => {
    const cp = captureNativeCheckpoint(
      tree([
        node("ax-dom-10", "button", "A"),
        node("ax-dom-11", "button", "B"),
      ]),
      URL_A,
    );
    expect(cp.nodeCount).toBe(3); // two controls + the synthesized root
    expect(cp.url).toBe(URL_A);
  });
});
