import { describe, expect, it } from "vitest";

import {
  compareInRun,
  compareWithCheckpoint,
  type RunBase,
} from "./tree-change-runs.js";
import type { DialogRules } from "./tree-changes-dialogs.js";
import type { Tree } from "./tree-changes-diff.js";

/**
 * Which tree a read compares with: the one before its run, or the one on
 * screen, and, while a checkpoint is pinned, the checkpoint through any
 * dialog that opens and closes. The extension's `use-native-changes.test.tsx`
 * takes reads of Chrome's tree through the same.
 */

interface Row {
  role: string;
  name: string;
  childIds?: string[];
}

const RULES: DialogRules<Row> = {
  compare: (before, after) =>
    before.name === after.name
      ? []
      : [{ field: "name", before: before.name, after: after.name }],
  lasting: () => true,
  label: (row) => row,
  role: (row) => row.role,
};

/** A tree of `rows`, under a root that holds them all. */
function tree(rows: Record<string, Row>): Tree<Row> {
  return {
    rootId: "root",
    nodes: new Map<string, Row>([
      ["root", { role: "generic", name: "", childIds: Object.keys(rows) }],
      ...Object.entries(rows),
    ]),
  };
}

const page = (button: string, extra: Record<string, Row> = {}) =>
  tree({
    button: { role: "button", name: button },
    a: { role: "link", name: "A" },
    b: { role: "link", name: "B" },
    ...extra,
  });

const base = (follows: number | null, runBefore: Tree<Row>): RunBase<Row> => ({
  follows,
  runBefore,
  dialogs: [],
});

describe("compareInRun", () => {
  it("compares a read that follows up the run with the tree before it", () => {
    const first = compareInRun(
      page("Open", { menu: { role: "menu", name: "" } }),
      {
        base: base(null, page("Open")),
        onScreen: page("Open"),
        run: { follows: 1, announce: true },
      },
      RULES,
    );
    const second = compareInRun(
      page("Close", { menu: { role: "menu", name: "" } }),
      {
        base: first.base,
        onScreen: page("Open", { menu: { role: "menu", name: "" } }),
        run: { follows: 1, announce: true },
      },
      RULES,
    );
    // The menu the first read found stays found.
    expect([...second.changes!.added]).toEqual(["menu"]);
    expect([...second.changes!.changed.keys()]).toEqual(["button"]);
  });

  it("compares a read of another run with the tree on screen", () => {
    const found = compareInRun(
      page("Close", { menu: { role: "menu", name: "" } }),
      {
        base: base(1, page("Open")),
        onScreen: page("Open", { menu: { role: "menu", name: "" } }),
        run: { follows: null, announce: false },
      },
      RULES,
    );
    expect(found.changes!.added.size).toBe(0);
    expect([...found.changes!.changed.keys()]).toEqual(["button"]);
    expect(found.base.follows).toBeNull();
  });

  it("finds nothing in a read that changed nothing, and says it compared", () => {
    const found = compareInRun(
      page("Open"),
      {
        base: base(null, page("Open")),
        onScreen: page("Open"),
        run: { follows: null, announce: false },
      },
      RULES,
    );
    expect(found).toMatchObject({ changes: null, compared: true });
  });
});

describe("compareWithCheckpoint", () => {
  const dialog = tree({ dialog: { role: "dialog", name: "Edit" } });

  it("keeps the checkpoint through a dialog that opens and closes", () => {
    const checkpoint = { tree: page("Open"), dialogs: [] };
    // A modal leaves only itself in the tree: nothing removed, the dialog new.
    const opened = compareWithCheckpoint(dialog, checkpoint, RULES);
    expect(opened.changes!.removed).toEqual([]);
    expect([...opened.changes!.added]).toEqual(["dialog"]);
    // Closed, what shows is what changed since the checkpoint, not since the
    // tree the dialog stood in front of.
    const closed = compareWithCheckpoint(
      page("Saved"),
      opened.checkpoint,
      RULES,
    );
    expect(closed.checkpoint.tree).toBe(checkpoint.tree);
    expect([...closed.changes!.changed.keys()]).toEqual(["button"]);
    expect(closed.changes!.removed).toEqual([]);
  });

  it("moves to the page back from behind a dialog it never saw come", () => {
    const found = compareWithCheckpoint(
      page("Open"),
      { tree: dialog, dialogs: [] },
      RULES,
    );
    expect(found.changes).toBeNull();
    expect(found.checkpoint.tree.nodes.has("button")).toBe(true);
  });
});
