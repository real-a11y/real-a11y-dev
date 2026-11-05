import {
  changeRowClass,
  describeChange,
  documentPositions,
  freshChanges,
  hiddenChangesByRow,
  hiddenChangesText,
  nextChangeStop,
  rowChangeMarks,
  rowsToOpen,
  summarizeChanges,
  type HiddenChanges,
} from "@real-a11y-dev/semantic-navigator-ui";
import { describe, expect, it } from "vitest";

import type { NativeNode } from "../native/native-actions.js";
import { diffNativeTrees } from "../native/native-tree-diff.js";
import { nativeParentIndex } from "../native/native-tree-utils.js";

/**
 * The marks Chrome's tree shows for a real diff of two of its reads: the ui
 * package's `tree-changes.ts` over `diffNativeTrees`, whose rules decide
 * what a change is called (`name: none → "Pears removed"`).
 */

/** What a shown row stands in for, with every count not given at 0. */
const inside = (counts: Partial<HiddenChanges>): HiddenChanges => ({
  added: 0,
  changed: 0,
  removed: 0,
  fresh: false,
  ...counts,
});

describe("the marks of a real read", () => {
  const n = (
    id: string,
    role: string,
    name: string,
    childIds: string[] = [],
    extra: Partial<NativeNode> = {},
  ): [string, NativeNode] => [
    id,
    { id, role, name, depth: 0, childIds, ...extra },
  ];
  const ROOT = "ax-dom-1";

  // A shop's page before and after a click on its Menu button: the menu
  // opened, the cart's second item went, and the status said so.
  const before = new Map([
    n(ROOT, "RootWebArea", "Shop", ["ax-dom-2", "ax-dom-4"]),
    n("ax-dom-2", "navigation", "", ["ax-dom-3"]),
    n("ax-dom-3", "button", "Menu", [], { states: { expanded: false } }),
    n("ax-dom-4", "main", "", ["ax-dom-5", "ax-dom-9"]),
    n("ax-dom-5", "list", "Cart", ["ax-dom-6", "ax-dom-7"]),
    n("ax-dom-6", "listitem", "Apples"),
    n("ax-dom-7", "listitem", "Pears", ["ax-dom-8"]),
    n("ax-dom-8", "StaticText", "Pears"),
    n("ax-dom-9", "status", ""),
  ]);
  const after = new Map([
    n(ROOT, "RootWebArea", "Shop", ["ax-dom-2", "ax-dom-10", "ax-dom-4"]),
    n("ax-dom-2", "navigation", "", ["ax-dom-3"]),
    n("ax-dom-3", "button", "Menu", [], { states: { expanded: true } }),
    n("ax-dom-10", "menu", "Menu", ["ax-dom-11", "ax-dom-12"]),
    n("ax-dom-11", "menuitem", "Home"),
    n("ax-dom-12", "menuitem", "Sale"),
    n("ax-dom-4", "main", "", ["ax-dom-5", "ax-dom-9"]),
    n("ax-dom-5", "list", "Cart", ["ax-dom-6"]),
    n("ax-dom-6", "listitem", "Apples"),
    n("ax-dom-9", "status", "Pears removed"),
  ]);

  it("counts what the click did, opens the menu, and goes from change to change", () => {
    const changes = diffNativeTrees(before, after, ROOT);
    expect(summarizeChanges(changes)).toBe("3 new, 2 changed, 2 removed");
    expect(
      rowsToOpen(
        changes,
        freshChanges(null, changes),
        after,
        nativeParentIndex(after),
      ),
    ).toEqual(["ax-dom-10"]);

    const position = documentPositions(after, ROOT);
    const visit = (back: boolean) => {
      const visited: string[] = [];
      let at: string | null = null;
      for (let i = 0; i < 5; i++) {
        at = nextChangeStop(changes.stops, position, at, back) ?? null;
        visited.push(String(at));
      }
      return visited;
    };
    // The button, the menu's top row, the list two rows went from, the
    // status; then round again.
    expect(visit(false)).toEqual([
      "ax-dom-3",
      "ax-dom-10",
      "ax-dom-5",
      "ax-dom-9",
      "ax-dom-3",
    ]);
    expect(visit(true)).toEqual([
      "ax-dom-9",
      "ax-dom-5",
      "ax-dom-10",
      "ax-dom-3",
      "ax-dom-9",
    ]);
  });

  it("marks the rows as the tree shows them, the menu and the cart closed", () => {
    const changes = diffNativeTrees(before, after, ROOT);
    const parentOf = nativeParentIndex(after);
    const shown = new Set([
      ROOT,
      "ax-dom-2",
      "ax-dom-3",
      "ax-dom-10",
      "ax-dom-4",
      "ax-dom-5",
      "ax-dom-9",
    ]);
    const hidden = hiddenChangesByRow(
      changes,
      shown,
      parentOf,
      freshChanges(null, changes),
    );
    // The menu's items are new with it, so the menu counts none of them.
    expect(Object.fromEntries(hidden)).toEqual({
      "ax-dom-5": inside({ removed: 2, fresh: true }),
    });

    const marks = (id: string) => rowChangeMarks(changes, hidden, parentOf, id);
    expect(marks("ax-dom-10")).toMatchObject({ isNew: true, newTop: true });
    expect(marks("ax-dom-11")).toMatchObject({ isNew: true, newTop: false });
    expect(marks("ax-dom-3").changes?.map(describeChange)).toEqual([
      "expanded: collapsed → expanded",
    ]);
    expect(marks("ax-dom-9").changes?.map(describeChange)).toEqual([
      'name: none → "Pears removed"',
    ]);
    expect(hiddenChangesText(marks("ax-dom-5").hidden!)).toBe(
      "2 removed inside",
    );
    expect(
      changeRowClass(marks("ax-dom-4"), { until: 1_500, alt: false }),
    ).toBeFalsy();
  });

  it("flashes only what a follow-up read of the same click found besides", () => {
    // The page fetched a third menu item after the first read. The
    // follow-up read compares with the tree from before the click too.
    const later = new Map(after);
    later.set("ax-dom-10", {
      ...after.get("ax-dom-10")!,
      childIds: ["ax-dom-11", "ax-dom-12", "ax-dom-13"],
    });
    later.set(...n("ax-dom-13", "menuitem", "Gift cards"));
    const first = diffNativeTrees(before, after, ROOT);
    const second = diffNativeTrees(before, later, ROOT);
    expect([...freshChanges(first, second)]).toEqual(["ax-dom-13"]);
    expect(summarizeChanges(second)).toBe("4 new, 2 changed, 2 removed");
    expect(
      freshChanges(second, diffNativeTrees(before, later, ROOT)).size,
    ).toBe(0);
  });
});
