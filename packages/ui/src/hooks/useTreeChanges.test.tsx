import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { RowChangeTags } from "../components/RowChangeTags.js";
import {
  ChangeNoticeRegion,
  TreeChangesBar,
} from "../components/TreeChangesBar.js";
import type { TreeChanges, TreeRow } from "../tree-changes-diff.js";
import type { ChangeMarks, RowChangeMarks } from "../tree-changes.js";

import { useHiddenChanges, useTreeChanges } from "./useTreeChanges.js";

/**
 * The change marks' view side as the ui package ships it, apart from any
 * tree view: what the hook does with a read's marks (flash, open in the
 * render that brings them, say, go from change to change), what a shown row
 * stands in for, and what the bar and a row's tags show. The
 * extension's `NativeTreeView.changes.test.tsx` takes them through Chrome's
 * tree in full.
 */

/** A page whose menu opened: the menu and its two items are new, its
 *  button changed. */
const NODES = new Map<string, TreeRow>([
  ["root", { childIds: ["button", "menu", "status"] }],
  ["button", {}],
  ["menu", { childIds: ["home", "sale"] }],
  ["home", {}],
  ["sale", {}],
  ["status", {}],
]);
const PARENT_OF = new Map([
  ["button", "root"],
  ["menu", "root"],
  ["status", "root"],
  ["home", "menu"],
  ["sale", "menu"],
]);
const OPENED: TreeChanges = {
  added: new Set(["menu", "home", "sale"]),
  changed: new Map([
    ["button", [{ field: "states.expanded", before: false, after: true }]],
  ]),
  removed: [{ id: "note", role: "note", name: "Pick a section" }],
  removedUnder: new Map([["status", 1]]),
  stops: ["button", "menu", "status"],
};

describe("useTreeChanges", () => {
  let container: HTMLDivElement;
  let view: ReturnType<typeof useTreeChanges>;
  let hidden: ReturnType<typeof useHiddenChanges>;
  /** The rows the view keeps open, as of its last render. */
  let kept: Set<string>;
  let jumpTo: Mock<(id: string) => void>;

  function Host({
    marks,
    selectedId = null,
  }: {
    marks: ChangeMarks | null;
    selectedId?: string | null;
  }) {
    const [expanded, setExpanded] = useState(() => new Set(["root"]));
    kept = expanded;
    view = useTreeChanges({
      changes: marks,
      nodes: NODES,
      rootId: "root",
      parentOf: PARENT_OF,
      selectedId,
      expanded,
      setExpanded,
      jumpTo,
    });
    hidden = useHiddenChanges(
      view,
      ["root", "button", "menu", "status"],
      PARENT_OF,
    );
    return <ChangeNoticeRegion notice={view.notice} />;
  }

  const show = (marks: ChangeMarks | null, selectedId?: string | null) =>
    act(() => {
      render(<Host marks={marks} selectedId={selectedId} />, container);
    });
  const said = () => container.textContent;

  beforeEach(() => {
    container = document.createElement("div");
    jumpTo = vi.fn();
  });

  afterEach(() => {
    render(null, container);
  });

  it("neither opens, flashes nor says the marks a view mounts with", () => {
    show({ changes: OPENED, seq: 1, announce: true });
    expect([...view.expanded]).toEqual(["root"]);
    expect(view.flashes.size).toBe(0);
    expect(said()).toBe("");
  });

  it("opens, flashes and says what a read the user caused found", () => {
    show(null);
    show({ changes: OPENED, seq: 1, announce: true });
    // Open for the view at once, and kept open once the read is taken in.
    expect([...view.expanded].sort()).toEqual(["menu", "root"]);
    expect([...kept].sort()).toEqual(["menu", "root"]);
    expect([...view.flashes.keys()].sort()).toEqual([
      "button",
      "home",
      "menu",
      "sale",
      "status",
    ]);
    expect(said()).toBe("3 new, 1 changed, 1 removed in the tree");
  });

  it("marks what an automatic read found without saying it, and takes what was said away with the marks", () => {
    show(null);
    show({ changes: OPENED, seq: 1, announce: true });
    show({ changes: OPENED, seq: 2, announce: false });
    expect(said()).toBe("3 new, 1 changed, 1 removed in the tree");
    show(null);
    expect(said()).toBe("");
  });

  it("goes from change to change, and says when there is none", () => {
    show(null);
    show({ changes: OPENED, seq: 1, announce: true }, "button");
    act(() => view.goToChange(false));
    expect(jumpTo).toHaveBeenLastCalledWith("menu");
    act(() => view.goToChange(true));
    expect(jumpTo).toHaveBeenLastCalledWith("status");

    show(null);
    act(() => view.goToChange(false));
    expect(said()).toBe("No changes since the read before");
  });

  it("counts on a shown row the changes under it that have no row on screen", () => {
    show(null);
    show({ changes: OPENED, seq: 1, announce: true });
    // The menu's items are new with it, so nothing stands in for them.
    expect(Object.fromEntries(hidden ?? [])).toEqual({
      status: {
        added: 0,
        changed: 0,
        removed: 1,
        fresh: true,
        flashUntil: expect.any(Number),
      },
    });
  });
});

describe("TreeChangesBar", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  afterEach(() => {
    render(null, container);
  });

  it("sums up the read, goes from change to change, clears, and lists the rows that went", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onClear = vi.fn();
    render(
      <TreeChangesBar
        changes={OPENED}
        onPrevious={onPrevious}
        onNext={onNext}
        onClear={onClear}
      />,
      container,
    );
    const bar = container.querySelector('[role="group"]')!;
    expect(bar.getAttribute("aria-label")).toBe(
      "Changes since the read before",
    );
    expect(container.querySelector(".sn-changes-summary")!.textContent).toBe(
      "3 new, 1 changed, 1 removed",
    );
    const button = (name: string) =>
      container.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
    button("Previous change").click();
    button("Next change").click();
    button("Clear change marks").click();
    expect(
      [onPrevious, onNext, onClear].map((f) => f.mock.calls.length),
    ).toEqual([1, 1, 1]);
    expect(container.querySelector(".sn-removed-item")!.textContent).toBe(
      'note "Pick a section"',
    );
  });
});

describe("RowChangeTags", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  afterEach(() => {
    render(null, container);
  });

  const tags = (marks: RowChangeMarks) => {
    render(<RowChangeTags marks={marks} />, container);
    return [...container.querySelectorAll<HTMLElement>(".sn-change-tag")];
  };

  it("tags the top row of a new subtree, hidden from a screen reader", () => {
    const [tag] = tags({ isNew: true, newTop: true });
    expect(tag!.textContent).toBe("new");
    expect(tag!.getAttribute("aria-hidden")).toBe("true");
  });

  it("tags a changed row with what it was before in its title", () => {
    const [tag] = tags({
      isNew: false,
      newTop: false,
      changes: [{ field: "states.expanded", before: false, after: true }],
    });
    expect(tag!.textContent).toBe("changed");
    expect(tag!.title).toBe(
      "Changed since the read before:\nexpanded: collapsed → expanded",
    );
  });

  it("says what a row stands in for under it, flashing while one of them does", () => {
    const [tag] = tags({
      isNew: false,
      newTop: false,
      hidden: { added: 2, changed: 0, removed: 1, fresh: true, flashUntil: 9 },
    });
    expect(tag!.textContent).toBe("2 new, 1 removed inside");
    expect(tag!.classList).toContain("sn-change-tag--flash");
  });
});
