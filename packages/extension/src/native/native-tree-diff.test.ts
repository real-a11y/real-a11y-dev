import {
  isEmptyTreeChanges,
  NO_TREE_CHANGES,
  type FieldChange,
  type TreeChanges,
} from "@real-a11y-dev/semantic-navigator-ui";
import { describe, expect, it } from "vitest";

import type { NativeNode } from "./native-actions.js";
import {
  compareNativeNodes,
  diffNativeTrees,
  isLastingNativeId,
} from "./native-tree-diff.js";

/** A row as a read gives it: a nameless `generic` unless `extra` says more. */
const node = (id: string, extra: Partial<NativeNode> = {}): NativeNode => ({
  id,
  role: "generic",
  name: "",
  depth: 0,
  ...extra,
});

/**
 * One read of a page. `shape` lists the rows under each row, and `rows` what
 * a row shows. Every row either one names is in the read, whether or not
 * anything leads to it from the root.
 */
function read(
  shape: Record<string, string[]>,
  rows: Record<string, Partial<NativeNode>> = {},
): Map<string, NativeNode> {
  const ids = new Set([
    ...Object.keys(shape),
    ...Object.values(shape).flat(),
    ...Object.keys(rows),
  ]);
  return new Map(
    [...ids].map((id) => [
      id,
      node(id, { childIds: [...(shape[id] ?? [])], ...rows[id] }),
    ]),
  );
}

/** What changed between two reads of a page rooted at `rootId`. */
const diff = (
  before: Map<string, NativeNode>,
  after: Map<string, NativeNode>,
  rootId = "root",
): TreeChanges => diffNativeTrees(before, after, rootId);

/** What changed between two reads of one row. */
const compare = (
  before: Partial<NativeNode>,
  after: Partial<NativeNode>,
): FieldChange[] => compareNativeNodes(node("x", before), node("x", after));

/** A row's changes in one fixed order: the order they come in is not what
 *  these tests are about. */
const byField = (changes: readonly FieldChange[]): FieldChange[] =>
  [...changes].sort((a, b) =>
    a.field < b.field ? -1 : a.field > b.field ? 1 : 0,
  );

/** The ids of the rows a diff found removed, in its order. */
const removedIds = (changes: TreeChanges): string[] =>
  changes.removed.map((r) => r.id);

/** A row showing `text` as its description or placeholder, or neither. */
const withText = (
  field: "description" | "placeholder",
  text?: string,
): Partial<NativeNode> => {
  if (text === undefined) return {};
  return field === "description"
    ? { description: text }
    : { placeholder: text };
};

describe("isLastingNativeId", () => {
  it("counts an id built from an element's backend node id as lasting", () => {
    expect(isLastingNativeId("ax-dom-12")).toBe(true);
  });

  it("counts an id built from an AX node id as not lasting", () => {
    expect(isLastingNativeId("ax-12")).toBe(false);
  });

  it("reads a frame's node by the id its own document knows it by", () => {
    expect(isLastingNativeId("ax-dom-3@F1.D1")).toBe(true);
    expect(isLastingNativeId("ax-dom-3@F1")).toBe(true);
    expect(isLastingNativeId("ax-3@F1.D1")).toBe(false);
    expect(isLastingNativeId("ax-3@F1")).toBe(false);
  });

  it("counts any other id, such as a test's own, as lasting", () => {
    for (const id of ["root", "button", "dom-3", "x@F1.D1"]) {
      expect(isLastingNativeId(id)).toBe(true);
    }
  });
});

describe("NO_TREE_CHANGES and isEmptyTreeChanges", () => {
  it("NO_TREE_CHANGES has nothing in it, and is empty", () => {
    expect(NO_TREE_CHANGES.added.size).toBe(0);
    expect(NO_TREE_CHANGES.changed.size).toBe(0);
    expect(NO_TREE_CHANGES.removed).toEqual([]);
    expect(NO_TREE_CHANGES.removedUnder.size).toBe(0);
    expect(NO_TREE_CHANGES.stops).toEqual([]);
    expect(isEmptyTreeChanges(NO_TREE_CHANGES)).toBe(true);
  });

  it("is not empty once one row was added, changed or removed", () => {
    const some: TreeChanges[] = [
      { ...NO_TREE_CHANGES, added: new Set(["a"]), stops: ["a"] },
      {
        ...NO_TREE_CHANGES,
        changed: new Map([["a", [{ field: "name", after: "A" }]]]),
        stops: ["a"],
      },
      {
        ...NO_TREE_CHANGES,
        removed: [{ id: "a", role: "button", name: "A" }],
        removedUnder: new Map([["root", 1]]),
        stops: ["root"],
      },
      // A removed row charged to no row still counts: the root went.
      {
        ...NO_TREE_CHANGES,
        removed: [{ id: "root", role: "RootWebArea", name: "" }],
      },
    ];
    for (const changes of some) expect(isEmptyTreeChanges(changes)).toBe(false);
  });
});

describe("compareNativeNodes", () => {
  /** A row that shows a bit of everything. */
  const everything = (): Partial<NativeNode> => ({
    role: "combobox",
    name: "Country",
    description: "Where you live",
    value: "Spain",
    placeholder: "Pick one",
    states: { expanded: false, required: true, invalid: "spelling" },
    properties: { hasPopup: "listbox" },
    controls: ["list", "help"],
  });

  it("finds nothing between two reads of a row that shows the same", () => {
    expect(compare(everything(), everything())).toEqual([]);
  });

  it("takes no states or properties for empty ones", () => {
    expect(compare({}, { states: {}, properties: {} })).toEqual([]);
    expect(compare({ states: {}, properties: {} }, {})).toEqual([]);
  });

  it("names a changed role with what it was and what it is", () => {
    expect(compare({ role: "button" }, { role: "link" })).toStrictEqual([
      { field: "role", before: "button", after: "link" },
    ]);
  });

  it("takes an empty name for no name, leaving that side out", () => {
    expect(compare({ name: "" }, { name: "Save" })).toStrictEqual([
      { field: "name", after: "Save" },
    ]);
    expect(compare({ name: "Save" }, { name: "" })).toStrictEqual([
      { field: "name", before: "Save" },
    ]);
    expect(compare({ name: "Save" }, { name: "Saved" })).toStrictEqual([
      { field: "name", before: "Save", after: "Saved" },
    ]);
  });

  it.each(["description", "placeholder"] as const)(
    "takes an empty %s for none, leaving that side out",
    (field) => {
      expect(compare(withText(field), withText(field, ""))).toEqual([]);
      expect(compare(withText(field, ""), withText(field))).toEqual([]);
      expect(
        compare(withText(field, ""), withText(field, "Hint")),
      ).toStrictEqual([{ field, after: "Hint" }]);
      expect(compare(withText(field, "Hint"), withText(field))).toStrictEqual([
        { field, before: "Hint" },
      ]);
      expect(
        compare(withText(field, "Hint"), withText(field, "")),
      ).toStrictEqual([{ field, before: "Hint" }]);
      expect(
        compare(withText(field, "Hint"), withText(field, "Tip")),
      ).toStrictEqual([{ field, before: "Hint", after: "Tip" }]);
    },
  );

  it("tells an empty value from no value", () => {
    expect(compare({}, { value: "" })).toStrictEqual([
      { field: "value", after: "" },
    ]);
    expect(compare({ value: "" }, {})).toStrictEqual([
      { field: "value", before: "" },
    ]);
    expect(compare({ value: "" }, { value: "" })).toEqual([]);
    expect(compare({ value: "3" }, { value: "4" })).toStrictEqual([
      { field: "value", before: "3", after: "4" },
    ]);
  });

  it("leaves focus out", () => {
    expect(compare({ states: { focused: true } }, {})).toEqual([]);
    expect(compare({}, { states: { focused: true } })).toEqual([]);
    expect(
      compare({ states: { focused: true } }, { states: { focused: false } }),
    ).toEqual([]);
    expect(
      compare(
        { states: { focused: false } },
        { states: { focused: true, checked: true } },
      ),
    ).toStrictEqual([{ field: "states.checked", after: true }]);
  });

  it("tells a collapsed row from one with no expanded state", () => {
    expect(compare({ states: { expanded: false } }, {})).toStrictEqual([
      { field: "states.expanded", before: false },
    ]);
    expect(
      compare({ states: {} }, { states: { expanded: false } }),
    ).toStrictEqual([{ field: "states.expanded", after: false }]);
    expect(
      compare({ states: { expanded: false } }, { states: { expanded: true } }),
    ).toStrictEqual([{ field: "states.expanded", before: false, after: true }]);
    expect(compare({ states: { expanded: true } }, {})).toStrictEqual([
      { field: "states.expanded", before: true },
    ]);
  });

  it("takes any other state that is off for one the row doesn't have", () => {
    expect(compare({ states: { checked: false } }, {})).toEqual([]);
    expect(compare({}, { states: { disabled: false } })).toEqual([]);
    expect(
      compare({ states: { selected: false } }, { states: { selected: true } }),
    ).toStrictEqual([{ field: "states.selected", after: true }]);
    expect(
      compare({ states: { pressed: true } }, { states: { pressed: false } }),
    ).toStrictEqual([{ field: "states.pressed", before: true }]);
  });

  it("compares a state given as a word as it is", () => {
    expect(
      compare({ states: { checked: "mixed" } }, { states: { checked: true } }),
    ).toStrictEqual([
      { field: "states.checked", before: "mixed", after: true },
    ]);
    expect(
      compare({ states: { checked: false } }, { states: { checked: "mixed" } }),
    ).toStrictEqual([{ field: "states.checked", after: "mixed" }]);
    expect(
      compare(
        { states: { invalid: "spelling" } },
        { states: { invalid: "grammar" } },
      ),
    ).toStrictEqual([
      { field: "states.invalid", before: "spelling", after: "grammar" },
    ]);
    expect(compare({ states: { invalid: "spelling" } }, {})).toStrictEqual([
      { field: "states.invalid", before: "spelling" },
    ]);
  });

  it("names each property that came, went or changed", () => {
    expect(
      byField(
        compare(
          {
            properties: {
              level: "2",
              keyshortcuts: "Alt+S",
              orientation: "vertical",
            },
          },
          {
            properties: {
              level: "3",
              roledescription: "slide",
              orientation: "vertical",
            },
          },
        ),
      ),
    ).toStrictEqual([
      { field: "properties.keyshortcuts", before: "Alt+S" },
      { field: "properties.level", before: "2", after: "3" },
      { field: "properties.roledescription", after: "slide" },
    ]);
  });

  it("compares the rows a row controls in any order", () => {
    expect(compare({ controls: ["b", "a"] }, { controls: ["a", "b"] })).toEqual(
      [],
    );
    expect(compare({ controls: [] }, {})).toEqual([]);
    expect(compare({}, { controls: [] })).toEqual([]);
  });

  it("gives the rows a row controls sorted and space-separated", () => {
    expect(
      compare({ controls: ["c", "a"] }, { controls: ["b", "c", "a"] }),
    ).toStrictEqual([{ field: "controls", before: "a c", after: "a b c" }]);
    expect(compare({}, { controls: ["panel"] })).toStrictEqual([
      { field: "controls", after: "panel" },
    ]);
    expect(compare({ controls: ["panel"] }, { controls: [] })).toStrictEqual([
      { field: "controls", before: "panel" },
    ]);
  });

  it("lists everything that changed on the row", () => {
    expect(
      byField(
        compare(
          {
            role: "button",
            name: "Menu",
            states: { expanded: false, focusable: true },
            properties: { hasPopup: "menu" },
          },
          {
            role: "combobox",
            name: "Menu",
            value: "File",
            states: { expanded: true, focusable: true },
            controls: ["list"],
          },
        ),
      ),
    ).toStrictEqual([
      { field: "controls", after: "list" },
      { field: "properties.hasPopup", before: "menu" },
      { field: "role", before: "button", after: "combobox" },
      { field: "states.expanded", before: false, after: true },
      { field: "value", after: "File" },
    ]);
  });

  it("ignores what the row never shows", () => {
    expect(
      compare(
        {
          depth: 1,
          childIds: ["a"],
          rawValue: "es",
          valueWithheld: true,
          pageKey: 3,
          pageFrame: 1,
          embedsPageFrame: 2,
        },
        {
          depth: 4,
          childIds: ["b", "c"],
          rawValue: "fr",
          valueWithheld: false,
          pageKey: 9,
          pageFrame: 5,
          embedsPageFrame: 6,
        },
      ),
    ).toEqual([]);
  });
});

describe("diffNativeTrees", () => {
  describe("two reads that show the same", () => {
    const page = () =>
      read(
        { root: ["nav", "main"], nav: ["link"], main: ["btn", "ax-9"] },
        {
          root: { role: "RootWebArea", name: "Shop" },
          link: { role: "link", name: "Home" },
          btn: { role: "button", name: "Buy", states: { focusable: true } },
          "ax-9": { role: "StaticText", name: "In stock" },
        },
      );

    it("finds nothing", () => {
      const changes = diff(page(), page());
      expect(changes).toEqual(NO_TREE_CHANGES);
      expect(isEmptyTreeChanges(changes)).toBe(true);
    });

    it("finds nothing when only focus moved", () => {
      const before = read(
        { root: ["a", "b"] },
        { a: { states: { focusable: true, focused: true } } },
      );
      const after = read(
        { root: ["a", "b"] },
        {
          a: { states: { focusable: true } },
          b: { states: { focused: true } },
        },
      );
      expect(diff(before, after)).toEqual(NO_TREE_CHANGES);
    });

    it("leaves both reads as they were", () => {
      const before = page();
      const after = page();
      after.get("btn")!.name = "Buy now";
      const snapshot = (m: Map<string, NativeNode>) => JSON.stringify([...m]);
      const was = [snapshot(before), snapshot(after)];
      diff(before, after);
      expect([snapshot(before), snapshot(after)]).toEqual(was);
    });
  });

  describe("rows the later read adds", () => {
    it("marks every row of a new subtree, and stops only at its top", () => {
      const before = read({ root: ["main"], main: ["btn"] });
      const after = read({
        root: ["main"],
        main: ["btn", "list"],
        list: ["item1", "item2"],
        item2: ["link"],
      });
      const changes = diff(before, after);
      expect(changes.added).toEqual(
        new Set(["list", "item1", "item2", "link"]),
      );
      // The row the subtree went under shows what it showed before.
      expect(changes.changed.size).toBe(0);
      expect(changes.removed).toEqual([]);
      expect(changes.removedUnder.size).toBe(0);
      expect(changes.stops).toEqual(["list"]);
    });

    it("stops at the top of each new subtree", () => {
      const before = read({ root: ["a", "b"] });
      const after = read({
        root: ["new1", "a", "b"],
        new1: ["new1a"],
        a: ["new2"],
        b: ["new3"],
        new3: ["new3a"],
      });
      const changes = diff(before, after);
      expect(changes.added).toEqual(
        new Set(["new1", "new1a", "new2", "new3", "new3a"]),
      );
      expect(changes.stops).toEqual(["new1", "new2", "new3"]);
    });

    it("takes a row with no element for new only under a new parent", () => {
      const before = read({ root: ["ax-dom-2"] });
      const after = read({
        root: ["ax-dom-2", "ax-40", "ax-dom-3", "ax-50"],
        "ax-dom-2": ["ax-41"],
        "ax-dom-3": ["ax-42"],
        "ax-42": ["ax-43"],
        "ax-50": ["ax-51"],
      });
      const changes = diff(before, after);
      // ax-40, ax-41 and ax-50 sit under rows that were there before, and
      // ax-51 under one that isn't new: a later read may only have named old
      // rows afresh.
      expect(changes.added).toEqual(new Set(["ax-dom-3", "ax-42", "ax-43"]));
      expect(changes.stops).toEqual(["ax-dom-3"]);
      expect(changes.removed).toEqual([]);
    });

    it("takes a row with an element for new under a row with no element that isn't", () => {
      // The text's AX node id changed (ax-5 → ax-6) with the element under
      // it still there; the button beside that element is new.
      const before = read({ root: ["ax-5"], "ax-5": ["ax-dom-10"] });
      const after = read({
        root: ["ax-6"],
        "ax-6": ["ax-dom-10", "ax-dom-11"],
      });
      const changes = diff(before, after);
      expect(changes.added).toEqual(new Set(["ax-dom-11"]));
      expect(changes.stops).toEqual(["ax-dom-11"]);
      expect(changes.removed).toEqual([]);
      expect(changes.removedUnder.size).toBe(0);
      expect(changes.changed.size).toBe(0);
    });

    it("never compares a row with no element, whose id may name another row", () => {
      const before = read(
        { root: ["ax-9"] },
        { "ax-9": { role: "StaticText", name: "Loading" } },
      );
      const after = read(
        { root: ["ax-9"] },
        { "ax-9": { role: "status", name: "Done" } },
      );
      expect(diff(before, after)).toEqual(NO_TREE_CHANGES);
    });
  });

  describe("rows of an out-of-process frame", () => {
    it("reads each row's id without its frame suffix", () => {
      // The frame's text was named afresh (ax-3 → ax-4), its cart button
      // changed, and a list with text in it is new.
      const before = read(
        {
          root: ["ax-dom-5"],
          "ax-dom-5": ["ax-dom-1@F1.D1"],
          "ax-dom-1@F1.D1": ["ax-3@F1.D1", "ax-dom-2@F1.D1"],
        },
        {
          "ax-dom-5": { role: "Iframe" },
          "ax-dom-2@F1.D1": { role: "button", name: "Cart (0)" },
        },
      );
      const after = read(
        {
          root: ["ax-dom-5"],
          "ax-dom-5": ["ax-dom-1@F1.D1"],
          "ax-dom-1@F1.D1": ["ax-4@F1.D1", "ax-dom-2@F1.D1"],
          "ax-dom-2@F1.D1": ["ax-dom-7@F1.D1"],
          "ax-dom-7@F1.D1": ["ax-8@F1.D1"],
        },
        {
          "ax-dom-5": { role: "Iframe" },
          "ax-dom-2@F1.D1": { role: "button", name: "Cart (1)" },
        },
      );
      const changes = diff(before, after);
      expect(changes.added).toEqual(new Set(["ax-dom-7@F1.D1", "ax-8@F1.D1"]));
      expect(changes.changed).toEqual(
        new Map([
          [
            "ax-dom-2@F1.D1",
            [{ field: "name", before: "Cart (0)", after: "Cart (1)" }],
          ],
        ]),
      );
      expect(changes.removed).toEqual([]);
      expect(changes.stops).toEqual(["ax-dom-2@F1.D1", "ax-dom-7@F1.D1"]);
    });

    it("takes a frame that shows another document for all new rows", () => {
      const frame = (doc: string) =>
        read(
          {
            root: ["ax-dom-5"],
            "ax-dom-5": [`ax-dom-1@F1.${doc}`],
            [`ax-dom-1@F1.${doc}`]: [`ax-dom-2@F1.${doc}`, `ax-3@F1.${doc}`],
          },
          { "ax-dom-5": { role: "Iframe" } },
        );
      const changes = diff(frame("D1"), frame("D2"));
      expect(changes.added).toEqual(
        new Set(["ax-dom-1@F1.D2", "ax-dom-2@F1.D2", "ax-3@F1.D2"]),
      );
      expect(removedIds(changes)).toEqual([
        "ax-dom-1@F1.D1",
        "ax-dom-2@F1.D1",
        "ax-3@F1.D1",
      ]);
      expect(changes.removedUnder).toEqual(new Map([["ax-dom-5", 3]]));
      expect(changes.changed.size).toBe(0);
      expect(changes.stops).toEqual(["ax-dom-5", "ax-dom-1@F1.D2"]);
    });
  });

  describe("rows both reads show", () => {
    it("marks a row that shows something else, with what changed", () => {
      const before = read(
        { root: ["menu", "other"] },
        {
          menu: { role: "button", name: "File", states: { expanded: false } },
        },
      );
      const after = read(
        { root: ["menu", "other"] },
        { menu: { role: "button", name: "File", states: { expanded: true } } },
      );
      const changes = diff(before, after);
      expect(changes.changed).toEqual(
        new Map([
          ["menu", [{ field: "states.expanded", before: false, after: true }]],
        ]),
      );
      expect(changes.added.size).toBe(0);
      expect(changes.removed).toEqual([]);
      expect(changes.removedUnder.size).toBe(0);
      expect(changes.stops).toEqual(["menu"]);
      expect(isEmptyTreeChanges(changes)).toBe(false);
    });

    it("marks the root when the page's title changes", () => {
      const page = (title: string) =>
        read(
          { "ax-dom-1": ["ax-dom-2"] },
          { "ax-dom-1": { role: "RootWebArea", name: title } },
        );
      const changes = diff(page("Inbox (2)"), page("Inbox (3)"), "ax-dom-1");
      expect(changes.changed).toEqual(
        new Map([
          [
            "ax-dom-1",
            [{ field: "name", before: "Inbox (2)", after: "Inbox (3)" }],
          ],
        ]),
      );
      expect(changes.added.size).toBe(0);
      expect(changes.removed).toEqual([]);
      expect(changes.stops).toEqual(["ax-dom-1"]);
    });
  });

  describe("rows that moved", () => {
    it("takes a row that moved for the same row, and compares only what it shows", () => {
      const before = read(
        { root: ["a", "b"], a: ["x"] },
        { x: { name: "Draft" } },
      );
      const moved = read(
        { root: ["a", "b"], b: ["x"] },
        { x: { name: "Draft" } },
      );
      expect(diff(before, moved)).toEqual(NO_TREE_CHANGES);

      const renamed = read(
        { root: ["a", "b"], b: ["x"] },
        { x: { name: "Sent" } },
      );
      const changes = diff(before, renamed);
      expect(changes.changed).toEqual(
        new Map([["x", [{ field: "name", before: "Draft", after: "Sent" }]]]),
      );
      expect(changes.added.size).toBe(0);
      expect(changes.removed).toEqual([]);
      expect(changes.stops).toEqual(["x"]);
    });

    it("keeps a row that moved into a new row out of the new rows", () => {
      const before = read({ root: ["x"] });
      const after = read({ root: ["wrap"], wrap: ["x"], x: ["fresh"] });
      const changes = diff(before, after);
      expect(changes.added).toEqual(new Set(["wrap", "fresh"]));
      // `fresh` is under a row that isn't new: it tops a new subtree too.
      expect(changes.stops).toEqual(["wrap", "fresh"]);
      expect(changes.removed).toEqual([]);
      expect(changes.changed.size).toBe(0);
    });

    it("keeps a row whose parent went out of the removed rows", () => {
      const before = read({ root: ["wrap"], wrap: ["x"] });
      const after = read({ root: ["x"] });
      const changes = diff(before, after);
      expect(changes.removed).toEqual([
        { id: "wrap", role: "generic", name: "" },
      ]);
      expect(changes.removedUnder).toEqual(new Map([["root", 1]]));
      expect(changes.added.size).toBe(0);
      expect(changes.stops).toEqual(["root"]);
    });
  });

  describe("rows the later read took away", () => {
    it("lists every removed row in the earlier read's document order, with its role and name", () => {
      const before = read(
        {
          root: ["keep", "dialog", "toast"],
          dialog: ["title", "form"],
          form: ["field"],
        },
        {
          dialog: { role: "dialog", name: "Sign in" },
          title: { role: "heading", name: "Welcome" },
          form: { role: "form", name: "" },
          field: { role: "textbox", name: "Email" },
          toast: { role: "status", name: "Saved" },
        },
      );
      const after = read({ root: ["keep"] });
      const changes = diff(before, after);
      expect(changes.removed).toEqual([
        { id: "dialog", role: "dialog", name: "Sign in" },
        { id: "title", role: "heading", name: "Welcome" },
        { id: "form", role: "form", name: "" },
        { id: "field", role: "textbox", name: "Email" },
        { id: "toast", role: "status", name: "Saved" },
      ]);
      // Every one went from under the root, those whose parent went too.
      expect(changes.removedUnder).toEqual(new Map([["root", 5]]));
      expect(changes.stops).toEqual(["root"]);
      expect(changes.added.size).toBe(0);
      expect(changes.changed.size).toBe(0);
    });

    it("charges removed rows to the nearest row above them the later read still shows", () => {
      const before = read({
        root: ["section", "aside"],
        section: ["list", "p"],
        list: ["i1", "i2"],
        aside: ["x"],
      });
      const after = read({ root: ["section", "aside"], section: ["p"] });
      const changes = diff(before, after);
      expect(removedIds(changes)).toEqual(["list", "i1", "i2", "x"]);
      expect(changes.removedUnder).toEqual(
        new Map([
          ["section", 3],
          ["aside", 1],
        ]),
      );
      expect(changes.stops).toEqual(["section", "aside"]);
    });

    it("takes a row with no element for removed only with its parent", () => {
      const before = read({
        root: ["ax-dom-2", "ax-10", "ax-dom-3"],
        "ax-dom-2": ["ax-9"],
        "ax-dom-3": ["ax-11"],
        "ax-11": ["ax-12"],
      });
      const after = read({ root: ["ax-dom-2"] });
      const changes = diff(before, after);
      // ax-9 and ax-10 went from under rows still there: a later read may
      // only have named them afresh.
      expect(removedIds(changes)).toEqual(["ax-dom-3", "ax-11", "ax-12"]);
      expect(changes.removedUnder).toEqual(new Map([["root", 3]]));
      expect(changes.stops).toEqual(["root"]);
      expect(changes.added.size).toBe(0);
    });

    it("charges past a row with no element that went without its parent", () => {
      const before = read({
        root: ["ax-dom-2"],
        "ax-dom-2": ["ax-7"],
        "ax-7": ["ax-dom-8", "ax-dom-9"],
      });
      const after = read({ root: ["ax-dom-2"] });
      const changes = diff(before, after);
      expect(removedIds(changes)).toEqual(["ax-dom-8", "ax-dom-9"]);
      expect(changes.removedUnder).toEqual(new Map([["ax-dom-2", 2]]));
      expect(changes.stops).toEqual(["ax-dom-2"]);
    });

    it("charges past a row with no element that the later read names afresh", () => {
      const before = read({
        root: ["ax-dom-2"],
        "ax-dom-2": ["ax-7"],
        "ax-7": ["ax-dom-8"],
      });
      const after = read({ root: ["ax-dom-2"], "ax-dom-2": ["ax-70"] });
      const changes = diff(before, after);
      expect(changes.added.size).toBe(0);
      expect(removedIds(changes)).toEqual(["ax-dom-8"]);
      expect(changes.removedUnder).toEqual(new Map([["ax-dom-2", 1]]));
      expect(changes.stops).toEqual(["ax-dom-2"]);
    });

    it("charges a removed row to a row with no element that the later read still shows", () => {
      const before = read({ root: ["ax-7"], "ax-7": ["ax-dom-8"] });
      const after = read({ root: ["ax-7"] });
      const changes = diff(before, after);
      expect(removedIds(changes)).toEqual(["ax-dom-8"]);
      expect(changes.removedUnder).toEqual(new Map([["ax-7", 1]]));
      expect(changes.stops).toEqual(["ax-7"]);
    });
  });

  describe("rows the root doesn't lead to", () => {
    it("leaves out a row nothing leads to, in either read", () => {
      const before = read({ root: ["a"] }, { stray: { name: "One" } });
      const after = read(
        { root: ["a"] },
        { stray: { name: "Two" }, other: { role: "button" } },
      );
      expect(diff(before, after)).toEqual(NO_TREE_CHANGES);
    });

    it("counts a row the later read still holds but no longer leads to as removed", () => {
      const before = read({ root: ["a"], a: ["b"] }, { b: { name: "Old" } });
      const after = read({ root: ["a"] }, { b: { name: "New" } });
      const changes = diff(before, after);
      expect(changes.removed).toEqual([
        { id: "b", role: "generic", name: "Old" },
      ]);
      expect(changes.removedUnder).toEqual(new Map([["a", 1]]));
      expect(changes.changed.size).toBe(0);
      expect(changes.stops).toEqual(["a"]);
    });

    it("counts a row the earlier read held but didn't lead to as new once the later read does", () => {
      const before = read({ root: ["a"] }, { b: {} });
      const after = read({ root: ["a"], a: ["b"] });
      const changes = diff(before, after);
      expect(changes.added).toEqual(new Set(["b"]));
      expect(changes.removed).toEqual([]);
      expect(changes.stops).toEqual(["b"]);
    });

    it("skips a child the read has no row for", () => {
      const before = read({ root: ["a"] });
      const after = read({ root: ["a"] });
      after.get("root")!.childIds = ["a", "ghost"];
      expect(diff(before, after)).toEqual(NO_TREE_CHANGES);
    });
  });

  describe("stops", () => {
    it("stops at every change once, in the later read's document order", () => {
      const before = read(
        { root: ["nav", "main", "footer"], nav: ["old"], main: ["btn"] },
        { btn: { role: "button", states: { expanded: false } } },
      );
      const after = read(
        {
          root: ["nav", "main", "footer"],
          main: ["btn", "list"],
          list: ["item"],
          footer: ["note"],
        },
        { btn: { role: "button", states: { expanded: true } } },
      );
      const changes = diff(before, after);
      // nav lost a row, btn changed, list and note top new subtrees; item
      // is inside a new subtree.
      expect(changes.stops).toEqual(["nav", "btn", "list", "note"]);
    });

    it("stops once at a row that changed and lost rows too", () => {
      const before = read(
        { root: ["menu"], menu: ["i1", "i2"] },
        { menu: { states: { expanded: true } } },
      );
      const after = read(
        { root: ["menu"] },
        { menu: { states: { expanded: false } } },
      );
      const changes = diff(before, after);
      expect(changes.changed).toEqual(
        new Map([
          ["menu", [{ field: "states.expanded", before: true, after: false }]],
        ]),
      );
      expect(changes.removedUnder).toEqual(new Map([["menu", 2]]));
      expect(changes.stops).toEqual(["menu"]);
    });

    it("follows the later read's order, not the earlier one's", () => {
      const before = read(
        { root: ["a", "b"] },
        { a: { name: "1" }, b: { name: "1" } },
      );
      const after = read(
        { root: ["b", "a"] },
        { a: { name: "2" }, b: { name: "2" } },
      );
      expect(diff(before, after).stops).toEqual(["b", "a"]);
    });
  });

  describe("with no tree on one side", () => {
    it("takes every row for new, with the root the one stop, when there was none before", () => {
      const after = read({ root: ["a", "ax-5"], a: ["b"] });
      const changes = diff(new Map(), after);
      expect(changes.added).toEqual(new Set(["root", "a", "b", "ax-5"]));
      expect(changes.stops).toEqual(["root"]);
      expect(changes.removed).toEqual([]);
      expect(changes.changed.size).toBe(0);
    });

    it("takes every row for removed, charged to none, when there is none after", () => {
      const before = read({ root: ["a"], a: ["ax-5"] });
      const changes = diff(before, new Map());
      expect(removedIds(changes)).toEqual(["root", "a", "ax-5"]);
      expect(changes.removedUnder.size).toBe(0);
      expect(changes.stops).toEqual([]);
      expect(isEmptyTreeChanges(changes)).toBe(false);
    });
  });

  describe("when the root moved between the reads", () => {
    // A page with one landmark is rooted at it; one with more at the
    // synthetic `ax-root`, which isn't an element of the page.
    const alone = () => read({ main: ["h"] }, { h: { name: "Cart" } });
    const withToast = () =>
      read(
        { "ax-root": ["main", "toast"], main: ["h"] },
        { h: { name: "Cart" }, toast: { name: "Saved" } },
      );

    it("walks each read from its own root", () => {
      const changes = diffNativeTrees(alone(), withToast(), "ax-root", "main");
      expect(changes.added).toEqual(new Set(["toast"]));
      expect(changes.removed).toEqual([]);
      expect(changes.changed.size).toBe(0);
      expect(changes.stops).toEqual(["toast"]);
    });

    it("charges a row whose ancestors all went to the later read's root", () => {
      const changes = diffNativeTrees(withToast(), alone(), "main", "ax-root");
      expect(removedIds(changes)).toEqual(["toast"]);
      expect([...changes.removedUnder]).toEqual([["main", 1]]);
      expect(changes.stops).toEqual(["main"]);
    });

    it("walks both from one root when given one", () => {
      // Without its own root, `before` is walked from `after`'s, which it
      // doesn't have: every row of `after` is new but the synthetic root,
      // which is no element of the page.
      expect(diffNativeTrees(alone(), withToast(), "ax-root").added).toEqual(
        new Set(["main", "h", "toast"]),
      );
    });
  });
});
