import { describe, expect, it } from "vitest";

import { fieldRelationRoots, fieldRelationTargets } from "./ax-node.js";
import { indexNativeAX, type RawAXNameNode } from "./value-regions.js";

/** A combobox at backend 10 relating to backend 20, a wrapper around a list. */
const nodes = (relation: string): RawAXNameNode[] => [
  {
    nodeId: "1",
    backendDOMNodeId: 10,
    role: { value: "combobox" },
    properties: [
      {
        name: relation,
        value: {
          type: "idrefList",
          relatedNodes: [{ backendDOMNodeId: 20 }],
        },
      },
    ],
  },
  { nodeId: "2", backendDOMNodeId: 20, childIds: ["3"] },
  { nodeId: "3", backendDOMNodeId: 30, childIds: ["4"] },
  { nodeId: "4", backendDOMNodeId: 40 },
  { nodeId: "5", backendDOMNodeId: 50 },
];

describe("what a field controls or owns", () => {
  it("follows aria-controls and aria-owns, as Chromium resolves them", () => {
    for (const relation of ["controls", "owns"]) {
      const raw = nodes(relation);
      const index = indexNativeAX(raw);
      expect(
        fieldRelationRoots(index, raw[0]!).map((n) => n.nodeId),
        relation,
      ).toEqual(["2"]);
      expect(
        fieldRelationTargets(index, raw[0]!)
          .map((n) => n.nodeId)
          .sort(),
        relation,
      ).toEqual(["2", "3", "4"]);
    }
  });

  it("follows no other relation", () => {
    for (const relation of ["labelledby", "describedby", "flowto", "details"]) {
      const raw = nodes(relation);
      expect(
        fieldRelationTargets(indexNativeAX(raw), raw[0]!),
        relation,
      ).toEqual([]);
    }
  });

  it("skips a target the tree doesn't hold, and visits a shared one once", () => {
    const raw = nodes("controls");
    raw[0]!.properties!.push({
      name: "owns",
      value: {
        type: "idrefList",
        relatedNodes: [{ backendDOMNodeId: 20 }, { backendDOMNodeId: 99 }],
      },
    });
    const index = indexNativeAX(raw);
    expect(fieldRelationRoots(index, raw[0]!).map((n) => n.nodeId)).toEqual([
      "2",
    ]);
    expect(fieldRelationTargets(index, raw[0]!)).toHaveLength(3);
  });
});
