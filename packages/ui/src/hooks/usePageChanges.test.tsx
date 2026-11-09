import { PANEL_HOST_ATTRIBUTE } from "@real-a11y-dev/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DialogRules } from "../tree-changes-dialogs.js";
import type { Tree } from "../tree-changes-diff.js";

import { FOLLOW_MS, usePageChanges } from "./usePageChanges.js";

/**
 * Which update of a live tree the marks compare with, and which they say:
 * the updates that follow up a click or a key on the page, or an action
 * sent through the tree, are one run, compared with the tree from before it
 * and said; typing ends that; any other update is marked, not said; and a
 * checkpoint pins what every update compares with.
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

/** The page, with the button named `button` and the rows of `extra`. */
function page(button: string, ...extra: string[]): Tree<Row> {
  const rows: [string, Row][] = [
    ["button", { role: "button", name: button }],
    ["link", { role: "link", name: "Home" }],
    ...extra.map((id): [string, Row] => [id, { role: "listitem", name: id }]),
  ];
  return {
    rootId: "root",
    nodes: new Map<string, Row>([
      ["root", { role: "generic", name: "", childIds: rows.map(([id]) => id) }],
      ...rows,
    ]),
  };
}

describe("usePageChanges", () => {
  let container: HTMLDivElement;
  let pageButton: HTMLButtonElement;
  let clock = 1000;
  let view: ReturnType<typeof usePageChanges<Row>>;

  function Host({ live = true }: { live?: boolean }) {
    view = usePageChanges({ rules: RULES, live, doc: document });
    return null;
  }

  const mount = (live?: boolean) =>
    act(() => {
      render(<Host live={live} />, container);
    });
  /** An update of the tree: `read` replaces `onScreen`. */
  const update = (onScreen: Tree<Row> | null, read: Tree<Row>) =>
    act(() => view.noteRead(onScreen, read));
  const added = () => [...(view.marks?.changes.added ?? [])];
  const changed = () => [...(view.marks?.changes.changed.keys() ?? [])];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    pageButton = document.createElement("button");
    document.body.appendChild(pageButton);
    clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    pageButton.remove();
    vi.restoreAllMocks();
  });

  it("marks an update nobody caused without saying it", () => {
    mount();
    update(null, page("Open"));
    expect(view.marks).toBeNull();
    update(page("Open"), page("Close"));
    expect(changed()).toEqual(["button"]);
    expect(view.marks!.announce).toBe(false);
  });

  it("keeps the marks through an update nobody caused that changes nothing shown", () => {
    mount();
    update(page("Open"), page("Close"));
    const marks = view.marks;
    update(page("Close"), page("Close"));
    expect(view.marks).toBe(marks);
  });

  it("says what follows a click on the page, and keeps all of it marked", () => {
    mount();
    update(null, page("Open"));
    pageButton.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    clock += 100;
    update(page("Open"), page("Close"));
    expect(view.marks!.announce).toBe(true);
    // The items the page fetched for the click, a moment later: the button's
    // change stays marked with them.
    clock += 1000;
    update(page("Close"), page("Close", "one", "two"));
    expect(changed()).toEqual(["button"]);
    expect(added()).toEqual(["one", "two"]);
    expect(view.marks!.announce).toBe(true);
    // Past the follow window, an update is a run of its own again.
    clock += FOLLOW_MS;
    update(page("Close", "one", "two"), page("Close", "one"));
    expect(view.marks!.announce).toBe(false);
    expect(view.marks!.changes.removed.map((r) => r.id)).toEqual(["two"]);
  });

  it("takes a click with no press before it, as a screen reader's, for the user acting", () => {
    mount();
    update(null, page("Open"));
    pageButton.click();
    update(page("Open"), page("Close"));
    expect(view.marks!.announce).toBe(true);
  });

  it("takes a click soon after an ignored key for an act of its own", () => {
    let picking = true;
    function Picking() {
      view = usePageChanges({
        rules: RULES,
        live: true,
        doc: document,
        ignoreInput: () => picking,
      });
      return null;
    }
    act(() => {
      render(<Picking />, container);
    });
    update(null, page("Open"));
    // Escape ends pick mode: a key, ignored, which makes no click.
    pageButton.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    picking = false;
    clock += 200;
    pageButton.click();
    update(page("Open"), page("Close"));
    expect(view.marks!.announce).toBe(true);
  });

  it("takes a click right after typing for an act of its own", () => {
    mount();
    update(null, page("Open"));
    pageButton.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    pageButton.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText" }),
    );
    clock += 500;
    pageButton.click();
    update(page("Open"), page("Close"));
    expect(view.marks!.announce).toBe(true);
  });

  it("keeps a press and its own click one act", () => {
    mount();
    update(null, page("Open"));
    pageButton.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    clock += 100;
    update(page("Open"), page("Close"));
    clock += 100;
    pageButton.click();
    clock += 500;
    // Still the press's run: compared with the tree from before it.
    update(page("Close"), page("Close", "one"));
    expect(changed()).toEqual(["button"]);
    expect(added()).toEqual(["one"]);
  });

  it("ignores the page's input while told to, as during a pick", () => {
    let picking = true;
    function Picking() {
      view = usePageChanges({
        rules: RULES,
        live: true,
        doc: document,
        ignoreInput: () => picking,
      });
      return null;
    }
    act(() => {
      render(<Picking />, container);
    });
    update(null, page("Open"));
    pageButton.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    pageButton.click();
    update(page("Open"), page("Close"));
    expect(view.marks!.announce).toBe(false);
    // A pick's own click, after the picker turned itself off: still the pick.
    picking = true;
    pageButton.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    picking = false;
    pageButton.click();
    update(page("Close"), page("Open"));
    expect(view.marks!.announce).toBe(false);
    clock += 1000;
    pageButton.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    update(page("Open"), page("Close"));
    expect(view.marks!.announce).toBe(true);
  });

  it("takes away the marks of a dialog that closed on its own", () => {
    mount();
    const dialog: Tree<Row> = {
      rootId: "dialog",
      nodes: new Map<string, Row>([
        ["dialog", { role: "dialog", name: "Saved", childIds: ["ok"] }],
        ["ok", { role: "button", name: "OK" }],
      ]),
    };
    update(null, page("Open"));
    update(page("Open"), dialog);
    expect(added()).toEqual(["dialog", "ok"]);
    update(dialog, page("Open"));
    expect(view.marks).toBeNull();
  });

  it("follows an action sent through the tree as it does a click", () => {
    mount();
    update(null, page("Open"));
    act(() => view.noteAction());
    update(page("Open"), page("Close"));
    expect(view.marks!.announce).toBe(true);
  });

  it("stops saying what follows once the user types in a field", () => {
    mount();
    update(null, page("Open"));
    pageButton.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    pageButton.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText" }),
    );
    clock += 100;
    update(page("Open"), page("Open", "match"));
    expect(view.marks!.announce).toBe(false);
  });

  it("takes a checkbox's input for a click's, not for typing", () => {
    mount();
    update(null, page("Open"));
    pageButton.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    pageButton.dispatchEvent(new Event("input", { bubbles: true }));
    update(page("Open"), page("Close"));
    expect(view.marks!.announce).toBe(true);
  });

  it("takes nothing done in a panel for something done on the page", () => {
    mount();
    const panelHost = document.createElement("div");
    panelHost.setAttribute(PANEL_HOST_ATTRIBUTE, "");
    const inside = document.createElement("button");
    panelHost.appendChild(inside);
    document.body.appendChild(panelHost);
    try {
      update(null, page("Open"));
      inside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      update(page("Open"), page("Close"));
      expect(view.marks!.announce).toBe(false);
    } finally {
      panelHost.remove();
    }
  });

  it("marks nothing while off, and starts from the tree on screen once on", () => {
    mount(false);
    update(null, page("Open"));
    update(page("Open"), page("Close"));
    expect(view.marks).toBeNull();
    mount(true);
    update(page("Close"), page("Open"));
    expect(changed()).toEqual(["button"]);
    expect(view.marks!.changes.changed.get("button")).toEqual([
      { field: "name", before: "Close", after: "Open" },
    ]);
  });

  it("marks everything since a checkpoint, off or on", () => {
    mount(false);
    update(null, page("Open"));
    act(() => view.pin(page("Open")));
    expect(view.pinned).toBe(true);
    update(page("Open"), page("Close"));
    update(page("Close"), page("Close", "one"));
    expect(changed()).toEqual(["button"]);
    expect(added()).toEqual(["one"]);
    act(() => view.pin(null));
    expect(view.pinned).toBe(false);
    expect(view.marks).toBeNull();
  });

  it("says nothing changed since the checkpoint once the user undoes it all", () => {
    mount();
    act(() => view.pin(page("Open")));
    pageButton.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    update(page("Open"), page("Close"));
    expect(changed()).toEqual(["button"]);
    clock += FOLLOW_MS;
    pageButton.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    update(page("Close"), page("Open"));
    // Marks with nothing in them, said: the user caused it.
    expect(view.marks!.changes.added.size).toBe(0);
    expect(view.marks!.changes.changed.size).toBe(0);
    expect(view.marks!.announce).toBe(true);
    clock += FOLLOW_MS;
    update(page("Open"), page("Open"));
    expect(view.marks).toBeNull();
  });

  it("starts the checkpoint over from the tree as it is, from the bar's ✕", () => {
    mount();
    act(() => view.pin(page("Open")));
    update(page("Open"), page("Close"));
    act(() => view.clear());
    expect(view.marks).toBeNull();
    update(page("Close"), page("Close", "one"));
    expect(changed()).toEqual([]);
    expect(added()).toEqual(["one"]);
  });

  it("forgets the checkpoint and the marks on a reset", () => {
    mount();
    act(() => view.pin(page("Open")));
    update(page("Open"), page("Close"));
    act(() => view.reset());
    expect(view.pinned).toBe(false);
    expect(view.marks).toBeNull();
    update(null, page("Close"));
    expect(view.marks).toBeNull();
  });
});
