import { describe, expect, it } from "vitest";

import {
  compareThroughDialogs,
  type DialogRules,
} from "./tree-changes-dialogs.js";
import {
  diffTreeRows,
  isEmptyTreeChanges,
  NO_TREE_CHANGES,
  type FieldChange,
  type Tree,
} from "./tree-changes-diff.js";

/**
 * The diff of two reads of a tree, and the tree a read compares with while a
 * dialog stands in front of the page, over a tree that isn't Chrome's: the
 * rules, not the ids, say what differs and what lasts. The extension's
 * `native-tree-diff.test.ts` and `use-native-changes.test.tsx` take Chrome's
 * tree through both in full.
 */

/** A row of a tree a test writes: a role, a name, and its children. */
interface Row {
  role: string;
  name: string;
  childIds?: string[];
}

/** Rows compared by role and name; an id starting `tmp-` is named afresh by
 *  every read. */
const RULES: DialogRules<Row> = {
  compare(before, after) {
    const changes: FieldChange[] = [];
    if (before.role !== after.role) {
      changes.push({ field: "role", before: before.role, after: after.role });
    }
    if (before.name !== after.name) {
      changes.push({ field: "name", before: before.name, after: after.name });
    }
    return changes;
  },
  lasting: (id) => !id.startsWith("tmp-"),
  label: (row) => ({ role: row.role, name: row.name }),
  role: (row) => row.role,
};

/** A tree from `[id, role, name, children]` rows, rooted at the first. */
function tree(...rows: [string, string, string, string[]?][]): Tree<Row> {
  return {
    nodes: new Map(
      rows.map(([id, role, name, childIds]) => [
        id,
        { role, name, ...(childIds ? { childIds } : {}) },
      ]),
    ),
    rootId: rows[0]![0],
  };
}

const PAGE = tree(
  ["root", "main", "", ["save", "list", "status"]],
  ["save", "button", "Save"],
  ["list", "list", "Cart", ["apples", "pears"]],
  ["apples", "listitem", "Apples"],
  ["pears", "listitem", "Pears", ["tmp-1"]],
  ["tmp-1", "StaticText", "Pears"],
  ["status", "status", ""],
);

describe("diffTreeRows", () => {
  it("finds what a read added, changed and removed, and where each went from", () => {
    const after = tree(
      ["root", "main", "", ["save", "list", "status"]],
      ["save", "button", "Saved"],
      ["list", "list", "Cart", ["apples", "kiwis"]],
      ["apples", "listitem", "Apples"],
      ["kiwis", "listitem", "Kiwis", ["tmp-2"]],
      ["tmp-2", "StaticText", "Kiwis"],
      ["status", "status", ""],
    );
    const changes = diffTreeRows(PAGE, after, RULES);
    expect([...changes.added]).toEqual(["kiwis", "tmp-2"]);
    expect(Object.fromEntries(changes.changed)).toEqual({
      save: [{ field: "name", before: "Save", after: "Saved" }],
    });
    expect(changes.removed).toEqual([
      { id: "pears", role: "listitem", name: "Pears" },
      { id: "tmp-1", role: "StaticText", name: "Pears" },
    ]);
    expect(Object.fromEntries(changes.removedUnder)).toEqual({ list: 2 });
    expect(changes.stops).toEqual(["save", "list", "kiwis"]);
  });

  it("neither adds nor removes a row a read names afresh while its parent stays", () => {
    const renamed = tree(
      ["root", "main", "", ["save", "list", "status"]],
      ["save", "button", "Save"],
      ["list", "list", "Cart", ["apples", "pears"]],
      ["apples", "listitem", "Apples"],
      ["pears", "listitem", "Pears", ["tmp-9"]],
      ["tmp-9", "StaticText", "Pears"],
      ["status", "status", ""],
    );
    const changes = diffTreeRows(PAGE, renamed, RULES);
    expect(isEmptyTreeChanges(changes)).toBe(true);
    expect(isEmptyTreeChanges(NO_TREE_CHANGES)).toBe(true);
  });
});

describe("compareThroughDialogs", () => {
  /** The page with a dialog in front, alone in the tree, as a modal leaves
   *  it. */
  const DIALOG = tree(
    ["confirm", "dialog", "Empty the cart?", ["yes"]],
    ["yes", "button", "Yes"],
  );
  const EMPTIED = tree(
    ["root", "main", "", ["save", "list", "status"]],
    ["save", "button", "Save"],
    ["list", "list", "Cart"],
    ["status", "status", "Cart emptied"],
  );

  it("marks a dialog in front of the page new, and nothing removed for the page behind it", () => {
    const opened = compareThroughDialogs(
      DIALOG,
      { against: PAGE, dialogs: [] },
      RULES,
    )!;
    expect([...opened.changes!.added]).toEqual(["confirm", "yes"]);
    expect(opened.changes!.removed).toEqual([]);
    expect(opened.dialogs).toEqual([{ dialogId: "confirm", before: PAGE }]);
  });

  it("compares the read the dialog is gone from with the page from before it came", () => {
    const opened = compareThroughDialogs(
      DIALOG,
      { against: PAGE, dialogs: [] },
      RULES,
    )!;
    const closed = compareThroughDialogs(
      EMPTIED,
      { against: DIALOG, dialogs: opened.dialogs },
      RULES,
    )!;
    expect(closed.baseline).toBe(PAGE);
    expect(closed.dialogs).toEqual([]);
    expect([...closed.changes!.changed.keys()]).toEqual(["status"]);
    expect(closed.changes!.removed.map((r) => r.id)).toEqual([
      "apples",
      "pears",
      "tmp-1",
    ]);
  });

  it("stands a menu a library opens modally in front of the page, as a dialog", () => {
    // Radix's dropdown hides the rest of the page, which leaves the menu
    // alone in the tree under the document's root.
    const MENU = tree(
      ["body", "generic", "", ["menu"]],
      ["menu", "menu", "Account", ["edit", "out"]],
      ["edit", "menuitem", "Edit profile"],
      ["out", "menuitem", "Sign out"],
    );
    const opened = compareThroughDialogs(
      MENU,
      { against: PAGE, dialogs: [] },
      RULES,
    )!;
    expect(opened.changes!.removed).toEqual([]);
    expect([...opened.changes!.added]).toEqual(["body", "menu", "edit", "out"]);
    const closed = compareThroughDialogs(
      PAGE,
      { against: MENU, dialogs: opened.dialogs },
      RULES,
    )!;
    expect(closed.baseline).toBe(PAGE);
    expect(closed.changes).toBeNull();
  });

  it("marks a menu that opens beside the page as new, and nothing more", () => {
    const withMenu = tree(
      ["root", "main", "", ["save", "list", "status", "menu"]],
      ["save", "button", "Save"],
      ["list", "list", "Cart", ["apples", "pears"]],
      ["apples", "listitem", "Apples"],
      ["pears", "listitem", "Pears", ["tmp-1"]],
      ["tmp-1", "StaticText", "Pears"],
      ["status", "status", ""],
      ["menu", "menu", "Account", ["edit"]],
      ["edit", "menuitem", "Edit profile"],
    );
    const opened = compareThroughDialogs(
      withMenu,
      { against: PAGE, dialogs: [] },
      RULES,
    )!;
    expect([...opened.changes!.added]).toEqual(["menu", "edit"]);
    expect(opened.dialogs).toEqual([]);
  });

  it("can't tell the page back from behind a dialog it never saw come", () => {
    expect(
      compareThroughDialogs(EMPTIED, { against: DIALOG, dialogs: [] }, RULES),
    ).toBeNull();
  });
});
