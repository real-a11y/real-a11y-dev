import { describe, it, expect } from "vitest";

import { validateNode, validateTree, type ValidatedNode } from "./validate.js";
import {
  isValidRole,
  isPresentationalChildren,
  requiredOwnedRoles,
  suggestedChildRoles,
} from "./aria-schema.js";

interface NodeSpec {
  role: string;
  name?: string;
  attrs?: Record<string, string | boolean>;
  children?: NodeSpec[];
}

/** Build a `Map<id, ValidatedNode>` from a nested literal. */
function buildMap(specs: NodeSpec[]): Map<string, ValidatedNode> {
  const map = new Map<string, ValidatedNode>();
  let counter = 0;
  const walk = (spec: NodeSpec, parentId: string | null) => {
    const id = `n${counter++}`;
    map.set(id, {
      id,
      parentId,
      role: spec.role,
      name: spec.name ?? "",
      attrs: spec.attrs ?? {},
    });
    for (const child of spec.children ?? []) walk(child, id);
  };
  for (const s of specs) walk(s, null);
  return map;
}

const find = (map: Map<string, ValidatedNode>, role: string) =>
  [...map.values()].find((n) => n.role === role)!;

describe("validateNode", () => {
  it("flags an unknown role as an error", () => {
    const map = buildMap([{ role: "notarole" }]);
    const issues = validateNode(find(map, "notarole"), map);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toMatch(/not a valid ARIA role/);
  });

  it("flags a missing required attribute", () => {
    // checkbox requires aria-checked
    const map = buildMap([{ role: "checkbox", name: "Agree" }]);
    const issues = validateNode(find(map, "checkbox"), map);
    expect(
      issues.some((i) => /missing required aria-checked/.test(i.message)),
    ).toBe(true);
  });

  it("warns when a role is outside its required context", () => {
    // tab requires a tablist parent
    const map = buildMap([
      { role: "main", children: [{ role: "tab", name: "One" }] },
    ]);
    const issues = validateNode(find(map, "tab"), map);
    expect(
      issues.some(
        (i) => i.severity === "warn" && /should be inside/.test(i.message),
      ),
    ).toBe(true);
  });

  it("passes a well-formed node", () => {
    const map = buildMap([
      { role: "checkbox", name: "Agree", attrs: { "aria-checked": "false" } },
    ]);
    expect(validateNode(find(map, "checkbox"), map)).toEqual([]);
  });
});

describe("validateTree", () => {
  it("flags an interactive role nested inside another (link in button)", () => {
    const map = buildMap([
      {
        role: "button",
        name: "Save",
        children: [{ role: "link", name: "Docs" }],
      },
    ]);
    const issues = validateTree(map);
    const link = find(map, "link");
    expect(
      issues.get(link.id)?.some((i) => /nested inside/.test(i.message)),
    ).toBe(true);
  });

  it("flags composite content inside a presentational-children role", () => {
    const map = buildMap([
      {
        role: "button",
        name: "Open",
        children: [
          { role: "table", name: "Data", children: [{ role: "row" }] },
        ],
      },
    ]);
    const issues = validateTree(map);
    const btn = find(map, "button");
    expect(
      issues.get(btn.id)?.some((i) => /presentational/.test(i.message)),
    ).toBe(true);
  });

  it("warns when a required-owning container is empty", () => {
    const map = buildMap([{ role: "tablist", name: "Sections" }]);
    const issues = validateTree(map);
    const tablist = find(map, "tablist");
    expect(
      issues
        .get(tablist.id)
        ?.some(
          (i) => i.severity === "warn" && /should contain/.test(i.message),
        ),
    ).toBe(true);
  });

  it("returns nothing for a valid tree", () => {
    const map = buildMap([
      {
        role: "tablist",
        name: "Sections",
        children: [
          { role: "tab", name: "One", attrs: { "aria-selected": "true" } },
          { role: "tab", name: "Two", attrs: { "aria-selected": "false" } },
        ],
      },
    ]);
    expect(validateTree(map).size).toBe(0);
  });
});

describe("aria-schema", () => {
  it("recognizes concrete roles and rejects unknown ones", () => {
    expect(isValidRole("button")).toBe(true);
    expect(isValidRole("definitely-not-a-role")).toBe(false);
  });

  it("knows which roles have presentational children", () => {
    expect(isPresentationalChildren("button")).toBe(true);
    expect(isPresentationalChildren("main")).toBe(false);
  });

  it("resolves required-owned and suggested child roles from aria-query", () => {
    expect(requiredOwnedRoles("tablist")).toContain("tab");
    expect(requiredOwnedRoles("main")).toEqual([]);
    expect(suggestedChildRoles("tablist")).toContain("tab");
  });
});
