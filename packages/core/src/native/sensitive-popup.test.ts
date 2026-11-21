import { describe, expect, it } from "vitest";

import {
  fieldRelationRoots,
  sensitiveChoiceHosts,
  sensitiveChoiceReach,
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
      expect([...sensitiveChoiceReach(index, ["1"])].sort(), relation).toEqual([
        "2",
        "3",
        "4",
      ]);
    }
  });

  it("follows no other relation", () => {
    for (const relation of ["labelledby", "describedby", "flowto", "details"]) {
      const raw = nodes(relation);
      expect(
        [...sensitiveChoiceReach(indexNativeAX(raw), ["1"])],
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
    expect(sensitiveChoiceReach(index, ["1"]).size).toBe(3);
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

describe("where a sensitive field's choice is made, beyond its relations", () => {
  const option = (nodeId: string, parentId: string, selected = true) => ({
    nodeId,
    parentId,
    backendDOMNodeId: Number(nodeId) * 10,
    role: { value: "option" },
    properties: [{ name: "selected", value: { value: selected } }],
  });

  it("is everything a combobox around the field holds, with no relation", () => {
    // The field is not the wrapper's direct child, so Chromium relates it to
    // nothing; the listbox sits beside it in the wrapper.
    const raw: RawAXNameNode[] = [
      { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        childIds: ["3", "5"],
        role: { value: "combobox" },
      },
      {
        nodeId: "3",
        parentId: "2",
        childIds: ["4"],
        role: { value: "generic" },
      },
      { nodeId: "4", parentId: "3", role: { value: "textbox" } },
      {
        nodeId: "5",
        parentId: "2",
        childIds: ["6"],
        role: { value: "listbox" },
      },
      option("6", "5"),
    ];
    const index = indexNativeAX(raw);
    expect([...sensitiveChoiceReach(index, ["4"])].sort()).toEqual([
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
    expect([...sensitivePopupRoots(index, ["4"])]).toEqual(["5"]);
  });

  it("is the choice container the field's aria-activedescendant sits in", () => {
    const raw: RawAXNameNode[] = [
      { nodeId: "1", childIds: ["2", "11"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        role: { value: "combobox" },
        properties: [
          {
            name: "activedescendant",
            value: { type: "idref", relatedNodes: [{ backendDOMNodeId: 120 }] },
          },
        ],
      },
      {
        nodeId: "11",
        parentId: "1",
        childIds: ["12"],
        role: { value: "listbox" },
      },
      option("12", "11"),
    ];
    const index = indexNativeAX(raw);
    expect([...sensitiveChoiceReach(index, ["2"])].sort()).toEqual([
      "11",
      "12",
    ]);
    expect([...sensitivePopupRoots(index, ["2"])]).toEqual(["11"]);
  });

  it("is the field itself when it is a choice container, a multi-row <select>", () => {
    const raw: RawAXNameNode[] = [
      { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        childIds: ["3"],
        role: { value: "listbox" },
      },
      option("3", "2"),
    ];
    const index = indexNativeAX(raw);
    expect([...sensitivePopupRoots(index, ["2"])]).toEqual(["2"]);
    // Nothing chosen lends nothing.
    raw[2] = option("3", "2", false);
    expect([...sensitivePopupRoots(indexNativeAX(raw), ["2"])]).toEqual([]);
  });

  it("is nothing for a page with no sensitive field", () => {
    const raw: RawAXNameNode[] = [
      { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        childIds: ["3"],
        role: { value: "listbox" },
      },
      option("3", "2"),
    ];
    expect(sensitiveChoiceReach(indexNativeAX(raw), []).size).toBe(0);
  });
});
