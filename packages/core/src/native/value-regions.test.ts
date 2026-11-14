import { describe, expect, it } from "vitest";

import { REDACTED_VALUE } from "../extraction/sensitivity.js";

import { normalizeNativeAX, serializeNativeAX } from "./ax-normalize.js";
import {
  fieldStandIns,
  ignoreFieldInternalImages,
  indexNativeAX,
  valueRegions,
  withholdFieldInternals,
  withholdFieldInternalText,
  withholdRegionNames,
  withholdSensitiveFieldNames,
  type FieldHostOf,
  type RawAXNameNode,
} from "./value-regions.js";

/** A raw node; `named` is how Chromium's name trace says it got its name. */
function raw(
  nodeId: string,
  role: string,
  extra: Partial<RawAXNameNode> & { named?: string } = {},
): RawAXNameNode {
  const { named, ...rest } = extra;
  const name = rest.name?.value;
  return {
    nodeId,
    backendDOMNodeId: Number(nodeId),
    role: { value: role },
    ...rest,
    ...(name !== undefined && named !== undefined
      ? {
          name: {
            value: name,
            sources: [{ type: named, value: { value: name } }],
          },
        }
      : {}),
  };
}

describe("withholdSensitiveFieldNames", () => {
  // <td><input autocomplete="cc-number" value="4111…"></td>
  const cell = () => [
    raw("1", "cell", {
      name: { value: "4111111111111111" },
      named: "contents",
      childIds: ["2"],
    }),
    raw("2", "textbox", {
      parentId: "1",
      name: { value: "Card number" },
      named: "relatedElement",
      value: { value: "4111111111111111" },
    }),
  ];

  it("withholds a name built from a sensitive field's contents", () => {
    const out = withholdSensitiveFieldNames(cell(), ["2"]);
    expect(out[0].name?.value).toBe(REDACTED_VALUE);
    // The field's own label is the page's, and is kept.
    expect(out[1].name?.value).toBe("Card number");
  });

  it("leaves names alone around a field that holds nothing", () => {
    const nodes = cell();
    delete nodes[1].value;
    nodes[0].name = { value: "Card number" };
    const out = withholdSensitiveFieldNames(nodes, ["2"]);
    expect(out).toBe(nodes);
  });

  it("keeps a name the page gave, even around a filled field", () => {
    const nodes = cell();
    nodes[0] = raw("1", "cell", {
      name: { value: "Payment" },
      named: "attribute",
      childIds: ["2"],
    });
    const out = withholdSensitiveFieldNames(nodes, ["2"]);
    expect(out[0].name?.value).toBe("Payment");
  });

  it("drops a description that points at a sensitive field", () => {
    const nodes = [
      raw("1", "textbox", { value: { value: "hunter2" } }),
      raw("2", "button", {
        name: { value: "Show" },
        named: "contents",
        description: { value: "hunter2" },
        properties: [
          {
            name: "describedby",
            value: { relatedNodes: [{ backendDOMNodeId: 1 }] },
          },
        ],
      }),
    ];
    const out = withholdSensitiveFieldNames(nodes, ["1"]);
    expect(out[1].description).toBeUndefined();
    expect(out[1].name?.value).toBe("Show");
  });

  it("withholds a name taken from a field Chromium ignores, value or not", () => {
    // <input aria-hidden="true" autocomplete="cc-number" value="3782…">
    // labelling a region: Chromium sends no value for the ignored input,
    // but the region's name is the card.
    const nodes = [
      raw("7", "none", { ignored: true }),
      raw("9", "region", {
        name: { value: "378282246310005" },
        named: "relatedElement",
        properties: [
          {
            name: "labelledby",
            value: { relatedNodes: [{ backendDOMNodeId: 7 }] },
          },
        ],
      }),
    ];
    const out = withholdSensitiveFieldNames(nodes, ["7"]);
    expect(out[1].name?.value).toBe(REDACTED_VALUE);
  });

  it("keeps a field's own label, even one wrapped around it", () => {
    // <label>Card <input autocomplete="cc-number" value="4111…"></label>:
    // the field is labelled by its own <label>, which holds only it.
    const nodes = [
      raw("1", "LabelText", { childIds: ["2"] }),
      raw("2", "textbox", {
        parentId: "1",
        name: { value: "Card" },
        named: "relatedElement",
        value: { value: "4111111111111111" },
        properties: [
          {
            name: "labelledby",
            value: { relatedNodes: [{ backendDOMNodeId: 1 }] },
          },
        ],
      }),
    ];
    const out = withholdSensitiveFieldNames(nodes, ["2"]);
    expect(out[1].name?.value).toBe("Card");
  });

  // <label>Card <input id="card" autocomplete="cc-number" value="4111…">
  //   <input type="password" value="hunter2"></label>, the password being
  //   ignored (aria-hidden) and so never in the tree.
  const sharedLabel = () => [
    raw("1", "LabelText", { childIds: ["2", "3"] }),
    raw("2", "textbox", {
      parentId: "1",
      name: { value: "Card" },
      named: "relatedElement",
      value: { value: "4111111111111111" },
      properties: [
        {
          name: "labelledby",
          value: { relatedNodes: [{ backendDOMNodeId: 1 }] },
        },
      ],
    }),
    raw("3", "none", { parentId: "1", ignored: true }),
  ];

  it("withholds a field's name from a label that also holds another field", () => {
    const out = withholdSensitiveFieldNames(sharedLabel(), ["2", "3"]);
    expect(out[1].name?.value).toBe(REDACTED_VALUE);
  });

  it("withholds a field's own label passed as a root: roots are fields", () => {
    // Nothing tells a label passed in from a field, so its own field's name
    // goes with it. The extension passes the fields inside a label, never
    // the label, for this reason.
    const out = withholdSensitiveFieldNames(sharedLabel().slice(0, 2), [
      "1",
      "2",
    ]);
    expect(out[1].name?.value).toBe(REDACTED_VALUE);
  });

  it("returns the nodes untouched with no sensitive field", () => {
    const nodes = cell();
    expect(withholdSensitiveFieldNames(nodes, [])).toBe(nodes);
  });

  it("withholds through what stands in for a field with no node of its own", () => {
    // Chromium 141 for `<td><input disabled role="none"
    // autocomplete="cc-number" value="4111…"></td>`: the input's node is
    // gone, and its inner box (DOM 28) stands in for it.
    const nodes = [
      raw("27", "LayoutTableCell", {
        name: { value: "4111111111111111" },
        named: "contents",
        childIds: ["28"],
      }),
      raw("28", "generic", { parentId: "27", childIds: ["80"] }),
      raw("80", "StaticText", {
        parentId: "28",
        name: { value: "4111111111111111" },
      }),
    ];
    // As a field it would give nothing away: it holds no value.
    expect(withholdSensitiveFieldNames(nodes, ["28"])).toBe(nodes);
    const out = withholdSensitiveFieldNames(
      nodes,
      [],
      [{ host: 2, nodeIds: ["28"], masked: false }],
    );
    expect(out[0].name?.value).toBe(REDACTED_VALUE);
  });

  it("withholds what references a field with no node of its own", () => {
    // Chromium 141 for `<input id="cc" disabled role="none"
    // autocomplete="cc-number" value="4111…">` (DOM 13), labelling a region
    // and describing a button. Both point at the input, which has no node:
    // its inner box (DOM 14) stands in for it.
    const nodes = [
      raw("12", "main", { childIds: ["14", "15", "16"] }),
      raw("14", "generic", { parentId: "12", childIds: ["38"] }),
      raw("38", "StaticText", {
        parentId: "14",
        name: { value: "4111111111111111" },
      }),
      raw("15", "region", {
        parentId: "12",
        name: { value: "4111111111111111" },
        named: "relatedElement",
        properties: [
          {
            name: "labelledby",
            value: { relatedNodes: [{ backendDOMNodeId: 13 }] },
          },
        ],
      }),
      raw("16", "button", {
        parentId: "12",
        name: { value: "Pay" },
        named: "contents",
        description: { value: "4111111111111111" },
        properties: [
          {
            name: "describedby",
            value: { relatedNodes: [{ backendDOMNodeId: 13 }] },
          },
        ],
      }),
    ];
    const standIn = { host: 13, nodeIds: ["14"], masked: false };
    const out = withholdSensitiveFieldNames(nodes, [], [standIn]);
    expect(out[3].name?.value).toBe(REDACTED_VALUE);
    expect(out[4].description).toBeUndefined();
    expect(out[4].name?.value).toBe("Pay");
    // A stand-in the walk can't name a control for answers no reference.
    const unnamed = withholdSensitiveFieldNames(
      nodes,
      [],
      [{ ...standIn, host: undefined }],
      () => [],
    );
    expect(unnamed[3].name?.value).toBe("4111111111111111");
    // With no walk to say what labels the input, a reference to it fails
    // closed: it may lend a value through one.
    const unwalked = withholdSensitiveFieldNames(
      nodes,
      [],
      [{ ...standIn, host: undefined }],
    );
    expect(unwalked[3].name?.value).toBe(REDACTED_VALUE);
  });

  /** A `labelledby` or `describedby` property pointing at DOM ids. */
  const pointsAt = (name: string, ...ids: number[]) => ({
    name,
    value: {
      relatedNodes: ids.map((backendDOMNodeId) => ({ backendDOMNodeId })),
    },
  });
  /** A name as Chromium's trace reports it, from `aria-labelledby` or from
   *  a host-language source such as a `<label>` around the node. */
  const traced = (value: string, source: Record<string, string>) => ({
    value,
    sources: [{ type: "relatedElement", value: { value }, ...source }],
  });
  const byLabelledBy = { attribute: "aria-labelledby" };
  const typedText = { name: "editable", value: { value: "plaintext" } };

  it("withholds the name of a field in its own aria-labelledby", () => {
    // <span id="l">Card</span><input aria-labelledby="l c"
    // autocomplete="cc-number" value="4111…">: Chromium reads the field's
    // value into its own name, "Card 4111…".
    const nodes = [
      raw("1", "StaticText", { name: { value: "Card" } }),
      raw("2", "textbox", {
        name: traced("Card 4111111111111111", byLabelledBy),
        value: { value: "4111111111111111" },
        properties: [pointsAt("labelledby", 1, 2)],
      }),
    ];
    const out = withholdSensitiveFieldNames(nodes, ["2"]);
    expect(out[1].name?.value).toBe(REDACTED_VALUE);
  });

  it("withholds a name that points into the field", () => {
    // <div contenteditable role="textbox" aria-labelledby="s"><span
    // id="s">typed</span></div> in strict mode: the name IS what was typed.
    const nodes = [
      raw("1", "textbox", {
        name: traced("typed", byLabelledBy),
        value: { value: "typed" },
        properties: [pointsAt("labelledby", 2)],
        childIds: ["2"],
      }),
      raw("2", "StaticText", { parentId: "1", name: { value: "typed" } }),
    ];
    const out = withholdSensitiveFieldNames(nodes, ["1"]);
    expect(out[0].name?.value).toBe(REDACTED_VALUE);
  });

  it("drops a description that reaches the field's own value", () => {
    // <label id="w">Card <input aria-label="Card" aria-describedby="w"
    // autocomplete="cc-number" value="4111…"></label>, and the field in its
    // own aria-describedby: unlike a name, a description built around the
    // field reads its value.
    for (const ids of [[1], [2]]) {
      const nodes = [
        raw("1", "LabelText", { childIds: ["2"] }),
        raw("2", "textbox", {
          parentId: "1",
          name: { value: "Card" },
          named: "attribute",
          description: { value: "Card 4111111111111111" },
          value: { value: "4111111111111111" },
          properties: [pointsAt("describedby", ...ids)],
        }),
      ];
      const out = withholdSensitiveFieldNames(nodes, ["2"]);
      expect(out[1].description, `describedby ${ids[0]}`).toBeUndefined();
      expect(out[1].name?.value).toBe("Card");
    }
  });

  it("keeps a name from an aria-labelledby around a text field", () => {
    // <label id="w">Card <input aria-labelledby="w" autocomplete="cc-number"
    // value="4111…"></label>: Chromium skips the field's value, and the text
    // typed in it, when it meets the field inside its label.
    const nodes = [
      raw("1", "LabelText", { childIds: ["2"] }),
      raw("2", "textbox", {
        parentId: "1",
        name: traced("Card", byLabelledBy),
        value: { value: "4111111111111111" },
        properties: [typedText, pointsAt("labelledby", 1)],
        childIds: ["3"],
      }),
      raw("3", "generic", {
        parentId: "2",
        properties: [typedText],
        childIds: ["4"],
      }),
      raw("4", "StaticText", {
        parentId: "3",
        name: { value: "4111111111111111" },
        properties: [typedText],
      }),
    ];
    const out = withholdSensitiveFieldNames(nodes, ["2"]);
    expect(out[1].name?.value).toBe("Card");
  });

  it("withholds a name from an aria-labelledby around a date input, not from its <label>", () => {
    // <label id="w">Expiry <input type="month" aria-labelledby="w"
    // autocomplete="cc-exp" value="2030-04"></label>: through
    // aria-labelledby Chromium reads the input's parts, "Expiry April 2030";
    // through the <label> alone it skips the whole input.
    const month = (name: RawAXNameNode["name"]) => [
      raw("1", "LabelText", { childIds: ["2"] }),
      raw("2", "DateTime", {
        parentId: "1",
        name,
        value: { value: "2030-04" },
        properties: [pointsAt("labelledby", 1)],
        childIds: ["3"],
      }),
      raw("3", "none", { parentId: "2", ignored: true, childIds: ["4", "5"] }),
      raw("4", "spinbutton", { parentId: "3", value: { value: 4 } }),
      raw("5", "spinbutton", { parentId: "3", value: { value: 2030 } }),
    ];
    const explicit = withholdSensitiveFieldNames(
      month(traced("Expiry April 2030", byLabelledBy)),
      ["2"],
    );
    expect(explicit[1].name?.value).toBe(REDACTED_VALUE);
    const wrapped = withholdSensitiveFieldNames(
      month(traced("Expiry", { nativeSource: "labelwrapped" })),
      ["2"],
    );
    expect(wrapped[1].name?.value).toBe("Expiry");
    // An aria-label wins over the label, so nothing of the field is read.
    const authored = withholdSensitiveFieldNames(
      month(
        traced("Card expiry", { type: "attribute", attribute: "aria-label" }),
      ),
      ["2"],
    );
    expect(authored[1].name?.value).toBe("Card expiry");
    // With no trace, nothing says the parts were skipped.
    const untraced = withholdSensitiveFieldNames(month({ value: "Expiry" }), [
      "2",
    ]);
    expect(untraced[1].name?.value).toBe(REDACTED_VALUE);
  });

  it("leaves out what is typed in a field, inside the field, for a label around it", () => {
    // <label id="w">Count <input type="number" aria-labelledby="w"
    // value="7"></label> in strict mode: the field and the editable box
    // inside it are both roots, and Chromium reads neither into the name.
    // A part that isn't typed in (a date input's spinbutton) is read.
    const editable = { name: "editable", value: { value: "plaintext" } };
    const field = (inner: RawAXNameNode) => [
      raw("1", "LabelText", { childIds: ["2"] }),
      raw("2", "spinbutton", {
        parentId: "1",
        name: traced("Count", byLabelledBy),
        value: { value: 7 },
        properties: [pointsAt("labelledby", 1)],
        childIds: ["3"],
      }),
      raw("3", "none", { parentId: "2", ignored: true, childIds: ["4"] }),
      inner,
    ];
    const typed = field(
      raw("4", "generic", { parentId: "3", properties: [editable] }),
    );
    const typedOut = withholdRegionNames(
      typed,
      valueRegions(indexNativeAX(typed), new Set(["2", "4"])),
    );
    expect(typedOut[1].name?.value).toBe("Count");
    const part = field(
      raw("4", "spinbutton", { parentId: "3", value: { value: 7 } }),
    );
    const partOut = withholdRegionNames(
      part,
      valueRegions(indexNativeAX(part), new Set(["2", "4"])),
    );
    expect(partOut[1].name?.value).toBe(REDACTED_VALUE);
  });
});

describe("a control that lends a value through its labels", () => {
  /** A name trace step for a `<label>`, read or superseded. */
  const byLabel = (value: string, ...labels: number[]) => ({
    type: "relatedElement",
    nativeSource: "labelfor",
    value: { value },
    nativeSourceValue: {
      relatedNodes: labels.map((backendDOMNodeId) => ({ backendDOMNodeId })),
    },
  });
  const pointsAt = (name: string, ...ids: number[]) => ({
    name,
    value: {
      relatedNodes: ids.map((backendDOMNodeId) => ({ backendDOMNodeId })),
    },
  });
  const byReference = (value: string) => ({
    value,
    sources: [
      {
        type: "relatedElement",
        attribute: "aria-labelledby",
        value: { value },
      },
    ],
  });
  /**
   * Chromium 151 for `<label for="c">Code <input
   * autocomplete="one-time-code" value="482913"></label><input
   * type="checkbox" id="c"><button aria-labelledby="c">Toggle</button><button
   * aria-describedby="c">Go</button>`: both buttons read the checkbox's
   * label, and the code in it.
   */
  const page = (
    checkbox: Partial<RawAXNameNode> = {},
    field = "482913",
  ): RawAXNameNode[] => {
    const name = `Code ${field}`.trim();
    return [
      raw("1", "LabelText", { childIds: ["2", "3"] }),
      raw("2", "StaticText", { parentId: "1", name: { value: "Code" } }),
      raw("3", "textbox", {
        parentId: "1",
        ...(field ? { value: { value: field } } : {}),
      }),
      raw("4", "checkbox", {
        name: { value: name, sources: [byLabel(name, 1)] },
        properties: [pointsAt("labelledby", 1)],
        ...checkbox,
      }),
      raw("5", "button", {
        name: byReference(name),
        properties: [pointsAt("labelledby", 4)],
      }),
      raw("6", "button", {
        name: { value: "Go" },
        named: "contents",
        description: { value: name },
        properties: [pointsAt("describedby", 4)],
      }),
    ];
  };

  it("withholds a name and a description that read a control's label holding a field's value", () => {
    const out = withholdSensitiveFieldNames(page(), ["3"]);
    expect(out[3].name?.value).toBe(REDACTED_VALUE);
    expect(out[4].name?.value).toBe(REDACTED_VALUE);
    expect(out[5].description).toBeUndefined();
    expect(out[5].name?.value).toBe("Go");
  });

  it("keeps a name read from a label that holds no value", () => {
    // The field is empty, or not in the label: nothing reaches the label.
    const nodes = page({}, "");
    expect(withholdSensitiveFieldNames(nodes, ["3"])).toBe(nodes);
    const outside = page();
    outside[0] = raw("1", "LabelText", { childIds: ["2"] });
    outside[2] = raw("3", "textbox", { value: { value: "482913" } });
    for (const raw of outside.slice(3)) {
      if (raw.name?.value === "Code 482913") raw.name.value = "Code";
    }
    outside[3]!.name = { value: "Code", sources: [byLabel("Code", 1)] };
    outside[5]!.description = { value: "Code" };
    const out = withholdSensitiveFieldNames(outside, ["3"]);
    expect(out[3].name?.value).toBe("Code");
    expect(out[4].name?.value).toBe("Code");
    expect(out[5].description?.value).toBe("Code");
  });

  it("keeps the aria-label a control has, which Chromium reads before its label", () => {
    // <input type="checkbox" id="c" aria-label="Agree">: "Agree" for both.
    const nodes = page({
      name: {
        value: "Agree",
        sources: [
          {
            type: "attribute",
            attribute: "aria-label",
            value: { value: "Agree" },
          },
          { ...byLabel("Code 482913", 1), superseded: true },
        ],
      },
      properties: [],
    });
    nodes[4]!.name = byReference("Agree");
    const out = withholdSensitiveFieldNames(nodes, ["3"]);
    expect(out[3].name?.value).toBe("Agree");
    expect(out[4].name?.value).toBe("Agree");
  });

  it("follows the label a control's own aria-labelledby supersedes", () => {
    // <span id="o">Other</span> and aria-labelledby="o" on the checkbox:
    // its own name is "Other", but a reference to it skips its own
    // aria-labelledby and reads the label, "Code 482913".
    const nodes = [
      ...page({
        name: {
          value: "Other",
          sources: [
            {
              type: "relatedElement",
              attribute: "aria-labelledby",
              value: { value: "Other" },
            },
            { ...byLabel("Code 482913", 1), superseded: true },
          ],
        },
        properties: [pointsAt("labelledby", 7)],
      }),
      raw("7", "StaticText", { name: { value: "Other" } }),
    ];
    const out = withholdSensitiveFieldNames(nodes, ["3"]);
    expect(out[3].name?.value).toBe("Other");
    expect(out[4].name?.value).toBe(REDACTED_VALUE);
  });

  it("withholds a name from contents around a control that lends a value", () => {
    // <td>Row <input type="checkbox" id="c"></td> with the label elsewhere:
    // Chromium names the cell "Row Code 482913". One named by aria-label
    // keeps its name.
    for (const [named, kept] of [
      ["contents", false],
      ["attribute", true],
    ] as const) {
      const nodes = [
        ...page({ parentId: "9" }),
        raw("9", "cell", {
          name: { value: kept ? "Row" : "Row Code 482913" },
          named,
          childIds: ["4"],
        }),
      ];
      const out = withholdSensitiveFieldNames(nodes, ["3"]);
      expect(out[6].name?.value, named).toBe(kept ? "Row" : REDACTED_VALUE);
    }
  });

  it("follows a label through the labelled controls inside it", () => {
    // <label for="c">Opt in <input type="checkbox" id="e"></label> and the
    // code in e's own label: "Opt in Code 482913" for c, and so for b.
    const nodes = [
      ...page(),
      raw("10", "LabelText", { childIds: ["11", "12"] }),
      raw("11", "StaticText", { parentId: "10", name: { value: "Opt in" } }),
      raw("12", "checkbox", {
        parentId: "10",
        name: {
          value: "Code 482913",
          sources: [byLabel("Code 482913", 1)],
        },
        properties: [pointsAt("labelledby", 1)],
      }),
      raw("13", "checkbox", {
        name: {
          value: "Opt in Code 482913",
          sources: [byLabel("Opt in Code 482913", 10)],
        },
        properties: [pointsAt("labelledby", 10)],
      }),
      raw("14", "button", {
        name: byReference("Opt in Code 482913"),
        properties: [pointsAt("labelledby", 13)],
      }),
    ];
    const out = withholdSensitiveFieldNames(nodes, ["3"]);
    expect(out[8].name?.value).toBe(REDACTED_VALUE);
    expect(out[9].name?.value).toBe(REDACTED_VALUE);
    expect(out[10].name?.value).toBe(REDACTED_VALUE);
  });

  it("asks the walk for the labels of a control Chromium ignores", () => {
    // <input type="checkbox" id="c" hidden>: an ignored node with no trace,
    // yet both buttons still read its label.
    const nodes = page({ role: { value: "none" }, ignored: true });
    delete nodes[3]!.name;
    delete nodes[3]!.properties;
    const labelled = withholdSensitiveFieldNames(nodes, ["3"], [], (id) =>
      id === 4 ? [1] : [],
    );
    expect(labelled[4].name?.value).toBe(REDACTED_VALUE);
    expect(labelled[5].description).toBeUndefined();
    // The walk found no label for it: nothing to lend.
    const unlabelled = withholdSensitiveFieldNames(nodes, ["3"], [], () => []);
    expect(unlabelled[4].name?.value).toBe("Code 482913");
    // Nothing says: a reference to it fails closed, a walk that saw every
    // other element (the page added the checkbox since) included.
    for (const labelsOf of [
      undefined,
      () => undefined,
      (id: number) => (id === 4 ? undefined : []),
    ]) {
      const out = withholdSensitiveFieldNames(nodes, ["3"], [], labelsOf);
      expect(out[4].name?.value).toBe(REDACTED_VALUE);
      expect(out[5].description).toBeUndefined();
    }
  });

  it("keeps a name from contents around a hidden control: Chromium skips it", () => {
    // <td>Row <input type="checkbox" id="c" hidden></td>: the cell is "Row".
    const nodes = [
      ...page({ role: { value: "none" }, ignored: true, parentId: "9" }),
      raw("9", "cell", {
        name: { value: "Row" },
        named: "contents",
        childIds: ["4"],
      }),
    ];
    delete nodes[3]!.name;
    delete nodes[3]!.properties;
    const out = withholdSensitiveFieldNames(nodes, ["3"], [], (id) =>
      id === 4 ? [1] : [],
    );
    expect(out[6].name?.value).toBe("Row");
    // A reference to it still reads its label.
    expect(out[4].name?.value).toBe(REDACTED_VALUE);
  });

  it("withholds a reference to a hidden element around a hidden control", () => {
    // <span id="x" hidden>Pick <input type="checkbox" id="c"></span> and
    // aria-labelledby="x": Chromium reads the hidden span whole, the
    // checkbox in it by its label, "Pick Code 482913".
    const nodes = [
      ...page({ role: { value: "none" }, ignored: true, parentId: "9" }),
      raw("9", "none", { ignored: true, childIds: ["4"] }),
      raw("10", "button", {
        name: {
          value: "Pick Code 482913",
          sources: [
            {
              type: "relatedElement",
              attribute: "aria-labelledby",
              value: { value: "Pick Code 482913" },
            },
          ],
        },
        properties: [pointsAt("labelledby", 9)],
      }),
    ];
    delete nodes[3]!.name;
    delete nodes[3]!.properties;
    const out = withholdSensitiveFieldNames(nodes, ["3"], [], (id) =>
      id === 4 ? [1] : [],
    );
    expect(out[7].name?.value).toBe(REDACTED_VALUE);
  });

  it("never lends a field's own value through its own label", () => {
    // <label>Name <input value="typed"></label> in strict mode: the field's
    // own name leaves its value out, and a node around the label is no
    // lender's container.
    const nodes = [
      raw("1", "LabelText", { childIds: ["2", "3"], parentId: "9" }),
      raw("2", "StaticText", { parentId: "1", name: { value: "Name" } }),
      raw("3", "textbox", {
        parentId: "1",
        name: { value: "Name", sources: [byLabel("Name", 1)] },
        value: { value: "typed" },
        properties: [pointsAt("labelledby", 1)],
      }),
      raw("9", "generic", { childIds: ["1"] }),
    ];
    const regions = valueRegions(indexNativeAX(nodes), new Set(["3"]));
    expect(regions.lending.size).toBe(0);
    const out = withholdRegionNames(nodes, regions);
    expect(out[2].name?.value).toBe("Name");
  });
});

describe("withholdFieldInternalText", () => {
  // Chromium 141 for `<main><input disabled role="none" value="4111…">
  // <div>Loose block</div><button>Pay</button></main>`: the field's own node
  // is gone, and its inner text box (DOM 7, in the input's user-agent shadow
  // root) reads like the `<div>` beside it (DOM 8).
  const page = () => [
    raw("1", "main", { childIds: ["7", "8", "9"] }),
    raw("7", "generic", { parentId: "1", childIds: ["70"] }),
    raw("70", "StaticText", {
      parentId: "7",
      name: { value: "4111111111111111" },
    }),
    raw("8", "generic", { parentId: "1", childIds: ["80"] }),
    raw("80", "StaticText", {
      parentId: "8",
      name: { value: "Loose block" },
    }),
    raw("9", "button", { parentId: "1", name: { value: "Pay" } }),
  ];
  // DOM 7 and 70 are in the input's (DOM 3) internals, the rest the page's.
  const hostOf: FieldHostOf = (backendDOMNodeId) =>
    backendDOMNodeId === 7 || backendDOMNodeId === 70 ? 3 : null;

  it("keeps the text a field draws inside itself out of the tree", () => {
    const tree = serializeNativeAX(
      normalizeNativeAX(withholdFieldInternalText(page(), hostOf)),
    );
    expect(tree).toBe(
      ["main", '  generic "Loose block"', '  button "Pay"'].join("\n"),
    );
  });

  it("blanks a text run below a field's internals, whatever its own node", () => {
    // A text run with no DOM node of its own the transport knows.
    const nodes = page();
    nodes[2] = { ...nodes[2], backendDOMNodeId: undefined };
    const out = withholdFieldInternalText(nodes, (id) => (id === 7 ? 3 : null));
    expect(out[2].name?.value).toBe("");
    expect(out[4].name?.value).toBe("Loose block");
  });

  it("never names a list item after one", () => {
    // `<li><input disabled role="none" value="4111…"></li>`: as the item's
    // only content, promotion named it after the card number.
    const item = [
      raw("1", "listitem", { childIds: ["7"] }),
      raw("7", "generic", { parentId: "1", childIds: ["70"] }),
      raw("70", "StaticText", {
        parentId: "7",
        name: { value: "4111111111111111" },
      }),
    ];
    expect(serializeNativeAX(normalizeNativeAX(item))).toBe(
      'listitem "4111111111111111"',
    );
    expect(
      serializeNativeAX(
        normalizeNativeAX(withholdFieldInternalText(item, hostOf)),
      ),
    ).toBe("listitem");
  });

  it("blanks the text of a bare generic the walk never saw", () => {
    // The page put the field in after the walk read the document.
    const seenOnly: FieldHostOf = (backendDOMNodeId) =>
      backendDOMNodeId === 8 || backendDOMNodeId === 80 ? null : undefined;
    const out = withholdFieldInternalText(page(), seenOnly);
    expect(out[2].name?.value).toBe("");
    expect(out[4].name?.value).toBe("Loose block");
  });

  it("fails closed with no answer: no bare generic's text survives", () => {
    const nodes = [
      ...page(),
      raw("10", "paragraph", { childIds: ["100"] }),
      raw("100", "StaticText", {
        parentId: "10",
        name: { value: "Own text" },
      }),
      raw("11", "generic", { name: { value: "Player" }, childIds: ["110"] }),
      raw("110", "StaticText", { parentId: "11", name: { value: "Inside" } }),
    ];
    const out = withholdFieldInternalText(nodes, undefined);
    const names = (id: string) => out.find((n) => n.nodeId === id)?.name?.value;
    expect(names("70")).toBe("");
    expect(names("80")).toBe("");
    // Text that no bare generic holds is the page's, and is kept.
    expect(names("100")).toBe("Own text");
    expect(names("110")).toBe("Inside");
  });

  it("returns the nodes untouched with nothing inside a field", () => {
    const nodes = page();
    expect(withholdFieldInternalText(nodes, () => null)).toBe(nodes);
  });
});

describe("fieldStandIns", () => {
  const standIns = (nodes: RawAXNameNode[], hostOf: FieldHostOf | undefined) =>
    fieldStandIns(indexNativeAX(nodes), hostOf);
  /** DOM ids `ids` sit in the internals of control `host`, the rest outside. */
  const internals =
    (host: number, ...ids: number[]): FieldHostOf =>
    (backendDOMNodeId) =>
      ids.includes(backendDOMNodeId) ? host : null;

  // Chromium 141 for `<td><input disabled role="none" autocomplete="cc-number"
  // value="4111…"></td>`: no node for the input (DOM 2), its inner box in the
  // cell instead.
  const cell = () => [
    raw("27", "LayoutTableCell", {
      name: { value: "4111111111111111" },
      named: "contents",
      childIds: ["28"],
    }),
    raw("28", "generic", { parentId: "27", childIds: ["80"] }),
    raw("80", "StaticText", {
      parentId: "28",
      name: { value: "4111111111111111" },
    }),
  ];

  it("stands a field's inner box in for it when its node is gone", () => {
    expect(standIns(cell(), internals(2, 28, 80))).toEqual([
      { host: 2, nodeIds: ["28"], masked: false },
    ]);
  });

  it("says when a stand-in holds Chromium's password mask", () => {
    // `<td><input disabled role="none" style="-webkit-text-security: disc"
    // value="482913"></td>`: no password in the markup, but its bullets.
    const nodes = cell();
    nodes[2] = { ...nodes[2], name: { value: "••••••" } };
    expect(standIns(nodes, internals(2, 28, 80))).toEqual([
      { host: 2, nodeIds: ["28"], masked: true },
    ]);
    // `circle` and `square` draw the same count, as other shapes.
    for (const mask of ["◦◦◦◦◦◦", "■■■■■■"]) {
      nodes[2] = { ...nodes[2], name: { value: mask } };
      expect(standIns(nodes, internals(2, 28, 80))).toEqual([
        { host: 2, nodeIds: ["28"], masked: true },
      ]);
    }
  });

  it("leaves a field alone when any node of its own is exposed", () => {
    // An index keeps one node per backend id: an ignored one sharing the
    // field's must not hide the field's exposed node.
    const nodes = [
      raw("2", "textbox", { value: { value: "4111" }, childIds: ["28"] }),
      ...cell().slice(1),
      { ...raw("2", "none", { ignored: true }), nodeId: "2b" },
    ];
    nodes[1] = { ...nodes[1], parentId: "2" };
    expect(standIns(nodes, internals(2, 28, 80))).toEqual([]);
  });

  it("leaves a field its own node stands for alone", () => {
    const nodes = [
      raw("2", "textbox", {
        value: { value: "4111111111111111" },
        childIds: ["28"],
      }),
      ...cell().slice(1),
    ];
    nodes[1] = { ...nodes[1], parentId: "2" };
    expect(standIns(nodes, internals(2, 28, 80))).toEqual([]);
  });

  it("stands in for a field Chromium keeps an ignored node for", () => {
    // `<label><input type="checkbox"> Use <input disabled role="none"
    // value="…"></label>`: the input (DOM 8) is ignored, its box below it.
    const nodes = [
      raw("42", "LabelText", { childIds: ["7", "8"] }),
      raw("7", "checkbox", {
        parentId: "42",
        name: { value: " Use label-secret" },
      }),
      raw("8", "none", { parentId: "42", ignored: true, childIds: ["43"] }),
      raw("43", "generic", { parentId: "8", childIds: ["85"] }),
      raw("85", "StaticText", {
        parentId: "43",
        name: { value: "label-secret" },
      }),
    ];
    expect(standIns(nodes, internals(8, 43, 85))).toEqual([
      { host: 8, nodeIds: ["43"], masked: false },
    ]);
  });

  it("counts a part with a value: a month input's spinbuttons", () => {
    // `<p><input type="month" disabled role="none" autocomplete="cc-exp"
    // value="2030-04"></p>`: the parts hang below an ignored container.
    const nodes = [
      raw("46", "paragraph", { childIds: ["47"] }),
      raw("47", "none", { parentId: "46", ignored: true, childIds: ["48"] }),
      raw("48", "generic", { parentId: "47", childIds: ["50", "52"] }),
      raw("50", "spinbutton", { parentId: "48", value: { value: 4 } }),
      raw("52", "spinbutton", { parentId: "48", value: { value: 2030 } }),
    ];
    expect(standIns(nodes, internals(11, 47, 48, 50, 52))).toEqual([
      { host: 11, nodeIds: ["47"], masked: false },
    ]);
  });

  it("gives nothing away for an empty field, its placeholder shown", () => {
    // `<td><input disabled role="none" autocomplete="cc-number"
    // placeholder="Card number"></td>`: Chromium names the cell after the
    // placeholder, ignored beside the empty box. Nothing to withhold.
    const nodes = [
      raw("30", "LayoutTableCell", {
        name: { value: "Card number" },
        named: "contents",
        childIds: ["31", "32"],
      }),
      raw("31", "none", { parentId: "30", ignored: true }),
      raw("32", "generic", { parentId: "30" }),
    ];
    expect(standIns(nodes, internals(3, 31, 32))).toEqual([]);
  });

  it("stands nothing in for a field whose internals are all ignored", () => {
    // Chromium 141 keeps an ignored node for an `aria-hidden` field, which is
    // classified as any field; and a media player's fullscreen button, ignored
    // with its hover background, holds no value to give away.
    const nodes = [
      raw("6", "none", { ignored: true, childIds: ["66"] }),
      raw("66", "none", { parentId: "6", ignored: true, childIds: ["76"] }),
      raw("76", "none", { parentId: "66", ignored: true }),
    ];
    expect(standIns(nodes, internals(6, 66, 76))).toEqual([]);
  });

  it("gives nothing away for a select listing its options", () => {
    // `<td><select disabled role="none">…</select></td>`: the cell lists
    // every option, and none says which is chosen.
    const nodes = [
      raw("21", "LayoutTableCell", {
        name: { value: "04 05" },
        named: "contents",
        childIds: ["24"],
      }),
      raw("24", "none", {
        parentId: "21",
        ignored: true,
        childIds: ["28", "31"],
      }),
      raw("28", "option", { parentId: "24", name: { value: "04" } }),
      raw("31", "option", { parentId: "24", name: { value: "05" } }),
    ];
    expect(standIns(nodes, internals(2, 24))).toEqual([]);
  });

  it("stands a box the walk never saw in for a control it can't name", () => {
    const nodes = [
      raw("1", "main", { childIds: ["7", "8"] }),
      raw("7", "generic", { parentId: "1", childIds: ["70"] }),
      raw("70", "StaticText", { parentId: "7", name: { value: "4111" } }),
      raw("8", "generic", { parentId: "1", childIds: ["80"] }),
      raw("80", "StaticText", { parentId: "8", name: { value: "Seen" } }),
    ];
    const seenOnly: FieldHostOf = (id) =>
      id === 1 || id >= 8 ? null : undefined;
    expect(standIns(nodes, seenOnly)).toEqual([
      { host: undefined, nodeIds: ["7"], masked: false },
    ]);
  });

  it("leaves a box the walk never saw to the field around it", () => {
    // A `<textarea>`'s own node carries its value, and a recording with no
    // walk of its internals stands in nothing for it.
    const nodes = [
      raw("5", "textbox", {
        value: { value: "notes" },
        properties: [{ name: "editable", value: { value: "plaintext" } }],
        childIds: ["7"],
      }),
      raw("7", "generic", { parentId: "5", childIds: ["70"] }),
      raw("70", "StaticText", { parentId: "7", name: { value: "notes" } }),
    ];
    expect(standIns(nodes, undefined)).toEqual([]);
    nodes[0] = { ...nodes[0], value: undefined };
    expect(standIns(nodes, undefined)).toEqual([]);
  });

  it("stands every box of text in for one with no walk at all", () => {
    const nodes = [
      raw("1", "main", { childIds: ["7", "8", "9"] }),
      raw("7", "generic", { parentId: "1", childIds: ["70"] }),
      raw("70", "StaticText", { parentId: "7", name: { value: "4111" } }),
      // Named, or holding no text: no box of text.
      raw("8", "generic", { parentId: "1", name: { value: "Player" } }),
      raw("9", "generic", { parentId: "1" }),
    ];
    expect(standIns(nodes, undefined)).toEqual([
      { host: undefined, nodeIds: ["7"], masked: false },
    ]);
  });
});

describe("ignoreFieldInternalImages", () => {
  // Chromium for `<main><input type="image" alt="Go" src="data:,">
  // <button><img src="a.png"></button></main>`: the input (DOM 3) is a
  // `button` holding its UA image (DOM 30) and the text of its name; the
  // authored `<img>` (DOM 50) sits in a button of the page's.
  const page = () => [
    raw("1", "main", { childIds: ["3", "5"] }),
    raw("3", "button", {
      parentId: "1",
      childIds: ["30", "31"],
      name: { value: "Go" },
    }),
    raw("30", "image", { parentId: "3" }),
    raw("31", "StaticText", { parentId: "3", name: { value: "Go" } }),
    raw("5", "button", {
      parentId: "1",
      childIds: ["50"],
      name: { value: "Logo" },
    }),
    raw("50", "image", { parentId: "5" }),
  ];
  const hostOf: FieldHostOf = (id) => (id === 30 ? 3 : null);

  it("keeps the image an input draws inside itself out of the tree", () => {
    const tree = serializeNativeAX(
      normalizeNativeAX(ignoreFieldInternalImages(page(), hostOf)),
    );
    // The page's own image stays, even inside a button.
    expect(tree).toBe(
      ["main", '  button "Go"', '  button "Logo"', "    img"].join("\n"),
    );
  });

  it("is the walk, not the tree, that decides: no walk ignores nothing", () => {
    const nodes = page();
    expect(ignoreFieldInternalImages(nodes, undefined)).toBe(nodes);
  });

  it("leaves a node the walk never saw, and returns the input when nothing changed", () => {
    const nodes = page();
    expect(ignoreFieldInternalImages(nodes, () => undefined)).toBe(nodes);
    expect(ignoreFieldInternalImages(nodes, () => null)).toBe(nodes);
  });

  it("copies rather than mutates", () => {
    const nodes = page();
    const out = ignoreFieldInternalImages(nodes, hostOf);
    expect(out[2].ignored).toBe(true);
    expect(nodes[2].ignored).toBeUndefined();
  });

  it("is what a transport calls: text withheld and the image ignored together", () => {
    const nodes = [
      ...page(),
      raw("7", "generic", { parentId: "1", childIds: ["70"] }),
      raw("70", "StaticText", { parentId: "7", name: { value: "4111" } }),
    ];
    const both: FieldHostOf = (id) =>
      id === 30 || id === 7 || id === 70 ? 3 : null;
    const out = withholdFieldInternals(nodes, both);
    expect(out.find((n) => n.nodeId === "30")?.ignored).toBe(true);
    expect(out.find((n) => n.nodeId === "70")?.name?.value).toBe("");
    expect(out.find((n) => n.nodeId === "50")?.ignored).toBeUndefined();
  });
});
