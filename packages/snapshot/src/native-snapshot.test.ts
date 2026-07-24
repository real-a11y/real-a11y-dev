import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";
import { describe, expect, it } from "vitest";

import { projectNativeTree } from "./native-snapshot.js";

// Native-shaped node: `a11y` only (the CDP producer is read-only and carries no
// dom/interaction/ui facets for UA-shadow nodes).
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

describe("projectNativeTree", () => {
  const ext = tree([
    node({
      id: "root",
      parentId: null,
      childIds: ["h", "vid", "b"],
      depth: 0,
      role: "main",
    }),
    node({
      id: "h",
      parentId: "root",
      depth: 1,
      role: "heading",
      name: "Player",
      level: "1",
    }),
    // A UA-shadow media control the DOM producer never sees.
    node({
      id: "vid",
      parentId: "root",
      depth: 1,
      role: "slider",
      name: "video time scrubber",
    }),
    // An unlabeled interactive node → a finding, computed in Node.
    node({ id: "b", parentId: "root", depth: 1, role: "button" }),
  ]);

  it("serializes tree + outline and audits in Node, with an empty tab order", () => {
    const snap = projectNativeTree(ext);
    expect(snap.tree).toContain("main");
    expect(snap.tree).toContain('slider "video time scrubber"');
    expect(snap.outline).toBe("h1 Player");
    // Native carries no focus/interaction data.
    expect(snap.tabOrder).toBe("");
    // The unlabeled button is flagged by the Node-side audit.
    expect(
      snap.findings.some((f) => f.rule === "no-unlabeled-interactive"),
    ).toBe(true);
  });

  it("honors a rule subset", () => {
    // Restrict to a rule the tree doesn't violate → no findings.
    const snap = projectNativeTree(ext, { rules: ["image-alt"] });
    expect(snap.findings).toHaveLength(0);
  });
});
