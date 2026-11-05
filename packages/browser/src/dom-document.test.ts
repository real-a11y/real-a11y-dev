import { describe, expect, it } from "vitest";

import { nestFlatDocument } from "./dom-document.js";

describe("nestFlatDocument (DOM.getFlattenedDocument → nested tree)", () => {
  // Post-order, as Chromium returns it: children before their parent, the
  // document last. Shadow roots / content documents / pseudo-elements are
  // nested stubs on their owner; their children name them by parentId.
  const el = (
    nodeId: number,
    parentId: number | undefined,
    nodeName: string,
  ) => ({
    nodeId,
    ...(parentId === undefined ? {} : { parentId }),
    backendNodeId: nodeId,
    nodeType: nodeName.startsWith("#") ? 9 : 1,
    nodeName,
    children: [],
  });

  it("rebuilds a 1000-level chain with no recursion and keeps sibling order", () => {
    const depth = 1000;
    const flat = [];
    // ids: 1 = document, 2 = html, 3.. = chain of divs, then two siblings.
    for (let i = 0; i < 2; i++)
      flat.push(el(depth + 10 + i, depth + 2, i ? "A" : "B"));
    for (let id = depth + 2; id >= 3; id--) flat.push(el(id, id - 1, "DIV"));
    flat.push(el(2, 1, "HTML"), el(1, undefined, "#document"));
    const root = nestFlatDocument(flat);
    expect(root.nodeName).toBe("#document");
    let cur = root.children![0]; // html
    let levels = 0;
    while (cur.children?.[0]?.nodeName === "DIV") {
      cur = cur.children[0];
      levels++;
    }
    expect(levels).toBe(depth);
    expect(cur.children!.map((c) => c.nodeName)).toEqual(["B", "A"]);
  });

  it("attaches children to shadow-root, frame and pseudo stubs", () => {
    const shadow = {
      ...el(20, undefined, "#document-fragment"),
      shadowRootType: "user-agent",
    };
    const frameDoc = el(30, undefined, "#document");
    const host = { ...el(10, 2, "INPUT"), shadowRoots: [shadow] };
    const frame = { ...el(11, 2, "IFRAME"), contentDocument: frameDoc };
    const flat = [
      el(21, 20, "DIV"),
      host,
      el(31, 30, "HTML"),
      frame,
      el(2, 1, "HTML"),
      el(1, undefined, "#document"),
    ];
    const root = nestFlatDocument(flat);
    const html = root.children![0];
    expect(html.children!.map((c) => c.nodeName)).toEqual(["INPUT", "IFRAME"]);
    expect(html.children![0].shadowRoots![0].children![0].nodeName).toBe("DIV");
    expect(html.children![1].contentDocument!.children![0].nodeName).toBe(
      "HTML",
    );
  });

  it("throws on a payload with no root so the caller can fall back", () => {
    expect(() => nestFlatDocument([])).toThrow();
  });
});
