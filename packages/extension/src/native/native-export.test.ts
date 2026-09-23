import { getOutline, linearize } from "@real-a11y-dev/core";
import { serializeOutline, serializeTree } from "@real-a11y-dev/serialize";
import { describe, expect, it } from "vitest";

import type { NativeNode } from "./native-actions.js";
import { toExtractionResult } from "./native-export.js";

/** Root > main > [heading "Welcome" (level 1), button "Submit"] — enough to
 *  exercise role/name, an AX property (heading level), a state (checked),
 *  and the parent-index derivation from childIds. */
function buildTree(): Map<string, NativeNode> {
  const nodes: NativeNode[] = [
    {
      id: "root",
      role: "RootWebArea",
      name: "Test page",
      depth: 0,
      childIds: ["main"],
    },
    {
      id: "main",
      role: "main",
      name: "",
      depth: 1,
      childIds: ["heading", "button"],
    },
    {
      id: "heading",
      role: "heading",
      name: "Welcome",
      depth: 2,
      properties: { level: "1" },
    },
    {
      id: "button",
      role: "button",
      name: "Submit",
      depth: 2,
      states: { checked: true },
      description: "Submits the form",
    },
  ];
  return new Map(nodes.map((n) => [n.id, n]));
}

describe("toExtractionResult", () => {
  it("stamps the native producer", () => {
    const tree = toExtractionResult(buildTree(), "root");
    expect(tree.source).toEqual({ producer: "native" });
    expect(tree.rootId).toBe("root");
  });

  it("derives parentId from childIds, root included", () => {
    const tree = toExtractionResult(buildTree(), "root");
    expect(tree.nodes.get("root")?.parentId).toBeNull();
    expect(tree.nodes.get("main")?.parentId).toBe("root");
    expect(tree.nodes.get("heading")?.parentId).toBe("main");
    expect(tree.nodes.get("button")?.parentId).toBe("main");
  });

  it("carries role/name/description/states/properties into a11y, with safe defaults", () => {
    const tree = toExtractionResult(buildTree(), "root");
    const heading = tree.nodes.get("heading")!;
    expect(heading.a11y.role).toBe("heading");
    expect(heading.a11y.name).toBe("Welcome");
    expect(heading.a11y.properties).toEqual({ level: "1" });
    expect(heading.a11y.description).toBe(""); // no description on this node
    expect(heading.a11y.states).toEqual({}); // no states on this node

    const button = tree.nodes.get("button")!;
    expect(button.a11y.states).toEqual({ checked: true });
    expect(button.a11y.description).toBe("Submits the form");
  });

  it("leaves dom/interaction/ui absent, matching a native SemanticNode elsewhere in the codebase", () => {
    const tree = toExtractionResult(buildTree(), "root");
    const node = tree.nodes.get("button")!;
    expect(node.dom).toBeUndefined();
    expect(node.interaction).toBeUndefined();
    expect(node.ui).toBeUndefined();
  });

  it("round-trips through @real-a11y-dev/core's own tree walk (linearize)", () => {
    const tree = toExtractionResult(buildTree(), "root");
    const printed = linearize(tree);
    expect(printed.map((n) => n.id)).toEqual([
      "root",
      "main",
      "heading",
      "button",
    ]);
  });

  it("is consumable by @real-a11y-dev/serialize's serializeTree/serializeOutline", () => {
    const tree = toExtractionResult(buildTree(), "root");
    expect(serializeTree(tree)).toBe(
      [
        'RootWebArea "Test page"',
        "  main",
        '    heading "Welcome" (level 1)',
        '    button "Submit"',
      ].join("\n"),
    );
    expect(serializeOutline(tree)).toBe("h1 Welcome");
    expect(getOutline(tree)).toEqual([
      { id: "heading", level: 1, name: "Welcome" },
    ]);
  });

  it("handles an empty tree without throwing", () => {
    const tree = toExtractionResult(new Map(), "root");
    expect(tree.nodes.size).toBe(0);
    expect(serializeTree(tree)).toBe("");
  });
});
