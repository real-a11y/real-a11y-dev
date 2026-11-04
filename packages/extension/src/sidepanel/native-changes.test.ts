import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { NativeNode } from "../native/native-actions.js";
import { NATIVE_NOTICE_SEEN_KEY } from "../native/setting.js";
import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import {
  ACTION_FOLLOW_MS,
  AUTO_REFRESH_MIN_GAP_MS,
  AUTO_REFRESH_QUIET_MS,
  FOLLOW_PAGE_CHANGES_KEY,
  NATIVE_SETTLE_MS,
} from "./native-auto-refresh.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  TAB_ID,
  installChromeMock,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";
import { CHANGE_FLASH_MS } from "./tree-changes.js";

/**
 * What Chrome's tree marks of each read, through the whole panel. `App.tsx`
 * notes every read before its tree replaces the one on screen
 * (`use-native-changes.ts`), and the tree marks what the read found new or
 * changed since the read before, sums it up in a bar under the tree, and
 * says so when the user caused the read. A read the user causes (Refresh,
 * an action's own re-read) compares with the tree on screen; a read that
 * follows up what they did compares with the tree from before it, so one
 * gesture's marks add up; an automatic read marks without saying anything.
 * Nothing is compared with a tree that went away, or across documents.
 *
 * Every read here is of one shop page whose ids last from read to read
 * (`ax-dom-<n>`), with the same root and document unless a test says
 * otherwise.
 */

const PAGE_URL = "https://example.test/";
const ROOT = "ax-dom-1";
const DOCUMENT = "doc-1";

/** What a read of the page answers with: its rows, and the document. */
interface PageRead {
  rootId: string;
  documentId: string;
  nodes: NativeNode[];
}

/** A row of the page, at its top level unless `extra` says otherwise. */
function row(
  id: string,
  role: string,
  name: string,
  extra: Partial<NativeNode> = {},
): NativeNode {
  return { id, role, name, depth: 1, ...extra };
}

/** A read of the shop page: `top` under its root, then `deeper` rows. */
function shop(
  top: NativeNode[],
  deeper: NativeNode[] = [],
  doc: { rootId?: string; documentId?: string } = {},
): PageRead {
  const rootId = doc.rootId ?? ROOT;
  return {
    rootId,
    documentId: doc.documentId ?? DOCUMENT,
    nodes: [
      {
        id: rootId,
        role: "RootWebArea",
        name: "Shop",
        depth: 0,
        childIds: top.map((n) => n.id),
      },
      ...top,
      ...deeper,
    ],
  };
}

const MENU = row("ax-dom-2", "button", "Menu", {
  states: { expanded: false },
});
const MENU_OPEN = row("ax-dom-2", "button", "Menu", {
  states: { expanded: true },
});
const MAIN = row("ax-dom-3", "main", "Products");
/** The menu the button opens, empty until the page has fetched its items. */
const ITEMS = row("ax-dom-4", "menu", "Choices");
const ITEMS_FILLED = { ...ITEMS, childIds: ["ax-dom-5", "ax-dom-6"] };
const SHOES = row("ax-dom-5", "menuitem", "Shoes", { depth: 2 });
const HATS = row("ax-dom-6", "menuitem", "Hats", { depth: 2 });
const LOADED = row("ax-dom-7", "status", "Menu loaded");
const SAVED_NOTE = row("ax-dom-8", "status", "Saved");

/** The page as the panel first reads it: the menu closed. */
const CLOSED = shop([MENU, MAIN]);
/** The same, with a status the page put up. */
const SAVED = shop([MENU, SAVED_NOTE, MAIN]);
/** What a click on Menu does at once: the button goes expanded, and its
 *  menu shows, still empty. */
const OPENED = shop([MENU_OPEN, ITEMS, MAIN]);
/** What the page does a moment later: the items it fetched arrive, and a
 *  status says so. */
const FILLED = shop([MENU_OPEN, ITEMS_FILLED, LOADED, MAIN], [SHOES, HATS]);

/** The page a click can lead to, another document: as its first read finds
 *  it, and once its payment form has loaded. */
const CHECKOUT = { rootId: "ax-dom-50", documentId: "doc-2" };
const HEADING = row("ax-dom-51", "heading", "Checkout");
const PAYMENT = row("ax-dom-52", "form", "Payment");
const READY = row("ax-dom-53", "status", "Ready to pay");
const CHECKOUT_LOADING = shop([HEADING], [], CHECKOUT);
const CHECKOUT_LOADED = shop([HEADING, PAYMENT], [], CHECKOUT);
const CHECKOUT_READY = shop([HEADING, PAYMENT, READY], [], CHECKOUT);

describe("Chrome's tree: what each read found changed", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;
  /** The page as a read finds it now. */
  let page: PageRead;
  /** Every read fails while this is set, as one the service worker
   *  couldn't serve does. */
  let failReads: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    stubMatchMedia();
    page = CLOSED;
    failReads = false;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
  });

  /** Let the promise-form replies land and the effects they trigger run. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  async function wait(ms: number): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
    await flush();
  }

  function emit(message: object): void {
    act(() => {
      chromeMock.emit(message as unknown as ContentToPanel);
    });
  }

  /** The panel on Chrome's tree, its first read (the default one) of
   *  `page` on screen. */
  async function showNative(storage: Record<string, unknown> = {}) {
    chromeMock = installChromeMock({
      storage: { [NATIVE_NOTICE_SEEN_KEY]: true, ...storage },
      respond: (message) => {
        if ((message as { type: string }).type !== "NATIVE_READ") {
          return undefined;
        }
        if (failReads) return { ok: false, error: "the page went away" };
        return {
          ok: true,
          url: PAGE_URL,
          rootId: page.rootId,
          documentId: page.documentId,
          nodes: structuredClone(page.nodes),
        };
      },
    });
    // An action first checks the tab is still on the page the tree came
    // from.
    Object.assign((globalThis as unknown as { chrome: object }).chrome, {
      tabs: { get: async () => ({ id: TAB_ID, url: PAGE_URL }) },
    });
    act(() => {
      render(h(App, {}), container);
    });
    await flush();
    emit({ type: "ACTIVE_TAB_CHANGED", tabId: TAB_ID });
    emit(treeData());
    await flush();
    expect(reads()).toBe(1);
    expect(rowOf("ax-dom-2")).not.toBeNull();
  }

  /** A burst of page changes, dated `at`, as the service worker reports
   *  it. */
  function pageChanged(at: number): void {
    const data = treeData() as { payload: Record<string, unknown> };
    emit({ ...data, payload: { ...data.payload, pageChangedAt: [at] } });
  }

  const reads = () =>
    chromeMock.sent.filter(
      (m) => (m as { type: string }).type === "NATIVE_READ",
    ).length;

  /** The actions sent through the tree, not counting the outline a
   *  selected row asks for, which is sent `silent`. */
  const acts = () =>
    chromeMock.sent
      .map(
        (m) =>
          m as {
            type: string;
            nodeId?: string;
            action?: string;
            silent?: boolean;
          },
      )
      .filter((m) => m.type === "NATIVE_ACT" && m.silent !== true)
      .map(({ nodeId, action }) => ({ nodeId, action }));

  const tree = () => container.querySelector<HTMLElement>('[role="tree"]');
  const rowOf = (id: string) =>
    container.querySelector<HTMLElement>(
      `[role="treeitem"][data-node-id="${id}"]`,
    );

  /** The rows marked new and the rows marked changed, in tree order. */
  const marked = () => {
    const ids = (cls: string) =>
      [...container.querySelectorAll(`[role="treeitem"].${cls}`)].map((r) =>
        r.getAttribute("data-node-id"),
      );
    return {
      new: ids("sn-node--change-new"),
      changed: ids("sn-node--change-changed"),
    };
  };
  const NOTHING_MARKED = { new: [], changed: [] };

  /** The bar under the tree that sums up what the last read found. */
  const bar = () =>
    container.querySelector<HTMLElement>(
      '[role="group"][aria-label="Changes since the read before"]',
    );
  const summary = () =>
    bar()?.querySelector(".sn-changes-summary")?.textContent ?? null;

  /** The polite region in the tree's toolbar that says what a read found. */
  const notice = () =>
    container.querySelector<HTMLElement>(
      '[aria-label="Native tree controls"] .sn-sr-only[aria-live="polite"]',
    );

  /** What a screen reader hears of row `id`'s marks: the end of its label. */
  const heard = (id: string) =>
    rowOf(id)?.querySelector(".sn-label > .sn-sr-only:last-child")
      ?.textContent ?? null;

  /** The user, a moment after the last read, presses Refresh. A moment:
   *  a read the user causes is a run of reads of its own, named by when it
   *  starts. */
  async function refresh(): Promise<void> {
    await wait(1000);
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Refresh native tree"]',
    );
    expect(button?.disabled).toBe(false);
    act(() => button!.click());
    await flush();
  }

  function select(id: string): void {
    act(() => rowOf(id)!.click());
  }

  function press(key: string, init: KeyboardEventInit = {}): void {
    act(() => {
      tree()!.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
      );
    });
  }

  /** Enter on the Menu button's row, once the page has settled and been
   *  read again: what the click did at once is `OPENED`. */
  async function openMenuThroughTree(): Promise<void> {
    select("ax-dom-2");
    page = OPENED;
    press("Enter");
    await flush();
    await wait(NATIVE_SETTLE_MS);
    expect(acts()).toEqual([{ nodeId: "ax-dom-2", action: "click" }]);
    expect(reads()).toBe(2);
  }

  describe("a Refresh", () => {
    it("marks a row it finds new, sums it up under the tree, and says so", async () => {
      await showNative();
      // The first read has nothing to compare with.
      expect(marked()).toEqual(NOTHING_MARKED);
      expect(bar()).toBeNull();
      const region = notice();
      expect(region?.textContent).toBe("");

      page = SAVED;
      await refresh();

      expect(reads()).toBe(2);
      expect(marked()).toEqual({ new: ["ax-dom-8"], changed: [] });
      expect(
        rowOf("ax-dom-8")?.querySelector(".sn-change-tag--new")?.textContent,
      ).toBe("new");
      expect(heard("ax-dom-8")).toBe(", new");
      expect(heard("ax-dom-2")).toBeNull();
      expect(summary()).toBe("1 new");
      // Said through the region that was already there, which a screen
      // reader announces; one that arrives holding its text it may not.
      expect(notice()).toBe(region);
      expect(region?.textContent).toBe("1 new in the tree");
    });

    it("flashes what it found for a moment, and keeps it marked after", async () => {
      await showNative();
      page = SAVED;
      await refresh();
      expect(rowOf("ax-dom-8")?.classList).toContain("sn-node--change-flash");

      await wait(CHANGE_FLASH_MS);
      expect(rowOf("ax-dom-8")?.classList).not.toContain(
        "sn-node--change-flash",
      );
      expect(marked()).toEqual({ new: ["ax-dom-8"], changed: [] });
      expect(summary()).toBe("1 new");
    });

    it("marks nothing, and shows no bar, when it finds the tree as it was", async () => {
      await showNative();
      await refresh();

      expect(reads()).toBe(2);
      expect(marked()).toEqual(NOTHING_MARKED);
      expect(container.querySelector(".sn-change-tag")).toBeNull();
      expect(bar()).toBeNull();
      expect(notice()?.textContent).toBe("");
    });

    it("takes the marks away once a read finds nothing changed since the one before it", async () => {
      await showNative();
      page = SAVED;
      await refresh();
      expect(marked()).toEqual({ new: ["ax-dom-8"], changed: [] });

      await refresh();
      expect(reads()).toBe(3);
      expect(marked()).toEqual(NOTHING_MARKED);
      expect(heard("ax-dom-8")).toBeNull();
      expect(bar()).toBeNull();
    });

    it("compares with the tree on screen, not with the one the marks came from", async () => {
      await showNative();
      page = OPENED;
      await refresh();
      expect(marked()).toEqual({ new: ["ax-dom-4"], changed: ["ax-dom-2"] });

      // The menu stays open, and a status comes up.
      page = shop([MENU_OPEN, ITEMS, SAVED_NOTE, MAIN]);
      await refresh();
      expect(marked()).toEqual({ new: ["ax-dom-8"], changed: [] });
      expect(summary()).toBe("1 new");
    });
  });

  describe("a tree that goes away, or a read of another document", () => {
    it("drops the marks with the tree when the page navigates, and marks nothing the first read after it finds", async () => {
      await showNative();
      page = OPENED;
      await refresh();
      expect(marked()).toEqual({ new: ["ax-dom-4"], changed: ["ax-dom-2"] });

      emit({ type: "PAGE_NAVIGATED", tabId: TAB_ID });
      await flush();
      expect(tree()).toBeNull();
      expect(marked()).toEqual(NOTHING_MARKED);
      expect(bar()).toBeNull();

      // The page reports itself and is read once it goes quiet. The read
      // finds more rows than either tree before it, under the same root and
      // in the same document, as after a navigation that never committed:
      // only the tree having gone keeps it from being compared.
      page = FILLED;
      pageChanged(Date.now() - 300);
      await flush();
      expect(tree()).not.toBeNull();
      expect(bar()).toBeNull();
      await wait(AUTO_REFRESH_QUIET_MS + 10);
      expect(reads()).toBe(3);
      expect(rowOf("ax-dom-7")).not.toBeNull();
      expect(marked()).toEqual(NOTHING_MARKED);
      expect(bar()).toBeNull();

      // The read after it compares with it as usual: the menu closed.
      page = CLOSED;
      await refresh();
      expect(marked()).toEqual({ new: [], changed: ["ax-dom-2"] });
      expect(summary()).toBe("1 changed, 4 removed");
    });

    it("drops the marks with the tree when a Refresh fails, and marks nothing the read after it finds", async () => {
      await showNative();
      page = SAVED;
      await refresh();
      expect(marked()).toEqual({ new: ["ax-dom-8"], changed: [] });

      failReads = true;
      await refresh();
      expect(rowOf("ax-dom-2")).toBeNull();
      expect(bar()).toBeNull();

      failReads = false;
      page = FILLED;
      await refresh();
      expect(rowOf("ax-dom-7")).not.toBeNull();
      expect(marked()).toEqual(NOTHING_MARKED);
      expect(bar()).toBeNull();
    });

    it("marks nothing in a read of another document, and compares the read after it with that one", async () => {
      const doc = { documentId: "doc-2" };
      await showNative();
      page = shop([MENU, SAVED_NOTE, MAIN], [], doc);
      await refresh();
      expect(rowOf("ax-dom-8")).not.toBeNull();
      expect(marked()).toEqual(NOTHING_MARKED);
      expect(bar()).toBeNull();
      expect(notice()?.textContent).toBe("");

      page = shop([MENU_OPEN, SAVED_NOTE, MAIN], [], doc);
      await refresh();
      expect(marked()).toEqual({ new: [], changed: ["ax-dom-2"] });
      expect(summary()).toBe("1 changed");
    });

    it("compares a read of the same document whose root moved", async () => {
      // A toast beside the page's landmarks: Chromium's own root is dropped,
      // so a page's tree is rooted at the synthetic root once it holds more
      // than one top-level row, and at its one landmark otherwise.
      await showNative();
      page = shop([MENU, SAVED_NOTE, MAIN], [], { rootId: "ax-root" });
      await refresh();
      expect(marked().new).toEqual(["ax-dom-8"]);
      expect(bar()).not.toBeNull();
    });
  });

  describe("an action sent through the tree", () => {
    it("reads the page again once it has settled, and marks what the action changed", async () => {
      await showNative();
      select("ax-dom-2");
      page = OPENED;
      press("Enter");
      await flush();
      expect(acts()).toEqual([{ nodeId: "ax-dom-2", action: "click" }]);

      await wait(NATIVE_SETTLE_MS - 1);
      expect(reads()).toBe(1);
      expect(marked()).toEqual(NOTHING_MARKED);

      await wait(1);
      expect(reads()).toBe(2);
      expect(marked()).toEqual({ new: ["ax-dom-4"], changed: ["ax-dom-2"] });
      const button = rowOf("ax-dom-2")!;
      expect(
        button.querySelector(".sn-change-tag--changed")?.getAttribute("title"),
      ).toBe("Changed since the read before:\nexpanded: collapsed → expanded");
      expect(button.querySelector(".sn-change-part")?.textContent).toBe(
        "expanded",
      );
      expect(heard("ax-dom-2")).toBe(", changed: now expanded");
      expect(heard("ax-dom-4")).toBe(", new");
      expect(summary()).toBe("1 new, 1 changed");
      expect(notice()?.textContent).toBe("1 new, 1 changed in the tree");
    });

    it("keeps what its re-read marked when a read that follows it up finds more", async () => {
      await showNative();
      await openMenuThroughTree();
      expect(marked()).toEqual({ new: ["ax-dom-4"], changed: ["ax-dom-2"] });

      // The items the page fetched for the menu arrive a moment later.
      page = FILLED;
      await wait(400);
      pageChanged(Date.now() - 300);
      await wait(AUTO_REFRESH_QUIET_MS + 10);
      expect(reads()).toBe(3);

      // Compared with the tree from before the action, not with the
      // re-read's: the button is still marked changed, beside what the
      // page added since. The menu the re-read found new opens now the
      // page has filled it, so its items show.
      expect(marked()).toEqual({
        new: ["ax-dom-4", "ax-dom-5", "ax-dom-6", "ax-dom-7"],
        changed: ["ax-dom-2"],
      });
      expect(heard("ax-dom-2")).toBe(", changed: now expanded");
      expect(rowOf("ax-dom-7")?.classList).toContain("sn-node--change-flash");
      expect(summary()).toBe("4 new, 1 changed");
      expect(notice()?.textContent).toBe("4 new, 1 changed in the tree");
    });

    it("keeps its marks, without flashing or saying them again, when a read that follows it up finds nothing more", async () => {
      await showNative();
      await openMenuThroughTree();
      // What the re-read said; said again, it would come in a new element.
      const said = notice()?.firstElementChild;
      expect(said?.textContent).toBe("1 new, 1 changed in the tree");
      await wait(CHANGE_FLASH_MS);
      expect(container.querySelector(".sn-node--change-flash")).toBeNull();

      // The page changes again inside the window, in nothing the tree shows.
      pageChanged(Date.now() - 300);
      await wait(AUTO_REFRESH_QUIET_MS + 10);
      expect(reads()).toBe(3);
      expect(marked()).toEqual({ new: ["ax-dom-4"], changed: ["ax-dom-2"] });
      expect(summary()).toBe("1 new, 1 changed");
      expect(container.querySelector(".sn-node--change-flash")).toBeNull();
      expect(notice()?.firstElementChild).toBe(said);
    });

    it("marks nothing in the first read of the page it navigated to, and marks what that page adds next against it", async () => {
      await showNative();
      select("ax-dom-2");
      page = CHECKOUT_LOADING;
      press("Enter");
      await flush();
      expect(acts()).toEqual([{ nodeId: "ax-dom-2", action: "click" }]);
      // The click navigates while the page settles, and the new page
      // connects.
      emit({ type: "PAGE_NAVIGATED", tabId: TAB_ID });
      emit(treeData());
      await flush();
      // The destination is read once the navigation has settled too.
      await wait(NATIVE_SETTLE_MS);
      await wait(NATIVE_SETTLE_MS);
      expect(reads()).toBe(2);
      expect(rowOf("ax-dom-51")).not.toBeNull();
      expect(marked()).toEqual(NOTHING_MARKED);
      expect(bar()).toBeNull();

      // Its payment form loads a moment later, which the follow window the
      // action opened on the new page reads.
      page = CHECKOUT_LOADED;
      await wait(400);
      pageChanged(Date.now() - 300);
      await wait(AUTO_REFRESH_QUIET_MS + 10);
      expect(reads()).toBe(3);
      expect(marked()).toEqual({ new: ["ax-dom-52"], changed: [] });
      expect(summary()).toBe("1 new");
      expect(notice()?.textContent).toBe("1 new in the tree");

      // And a status after it: still against the new page's first read.
      page = CHECKOUT_READY;
      await wait(400);
      pageChanged(Date.now() - 300);
      await wait(AUTO_REFRESH_QUIET_MS + 10);
      expect(reads()).toBe(4);
      expect(marked()).toEqual({
        new: ["ax-dom-52", "ax-dom-53"],
        changed: [],
      });
      expect(notice()?.textContent).toBe("2 new in the tree");
    });

    it("starts over on a Refresh after it, which compares with the tree on screen", async () => {
      await showNative();
      await openMenuThroughTree();
      page = FILLED;
      await wait(400);
      pageChanged(Date.now() - 300);
      await wait(AUTO_REFRESH_QUIET_MS + 10);
      expect(reads()).toBe(3);
      expect(marked().changed).toEqual(["ax-dom-2"]);

      // Still inside the window the action opened.
      await refresh();
      expect(reads()).toBe(4);
      expect(marked()).toEqual(NOTHING_MARKED);
      expect(bar()).toBeNull();
    });

    it("clears its marks on ✕, and a later read that follows it up marks only what came after", async () => {
      await showNative();
      await openMenuThroughTree();
      const clear = bar()?.querySelector<HTMLButtonElement>(
        'button[aria-label="Clear change marks"]',
      );
      expect(clear).toBeTruthy();
      act(() => clear!.focus());
      act(() => clear!.click());
      await flush();
      expect(marked()).toEqual(NOTHING_MARKED);
      expect(bar()).toBeNull();
      // Focus goes to the tree rather than with the bar.
      expect(document.activeElement).toBe(tree());

      page = FILLED;
      await wait(400);
      pageChanged(Date.now() - 300);
      await wait(AUTO_REFRESH_QUIET_MS + 10);
      expect(reads()).toBe(3);
      // Compared with the tree as it was when the marks were cleared: the
      // button and the menu are as they were then. The menu's new items,
      // under it while it is collapsed, are counted on it.
      expect(marked()).toEqual({ new: ["ax-dom-7"], changed: [] });
      expect(heard("ax-dom-4")).toBe(", 2 new inside");
      expect(summary()).toBe("3 new");
    });
  });

  describe("an automatic read", () => {
    it("marks what it found on Follow page changes, without saying it", async () => {
      await showNative({ [FOLLOW_PAGE_CHANGES_KEY]: true });
      // A while after that read: an automatic one keeps the minimum gap.
      await wait(AUTO_REFRESH_MIN_GAP_MS);
      page = SAVED;
      pageChanged(Date.now() - 300);
      await wait(AUTO_REFRESH_QUIET_MS + 10);

      expect(reads()).toBe(2);
      expect(marked()).toEqual({ new: ["ax-dom-8"], changed: [] });
      expect(summary()).toBe("1 new");
      expect(notice()?.textContent).toBe("");
    });

    it("compares a read after an action's follow window has closed with the tree on screen, and says nothing", async () => {
      await showNative({ [FOLLOW_PAGE_CHANGES_KEY]: true });
      await openMenuThroughTree();
      expect(notice()?.textContent).toBe("1 new, 1 changed in the tree");

      // Past the window the action's re-read opened, the page changes on
      // its own.
      await wait(ACTION_FOLLOW_MS + 100);
      page = FILLED;
      pageChanged(Date.now());
      await wait(AUTO_REFRESH_QUIET_MS + 10);
      expect(reads()).toBe(3);

      // Against the re-read's tree: the button and the menu are as they
      // were. The menu's new items, under it while it is collapsed, are
      // counted on it.
      expect(marked()).toEqual({ new: ["ax-dom-7"], changed: [] });
      expect(heard("ax-dom-4")).toBe(", 2 new inside");
      expect(summary()).toBe("3 new");
      expect(notice()?.textContent).not.toContain("3 new");
    });

    it("says what a click on the page did, and keeps it marked as the page goes on doing it", async () => {
      await showNative();
      await wait(AUTO_REFRESH_MIN_GAP_MS);
      emit({ type: "PAGE_INPUT", at: Date.now() });
      page = OPENED;
      await wait(400);
      pageChanged(Date.now() - 300);
      await wait(AUTO_REFRESH_QUIET_MS + 10);
      expect(reads()).toBe(2);
      expect(marked()).toEqual({ new: ["ax-dom-4"], changed: ["ax-dom-2"] });
      expect(notice()?.textContent).toBe("1 new, 1 changed in the tree");

      // What the click loaded, read no sooner than the minimum gap after the
      // read before.
      page = FILLED;
      await wait(400);
      pageChanged(Date.now() - 300);
      await wait(AUTO_REFRESH_MIN_GAP_MS);
      expect(reads()).toBe(3);
      expect(marked()).toEqual({
        new: ["ax-dom-4", "ax-dom-5", "ax-dom-6", "ax-dom-7"],
        changed: ["ax-dom-2"],
      });
      expect(summary()).toBe("4 new, 1 changed");
      expect(notice()?.textContent).toBe("4 new, 1 changed in the tree");
    });
  });
});
