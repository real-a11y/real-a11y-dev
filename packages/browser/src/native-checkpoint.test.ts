// Unit tests for the Node-side native checkpoint. The module is pure — two
// trees and a URL in, a verdict out — so the fixtures are hand-built native
// shapes (`ax-dom-<backendNodeId>` under a synthesized root), no browser.
//
// The load-bearing case is document replacement. A real navigation reallocates
// every backendNodeId, so the two trees share nothing and the checkpoint no
// longer describes anything; a same-document change always keeps at least the
// root. These pin that the verdict follows shared ids and NOT the URL, which
// the measured scenarios showed to be wrong in three of five cases.

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
    parentId: id === "ax-1" ? null : "ax-1",
    childIds: [],
    depth: id === "ax-1" ? 0 : 1,
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
  const root = node("ax-1", "document", "");
  root.childIds = nodes.map((n) => n.id);
  const map = new Map<string, SemanticNode>([["ax-1", root]]);
  for (const n of nodes) map.set(n.id, n);
  return {
    rootId: "ax-1",
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
    // Both trees carry `ax-1`, so this only holds because the synthesized root
    // is rebuilt per extraction — assert the real condition, not the fixture.
    after.nodes.delete("ax-1");
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
    after.nodes.delete("ax-1");

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
    after.nodes.delete("ax-1");

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
