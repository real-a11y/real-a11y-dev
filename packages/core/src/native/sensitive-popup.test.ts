import { describe, expect, it } from "vitest";

import { withholdSensitiveFieldNames } from "./sensitive-names.js";
import {
  carriesChoiceState,
  dropChoiceStates,
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
    for (const role of [
      "listbox",
      "grid",
      "treegrid",
      "tree",
      "menu",
      "radiogroup",
    ]) {
      expect(rootsOf(popup(role, true)), role).toEqual(["3"]);
    }
    // A dialog holds anything.
    expect(rootsOf(popup("dialog", true))).toEqual([]);
  });

  it("hold a choice, or lend none", () => {
    expect(rootsOf(popup("listbox", false))).toEqual([]);
  });

  it("hold a choice marked by any choice state, a choice item's checked among them", () => {
    /** `popup("menu")` with its item in `role` carrying `state` = `value`. */
    const marked = (role: string, state: string, value: unknown) => {
      const raw = popup("menu", false);
      raw[3] = {
        ...raw[3]!,
        role: { value: role },
        properties: [{ name: state, value: { value } }],
      };
      return raw;
    };
    for (const [role, state, value] of [
      ["menuitemradio", "checked", "true"],
      ["menuitemcheckbox", "checked", "mixed"],
      ["option", "checked", "true"],
      ["radio", "checked", "true"],
      ["treeitem", "checked", "true"],
      ["button", "pressed", "true"],
      ["option", "pressed", "mixed"],
    ] as const) {
      expect(rootsOf(marked(role, state, value)), `${role} ${state}`).toEqual([
        "3",
      ]);
    }
    // An item the DOM marks chosen where the tree doesn't say: an option
    // marked current, its backend id in `chosen`.
    const unmarked = marked("option", "focusable", true);
    expect(rootsOf(unmarked)).toEqual([]);
    expect([
      ...sensitivePopupRoots(
        indexNativeAX(unmarked),
        ["1"],
        undefined,
        new Set([40]),
      ),
    ]).toEqual(["3"]);
    // A checkbox is its own control; an unchecked item marks nothing.
    for (const [role, state, value] of [
      ["checkbox", "checked", "true"],
      ["switch", "checked", "true"],
      ["menuitemradio", "checked", "false"],
      ["button", "pressed", "false"],
    ] as const) {
      expect(rootsOf(marked(role, state, value)), `${role} ${state}`).toEqual(
        [],
      );
    }
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
    // The same when a transport reads the wrapper itself as the field.
    expect([...sensitivePopupRoots(index, ["2"])]).toEqual(["5"]);
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

  /**
   * A sensitive combobox (backend 20) whose `aria-controls` names a
   * `role="presentation"` wrapper (backend 40) Chromium leaves out: the field
   * carries no relation, and the wrapper has no node. A button is labelled by
   * the listbox inside it.
   */
  const dropped = (): RawAXNameNode[] => [
    { nodeId: "1", childIds: ["2", "5", "9"], role: { value: "RootWebArea" } },
    {
      nodeId: "2",
      parentId: "1",
      backendDOMNodeId: 20,
      role: { value: "combobox" },
    },
    {
      nodeId: "5",
      parentId: "1",
      backendDOMNodeId: 50,
      childIds: ["6"],
      role: { value: "listbox" },
    },
    { ...option("6", "5"), name: { value: "Visa 1111" } },
    {
      nodeId: "9",
      parentId: "1",
      backendDOMNodeId: 90,
      role: { value: "button" },
      name: { value: "Visa 1111" },
      properties: [
        {
          name: "labelledby",
          value: {
            type: "idrefList",
            relatedNodes: [{ backendDOMNodeId: 50 }],
          },
        },
      ],
    },
  ];

  it("is what the DOM says a relation Chromium dropped leads to", () => {
    const index = indexNativeAX(dropped());
    expect([...sensitiveChoiceReach(index, ["2"])]).toEqual([]);
    // The DOM walk's answer: the wrapper's subtree, which has no node.
    const targets = new Set([40, 50, 60]);
    expect([...sensitiveChoiceReach(index, ["2"], targets)].sort()).toEqual([
      "5",
      "6",
    ]);
    expect([...sensitivePopupRoots(index, ["2"], targets)]).toEqual(["5"]);
  });

  it("withholds a name that reads the popup there", () => {
    const named = (choiceTargets?: Set<number>) =>
      withholdSensitiveFieldNames(dropped(), ["2"], [], { choiceTargets }).find(
        (n) => n.nodeId === "9",
      )?.name?.value;
    expect(named()).toBe("Visa 1111");
    expect(named(new Set([40, 50, 60]))).toBe("[redacted]");
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

describe("the states a sensitive popup's choice is withheld from", () => {
  it("are the choice states: selected anywhere, a choice item's checked, pressed", () => {
    const states = {
      selected: true,
      checked: true,
      pressed: "mixed",
      expanded: true,
      disabled: true,
    };
    for (const role of [
      "option",
      "treeitem",
      "menuitemradio",
      "menuitemcheckbox",
      "radio",
    ]) {
      const kept: Record<string, unknown> = { ...states };
      expect(carriesChoiceState(kept, role), role).toBe(true);
      dropChoiceStates(kept, role);
      expect(kept, role).toEqual({ expanded: true, disabled: true });
    }
  });

  it("keep a checkbox's or switch's own checked", () => {
    for (const role of ["checkbox", "switch"]) {
      const kept: Record<string, unknown> = { checked: true, pressed: true };
      dropChoiceStates(kept, role);
      expect(kept, role).toEqual({ checked: true });
      expect(carriesChoiceState({ checked: true }, role), role).toBe(false);
    }
  });
});

describe("the popup an active descendant reaches", () => {
  it("is every choice container above it, not only the nearest", () => {
    // A field whose active descendant is a radio in a group nested in a
    // grid: the grid, and its chosen row outside the group, are the popup.
    const raw: RawAXNameNode[] = [
      { nodeId: "1", childIds: ["2", "3"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        backendDOMNodeId: 20,
        role: { value: "combobox" },
        properties: [
          {
            name: "activedescendant",
            value: { type: "idref", relatedNodes: [{ backendDOMNodeId: 60 }] },
          },
        ],
      },
      {
        nodeId: "3",
        parentId: "1",
        backendDOMNodeId: 30,
        role: { value: "grid" },
        childIds: ["4", "5"],
      },
      {
        nodeId: "4",
        parentId: "3",
        backendDOMNodeId: 40,
        role: { value: "row" },
        properties: [{ name: "selected", value: { value: true } }],
      },
      {
        nodeId: "5",
        parentId: "3",
        backendDOMNodeId: 50,
        role: { value: "radiogroup" },
        childIds: ["6"],
      },
      {
        nodeId: "6",
        parentId: "5",
        backendDOMNodeId: 60,
        role: { value: "radio" },
      },
    ];
    expect([...sensitiveChoiceReach(indexNativeAX(raw), ["2"])].sort()).toEqual(
      ["3", "4", "5", "6"],
    );
  });
});
