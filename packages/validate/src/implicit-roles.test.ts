/**
 * Native semantics are not the author's obligation.
 *
 * `aria-query` genuinely requires `aria-checked` on checkbox, `aria-expanded`
 * + `aria-controls` on combobox, `aria-selected` on option — and that is right
 * for an AUTHORED role, where nothing else supplies them. Applied to a native
 * `<select>` or `<input type="checkbox">` it reported correct, preferable HTML
 * as broken. Found running the published package from npm (scenario R34).
 *
 * Every case here is paired: the same semantics native and hand-authored, with
 * opposite verdicts. That pairing is the point — a fix that silenced both would
 * pass a one-sided test while deleting the rule.
 */
import { describe, it, expect } from "vitest";

import { validateNode, validateTree, type ValidatedNode } from "./validate.js";

function node(
  partial: Partial<ValidatedNode> & { id: string; role: string },
): ValidatedNode {
  return {
    parentId: null,
    name: "",
    attrs: {},
    ...partial,
  };
}

function mapOf(...nodes: ValidatedNode[]): Map<string, ValidatedNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

function errorsFor(n: ValidatedNode, nodes = mapOf(n)): string[] {
  return validateNode(n, nodes)
    .filter((i) => i.severity === "error")
    .map((i) => i.message);
}

describe("required ARIA attributes are the author's obligation", () => {
  const CASES: Array<[string, string, string]> = [
    ["checkbox", "aria-checked", "an <input type=checkbox>"],
    ["radio", "aria-checked", "an <input type=radio>"],
    ["switch", "aria-checked", "a native switch"],
    ["option", "aria-selected", "an <option>"],
    ["combobox", "aria-expanded", "a <select>"],
  ];

  for (const [role, attr, native] of CASES) {
    it(`${native} is not asked for ${attr}`, () => {
      const n = node({ id: "n", role, name: "Label", implicitRole: true });
      expect(errorsFor(n)).not.toContain(`missing required ${attr}`);
    });

    it(`an authored role="${role}" still is`, () => {
      const n = node({ id: "n", role, name: "Label" });
      expect(errorsFor(n)).toContain(`missing required ${attr}`);
    });
  }

  it("an unchecked native checkbox is fine — absent is not the same as missing", () => {
    // The extractor records states sparsely, so an unchecked box carries no
    // `checked` at all. Under the old rule a CHECKED box passed and an
    // UNCHECKED one failed, which is exactly backwards from a user's view.
    const unchecked = node({
      id: "a",
      role: "checkbox",
      name: "Weekends",
      implicitRole: true,
    });
    const checked = node({
      id: "b",
      role: "checkbox",
      name: "Weekends",
      implicitRole: true,
      attrs: { "aria-checked": true },
    });
    expect(errorsFor(unchecked)).toEqual([]);
    expect(errorsFor(checked)).toEqual([]);
  });

  it("an authored role that DOES supply the attribute passes", () => {
    const n = node({
      id: "n",
      role: "checkbox",
      name: "Weekends",
      attrs: { "aria-checked": "false" },
    });
    expect(errorsFor(n)).toEqual([]);
  });

  it("a name is still required either way — that one is nobody's freebie", () => {
    const native = node({ id: "n", role: "combobox", implicitRole: true });
    const authored = node({ id: "n", role: "combobox" });
    expect(errorsFor(native)).toContain(
      'role "combobox" requires an accessible name',
    );
    expect(errorsFor(authored)).toContain(
      'role "combobox" requires an accessible name',
    );
  });

  it("an invalid role is still invalid, native or not", () => {
    const n = node({ id: "n", role: "combobocks", implicitRole: true });
    expect(errorsFor(n)).toContain('"combobocks" is not a valid ARIA role');
  });
});

describe("native nesting is structure, not a mistake", () => {
  function nestingErrors(nodes: Map<string, ValidatedNode>): string[] {
    return [...validateTree(nodes).values()]
      .flat()
      .filter((i) => i.severity === "error")
      .map((i) => i.message);
  }

  it("<select><option> is not a nested-control violation", () => {
    const nodes = mapOf(
      node({ id: "sel", role: "combobox", name: "Status", implicitRole: true }),
      node({
        id: "opt",
        role: "option",
        name: "Open",
        parentId: "sel",
        implicitRole: true,
      }),
    );
    expect(nestingErrors(nodes)).toEqual([]);
  });

  it("an authored combobox owning an authored option still is", () => {
    const nodes = mapOf(
      node({ id: "sel", role: "combobox", name: "Status" }),
      node({ id: "opt", role: "option", name: "Open", parentId: "sel" }),
    );
    expect(nestingErrors(nodes)).toContain(
      'interactive "option" is nested inside "combobox" — nested controls aren\'t operable by assistive tech',
    );
  });

  it("a mixed pair is still reported — one authored side is a choice", () => {
    const authoredChild = mapOf(
      node({ id: "sel", role: "combobox", name: "Status", implicitRole: true }),
      node({ id: "opt", role: "option", name: "Open", parentId: "sel" }),
    );
    expect(nestingErrors(authoredChild)).toHaveLength(1);

    const authoredParent = mapOf(
      node({ id: "sel", role: "combobox", name: "Status" }),
      node({
        id: "opt",
        role: "option",
        name: "Open",
        parentId: "sel",
        implicitRole: true,
      }),
    );
    expect(nestingErrors(authoredParent)).toHaveLength(1);
  });

  it("a genuinely broken native nesting is still caught (<button><a href>)", () => {
    // Both implicit, but this is not required structure — it is a real bug the
    // exemption must not swallow. Nesting a link inside a button is invalid
    // HTML too, so no correct document reaches this shape.
    const nodes = mapOf(
      node({ id: "btn", role: "button", name: "Save", implicitRole: true }),
      node({
        id: "lnk",
        role: "link",
        name: "Help",
        parentId: "btn",
        implicitRole: true,
      }),
    );
    // Two rules fire here, and both are right: the nesting itself, and
    // button's presentational children swallowing the link.
    expect(nestingErrors(nodes)).toContain(
      'interactive "link" is nested inside "button" — nested controls aren\'t operable by assistive tech',
    );
  });
});

describe("the builder's authored model is unchanged", () => {
  it("a node with no implicitRole field behaves exactly as before", () => {
    // The builder constructs authored roles by definition and never sets the
    // flag; absent must mean authored, or this change silently weakens it.
    const n = node({ id: "n", role: "checkbox", name: "Ship it" });
    expect(errorsFor(n)).toContain("missing required aria-checked");
  });
});
