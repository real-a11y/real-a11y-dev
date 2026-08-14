/**
 * Two different questions, deliberately kept apart.
 *
 * `uaSuppliedAttrs` answers "does the USER AGENT supply this state?" and
 * governs required attributes. `implicitRole` answers "did the role come from
 * the element?" and governs structure. Keying both on the `role=` attribute —
 * the first attempt — was wrong: `<input type="checkbox" role="switch">` is the
 * ARIA-APG canonical switch, with an authored, non-redundant role AND
 * UA-supplied checkedness at the same time.
 *
 * `aria-query` genuinely requires `aria-checked` on checkbox, `aria-expanded` +
 * `aria-controls` on combobox and `aria-selected` on option — right for an
 * authored role where nothing else supplies them, wrong for a native control.
 * Found running the published package from npm (scenario R34).
 */
import { describe, it, expect } from "vitest";

import { validateNode, validateTree, type ValidatedNode } from "./validate.js";

function node(
  partial: Partial<ValidatedNode> & { id: string; role: string },
): ValidatedNode {
  return { parentId: null, name: "", attrs: {}, ...partial };
}

function mapOf(...nodes: ValidatedNode[]): Map<string, ValidatedNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

function errorsFor(n: ValidatedNode, nodes = mapOf(n)): string[] {
  return validateNode(n, nodes)
    .filter((i) => i.severity === "error")
    .map((i) => i.message);
}

describe("required attributes follow the USER AGENT, not the role attribute", () => {
  const CASES: Array<[string, string, string]> = [
    ["checkbox", "aria-checked", "an <input type=checkbox>"],
    ["radio", "aria-checked", "an <input type=radio>"],
    ["option", "aria-selected", "an <option>"],
    ["combobox", "aria-expanded", "a <select>"],
    ["slider", "aria-valuenow", "an <input type=range>"],
  ];

  for (const [role, attr, native] of CASES) {
    it(`${native} is not asked for ${attr}`, () => {
      const n = node({
        id: "n",
        role,
        name: "Label",
        uaSuppliedAttrs: [attr],
      });
      expect(errorsFor(n)).not.toContain(`missing required ${attr}`);
    });

    it(`a hand-built role="${role}" still is`, () => {
      const n = node({ id: "n", role, name: "Label" });
      expect(errorsFor(n)).toContain(`missing required ${attr}`);
    });
  }

  it("an authored role on a native control is still exempt — role=switch", () => {
    // The case the attribute-based check could not express: ARIA-APG's
    // canonical switch. The role is authored and NOT redundant, so it cannot
    // be deleted — and the browser still supplies checkedness.
    const unchecked = node({
      id: "n",
      role: "switch",
      name: "Weekends",
      uaSuppliedAttrs: ["aria-checked"],
    });
    expect(errorsFor(unchecked)).toEqual([]);
  });

  it("an element can supply one state and still owe another", () => {
    // Per-attribute, not a single boolean: a native <select> supplies expanded
    // and controls, but an author who writes role="combobox" on a <div> owes
    // both. Here only one is supplied.
    const n = node({
      id: "n",
      role: "combobox",
      name: "Status",
      uaSuppliedAttrs: ["aria-expanded"],
    });
    expect(errorsFor(n)).toContain("missing required aria-controls");
    expect(errorsFor(n)).not.toContain("missing required aria-expanded");
  });

  it("absent uaSuppliedAttrs fails CLOSED", () => {
    // An adapter that cannot inspect the element must keep reporting, not
    // silently disable the rule.
    const n = node({ id: "n", role: "checkbox", name: "Ship it" });
    expect(errorsFor(n)).toContain("missing required aria-checked");
  });

  it("a supplied attribute the role does not require changes nothing", () => {
    const n = node({
      id: "n",
      role: "checkbox",
      name: "W",
      uaSuppliedAttrs: ["aria-valuenow"],
    });
    expect(errorsFor(n)).toContain("missing required aria-checked");
  });

  it("a name is still required either way — that one is nobody's freebie", () => {
    const native = node({
      id: "n",
      role: "combobox",
      uaSuppliedAttrs: ["aria-expanded", "aria-controls"],
    });
    expect(errorsFor(native)).toContain(
      'role "combobox" requires an accessible name',
    );
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

  it("a REDUNDANT authored role is still native structure", () => {
    // `<select role="combobox">` — the adapter resolves this to implicit,
    // because nothing about the user agent changed. Design systems spread
    // `role` through props and hit this by construction.
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

  it("a hand-built combobox owning a hand-built option still is", () => {
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
    // Both native, but not required structure — a real bug the exemption must
    // not swallow, which is why it is a named pair list.
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
    expect(nestingErrors(nodes)).toContain(
      'interactive "link" is nested inside "button" — nested controls aren\'t operable by assistive tech',
    );
  });
});

describe("a present `false` is present, not missing", () => {
  // Pinned here, where the rule lives. The predicate used to count `false` as
  // absent, so `aria-expanded="false"` — a collapsed combobox, the ordinary
  // state — was unsatisfiable. This file hand-builds `attrs`, so it can hold
  // the boolean the real adapter emits; the downstream matcher test cannot.
  it("an explicit false satisfies a required attribute", () => {
    const n = node({
      id: "n",
      role: "checkbox",
      name: "Weekends",
      attrs: { "aria-checked": false },
      uaSuppliedAttrs: [],
    });
    expect(errorsFor(n)).toEqual([]);
  });

  it("an empty string is still missing", () => {
    const n = node({
      id: "n",
      role: "checkbox",
      name: "Weekends",
      attrs: { "aria-checked": "" },
      uaSuppliedAttrs: [],
    });
    expect(errorsFor(n)).toContain("missing required aria-checked");
  });
});

describe("engine vocabulary is not an invalid ARIA role", () => {
  // `<video controls>` extracts as `video`, which is not an ARIA role. Only an
  // AUTHORED role can be invalid; reporting the element's own vocabulary told
  // the user their browser was broken, and it returned early so no other rule
  // ran on the node either.
  it("an implicit non-ARIA role is not reported", () => {
    const n = node({
      id: "n",
      role: "video",
      name: "Clip",
      implicitRole: true,
    });
    expect(errorsFor(n)).toEqual([]);
  });

  it("an authored one still is", () => {
    const n = node({ id: "n", role: "combobocks", name: "x" });
    expect(errorsFor(n)).toContain('"combobocks" is not a valid ARIA role');
  });
});

describe("an exempt native pair does not end the ancestor walk", () => {
  it("the option is still judged against the button above its select", () => {
    // `<div role="button"><label><select><option>` — the option's nesting in
    // the select is legitimate, its nesting in the button is not, and nothing
    // would ever test the button if the exempt rung stopped the climb.
    const nodes = mapOf(
      node({ id: "btn", role: "button", name: "Wrap" }),
      node({
        id: "sel",
        role: "combobox",
        name: "Status",
        parentId: "btn",
        implicitRole: true,
      }),
      node({
        id: "opt",
        role: "option",
        name: "Open",
        parentId: "sel",
        implicitRole: true,
      }),
    );
    const byNode = validateTree(nodes);
    const optIssues = (byNode.get("opt") ?? []).map((i) => i.message);
    expect(optIssues).toContain(
      'interactive "option" is nested inside "button" — nested controls aren\'t operable by assistive tech',
    );
  });
});
