import { describe, expect, it } from "vitest";

import { REDACTED_VALUE } from "../extraction/dom-extractor.js";

import { normalizeNativeAX, serializeNativeAX } from "./ax-normalize.js";
import {
  withholdFieldInternalText,
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
  const internal = (backendDOMNodeId: number) =>
    backendDOMNodeId === 7 || backendDOMNodeId === 70;

  it("keeps the text a field draws inside itself out of the tree", () => {
    const tree = serializeNativeAX(
      normalizeNativeAX(withholdFieldInternalText(page(), internal)),
    );
    expect(tree).toBe(
      ["main", '  generic "Loose block"', '  button "Pay"'].join("\n"),
    );
  });

  it("blanks a text run below a field's internals, whatever its own node", () => {
    // A text run with no DOM node of its own the transport knows.
    const nodes = page();
    nodes[2] = { ...nodes[2], backendDOMNodeId: undefined };
    const out = withholdFieldInternalText(nodes, (id) => id === 7);
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
        normalizeNativeAX(withholdFieldInternalText(item, internal)),
      ),
    ).toBe("listitem");
  });

  it("blanks the text of a bare generic the walk never saw", () => {
    // The page put the field in after the walk read the document.
    const seenOnly = (backendDOMNodeId: number) =>
      backendDOMNodeId === 8 || backendDOMNodeId === 80 ? false : undefined;
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
    expect(withholdFieldInternalText(nodes, () => false)).toBe(nodes);
  });
});
