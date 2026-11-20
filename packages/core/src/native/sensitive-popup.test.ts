import { describe, expect, it } from "vitest";

import {
  fieldRelationRoots,
  fieldRelationTargets,
  sensitiveChoiceHosts,
  sensitivePopupRoots,
} from "./sensitive-popup.js";
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

describe("the nodes whose relations reach a sensitive field's popup", () => {
  it("are the field and each combobox around it", () => {
    // An ARIA 1.1 combobox: the wrapper carries the relation, the textbox
    // inside it is the sensitive field.
    const raw: RawAXNameNode[] = [
      { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        childIds: ["3"],
        role: { value: "combobox" },
      },
      {
        nodeId: "3",
        parentId: "2",
        childIds: ["4"],
        role: { value: "generic" },
      },
      { nodeId: "4", parentId: "3", role: { value: "textbox" } },
    ];
    const byId = indexNativeAX(raw).byId;
    expect(sensitiveChoiceHosts(byId, ["4"]).map((n) => n.nodeId)).toEqual([
      "4",
      "2",
    ]);
    // A field outside any combobox is its own only host.
    expect(sensitiveChoiceHosts(byId, ["2"]).map((n) => n.nodeId)).toEqual([
      "2",
    ]);
  });
});

describe("the choice containers in a sensitive field's popup", () => {
  /** A field at backend 10 controlling a wrapper (20) around `role` (30). */
  const popup = (role: string, selected: boolean): RawAXNameNode[] => [
    {
      nodeId: "1",
      backendDOMNodeId: 10,
      role: { value: "combobox" },
      properties: [
        {
          name: "controls",
          value: {
            type: "idrefList",
            relatedNodes: [{ backendDOMNodeId: 20 }],
          },
        },
      ],
    },
    {
      nodeId: "2",
      backendDOMNodeId: 20,
      role: { value: "generic" },
      childIds: ["3"],
    },
    {
      nodeId: "3",
      backendDOMNodeId: 30,
      role: { value: role },
      childIds: ["4"],
    },
    {
      nodeId: "4",
      backendDOMNodeId: 40,
      role: { value: "option" },
      properties: [{ name: "selected", value: { value: selected } }],
    },
  ];
  const rootsOf = (raw: RawAXNameNode[], fields = ["1"]) => [
    ...sensitivePopupRoots(indexNativeAX(raw), fields),
  ];

  it("are the containers a choice is made in, under what the field controls", () => {
    for (const role of ["listbox", "grid", "treegrid", "tree"]) {
      expect(rootsOf(popup(role, true)), role).toEqual(["3"]);
    }
    // A dialog holds anything, and a menu's choice is `checked`.
    for (const role of ["dialog", "menu"]) {
      expect(rootsOf(popup(role, true)), role).toEqual([]);
    }
  });

  it("hold a choice, or lend none", () => {
    expect(rootsOf(popup("listbox", false))).toEqual([]);
  });

  it("are only a sensitive field's", () => {
    expect(rootsOf(popup("listbox", true), [])).toEqual([]);
  });
});
