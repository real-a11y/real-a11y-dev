import { describe, expect, it } from "vitest";

import { domChoiceTargets, type DomChoiceNode } from "./dom-choice-targets.js";

let nextId = 1;

/** An element as `DOM.getDocument` describes it, with a fresh backend id. */
const el = (
  tag: string,
  attributes: Record<string, string> = {},
  children: DomChoiceNode[] = [],
  extra: Partial<DomChoiceNode> = {},
): DomChoiceNode => ({
  backendNodeId: nextId++,
  nodeType: 1,
  nodeName: tag.toUpperCase(),
  localName: tag,
  attributes: Object.entries(attributes).flat(),
  children,
  ...extra,
});

const doc = (...children: DomChoiceNode[]): DomChoiceNode => ({
  backendNodeId: nextId++,
  nodeType: 9,
  nodeName: "#document",
  children: [el("html", {}, [el("body", {}, children)])],
});

/** A listbox inside a `role="presentation"` wrapper with id `id`. */
const wrappedListbox = (id: string) => {
  const option = el("li", { role: "option", "aria-selected": "true" });
  const listbox = el("ul", { role: "listbox" }, [option]);
  const wrapper = el("div", { id, role: "presentation" }, [listbox]);
  return { wrapper, listbox, option };
};

describe("where the DOM says a sensitive field's choice is made", () => {
  it("is what a sensitive field names in aria-controls or aria-owns, whole", () => {
    for (const relation of ["aria-controls", "aria-owns"]) {
      const { wrapper, listbox, option } = wrappedListbox("p");
      const field = el("input", {
        autocomplete: "cc-number",
        [relation]: "other p",
      });
      expect(
        [...domChoiceTargets(doc(field, wrapper))].sort(),
        relation,
      ).toEqual([wrapper, listbox, option].map((n) => n.backendNodeId).sort());
    }
  });

  it("is nothing for an ordinary field, or a relation another attribute makes", () => {
    const { wrapper } = wrappedListbox("p");
    expect(
      domChoiceTargets(doc(el("input", { "aria-controls": "p" }), wrapper))
        .size,
    ).toBe(0);
    expect(
      domChoiceTargets(
        doc(
          el("input", { autocomplete: "cc-number", "aria-describedby": "p" }),
          wrapper,
        ),
      ).size,
    ).toBe(0);
  });

  it("is what a combobox around one names, its role read as the tree reads it", () => {
    for (const role of ["combobox", "x-combo combobox", "COMBOBOX"]) {
      const { wrapper, option } = wrappedListbox("p");
      const combobox = el("div", { role, "aria-controls": "p" }, [
        el("div", {}, [el("input", { type: "password" })]),
      ]);
      expect(
        domChoiceTargets(doc(combobox, wrapper)).has(option.backendNodeId!),
        role,
      ).toBe(true);
    }
    // A group around one is not a combobox, and a combobox's role is its
    // first recognized token.
    for (const role of ["group", "listbox combobox"]) {
      const { wrapper } = wrappedListbox("p");
      const around = el("div", { role, "aria-controls": "p" }, [
        el("input", { type: "password" }),
      ]);
      expect(domChoiceTargets(doc(around, wrapper)).size, role).toBe(0);
    }
  });

  it("counts a field slotted into a combobox in a shadow tree", () => {
    const { wrapper, option } = wrappedListbox("p");
    const slot = el("slot");
    const field = el("input", { autocomplete: "cc-exp-month" }, [], {
      assignedSlot: { backendNodeId: slot.backendNodeId! },
    });
    const shadow: DomChoiceNode = {
      backendNodeId: nextId++,
      nodeType: 11,
      nodeName: "#document-fragment",
      children: [
        el("div", { role: "combobox", "aria-controls": "p" }, [slot]),
        wrapper,
      ],
    };
    const host = el("x-field", {}, [field], { shadowRoots: [shadow] });
    expect(domChoiceTargets(doc(host)).has(option.backendNodeId!)).toBe(true);
  });

  it("resolves each id in the field's own tree scope", () => {
    const outside = wrappedListbox("p");
    const inside = wrappedListbox("p");
    const shadow: DomChoiceNode = {
      backendNodeId: nextId++,
      nodeType: 11,
      nodeName: "#document-fragment",
      children: [
        el("input", { autocomplete: "cc-number", "aria-controls": "p" }),
        inside.wrapper,
      ],
    };
    const targets = domChoiceTargets(
      doc(outside.wrapper, el("div", {}, [], { shadowRoots: [shadow] })),
    );
    expect(targets.has(inside.option.backendNodeId!)).toBe(true);
    expect(targets.has(outside.option.backendNodeId!)).toBe(false);
  });

  it("keeps a frame's fields to its own document", () => {
    const { wrapper, option } = wrappedListbox("p");
    const frame = el("iframe", {}, [], {
      contentDocument: doc(
        el("input", { autocomplete: "cc-number", "aria-controls": "p" }),
      ),
    });
    expect(
      domChoiceTargets(doc(frame, wrapper)).has(option.backendNodeId!),
    ).toBe(false);
  });
});
