// @vitest-environment node
//
// Regression: the audit rules must run in plain Node — no jsdom, no browser,
// no `Element` global. The native producer reads Chromium's a11y tree over CDP
// and then runs `collectFindings`/`assertRules` in Node over the resulting
// `ExtractionResult`. Before `toTree` guarded on `typeof Element`, its bare
// `root instanceof Element` threw `ReferenceError: Element is not defined` for
// every input, so `attach(page, { tree: "native" })`'s assertions crashed
// instead of auditing.

import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";
import { describe, expect, it } from "vitest";

import { assertRules, collectFindings } from "./index.js";

// Native-shaped node: `a11y` only, no `dom`/`interaction`/`ui` facets (the
// producer is read-only and CDP-backed). Mirrors what `nativeTree()` emits.
function node(partial: {
  id: string;
  parentId: string | null;
  childIds?: string[];
  depth: number;
  role: string;
  name?: string;
  level?: string;
}): SemanticNode {
  return {
    id: partial.id,
    parentId: partial.parentId,
    childIds: partial.childIds ?? [],
    depth: partial.depth,
    a11y: {
      role: partial.role,
      name: partial.name ?? "",
      description: "",
      states: {},
      properties: partial.level ? { level: partial.level } : {},
      isExposedToAT: true,
    },
  };
}

function tree(nodes: SemanticNode[]): ExtractionResult {
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    rootId: nodes[0].id,
    source: { producer: "native" },
  };
}

describe("audit in a DOM-less runtime (no Element global)", () => {
  it("this environment really has no Element global", () => {
    expect(typeof Element).toBe("undefined");
  });

  it("collectFindings accepts an ExtractionResult with no dom facet", () => {
    // An unlabeled button — role-only wording, since there's no `dom.tagName`.
    const findings = collectFindings(
      tree([
        node({
          id: "root",
          parentId: null,
          childIds: ["b"],
          depth: 0,
          role: "main",
        }),
        node({ id: "b", parentId: "root", depth: 1, role: "button" }),
      ]),
      ["no-unlabeled-interactive"],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe("Unlabeled interactive element: button");
    expect(findings[0].tagName).toBeUndefined();
  });

  it("assertRules throws on a violation and passes on a clean tree", () => {
    const bad = tree([
      node({
        id: "root",
        parentId: null,
        childIds: ["b"],
        depth: 0,
        role: "main",
      }),
      node({ id: "b", parentId: "root", depth: 1, role: "button" }),
    ]);
    expect(() => assertRules(bad, ["no-unlabeled-interactive"])).toThrow(
      /Unlabeled interactive/,
    );

    const good = tree([
      node({
        id: "root",
        parentId: null,
        childIds: ["b"],
        depth: 0,
        role: "main",
      }),
      node({
        id: "b",
        parentId: "root",
        depth: 1,
        role: "button",
        name: "Save",
      }),
    ]);
    expect(() => assertRules(good, ["no-unlabeled-interactive"])).not.toThrow();
  });
});
