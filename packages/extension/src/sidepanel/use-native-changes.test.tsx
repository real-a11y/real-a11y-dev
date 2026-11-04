import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NativeNode } from "../native/native-actions.js";
import {
  diffNativeTrees,
  type NativeTreeChanges,
} from "../native/native-tree-diff.js";

import {
  followAfterRead,
  followPageInput,
  NOT_FOLLOWING,
} from "./follow-window.js";
import {
  compareRead,
  readRun,
  useNativeChanges,
  type ChangeBase,
  type ReadRun,
  type ReadTree,
} from "./use-native-changes.js";

/**
 * Which two trees a read of Chrome's tree is compared with, for the marks
 * the tree shows. A read the user causes (Refresh, an action's own re-read)
 * starts a run and compares with the tree on screen; the reads that follow
 * it up in its follow window join its run and compare with the tree from
 * before it, so what a click did stays marked while the page finishes doing
 * it; an automatic read compares with the tree on screen and says nothing,
 * and leaves the marks when it finds nothing. Nothing is compared across
 * tabs or documents, with a document it has no id for, or in a read another
 * document took the place of as it was taken; reads of one document whose
 * roots differ are. The page behind a modal dialog isn't removed, and
 * closing the dialog compares with the page from before it opened.
 */

const ROOT = "ax-dom-1";
/** The reply's document fields for the shop page. */
const SHOP = { rootId: ROOT, documentId: "D1" };

function n(
  id: string,
  role: string,
  name: string,
  childIds: string[] = [],
  extra: Partial<NativeNode> = {},
): NativeNode {
  return { id, role, name, depth: 0, childIds, ...extra };
}

function tree(...nodes: NativeNode[]): Map<string, NativeNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

/** A shop page whose Menu button is collapsed. */
const CLOSED = tree(
  n(ROOT, "RootWebArea", "Shop", ["ax-dom-2", "ax-dom-3"]),
  n("ax-dom-2", "button", "Menu", [], { states: { expanded: false } }),
  n("ax-dom-3", "main", ""),
);

/** The click's own re-read: the button went expanded, its menu still empty. */
const OPENED = tree(
  n(ROOT, "RootWebArea", "Shop", ["ax-dom-2", "ax-dom-4", "ax-dom-3"]),
  n("ax-dom-2", "button", "Menu", [], { states: { expanded: true } }),
  n("ax-dom-4", "menu", "Menu"),
  n("ax-dom-3", "main", ""),
);

/** A later read: the items the page fetched for the menu arrived. */
const FILLED = tree(
  n(ROOT, "RootWebArea", "Shop", ["ax-dom-2", "ax-dom-4", "ax-dom-3"]),
  n("ax-dom-2", "button", "Menu", [], { states: { expanded: true } }),
  n("ax-dom-4", "menu", "Menu", ["ax-dom-5", "ax-dom-6"]),
  n("ax-dom-5", "menuitem", "Shoes"),
  n("ax-dom-6", "menuitem", "Hats"),
  n("ax-dom-3", "main", ""),
);

/** The page the shop navigates to, as its first read finds it and then as
 *  a later one does. */
const CHECKOUT = { rootId: "ax-dom-50", documentId: "D2" };
const CHECKOUT_LOADING = tree(
  n("ax-dom-50", "RootWebArea", "Checkout", ["ax-dom-51"]),
  n("ax-dom-51", "heading", "Checkout"),
);
const CHECKOUT_LOADED = tree(
  n("ax-dom-50", "RootWebArea", "Checkout", ["ax-dom-51", "ax-dom-52"]),
  n("ax-dom-51", "heading", "Checkout"),
  n("ax-dom-52", "form", "Payment"),
);

/** The menu button's change, from CLOSED to OPENED or FILLED. */
const WENT_EXPANDED = { field: "states.expanded", before: false, after: true };

/** What a comparison found, by row id: added and changed in any order,
 *  removed in the earlier read's document order. */
function found(changes: NativeTreeChanges | null | undefined) {
  if (!changes) return null;
  return {
    added: [...changes.added].sort(),
    changed: [...changes.changed.keys()].sort(),
    removed: changes.removed.map((r) => r.id),
  };
}

/** Auto-refresh's state as a read starts: when it started, and the follow
 *  window. */
function startOf(lastReadStartedAt: number, follow = NOT_FOLLOWING) {
  return { lastReadStartedAt, follow };
}

describe("readRun", () => {
  /** The follow window a click on the page at 50s opened, the latest change
   *  heard of before it dated 49s. */
  const CLICKED = followPageInput(NOT_FOLLOWING, 50_000, 49_000, 50_000);

  it("starts a run of its own for a read the user caused, named by when it started, and says what it finds", () => {
    expect(readRun(false, false, startOf(60_000))).toEqual({
      follows: 60_000,
      announce: true,
    });
  });

  it("starts a run of its own for a read the user caused inside a follow window", () => {
    expect(readRun(false, true, startOf(51_000, CLICKED))).toEqual({
      follows: 51_000,
      announce: true,
    });
  });

  it("puts an automatic read that follows up what the user did in the follow window's run, and says what it finds", () => {
    expect(readRun(true, true, startOf(51_000, CLICKED))).toEqual({
      follows: CLICKED.from,
      announce: true,
    });
  });

  it("gives any other automatic read no run, and keeps what it finds quiet", () => {
    expect(readRun(true, false, startOf(51_000, CLICKED))).toEqual({
      follows: null,
      announce: false,
    });
    expect(readRun(true, false, startOf(51_000))).toEqual({
      follows: null,
      announce: false,
    });
  });

  it("puts an action's own re-read and the reads that follow it up in one run", () => {
    const startedAt = 100_000;
    const action = readRun(false, false, startOf(startedAt));
    // The re-read ended 300ms after it started, and opened the follow window.
    const follow = followAfterRead(
      NOT_FOLLOWING,
      "action",
      startedAt,
      Infinity,
      startedAt + 300,
    );
    expect(readRun(true, true, startOf(startedAt + 900, follow))).toEqual({
      follows: action.follows,
      announce: true,
    });
    expect(
      readRun(true, true, startOf(startedAt + 4_000, follow)).follows,
    ).toBe(action.follows);
  });

  it("puts the follow-ups of one click in one run, and a later click's in another", () => {
    const first = readRun(true, true, startOf(50_400, CLICKED));
    expect(readRun(true, true, startOf(52_000, CLICKED)).follows).toBe(
      first.follows,
    );
    // The first window closed at 55s; a click at 70s, after a change heard
    // of at 51s, opens another.
    const later = followPageInput(CLICKED, 70_000, 51_000, 70_000);
    expect(readRun(true, true, startOf(70_300, later)).follows).not.toBe(
      first.follows,
    );
  });

  it("keeps a change made in the window before, and heard of after a click opened another, in that window's run", () => {
    const first = readRun(true, true, startOf(50_400, CLICKED));
    // The first window closed at 55s; a click at 70s, after a change heard
    // of at 56s, opened another; then a busy frame reported a change it made
    // at 54s.
    const later = {
      ...followPageInput(CLICKED, 70_000, 56_000, 70_000),
      firstChangeAt: 54_000,
    };
    expect(readRun(true, true, startOf(70_300, later)).follows).toBe(
      first.follows,
    );
    // A change made since the click is the new window's.
    expect(
      readRun(true, true, startOf(70_300, { ...later, firstChangeAt: 70_100 }))
        .follows,
    ).toBe(later.from);
  });
});

describe("compareRead", () => {
  /** A read of the shop page in tab 1. */
  function readOf(
    nodes: Map<string, NativeNode>,
    over: Partial<ReadTree> = {},
  ): ReadTree {
    return { tabId: 1, rootId: ROOT, documentId: "D1", nodes, ...over };
  }

  /** A read in the run `follows` names (null for an automatic one). */
  const runOf = (follows: number | null): ReadRun => ({
    follows,
    announce: follows !== null,
  });

  /** What a read of the shop page in run `follows` left to compare with:
   *  its run began on `before`, drawn from `rootId`. */
  function baseOf(
    before: Map<string, NativeNode>,
    follows: number | null,
    rootId = ROOT,
    over: Partial<ChangeBase> = {},
  ): ChangeBase {
    return {
      tabId: 1,
      rootId,
      documentId: "D1",
      follows,
      runBefore: { nodes: before, rootId },
      dialogs: [],
      ...over,
    };
  }

  it("finds nothing in a read with no read before it, and makes it the base", () => {
    const read = readOf(OPENED);
    const result = compareRead(null, CLOSED, read, runOf(100));
    expect(result.changes).toBeNull();
    expect(result.base).toEqual({
      tabId: 1,
      rootId: ROOT,
      documentId: "D1",
      follows: 100,
      runBefore: read,
      dialogs: [],
    });
    expect(result.base.runBefore.nodes).toBe(OPENED);
  });

  it("finds nothing with no tree on screen, and starts over from the read", () => {
    const result = compareRead(
      baseOf(CLOSED, 100),
      new Map(),
      readOf(OPENED),
      runOf(100),
    );
    expect(result.changes).toBeNull();
    expect(result.base.runBefore.nodes).toBe(OPENED);
  });

  it.each([
    ["another tab", { tabId: 2 }],
    ["another document", { documentId: "D2" }],
    ["a document it has no id for", { documentId: undefined }],
  ] as const)(
    "finds nothing in a read of %s, even in the same run, and starts over from it",
    (_what, over) => {
      const read = readOf(FILLED, over);
      const result = compareRead(baseOf(CLOSED, 100), OPENED, read, runOf(100));
      expect(result.changes).toBeNull();
      expect(result.base.runBefore.nodes).toBe(FILLED);
      expect(result.base.tabId).toBe(read.tabId);
      expect(result.base.documentId).toBe(read.documentId);
    },
  );

  it("doesn't compare two reads of a document it has no id for", () => {
    const result = compareRead(
      baseOf(CLOSED, null, ROOT, { documentId: undefined }),
      CLOSED,
      readOf(OPENED, { documentId: undefined }),
      runOf(100),
    );
    expect(result.changes).toBeNull();
  });

  it("finds nothing in a read whose document changed as it was taken, and starts over from it", () => {
    const result = compareRead(
      baseOf(CLOSED, 100),
      OPENED,
      readOf(FILLED, { documentChanged: true }),
      runOf(100),
    );
    expect(result.changes).toBeNull();
    expect(result.base.runBefore.nodes).toBe(FILLED);
  });

  it("compares a read that continues its run with the tree from before the run, and keeps that as the base", () => {
    // The click's own re-read put OPENED on screen; the run began on CLOSED.
    const result = compareRead(
      baseOf(CLOSED, 100),
      OPENED,
      readOf(FILLED),
      runOf(100),
    );
    expect(found(result.changes)).toEqual({
      added: ["ax-dom-4", "ax-dom-5", "ax-dom-6"],
      changed: ["ax-dom-2"],
      removed: [],
    });
    expect(result.changes!.changed.get("ax-dom-2")).toEqual([WENT_EXPANDED]);
    expect(result.base.runBefore.nodes).toBe(CLOSED);
    expect(result.base.follows).toBe(100);
  });

  it("continues a run named 0 like any other", () => {
    // A click on the page before any change was heard of opens a window
    // from 0, and its follow-ups run as 0.
    const result = compareRead(
      baseOf(CLOSED, 0),
      OPENED,
      readOf(FILLED),
      runOf(0),
    );
    expect(found(result.changes)?.added).toEqual([
      "ax-dom-4",
      "ax-dom-5",
      "ax-dom-6",
    ]);
    expect(result.base.runBefore.nodes).toBe(CLOSED);
  });

  it("compares a read that starts a run with the tree on screen, and makes that the base", () => {
    const result = compareRead(
      baseOf(CLOSED, 100),
      OPENED,
      readOf(FILLED),
      runOf(200),
    );
    expect(found(result.changes)).toEqual({
      added: ["ax-dom-5", "ax-dom-6"],
      changed: [],
      removed: [],
    });
    expect(result.base.runBefore).toEqual({ nodes: OPENED, rootId: ROOT });
    expect(result.base.runBefore.nodes).toBe(OPENED);
    expect(result.base.follows).toBe(200);
  });

  it("starts a run when the read before was an automatic one", () => {
    const result = compareRead(
      baseOf(CLOSED, null),
      OPENED,
      readOf(FILLED),
      runOf(100),
    );
    expect(found(result.changes)).toEqual({
      added: ["ax-dom-5", "ax-dom-6"],
      changed: [],
      removed: [],
    });
    expect(result.base.runBefore.nodes).toBe(OPENED);
    expect(result.base.follows).toBe(100);
  });

  it("never runs two automatic reads together", () => {
    const result = compareRead(
      baseOf(CLOSED, null),
      OPENED,
      readOf(FILLED),
      runOf(null),
    );
    expect(found(result.changes)).toEqual({
      added: ["ax-dom-5", "ax-dom-6"],
      changed: [],
      removed: [],
    });
    expect(result.base.runBefore.nodes).toBe(OPENED);
    expect(result.base.follows).toBeNull();
  });

  it("finds the rows that went, and what changed on those that stayed", () => {
    // Refresh after the menu closed again.
    const result = compareRead(
      baseOf(OPENED, 100),
      FILLED,
      readOf(CLOSED),
      runOf(300),
    );
    expect(found(result.changes)).toEqual({
      added: [],
      changed: ["ax-dom-2"],
      removed: ["ax-dom-4", "ax-dom-5", "ax-dom-6"],
    });
    expect(result.changes!.changed.get("ax-dom-2")).toEqual([
      { field: "states.expanded", before: true, after: false },
    ]);
    // Exactly what the two trees' own diff finds.
    expect(result.changes).toEqual(diffNativeTrees(FILLED, CLOSED, ROOT));
  });

  it("finds nothing in a read that starts a run on the tree already on screen, and moves the base on", () => {
    const result = compareRead(
      baseOf(CLOSED, 100),
      OPENED,
      readOf(new Map(OPENED)),
      runOf(300),
    );
    expect(result.changes).toBeNull();
    expect(result.base.runBefore.nodes).toBe(OPENED);
    expect(result.base.follows).toBe(300);
  });

  it("finds nothing when a run comes back to where it began, and keeps its base for the rest of it", () => {
    // The menu opened, then closed again within one follow window.
    const back = compareRead(
      baseOf(CLOSED, 100),
      OPENED,
      readOf(new Map(CLOSED)),
      runOf(100),
    );
    expect(back.changes).toBeNull();
    expect(back.base.runBefore.nodes).toBe(CLOSED);
    // And opened once more, items and all.
    const again = compareRead(back.base, CLOSED, readOf(FILLED), runOf(100));
    expect(found(again.changes)).toEqual({
      added: ["ax-dom-4", "ax-dom-5", "ax-dom-6"],
      changed: ["ax-dom-2"],
      removed: [],
    });
  });

  it("compares every read of a run with the tree from before it, read after read", () => {
    // An automatic read put CLOSED on screen.
    let step = compareRead(null, new Map(), readOf(CLOSED), runOf(null));
    expect(step.changes).toBeNull();
    // The click's own re-read.
    step = compareRead(step.base, CLOSED, readOf(OPENED), runOf(100));
    expect(found(step.changes)).toEqual({
      added: ["ax-dom-4"],
      changed: ["ax-dom-2"],
      removed: [],
    });
    // A follow-up finds the items.
    step = compareRead(step.base, OPENED, readOf(FILLED), runOf(100));
    const all = {
      added: ["ax-dom-4", "ax-dom-5", "ax-dom-6"],
      changed: ["ax-dom-2"],
      removed: [],
    };
    expect(found(step.changes)).toEqual(all);
    // Another follow-up, with nothing new since: still all of the run.
    step = compareRead(step.base, FILLED, readOf(new Map(FILLED)), runOf(100));
    expect(found(step.changes)).toEqual(all);
    // Refresh: a run of its own, against the tree on screen.
    step = compareRead(step.base, FILLED, readOf(new Map(FILLED)), runOf(300));
    expect(step.changes).toBeNull();
  });

  describe("when the document's root moves", () => {
    // Chromium's own root is dropped: a page with one landmark is rooted at
    // it, one with more at the synthetic `ax-root` (`rootIdOf`).
    const ALONE = tree(
      n("ax-dom-10", "main", "", ["ax-dom-11"]),
      n("ax-dom-11", "heading", "Cart"),
    );
    const WITH_TOAST = tree(
      n("ax-root", "document", "", ["ax-dom-10", "ax-dom-12"]),
      n("ax-dom-10", "main", "", ["ax-dom-11"]),
      n("ax-dom-11", "heading", "Cart"),
      n("ax-dom-12", "status", "Saved"),
    );

    it("compares two reads of one document whose roots differ, each from its own root", () => {
      const result = compareRead(
        baseOf(ALONE, null, "ax-dom-10"),
        ALONE,
        readOf(WITH_TOAST, { rootId: "ax-root" }),
        runOf(100),
      );
      expect(found(result.changes)).toEqual({
        added: ["ax-dom-12"],
        changed: [],
        removed: [],
      });
      expect(result.base.runBefore).toEqual({
        nodes: ALONE,
        rootId: "ax-dom-10",
      });
      expect(result.base.rootId).toBe("ax-root");
    });

    it("charges a row that went with the synthetic root above it to the later read's root", () => {
      const result = compareRead(
        baseOf(WITH_TOAST, null, "ax-root"),
        WITH_TOAST,
        readOf(ALONE, { rootId: "ax-dom-10" }),
        runOf(100),
      );
      expect(found(result.changes)?.removed).toEqual(["ax-dom-12"]);
      expect([...result.changes!.removedUnder]).toEqual([["ax-dom-10", 1]]);
      expect(result.changes!.stops).toEqual(["ax-dom-10"]);
    });
  });

  describe("around a dialog in front of the page", () => {
    // The page before the dialog: two landmarks under the synthetic root.
    const PAGE = tree(
      n("ax-root", "document", "", ["ax-dom-30", "ax-dom-31"]),
      n("ax-dom-30", "button", "Add address"),
      n("ax-dom-31", "main", "", ["ax-dom-32"]),
      n("ax-dom-32", "status", "No address"),
    );
    /** A dialog, alone in the tree as a modal leaves it, with or without
     *  Chrome's `modal` state: a `showModal()` dialog has it, one whose page
     *  a library hides with `aria-hidden` (Radix) doesn't. */
    const dialog = (street = "", modal = true) =>
      tree(
        n("ax-dom-40", "dialog", "Address", ["ax-dom-41", "ax-dom-42"], {
          states: modal ? { modal: true } : {},
        }),
        n(
          "ax-dom-41",
          "textbox",
          "Street",
          [],
          street ? { value: street } : {},
        ),
        n("ax-dom-42", "button", "Save"),
      );
    // Saved and closed: the page is back, with the one change Save made.
    const SAVED = tree(
      n("ax-root", "document", "", ["ax-dom-30", "ax-dom-31"]),
      n("ax-dom-30", "button", "Add address"),
      n("ax-dom-31", "main", "", ["ax-dom-32"]),
      n("ax-dom-32", "status", "12 Mill Lane"),
    );
    const onPage = { rootId: "ax-root" };
    const inDialog = { rootId: "ax-dom-40" };

    /** The action's re-read that opened `opened`. */
    function opening(opened = dialog(), over = inDialog) {
      return compareRead(
        baseOf(PAGE, null, "ax-root"),
        PAGE,
        readOf(opened, over),
        runOf(100),
      );
    }

    it.each([
      ["with Chrome's modal state", true],
      ["without it, its page hidden by a library", false],
    ])(
      "marks the dialog new, %s, and nothing removed for the page behind it",
      (_how, modal) => {
        const result = opening(dialog("", modal));
        expect(found(result.changes)).toEqual({
          added: ["ax-dom-40", "ax-dom-41", "ax-dom-42"],
          changed: [],
          removed: [],
        });
        expect(result.changes!.removedUnder.size).toBe(0);
        expect(result.changes!.stops).toEqual(["ax-dom-40"]);
        expect(result.base.dialogs).toEqual([
          { dialogId: "ax-dom-40", before: { nodes: PAGE, rootId: "ax-root" } },
        ]);
      },
    );

    it("takes a dialog for one in front of the page beside a live region the library left", () => {
      // `aria-hidden` everywhere else keeps a live region: the tree is the
      // region and the dialog, under the synthetic root.
      const WITH_REGION = tree(
        n("ax-root", "document", "", ["ax-dom-32", "ax-dom-40"]),
        n("ax-dom-32", "status", "No address"),
        n("ax-dom-40", "dialog", "Address", ["ax-dom-41", "ax-dom-42"]),
        n("ax-dom-41", "textbox", "Street"),
        n("ax-dom-42", "button", "Save"),
      );
      const result = opening(WITH_REGION, onPage);
      expect(found(result.changes)).toEqual({
        added: ["ax-dom-40", "ax-dom-41", "ax-dom-42"],
        changed: [],
        removed: [],
      });
      expect(result.base.dialogs.map((d) => d.dialogId)).toEqual(["ax-dom-40"]);
    });

    it("doesn't take a dialog that comes with content the page swapped in for one in front of it", () => {
      // A loading page, then the page it loaded, with a cookie banner that
      // is a dialog among the rest.
      const LOADING = tree(
        n("ax-root", "document", "", ["ax-dom-70", "ax-dom-71"]),
        n("ax-dom-70", "status", "Loading"),
        n("ax-dom-71", "generic", ""),
      );
      const COOKIES = n("ax-dom-80", "dialog", "Cookies", ["ax-dom-81"]);
      const ACCEPT = n("ax-dom-81", "button", "Accept");
      const LOADED = tree(
        n("ax-root", "document", "", ["ax-dom-30", "ax-dom-31", "ax-dom-80"]),
        n("ax-dom-30", "button", "Add address"),
        n("ax-dom-31", "main", "", ["ax-dom-32"]),
        n("ax-dom-32", "status", "No address"),
        COOKIES,
        ACCEPT,
      );
      const loaded = compareRead(
        baseOf(LOADING, null, "ax-root"),
        LOADING,
        readOf(LOADED, onPage),
        runOf(100),
      );
      expect(found(loaded.changes)).toEqual({
        added: [
          "ax-dom-30",
          "ax-dom-31",
          "ax-dom-32",
          "ax-dom-80",
          "ax-dom-81",
        ],
        changed: [],
        removed: ["ax-dom-70", "ax-dom-71"],
      });
      expect(loaded.base.dialogs).toEqual([]);
      // Accepting the cookies takes the banner away, and nothing else.
      const accepted = compareRead(
        loaded.base,
        LOADED,
        readOf(new Map([...LOADED].slice(0, 4)), onPage),
        runOf(200),
      );
      expect(found(accepted.changes)).toEqual({
        added: [],
        changed: [],
        removed: ["ax-dom-80", "ax-dom-81"],
      });
    });

    it("takes a dialog that comes, with the page back around it, as one closes for one that came as it closed", () => {
      // Saving closed the dialog, and the page says so in an alertdialog.
      const SAVED_WITH_UNDO = tree(
        n("ax-root", "document", "", ["ax-dom-30", "ax-dom-31", "ax-dom-90"]),
        n("ax-dom-30", "button", "Add address"),
        n("ax-dom-31", "main", "", ["ax-dom-32"]),
        n("ax-dom-32", "status", "12 Mill Lane"),
        n("ax-dom-90", "alertdialog", "Saved", ["ax-dom-91"]),
        n("ax-dom-91", "button", "Undo"),
      );
      const result = compareRead(
        opening().base,
        dialog(),
        readOf(SAVED_WITH_UNDO, onPage),
        runOf(300),
      );
      expect(found(result.changes)).toEqual({
        added: ["ax-dom-90", "ax-dom-91"],
        changed: ["ax-dom-32"],
        removed: [],
      });
      expect(result.base.dialogs).toEqual([]);
    });

    it("counts what went for a dialog that leaves the page in the tree, as an aria-modal one can", () => {
      // The page's Actions menu closed as the dialog opened beside it.
      const WITH_MENU = tree(
        n("ax-root", "document", "", ["ax-dom-30", "ax-dom-31", "ax-dom-50"]),
        n("ax-dom-30", "button", "Add address"),
        n("ax-dom-31", "main", "", ["ax-dom-32"]),
        n("ax-dom-32", "status", "No address"),
        n("ax-dom-50", "menu", "Actions"),
      );
      const BESIDE = tree(
        n("ax-root", "document", "", ["ax-dom-30", "ax-dom-31", "ax-dom-40"]),
        n("ax-dom-30", "button", "Add address"),
        n("ax-dom-31", "main", "", ["ax-dom-32"]),
        n("ax-dom-32", "status", "No address"),
        n("ax-dom-40", "dialog", "Address", ["ax-dom-41"], {
          states: { modal: true },
        }),
        n("ax-dom-41", "textbox", "Street"),
      );
      const opened = compareRead(
        baseOf(WITH_MENU, null, "ax-root"),
        WITH_MENU,
        readOf(BESIDE, onPage),
        runOf(100),
      );
      expect(found(opened.changes)).toEqual({
        added: ["ax-dom-40", "ax-dom-41"],
        changed: [],
        removed: ["ax-dom-50"],
      });
      expect(opened.base.dialogs).toEqual([]);
      // Closing it compares with the tree on screen, not with the page from
      // before it: the menu's going is not found again.
      const closed = compareRead(
        opened.base,
        BESIDE,
        readOf(PAGE, onPage),
        runOf(200),
      );
      expect(found(closed.changes)).toEqual({
        added: [],
        changed: [],
        removed: ["ax-dom-40", "ax-dom-41"],
      });
    });

    it("keeps the page behind it unremoved through a follow-up in the same run", () => {
      const result = compareRead(
        opening().base,
        dialog(),
        readOf(dialog(), inDialog),
        runOf(100),
      );
      expect(found(result.changes)).toEqual({
        added: ["ax-dom-40", "ax-dom-41", "ax-dom-42"],
        changed: [],
        removed: [],
      });
      expect(result.base.dialogs).toHaveLength(1);
      expect(result.base.dialogs[0]!.before.nodes).toBe(PAGE);
    });

    it("compares within the dialog while it stays open", () => {
      const result = compareRead(
        opening().base,
        dialog(),
        readOf(dialog("12 Mill Lane"), inDialog),
        runOf(200),
      );
      expect(found(result.changes)).toEqual({
        added: [],
        changed: ["ax-dom-41"],
        removed: [],
      });
      expect(result.base.dialogs[0]!.before.nodes).toBe(PAGE);
    });

    it.each([
      ["with Chrome's modal state", true],
      ["without it", false],
    ])(
      "marks what the dialog, %s, changed on the page when it closes, compared with the page from before it",
      (_how, modal) => {
        const typed = compareRead(
          opening(dialog("", modal)).base,
          dialog("", modal),
          readOf(dialog("12 Mill Lane", modal), inDialog),
          runOf(200),
        );
        const result = compareRead(
          typed.base,
          dialog("12 Mill Lane", modal),
          readOf(SAVED, onPage),
          runOf(300),
        );
        expect(found(result.changes)).toEqual({
          added: [],
          changed: ["ax-dom-32"],
          removed: [],
        });
        expect(result.base.dialogs).toEqual([]);
        expect(result.base.runBefore.nodes).toBe(PAGE);
        // A follow-up of that run compares with the same page.
        const after = compareRead(
          result.base,
          SAVED,
          readOf(new Map(SAVED), onPage),
          runOf(300),
        );
        expect(found(after.changes)?.changed).toEqual(["ax-dom-32"]);
      },
    );

    describe("with a dialog opened over another", () => {
      // A confirm opened over the dialog: Chromium keeps only the one in
      // front.
      const CONFIRM = tree(
        n("ax-dom-60", "alertdialog", "Discard?", ["ax-dom-61", "ax-dom-62"], {
          states: { modal: true },
        }),
        n("ax-dom-61", "button", "Keep editing"),
        n("ax-dom-62", "button", "Discard"),
      );
      const inConfirm = { rootId: "ax-dom-60" };

      function confirming() {
        const typed = compareRead(
          opening().base,
          dialog(),
          readOf(dialog("12 Mill Lane"), inDialog),
          runOf(200),
        );
        return compareRead(
          typed.base,
          dialog("12 Mill Lane"),
          readOf(CONFIRM, inConfirm),
          runOf(300),
        );
      }

      it("marks the one in front new, and nothing removed for the one behind it", () => {
        const result = confirming();
        expect(found(result.changes)).toEqual({
          added: ["ax-dom-60", "ax-dom-61", "ax-dom-62"],
          changed: [],
          removed: [],
        });
        expect(result.base.dialogs.map((d) => d.dialogId)).toEqual([
          "ax-dom-40",
          "ax-dom-60",
        ]);
      });

      it("compares with the dialog behind it when the one in front closes", () => {
        const back = compareRead(
          confirming().base,
          CONFIRM,
          readOf(dialog("12 Mill Lane"), inDialog),
          runOf(400),
        );
        expect(back.changes).toBeNull();
        expect(back.base.dialogs.map((d) => d.dialogId)).toEqual(["ax-dom-40"]);
        // And with the page once that one closes too.
        const saved = compareRead(
          back.base,
          dialog("12 Mill Lane"),
          readOf(SAVED, onPage),
          runOf(500),
        );
        expect(found(saved.changes)?.changed).toEqual(["ax-dom-32"]);
        expect(saved.base.dialogs).toEqual([]);
      });

      it("compares with the page when both close at once", () => {
        const result = compareRead(
          confirming().base,
          CONFIRM,
          readOf(SAVED, onPage),
          runOf(400),
        );
        expect(found(result.changes)).toEqual({
          added: [],
          changed: ["ax-dom-32"],
          removed: [],
        });
        expect(result.base.dialogs).toEqual([]);
      });
    });

    it("marks nothing when a dialog it never saw open closes, rather than the whole page as new", () => {
      const result = compareRead(
        baseOf(dialog(), null, "ax-dom-40"),
        dialog(),
        readOf(SAVED, onPage),
        runOf(300),
      );
      expect(result.changes).toBeNull();
      expect(result.base.dialogs).toEqual([]);
    });
  });
});

describe("useNativeChanges", () => {
  let container: HTMLDivElement;
  let hook: ReturnType<typeof useNativeChanges>;
  let show: (nodes: Map<string, NativeNode>) => void;

  /** The panel as far as the marks go: the tree on screen, and its marks. */
  function Host() {
    const [nodes, setNodes] = useState<Map<string, NativeNode>>(new Map());
    show = setNodes;
    hook = useNativeChanges(nodes);
    return null;
  }

  /** A read in the run `follows` names, which the user caused or which
   *  follows up what they did: what it finds is said. */
  const inRun = (follows: number): ReadRun => ({ follows, announce: true });
  /** An automatic read: a run of its own, kept quiet. */
  const AUTO: ReadRun = { follows: null, announce: false };

  beforeEach(() => {
    container = document.createElement("div");
  });

  afterEach(() => {
    render(null, container);
  });

  /** A read of `tabId` comes back, taken as `App.tsx` takes it: noted
   *  before the tree on screen is replaced with it. */
  function land(
    nodes: Map<string, NativeNode>,
    run: ReadRun,
    page: {
      rootId?: string;
      documentId?: string;
      documentChanged?: boolean;
    } = SHOP,
    tabId = 1,
  ) {
    act(() => {
      hook.noteRead(tabId, page, nodes, run);
      show(nodes);
    });
  }

  /** The panel, with `first` on screen as its first read (an automatic
   *  one) put it there, or with no tree. */
  function mount(first: Map<string, NativeNode> | null = CLOSED) {
    act(() => {
      render(<Host />, container);
    });
    if (first) land(first, AUTO);
  }

  it("marks nothing for the first read, with no tree on screen to compare with", () => {
    mount(null);
    expect(hook.marks).toBeNull();
    land(CLOSED, inRun(100));
    expect(hook.marks).toBeNull();
  });

  it("marks what a read the user caused found, and says it", () => {
    mount();
    land(OPENED, inRun(100));
    expect(hook.marks).toEqual({
      changes: diffNativeTrees(CLOSED, OPENED, ROOT),
      seq: expect.any(Number),
      announce: true,
    });
    expect(hook.marks!.changes.changed.get("ax-dom-2")).toEqual([
      WENT_EXPANDED,
    ]);
  });

  it("marks what an automatic read found without saying it", () => {
    mount();
    land(OPENED, AUTO);
    expect(found(hook.marks?.changes)).toEqual({
      added: ["ax-dom-4"],
      changed: ["ax-dom-2"],
      removed: [],
    });
    expect(hook.marks?.announce).toBe(false);
  });

  it("keeps what an action's re-read found marked when a follow-up in its run finds the rest", () => {
    mount();
    land(OPENED, inRun(100));
    land(FILLED, inRun(100));
    expect(found(hook.marks?.changes)).toEqual({
      added: ["ax-dom-4", "ax-dom-5", "ax-dom-6"],
      changed: ["ax-dom-2"],
      removed: [],
    });
    expect(hook.marks!.changes.changed.get("ax-dom-2")).toEqual([
      WENT_EXPANDED,
    ]);
    expect(hook.marks?.announce).toBe(true);
  });

  it("gives each read that marks something a later seq, even one that finds what the read before it found", () => {
    mount();
    land(OPENED, inRun(100));
    const first = hook.marks!;
    land(FILLED, inRun(100));
    const second = hook.marks!;
    land(new Map(FILLED), inRun(100));
    const third = hook.marks!;
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(third.seq).toBeGreaterThan(second.seq);
    expect(third.changes).toEqual(second.changes);
  });

  it("compares a read that starts a run with the tree on screen", () => {
    mount();
    land(OPENED, inRun(100));
    land(FILLED, inRun(200));
    expect(found(hook.marks?.changes)).toEqual({
      added: ["ax-dom-5", "ax-dom-6"],
      changed: [],
      removed: [],
    });
  });

  it("drops the marks when a read the user caused finds nothing changed", () => {
    mount();
    land(OPENED, inRun(100));
    land(new Map(OPENED), inRun(200));
    expect(hook.marks).toBeNull();
  });

  it("keeps the marks through an automatic read that finds nothing changed, and compares the next read with that one", () => {
    mount();
    land(OPENED, inRun(100));
    const marks = hook.marks;
    expect(marks).not.toBeNull();
    // The page changed where the tree doesn't show it.
    land(new Map(OPENED), AUTO);
    expect(hook.marks).toBe(marks);
    land(FILLED, AUTO);
    expect(found(hook.marks?.changes)).toEqual({
      added: ["ax-dom-5", "ax-dom-6"],
      changed: [],
      removed: [],
    });
  });

  it("still drops the marks for an automatic read of another document", () => {
    mount();
    land(OPENED, inRun(100));
    land(CHECKOUT_LOADING, AUTO, CHECKOUT);
    expect(hook.marks).toBeNull();
  });

  it("keeps the marks through a render that leaves a tree on screen", () => {
    mount();
    land(OPENED, inRun(100));
    const marks = hook.marks;
    expect(marks).not.toBeNull();
    act(() => show(new Map(OPENED)));
    expect(hook.marks).toBe(marks);
  });

  it("drops the marks when the tree goes, and forgets the tree they compared with", () => {
    mount();
    land(OPENED, inRun(100));
    act(() => show(new Map())); // a navigation, a tab switch, a failed read
    expect(hook.marks).toBeNull();
    // A tree back on screen without a read: had the run's base been kept, a
    // follow-up in the run would be compared with CLOSED and mark the lot.
    act(() => show(OPENED));
    land(FILLED, inRun(100));
    expect(hook.marks).toBeNull();
    // The read after it compares as usual.
    land(CLOSED, inRun(300));
    expect(found(hook.marks?.changes)?.removed).toEqual([
      "ax-dom-4",
      "ax-dom-5",
      "ax-dom-6",
    ]);
  });

  it("leaves nothing marked after a read that comes back with no rows", () => {
    mount();
    land(OPENED, inRun(100));
    land(new Map(), inRun(200));
    expect(hook.marks).toBeNull();
  });

  it.each([
    ["another tab", 2, SHOP, FILLED],
    ["another document", 1, { rootId: ROOT, documentId: "D2" }, FILLED],
    ["a document it has no id for", 1, { rootId: ROOT }, FILLED],
  ] as const)(
    "drops the marks for a read of %s, which it doesn't compare",
    (_what, tabId, page, nodes) => {
      mount();
      land(OPENED, inRun(100));
      expect(hook.marks).not.toBeNull();
      land(nodes, inRun(100), page, tabId);
      expect(hook.marks).toBeNull();
    },
  );

  it("compares a run's reads of the page it navigated to with that page's first read", () => {
    mount();
    land(OPENED, inRun(100));
    land(CHECKOUT_LOADING, inRun(100), CHECKOUT);
    expect(hook.marks).toBeNull();
    land(CHECKOUT_LOADED, inRun(100), CHECKOUT);
    expect(found(hook.marks?.changes)).toEqual({
      added: ["ax-dom-52"],
      changed: [],
      removed: [],
    });
  });

  it("marks nothing in a read whose document changed as it was taken", () => {
    mount();
    land(OPENED, inRun(100), { ...SHOP, documentChanged: true });
    expect(hook.marks).toBeNull();
    // The read after it compares with what that read put on screen.
    land(FILLED, inRun(200));
    expect(found(hook.marks?.changes)?.added).toEqual(["ax-dom-5", "ax-dom-6"]);
  });

  it("drops the marks on clear", () => {
    mount();
    land(OPENED, inRun(100));
    act(() => hook.clear());
    expect(hook.marks).toBeNull();
  });

  it("doesn't bring cleared marks back in a later read of the same run, but marks what is new since", () => {
    mount();
    land(OPENED, inRun(100));
    act(() => hook.clear());
    land(new Map(OPENED), inRun(100));
    expect(hook.marks).toBeNull();
    land(FILLED, inRun(100));
    expect(found(hook.marks?.changes)).toEqual({
      added: ["ax-dom-5", "ax-dom-6"],
      changed: [],
      removed: [],
    });
    expect(hook.marks?.announce).toBe(true);
  });

  it("clears nothing it shouldn't before any read", () => {
    mount(null);
    act(() => hook.clear());
    expect(hook.marks).toBeNull();
    land(CLOSED, AUTO);
    land(OPENED, inRun(100));
    expect(found(hook.marks?.changes)).toEqual({
      added: ["ax-dom-4"],
      changed: ["ax-dom-2"],
      removed: [],
    });
  });

  it("compares with the tree on screen now through a noteRead and clear kept from the first render", () => {
    // App.tsx's read callback keeps the hook's functions from the render it
    // was made in, while the tree on screen moves on.
    mount(null);
    const { noteRead, clear } = hook;
    const landKept = (nodes: Map<string, NativeNode>, run: ReadRun) =>
      act(() => {
        noteRead(1, SHOP, nodes, run);
        show(nodes);
      });
    landKept(CLOSED, AUTO);
    landKept(OPENED, inRun(100));
    expect(found(hook.marks?.changes)?.added).toEqual(["ax-dom-4"]);
    landKept(FILLED, inRun(200));
    expect(found(hook.marks?.changes)).toEqual({
      added: ["ax-dom-5", "ax-dom-6"],
      changed: [],
      removed: [],
    });
    act(() => clear());
    expect(hook.marks).toBeNull();
    landKept(new Map(FILLED), inRun(200));
    expect(hook.marks).toBeNull();
  });
});
