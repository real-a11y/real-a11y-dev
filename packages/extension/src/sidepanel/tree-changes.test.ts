import { describe, expect, it } from "vitest";

import type { NativeNode } from "../native/native-actions.js";
import {
  diffNativeTrees,
  type NativeNodeChange,
  type NativeTreeChanges,
} from "../native/native-tree-diff.js";
import { nativeParentIndex } from "../native/native-tree-utils.js";

import {
  AUTO_EXPAND_MAX_ROWS,
  CHANGE_FLASH_MS,
  CHANGE_KEYS,
  CHANGE_KEYSHORTCUTS,
  changedFieldLabel,
  changeRowClass,
  describeChange,
  documentPositions,
  firstFlashEnd,
  flashesLeft,
  flashFresh,
  freshChanges,
  hiddenChangesByRow,
  hiddenChangesText,
  isChangeKey,
  marksForReaders,
  MAX_REMOVED_LISTED,
  nextChangeStop,
  NO_FLASH,
  notAboveSelection,
  rowChangeMarks,
  rowsToOpen,
  spokenChange,
  summarizeChanges,
  type HiddenChanges,
  type RowChangeMarks,
} from "./tree-changes.js";

/**
 * How Chrome's tree shows what a read found changed since the read before
 * it (`tree-changes.ts`): which rows flash and which open, which shown row
 * stands in for the changes under it, where Alt+N goes, and the words for
 * each change. The changes are written out by hand, except in the last
 * block, which takes them from a real diff of two reads.
 */

/** A tree from an outline of each row's children. Every id the outline
 *  names gets a row, and a row it gives no children is a leaf. */
function outline(children: Record<string, string[]>): Map<string, NativeNode> {
  const nodes = new Map<string, NativeNode>();
  const row = (id: string): NativeNode => {
    let node = nodes.get(id);
    if (!node) {
      node = { id, role: "generic", name: "", depth: 0 };
      nodes.set(id, node);
    }
    return node;
  };
  for (const [id, kids] of Object.entries(children)) {
    row(id).childIds = kids;
    for (const kid of kids) row(kid);
  }
  return nodes;
}

/** What a read found: the rows it found new, the rows it found changed, and
 *  how many rows went from under each row, with a removed row for each. */
function changesOf({
  added = [],
  changed = {},
  removedUnder = {},
  stops = [],
}: {
  added?: string[];
  changed?: Record<string, readonly NativeNodeChange[]>;
  removedUnder?: Record<string, number>;
  stops?: string[];
}): NativeTreeChanges {
  return {
    added: new Set(added),
    changed: new Map(Object.entries(changed)),
    removed: Object.entries(removedUnder).flatMap(([site, count]) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${site}-gone-${i}`,
        role: "listitem",
        name: `Gone ${i}`,
      })),
    ),
    removedUnder: new Map(Object.entries(removedUnder)),
    stops,
  };
}

/** What a shown row stands in for, with every count not given at 0. */
const inside = (counts: Partial<HiddenChanges>): HiddenChanges => ({
  added: 0,
  changed: 0,
  removed: 0,
  fresh: false,
  ...counts,
});

const RENAMED: readonly NativeNodeChange[] = [
  { field: "name", before: "Add to cart", after: "Added" },
];
const OPENED: readonly NativeNodeChange[] = [
  { field: "states.expanded", before: false, after: true },
];

describe("the change marks' constants", () => {
  it("flashes for a second and a half, opens up to 200 new rows and lists up to 50 removed ones", () => {
    expect(CHANGE_FLASH_MS).toBe(1500);
    expect(AUTO_EXPAND_MAX_ROWS).toBe(200);
    expect(MAX_REMOVED_LISTED).toBe(50);
  });

  it("names its two keys as aria-keyshortcuts lists them", () => {
    expect(CHANGE_KEYS).toEqual({ forward: "Alt+N", back: "Alt+Shift+N" });
    expect(CHANGE_KEYSHORTCUTS).toBe("Alt+N Alt+Shift+N");
  });
});

describe("isChangeKey", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("is Alt+N and Alt+Shift+N", () => {
    expect(isChangeKey(key({ key: "n", code: "KeyN", altKey: true }))).toBe(
      true,
    );
    expect(
      isChangeKey(
        key({ key: "N", code: "KeyN", altKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("takes the physical N key on a Mac, where Option+N is a dead key", () => {
    expect(isChangeKey(key({ key: "Dead", code: "KeyN", altKey: true }))).toBe(
      true,
    );
    // Option+Shift+N types a character of its own.
    expect(
      isChangeKey(
        key({ key: "˜", code: "KeyN", altKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("takes the key labelled N on a layout that puts it elsewhere", () => {
    // Dvorak's N is where QWERTY has L.
    expect(isChangeKey(key({ key: "n", code: "KeyL", altKey: true }))).toBe(
      true,
    );
    expect(
      isChangeKey(
        key({ key: "N", code: "KeyL", altKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("leaves N without Alt, and every other key with it", () => {
    expect(isChangeKey(key({ key: "n", code: "KeyN" }))).toBe(false);
    expect(isChangeKey(key({ key: "N", code: "KeyN", shiftKey: true }))).toBe(
      false,
    );
    expect(isChangeKey(key({ key: "j", code: "KeyJ", altKey: true }))).toBe(
      false,
    );
    expect(
      isChangeKey(key({ key: "Alt", code: "AltLeft", altKey: true })),
    ).toBe(false);
  });

  it("leaves Alt+N with Ctrl or Meta to whatever shortcut that is", () => {
    for (const mod of [
      { ctrlKey: true },
      { metaKey: true },
      { ctrlKey: true, metaKey: true },
    ]) {
      expect(
        isChangeKey(key({ key: "n", code: "KeyN", altKey: true, ...mod })),
      ).toBe(false);
    }
    // AltGr reports as Ctrl+Alt on Windows, and types a letter on some
    // layouts: Polish AltGr+N is ń.
    expect(
      isChangeKey(key({ key: "ń", code: "KeyN", altKey: true, ctrlKey: true })),
    ).toBe(false);
  });
});

describe("freshChanges", () => {
  /** A click's first read: a menu button opened, its menu came, and two
   *  rows went from the list beside it. */
  const firstRead = (): NativeTreeChanges =>
    changesOf({
      added: ["menu", "item1"],
      changed: { button: OPENED },
      removedUnder: { list: 2 },
    });

  it("finds every mark fresh when there were no marks before", () => {
    expect([...freshChanges(null, firstRead())].sort()).toEqual([
      "button",
      "item1",
      "list",
      "menu",
    ]);
  });

  it("finds nothing fresh in a read that found the same again", () => {
    // A follow-up read compares with the same tree as the read before it,
    // so it finds equal marks, though not the same objects.
    expect(freshChanges(firstRead(), firstRead()).size).toBe(0);
    const marks = firstRead();
    expect(freshChanges(marks, marks).size).toBe(0);
  });

  it("finds a new row fresh only the first time it is marked new", () => {
    const next = changesOf({
      added: ["menu", "item1", "item2"],
      changed: { button: OPENED },
      removedUnder: { list: 2 },
    });
    expect([...freshChanges(firstRead(), next)]).toEqual(["item2"]);
  });

  it("finds a changed row fresh when it changed to something else, or something more about it changed", () => {
    const renamed = (after: string) =>
      changesOf({
        changed: { button: [{ field: "name", before: "Load", after }] },
      });
    expect([...freshChanges(renamed("Loading"), renamed("Loaded"))]).toEqual([
      "button",
    ]);
    const busyToo = changesOf({
      changed: {
        button: [
          { field: "name", before: "Load", after: "Loading" },
          { field: "states.busy", after: true },
        ],
      },
    });
    expect([...freshChanges(renamed("Loading"), busyToo)]).toEqual(["button"]);
  });

  it("finds a changed row stale when only what it changed from differs", () => {
    const from = (before: string) =>
      changesOf({
        changed: { status: [{ field: "name", before, after: "Saved" }] },
      });
    expect(freshChanges(from("Saving"), from("Unsaved")).size).toBe(0);
  });

  it("tells a change to collapsed or to an empty value from a change to none", () => {
    const to = (change: NativeNodeChange) =>
      changesOf({ changed: { row: [change] } });
    // An expanded state of false shows "collapsed"; none shows no badge.
    expect(
      freshChanges(
        to({ field: "states.expanded", before: true, after: false }),
        to({ field: "states.expanded", before: true }),
      ),
    ).toEqual(new Set(["row"]));
    // An empty value shows `= ""`; none shows nothing.
    expect(
      freshChanges(
        to({ field: "value", before: "abc", after: "" }),
        to({ field: "value", before: "abc" }),
      ),
    ).toEqual(new Set(["row"]));
  });

  it("finds a row fresh when more or fewer rows went from under it", () => {
    const gone = (removedUnder: Record<string, number>) =>
      changesOf({ removedUnder });
    expect([...freshChanges(gone({ list: 2 }), gone({ list: 3 }))]).toEqual([
      "list",
    ]);
    expect([...freshChanges(gone({ list: 2 }), gone({ list: 1 }))]).toEqual([
      "list",
    ]);
    expect([
      ...freshChanges(gone({ list: 2 }), gone({ list: 2, nav: 1 })),
    ]).toEqual(["nav"]);
  });

  it("finds fresh only what the newer read marks", () => {
    // What the earlier read marked and this one doesn't is simply unmarked.
    expect(freshChanges(firstRead(), changesOf({})).size).toBe(0);
  });
});

describe("rowsToOpen", () => {
  const MENU = outline({
    root: ["nav", "menu"],
    nav: ["link"],
    menu: ["group"],
    group: ["item1", "item2"],
  });
  const MENU_PARENTS = nativeParentIndex(MENU);

  it("opens every fresh new row that has rows under it", () => {
    const changes = changesOf({
      added: ["menu", "group", "item1", "item2", "link"],
    });
    expect(
      rowsToOpen(changes, changes.added, MENU, MENU_PARENTS).sort(),
    ).toEqual(["group", "menu"]);
  });

  it("opens the rows an earlier read found new once the page adds to them, as the menu a button opened once its items come", () => {
    const changes = changesOf({ added: ["menu", "group", "item1", "item2"] });
    expect(
      rowsToOpen(changes, new Set(["item2"]), MENU, MENU_PARENTS).sort(),
    ).toEqual(["group", "menu"]);
    expect(
      rowsToOpen(
        changes,
        new Set(["group", "item2"]),
        MENU,
        MENU_PARENTS,
      ).sort(),
    ).toEqual(["group", "menu"]);
  });

  it("leaves closed a new row an earlier read found, which the user may have closed since, when nothing comes into it", () => {
    const changes = changesOf({ added: ["menu", "group", "item1", "item2"] });
    expect(rowsToOpen(changes, new Set(), MENU, MENU_PARENTS)).toEqual([]);
    // Nor does a fresh row elsewhere open it.
    const elsewhere = changesOf({ added: ["menu", "group", "item1", "link"] });
    expect(
      rowsToOpen(elsewhere, new Set(["link"]), MENU, MENU_PARENTS),
    ).toEqual([]);
  });

  it("opens no row that only changed, or that rows went from under", () => {
    const changes = changesOf({
      changed: { nav: RENAMED },
      removedUnder: { root: 1 },
    });
    expect(
      rowsToOpen(changes, new Set(["nav", "root"]), MENU, MENU_PARENTS),
    ).toEqual([]);
  });

  /** A page that added a section holding a list of `items` rows, and a
   *  dialog with one button, beside its old main, which gained a note. */
  function addition(items: number) {
    const ids = Array.from({ length: items }, (_, i) => `item${i}`);
    const nodes = outline({
      root: ["main", "section", "dialog"],
      main: ["note"],
      section: ["list"],
      list: ids,
      dialog: ["ok"],
    });
    const changes = changesOf({
      added: ["note", "section", "list", ...ids, "dialog", "ok"],
    });
    return { nodes, parentOf: nativeParentIndex(nodes), changes };
  }
  /** The rows `addition` adds besides the list's items. */
  const BESIDES_ITEMS = 5;

  it("opens every one of exactly the most new rows it opens all of", () => {
    const { nodes, parentOf, changes } = addition(
      AUTO_EXPAND_MAX_ROWS - BESIDES_ITEMS,
    );
    expect(changes.added.size).toBe(AUTO_EXPAND_MAX_ROWS);
    expect(rowsToOpen(changes, changes.added, nodes, parentOf).sort()).toEqual([
      "dialog",
      "list",
      "section",
    ]);
  });

  it("opens only the top row of each new subtree past that", () => {
    const { nodes, parentOf, changes } = addition(
      AUTO_EXPAND_MAX_ROWS - BESIDES_ITEMS + 1,
    );
    expect(changes.added.size).toBe(AUTO_EXPAND_MAX_ROWS + 1);
    // The list is new inside the new section, so it isn't a top; the note
    // is one, but has no rows under it.
    expect(rowsToOpen(changes, changes.added, nodes, parentOf).sort()).toEqual([
      "dialog",
      "section",
    ]);
  });

  it("counts only the fresh new rows towards that limit", () => {
    const { nodes, parentOf, changes } = addition(
      AUTO_EXPAND_MAX_ROWS - BESIDES_ITEMS + 1,
    );
    // The note was new in the read before: the rest are just the limit.
    const fresh = new Set([...changes.added].filter((id) => id !== "note"));
    expect(fresh.size).toBe(AUTO_EXPAND_MAX_ROWS);
    expect(rowsToOpen(changes, fresh, nodes, parentOf).sort()).toEqual([
      "dialog",
      "list",
      "section",
    ]);
  });

  it("past the limit, opens the subtree an earlier read found new that holds the fresh rows, and leaves them closed", () => {
    const { nodes, parentOf, changes } = addition(AUTO_EXPAND_MAX_ROWS);
    // The section came with the read before; this read filled its list.
    const fresh = new Set([...changes.added].filter((id) => id !== "section"));
    expect(fresh.size).toBeGreaterThan(AUTO_EXPAND_MAX_ROWS);
    expect(rowsToOpen(changes, fresh, nodes, parentOf).sort()).toEqual([
      "dialog",
      "section",
    ]);
  });

  it("past the limit, opens a list an earlier read found new and empty once a later read fills it", () => {
    const ids = Array.from(
      { length: AUTO_EXPAND_MAX_ROWS + 1 },
      (_, i) => `result${i}`,
    );
    const nodes = outline({ root: ["main"], main: ["results"], results: ids });
    const changes = changesOf({ added: ["results", ...ids] });
    // The list came empty with the action's re-read, so nothing opened it;
    // its results all came with this one.
    const fresh = new Set(ids);
    expect(rowsToOpen(changes, fresh, nodes, nativeParentIndex(nodes))).toEqual(
      ["results"],
    );
  });
});

describe("hiddenChangesByRow", () => {
  /** What each row in `shown` stands in for, of `changes` to `nodes`. */
  function standIns(
    changes: NativeTreeChanges,
    nodes: Map<string, NativeNode>,
    shown: string[],
    fresh: ReadonlySet<string> = new Set(),
  ): Record<string, HiddenChanges> {
    return Object.fromEntries(
      hiddenChangesByRow(
        changes,
        new Set(shown),
        nativeParentIndex(nodes),
        fresh,
      ),
    );
  }

  it("counts the changes under a collapsed row on it, each kind apart", () => {
    const nodes = outline({
      root: ["main"],
      main: ["list", "form"],
      list: ["item1", "item2", "item3"],
    });
    const changes = changesOf({
      added: ["item3"],
      changed: { item1: RENAMED, form: RENAMED },
      removedUnder: { list: 2 },
    });
    expect(standIns(changes, nodes, ["root", "main"])).toEqual({
      main: inside({ added: 1, changed: 2, removed: 2 }),
    });
  });

  it("counts a change on the nearest row above it that shows, however deep it is", () => {
    const nodes = outline({
      root: ["main"],
      main: ["section"],
      section: ["list", "aside"],
      list: ["item"],
      item: ["text"],
      aside: ["note"],
    });
    const changes = changesOf({
      changed: { text: RENAMED, note: RENAMED, item: RENAMED },
    });
    expect(standIns(changes, nodes, ["root", "main", "section"])).toEqual({
      section: inside({ changed: 3 }),
    });
    // Opened a level further, each change goes to its own nearest row.
    expect(
      standIns(changes, nodes, ["root", "main", "section", "list", "aside"]),
    ).toEqual({
      list: inside({ changed: 2 }),
      aside: inside({ changed: 1 }),
    });
  });

  it("counts nothing for a change whose own row shows", () => {
    const nodes = outline({ root: ["list"], list: ["item1", "item2"] });
    const changes = changesOf({
      added: ["item2"],
      changed: { item1: RENAMED },
    });
    expect(
      standIns(changes, nodes, ["root", "list", "item1", "item2"]),
    ).toEqual({});
  });

  it("counts every row of a new subtree hidden under a row that was there before", () => {
    const nodes = outline({
      root: ["main"],
      main: ["card"],
      card: ["title", "button"],
    });
    const changes = changesOf({ added: ["card", "title", "button"] });
    expect(standIns(changes, nodes, ["root", "main"])).toEqual({
      main: inside({ added: 3 }),
    });
  });

  it("counts no new row on a new row above it, which is new itself", () => {
    const nodes = outline({
      root: ["dialog"],
      dialog: ["form"],
      form: ["ok", "cancel"],
    });
    const changes = changesOf({ added: ["dialog", "form", "ok", "cancel"] });
    expect(standIns(changes, nodes, ["root", "dialog"])).toEqual({});
    // Nor on a new row shown open, its own rows hidden further down.
    expect(standIns(changes, nodes, ["root", "dialog", "form"])).toEqual({});
  });

  it("still counts a row that changed under a new row", () => {
    // The page moved a field it had into a new dialog, and renamed it.
    const nodes = outline({ root: ["dialog"], dialog: ["field", "ok"] });
    const changes = changesOf({
      added: ["dialog", "ok"],
      changed: { field: RENAMED },
    });
    expect(standIns(changes, nodes, ["root", "dialog"])).toEqual({
      dialog: inside({ changed: 1 }),
    });
  });

  it("counts the rows that went from under a shown row on that row, open or not", () => {
    const nodes = outline({ root: ["list"], list: ["item1"] });
    const changes = changesOf({ removedUnder: { list: 2 } });
    expect(standIns(changes, nodes, ["root", "list", "item1"])).toEqual({
      list: inside({ removed: 2 }),
    });
    expect(standIns(changes, nodes, ["root", "list"])).toEqual({
      list: inside({ removed: 2 }),
    });
  });

  it("rolls the rows that went from under a hidden row up to the row that shows", () => {
    const nodes = outline({
      root: ["main"],
      main: ["list", "nav"],
      list: ["item1"],
    });
    const changes = changesOf({ removedUnder: { list: 2, nav: 1 } });
    expect(standIns(changes, nodes, ["root", "main"])).toEqual({
      main: inside({ removed: 3 }),
    });
  });

  it("puts a change outside the rows shown at all nowhere", () => {
    // Scoped to main: the root and the navigation beside main show no row.
    const nodes = outline({
      root: ["nav", "main"],
      nav: ["link"],
      main: ["form"],
      form: ["field"],
    });
    const changes = changesOf({
      added: ["link"],
      changed: { root: RENAMED, nav: RENAMED, field: RENAMED },
      removedUnder: { root: 1, nav: 1 },
    });
    expect(standIns(changes, nodes, ["main", "form"])).toEqual({
      form: inside({ changed: 1 }),
    });
  });

  it("counts a change a search leaves out on the nearest row the search shows", () => {
    // A search shows the button it matched and the rows above it.
    const nodes = outline({
      root: ["main"],
      main: ["form"],
      form: ["email", "pay"],
    });
    const changes = changesOf({ changed: { email: RENAMED } });
    expect(standIns(changes, nodes, ["root", "main", "form", "pay"])).toEqual({
      form: inside({ changed: 1 }),
    });
  });

  it("flashes a row's count when any change it stands in for is fresh", () => {
    const nodes = outline({
      root: ["main", "nav", "aside"],
      main: ["item1", "item2"],
      nav: ["link"],
      aside: ["list"],
    });
    const changes = changesOf({
      added: ["item2"],
      changed: { item1: RENAMED, link: RENAMED },
      removedUnder: { list: 1 },
    });
    expect(
      standIns(
        changes,
        nodes,
        ["root", "main", "nav", "aside"],
        new Set(["item1", "list"]),
      ),
    ).toEqual({
      main: inside({ added: 1, changed: 1, fresh: true }),
      nav: inside({ changed: 1 }),
      aside: inside({ removed: 1, fresh: true }),
    });
  });
});

describe("rowChangeMarks", () => {
  // A list the page added to main, a renamed button, a row gone from nav.
  const nodes = outline({
    root: ["nav", "main"],
    main: ["list", "button"],
    list: ["item"],
  });
  const parentOf = nativeParentIndex(nodes);
  const changes = changesOf({
    added: ["list", "item"],
    changed: { button: RENAMED },
    removedUnder: { nav: 1 },
  });
  const hidden = new Map([["nav", inside({ removed: 1, fresh: true })]]);
  const marks = (id: string): RowChangeMarks =>
    rowChangeMarks(changes, hidden, parentOf, id);

  it("says new on the top row of a new subtree only", () => {
    expect(marks("list")).toEqual({ isNew: true, newTop: true });
    expect(marks("item")).toEqual({ isNew: true, newTop: false });
  });

  it("says new on a new row with no row above it", () => {
    expect(
      rowChangeMarks(changesOf({ added: ["alone"] }), null, new Map(), "alone"),
    ).toEqual({ isNew: true, newTop: true });
  });

  it("carries what changed on a changed row", () => {
    expect(marks("button")).toEqual({
      isNew: false,
      newTop: false,
      changes: RENAMED,
    });
  });

  it("carries what a row stands in for", () => {
    expect(marks("nav")).toEqual({
      isNew: false,
      newTop: false,
      hidden: inside({ removed: 1, fresh: true }),
    });
    expect(
      rowChangeMarks(changes, null, parentOf, "nav").hidden,
    ).toBeUndefined();
  });

  it("marks nothing on a row nothing happened to, nor anywhere without marks", () => {
    expect(marks("main")).toEqual({ isNew: false, newTop: false });
    expect(rowChangeMarks(null, null, parentOf, "button")).toEqual({
      isNew: false,
      newTop: false,
    });
  });
});

describe("changeRowClass", () => {
  /** The classes it adds, in no particular order. */
  const classesOf = (cls: string | false): string[] =>
    cls ? cls.split(" ").sort() : [];
  /** A flash running, on its first animation or its other one. */
  const FLASH = { until: 1_500, alt: false };
  const FLASH_AGAIN = { until: 1_500, alt: true };

  it("edges every new row, and a changed row its own way", () => {
    expect(
      classesOf(changeRowClass({ isNew: true, newTop: true }, undefined)),
    ).toEqual(["sn-node--change-new"]);
    expect(
      classesOf(changeRowClass({ isNew: true, newTop: false }, undefined)),
    ).toEqual(["sn-node--change-new"]);
    expect(
      classesOf(
        changeRowClass(
          { isNew: false, newTop: false, changes: RENAMED },
          undefined,
        ),
      ),
    ).toEqual(["sn-node--change-changed"]);
  });

  it("flashes a marked row while its mark is fresh", () => {
    expect(
      classesOf(changeRowClass({ isNew: true, newTop: false }, FLASH)),
    ).toEqual(["sn-node--change-flash", "sn-node--change-new"]);
    expect(
      classesOf(
        changeRowClass(
          { isNew: false, newTop: false, changes: RENAMED },
          FLASH,
        ),
      ),
    ).toEqual(["sn-node--change-changed", "sn-node--change-flash"]);
  });

  it("flashes on its other animation when a later read finds it fresh again, so it starts over", () => {
    expect(
      classesOf(changeRowClass({ isNew: true, newTop: true }, FLASH_AGAIN)),
    ).toEqual([
      "sn-node--change-flash",
      "sn-node--change-flash-alt",
      "sn-node--change-new",
    ]);
  });

  it("adds nothing to a row with no change of its own, fresh or not", () => {
    expect(
      changeRowClass({ isNew: false, newTop: false }, undefined),
    ).toBeFalsy();
    // A row that only stands in for changes under it flashes its count.
    expect(
      changeRowClass(
        {
          isNew: false,
          newTop: false,
          hidden: inside({ added: 1, fresh: true }),
        },
        FLASH,
      ),
    ).toBeFalsy();
  });
});

describe("spokenChange", () => {
  it("says which way a state went, as its badge reads", () => {
    expect(spokenChange(OPENED[0]!)).toBe("now expanded");
    expect(
      spokenChange({ field: "states.expanded", before: true, after: false }),
    ).toBe("now collapsed");
    expect(spokenChange({ field: "states.expanded", before: false })).toBe(
      "no longer expandable",
    );
  });

  it("says a state that turned off is off, where its badge would just go", () => {
    expect(spokenChange({ field: "states.checked", before: true })).toBe(
      "no longer checked",
    );
    expect(spokenChange({ field: "states.disabled", before: true })).toBe(
      "no longer disabled",
    );
    expect(spokenChange({ field: "states.invalid", before: "true" })).toBe(
      "no longer invalid",
    );
  });

  it("says a state that turned on, with its value when it has a word for one", () => {
    expect(spokenChange({ field: "states.checked", after: true })).toBe(
      "now checked",
    );
    expect(
      spokenChange({ field: "states.checked", before: true, after: "mixed" }),
    ).toBe("now checked mixed");
  });

  it("names anything else, which the row already shows as it is now", () => {
    expect(spokenChange(RENAMED[0]!)).toBe("name");
    expect(
      spokenChange({ field: "properties.level", before: "2", after: "3" }),
    ).toBe("level");
    expect(spokenChange({ field: "controls", after: "ax-dom-9" })).toBe(
      "controls",
    );
  });
});

describe("marksForReaders", () => {
  it("says nothing for a row with no marks", () => {
    expect(marksForReaders({ isNew: false, newTop: false })).toBe("");
    // A new row under a new row is new with it: its top row says so.
    expect(marksForReaders({ isNew: true, newTop: false })).toBe("");
  });

  it("says a new subtree's top row is new", () => {
    expect(marksForReaders({ isNew: true, newTop: true })).toBe(", new");
  });

  it("names what changed on a changed row, as its badges do", () => {
    expect(
      marksForReaders({
        isNew: false,
        newTop: false,
        changes: [...OPENED, ...RENAMED],
      }),
    ).toBe(", changed: now expanded, name");
  });

  it("says what a row stands in for, after its own marks", () => {
    expect(
      marksForReaders({
        isNew: false,
        newTop: false,
        changes: RENAMED,
        hidden: inside({ added: 2, removed: 1 }),
      }),
    ).toBe(", changed: name; 2 new, 1 removed inside");
  });

  it("starts with a comma, so the row's role and name come first", () => {
    expect(
      marksForReaders({ isNew: true, newTop: true }).startsWith(", "),
    ).toBe(true);
  });
});

describe("documentPositions", () => {
  it("numbers the rows in the order the tree draws them", () => {
    const nodes = outline({
      root: ["nav", "main"],
      nav: ["link1", "link2"],
      main: ["heading"],
    });
    expect(Object.fromEntries(documentPositions(nodes, "root"))).toEqual({
      root: 0,
      nav: 1,
      link1: 2,
      link2: 3,
      main: 4,
      heading: 5,
    });
  });

  it("leaves out a row nothing leads to, and a child with no row", () => {
    const nodes = outline({ root: ["missing", "a"], stray: ["b"] });
    nodes.delete("missing");
    expect(Object.fromEntries(documentPositions(nodes, "root"))).toEqual({
      root: 0,
      a: 1,
    });
  });

  it("places a row listed twice where it first comes, and stops at a cycle", () => {
    const nodes = outline({
      root: ["a", "b"],
      a: ["shared"],
      b: ["shared", "root"],
    });
    expect(Object.fromEntries(documentPositions(nodes, "root"))).toEqual({
      root: 0,
      a: 1,
      shared: 2,
      b: 3,
    });
  });

  it("is empty for a root the tree hasn't got", () => {
    expect(documentPositions(outline({ root: ["a"] }), "other").size).toBe(0);
  });
});

describe("nextChangeStop", () => {
  const position = new Map(
    ["root", "a", "b", "c", "d", "e"].map((id, i) => [id, i] as const),
  );
  const stops = ["b", "d"];

  it("goes to the first or the last stop with no row selected", () => {
    expect(nextChangeStop(stops, position, null, false)).toBe("b");
    expect(nextChangeStop(stops, position, null, true)).toBe("d");
  });

  it("goes from stop to stop, wrapping around either way", () => {
    expect(nextChangeStop(stops, position, "b", false)).toBe("d");
    expect(nextChangeStop(stops, position, "d", false)).toBe("b");
    expect(nextChangeStop(stops, position, "d", true)).toBe("b");
    expect(nextChangeStop(stops, position, "b", true)).toBe("d");
  });

  it("goes from a selected row that is no stop to the stop after or before it", () => {
    expect(nextChangeStop(stops, position, "c", false)).toBe("d");
    expect(nextChangeStop(stops, position, "c", true)).toBe("b");
    expect(nextChangeStop(stops, position, "a", false)).toBe("b");
    expect(nextChangeStop(stops, position, "e", true)).toBe("d");
    // Past the last stop, or before the first, it wraps.
    expect(nextChangeStop(stops, position, "e", false)).toBe("b");
    expect(nextChangeStop(stops, position, "a", true)).toBe("d");
  });

  it("stays on the only stop", () => {
    expect(nextChangeStop(["c"], position, "c", false)).toBe("c");
    expect(nextChangeStop(["c"], position, "c", true)).toBe("c");
  });

  it("skips a stop that is gone from the tree", () => {
    expect(nextChangeStop(["b", "gone", "d"], position, "b", false)).toBe("d");
    expect(nextChangeStop(["b", "gone", "d"], position, "d", true)).toBe("b");
    expect(nextChangeStop(["gone", "b", "d"], position, null, false)).toBe("b");
    expect(nextChangeStop(["b", "d", "gone"], position, null, true)).toBe("d");
  });

  it("starts from the first or the last when the selected row is gone from the tree", () => {
    expect(nextChangeStop(stops, position, "gone", false)).toBe("b");
    expect(nextChangeStop(stops, position, "gone", true)).toBe("d");
  });

  it("has nowhere to go with no stops, or none still in the tree", () => {
    expect(nextChangeStop([], position, null, false)).toBeUndefined();
    expect(nextChangeStop([], position, "b", true)).toBeUndefined();
    expect(nextChangeStop(["gone"], position, "b", false)).toBeUndefined();
    expect(nextChangeStop(["gone"], position, null, true)).toBeUndefined();
  });
});

describe("summarizeChanges", () => {
  it("counts the rows new, changed and removed, in that order", () => {
    expect(
      summarizeChanges(
        changesOf({
          added: ["list", "item1", "item2"],
          changed: { button: RENAMED },
          removedUnder: { main: 2 },
        }),
      ),
    ).toBe("3 new, 1 changed, 2 removed");
  });

  it("leaves out a kind there is none of", () => {
    expect(summarizeChanges(changesOf({ removedUnder: { main: 1 } }))).toBe(
      "1 removed",
    );
    expect(
      summarizeChanges(changesOf({ added: ["a"], removedUnder: { main: 4 } })),
    ).toBe("1 new, 4 removed");
    expect(
      summarizeChanges(changesOf({ changed: { a: RENAMED, b: OPENED } })),
    ).toBe("2 changed");
  });

  it("counts a changed row once however much about it changed", () => {
    expect(
      summarizeChanges(
        changesOf({ changed: { button: [...RENAMED, ...OPENED] } }),
      ),
    ).toBe("1 changed");
  });

  it("counts the rows removed, not the rows they went from under", () => {
    expect(
      summarizeChanges(changesOf({ removedUnder: { main: 2, nav: 1 } })),
    ).toBe("3 removed");
  });
});

describe("hiddenChangesText", () => {
  it("says what a row stands in for, inside it", () => {
    expect(
      hiddenChangesText(inside({ added: 2, changed: 1, removed: 3 })),
    ).toBe("2 new, 1 changed, 3 removed inside");
    expect(hiddenChangesText(inside({ added: 2, removed: 1 }))).toBe(
      "2 new, 1 removed inside",
    );
    expect(hiddenChangesText(inside({ changed: 1 }))).toBe("1 changed inside");
  });

  it("says the same whether or not the count flashes", () => {
    expect(hiddenChangesText(inside({ removed: 4, fresh: true }))).toBe(
      "4 removed inside",
    );
  });
});

describe("changedFieldLabel", () => {
  it("names a state or property by its key, as its badge does", () => {
    expect(changedFieldLabel("states.expanded")).toBe("expanded");
    expect(changedFieldLabel("states.checked")).toBe("checked");
    expect(changedFieldLabel("properties.level")).toBe("level");
    expect(changedFieldLabel("properties.hasPopup")).toBe("hasPopup");
  });

  it("names every other field as it is", () => {
    for (const field of [
      "role",
      "name",
      "description",
      "value",
      "placeholder",
      "controls",
    ]) {
      expect(changedFieldLabel(field)).toBe(field);
    }
  });
});

describe("describeChange", () => {
  it("says an expanded state as the row's badge read it", () => {
    expect(
      describeChange({ field: "states.expanded", before: false, after: true }),
    ).toBe("expanded: collapsed → expanded");
    expect(
      describeChange({ field: "states.expanded", before: true, after: false }),
    ).toBe("expanded: expanded → collapsed");
    // A row that couldn't expand has no expanded state at all.
    expect(describeChange({ field: "states.expanded", after: false })).toBe(
      "expanded: none → collapsed",
    );
    expect(describeChange({ field: "states.expanded", before: true })).toBe(
      "expanded: expanded → none",
    );
  });

  it("says any other state that is off as false", () => {
    expect(describeChange({ field: "states.disabled", after: true })).toBe(
      "disabled: false → true",
    );
    expect(describeChange({ field: "states.checked", before: true })).toBe(
      "checked: true → false",
    );
    expect(
      describeChange({ field: "states.checked", before: "mixed", after: true }),
    ).toBe("checked: mixed → true");
    expect(describeChange({ field: "states.current", before: "page" })).toBe(
      "current: page → false",
    );
  });

  it("quotes the texts a row shows, and says none for one it hadn't", () => {
    expect(
      describeChange({ field: "name", before: "Save", after: "Saved" }),
    ).toBe('name: "Save" → "Saved"');
    expect(
      describeChange({ field: "description", after: "Opens in a new tab" }),
    ).toBe('description: none → "Opens in a new tab"');
    expect(describeChange({ field: "placeholder", before: "Search" })).toBe(
      'placeholder: "Search" → none',
    );
  });

  it("tells an empty value from none, as the row does", () => {
    expect(describeChange({ field: "value", before: "", after: "abc" })).toBe(
      'value: "" → "abc"',
    );
    expect(describeChange({ field: "value", after: "" })).toBe(
      'value: none → ""',
    );
  });

  it("cuts a text longer than 40 characters", () => {
    const forty = "x".repeat(40);
    expect(
      describeChange({ field: "name", before: forty, after: `${forty}y` }),
    ).toBe(`name: "${forty}" → "${forty}…"`);
  });

  it("never cuts a character in two", () => {
    // Half an emoji would print as an escape such as \ud83d.
    const said = describeChange({
      field: "name",
      after: `${"x".repeat(39)}🛒 and the rest of a long name`,
    });
    expect(said).not.toMatch(/\\u[dD][89a-fA-F][0-9a-fA-F]{2}/);
    expect(said.endsWith('…"')).toBe(true);
  });

  it("keeps a change on one line of the tooltip, whatever the text holds", () => {
    const said = describeChange({
      field: "value",
      before: "line one\nline two",
      after: "one line",
    });
    expect(said).not.toContain("\n");
    expect(said).toBe('value: "line one\\nline two" → "one line"');
  });

  it("gives a role and a property as they are, unquoted", () => {
    expect(
      describeChange({ field: "role", before: "button", after: "link" }),
    ).toBe("role: button → link");
    expect(
      describeChange({ field: "properties.level", before: "2", after: "3" }),
    ).toBe("level: 2 → 3");
    expect(
      describeChange({ field: "properties.hasPopup", after: "menu" }),
    ).toBe("hasPopup: none → menu");
  });

  it("says a property that is true or false as such", () => {
    expect(
      describeChange({ field: "properties.modal", before: false, after: true }),
    ).toBe("modal: false → true");
  });

  it("names the rows a row controls rather than their ids", () => {
    const said = describeChange({
      field: "controls",
      before: "ax-dom-4",
      after: "ax-dom-4 ax-dom-9",
    });
    expect(said).toBe("the rows it controls");
    expect(said).not.toContain("ax-dom");
  });
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

describe("the flashes", () => {
  const FLASHING = new Map([
    ["a", { until: 1_000, alt: false }],
    ["b", { until: 2_000, alt: true }],
  ]);

  it("lets a running flash run to its own end, and drops one that ended", () => {
    const next = flashFresh(FLASHING, new Set(), 1_500);
    expect([...next]).toEqual([["b", { until: 2_000, alt: true }]]);
  });

  it("flashes a fresh row from now, on its other animation if it was flashing", () => {
    const next = flashFresh(FLASHING, new Set(["b", "c"]), 1_500);
    expect(next.get("b")).toEqual({
      until: 1_500 + CHANGE_FLASH_MS,
      alt: false,
    });
    expect(next.get("c")).toEqual({
      until: 1_500 + CHANGE_FLASH_MS,
      alt: false,
    });
    // One that had ended but not yet been let go of still flips: its row
    // still carries the class, and the same class wouldn't start over.
    expect(flashFresh(FLASHING, new Set(["a"]), 1_500).get("a")?.alt).toBe(
      true,
    );
  });

  it("keeps what hasn't ended, and nothing once all have", () => {
    expect([...flashesLeft(FLASHING, 1_000)]).toEqual([
      ["b", { until: 2_000, alt: true }],
    ]);
    expect(flashesLeft(FLASHING, 2_000)).toBe(NO_FLASH);
  });

  it("finds when the first one ends, however many there are", () => {
    expect(firstFlashEnd(FLASHING)).toBe(1_000);
    expect(firstFlashEnd(NO_FLASH)).toBe(Infinity);
    // More than a call takes arguments.
    const many = new Map(
      Array.from({ length: 200_000 }, (_, i) => [
        `row${i}`,
        { until: 5_000 + i, alt: false },
      ]),
    );
    expect(firstFlashEnd(many)).toBe(5_000);
  });
});

describe("notAboveSelection", () => {
  const nodes = outline({
    root: ["banner", "main", "aside"],
    banner: ["offer"],
    main: ["group"],
    group: ["name", "email"],
    aside: ["tips"],
  });
  const tree = { nodes, rootId: "root", parentOf: nativeParentIndex(nodes) };

  it("leaves out the rows above the selection, and keeps those below", () => {
    expect(notAboveSelection(["banner", "aside"], tree, "email")).toEqual([
      "aside",
    ]);
  });

  it("keeps the selected row, and every row it sits in", () => {
    expect(
      notAboveSelection(["main", "group", "email", "banner"], tree, "email"),
    ).toEqual(["main", "group", "email"]);
  });

  it("leaves everything in with no selection, or one the tree hasn't got", () => {
    expect(notAboveSelection(["banner", "aside"], tree, null)).toEqual([
      "banner",
      "aside",
    ]);
    expect(notAboveSelection(["banner"], tree, "gone")).toEqual(["banner"]);
  });
});

describe("hiddenChangesByRow, given the flashes", () => {
  it("says when the latest flash among a row's hidden changes ends", () => {
    const nodes = outline({ root: ["list"], list: ["a", "b", "c"] });
    const changes = changesOf({ added: ["a", "b"], changed: { c: RENAMED } });
    const hidden = hiddenChangesByRow(
      changes,
      new Set(["root", "list"]),
      nativeParentIndex(nodes),
      new Map([
        ["a", { until: 1_200, alt: false }],
        ["c", { until: 1_900, alt: true }],
      ]),
    );
    expect(hidden.get("list")).toEqual({
      added: 2,
      changed: 1,
      removed: 0,
      fresh: true,
      flashUntil: 1_900,
    });
  });
});
