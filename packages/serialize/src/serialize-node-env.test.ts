// @vitest-environment node
//
// Regression: serializers must accept a pre-extracted tree in plain Node —
// no jsdom, no browser, no `Element` global. Before the `isDomRoot` feature
// detection, `toTree`'s bare `instanceof Element` threw
// `TypeError: Right-hand side of 'instanceof' is not an object` for EVERY
// input, making ExtractionResults from non-DOM producers (a CDP-backed
// native tree, a deserialized snapshot) unserializable outside a DOM runtime.

import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";
import { describe, expect, it } from "vitest";

import {
  serializeOutline,
  serializeTabSequence,
  serializeTree,
} from "./serialize.js";

function node(partial: {
  id: string;
  parentId: string | null;
  childIds?: string[];
  depth: number;
  role: string;
  name?: string;
  level?: string;
  focusable?: boolean;
}): SemanticNode {
  return {
    id: partial.id,
    parentId: partial.parentId,
    childIds: partial.childIds ?? [],
    depth: partial.depth,
    dom: {
      tagName: "div",
      attributes: {},
      textContent: null,
      descendantText: "",
      isHidden: false,
    },
    a11y: {
      role: partial.role,
      name: partial.name ?? "",
      description: "",
      states: partial.focusable ? { focusable: true } : {},
      properties: partial.level ? { level: partial.level } : {},
      isExposedToAT: true,
    },
    interaction: {
      isInteractive: Boolean(partial.focusable),
      actions: [],
      isFocusable: Boolean(partial.focusable),
      isEditable: false,
    },
    ui: {
      expanded: true,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

function tree(): ExtractionResult {
  const nodes: SemanticNode[] = [
    node({
      id: "root",
      parentId: null,
      childIds: ["h", "b"],
      depth: 0,
      role: "main",
    }),
    node({
      id: "h",
      parentId: "root",
      depth: 1,
      role: "heading",
      name: "Plain Node",
      level: "1",
    }),
    node({
      id: "b",
      parentId: "root",
      depth: 1,
      role: "button",
      name: "Save",
      focusable: true,
    }),
  ];
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    rootId: "root",
    source: { producer: "dom" },
  };
}

describe("serializers in a DOM-less runtime (no Element global)", () => {
  it("this environment really has no Element global", () => {
    expect(typeof Element).toBe("undefined");
  });

  it("serializeTree accepts an ExtractionResult", () => {
    expect(serializeTree(tree())).toBe(
      ["main", '  heading "Plain Node" (level 1)', '  button "Save"'].join(
        "\n",
      ),
    );
  });

  it("serializeOutline accepts an ExtractionResult", () => {
    expect(serializeOutline(tree())).toBe("h1 Plain Node");
  });

  it("serializeTabSequence accepts an ExtractionResult", () => {
    expect(serializeTabSequence(tree())).toContain('button "Save"');
  });
});
