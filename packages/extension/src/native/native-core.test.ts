import {
  SENSITIVE_AUTOCOMPLETE_TOKENS,
  type RawNativeAXNode,
} from "@real-a11y-dev/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  backendNodeIdFrom,
  capText,
  dispatchNative,
  fieldFacets,
  findNative,
  IN_PAGE_ACTION_SOURCE,
  IN_PAGE_READ_VALUE_SOURCE,
  nativeControls,
  pageClick,
  pageFocus,
  pageReadValue,
  pageReveal,
  pageSelectOption,
  pageStep,
  pageType,
  readNativeTree,
  fieldValueWithheld,
  rootIdOf,
  SYNTHETIC_ROOT_ID,
  withholdInsideSensitive,
  controlledRegion,
  type CdpTransport,
  type EnrichedNativeNode,
} from "./native-core.js";

// A scripted fake CDP transport — records every call, returns programmed
// responses. The same shape the chrome.debugger and Playwright transports have.
type Handler = (method: string, params?: object) => unknown;
class FakeTransport implements CdpTransport {
  calls: { method: string; params?: object }[] = [];
  constructor(private handler: Handler) {}
  async send<T>(method: string, params?: object) {
    this.calls.push({ method, params });
    return this.handler(method, params) as T;
  }
}

/** Resolve any backend node to `objectId`, run `fnResult` from callFunctionOn. */
function resolving(objectId: string | null, fnResult: unknown): Handler {
  return (method) => {
    if (method === "DOM.resolveNode")
      return objectId ? { object: { objectId } } : {};
    if (method === "Runtime.callFunctionOn")
      return { result: { value: fnResult } };
    return {};
  };
}

describe("backendNodeIdFrom", () => {
  it("parses author-DOM ids and rejects unbacked ones", () => {
    expect(backendNodeIdFrom("ax-dom-42")).toBe(42);
    expect(backendNodeIdFrom("ax-7")).toBeNull();
    expect(backendNodeIdFrom("garbage")).toBeNull();
  });
});

describe("readNativeTree", () => {
  it("reads getFullAXTree and normalizes via the shared core vocabulary", async () => {
    const raw: RawNativeAXNode[] = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "RootWebArea" },
        childIds: ["2", "3"],
      },
      {
        nodeId: "2",
        backendDOMNodeId: 20,
        role: { value: "heading" },
        name: { value: "Hi" },
      },
      {
        nodeId: "3",
        backendDOMNodeId: 30,
        role: { value: "button" },
        name: { value: "Save" },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    expect(t.calls[0].method).toBe("Accessibility.enable");
    expect(res.rawCount).toBe(3);
    expect(res.serialized).toContain('button "Save"');
    expect(findNative(res.nodes, "button", "Save")?.id).toBe("ax-dom-30");
  });

  it("names the document as it was before the tree, when a navigation commits mid-read", async () => {
    const raw: RawNativeAXNode[] = [
      { nodeId: "1", backendDOMNodeId: 10, role: { value: "RootWebArea" } },
    ];
    // The next document commits as soon as the old one's tree is read.
    let committed = false;
    const t = new FakeTransport((method) => {
      if (method === "Accessibility.getFullAXTree") {
        committed = true;
        return { nodes: raw };
      }
      if (method === "Page.getFrameTree") {
        return {
          frameTree: { frame: { loaderId: committed ? "NEW" : "OLD" } },
        };
      }
      return {};
    });
    const res = await readNativeTree(t);
    // The old page's nodes must not carry the new page's id: the panel would
    // take them as the new page's read.
    expect(res.documentId).toBe("OLD");
  });

  it("attaches the rows a node controls, and nothing when it controls none", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "RootWebArea" },
        childIds: ["2", "3"],
      },
      {
        nodeId: "2",
        backendDOMNodeId: 20,
        role: { value: "button" },
        name: { value: "Billing Address" },
        properties: [
          {
            name: "controls",
            value: {
              type: "idrefList",
              relatedNodes: [
                { backendDOMNodeId: 30 },
                { backendDOMNodeId: 99 },
              ],
            },
          },
        ],
      },
      {
        nodeId: "3",
        backendDOMNodeId: 30,
        role: { value: "region" },
        name: { value: "Billing" },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    expect(
      findNative(res.nodes, "button", "Billing Address")?.controls,
    ).toEqual(["ax-dom-30"]);
    expect(findNative(res.nodes, "region", "Billing")).not.toHaveProperty(
      "controls",
    );
  });

  it("attaches states/properties — the enrichment normalizeNativeAX doesn't do", async () => {
    // core's normalizeNativeAX only reads role/name/tree-shape, so a bare
    // property list would never surface `expanded`, `level`, etc. at all —
    // this is the enrichment layered on top, mirroring browser's axFacets.
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "RootWebArea" },
        childIds: ["2", "3"],
      },
      {
        nodeId: "2",
        backendDOMNodeId: 20,
        role: { value: "button" },
        name: { value: "Billing Address" },
        properties: [
          { name: "expanded", value: { value: true } },
          { name: "hasPopup", value: { value: "listbox" } },
        ],
      },
      {
        nodeId: "3",
        backendDOMNodeId: 30,
        role: { value: "heading" },
        name: { value: "Personal Information" },
        properties: [{ name: "level", value: { value: 2 } }],
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);

    const button = findNative(res.nodes, "button", "Billing Address");
    expect(button?.states).toEqual({ expanded: true });
    expect(button?.properties).toEqual({ hasPopup: "listbox" });

    const heading = findNative(res.nodes, "heading", "Personal Information");
    expect(heading?.states).toEqual({});
    expect(heading?.properties).toEqual({ level: "2" });
  });

  it("reads busy as true — Chromium sends it as the number 1", async () => {
    // Verbatim from Chromium 151's getFullAXTree on
    // `<div role="group" aria-label="g" aria-busy="true">`. Read raw, it was
    // `busy: "1"`, and the side panel's `states.busy === true` badge never lit.
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "RootWebArea" },
        childIds: ["2"],
      },
      {
        nodeId: "2",
        backendDOMNodeId: 20,
        role: { value: "group" },
        name: { value: "g" },
        properties: [{ name: "busy", value: { type: "boolean", value: 1 } }],
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);

    expect(findNative(res.nodes, "group", "g")?.states).toEqual({ busy: true });
  });

  /**
   * Live dogfood finding: "error messages not visible on native tree" — an
   * invalid form field's `aria-describedby`-linked error text ("Ingresa tu
   * e-mail.") showed up in the DOM/A11Y tree view but was entirely absent
   * from the native tree, because `EnrichedNativeNode` never carried a
   * `description` field at all. Unlike `states`/`properties`, this is a
   * top-level AX `description` field, not one of the `properties` array —
   * `browser`'s own native producer (`native-tree.ts`) already reads it
   * from exactly this shape, with no redaction gate: it's page-authored
   * help/error text, not user input (R1 only concerns typed field values).
   */
  it("attaches the accessible description from the raw AX node's top-level description field", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "combobox" },
        name: { value: "E-mail" },
        description: { value: "  Ingresa tu e-mail.  " },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    const field = findNative(res.nodes, "combobox", "E-mail");
    // Cleaned the same way browser's own cleanText does — collapsed
    // whitespace, trimmed.
    expect(field?.description).toBe("Ingresa tu e-mail.");
  });

  it("gives an empty description, not undefined, when the raw node has none", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "button" },
        name: { value: "Save" },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "button", "Save")?.description).toBe("");
  });

  it("never surfaces valuenow/valuetext — R1", async () => {
    // These two AX properties ARE the user's current input for a value-bearing
    // control (spinbutton, slider). Letting them through the enrichment would
    // carry a field value into the panel around `pageReadValue`'s in-page
    // classification — a value reaches a node only as `value`, through it.
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "slider" },
        name: { value: "Volume" },
        properties: [
          { name: "valuenow", value: { value: 42 } },
          { name: "valuetext", value: { value: "42%" } },
          { name: "valuemin", value: { value: 0 } },
        ],
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    const slider = findNative(res.nodes, "slider", "Volume");
    expect(slider?.properties).toEqual({ valuemin: "0" });
    expect(slider?.properties).not.toHaveProperty("valuenow");
    expect(slider?.properties).not.toHaveProperty("valuetext");
  });

  it("never names an editor from what was typed into it — R1", async () => {
    // Chromium 151's shape for `<div role="application" contenteditable>` and
    // `<div role="document" contenteditable>` after typing into them: the text
    // is the node's AX value AND its StaticText child. This path read
    // `application "typed-SECRET-app"` until core stopped promoting a value
    // into a name — the same rule `@real-a11y-dev/browser` relies on.
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 1,
        role: { value: "RootWebArea" },
        childIds: ["2", "4", "6"],
      },
      {
        nodeId: "2",
        parentId: "1",
        backendDOMNodeId: 20,
        role: { value: "application" },
        value: { type: "string", value: "typed-SECRET-app" },
        childIds: ["3"],
      },
      {
        nodeId: "3",
        parentId: "2",
        role: { value: "StaticText" },
        name: { value: "typed-SECRET-app" },
      },
      {
        nodeId: "4",
        parentId: "1",
        backendDOMNodeId: 40,
        role: { value: "document" },
        value: { type: "string", value: "typed-SECRET-doc" },
        childIds: ["5"],
      },
      {
        nodeId: "5",
        parentId: "4",
        role: { value: "StaticText" },
        name: { value: "typed-SECRET-doc" },
      },
      // Labelled by its author: Chromium's own name, kept.
      {
        nodeId: "6",
        parentId: "1",
        backendDOMNodeId: 60,
        role: { value: "application" },
        name: { value: "Editor" },
        value: { type: "string", value: "typed-SECRET-labelled" },
        childIds: ["7"],
      },
      {
        nodeId: "7",
        parentId: "6",
        role: { value: "StaticText" },
        name: { value: "typed-SECRET-labelled" },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);

    expect(res.serialized).toBe('application\ndocument\napplication "Editor"');
    for (const node of res.nodes) expect(node.name).not.toContain("SECRET");
    // Nothing classified these editors (this transport answers no in-page
    // call), so no value either. Once one is classified its text IS its
    // value — ADR-0001, pinned by "shows an editor's content as its value".
    expect(JSON.stringify(res.nodes)).not.toContain("SECRET");
  });

  /** A one-node tree whose in-page classification answers `read`. */
  function oneField(
    node: Record<string, unknown>,
    read: unknown,
  ): FakeTransport {
    const raw = [{ nodeId: "1", backendDOMNodeId: 10, ...node }];
    return new FakeTransport((method) => {
      if (method === "Accessibility.getFullAXTree") return { nodes: raw };
      if (method === "DOM.resolveNode") return { object: { objectId: "obj" } };
      if (method === "Runtime.callFunctionOn")
        return { result: { value: read } };
      return {};
    });
  }

  it("shows a text field's AX value once the page classifies it", async () => {
    const t = oneField(
      {
        role: { value: "textbox" },
        name: { value: "Name:" },
        value: { type: "string", value: "456465" },
      },
      { classified: true, value: "456465" },
    );
    const res = await readNativeTree(t);
    const field = findNative(res.nodes, "textbox", "Name:");
    expect(field?.value).toBe("456465");
    expect(field?.rawValue).toBe("456465");
  });

  it("shows a select's announced option LABEL, keeping its raw value apart (ADR-0001)", async () => {
    // Chromium 151's AX value for `<select>` with `<option value="es"
    // selected>Spain</option>` is the label. The in-page read has only the
    // raw `.value` — the retype prefill, never what the tree shows.
    const t = oneField(
      {
        role: { value: "combobox" },
        name: { value: "Country" },
        value: { type: "string", value: "Spain" },
      },
      { classified: true, value: "es" },
    );
    const res = await readNativeTree(t);
    const select = findNative(res.nodes, "combobox", "Country");
    expect(select?.value).toBe("Spain");
    expect(select?.rawValue).toBe("es");
  });

  it("reads a filled password as [redacted] — never Chromium's bullets, which are its length", async () => {
    const t = oneField(
      {
        role: { value: "textbox" },
        name: { value: "Password" },
        value: { type: "string", value: "•••••••" },
      },
      { classified: true, sensitive: true, redacted: true },
    );
    const res = await readNativeTree(t);
    const field = findNative(res.nodes, "textbox", "Password");
    expect(field?.value).toBe("[redacted]");
    expect(field?.redacted).toBe(true);
    expect(field?.rawValue).toBeUndefined();
    expect(JSON.stringify(res.nodes)).not.toContain("•");
  });

  it("reads a range widget's aria-valuetext even when Chromium reports no number", async () => {
    // `<div role="progressbar" aria-valuetext="Step 2 of 5">`, no valuenow.
    const t = oneField(
      { role: { value: "progressbar" }, name: { value: "Setup" } },
      { classified: true, valuetext: "Step 2 of 5" },
    );
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "progressbar", "Setup")?.value).toBe(
      "Step 2 of 5",
    );
  });

  it("shows no value for a part of a sensitive field, whatever its own verdict", async () => {
    // Chromium 151's `<input type="month" autocomplete="cc-exp">`: a
    // `DateTime` whose Month/Year spinbuttons report the expiry. Here the
    // parts' own reads come back not sensitive, as a page-side walk that
    // missed them would — the tree's shape still withholds them.
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "DateTime" },
        name: { value: "Card expiry" },
        value: { type: "string", value: "2031-11" },
        childIds: ["2", "3"],
      },
      {
        nodeId: "2",
        parentId: "1",
        backendDOMNodeId: 20,
        role: { value: "spinbutton" },
        name: { value: "Month" },
        value: { type: "number", value: 11 },
      },
      {
        nodeId: "3",
        parentId: "1",
        backendDOMNodeId: 30,
        role: { value: "spinbutton" },
        name: { value: "Year" },
        value: { type: "number", value: 2031 },
      },
    ];
    const t = new FakeTransport((method, params) => {
      if (method === "Accessibility.getFullAXTree") return { nodes: raw };
      if (method === "DOM.resolveNode") {
        const id = (params as { backendNodeId: number }).backendNodeId;
        return { object: { objectId: `obj-${id}` } };
      }
      if (method === "Runtime.callFunctionOn") {
        const { objectId } = params as { objectId: string };
        return {
          result: {
            value:
              objectId === "obj-10"
                ? { classified: true, sensitive: true, redacted: true }
                : { classified: true, valuetext: "November" },
          },
        };
      }
      return {};
    });
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "DateTime")?.value).toBe("[redacted]");
    expect(findNative(res.nodes, "spinbutton", "Month")?.value).toBeUndefined();
    expect(findNative(res.nodes, "spinbutton", "Year")?.value).toBeUndefined();
    const wire = JSON.stringify(res);
    expect(wire).not.toContain("2031");
    expect(wire).not.toContain("November");
  });

  it("keeps a sensitive field's value out of the name of the cell around it", async () => {
    // <td><input autocomplete="cc-number" value="4111…"></td>: Chromium
    // names the cell from its contents, the field's value among them.
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "cell" },
        name: {
          value: "4111111111111111",
          sources: [{ type: "contents", value: { value: "4111111111111111" } }],
        },
        childIds: ["2"],
      },
      {
        nodeId: "2",
        parentId: "1",
        backendDOMNodeId: 20,
        role: { value: "textbox" },
        name: { value: "Card number" },
        value: { type: "string", value: "4111111111111111" },
      },
    ];
    const t = new FakeTransport((method, params) => {
      if (method === "Accessibility.getFullAXTree") return { nodes: raw };
      if (method === "DOM.resolveNode") {
        const id = (params as { backendNodeId: number }).backendNodeId;
        return { object: { objectId: `obj-${id}` } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: { classified: true, sensitive: true, redacted: true },
          },
        };
      }
      return {};
    });
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "cell")?.name).toBe("[redacted]");
    expect(findNative(res.nodes, "textbox")?.name).toBe("Card number");
    expect(JSON.stringify(res)).not.toContain("4111");
  });

  it("withholds a name taken from a hidden field it reads only for that", async () => {
    // <input aria-hidden="true" autocomplete="cc-number" value="3782…">
    // labelling a region: the tree drops the input and Chromium sends no
    // value for it, so it is read in the page because the region points at it.
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 1,
        role: { value: "RootWebArea" },
        name: { value: "Page" },
        childIds: ["7", "9"],
      },
      {
        nodeId: "7",
        parentId: "1",
        backendDOMNodeId: 7,
        ignored: true,
        role: { value: "none" },
      },
      {
        nodeId: "9",
        parentId: "1",
        backendDOMNodeId: 9,
        role: { value: "region" },
        name: {
          value: "378282246310005",
          sources: [
            { type: "relatedElement", value: { value: "378282246310005" } },
          ],
        },
        properties: [
          {
            name: "labelledby",
            value: { relatedNodes: [{ backendDOMNodeId: 7 }] },
          },
        ],
      },
    ];
    const t = new FakeTransport((method, params) => {
      if (method === "Accessibility.getFullAXTree") return { nodes: raw };
      if (method === "DOM.describeNode") {
        return { node: { backendNodeId: 7, localName: "input" } };
      }
      if (method === "DOM.resolveNode") {
        const id = (params as { backendNodeId: number }).backendNodeId;
        return { object: { objectId: `obj-${id}` } };
      }
      if (method === "Runtime.callFunctionOn") {
        const { objectId } = params as { objectId: string };
        return {
          result: {
            value:
              objectId === "obj-7"
                ? { classified: true, sensitive: true, redacted: true }
                : { classified: true },
          },
        };
      }
      return {};
    });
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "region")?.name).toBe("[redacted]");
    expect(JSON.stringify(res)).not.toContain("3782");
  });

  describe("a field's own label, and the targets around it", () => {
    // <label>Password <input type="password" value="hunter2"></label>, as
    // Chromium 151 sends it: the label is a `LabelText` the tree drops, and
    // the field is `labelledby` it.
    const labelled = (labelChildren: string[] = ["15", "7"]) => [
      {
        nodeId: "1",
        backendDOMNodeId: 1,
        role: { value: "RootWebArea" },
        name: { value: "Page" },
        childIds: ["6"],
      },
      {
        nodeId: "6",
        parentId: "1",
        backendDOMNodeId: 6,
        role: { value: "LabelText" },
        name: { value: "" },
        childIds: labelChildren,
      },
      {
        nodeId: "15",
        parentId: "6",
        backendDOMNodeId: 15,
        role: { value: "StaticText" },
        name: { value: "Password " },
      },
      {
        nodeId: "7",
        parentId: "6",
        backendDOMNodeId: 7,
        role: { value: "textbox" },
        name: {
          value: "Password ",
          sources: [{ type: "relatedElement", value: { value: "Password " } }],
        },
        value: { type: "string", value: "•••••••" },
        properties: [
          {
            name: "labelledby",
            value: { relatedNodes: [{ backendDOMNodeId: 6 }] },
          },
        ],
      },
    ];
    const sensitivePassword = (
      describe?: (backendNodeId: number) => unknown,
    ): Handler => {
      return (method, params) => {
        if (method === "DOM.describeNode") {
          const { backendNodeId } = params as { backendNodeId: number };
          if (!describe) throw new Error("no describe expected");
          return describe(backendNodeId);
        }
        if (method === "DOM.resolveNode") {
          const id = (params as { backendNodeId: number }).backendNodeId;
          return { object: { objectId: `obj-${id}` } };
        }
        if (method === "Runtime.callFunctionOn") {
          const { objectId } = params as { objectId: string };
          return {
            result: {
              value:
                objectId === "obj-7"
                  ? { classified: true, sensitive: true, redacted: true }
                  : { classified: true },
            },
          };
        }
        return {};
      };
    };

    it("keeps a filled password's own name, and reads nothing more for it", async () => {
      const raw = labelled();
      const handler = sensitivePassword();
      const t = new FakeTransport((method, params) =>
        method === "Accessibility.getFullAXTree"
          ? { nodes: raw }
          : handler(method, params),
      );
      const res = await readNativeTree(t);
      expect(findNative(res.nodes, "textbox")).toMatchObject({
        name: "Password",
        value: "[redacted]",
      });
      // The label holds nothing Chromium hides, so it costs no extra call.
      expect(t.calls.some((c) => c.method === "DOM.describeNode")).toBe(false);
      expect(
        t.calls.filter((c) => c.method === "Runtime.callFunctionOn"),
      ).toHaveLength(1);
    });

    it("keeps it with an aria-hidden node in the label, which is looked into", async () => {
      // <label>Password <span aria-hidden="true">*</span> <input …></label>
      const raw = [
        ...labelled(["15", "12", "7"]),
        {
          nodeId: "12",
          parentId: "6",
          backendDOMNodeId: 12,
          ignored: true,
          role: { value: "none" },
        },
      ];
      const handler = sensitivePassword(() => ({
        node: {
          backendNodeId: 6,
          localName: "label",
          children: [
            { backendNodeId: 12, localName: "span" },
            { backendNodeId: 7, localName: "input" },
          ],
        },
      }));
      const t = new FakeTransport((method, params) =>
        method === "Accessibility.getFullAXTree"
          ? { nodes: raw }
          : handler(method, params),
      );
      const res = await readNativeTree(t);
      expect(findNative(res.nodes, "textbox")?.name).toBe("Password");
      // The password was read once, by the tree's own pass.
      expect(
        t.calls.filter((c) => c.method === "Runtime.callFunctionOn"),
      ).toHaveLength(1);
    });

    // <div id="hint" aria-hidden="true">Card <input autocomplete="cc-number"
    // value="4111…"></div> labelling a region.
    const hiddenCard = [
      {
        nodeId: "1",
        backendDOMNodeId: 1,
        role: { value: "RootWebArea" },
        name: { value: "Page" },
        childIds: ["9", "11"],
      },
      {
        nodeId: "9",
        parentId: "1",
        backendDOMNodeId: 9,
        ignored: true,
        role: { value: "none" },
        childIds: ["10"],
      },
      {
        nodeId: "10",
        parentId: "9",
        backendDOMNodeId: 10,
        ignored: true,
        role: { value: "none" },
      },
      {
        nodeId: "11",
        parentId: "1",
        backendDOMNodeId: 11,
        role: { value: "region" },
        name: {
          value: "Card 4111111111111111",
          sources: [
            {
              type: "relatedElement",
              value: { value: "Card 4111111111111111" },
            },
          ],
        },
        properties: [
          {
            name: "labelledby",
            value: { relatedNodes: [{ backendDOMNodeId: 9 }] },
          },
        ],
      },
    ];
    const hiddenCardTransport = (
      verdict: unknown,
      describe: () => unknown = () => ({
        node: {
          backendNodeId: 9,
          localName: "div",
          children: [{ backendNodeId: 10, localName: "input" }],
        },
      }),
    ) =>
      new FakeTransport((method, params) => {
        if (method === "Accessibility.getFullAXTree")
          return { nodes: hiddenCard };
        if (method === "DOM.describeNode") return describe();
        if (method === "DOM.resolveNode") {
          const id = (params as { backendNodeId: number }).backendNodeId;
          return { object: { objectId: `obj-${id}` } };
        }
        if (method === "Runtime.callFunctionOn") {
          const { objectId } = params as { objectId: string };
          return {
            result: { value: objectId === "obj-10" ? verdict : {} },
          };
        }
        return {};
      });

    it("withholds a name taken from a filled card field inside a hidden label", async () => {
      const t = hiddenCardTransport({
        classified: true,
        sensitive: true,
        redacted: true,
      });
      const res = await readNativeTree(t);
      expect(findNative(res.nodes, "region")?.name).toBe("[redacted]");
      expect(JSON.stringify(res)).not.toContain("4111");
      // The field was asked about, not the label around it.
      const asked = t.calls
        .filter((c) => c.method === "DOM.resolveNode")
        .map((c) => (c.params as { backendNodeId: number }).backendNodeId);
      expect(asked).toEqual([10]);
    });

    it("withholds the name around a hidden card field emptied after the snapshot", async () => {
      // The snapshot named the region after the card; the page cleared the
      // field before the in-page read, which finds it empty. The name still
      // holds the number, so emptiness at read time can't release it.
      const res = await readNativeTree(
        hiddenCardTransport({ classified: true, sensitive: true }),
      );
      expect(findNative(res.nodes, "region")?.name).toBe("[redacted]");
      expect(JSON.stringify(res)).not.toContain("4111");
    });

    it("keeps the name around a hidden field that isn't sensitive", async () => {
      // Read as no card field, its text is the page's to name the region by.
      const res = await readNativeTree(
        hiddenCardTransport({ classified: true, value: "4111111111111111" }),
      );
      expect(findNative(res.nodes, "region")?.name).toBe(
        "Card 4111111111111111",
      );
    });

    it("withholds it when the hidden field's read fails", async () => {
      const res = await readNativeTree(hiddenCardTransport({}));
      expect(findNative(res.nodes, "region")?.name).toBe("[redacted]");
    });

    it("looks into a target's author shadow roots, never a field's own internals", async () => {
      // The hidden label is a custom element: its card field sits in its
      // open shadow root (backend id 10). A user-agent root, a field's own
      // internals (backend id 12), holds nothing to read.
      const t = hiddenCardTransport(
        { classified: true, sensitive: true, redacted: true },
        () => ({
          node: {
            backendNodeId: 9,
            localName: "card-label",
            shadowRoots: [
              {
                backendNodeId: 90,
                shadowRootType: "open",
                children: [
                  {
                    backendNodeId: 10,
                    localName: "input",
                    shadowRoots: [
                      {
                        backendNodeId: 100,
                        shadowRootType: "user-agent",
                        children: [{ backendNodeId: 12, localName: "input" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      );
      const res = await readNativeTree(t);
      expect(findNative(res.nodes, "region")?.name).toBe("[redacted]");
      const asked = t.calls
        .filter((c) => c.method === "DOM.resolveNode")
        .map((c) => (c.params as { backendNodeId: number }).backendNodeId);
      expect(asked).toEqual([10]);
    });

    it("withholds it when the label's fields can't be listed", async () => {
      const res = await readNativeTree(
        hiddenCardTransport({ classified: true }, () => {
          throw new Error("No node with given id found");
        }),
      );
      expect(findNative(res.nodes, "region")?.name).toBe("[redacted]");
    });
  });

  it("withholds the name around a field whose read failed", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "cell" },
        name: {
          value: "4111111111111111",
          sources: [{ type: "contents", value: { value: "4111111111111111" } }],
        },
        childIds: ["2"],
      },
      {
        nodeId: "2",
        parentId: "1",
        backendDOMNodeId: 20,
        role: { value: "textbox" },
        name: { value: "Card number" },
        value: { type: "string", value: "4111111111111111" },
      },
    ];
    const t = new FakeTransport((method) => {
      if (method === "Accessibility.getFullAXTree") return { nodes: raw };
      return {};
    });
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "cell")?.name).toBe("[redacted]");
    expect(JSON.stringify(res)).not.toContain("4111");
  });

  it("withholds the chosen option in a listbox a sensitive combobox controls through a dropped wrapper", async () => {
    // The combobox reads as sensitive and the listbox as not, so only the
    // controls relation can withhold the option. Its `aria-controls` names
    // an unnamed wrapper the normalizer drops, around the listbox.
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 5,
        role: { value: "RootWebArea" },
        childIds: ["2", "3"],
      },
      {
        nodeId: "2",
        parentId: "1",
        backendDOMNodeId: 10,
        role: { value: "combobox" },
        name: { value: "Expiry month" },
        value: { type: "string", value: "07" },
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
        nodeId: "3",
        parentId: "1",
        backendDOMNodeId: 20,
        role: { value: "generic" },
        name: { value: "" },
        childIds: ["4"],
      },
      {
        nodeId: "4",
        parentId: "3",
        backendDOMNodeId: 30,
        role: { value: "listbox" },
        name: { value: "Months" },
        childIds: ["5"],
      },
      {
        nodeId: "5",
        parentId: "4",
        backendDOMNodeId: 40,
        role: { value: "option" },
        name: { value: "07" },
        properties: [
          {
            name: "selected",
            value: { type: "booleanOrUndefined", value: true },
          },
        ],
      },
    ];
    const t = new FakeTransport((method, params) => {
      if (method === "Accessibility.getFullAXTree") return { nodes: raw };
      if (method === "DOM.resolveNode") {
        const id = (params as { backendNodeId: number }).backendNodeId;
        return { object: { objectId: `obj-${id}` } };
      }
      if (method === "Runtime.callFunctionOn") {
        const { objectId } = params as { objectId: string };
        return {
          result: {
            value:
              objectId === "obj-10"
                ? { classified: true, sensitive: true, redacted: true }
                : { classified: true },
          },
        };
      }
      return {};
    });
    const res = await readNativeTree(t);
    expect(res.nodes.some((n) => n.id === "ax-dom-20")).toBe(false);
    expect(findNative(res.nodes, "option")?.states).not.toHaveProperty(
      "selected",
    );
  });

  it("treats a field it could not read as sensitive, down to its options", async () => {
    // The in-page read fails (no objectId), so the select is unclassified:
    // it may be a card field, and its chosen option must not say so.
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "combobox" },
        name: { value: "Expiry month" },
        value: { type: "string", value: "11" },
        childIds: ["2"],
      },
      {
        nodeId: "2",
        parentId: "1",
        backendDOMNodeId: 20,
        role: { value: "MenuListPopup" },
        name: { value: "" },
        childIds: ["3"],
      },
      {
        nodeId: "3",
        parentId: "2",
        backendDOMNodeId: 30,
        role: { value: "option" },
        name: { value: "11" },
        properties: [
          {
            name: "selected",
            value: { type: "booleanOrUndefined", value: true },
          },
        ],
      },
    ];
    const t = new FakeTransport((method) => {
      // Every other call, `DOM.resolveNode` included, answers `{}`: the
      // field can't be resolved, so its in-page read fails.
      if (method === "Accessibility.getFullAXTree") return { nodes: raw };
      return {};
    });
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "combobox")?.value).toBeUndefined();
    expect(findNative(res.nodes, "option")?.states).not.toHaveProperty(
      "selected",
    );
  });

  it("resolves every field into one object group, and releases it", async () => {
    const t = oneField(
      {
        role: { value: "textbox" },
        name: { value: "Name:" },
        value: { type: "string", value: "Ada" },
      },
      { classified: true, value: "Ada", announced: "Ada" },
    );
    await readNativeTree(t);
    const resolve = t.calls.find((c) => c.method === "DOM.resolveNode");
    const group = (resolve?.params as { objectGroup?: string }).objectGroup;
    expect(group).toMatch(/^sn-field-values-\d+$/);
    expect(t.calls.at(-1)).toEqual({
      method: "Runtime.releaseObjectGroup",
      params: { objectGroup: group },
    });
  });

  it("withholds a sensitive text field Chromium sends in plaintext (cc-number)", async () => {
    const t = oneField(
      {
        role: { value: "textbox" },
        name: { value: "Card number" },
        value: { type: "string", value: "4111111111111111" },
      },
      { classified: true, sensitive: true, redacted: true },
    );
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "textbox", "Card")?.value).toBe("[redacted]");
    expect(JSON.stringify(res)).not.toContain("4111111111111111");
  });

  it("shows no value for an empty sensitive field, even if Chromium reported one a moment earlier", async () => {
    const t = oneField(
      {
        role: { value: "textbox" },
        name: { value: "Card number" },
        value: { type: "string", value: "4111111111111111" },
      },
      { classified: true, sensitive: true },
    );
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "textbox", "Card")?.value).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain("4111111111111111");
  });

  it("fails closed: a node the page never classified shows no value, Chromium's included", async () => {
    // The resolve misses, so nothing ever said whether this field is
    // sensitive — and Chromium's payload is not redacted for us.
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "textbox" },
        name: { value: "Card number" },
        value: { type: "string", value: "4111111111111111" },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    expect(t.calls.some((c) => c.method === "DOM.resolveNode")).toBe(true);
    expect(findNative(res.nodes, "textbox", "Card")?.value).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain("4111111111111111");
  });

  it("shows an editor's content as its value — it is page content (ADR-0001)", async () => {
    const t = oneField(
      {
        role: { value: "application" },
        name: { value: "Message" },
        value: { type: "string", value: "Hello   world\n\nSecond" },
      },
      { classified: true },
    );
    const res = await readNativeTree(t);
    const editor = findNative(res.nodes, "application", "Message");
    expect(editor?.value).toBe("Hello world Second");
    expect(editor?.name).toBe("Message");
  });

  it("never resolves a checkbox or radio — their state says it", async () => {
    const t = oneField(
      {
        role: { value: "checkbox" },
        name: { value: "Subscribe" },
        value: { type: "string", value: "on" },
      },
      { classified: true },
    );
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "checkbox", "Subscribe")?.value).toBe(
      undefined,
    );
    expect(t.calls.some((c) => c.method === "DOM.resolveNode")).toBe(false);
  });

  it("never resolves a node whose role isn't value-bearing — no wasted round trip", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "button" },
        name: { value: "Save" },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "button", "Save")?.value).toBeUndefined();
    expect(t.calls.some((c) => c.method === "DOM.resolveNode")).toBe(false);
  });

  /**
   * A real page's `<header>`/`<main>`/`<footer>` layout is the ordinary case,
   * not an edge case: `normalizeNativeAX` drops `RootWebArea`, so a plain
   * multi-landmark page yields several parent-less nodes with no single
   * `rootId` a tree UI can render from — the dogfood panel never needed one
   * (a flat depth-indented list has no root concept at all), but a real
   * expand/collapse tree does. See `rootIdOf`'s own tests for the pure
   * logic; this pins that `readNativeTree` actually wires it through.
   */
  it("synthesizes a rootId when Chromium's tree has more than one parent-less node", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "RootWebArea" },
        childIds: ["2", "3"],
      },
      {
        nodeId: "2",
        parentId: "1",
        backendDOMNodeId: 20,
        role: { value: "heading" },
        name: { value: "Hi" },
      },
      {
        nodeId: "3",
        parentId: "1",
        backendDOMNodeId: 30,
        role: { value: "button" },
        name: { value: "Save" },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    expect(res.rootId).toBe(SYNTHETIC_ROOT_ID);
    // keptCount is what Chromium actually produced (the heading + the
    // button — RootWebArea is dropped by normalizeNativeAX) — NOT
    // res.nodes.length, which is one higher because it also counts the
    // synthetic "ax-root" wrapper rootIdOf pushed in.
    expect(res.keptCount).toBe(2);
    expect(res.nodes.length).toBe(3);
    // Pins the fix for a real regression this PR introduced and its own
    // review caught: `DogfoodPanel.tsx`'s flat list has no rootId concept,
    // so it filters the wire's `nodes` by this id rather than rendering the
    // synthetic root as an extra, unlabeled "document" row. That filter
    // has to land back on exactly `keptCount` — Chromium's real node count —
    // or the panel's own "read N nodes" status silently drifts from it again.
    expect(res.nodes.filter((n) => n.id !== SYNTHETIC_ROOT_ID).length).toBe(
      res.keptCount,
    );
  });

  it("uses the single surviving node as rootId when there's only one", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "RootWebArea" },
        childIds: ["2"],
      },
      {
        nodeId: "2",
        parentId: "1",
        backendDOMNodeId: 20,
        role: { value: "main" },
        name: { value: "" },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    expect(res.rootId).toBe("ax-dom-20");
  });
});

/** Minimal `EnrichedNativeNode` fixture — only the fields `rootIdOf` reads. */
function node(
  id: string,
  childIds: string[] = [],
  depth = 0,
): EnrichedNativeNode {
  return {
    id,
    role: "generic",
    name: "",
    depth,
    backendDOMNodeId: null,
    childIds,
    states: {},
    properties: {},
    description: "",
  };
}

describe("nativeControls", () => {
  const controls = (relatedNodes: Array<{ backendDOMNodeId?: number }>) => ({
    nodeId: "1",
    backendDOMNodeId: 10,
    role: { value: "tab" },
    properties: [
      { name: "controls", value: { type: "idrefList", relatedNodes } },
    ],
  });

  it("maps each target's backendDOMNodeId to its row id", () => {
    expect(
      nativeControls(
        controls([{ backendDOMNodeId: 20 }, { backendDOMNodeId: 30 }]),
        new Set(["ax-dom-20", "ax-dom-30"]),
      ),
    ).toEqual(["ax-dom-20", "ax-dom-30"]);
  });

  it("drops a target the tree doesn't have, and repeats", () => {
    // A hidden panel, or an unnamed wrapper the normalizer dropped, has no
    // row to jump to.
    expect(
      nativeControls(
        controls([
          { backendDOMNodeId: 20 },
          { backendDOMNodeId: 40 },
          { backendDOMNodeId: 20 },
          {},
        ]),
        new Set(["ax-dom-20"]),
      ),
    ).toEqual(["ax-dom-20"]);
  });

  it("is empty for a node with no controls relation", () => {
    expect(
      nativeControls(
        { nodeId: "1", role: { value: "button" }, properties: [] },
        new Set(["ax-dom-20"]),
      ),
    ).toEqual([]);
  });
});

describe("fieldFacets", () => {
  const classified = { classified: true };

  it("prefers a range widget's aria-valuetext over its number", () => {
    for (const role of ["slider", "spinbutton", "progressbar", "meter"]) {
      expect(
        fieldFacets(role, 60, { ...classified, valuetext: "60 percent" }).value,
        role,
      ).toBe("60 percent");
    }
  });

  it("ignores aria-valuetext on a role that is not a range", () => {
    expect(
      fieldFacets("textbox", "typed", { ...classified, valuetext: "nope" })
        .value,
    ).toBe("typed");
  });

  it("falls back to the number, as the author wrote it — not Chromium's float32", () => {
    // Chromium sends aria-valuenow="0.6" as 0.6000000238418579.
    expect(fieldFacets("meter", 0.6000000238418579, classified).value).toBe(
      "0.6",
    );
    expect(fieldFacets("slider", 40, classified).value).toBe("40");
    expect(fieldFacets("progressbar", 0, classified).value).toBe("0");
    expect(fieldFacets("slider", 12.25, classified).value).toBe("12.25");
  });

  it("collapses whitespace and caps at 240 characters with …", () => {
    expect(fieldFacets("textbox", "  a \n\t b  ", classified).value).toBe(
      "a b",
    );
    const long = "x".repeat(300);
    const capped = fieldFacets("textbox", long, classified).value!;
    expect(capped).toHaveLength(240);
    expect(capped.endsWith("…")).toBe(true);
  });

  it("keeps the raw value whole — uncollapsed, uncapped — for a retype", () => {
    const raw = "line one\nline   two " + "y".repeat(300);
    const facets = fieldFacets("textbox", raw, { ...classified, value: raw });
    expect(facets.rawValue).toBe(raw);
    expect(facets.value).not.toBe(raw);
  });

  it("shows nothing for an empty or whitespace-only value", () => {
    expect(fieldFacets("textbox", "   ", classified)).toEqual({});
    expect(fieldFacets("textbox", undefined, classified)).toEqual({});
  });

  it("keeps the placeholder whatever the verdict — it is page-authored", () => {
    expect(
      fieldFacets("textbox", undefined, {
        ...classified,
        sensitive: true,
        placeholder: "Password",
      }),
    ).toEqual({ placeholder: "Password" });
  });

  it("shows an input's in-page text over Chromium's earlier AX value", () => {
    // A "show password" toggle flipped `type` between the two reads: the AX
    // value is Chromium's bullet mask, the in-page read the field as it now
    // is — and the verdict came from that same in-page call.
    expect(
      fieldFacets("textbox", "•••••••", {
        ...classified,
        value: "hunter2",
        announced: "hunter2",
      }).value,
    ).toBe("hunter2");
    // Emptied between the reads: no value, not the stale one.
    expect(
      fieldFacets("textbox", "4111111111111111", {
        ...classified,
        announced: "",
      }),
    ).toEqual({});
  });

  it("flags the redaction marker, so no consumer compares text", () => {
    expect(
      fieldFacets("textbox", "•••••••", {
        ...classified,
        sensitive: true,
        redacted: true,
      }),
    ).toEqual({ value: "[redacted]", redacted: true });
    // An editor that merely holds the words is not redacted.
    expect(
      fieldFacets("application", "[redacted]", classified).redacted,
    ).toBeUndefined();
  });

  it("shows nothing at all without a verdict", () => {
    expect(
      fieldFacets("textbox", "4111111111111111", {
        value: "4111111111111111",
        placeholder: "Card",
      }),
    ).toEqual({});
  });
});

describe("withholdInsideSensitive", () => {
  const n = (
    id: string,
    childIds: string[],
    extra: Partial<EnrichedNativeNode> = {},
  ): EnrichedNativeNode => ({
    id,
    role: "generic",
    name: "",
    depth: 0,
    backendDOMNodeId: null,
    childIds,
    states: {},
    properties: {},
    description: "",
    ...extra,
  });

  it("clears every value below a sensitive node, but keeps a nested [redacted]", () => {
    const nodes = [
      n("wrap", ["field", "part"], { value: "outer" }),
      n("field", ["deep"], { value: "[redacted]", redacted: true }),
      n("part", [], { value: "11", rawValue: "11" }),
      n("deep", [], { value: "2031" }),
      n("elsewhere", [], { value: "Spain", rawValue: "es" }),
    ];
    withholdInsideSensitive(nodes, ["wrap"]);
    const byId = new Map(nodes.map((x) => [x.id, x]));
    // The sensitive node's own value is its verdict's business, not this.
    expect(byId.get("wrap")?.value).toBe("outer");
    expect(byId.get("field")?.value).toBe("[redacted]");
    expect(byId.get("part")?.value).toBeUndefined();
    expect(byId.get("part")?.rawValue).toBeUndefined();
    expect(byId.get("deep")?.value).toBeUndefined();
    expect(byId.get("elsewhere")?.value).toBe("Spain");
  });

  it("marks no option inside a sensitive field as selected", () => {
    // A redacted `<select autocomplete="cc-exp-month">`, as Chromium reads
    // it: the combobox, its popup, and its options, one marked selected. A
    // checkbox inside the popup stands for any control a sensitive wrapper
    // holds.
    const nodes = [
      n("month", ["popup"], {
        role: "combobox",
        value: "[redacted]",
        redacted: true,
        states: { focusable: true, expanded: false },
      }),
      n("popup", ["jan", "nov", "box"], { role: "MenuListPopup" }),
      n("jan", [], {
        role: "option",
        name: "01",
        states: { focusable: true, selected: false },
      }),
      n("nov", [], {
        role: "option",
        name: "11",
        states: { focusable: true, selected: true },
      }),
      n("box", [], { role: "checkbox", states: { checked: true } }),
      n("other", [], {
        role: "option",
        name: "Spain",
        states: { selected: true },
      }),
    ];
    withholdInsideSensitive(nodes, ["month"]);
    const byId = new Map(nodes.map((x) => [x.id, x]));
    // Strict: the key has to be gone from the wire, not set to undefined.
    expect(byId.get("jan")?.states).toStrictEqual({ focusable: true });
    expect(byId.get("nov")?.states).toStrictEqual({ focusable: true });
    // A checkbox is its own control, classified on its own: its state isn't
    // the field's value (see `NATIVE_AX_CHOICE_STATES`).
    expect(byId.get("box")?.states).toStrictEqual({ checked: true });
    // The field's own states, and anything outside it, stay.
    expect(byId.get("month")?.states).toStrictEqual({
      focusable: true,
      expanded: false,
    });
    expect(byId.get("other")?.states).toStrictEqual({ selected: true });
  });

  it("treats the listbox a sensitive combobox controls as inside it", () => {
    // An ARIA combobox (`<input role="combobox" aria-controls="list">`) whose
    // listbox is a sibling elsewhere in the page, not its descendant.
    const nodes = [
      n("exp", [], {
        role: "combobox",
        value: "[redacted]",
        redacted: true,
        controls: ["list"],
      }),
      n("list", ["jan", "nov"], { role: "listbox" }),
      n("jan", [], { role: "option", name: "01", states: { selected: false } }),
      n("nov", [], { role: "option", name: "11", states: { selected: true } }),
      n("other", [], {
        role: "option",
        name: "Spain",
        states: { selected: true },
      }),
    ];
    withholdInsideSensitive(nodes, ["exp"]);
    const byId = new Map(nodes.map((x) => [x.id, x]));
    expect(byId.get("nov")?.states).toStrictEqual({});
    expect(byId.get("nov")?.valueWithheld).toBe(true);
    expect(byId.get("jan")?.states).toStrictEqual({});
    expect(byId.get("other")?.states).toStrictEqual({ selected: true });
  });

  it("keeps the values of fields a sensitive one controls, but not which option is chosen", () => {
    // A card input whose `aria-controls` names a whole panel: its months
    // listbox, and a shipping address and a country select of their own,
    // each read as not sensitive. Only which month is chosen is the card's.
    const nodes = [
      n("card", ["part"], {
        role: "combobox",
        value: "[redacted]",
        redacted: true,
        controls: ["panel"],
      }),
      n("part", [], { role: "spinbutton", value: "07" }),
      n("panel", ["list", "addr", "country"]),
      n("list", ["jul"], { role: "listbox", valueWithheld: false }),
      n("jul", [], { role: "option", name: "07", states: { selected: true } }),
      n("addr", [], {
        role: "textbox",
        value: "1 Main St",
        rawValue: "1 Main St",
        valueWithheld: false,
      }),
      n("country", [], {
        role: "combobox",
        value: "France",
        rawValue: "fr",
        valueWithheld: false,
      }),
    ];
    // `part` is the card's own child and controlled too: inside wins.
    withholdInsideSensitive(nodes, ["card"], ["part"]);
    const byId = new Map(nodes.map((x) => [x.id, x]));
    expect(byId.get("jul")?.states).toStrictEqual({});
    expect(byId.get("jul")?.valueWithheld).toBe(true);
    expect(byId.get("addr")).toMatchObject({
      value: "1 Main St",
      rawValue: "1 Main St",
      valueWithheld: false,
    });
    expect(byId.get("country")).toMatchObject({
      value: "France",
      rawValue: "fr",
      valueWithheld: false,
    });
    expect(byId.get("list")?.valueWithheld).toBe(false);
    expect(byId.get("part")?.value).toBeUndefined();
    expect(byId.get("part")?.valueWithheld).toBe(true);
  });

  it("follows a controlled wrapper the tree dropped down to its listbox", () => {
    // `aria-controls` names an unnamed <div> around the listbox, which the
    // normalizer drops: the combobox's own `controls` is empty, and the
    // region comes from the raw tree.
    const raw = [
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
        role: { value: "listbox" },
        childIds: ["4"],
      },
      { nodeId: "4", backendDOMNodeId: 40, role: { value: "option" } },
    ];
    const kept = new Set(["ax-dom-10", "ax-dom-30", "ax-dom-40"]);
    expect(controlledRegion(raw[0]!, raw, kept)).toEqual(["ax-dom-30"]);

    const nodes = [
      n("ax-dom-10", [], {
        role: "combobox",
        value: "[redacted]",
        redacted: true,
      }),
      n("ax-dom-30", ["ax-dom-40"], { role: "listbox" }),
      n("ax-dom-40", [], {
        role: "option",
        name: "07",
        states: { selected: true },
      }),
    ];
    withholdInsideSensitive(nodes, ["ax-dom-10"], ["ax-dom-30"]);
    expect(nodes[2]!.states).toStrictEqual({});
  });

  it("marks every node below a sensitive one as withheld", () => {
    const nodes = [
      n("wrap", ["field"], { valueWithheld: true }),
      n("field", [], { valueWithheld: false }),
      n("elsewhere", [], { valueWithheld: false }),
    ];
    withholdInsideSensitive(nodes, ["wrap"]);
    const byId = new Map(nodes.map((x) => [x.id, x]));
    expect(byId.get("field")?.valueWithheld).toBe(true);
    expect(byId.get("elsewhere")?.valueWithheld).toBe(false);
  });
});

describe("fieldValueWithheld", () => {
  it("shows only a field classified as not sensitive", () => {
    expect(fieldValueWithheld({ classified: true, sensitive: false })).toBe(
      false,
    );
    expect(fieldValueWithheld({ classified: true })).toBe(false);
  });

  it("withholds a sensitive field, even an empty one", () => {
    // An empty sensitive select still has an option chosen, and which one
    // is its value.
    expect(fieldValueWithheld({ classified: true, sensitive: true })).toBe(
      true,
    );
  });

  it("fails closed on a field the in-page read couldn't classify", () => {
    expect(fieldValueWithheld({})).toBe(true);
    expect(fieldValueWithheld({ sensitive: false })).toBe(true);
  });
});

describe("capText", () => {
  it("leaves a short text alone", () => {
    expect(capText("abc", 240)).toBe("abc");
  });

  it("never cuts between the halves of a surrogate pair", () => {
    // An emoji straddling the cut would leave a lone half, which JSON
    // renders as a literal `\ud83d`.
    const text = "x".repeat(238) + "😀" + "tail";
    const cut = capText(text, 240);
    expect(cut).toBe("x".repeat(238) + "…");
    expect(JSON.stringify(cut)).not.toContain("\\ud83d");
  });
});

/**
 * Live dogfood finding: rounds up to this point never needed a `rootId` at
 * all — the dogfood panel renders a flat depth-indented list. Restoring a
 * real tree structure for the production panel integration needs one, the
 * same way the DOM producer always has exactly one root. Mirrors
 * `@real-a11y-dev/browser`'s own `native-tree.ts` root-synthesis exactly.
 */
describe("rootIdOf", () => {
  it("returns the single node's id when there's exactly one root", () => {
    const nodes = [node("a", ["b"]), node("b", [], 1)];
    expect(rootIdOf(nodes)).toBe("a");
  });

  it("returns empty string for an empty tree", () => {
    expect(rootIdOf([])).toBe("");
  });

  it("synthesizes an ax-root wrapper adopting every parent-less node", () => {
    const nodes = [node("a"), node("b")];
    const rootId = rootIdOf(nodes);
    expect(rootId).toBe(SYNTHETIC_ROOT_ID);
    const synthetic = nodes.find((n) => n.id === SYNTHETIC_ROOT_ID);
    expect(synthetic?.role).toBe("document");
    expect(synthetic?.childIds).toEqual(["a", "b"]);
  });

  it("pushes the synthetic root into the array so a consumer can find it by id", () => {
    const nodes = [node("a"), node("b")];
    rootIdOf(nodes);
    expect(nodes).toHaveLength(3);
  });

  /**
   * Devin review finding on this PR: a consumer that renders/walks this
   * array directly in order — `DogfoodPanel.tsx`'s flat depth-indented list
   * today, no separate root lookup — needs the root FIRST. Appending it
   * instead produced an indented forest followed by its own root.
   */
  it("puts the synthetic root at the front of the array, not the back", () => {
    const nodes = [node("a"), node("b")];
    rootIdOf(nodes);
    expect(nodes[0]?.id).toBe(SYNTHETIC_ROOT_ID);
  });

  /**
   * Wrapping shifts every former root down a level — without recomputing
   * depth, a consumer indenting rows by `node.depth` would render the two
   * top-level landmarks at the SAME indentation as the synthetic root that
   * now contains them, and their own children one level too shallow.
   */
  it("recomputes depth for every node relative to the real root after wrapping", () => {
    const nodes = [node("a", ["a1"], 0), node("a1", [], 1), node("b", [], 0)];
    rootIdOf(nodes);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get(SYNTHETIC_ROOT_ID)?.depth).toBe(0);
    expect(byId.get("a")?.depth).toBe(1);
    expect(byId.get("a1")?.depth).toBe(2);
    expect(byId.get("b")?.depth).toBe(1);
  });
});

describe("dispatchNative", () => {
  it("clicks via resolveNode + callFunctionOn", async () => {
    const t = new FakeTransport(resolving("obj-1", { ok: true }));
    const res = await dispatchNative(t, "ax-dom-42", "click");
    expect(res).toEqual({ success: true });
    expect(t.calls.find((c) => c.method === "DOM.resolveNode")?.params).toEqual(
      {
        backendNodeId: 42,
      },
    );
  });

  it("refuses a node with no backing DOM element without any CDP traffic", async () => {
    const t = new FakeTransport(() => ({}));
    const res = await dispatchNative(t, "ax-9", "click");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no backing DOM element/);
    expect(t.calls).toHaveLength(0);
  });

  it("rejects an unsupported action", async () => {
    const t = new FakeTransport(() => ({}));
    // @ts-expect-error — exercising the runtime guard on a bad action.
    const res = await dispatchNative(t, "ax-dom-1", "scroll");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unsupported action/);
    expect(t.calls).toHaveLength(0);
  });

  it("types the value INTO the page but never returns it (R1)", async () => {
    const t = new FakeTransport(resolving("obj-2", { ok: true }));
    const res = await dispatchNative(
      t,
      "ax-dom-5",
      "type",
      "hunter2@example.com",
    );
    expect(res).toEqual({ success: true });
    const call = t.calls.find((c) => c.method === "Runtime.callFunctionOn");
    expect(JSON.stringify(call?.params)).toContain("hunter2@example.com"); // goes in
    expect(JSON.stringify(res)).not.toContain("hunter2@example.com"); // never out
  });

  it("requires a string value for type", async () => {
    const t = new FakeTransport(resolving("obj-3", { ok: true }));
    const res = await dispatchNative(t, "ax-dom-5", "type");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/requires a string value/);
  });

  it("reports a stale id when the node no longer resolves", async () => {
    const t = new FakeTransport(resolving(null, undefined));
    const res = await dispatchNative(t, "ax-dom-42", "click");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/could not resolve/);
  });

  it("surfaces the in-page reason, never a raw error", async () => {
    const t = new FakeTransport((method) => {
      if (method === "DOM.resolveNode") return { object: { objectId: "o" } };
      if (method === "Runtime.callFunctionOn")
        throw new Error("secret@example.com in the page");
      return {};
    });
    const res = await dispatchNative(t, "ax-dom-8", "click");
    expect(res.success).toBe(false);
    expect(res.error).not.toContain("secret@example.com");
  });

  /**
   * Found by `/code-review`: every other `pageStep` test calls the
   * exported function directly with an explicit numeric delta
   * (`on(pageStep, el, 1)`), bypassing `runInPage`'s own
   * `action === "increment" ? 1 : -1` mapping entirely — so nothing pinned
   * that mapping itself. A swapped ternary there would silently turn every
   * dogfood "increment" into a decrement with no test catching it.
   */
  it("passes delta 1 for increment and -1 for decrement as the CDP argument", async () => {
    const incT = new FakeTransport(resolving("obj-inc", { ok: true }));
    await dispatchNative(incT, "ax-dom-1", "increment");
    const incCall = incT.calls.find(
      (c) => c.method === "Runtime.callFunctionOn",
    );
    expect(
      (incCall?.params as { arguments?: Array<{ value: number }> })
        ?.arguments?.[0]?.value,
    ).toBe(1);

    const decT = new FakeTransport(resolving("obj-dec", { ok: true }));
    await dispatchNative(decT, "ax-dom-1", "decrement");
    const decCall = decT.calls.find(
      (c) => c.method === "Runtime.callFunctionOn",
    );
    expect(
      (decCall?.params as { arguments?: Array<{ value: number }> })
        ?.arguments?.[0]?.value,
    ).toBe(-1);
  });

  /**
   * Live dogfood finding: "combobox options are not interactive" — a native
   * `<select>`'s `option` children had no action at all. `select` resolves
   * and dispatches exactly like `click`/`increment` do — this pins that the
   * new action reaches `runInPage` through the same path, not a special one.
   */
  it("dispatches a select action via resolveNode + callFunctionOn", async () => {
    const t = new FakeTransport(resolving("obj-opt", { ok: true }));
    const res = await dispatchNative(t, "ax-dom-77", "select");
    expect(res).toEqual({ success: true });
    expect(
      t.calls.find((c) => c.method === "Runtime.callFunctionOn")?.params,
    ).toMatchObject({ functionDeclaration: String(pageSelectOption) });
  });
});

// The in-page action functions are DOM code that happens to be *delivered* over
// CDP, so they're exercised as DOM code — called with the element as `this`,
// exactly as `Runtime.callFunctionOn` invokes them.

/** Call an in-page function the way Runtime.callFunctionOn does: as `this`. */
function on<A extends unknown[], R>(
  fn: (this: Element, ...args: A) => R,
  el: Element,
  ...args: A
): R {
  return fn.call(el, ...args);
}

function record(el: Element, types: string[]): string[] {
  const seen: string[] = [];
  for (const type of types) el.addEventListener(type, () => seen.push(type));
  return seen;
}

const POINTER_SEQUENCE = [
  "pointerdown",
  "mousedown",
  "pointerup",
  "mouseup",
  "click",
];

describe("in-page actions — click", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("fires the full pointer sequence, not a bare click", () => {
    // Regression: this path used to call `this.click()`, which fires `click`
    // alone. jsaction / Material handlers gate on the pointer sequence, so
    // those pages saw nothing while the marker still reported success.
    const el = document.createElement("button");
    document.body.appendChild(el);
    const seen = record(el, POINTER_SEQUENCE);

    expect(on(pageClick, el)).toEqual({ ok: true });
    expect(seen).toEqual(POINTER_SEQUENCE);
  });

  it("reaches a pointerdown-only handler (the jsaction failure mode)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    let fired = false;
    el.addEventListener("pointerdown", () => {
      fired = true;
    });
    expect(on(pageClick, el)).toEqual({ ok: true });
    expect(fired).toBe(true);
  });

  it("redirects a composite wrapper to the control that carries the handler", () => {
    // `menuitem` and `tab` are in the panel's ACTABLE set, and a delegated
    // handler walks UP from the target — so dispatching on the wrapper misses
    // it entirely and the click silently does nothing.
    for (const role of ["menuitem", "tab", "treeitem", "option"]) {
      document.body.innerHTML = `<div role="${role}"><button>go</button></div>`;
      const wrapper = document.body.firstElementChild as Element;
      const inner = wrapper.querySelector("button") as Element;
      let innerClicked = false;
      inner.addEventListener("click", () => {
        innerClicked = true;
      });

      expect(on(pageClick, wrapper)).toEqual({ ok: true });
      expect(innerClicked).toBe(true);
    }
  });

  it("leaves a well-formed control alone", () => {
    document.body.innerHTML = `<button id="b">go</button>`;
    const el = document.getElementById("b") as Element;
    const seen = record(el, ["click"]);
    expect(on(pageClick, el)).toEqual({ ok: true });
    expect(seen).toEqual(["click"]);
  });
});

describe("in-page actions — reveal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /** Reveal events the content script would catch: on the way down. */
  function captured(): CustomEvent[] {
    const events: CustomEvent[] = [];
    document.addEventListener(
      "real-a11y:native-reveal",
      (e) => events.push(e as CustomEvent),
      true,
    );
    return events;
  }

  it("fires the overlay event at the element with the arm's nonce, then focuses without scrolling", () => {
    // Real focus alone shows nothing while the side panel, not the page, has
    // window focus; the content script's overlay is the visible indicator.
    const el = document.createElement("button");
    document.body.appendChild(el);
    const events = captured();
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

    expect(pageReveal.call(el, "n-1")).toEqual({ ok: true });
    expect(events).toHaveLength(1);
    expect(events[0]!.target).toBe(el);
    expect(events[0]!.detail).toBe("n-1");
    expect(focusSpy).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    focusSpy.mockRestore();
  });

  it("doesn't bubble, so page listeners below the document never see it", () => {
    document.body.innerHTML = "<main><button>Go</button></main>";
    const seen: Event[] = [];
    document
      .querySelector("main")!
      .addEventListener("real-a11y:native-reveal", (e) => seen.push(e));
    pageReveal.call(document.querySelector("button")!, "n-2");
    expect(seen).toHaveLength(0);
  });

  it("still asks for the overlay on a heading that can't take focus", () => {
    document.body.innerHTML = "<h2>Shipping</h2>";
    const events = captured();
    expect(pageReveal.call(document.querySelector("h2")!, "n-3")).toEqual({
      ok: true,
    });
    expect(events).toHaveLength(1);
  });

  it("works on a form whose controls shadow dispatchEvent and focus", () => {
    document.body.innerHTML = `<form tabindex="-1"><input name="dispatchEvent"><input name="focus"></form>`;
    const form = document.querySelector("form")!;
    const events = captured();
    expect(pageReveal.call(form, "n-4")).toEqual({ ok: true });
    expect(events).toHaveLength(1);
    expect(document.activeElement).toBe(form);
  });
});

describe("in-page actions — type", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("writes a native input through the prototype setter", () => {
    const el = document.createElement("input");
    document.body.appendChild(el);
    const seen = record(el, ["input", "change"]);
    expect(on(pageType, el, "hello")).toEqual({ ok: true });
    expect(el.value).toBe("hello");
    expect(seen).toEqual(["input", "change"]);
  });

  it("gives a model-driven editor a cancelable beforeinput and respects it", () => {
    // Regression: this path used to write `textContent` unconditionally.
    // ProseMirror/Lexical/Draft consume `beforeinput`, insert into their own
    // model, and revert the DOM — so the write was lost while the marker said
    // success. Cancelling must leave the DOM untouched.
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    el.textContent = "original";
    document.body.appendChild(el);
    let sawBeforeInput = false;
    el.addEventListener("beforeinput", (e) => {
      sawBeforeInput = true;
      e.preventDefault(); // the editor handled it
    });

    expect(on(pageType, el, "typed")).toEqual({ ok: true });
    expect(sawBeforeInput).toBe(true);
    expect(el.textContent).toBe("original"); // not clobbered
  });

  it("writes contenteditable when nothing handled beforeinput", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    document.body.appendChild(el);
    expect(on(pageType, el, "typed")).toEqual({ ok: true });
    expect(el.textContent).toBe("typed");
  });

  it("asks a model-driven editor to delete everything when clearing", () => {
    // Regression: clearing sent `insertText` with empty data, which asks an
    // editor to insert nothing — it kept its content while the marker said
    // success. Clearing has to be a deletion over the editor's whole content.
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    el.innerHTML = "<p>first</p><p>second</p>";
    document.body.appendChild(el);
    let seen: { inputType: string; data: string | null } | null = null;
    let selected = "";
    el.addEventListener("beforeinput", (e) => {
      const event = e as InputEvent;
      seen = { inputType: event.inputType, data: event.data };
      selected = document.getSelection()?.toString() ?? "";
      e.preventDefault(); // the editor deletes from its own model
    });

    expect(on(pageType, el, "")).toEqual({ ok: true });
    // Not the spec's `deleteContent`: Chromium blanks an inputType it doesn't
    // know, and jsdom passes any string through, so only the name pins it.
    expect(seen).toEqual({ inputType: "deleteContentBackward", data: null });
    expect(selected).toBe("firstsecond");
    expect(el.textContent).toBe("firstsecond"); // the editor's call, not ours
  });

  it("empties contenteditable when nothing handled the deletion", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    el.innerHTML = "<p>draft</p>";
    document.body.appendChild(el);
    const inputTypes: string[] = [];
    el.addEventListener("input", (e) => {
      inputTypes.push((e as InputEvent).inputType);
    });

    expect(on(pageType, el, "")).toEqual({ ok: true });
    expect(el.textContent).toBe("");
    expect(inputTypes).toEqual(["deleteContentBackward"]);
  });

  it("refuses a non-text element instead of reporting success", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(on(pageType, el, "x")).toEqual({
      ok: false,
      reason: "not-a-text-field",
    });
  });

  it("never returns the typed text (R1)", () => {
    const el = document.createElement("input");
    document.body.appendChild(el);
    const marker = on(pageType, el, "hunter2");
    expect(JSON.stringify(marker)).not.toContain("hunter2");
  });
});

describe("in-page actions — read value", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("reads a plain text input's value, and announces the same text", () => {
    const el = document.createElement("input");
    el.value = "456465";
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({
      classified: true,
      value: "456465",
      announced: "456465",
    });
  });

  it("reads a textarea and a select the same way", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "hello";
    document.body.appendChild(textarea);
    expect(on(pageReadValue, textarea)).toEqual({
      classified: true,
      value: "hello",
      announced: "hello",
    });

    // The RAW value — "fr", not the label — and no `announced`: what the tree
    // SHOWS for a select is Chromium's announced label; this read is only the
    // retype prefill.
    const select = document.createElement("select");
    const option = document.createElement("option");
    option.value = "fr";
    option.textContent = "France";
    select.appendChild(option);
    select.value = "fr";
    document.body.appendChild(select);
    expect(on(pageReadValue, select)).toEqual({
      classified: true,
      value: "fr",
    });
  });

  it("classifies an empty field without a value — not even a redacted marker", () => {
    // `announced: ""` says "empty, as of this read" — so an AX value
    // captured before the field was cleared is not shown instead.
    const el = document.createElement("input");
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({ classified: true, announced: "" });
  });

  it("announces nothing for a valueless input type — a state or a name says it", () => {
    for (const type of ["checkbox", "radio", "button", "submit", "reset"]) {
      const el = document.createElement("input");
      el.type = type;
      el.value = "Send";
      document.body.appendChild(el);
      expect(on(pageReadValue, el).announced, type).toBe("");
    }
  });

  // jsdom can't attach files; the e2e suite reads a chosen file's name back.
  it("announces an empty file input as empty — never Chromium's 'No file chosen' or a fake path", () => {
    const el = document.createElement("input");
    el.type = "file";
    document.body.appendChild(el);
    const result = on(pageReadValue, el);
    expect(result).toEqual({ classified: true, announced: "" });
  });

  it("still marks an EMPTY sensitive field sensitive, so no stale AX value can stand in for it", () => {
    const el = document.createElement("input");
    el.type = "password";
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({
      classified: true,
      sensitive: true,
    });
  });

  /**
   * Live need for the production panel integration: acting on a native
   * typable field opens the same `InputPanel` text modal the DOM path uses,
   * which shows a placeholder hint. Placeholder is page-authored, not user
   * input (same distinction `description` already draws — R1 only concerns
   * a field's live VALUE), so unlike `value` it is never redacted and is
   * returned even when the field is empty — exactly the case a placeholder
   * hint matters most for.
   */
  it("returns a placeholder for an empty field", () => {
    const el = document.createElement("input");
    el.placeholder = "you@example.com";
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({
      classified: true,
      placeholder: "you@example.com",
      announced: "",
    });
  });

  it("returns both value and placeholder together for a filled field", () => {
    const el = document.createElement("input");
    el.placeholder = "you@example.com";
    el.value = "ada@example.com";
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({
      classified: true,
      value: "ada@example.com",
      announced: "ada@example.com",
      placeholder: "you@example.com",
    });
  });

  it("returns the placeholder alongside a redacted marker — it is not user input", () => {
    const el = document.createElement("input");
    el.type = "password";
    el.placeholder = "Password";
    el.value = "hunter2";
    document.body.appendChild(el);
    const result = on(pageReadValue, el);
    expect(result).toEqual({
      classified: true,
      sensitive: true,
      redacted: true,
      placeholder: "Password",
    });
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("reads a textarea's placeholder the same way", () => {
    const el = document.createElement("textarea");
    el.placeholder = "Leave a comment";
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({
      classified: true,
      placeholder: "Leave a comment",
      announced: "",
    });
  });

  it("omits placeholder for a select — it has no such attribute", () => {
    const select = document.createElement("select");
    const option = document.createElement("option");
    option.value = "fr";
    select.appendChild(option);
    select.value = "fr";
    document.body.appendChild(select);
    expect(on(pageReadValue, select)).toEqual({
      classified: true,
      value: "fr",
    });
  });

  it("redacts a password field instead of returning the typed secret (R1)", () => {
    const el = document.createElement("input");
    el.type = "password";
    el.value = "hunter2";
    document.body.appendChild(el);
    const result = on(pageReadValue, el);
    expect(result).toEqual({
      classified: true,
      sensitive: true,
      redacted: true,
    });
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("redacts a text-type field with a sensitive autocomplete token (R1)", () => {
    const el = document.createElement("input");
    el.type = "text";
    el.autocomplete = "cc-number";
    el.value = "4111111111111111";
    document.body.appendChild(el);
    const result = on(pageReadValue, el);
    expect(result).toEqual({
      classified: true,
      sensitive: true,
      redacted: true,
    });
    expect(JSON.stringify(result)).not.toContain("4111111111111111");
  });

  it("redacts a select and a textarea with a sensitive token, as core does", () => {
    const select = document.createElement("select");
    select.setAttribute("autocomplete", "cc-exp-month");
    const option = document.createElement("option");
    option.value = "07";
    option.textContent = "July";
    select.appendChild(option);
    select.value = "07";
    document.body.appendChild(select);
    expect(on(pageReadValue, select)).toEqual({
      classified: true,
      sensitive: true,
      redacted: true,
    });

    const textarea = document.createElement("textarea");
    textarea.setAttribute("autocomplete", "one-time-code");
    textarea.value = "123456";
    document.body.appendChild(textarea);
    expect(JSON.stringify(on(pageReadValue, textarea))).not.toContain("123456");
  });

  it("does not treat a normal autocomplete token as sensitive", () => {
    const el = document.createElement("input");
    el.autocomplete = "given-name";
    el.value = "Ada";
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({
      classified: true,
      value: "Ada",
      announced: "Ada",
    });
  });

  it("classifies a non-field element as never sensitive, without reading its content", () => {
    // Its value is whatever Chromium announces for it — an editor's text —
    // so this read only has to say it is not a sensitive field. The policy
    // covers `input`/`textarea`/`select` alone (core's
    // `isSensitiveFieldAttributes`).
    const el = document.createElement("div");
    el.setAttribute("role", "textbox");
    el.setAttribute("contenteditable", "true");
    el.setAttribute("autocomplete", "current-password");
    el.textContent = "typed text";
    document.body.appendChild(el);
    const result = on(pageReadValue, el);
    expect(result).toEqual({ classified: true });
    expect(JSON.stringify(result)).not.toContain("typed text");
  });

  it("withholds a wrapper's value when a sensitive field sits inside it", () => {
    // Chromium 151 leaves a nested control's value out of its wrapper's AX
    // value (measured), but the wrapper's value is Chromium's to compute, so
    // it is withheld whole rather than trusted to exclude the secret.
    const combobox = document.createElement("div");
    combobox.setAttribute("role", "combobox");
    const input = document.createElement("input");
    input.setAttribute("autocomplete", "cc-number");
    input.value = "4111111111111111";
    combobox.appendChild(input);
    document.body.appendChild(combobox);
    expect(on(pageReadValue, combobox)).toEqual({
      classified: true,
      sensitive: true,
    });

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.append("Draft ");
    const password = document.createElement("input");
    password.type = "password";
    editor.appendChild(password);
    document.body.appendChild(editor);
    expect(on(pageReadValue, editor).sensitive).toBe(true);

    // A plain control inside a wrapper changes nothing.
    const plain = document.createElement("div");
    plain.setAttribute("contenteditable", "true");
    plain.appendChild(document.createElement("input"));
    document.body.appendChild(plain);
    expect(on(pageReadValue, plain)).toEqual({ classified: true });
  });

  it("recognises a field by its tag, not instanceof — a swapped prototype still redacts", () => {
    // A field `instanceof` missed would read as a non-field: never
    // sensitive, and Chromium's plaintext value shown for it.
    const el = document.createElement("input");
    el.setAttribute("autocomplete", "cc-number");
    el.value = "4111111111111111";
    document.body.appendChild(el);
    Object.setPrototypeOf(el, HTMLElement.prototype);
    expect(el instanceof HTMLInputElement).toBe(false);
    const result = on(pageReadValue, el);
    expect(result).toEqual({
      classified: true,
      sensitive: true,
      redacted: true,
    });
    expect(JSON.stringify(result)).not.toContain("4111111111111111");
  });

  it("returns aria-valuetext, which Chromium's CDP payload never carries", () => {
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    slider.setAttribute("aria-valuenow", "60");
    slider.setAttribute("aria-valuetext", "60 percent");
    document.body.appendChild(slider);
    expect(on(pageReadValue, slider)).toEqual({
      classified: true,
      valuetext: "60 percent",
    });

    const range = document.createElement("input");
    range.type = "range";
    range.value = "80";
    range.setAttribute("aria-valuetext", "Loud");
    document.body.appendChild(range);
    expect(on(pageReadValue, range)).toEqual({
      classified: true,
      valuetext: "Loud",
      value: "80",
      announced: "80",
    });
  });

  it("classifies nothing for a `this` that is not an element", () => {
    const text = document.createTextNode("hello");
    expect(pageReadValue.call(text as unknown as Element)).toEqual({});
    expect(pageReadValue.call(null as unknown as Element)).toEqual({});
  });

  /**
   * Found by `/security-review`: reading `.type`/`.getAttribute` directly
   * trusts accessors the inspected page's own JS realm controls — a page
   * could shadow an instance property to make a password/`cc-number` field
   * misreport as ordinary text, defeating the redaction gate. Pinning to
   * each class's own property descriptor (matching `pageType`'s existing
   * defense for its setter) closes the realistic case: an instance-level
   * override, which is what a page shadowing its own element's properties
   * actually looks like. It does not close a page that redefines the
   * PROTOTYPE'S accessor before this function ever runs — no in-page read
   * can un-patch an already-patched prototype — but that residual is not
   * new: `core`'s `isSensitiveField`, the already-shipped DOM producer
   * redaction this mirrors, has no pinning at all today.
   */
  it("resists an instance-level property lying about a sensitive field's type", () => {
    const el = document.createElement("input");
    el.type = "password";
    el.value = "hunter2";
    document.body.appendChild(el);
    // A shadowed own property, not the real setter — the realistic
    // tampering case, and what pinning to the prototype's descriptor
    // defends against.
    Object.defineProperty(el, "type", { value: "text", configurable: true });
    const result = on(pageReadValue, el);
    expect(result).toEqual({
      classified: true,
      sensitive: true,
      redacted: true,
    });
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("resists an instance-level getAttribute lying about a sensitive autocomplete token", () => {
    const el = document.createElement("input");
    el.type = "text";
    el.autocomplete = "cc-number";
    el.value = "4111111111111111";
    document.body.appendChild(el);
    (el as unknown as { getAttribute: () => null }).getAttribute = () => null;
    const result = on(pageReadValue, el);
    expect(result).toEqual({
      classified: true,
      sensitive: true,
      redacted: true,
    });
    expect(JSON.stringify(result)).not.toContain("4111111111111111");
  });
});

/**
 * ADR-0001: one sensitivity policy for every producer. `pageReadValue` runs
 * in the page as source text, so it cannot import core's list and carries a
 * copy. This reads that copy back out of the exact source text
 * `Runtime.callFunctionOn` is handed, and pins it to core's export — so
 * growing or shrinking either list alone fails here.
 */
describe("pageReadValue's sensitive-token list", () => {
  /** The `SENSITIVE_AUTOCOMPLETE_TOKENS` array literal in the in-page
   *  source, as its string elements. */
  function inPageTokens(): string[] {
    const match = /SENSITIVE_AUTOCOMPLETE_TOKENS\s*=\s*\[([^\]]*)\]/.exec(
      IN_PAGE_READ_VALUE_SOURCE,
    );
    if (!match) {
      throw new Error(
        "pageReadValue's source no longer declares SENSITIVE_AUTOCOMPLETE_TOKENS as one array literal",
      );
    }
    return [...match[1]!.matchAll(/(["'`])(.*?)\1/g)].map((m) => m[2]!);
  }

  it("is exactly core's SENSITIVE_AUTOCOMPLETE_TOKENS, in both directions", () => {
    const inPage = inPageTokens();
    expect(new Set(inPage).size).toBe(inPage.length);
    expect([...inPage].sort()).toEqual(
      [...SENSITIVE_AUTOCOMPLETE_TOKENS].sort(),
    );
  });

  it("is the list the function actually applies — each of core's tokens redacts", () => {
    // Guards the parse above against reading a list the body no longer uses.
    for (const token of SENSITIVE_AUTOCOMPLETE_TOKENS) {
      const el = document.createElement("input");
      el.setAttribute("autocomplete", `section-x ${token.toUpperCase()}`);
      el.value = "a-secret";
      document.body.appendChild(el);
      const result = on(pageReadValue, el);
      expect(result, token).toEqual({
        classified: true,
        sensitive: true,
        redacted: true,
      });
      el.remove();
    }
  });
});

/**
 * Live dogfood finding: "slider controls are not interactable" — the W3C
 * multi-thumb slider example's thumbs had no way to act on them at all.
 * `pageStep` mirrors core's `ActionDispatcher.handleStep`/`dispatchArrowStep`
 * (`core/src/interaction/action-dispatcher.ts`): native `stepUp()`/
 * `stepDown()` for a real range/number input, else `ArrowRight`/`ArrowLeft`
 * dispatched on the element itself (a custom ARIA slider installs its
 * keyboard listener there, not wherever focus happens to be).
 */
describe("in-page actions — step", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("steps a native range input via stepUp/stepDown, not the keyboard path", () => {
    const el = document.createElement("input");
    el.type = "range";
    el.min = "0";
    el.max = "10";
    el.value = "5";
    document.body.appendChild(el);
    const seen = record(el, ["input", "change"]);

    expect(on(pageStep, el, 1)).toEqual({ ok: true });
    expect(el.value).toBe("6");
    expect(seen).toEqual(["input", "change"]);

    expect(on(pageStep, el, -1)).toEqual({ ok: true });
    expect(el.value).toBe("5");
  });

  it("steps a native number input the same way", () => {
    const el = document.createElement("input");
    el.type = "number";
    el.value = "3";
    document.body.appendChild(el);
    expect(on(pageStep, el, 1)).toEqual({ ok: true });
    expect(el.value).toBe("4");
  });

  it("dispatches ArrowRight/ArrowLeft on a custom ARIA slider", () => {
    const el = document.createElement("div");
    el.setAttribute("role", "slider");
    el.setAttribute("tabindex", "0");
    document.body.appendChild(el);
    const seenKeys: string[] = [];
    el.addEventListener("keydown", (e) =>
      seenKeys.push(`down:${(e as KeyboardEvent).key}`),
    );
    el.addEventListener("keyup", (e) =>
      seenKeys.push(`up:${(e as KeyboardEvent).key}`),
    );

    expect(on(pageStep, el, 1)).toEqual({ ok: true });
    expect(seenKeys).toEqual(["down:ArrowRight", "up:ArrowRight"]);

    seenKeys.length = 0;
    expect(on(pageStep, el, -1)).toEqual({ ok: true });
    expect(seenKeys).toEqual(["down:ArrowLeft", "up:ArrowLeft"]);
  });

  it("falls back to the keyboard path when stepUp/stepDown throws", () => {
    // A range input with no step increment configured correctly (min > max)
    // makes stepUp throw in real browsers; jsdom doesn't reject this
    // construction, so simulate the throw directly to exercise the fallback.
    const el = document.createElement("input");
    el.type = "range";
    document.body.appendChild(el);
    el.stepUp = () => {
      throw new Error("invalid state");
    };
    const seenKeys: string[] = [];
    el.addEventListener("keydown", (e) =>
      seenKeys.push((e as KeyboardEvent).key),
    );

    expect(on(pageStep, el, 1)).toEqual({ ok: true });
    expect(seenKeys).toEqual(["ArrowRight"]);
  });

  it("does not steal focus when nothing focuses itself in response", () => {
    const button = document.createElement("button");
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    document.body.appendChild(button);
    document.body.appendChild(slider);
    button.focus();
    expect(document.activeElement).toBe(button);

    on(pageStep, slider, 1);
    expect(document.activeElement).toBe(button);
  });

  /**
   * Found by `/code-review`: the test above never exercises the restore
   * logic at all — nothing in it ever moves focus away from `button`, so
   * the assertion would pass identically even with both restore stages
   * deleted. These two tests simulate the two cases the two-stage design
   * exists for: a widget that focuses itself synchronously inside its own
   * keydown handler (restore's synchronous call), and one that schedules
   * the focus call for later — the Radix-style state-update-then-re-render
   * pattern the docstring names (restore's `setTimeout(0)` call).
   */
  it("restores focus synchronously when the widget focuses itself inside its own keydown handler", () => {
    const button = document.createElement("button");
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    slider.tabIndex = 0;
    document.body.appendChild(button);
    document.body.appendChild(slider);
    slider.addEventListener("keydown", () => slider.focus());
    button.focus();

    on(pageStep, slider, 1);
    // No fake timers needed — this widget shape steals focus synchronously,
    // inside dispatchEvent itself, so the synchronous restore() call right
    // after must already have put it back before pageStep even returns.
    expect(document.activeElement).toBe(button);
  });

  /**
   * Live dogfood finding: "still unable to interact with the sliders" — the
   * W3C multi-thumb slider example's thumbs still didn't move after round
   * 12's fix. Its keydown handler (and a real share of hand-written ARIA
   * widgets generally) gates on `document.activeElement === this`, a
   * reasonable assumption for widget code a real user can only reach by
   * having tabbed there first. Without a real `.focus()` call, `pageStep`
   * reported `{ ok: true }` — the events genuinely dispatched — while the
   * widget silently ignored them because it never saw itself as focused.
   */
  it("focuses the element first so a widget that gates its handler on real focus still reacts", () => {
    const button = document.createElement("button");
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    slider.tabIndex = 0;
    document.body.appendChild(button);
    document.body.appendChild(slider);
    let valueNow = 100;
    slider.addEventListener("keydown", (e) => {
      if (document.activeElement !== slider) return; // the real-world guard
      if ((e as KeyboardEvent).key === "ArrowRight") valueNow += 1;
    });
    button.focus();
    expect(document.activeElement).toBe(button);

    expect(on(pageStep, slider, 1)).toEqual({ ok: true });

    expect(valueNow).toBe(101);
    // The two-stage restore already in place undoes our own upfront focus()
    // call the same way it undoes a widget stealing focus as a side effect —
    // so the dogfooder's panel button ends up with focus back, same as before.
    expect(document.activeElement).toBe(button);
  });

  it("restores focus after a deferred (setTimeout-scheduled) focus steal", () => {
    vi.useFakeTimers();
    try {
      const button = document.createElement("button");
      const slider = document.createElement("div");
      slider.setAttribute("role", "slider");
      slider.tabIndex = 0;
      document.body.appendChild(button);
      document.body.appendChild(slider);
      // Radix-style: the keydown handler doesn't focus synchronously, it
      // schedules the focus call for a later tick (standing in for a state
      // update + re-render landing on a microtask/RAF boundary).
      slider.addEventListener("keydown", () => {
        setTimeout(() => slider.focus(), 0);
      });
      button.focus();

      on(pageStep, slider, 1);
      // The widget's own deferred focus call hasn't run yet — nothing to
      // restore from at this instant, so the synchronous restore is a no-op
      // and focus is still on the button.
      expect(document.activeElement).toBe(button);

      // Both the widget's own scheduled focus() and pageStep's own
      // setTimeout(restore, 0) are due at the same tick, in schedule order
      // (widget's first, pageStep's restore second) — running due timers
      // fires both within this one advance, ending back on the button.
      // Without pageStep's deferred restore stage, this would leave focus
      // stranded on the slider instead.
      vi.advanceTimersByTime(0);
      expect(document.activeElement).toBe(button);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns not-element for a null this", () => {
    expect(on(pageStep, null as unknown as Element, 1)).toEqual({
      ok: false,
      reason: "not-element",
    });
  });
});

/**
 * Live dogfood finding: "combobox options are not interactive" — Amazon's
 * department dropdown is a real `<select>`; Chromium normalizes it to
 * `combobox` → `menuListPopup` → `option`, and each `option` row had no
 * native-tree action at all. A generic `click` was never the fix — a
 * synthetic pointer sequence on a real `<option>` is a no-op, since the open
 * list is OS chrome — so this is a dedicated action that sets the owning
 * `<select>`'s value and fires `change`, exactly like the DOM/A11Y tree
 * view's own `handleSelect` (`core/src/interaction/action-dispatcher.ts`).
 */
describe("in-page actions — select", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("sets the owning select's value and fires change", () => {
    document.body.innerHTML = `
      <select id="dept">
        <option value="all">All</option>
        <option value="electronics">Electronics</option>
      </select>
    `;
    const select = document.getElementById("dept") as HTMLSelectElement;
    const option = select.options[1];
    const changes = record(select, ["change"]);

    const result = on(pageSelectOption, option);

    expect(result).toEqual({ ok: true });
    expect(select.value).toBe("electronics");
    expect(changes).toEqual(["change"]);
  });

  it('refuses a non-option element instead of guessing — a custom role="option" widget', () => {
    document.body.innerHTML = `<div role="option">Fake option</div>`;
    const el = document.querySelector('[role="option"]')!;
    expect(on(pageSelectOption, el)).toEqual({
      ok: false,
      reason: "not-an-option",
    });
  });

  it("refuses a disabled option, an option in a disabled optgroup, and a disabled select", () => {
    document.body.innerHTML = `
      <select id="a"><option>One</option><option disabled>Two</option></select>
      <select id="b"><optgroup disabled label="G"><option>Three</option></optgroup></select>
      <select id="c" disabled><option>Four</option><option>Five</option></select>
    `;
    const opt = (sel: string, i: number) =>
      (document.getElementById(sel) as HTMLSelectElement).options[i]!;
    for (const option of [opt("a", 1), opt("b", 0), opt("c", 1)]) {
      expect(on(pageSelectOption, option)).toEqual({
        ok: false,
        reason: "disabled",
      });
    }
    expect((document.getElementById("c") as HTMLSelectElement).value).toBe(
      "Four",
    );
  });

  it("refuses an option with no select ancestor", () => {
    document.body.innerHTML = `<option value="orphan">Orphan</option>`;
    const option = document.querySelector("option")!;
    expect(on(pageSelectOption, option)).toEqual({
      ok: false,
      reason: "no-select-ancestor",
    });
  });

  it("returns not-element for a null this", () => {
    expect(on(pageSelectOption, null as unknown as Element)).toEqual({
      ok: false,
      reason: "not-element",
    });
  });
});

describe("in-page action source", () => {
  it("serializes to self-contained source for Runtime.callFunctionOn", () => {
    // Each is shipped as source text, so nothing may reference a module-scope
    // binding — that would be a ReferenceError in the page, not a build error.
    // pageReadValue is checked the same way, even though it isn't a
    // NativeAction / IN_PAGE_ACTION_SOURCE entry: it crosses into the page as
    // source text exactly like the three actions do (Runtime.callFunctionOn,
    // readFieldValue), so the same constraint applies and the same class of
    // mistake (e.g. hoisting SENSITIVE_AUTOCOMPLETE_TOKENS to module scope)
    // would otherwise only surface as a runtime ReferenceError in the page.
    for (const src of [
      ...Object.values(IN_PAGE_ACTION_SOURCE),
      String(pageReadValue),
    ]) {
      expect(src).toMatch(/^function/);
      expect(src).not.toContain("import");
    }
    // The composite list must live inside the click body, not hoisted.
    expect(IN_PAGE_ACTION_SOURCE.click).toContain("treeitem");
    // The reveal event name is a literal inside the body — `content.ts`
    // listens for the identical string.
    expect(IN_PAGE_ACTION_SOURCE.reveal).toContain("real-a11y:native-reveal");
    // The sensitive-token list must live inside pageReadValue's own body too.
    expect(String(pageReadValue)).toContain("cc-number");
  });
});
