import type { SemanticNode, TreeDiff } from "@real-a11y-dev/core";
import { describe, it, expect } from "vitest";

import { checkChangeSpec } from "./change-spec.js";

function mk(
  role: string,
  name = "",
  changes?: Partial<SemanticNode>,
): SemanticNode {
  return {
    id: "sn-1",
    parentId: null,
    childIds: [],
    depth: 0,
    dom: {
      tagName: "div",
      attributes: {},
      textContent: null,
      descendantText: "",
      isHidden: false,
    },
    a11y: {
      role,
      name,
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
    interaction: {
      isInteractive: false,
      actions: [],
      isFocusable: false,
      isEditable: false,
    },
    ui: {
      expanded: false,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
    ...changes,
  };
}

const diff: TreeDiff = {
  added: [mk("option", "Spain"), mk("option", "France")],
  removed: [mk("listitem", "Old")],
  changed: [
    {
      id: "sn-c",
      before: mk("combobox", "Country"),
      after: mk("combobox", "Country"),
      changes: ["a11y.states.expanded", "a11y.name"],
    },
  ],
};

describe("checkChangeSpec", () => {
  it("passes a subset match by role + name", () => {
    expect(
      checkChangeSpec(diff, {
        added: [{ role: "option", name: "Spain" }],
        changed: [{ role: "combobox", changes: ["a11y.states.expanded"] }],
      }),
    ).toEqual([]);
  });

  it("matches names case-insensitively and by RegExp", () => {
    expect(
      checkChangeSpec(diff, { added: [{ role: "option", name: "spain" }] }),
    ).toEqual([]);
    expect(
      checkChangeSpec(diff, { added: [{ role: "option", name: /^Fr/ }] }),
    ).toEqual([]);
  });

  it("reports a missing added matcher", () => {
    const problems = checkChangeSpec(diff, {
      added: [{ role: "option", name: "Germany" }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/expected an ADDED option "Germany"/);
  });

  it("requires every listed change path to be present on the matched node", () => {
    expect(
      checkChangeSpec(diff, {
        changed: [
          { role: "combobox", changes: ["a11y.states.expanded", "a11y.name"] },
        ],
      }),
    ).toEqual([]);
    // A path the node didn't change → no match.
    const problems = checkChangeSpec(diff, {
      changed: [{ role: "combobox", changes: ["a11y.states.checked"] }],
    });
    expect(problems[0]).toMatch(/changing a11y\.states\.checked/);
  });

  it("subset (default) tolerates extras; exact forbids them", () => {
    // Only asserts Spain — France is an extra, fine by default.
    expect(
      checkChangeSpec(diff, { added: [{ role: "option", name: "Spain" }] }),
    ).toEqual([]);
    // exact: France + the removed listitem + the changed combobox are extras.
    const problems = checkChangeSpec(diff, {
      added: [{ role: "option", name: "Spain" }],
      exact: true,
    });
    expect(problems).toContain('unexpected ADDED option "France"');
    expect(problems).toContain('unexpected REMOVED listitem "Old"');
    expect(
      problems.some((p) => p.startsWith("unexpected CHANGED combobox")),
    ).toBe(true);
  });

  it("greedy 1:1 — two matchers need two distinct nodes", () => {
    expect(
      checkChangeSpec(diff, {
        added: [
          { role: "option", name: "Spain" },
          { role: "option", name: "France" },
        ],
        exact: false,
      }),
    ).toEqual([]);
    // Two matchers for the same single node can't both match.
    const oneOption: TreeDiff = {
      added: [mk("option", "Spain")],
      removed: [],
      changed: [],
    };
    expect(
      checkChangeSpec(oneOption, {
        added: [
          { role: "option", name: "Spain" },
          { role: "option", name: "Spain" },
        ],
      }),
    ).toHaveLength(1);
  });

  it("an empty spec passes any diff (subset of nothing)", () => {
    expect(checkChangeSpec(diff, {})).toEqual([]);
  });

  it("exact ignores a childIds-only change (the structural shadow of an add/remove)", () => {
    const withChildIds: TreeDiff = {
      added: [mk("option", "Spain")],
      removed: [],
      changed: [
        {
          id: "sn-list",
          before: mk("list"),
          after: mk("list"),
          changes: ["childIds"],
        },
      ],
    };
    // exact:true asserts only the added option — the list's childIds churn is
    // not flagged as an unexpected extra.
    expect(
      checkChangeSpec(withChildIds, {
        added: [{ role: "option", name: "Spain" }],
        exact: true,
      }),
    ).toEqual([]);
    // …but a change that ALSO touches another field is still a real extra.
    const alsoExpanded: TreeDiff = {
      added: [],
      removed: [],
      changed: [
        {
          id: "sn-c",
          before: mk("combobox"),
          after: mk("combobox"),
          changes: ["childIds", "a11y.states.expanded"],
        },
      ],
    };
    expect(
      checkChangeSpec(alsoExpanded, { exact: true }).some((p) =>
        p.startsWith("unexpected CHANGED combobox"),
      ),
    ).toBe(true);
  });
});
