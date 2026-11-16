import { describe, expect, it } from "vitest";

import { domLabels, type LabelDomNode } from "./labels.js";

let next = 1;
/** An element with backend id `id`, as CDP's `DOM.Node` has it. */
function el(
  id: number,
  localName: string,
  attributes: Record<string, string> = {},
  children: LabelDomNode[] = [],
  extra: Partial<LabelDomNode> = {},
): LabelDomNode {
  return {
    backendNodeId: id,
    nodeType: 1,
    localName,
    nodeName: localName.toUpperCase(),
    attributes: Object.entries(attributes).flat(),
    children,
    ...extra,
  };
}
const text = (): LabelDomNode => ({
  backendNodeId: 1000 + next++,
  nodeType: 3,
});
const doc = (...children: LabelDomNode[]): LabelDomNode => ({
  backendNodeId: 0,
  nodeType: 9,
  nodeName: "#document",
  children,
});

describe("domLabels", () => {
  it("labels the control a <label for> names, and the one a <label> wraps", () => {
    const labels = domLabels(
      doc(
        el(1, "label", { for: "c" }, [text()]),
        el(2, "input", { type: "checkbox", id: "c" }),
        el(3, "label", {}, [text(), el(4, "input"), el(5, "input")]),
      ),
    );
    expect(labels(2)).toEqual([1]);
    // A wrapping label labels its FIRST labelable descendant only.
    expect(labels(4)).toEqual([3]);
    expect(labels(5)).toEqual([]);
    // An element the walk never met: nothing says what labels it.
    expect(labels(999)).toBeUndefined();
  });

  it("gathers every label of a control, in the order read", () => {
    const labels = domLabels(
      doc(
        el(1, "label", { for: "c" }),
        el(2, "label", {}, [el(3, "select", { id: "c" })]),
        el(4, "label", { for: "c" }),
      ),
    );
    expect(labels(3)).toEqual([2, 1, 4]);
  });

  it("names the first element with the id, labelable or not, and never wraps with a for", () => {
    const labels = domLabels(
      doc(
        el(1, "label", { for: "x" }, [el(2, "input")]),
        el(3, "span", { id: "x" }),
        el(4, "input", { id: "x" }),
      ),
    );
    expect(labels(3)).toEqual([1]);
    expect(labels(4)).toEqual([]);
    expect(labels(2)).toEqual([]);
  });

  it("skips what isn't labelable, and keeps looking past a custom element", () => {
    const labels = domLabels(
      doc(
        el(1, "label", {}, [
          el(2, "input", { type: "HIDDEN" }),
          el(3, "span"),
          el(4, "x-toggle"),
          el(5, "meter"),
          el(6, "textarea"),
        ]),
      ),
    );
    expect(labels(2)).toEqual([]);
    expect(labels(3)).toEqual([]);
    expect(labels(4)).toEqual([1]);
    expect(labels(5)).toEqual([1]);
    expect(labels(6)).toEqual([]);
  });

  it("leaves out a control whose aria-label has text, which Chromium reads first", () => {
    const labels = domLabels(
      doc(
        el(1, "label", { for: "a" }),
        el(2, "input", { id: "a", "aria-label": "Agree" }),
        el(3, "label", { for: "b" }),
        el(4, "input", { id: "b", "aria-label": " \n" }),
        el(5, "label", { for: "c" }),
        el(6, "input", { id: "c", "aria-labelledby": "x" }),
      ),
    );
    expect(labels(2)).toEqual([]);
    expect(labels(4)).toEqual([3]);
    expect(labels(6)).toEqual([5]);
  });

  it("resolves each label in its own tree: a shadow root, a frame's document", () => {
    const shadow: LabelDomNode = {
      backendNodeId: 20,
      nodeType: 11,
      shadowRootType: "open",
      children: [el(21, "label", { for: "c" }), el(22, "input", { id: "c" })],
    };
    const frame: LabelDomNode = {
      backendNodeId: 30,
      nodeType: 9,
      children: [el(31, "label", {}, [el(32, "input", { id: "c" })])],
    };
    const labels = domLabels(
      doc(
        el(1, "label", { for: "c" }),
        el(2, "input", { id: "c" }),
        // A wrapping label's search stays in its own tree.
        el(3, "label", {}, [
          el(4, "x-host", {}, [], { shadowRoots: [shadow] }),
        ]),
        el(5, "iframe", {}, [], { contentDocument: frame }),
      ),
    );
    expect(labels(2)).toEqual([1]);
    expect(labels(22)).toEqual([21]);
    expect(labels(32)).toEqual([31]);
    expect(labels(4)).toEqual([3]);
  });

  it("reads no label from a form control's own internals", () => {
    const internals: LabelDomNode = {
      backendNodeId: 10,
      nodeType: 11,
      shadowRootType: "user-agent",
      children: [el(11, "label", { for: "c" })],
    };
    const labels = domLabels(
      doc(el(2, "input", { id: "c" }, [], { shadowRoots: [internals] })),
    );
    // The page's input has none; the label in its internals was never met.
    expect(labels(2)).toEqual([]);
    expect(labels(11)).toBeUndefined();
  });

  it("reads a document nested deeper than a call stack would", () => {
    let inner = el(2, "input");
    for (let i = 0; i < 20_000; i++) inner = el(100 + i, "div", {}, [inner]);
    const labels = domLabels(doc(el(1, "label", {}, [inner])));
    expect(labels(2)).toEqual([1]);
  });
});
