import { extractA11yTree } from "@real-a11y-dev/core";
import { render, type ComponentProps } from "preact";
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

import type { NativeNode } from "../native/native-actions.js";
import {
  diffNativeTrees,
  type NativeTreeChanges,
} from "../native/native-tree-diff.js";

import { JUMP_FLASH_MS } from "./ControlsChip.js";
import type { NativeTabOrder } from "./NativeTabView.js";
import { NativeTreeView } from "./NativeTreeView.js";
import { CHANGE_FLASH_MS, type NativeChangeMarks } from "./tree-changes.js";

type TreeProps = ComponentProps<typeof NativeTreeView>;

/**
 * What Chrome's tree shows of the changes a read found since the read before
 * it (`tree-changes.ts`, `use-tree-changes.ts`): the edge and the flash on a
 * new or changed row, its tags and what a screen reader hears of them, the
 * new rows it opens, the polite word on what a read the user caused found,
 * Alt+N from change to change, and the bar under the tree. The marks are a
 * real diff of two reads (`diffNativeTrees`), handed down as `App.tsx` hands
 * them: with the read that found them.
 *
 * jsdom has no layout, so the virtualized tree renders its first ten rows
 * only: every read here keeps the rows a test looks at among them.
 */

const ROOT = "root";

/** A row of a read: its id, role and name, the rows under it, and anything
 *  else it shows. */
type RowSpec = [
  id: string,
  role: string,
  name: string,
  childIds?: string[],
  extra?: Partial<NativeNode>,
];

/** One read of the page. Each row's depth is worked out from the root, as a
 *  read gives it. */
function page(...rows: RowSpec[]): Map<string, NativeNode> {
  const nodes = new Map<string, NativeNode>();
  for (const [id, role, name, childIds = [], extra = {}] of rows) {
    nodes.set(id, {
      id,
      role,
      name,
      depth: 0,
      childIds,
      states: {},
      properties: {},
      ...extra,
    });
  }
  const stack: Array<[string, number]> = [[ROOT, 0]];
  while (stack.length > 0) {
    const [id, depth] = stack.pop()!;
    const node = nodes.get(id);
    if (!node) continue;
    node.depth = depth;
    for (const child of node.childIds ?? []) stack.push([child, depth + 1]);
  }
  return nodes;
}

/** The shop's navigation, as every read of it finds it. */
const NAV: RowSpec[] = [
  ["nav", "navigation", "Site", ["home"]],
  ["home", "link", "Home"],
];

/** The Menu button, collapsed. */
const MENU_CLOSED: RowSpec = [
  "menu-btn",
  "button",
  "Menu",
  [],
  { states: { expanded: false } },
];

/** The menu the button opens, with two items in it. */
const MENU_ROWS: RowSpec[] = [
  ["menu", "menu", "Options", ["sizes", "colours"]],
  ["sizes", "menuitem", "Sizes"],
  ["colours", "menuitem", "Colours"],
];

/** The cart and its two items. A row two levels down, so collapsed on
 *  mount: only the root and its children open then. */
const CART: RowSpec[] = [
  ["cart", "list", "Cart", ["shoes", "hats"]],
  ["shoes", "listitem", "Shoes"],
  ["hats", "listitem", "Hats"],
];

/** The shop as a first read finds it. */
const CLOSED = page(
  [ROOT, "RootWebArea", "Shop", ["nav", "main"]],
  ...NAV,
  ["main", "main", "", ["menu-btn", "cart"]],
  MENU_CLOSED,
  ...CART,
);

/** After a click on Menu: the button went expanded, and the menu it opened
 *  came in after it. */
const OPENED = page(
  [ROOT, "RootWebArea", "Shop", ["nav", "main"]],
  ...NAV,
  ["main", "main", "", ["menu-btn", "menu", "cart"]],
  ["menu-btn", "button", "Menu", [], { states: { expanded: true } }],
  ...MENU_ROWS,
  ...CART,
);

/** OPENED, with the button's aria-controls naming the menu as well. */
const LINKED = page(
  [ROOT, "RootWebArea", "Shop", ["nav", "main"]],
  ...NAV,
  ["main", "main", "", ["menu-btn", "menu", "cart"]],
  [
    "menu-btn",
    "button",
    "Menu",
    [],
    { states: { expanded: true }, controls: ["menu"] },
  ],
  ...MENU_ROWS,
  ...CART,
);

/** OPENED, and the Home link gone from the navigation: a change of each
 *  kind, stopped at in document order on the navigation, the button and
 *  the menu. */
const REARRANGED = page(
  [ROOT, "RootWebArea", "Shop", ["nav", "main"]],
  ["nav", "navigation", "Site", []],
  ["main", "main", "", ["menu-btn", "menu", "cart"]],
  ["menu-btn", "button", "Menu", [], { states: { expanded: true } }],
  ...MENU_ROWS,
  ...CART,
);

/** The Menu button expanded and renamed, its menu not in yet. */
const RENAMED = page(
  [ROOT, "RootWebArea", "Shop", ["nav", "main"]],
  ...NAV,
  ["main", "main", "", ["menu-btn", "cart"]],
  ["menu-btn", "button", "Close menu", [], { states: { expanded: true } }],
  ...CART,
);

/** The cart, named `cart`, restocked under its collapsed row: Shoes
 *  renamed, Hats gone, Socks new. */
function restocked(cart = "Cart"): Map<string, NativeNode> {
  return page(
    [ROOT, "RootWebArea", "Shop", ["nav", "main"]],
    ...NAV,
    ["main", "main", "", ["menu-btn", "cart"]],
    MENU_CLOSED,
    ["cart", "list", cart, ["shoes", "socks"]],
    ["shoes", "listitem", "Shoes (2)"],
    ["socks", "listitem", "Socks"],
  );
}

/** Only Shoes renamed, under the collapsed cart. */
const SHOES_RENAMED = page(
  [ROOT, "RootWebArea", "Shop", ["nav", "main"]],
  ...NAV,
  ["main", "main", "", ["menu-btn", "cart"]],
  MENU_CLOSED,
  ["cart", "list", "Cart", ["shoes", "hats"]],
  ["shoes", "listitem", "Shoes (2)"],
  ["hats", "listitem", "Hats"],
);

/** A sign-in dialog: a new subtree, three rows deep. */
const DIALOG_ROWS: RowSpec[] = [
  ["dialog", "dialog", "Sign in", ["form"]],
  ["form", "form", "Account", ["email", "ok"]],
  ["email", "textbox", "Email"],
  ["ok", "button", "OK"],
];

/** The dialog came in after main. */
const DIALOG = page(
  [ROOT, "RootWebArea", "Shop", ["nav", "main", "dialog"]],
  ...NAV,
  ["main", "main", "", ["menu-btn", "cart"]],
  MENU_CLOSED,
  ...CART,
  ...DIALOG_ROWS,
);

/** A later read: a toast came in after the dialog. */
const DIALOG_AND_TOAST = page(
  [ROOT, "RootWebArea", "Shop", ["nav", "main", "dialog", "toast"]],
  ...NAV,
  ["main", "main", "", ["menu-btn", "cart"]],
  MENU_CLOSED,
  ...CART,
  ...DIALOG_ROWS,
  ["toast", "status", "Saved", ["dismiss"]],
  ["dismiss", "button", "Dismiss"],
);

/** A results page before and after a search filled it: a section holding a
 *  list of `items` products, `items + 2` rows new in all. */
function results(items: number) {
  const ids = Array.from({ length: items }, (_, i) => `product${i}`);
  return {
    before: page(
      [ROOT, "RootWebArea", "Shop", ["main"]],
      ["main", "main", "", []],
    ),
    after: page(
      [ROOT, "RootWebArea", "Shop", ["main"]],
      ["main", "main", "", ["section"]],
      ["section", "region", "Results", ["list"]],
      ["list", "list", "Products", ids],
      ...ids.map((id, i): RowSpec => [id, "listitem", `Product ${i}`]),
    ),
  };
}

/** A shopping list of 53 items under a list with no name, and the page once
 *  the list is gone: 54 rows removed. */
const ITEMS = Array.from({ length: 53 }, (_, i) => `item${i}`);
const LISTED = page(
  [ROOT, "RootWebArea", "Shop", ["main"]],
  ["main", "main", "", ["list"]],
  ["list", "list", "", ITEMS],
  ...ITEMS.map((id, i): RowSpec => [id, "listitem", `Item ${i}`]),
);
const UNLISTED = page(
  [ROOT, "RootWebArea", "Shop", ["main"]],
  ["main", "main", "", []],
);

/**
 * What a screen reader reads of `el`, piece by piece: each run of text in
 * document order, leaving out whatever is hidden from it (`aria-hidden`).
 */
function spoken(el: Element): string[] {
  const parts: string[] = [];
  for (const child of el.childNodes) {
    if (child instanceof Element) {
      if (child.getAttribute("aria-hidden") !== "true") {
        parts.push(...spoken(child));
      }
    } else if (child.nodeType === Node.TEXT_NODE && child.textContent) {
      parts.push(child.textContent);
    }
  }
  return parts;
}

/** What `App.tsx` hands the tree: the read on screen, and its marks. */
interface OnScreen {
  nodes: Map<string, NativeNode>;
  marks: NativeChangeMarks | null;
}

describe("NativeTreeView change marks", () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;
  /** What the changes bar's ✕ calls. */
  let clear: Mock<() => void>;
  let show: (next: OnScreen) => void;
  let seq = 0;

  beforeEach(() => {
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
    container = document.createElement("div");
    document.body.appendChild(container);
    clear = vi.fn();
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
    vi.useRealTimers();
  });

  /**
   * The panel, as far as the tree goes: it holds the read on screen and the
   * marks that came with it, and drops the marks on ✕, as
   * `useNativeChanges` does.
   */
  function Panel({
    first,
    props,
  }: {
    first: OnScreen;
    props: Partial<TreeProps>;
  }) {
    const [onScreen, setOnScreen] = useState(first);
    show = setOnScreen;
    return (
      <NativeTreeView
        nodes={onScreen.nodes}
        rootId={ROOT}
        busy={false}
        capability={undefined}
        status=""
        onRefresh={() => {}}
        onActivate={() => {}}
        changes={{
          marks: onScreen.marks,
          clear: () => {
            clear();
            setOnScreen((s) => ({ ...s, marks: null }));
          },
        }}
        {...props}
      />
    );
  }

  /** The panel with `nodes` on screen, and whatever marks came with them. */
  function mount(
    nodes: Map<string, NativeNode>,
    marks: NativeChangeMarks | null = null,
    props: Partial<TreeProps> = {},
  ) {
    act(() => {
      render(<Panel first={{ nodes, marks }} props={props} />, container);
    });
  }

  /** The marks a read of `after` comes with: what it found since `before`.
   *  `announce` is false for an automatic read. */
  function marksOf(
    before: Map<string, NativeNode>,
    after: Map<string, NativeNode>,
    announce = true,
  ): NativeChangeMarks {
    return {
      changes: diffNativeTrees(before, after, ROOT),
      seq: ++seq,
      announce,
    };
  }

  /** A read of `after` lands, with what it found since `before`. */
  function land(
    before: Map<string, NativeNode>,
    after: Map<string, NativeNode>,
    announce = true,
  ) {
    const marks = marksOf(before, after, announce);
    act(() => show({ nodes: after, marks }));
  }

  /** A read of `nodes` lands, marked with `changes`. */
  function landChanges(
    nodes: Map<string, NativeNode>,
    changes: NativeTreeChanges,
  ) {
    act(() => show({ nodes, marks: { changes, seq: ++seq, announce: true } }));
  }

  function row(id: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (!el) throw new Error(`no row for ${id}`);
    return el;
  }

  const label = (id: string) =>
    row(id).querySelector<HTMLElement>(".sn-label")!;
  const tree = () => container.querySelector<HTMLElement>('[role="tree"]');
  /** A row's own change classes, its edge and its flash, sorted. */
  const changeClasses = (id: string) =>
    [...row(id).classList]
      .filter((c) => c.startsWith("sn-node--change"))
      .sort();
  /** The tags a row carries after its key states. */
  const tagsOf = (id: string) =>
    [...row(id).querySelectorAll(".sn-change-tag")].map((t) => t.textContent);
  /** The parts of a row marked as what changed. */
  const changedParts = (id: string) =>
    [...row(id).querySelectorAll(".sn-change-part")].map((p) => p.textContent);
  const expandedOf = (id: string) => row(id).getAttribute("aria-expanded");
  const selected = () =>
    container.querySelector<HTMLElement>(
      '[role="treeitem"][aria-selected="true"]',
    )?.dataset.nodeId;
  /** The polite region in the toolbar that only a screen reader reads. */
  const notice = () =>
    container.querySelector<HTMLElement>(
      '[role="toolbar"] .sn-sr-only[aria-live="polite"]',
    )!;
  const bar = () =>
    container.querySelector<HTMLElement>(
      '[role="group"][aria-label="Changes since the read before"]',
    );
  const barButton = (name: string) =>
    bar()!.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  const barButtons = () =>
    [...(bar()?.querySelectorAll("button") ?? [])].map((b) =>
      b.getAttribute("aria-label"),
    );
  const pill = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>(".sn-filter-btn")].find(
      (b) => b.textContent === name,
    )!;

  /** Alt+N on the tree, or Alt+Shift+N with `back`. */
  function pressChangeKey(back = false) {
    act(() => {
      tree()!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: back ? "N" : "n",
          code: "KeyN",
          altKey: true,
          shiftKey: back,
          bubbles: true,
        }),
      );
    });
  }

  /** The row's chevron, clicked. */
  function toggle(id: string) {
    act(() => {
      row(id).querySelector<HTMLButtonElement>(".sn-toggle")!.click();
    });
  }

  describe("the rows", () => {
    it("edges and flashes each row a read finds new or changed, and lets the flash go after CHANGE_FLASH_MS", () => {
      vi.useFakeTimers();
      mount(CLOSED);
      land(CLOSED, OPENED);

      for (const id of ["menu", "sizes", "colours"]) {
        expect(changeClasses(id)).toEqual([
          "sn-node--change-flash",
          "sn-node--change-new",
        ]);
      }
      expect(changeClasses("menu-btn")).toEqual([
        "sn-node--change-changed",
        "sn-node--change-flash",
      ]);
      for (const id of [ROOT, "nav", "home", "main", "cart"]) {
        expect(changeClasses(id)).toEqual([]);
      }

      act(() => {
        vi.advanceTimersByTime(CHANGE_FLASH_MS - 1);
      });
      expect(changeClasses("menu")).toContain("sn-node--change-flash");
      expect(changeClasses("menu-btn")).toContain("sn-node--change-flash");

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(container.querySelector(".sn-node--change-flash")).toBeNull();
      // The edges stay until the next read.
      expect(changeClasses("menu")).toEqual(["sn-node--change-new"]);
      expect(changeClasses("sizes")).toEqual(["sn-node--change-new"]);
      expect(changeClasses("menu-btn")).toEqual(["sn-node--change-changed"]);
    });

    it("shows the marks it mounts with, but neither flashes them nor says them", () => {
      mount(OPENED, marksOf(CLOSED, OPENED));

      expect(container.querySelector(".sn-node--change-flash")).toBeNull();
      expect(changeClasses("menu")).toEqual(["sn-node--change-new"]);
      expect(changeClasses("menu-btn")).toEqual(["sn-node--change-changed"]);
      expect(tagsOf("menu")).toEqual(["new"]);
      expect(bar()).not.toBeNull();
      expect(notice().textContent).toBe("");
    });

    it("doesn't flash or say again what a follow-up read finds again", () => {
      vi.useFakeTimers();
      mount(CLOSED);
      land(CLOSED, OPENED);
      const said = notice().firstElementChild;
      expect(said?.textContent).toBe("3 new, 1 changed in the tree");
      act(() => {
        vi.advanceTimersByTime(CHANGE_FLASH_MS);
      });

      // A follow-up read in the same run: the same marks, a new seq.
      land(CLOSED, new Map(OPENED));

      expect(container.querySelector(".sn-node--change-flash")).toBeNull();
      expect(changeClasses("menu")).toEqual(["sn-node--change-new"]);
      expect(changeClasses("menu-btn")).toEqual(["sn-node--change-changed"]);
      // The region still holds what the first read said, not a new saying.
      expect(notice().firstElementChild).toBe(said);
    });

    it("flashes only what a follow-up read finds that the read before it didn't", () => {
      vi.useFakeTimers();
      mount(CLOSED);
      land(CLOSED, OPENED);
      act(() => {
        vi.advanceTimersByTime(CHANGE_FLASH_MS);
      });
      const said = notice().firstElementChild;

      // The follow-up finds the button's aria-controls too.
      land(CLOSED, LINKED);

      expect(changeClasses("menu-btn")).toEqual([
        "sn-node--change-changed",
        "sn-node--change-flash",
      ]);
      for (const id of ["menu", "sizes", "colours"]) {
        expect(changeClasses(id)).toEqual(["sn-node--change-new"]);
      }
      // Something in it is fresh, so it is said, the same count again.
      expect(notice().firstElementChild).not.toBe(said);
      expect(notice().textContent).toBe("3 new, 1 changed in the tree");
    });

    it("keeps a row flashing for CHANGE_FLASH_MS after the read that found it, through a follow-up read that finds nothing new", () => {
      vi.useFakeTimers();
      mount(CLOSED);
      land(CLOSED, OPENED);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(changeClasses("menu")).toContain("sn-node--change-flash");

      // A follow-up read 500ms later, as an action's follow window can
      // bring: the same marks, a new seq.
      land(CLOSED, new Map(OPENED));

      expect(changeClasses("menu")).toContain("sn-node--change-flash");
      expect(changeClasses("menu-btn")).toContain("sn-node--change-flash");
      act(() => {
        vi.advanceTimersByTime(CHANGE_FLASH_MS - 500);
      });
      expect(container.querySelector(".sn-node--change-flash")).toBeNull();
    });

    it("starts a row's flash over, on its other animation, when a later read finds it changed again while it flashes", () => {
      vi.useFakeTimers();
      /** The shop with its Menu button named `name`. */
      const named = (name: string) =>
        page(
          [ROOT, "RootWebArea", "Shop", ["nav", "main"]],
          ...NAV,
          ["main", "main", "", ["menu-btn", "cart"]],
          ["menu-btn", "button", name, [], { states: { expanded: false } }],
          ...CART,
        );
      mount(named("Menu"));
      land(named("Menu"), named("Open"));
      expect(changeClasses("menu-btn")).toEqual([
        "sn-node--change-changed",
        "sn-node--change-flash",
      ]);
      act(() => {
        vi.advanceTimersByTime(600);
      });

      // Renamed again 600ms in: a class the row didn't have, so the
      // animation starts over, and runs its full time from now.
      land(named("Open"), named("Opening"));
      expect(changeClasses("menu-btn")).toEqual([
        "sn-node--change-changed",
        "sn-node--change-flash",
        "sn-node--change-flash-alt",
      ]);
      act(() => {
        vi.advanceTimersByTime(CHANGE_FLASH_MS - 1);
      });
      expect(changeClasses("menu-btn")).toContain("sn-node--change-flash");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(changeClasses("menu-btn")).toEqual(["sn-node--change-changed"]);
    });

    it("starts the inside tag's flash over when a later read finds more under the row while it flashes", () => {
      vi.useFakeTimers();
      mount(CLOSED);
      land(CLOSED, SHOES_RENAMED);
      const first = row("cart").querySelector(".sn-change-tag--inside")!;
      expect(first.classList).toContain("sn-change-tag--flash");
      act(() => {
        vi.advanceTimersByTime(600);
      });

      // A new run: Hats went and Socks came, still under the closed cart.
      land(SHOES_RENAMED, restocked());

      const again = row("cart").querySelector(".sn-change-tag--inside")!;
      expect(again.classList).toContain("sn-change-tag--flash");
      // A new element, so its animation starts over.
      expect(again).not.toBe(first);
    });

    it("tags the top row of a new subtree as new, and no row under it", () => {
      mount(CLOSED);
      land(CLOSED, DIALOG);

      expect(tagsOf("dialog")).toEqual(["new"]);
      const tag = row("dialog").querySelector(".sn-change-tag--new")!;
      expect(tag.getAttribute("aria-hidden")).toBe("true");
      expect(tag.getAttribute("title")).toBe("New since the read before");
      // The rows under it are new with it: the edge, but no tag.
      for (const id of ["form", "email", "ok"]) {
        expect(tagsOf(id)).toEqual([]);
        expect(changeClasses(id)).toContain("sn-node--change-new");
      }
      expect(tagsOf("main")).toEqual([]);
    });

    it("tags a changed row, titled with each change from what to what", () => {
      mount(CLOSED);
      land(CLOSED, RENAMED);

      expect(tagsOf("menu-btn")).toEqual(["changed"]);
      const tag = row("menu-btn").querySelector(".sn-change-tag--changed")!;
      expect(tag.getAttribute("aria-hidden")).toBe("true");
      const [head, ...lines] = tag.getAttribute("title")!.split("\n");
      expect(head).toBe("Changed since the read before:");
      expect(lines.sort()).toEqual(
        [
          "expanded: collapsed → expanded",
          'name: "Menu" → "Close menu"',
        ].sort(),
      );
    });

    it("marks a badge that went from collapsed to expanded as what changed, and not the name that stayed", () => {
      mount(CLOSED);
      land(CLOSED, OPENED);

      expect(changedParts("menu-btn")).toEqual(["expanded"]);
      const badge = row("menu-btn").querySelector(".sn-change-part")!;
      expect(badge.classList).toContain("sn-state-badge");
      expect(
        row("menu-btn").querySelector(".sn-name")!.classList,
      ).not.toContain("sn-change-part");
    });

    it("marks a changed name as what changed, beside a changed badge", () => {
      mount(CLOSED);
      land(CLOSED, RENAMED);

      expect(changedParts("menu-btn")).toEqual(["Close menu", "expanded"]);
      expect(row("menu-btn").querySelector(".sn-name")!.classList).toContain(
        "sn-change-part",
      );
      expect(
        row("menu-btn").querySelector(".sn-role")!.classList,
      ).not.toContain("sn-change-part");
    });

    it("tags a collapsed row with the changes under it that have no row on screen", () => {
      mount(CLOSED);
      land(CLOSED, restocked());

      expect(expandedOf("cart")).toBe("false");
      expect(tagsOf("cart")).toEqual(["1 new, 1 changed, 1 removed inside"]);
      const tag = row("cart").querySelector(".sn-change-tag--inside")!;
      expect(tag.getAttribute("aria-hidden")).toBe("true");
      expect(tag.getAttribute("title")).toBe(
        "Under this row, since the read before: 1 new, 1 changed, 1 removed inside",
      );
      // It only stands in for them: no edge of its own.
      expect(changeClasses("cart")).toEqual([]);

      // Opened, the rows under it show their own marks, and it keeps the
      // one change that has no row: the row removed from under it.
      toggle("cart");
      expect(tagsOf("cart")).toEqual(["1 removed inside"]);
      expect(changeClasses("shoes")).toContain("sn-node--change-changed");
      expect(changeClasses("socks")).toContain("sn-node--change-new");
      expect(tagsOf("socks")).toEqual(["new"]);
    });

    it("marks nothing without the changes prop", () => {
      act(() => {
        render(
          <NativeTreeView
            nodes={OPENED}
            rootId={ROOT}
            busy={false}
            capability={undefined}
            status=""
            onRefresh={() => {}}
            onActivate={() => {}}
          />,
          container,
        );
      });
      expect(container.querySelector('[class*="sn-node--change"]')).toBeNull();
      expect(container.querySelector(".sn-change-tag")).toBeNull();
      expect(bar()).toBeNull();
    });
  });

  describe("what a screen reader hears", () => {
    it("hears a row's marks last in its label, so the row still starts with its role and name", () => {
      mount(CLOSED);
      land(CLOSED, LINKED);

      // The button: after its key state, its link to the menu and its
      // action.
      expect(spoken(row("menu-btn")).slice(0, 2)).toEqual(["button", "Menu"]);
      expect(spoken(label("menu-btn")).at(-1)).toBe(
        ", changed: now expanded, controls",
      );
      const last = label("menu-btn").lastElementChild!;
      expect(last.classList).toContain("sn-sr-only");
      expect(last.textContent).toBe(", changed: now expanded, controls");

      // The new menu's top row: after its link back to the button.
      expect(spoken(row("menu")).slice(0, 2)).toEqual(["menu", "Options"]);
      expect(spoken(row("menu")).at(-1)).toBe(", new");
      expect(label("menu").lastElementChild!.textContent).toBe(", new");
    });

    it("says each row's marks once, and only in the label", () => {
      mount(CLOSED);
      land(CLOSED, LINKED);

      const saying = [...row("menu-btn").querySelectorAll(".sn-sr-only")]
        .map((el) => el.textContent ?? "")
        .filter((text) => text.startsWith(", "));
      expect(saying).toEqual([", changed: now expanded, controls"]);
      // The tags say the same to the eye only.
      for (const tag of container.querySelectorAll(".sn-change-tag")) {
        expect(tag.getAttribute("aria-hidden")).toBe("true");
      }
    });

    it("says nothing on a row under a new row, whose top row says it", () => {
      mount(CLOSED);
      land(CLOSED, OPENED);

      expect(spoken(row("sizes")).slice(0, 2)).toEqual(["menuitem", "Sizes"]);
      expect(spoken(row("sizes")).some((t) => t.startsWith(", "))).toBe(false);
      expect(spoken(row("main")).some((t) => t.startsWith(", "))).toBe(false);
    });

    it("hears what a collapsed row stands in for, after what changed on it", () => {
      mount(CLOSED);
      land(CLOSED, restocked());
      expect(spoken(row("cart"))).toEqual([
        "list",
        "Cart",
        ", 1 new, 1 changed, 1 removed inside",
      ]);

      land(CLOSED, restocked("Basket"));
      expect(spoken(row("cart"))).toEqual([
        "list",
        "Basket",
        ", changed: name; 1 new, 1 changed, 1 removed inside",
      ]);
    });
  });

  describe("new rows opening", () => {
    it("opens every fresh new row that has rows under it", () => {
      mount(CLOSED);
      land(CLOSED, DIALOG);

      expect(expandedOf("dialog")).toBe("true");
      expect(expandedOf("form")).toBe("true");
      expect(row("email")).toBeTruthy();
      // A new leaf has nothing to open.
      expect(row("ok").hasAttribute("aria-expanded")).toBe(false);
    });

    it("leaves closed a new row the user closed after an earlier read, when a follow-up read finds nothing new in it", () => {
      mount(CLOSED);
      land(CLOSED, DIALOG);
      toggle("dialog");
      expect(expandedOf("dialog")).toBe("false");

      // A follow-up read in the same run finds the dialog new again, and a
      // toast as well.
      land(CLOSED, DIALOG_AND_TOAST);

      expect(expandedOf("dialog")).toBe("false");
      expect(expandedOf("toast")).toBe("true");
      expect(changeClasses("dialog")).toContain("sn-node--change-new");
    });

    it("leaves closed a new row above the selected one, so the selection stays where it was", () => {
      // The dialog comes in after main; selecting the dialog's own row
      // later puts the toast below it.
      mount(CLOSED);
      act(() => row("menu-btn").click());
      expect(selected()).toBe("menu-btn");

      // A section added at the top of the page, above the selected button,
      // and a dialog after it.
      const TOP_AND_DIALOG = page(
        [ROOT, "RootWebArea", "Shop", ["banner", "nav", "main", "dialog"]],
        ["banner", "region", "Offers", ["offer"]],
        ["offer", "link", "Free delivery"],
        ...NAV,
        ["main", "main", "", ["menu-btn", "cart"]],
        MENU_CLOSED,
        ...CART,
        ...DIALOG_ROWS,
      );
      land(CLOSED, TOP_AND_DIALOG);

      expect(expandedOf("banner")).toBe("false");
      expect(changeClasses("banner")).toContain("sn-node--change-new");
      expect(expandedOf("dialog")).toBe("true");
      expect(selected()).toBe("menu-btn");
    });

    it("opens a new row that holds the selected one, so the row still shows", () => {
      mount(CLOSED);
      act(() => row("menu-btn").click());
      // The page wrapped the button and the cart in a named group.
      const WRAPPED = page(
        [ROOT, "RootWebArea", "Shop", ["nav", "main"]],
        ...NAV,
        ["main", "main", "", ["tools"]],
        ["tools", "group", "Shop tools", ["menu-btn", "cart"]],
        MENU_CLOSED,
        ...CART,
      );
      land(CLOSED, WRAPPED);

      // Opened, though it comes before the selected row: it holds it, so
      // opening it pushes nothing above the row down.
      expect(expandedOf("tools")).toBe("true");
      expect(row("menu-btn")).toBeTruthy();
    });

    it("opens the selected new row when a follow-up read fills it", () => {
      mount(CLOSED);
      // The first read of the run finds the menu new, still empty.
      const EMPTY_MENU = page(
        [ROOT, "RootWebArea", "Shop", ["nav", "main"]],
        ...NAV,
        ["main", "main", "", ["menu-btn", "menu", "cart"]],
        ["menu-btn", "button", "Menu", [], { states: { expanded: true } }],
        ["menu", "menu", "Options", []],
        ...CART,
      );
      land(CLOSED, EMPTY_MENU);
      act(() => row("menu").click());
      expect(selected()).toBe("menu");

      // Its follow-up, compared with the tree from before the run, brings
      // the items.
      land(CLOSED, OPENED);

      expect(expandedOf("menu")).toBe("true");
      expect(row("sizes")).toBeTruthy();
      expect(selected()).toBe("menu");
    });

    it("opens every new row of a read that finds 200 new rows", () => {
      const { before, after } = results(198);
      mount(before);
      land(before, after);

      expect(expandedOf("section")).toBe("true");
      expect(expandedOf("list")).toBe("true");
      expect(row("product0")).toBeTruthy();
    });

    it("opens only the top row of each new subtree past 200 new rows", () => {
      const { before, after } = results(199);
      mount(before);
      land(before, after);

      expect(expandedOf("section")).toBe("true");
      expect(expandedOf("list")).toBe("false");
    });
  });

  describe("the polite region", () => {
    it("says what a read the user caused found, in the region it mounted empty", () => {
      mount(CLOSED);
      const region = notice();
      expect(region.textContent).toBe("");

      land(CLOSED, OPENED);

      expect(notice()).toBe(region);
      expect(region.textContent).toBe("3 new, 1 changed in the tree");
    });

    it("takes what it said away when the marks go", () => {
      mount(CLOSED);
      land(CLOSED, OPENED);
      expect(notice().textContent).toBe("3 new, 1 changed in the tree");

      act(() => show({ nodes: new Map(OPENED), marks: null }));

      expect(notice().textContent).toBe("");
    });

    it("marks what an automatic read found without saying it", () => {
      mount(CLOSED);
      land(CLOSED, OPENED, false);

      expect(changeClasses("menu")).toEqual([
        "sn-node--change-flash",
        "sn-node--change-new",
      ]);
      expect(notice().textContent).toBe("");
    });
  });

  describe("Alt+N", () => {
    it("is among the keys the tree names", () => {
      mount(CLOSED);
      const keys = tree()!.getAttribute("aria-keyshortcuts")!.split(" ");
      expect(keys).toEqual(expect.arrayContaining(["Alt+N", "Alt+Shift+N"]));
      expect(tree()!.getAttribute("aria-label")).toContain(
        "Alt+N and Alt+Shift+N to go to the next and previous change",
      );
    });

    it("goes from change to change in document order, wrapping round either way", () => {
      mount(CLOSED);
      land(CLOSED, REARRANGED);

      pressChangeKey();
      expect(selected()).toBe("nav");
      pressChangeKey();
      expect(selected()).toBe("menu-btn");
      pressChangeKey();
      expect(selected()).toBe("menu");
      pressChangeKey();
      expect(selected()).toBe("nav");

      pressChangeKey(true);
      expect(selected()).toBe("menu");
      pressChangeKey(true);
      expect(selected()).toBe("menu-btn");
    });

    it("goes to the last change on Alt+Shift+N with no row selected", () => {
      mount(CLOSED);
      land(CLOSED, REARRANGED);

      pressChangeKey(true);
      expect(selected()).toBe("menu");
    });

    it("goes from a row that is no change to the change after or before it", () => {
      mount(CLOSED);
      land(CLOSED, REARRANGED);

      act(() => row("sizes").click());
      pressChangeKey(true);
      expect(selected()).toBe("menu");

      act(() => row("main").click());
      pressChangeKey();
      expect(selected()).toBe("menu-btn");

      // No change after the last one: round to the first.
      act(() => row("sizes").click());
      pressChangeKey();
      expect(selected()).toBe("nav");
    });

    it("lands as a jump chip's target lands, flashed for a moment", () => {
      vi.useFakeTimers();
      mount(CLOSED);
      land(CLOSED, REARRANGED);

      pressChangeKey();
      expect(selected()).toBe("nav");
      expect(row("nav").classList).toContain("sn-node--flash");

      act(() => {
        vi.advanceTimersByTime(JUMP_FLASH_MS);
      });
      expect(row("nav").classList).not.toContain("sn-node--flash");
    });

    it("opens the rows above a change hidden under a collapsed row to reach it", () => {
      mount(CLOSED);
      land(CLOSED, SHOES_RENAMED);
      expect(expandedOf("cart")).toBe("false");
      expect(container.querySelector('[data-node-id="shoes"]')).toBeNull();

      pressChangeKey();

      expect(expandedOf("cart")).toBe("true");
      expect(selected()).toBe("shoes");
      expect(row("shoes").classList).toContain("sn-node--change-changed");
      expect(tagsOf("cart")).toEqual([]);
    });

    it("clears a search that hides the change it goes to", () => {
      mount(CLOSED);
      land(CLOSED, REARRANGED);
      const search = container.querySelector<HTMLInputElement>(".sn-search")!;
      act(() => {
        search.value = "Sizes";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(container.querySelector('[data-node-id="nav"]')).toBeNull();

      pressChangeKey();

      expect(search.value).toBe("");
      expect(selected()).toBe("nav");
    });

    it("leaves a scope the change it goes to sits outside of", () => {
      const onScope = vi.fn();
      mount(CLOSED, null, { scopedRootId: "main", onScope });
      land(CLOSED, REARRANGED);
      expect(container.querySelector('[data-node-id="nav"]')).toBeNull();

      pressChangeKey();

      expect(onScope).toHaveBeenCalledWith(null);
      expect(selected()).toBe("nav");
    });

    it("says the row it is on is the only change, where moving to it would say nothing", () => {
      mount(CLOSED);
      act(() => row("menu-btn").click());
      // Only the button changed: it is the one stop, and it is selected.
      const PRESSED = page(
        [ROOT, "RootWebArea", "Shop", ["nav", "main"]],
        ...NAV,
        ["main", "main", "", ["menu-btn", "cart"]],
        ["menu-btn", "button", "Menu", [], { states: { expanded: true } }],
        ...CART,
      );
      land(CLOSED, PRESSED, false);

      pressChangeKey();
      expect(notice().textContent).toBe("This is the only change");
      expect(selected()).toBe("menu-btn");
      const first = notice().firstElementChild;

      pressChangeKey(true);
      expect(notice().textContent).toBe("This is the only change");
      expect(notice().firstElementChild).not.toBe(first);
    });

    it("says there is no change to go to when nothing is marked, each time it is pressed", () => {
      mount(CLOSED);

      pressChangeKey();
      expect(notice().textContent).toBe("No changes since the read before");
      expect(selected()).toBeUndefined();
      const first = notice().firstElementChild;

      pressChangeKey(true);
      expect(notice().textContent).toBe("No changes since the read before");
      // In a new element: the same words, said again.
      expect(notice().firstElementChild).not.toBe(first);
      expect(selected()).toBeUndefined();
    });
  });

  describe("the changes bar", () => {
    it("sums up under the tree what the read found", () => {
      mount(CLOSED);
      land(CLOSED, REARRANGED);

      expect(bar()!.querySelector(".sn-changes-summary")!.textContent).toBe(
        "3 new, 1 changed, 1 removed",
      );
      expect(
        tree()!.compareDocumentPosition(bar()!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("offers Previous and Next, naming their keys, only while there is a change to go to", () => {
      mount(CLOSED);
      land(CLOSED, REARRANGED);
      expect(barButtons()).toEqual([
        "Previous change",
        "Next change",
        "Clear change marks",
      ]);
      // The keys are the tree's, so the buttons name them in their titles
      // only: they do nothing on the buttons.
      expect(barButton("Previous change").title).toBe(
        "Previous change (Alt+Shift+N)",
      );
      expect(barButton("Next change").title).toBe("Next change (Alt+N)");
      expect(barButton("Next change").hasAttribute("aria-keyshortcuts")).toBe(
        false,
      );

      // Marks with nowhere to stop.
      landChanges(REARRANGED, {
        ...diffNativeTrees(CLOSED, REARRANGED, ROOT),
        stops: [],
      });
      expect(barButtons()).toEqual(["Clear change marks"]);
    });

    it("goes from change to change on Previous and Next, and hands focus to the tree", () => {
      vi.useFakeTimers();
      mount(CLOSED);
      land(CLOSED, REARRANGED);
      const next = barButton("Next change");
      next.focus();

      act(() => next.click());
      expect(selected()).toBe("nav");
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(document.activeElement).toBe(tree());

      act(() => barButton("Next change").click());
      expect(selected()).toBe("menu-btn");
      act(() => barButton("Previous change").click());
      expect(selected()).toBe("nav");
      act(() => barButton("Previous change").click());
      expect(selected()).toBe("menu");
    });

    it("clears the marks on ✕ and hands focus to the tree", () => {
      mount(CLOSED);
      land(CLOSED, OPENED);
      const x = barButton("Clear change marks");
      x.focus();

      act(() => x.click());

      expect(clear).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(tree());
      expect(bar()).toBeNull();
      expect(container.querySelector('[class*="sn-node--change"]')).toBeNull();
      expect(container.querySelector(".sn-change-tag")).toBeNull();
      expect(container.querySelector(".sn-change-part")).toBeNull();

      pressChangeKey();
      expect(notice().textContent).toBe("No changes since the read before");
    });

    it("lists the removed rows, up to 50, and counts the rest", () => {
      mount(LISTED);
      land(LISTED, UNLISTED);

      expect(bar()!.querySelector(".sn-changes-summary")!.textContent).toBe(
        "54 removed",
      );
      const details = bar()!.querySelector("details")!;
      expect(details.querySelector("summary")!.textContent).toBe(
        "Removed rows",
      );
      const items = [...details.querySelectorAll("li")].map(
        (li) => li.textContent,
      );
      expect(items).toHaveLength(51);
      // In the earlier read's document order; a row with no name by role.
      expect(items[0]).toBe("list");
      expect(items[1]).toBe('listitem "Item 0"');
      expect(items[49]).toBe('listitem "Item 48"');
      expect(items[50]).toBe("… and 4 more");
      // The row they went from under stands in for them.
      expect(tagsOf("main")).toEqual(["54 removed inside"]);
    });

    it("lists no removed rows when none went", () => {
      mount(CLOSED);
      land(CLOSED, OPENED);

      expect(bar()).not.toBeNull();
      expect(bar()!.querySelector("details")).toBeNull();
    });

    it("isn't there without marks", () => {
      mount(CLOSED);
      expect(bar()).toBeNull();

      // A read that finds nothing hands down no marks.
      land(CLOSED, OPENED);
      expect(bar()).not.toBeNull();
      act(() => show({ nodes: new Map(OPENED), marks: null }));
      expect(bar()).toBeNull();
    });

    it("isn't there while a role filter's list shows in the tree's place", () => {
      mount(CLOSED);
      land(CLOSED, OPENED);

      act(() => pill("Buttons").click());
      expect(container.querySelector('[role="tree"]')).toBeNull();
      expect(bar()).toBeNull();

      act(() => pill("Buttons").click());
      expect(bar()).not.toBeNull();
    });

    it("isn't there while the tab order shows in the tree's place", () => {
      const host = document.createElement("div");
      host.innerHTML = "<button>Menu</button>";
      document.body.appendChild(host);
      try {
        const { nodes, rootId } = extractA11yTree(host);
        const tabOrder: NativeTabOrder = {
          nodes,
          rootId,
          onHighlight: vi.fn(),
          onActivate: vi.fn(),
        };
        mount(CLOSED, null, { tabOrder, view: "tab", onViewChange: vi.fn() });
        land(CLOSED, OPENED);

        expect(container.querySelector('[role="tree"]')).toBeNull();
        expect(bar()).toBeNull();
      } finally {
        host.remove();
      }
    });
  });
});
