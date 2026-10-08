import { describe, expect, it } from "vitest";

import { REDACTED_VALUE } from "../extraction/dom-extractor.js";

import {
  withholdSensitiveFieldNames,
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
});
