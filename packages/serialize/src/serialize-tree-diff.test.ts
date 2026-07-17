import { diffTrees } from "@real-a11y-dev/core";
import { describe, it, expect, afterEach } from "vitest";

import {
  extract,
  serializeTreeDiff,
  type SemanticNode,
  type TreeDiff,
} from "./index.js";

/** A complete SemanticNode with test-relevant fields overridable. */
function mk(
  role: string,
  extra: {
    id?: string;
    name?: string;
    childIds?: string[];
    states?: Record<string, string | boolean>;
    properties?: Record<string, string>;
    textContent?: string | null;
    level?: string;
  } = {},
): SemanticNode {
  return {
    id: extra.id ?? "sn-1",
    parentId: null,
    childIds: extra.childIds ?? [],
    depth: 0,
    dom: {
      tagName: "div",
      attributes: {},
      textContent: extra.textContent ?? null,
      descendantText: "",
      isHidden: false,
    },
    a11y: {
      role,
      name: extra.name ?? "",
      description: "",
      states: extra.states ?? {},
      properties: {
        ...(extra.level ? { level: extra.level } : {}),
        ...extra.properties,
      },
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
  };
}

const empty: TreeDiff = { added: [], removed: [], changed: [] };

describe("serializeTreeDiff", () => {
  it("renders added, removed, and changed sections in order", () => {
    const before = mk("combobox", {
      id: "sn-c",
      name: "Country",
      states: { expanded: false },
    });
    const after = mk("combobox", {
      id: "sn-c",
      name: "Country",
      states: { expanded: true },
    });
    const diff: TreeDiff = {
      added: [mk("option", { id: "sn-1", name: "Spain" })],
      removed: [mk("listitem", { id: "sn-2", name: "Old entry" })],
      changed: [
        { id: "sn-c", before, after, changes: ["a11y.states.expanded"] },
      ],
    };
    expect(serializeTreeDiff(diff)).toBe(
      [
        '+ option "Spain"',
        '- listitem "Old entry"',
        '~ combobox "Country": a11y.states.expanded false → true',
      ].join("\n"),
    );
  });

  it("renders a childIds change as counts, never ids", () => {
    const before = mk("main", {
      id: "sn-m",
      name: "Results",
      childIds: ["sn-1", "sn-2", "sn-3"],
    });
    const after = mk("main", {
      id: "sn-m",
      name: "Results",
      childIds: ["sn-1", "sn-2", "sn-3", "sn-4", "sn-5"],
    });
    const out = serializeTreeDiff({
      ...empty,
      changed: [{ id: "sn-m", before, after, changes: ["childIds"] }],
    });
    expect(out).toBe('~ main "Results": childIds 3 children → 5 children');
    expect(out).not.toContain("sn-");
  });

  it("singularizes a one-child count", () => {
    const before = mk("list", { id: "sn-l", childIds: [] });
    const after = mk("list", { id: "sn-l", childIds: ["sn-1"] });
    expect(
      serializeTreeDiff({
        ...empty,
        changed: [{ id: "sn-l", before, after, changes: ["childIds"] }],
      }),
    ).toBe("~ list: childIds 0 children → 1 child");
  });

  it("renders a field present on only one side as (unset)", () => {
    const before = mk("checkbox", { id: "sn-x", name: "Agree", states: {} });
    const after = mk("checkbox", {
      id: "sn-x",
      name: "Agree",
      states: { checked: true },
    });
    expect(
      serializeTreeDiff({
        ...empty,
        changed: [
          { id: "sn-x", before, after, changes: ["a11y.states.checked"] },
        ],
      }),
    ).toBe('~ checkbox "Agree": a11y.states.checked (unset) → true');
  });

  it("emits one line per changed field, labeling with the after-state", () => {
    const before = mk("heading", { id: "sn-h", name: "Intro", level: "2" });
    const after = mk("heading", {
      id: "sn-h",
      name: "Introduction",
      level: "3",
    });
    expect(
      serializeTreeDiff({
        ...empty,
        changed: [
          {
            id: "sn-h",
            before,
            after,
            changes: ["a11y.name", "a11y.properties.level"],
          },
        ],
      }),
    ).toBe(
      [
        '~ heading "Introduction" (level 3): a11y.name "Intro" → "Introduction"',
        '~ heading "Introduction" (level 3): a11y.properties.level "2" → "3"',
      ].join("\n"),
    );
  });

  it("renders (no changes) for an empty diff", () => {
    expect(serializeTreeDiff(empty)).toBe("(no changes)");
  });

  describe("focus transition", () => {
    const btn = mk("button", { id: "sn-b", name: "Open" });
    const dialog = mk("dialog", { id: "sn-d", name: "Settings" });

    it("renders when the focused node changed", () => {
      expect(
        serializeTreeDiff(empty, { focusBefore: btn, focusAfter: dialog }),
      ).toBe('focus: button "Open" → dialog "Settings"');
    });

    it("shows (none) for a focus-lost transition — the bug is visible", () => {
      expect(
        serializeTreeDiff(empty, { focusBefore: btn, focusAfter: null }),
      ).toBe('focus: button "Open" → (none)');
    });

    it("shows (none) on the before side when focus appeared", () => {
      expect(
        serializeTreeDiff(empty, { focusBefore: null, focusAfter: dialog }),
      ).toBe('focus: (none) → dialog "Settings"');
    });

    it("omits the line when focus did not move (same node)", () => {
      expect(
        serializeTreeDiff(empty, { focusBefore: btn, focusAfter: btn }),
      ).toBe("(no changes)");
    });

    it("appends after the change sections", () => {
      const out = serializeTreeDiff(
        { ...empty, added: [mk("option", { id: "sn-o", name: "Spain" })] },
        { focusBefore: btn, focusAfter: dialog },
      );
      expect(out).toBe(
        '+ option "Spain"\nfocus: button "Open" → dialog "Settings"',
      );
    });
  });

  it("redacts names and string change values", () => {
    const before = mk("textbox", {
      id: "sn-t",
      name: "Email",
      textContent: "old@x.com",
    });
    const after = mk("textbox", {
      id: "sn-t",
      name: "Email",
      textContent: "new@x.com",
    });
    const out = serializeTreeDiff(
      {
        added: [mk("status", { id: "sn-s", name: "Saved 2 minutes ago" })],
        removed: [],
        changed: [{ id: "sn-t", before, after, changes: ["dom.textContent"] }],
      },
      { redact: [/\S+@\S+/, /\d+ minutes ago/] },
    );
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("@x.com");
    expect(out).not.toContain("2 minutes ago");
  });

  it("never emits a node id (sn-) across any section", () => {
    const before = mk("list", { id: "sn-99", name: "Nav", childIds: ["sn-1"] });
    const after = mk("list", {
      id: "sn-99",
      name: "Nav",
      childIds: ["sn-1", "sn-2"],
    });
    const out = serializeTreeDiff({
      added: [mk("link", { id: "sn-2", name: "Home" })],
      removed: [mk("link", { id: "sn-3", name: "Gone" })],
      changed: [{ id: "sn-99", before, after, changes: ["childIds"] }],
    });
    expect(out).not.toMatch(/sn-/);
  });
});

describe("serializeTreeDiff — end to end with real extraction", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("diffs a real interaction: a listbox gains an option and a control expands", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div role="region" aria-label="Picker">
        <button aria-expanded="false">Country</button>
        <ul role="listbox"><li role="option">Spain</li></ul>
      </div>`;
    document.body.appendChild(root);

    const before = extract(root);
    root.querySelector("button")!.setAttribute("aria-expanded", "true");
    root
      .querySelector("ul")!
      .insertAdjacentHTML("beforeend", '<li role="option">France</li>');
    const after = extract(root);

    const out = serializeTreeDiff(diffTrees(before, after));
    expect(out).toContain('+ option "France"');
    expect(out).toMatch(/~ button "Country": a11y\.states\.expanded/);
    // The pinned invariant: a committed diff never carries a node id.
    expect(out).not.toContain("sn-");
  });
});
