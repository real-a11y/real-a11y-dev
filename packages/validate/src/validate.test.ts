import { describe, it, expect } from "vitest";

import {
  isValidRole,
  isPresentationalChildren,
  requiredOwnedRoles,
  suggestedChildRoles,
} from "./aria-schema.js";
import { validateNode, validateTree, type ValidatedNode } from "./validate.js";

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

// ─── APG pattern battery ─────────────────────────────────────────────────────
// Correct patterns must produce no errors (a linter that flags valid structure
// is worse than none); common mistakes must produce the right error/warning.

interface Issue {
  role: string;
  severity: "error" | "warn";
  message: string;
}
function issuesOf(map: Map<string, ValidatedNode>): Issue[] {
  const out: Issue[] = [];
  for (const node of map.values())
    for (const i of validateNode(node, map))
      out.push({ role: node.role, ...i });
  for (const [id, list] of validateTree(map)) {
    const node = map.get(id)!;
    for (const i of list) out.push({ role: node.role, ...i });
  }
  return out;
}
const errorsOf = (map: Map<string, ValidatedNode>) =>
  issuesOf(map).filter((i) => i.severity === "error");

const VALID_PATTERNS: Array<[string, NodeSpec[]]> = [
  [
    "tabs",
    [
      {
        role: "tablist",
        name: "Sections",
        children: [
          { role: "tab", name: "Overview", attrs: { "aria-selected": "true" } },
          { role: "tab", name: "Details", attrs: { "aria-selected": "false" } },
        ],
      },
      { role: "tabpanel", name: "Overview" },
      { role: "tabpanel", name: "Details" },
    ],
  ],
  [
    "listbox",
    [
      {
        role: "listbox",
        name: "Choose one",
        children: [
          { role: "option", name: "Apple", attrs: { "aria-selected": "true" } },
          {
            role: "option",
            name: "Banana",
            attrs: { "aria-selected": "false" },
          },
        ],
      },
    ],
  ],
  [
    "menu",
    [
      {
        role: "menu",
        name: "Actions",
        children: [
          { role: "menuitem", name: "Edit" },
          { role: "menuitem", name: "Delete" },
        ],
      },
    ],
  ],
  [
    "menubar",
    [
      {
        role: "menubar",
        name: "Main",
        children: [
          {
            role: "menuitem",
            name: "File",
            attrs: { "aria-haspopup": "menu" },
          },
          {
            role: "menuitem",
            name: "Edit",
            attrs: { "aria-haspopup": "menu" },
          },
        ],
      },
    ],
  ],
  [
    "radiogroup",
    [
      {
        role: "radiogroup",
        name: "Choose one",
        children: [
          { role: "radio", name: "Yes", attrs: { "aria-checked": "true" } },
          { role: "radio", name: "No", attrs: { "aria-checked": "false" } },
        ],
      },
    ],
  ],
  [
    "table",
    [
      {
        role: "table",
        name: "Users",
        children: [
          {
            role: "row",
            children: [
              { role: "columnheader", name: "Name" },
              { role: "columnheader", name: "Role" },
            ],
          },
          {
            role: "row",
            children: [
              { role: "cell", name: "Ada" },
              { role: "cell", name: "Admin" },
            ],
          },
        ],
      },
    ],
  ],
  [
    "grid",
    [
      {
        role: "grid",
        name: "Data",
        children: [
          {
            role: "row",
            children: [
              { role: "columnheader", name: "Item" },
              { role: "gridcell", name: "Widget" },
            ],
          },
        ],
      },
    ],
  ],
  [
    "tree",
    [
      {
        role: "tree",
        name: "Files",
        children: [
          {
            role: "treeitem",
            name: "src",
            attrs: { "aria-expanded": "true", "aria-selected": "false" },
            children: [
              {
                role: "group",
                children: [
                  {
                    role: "treeitem",
                    name: "index.ts",
                    attrs: { "aria-selected": "false" },
                  },
                ],
              },
            ],
          },
          {
            role: "treeitem",
            name: "README.md",
            attrs: { "aria-selected": "false" },
          },
        ],
      },
    ],
  ],
  [
    "accordion",
    [
      {
        role: "heading",
        name: "Section 1",
        attrs: { "aria-level": "3" },
        children: [
          {
            role: "button",
            name: "Section 1",
            attrs: { "aria-expanded": "true" },
          },
        ],
      },
      { role: "region", name: "Section 1", children: [{ role: "paragraph" }] },
    ],
  ],
  [
    "disclosure",
    [
      {
        role: "button",
        name: "Show details",
        attrs: { "aria-expanded": "false" },
      },
      { role: "region", name: "Details", children: [{ role: "paragraph" }] },
    ],
  ],
  [
    "breadcrumb",
    [
      {
        role: "navigation",
        name: "Breadcrumb",
        children: [
          {
            role: "list",
            children: [
              { role: "listitem", children: [{ role: "link", name: "Home" }] },
              {
                role: "listitem",
                children: [
                  {
                    role: "link",
                    name: "Current",
                    attrs: { "aria-current": "page" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  ],
  [
    "toolbar",
    [
      {
        role: "toolbar",
        name: "Formatting",
        children: [
          { role: "button", name: "Bold" },
          { role: "button", name: "Italic" },
        ],
      },
    ],
  ],
  [
    "feed",
    [
      {
        role: "feed",
        name: "Posts",
        children: [
          { role: "article", name: "Post 1" },
          { role: "article", name: "Post 2" },
        ],
      },
    ],
  ],
  [
    "dialog",
    [
      {
        role: "dialog",
        name: "Confirm",
        attrs: { "aria-modal": "true" },
        children: [
          { role: "heading", name: "Confirm", attrs: { "aria-level": "2" } },
          { role: "button", name: "Cancel" },
          { role: "button", name: "OK" },
        ],
      },
    ],
  ],
];

describe("valid APG patterns produce no errors", () => {
  it.each(VALID_PATTERNS)("%s", (_name, specs) => {
    expect(errorsOf(buildMap(specs))).toEqual([]);
  });
});

const BROKEN_ERRORS: Array<[string, NodeSpec[], RegExp]> = [
  [
    "a link nested inside a button",
    [
      {
        role: "button",
        name: "Save",
        children: [{ role: "link", name: "Docs" }],
      },
    ],
    /nested inside/,
  ],
  [
    "a button nested inside a link",
    [
      {
        role: "link",
        name: "Home",
        children: [{ role: "button", name: "Menu" }],
      },
    ],
    /nested inside/,
  ],
  [
    "a table inside a button",
    [
      {
        role: "button",
        name: "Open",
        children: [
          { role: "table", name: "Data", children: [{ role: "row" }] },
        ],
      },
    ],
    /presentational/,
  ],
  [
    "a checkbox missing aria-checked",
    [{ role: "checkbox", name: "Agree" }],
    /missing required aria-checked/,
  ],
  ["an unnamed button", [{ role: "button" }], /requires an accessible name/],
  [
    "an unknown role",
    [{ role: "buttn", name: "Save" }],
    /not a valid ARIA role/,
  ],
];

describe("common mistakes are caught as errors", () => {
  it.each(BROKEN_ERRORS)("%s", (_name, specs, pattern) => {
    const errs = errorsOf(buildMap(specs));
    expect(errs.some((e) => pattern.test(e.message))).toBe(true);
  });
});

const STRUCTURAL_WARNINGS: Array<[string, NodeSpec[], RegExp]> = [
  [
    "a tab outside a tablist",
    [{ role: "main", children: [{ role: "tab", name: "One" }] }],
    /should be inside/,
  ],
  [
    "a treeitem outside a tree",
    [
      {
        role: "main",
        children: [
          {
            role: "treeitem",
            name: "One",
            attrs: { "aria-selected": "false" },
          },
        ],
      },
    ],
    /should be inside/,
  ],
  ["an empty tablist", [{ role: "tablist", name: "Empty" }], /should contain/],
  ["an empty list", [{ role: "list" }], /should contain/],
];

describe("structural gaps are flagged as warnings", () => {
  it.each(STRUCTURAL_WARNINGS)("%s", (_name, specs, pattern) => {
    const warns = issuesOf(buildMap(specs)).filter(
      (i) => i.severity === "warn",
    );
    expect(warns.some((w) => pattern.test(w.message))).toBe(true);
  });
});
