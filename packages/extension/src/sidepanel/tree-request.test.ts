import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { ContentToPanel, TreeRequest } from "../types.js";

import { App } from "./App.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  TAB_ID,
  installChromeMock,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * The tree the panel asks the page for (`TreeRequest`). While Chrome's tree
 * shows, each frame sends only its skeleton: enough to say the page is
 * there, its title, when it changed and which of its frames it shows. The
 * in-page tree, and a TAB view of either tree, need the in-page walk's whole
 * tree, and the panel asks for it while one of them shows.
 */

const SETTING = "settings.nativeModeEnabled";

/** A native read that succeeds, so Chrome's tree stays on screen. */
const NATIVE_TREE = {
  ok: true,
  nodes: [
    {
      id: "r1",
      role: "RootWebArea",
      name: "Test page",
      depth: 0,
      childIds: [],
      states: {},
      properties: {},
    },
  ],
  rootId: "r1",
  url: "https://example.test/",
  documentId: "doc-1",
};

describe("the tree the panel asks the page for", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  function mount(
    storage: Record<string, unknown> = {},
    /** Plays the service worker for NATIVE_FLAG_GET instead. */
    flagGet?: () => unknown,
  ): void {
    chromeMock = installChromeMock({
      storage: { "settings.nativeNoticeSeen": true, ...storage },
      respond: (message) => {
        const type = (message as { type: string }).type;
        if (type === "NATIVE_FLAG_GET") {
          if (flagGet) return flagGet();
          return { enabled: chromeMock.stored[SETTING] !== false };
        }
        if (type === "NATIVE_READ") return NATIVE_TREE;
        return undefined;
      },
    });
    act(() => {
      render(h(App, {}), container);
    });
  }

  beforeEach(() => {
    stubMatchMedia();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  /** Let the promise-form replies land and the effects they trigger run. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  /** The panel's bound tab becomes the test tab. */
  async function showTab(): Promise<void> {
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: TAB_ID,
      } as unknown as ContentToPanel);
    });
    await flush();
  }

  /** The page's frames send the panel their skeletons (here, the page's
   *  root alone: it holds no frame), or their trees. */
  async function pageSends(what: "skeletons" | "trees"): Promise<void> {
    const tree = treeData() as Extract<ContentToPanel, { type: "TREE_DATA" }>;
    const [rootId, root] = tree.payload.nodes[0]!;
    act(() => {
      chromeMock.emit(
        what === "skeletons"
          ? {
              ...tree,
              payload: {
                ...tree.payload,
                nodes: [[rootId, { ...root, childIds: [] }]],
                framesOnly: true,
              },
            }
          : tree,
      );
    });
    await flush();
  }

  /** The trees the panel has asked the page for, oldest first. */
  const asked = (): TreeRequest[] =>
    chromeMock.sent
      .filter((m) => m.type === "REQUEST_TREE" || m.type === "SET_VIEW_MODE")
      .map((m) => (m as { payload: TreeRequest }).payload);

  const buttonNamed = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === name,
    ) ?? null;

  async function press(name: string): Promise<void> {
    act(() => buttonNamed(name)!.click());
    await flush();
  }

  /** Choose a tree in Settings, as the user does. */
  async function chooseTree(name: "Chrome's tree" | "In-page tree") {
    if (!buttonNamed(name)) await press("Settings ▾");
    await press(name);
  }

  const nativeTree = () =>
    container.querySelector(
      '[role="tree"][aria-label^="Native accessibility tree"]',
    );
  const inPageRow = () => container.querySelector("[data-node-id='n3']");
  const reading = () =>
    container.querySelector<HTMLElement>('.sn-tree-pending[role="status"]');

  it("asks a page for its frames' skeletons while Chrome's tree may show, and connects on them", async () => {
    mount();
    await flush();
    await showTab();
    expect(asked().at(-1)).toEqual({ viewMode: "a11y", framesOnly: true });

    await pageSends("skeletons");
    // The page is there: Chrome's tree reads it.
    expect(nativeTree()).not.toBeNull();
    expect(asked().at(-1)).toEqual({ viewMode: "a11y", framesOnly: true });
  });

  it("asks for the whole tree once the in-page tree is chosen, reading the page until it lands", async () => {
    mount();
    await flush();
    await showTab();
    await pageSends("skeletons");

    await chooseTree("In-page tree");
    expect(asked().at(-1)).toEqual({ viewMode: "a11y", framesOnly: false });
    expect(reading()?.textContent).toBe("Reading the page…");
    expect(inPageRow()).toBeNull();

    await pageSends("trees");
    expect(reading()).toBeNull();
    expect(inPageRow()).not.toBeNull();

    // And Chrome's tree again: the skeletons do.
    await chooseTree("Chrome's tree");
    expect(asked().at(-1)).toEqual({ viewMode: "a11y", framesOnly: true });
  });

  it("keeps the in-page tree's scope and selection through Chrome's tree, whose skeletons are no tree", async () => {
    mount();
    await flush();
    await showTab();
    await pageSends("skeletons");
    await chooseTree("In-page tree");
    await pageSends("trees");
    act(() => {
      chromeMock.emit({
        type: "FOCUS_CHANGED",
        tabId: TAB_ID,
        payload: { nodeId: "n3" },
      } as unknown as ContentToPanel);
    });
    act(() => {
      container
        .querySelector("[data-node-id='n2']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    await flush();
    const scoped = () => container.querySelector(".sn-scope-bar");
    expect(scoped()).not.toBeNull();

    await chooseTree("Chrome's tree");
    await pageSends("skeletons");
    await pageSends("skeletons");
    await chooseTree("In-page tree");
    await pageSends("trees");
    expect(scoped()).not.toBeNull();
    expect(
      container
        .querySelector("[data-node-id='n3']")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("asks for the whole tree for Chrome's tree's TAB view, reading the tab order until it lands", async () => {
    mount();
    await flush();
    await showTab();
    await pageSends("skeletons");

    await press("TAB");
    expect(asked().at(-1)).toEqual({ viewMode: "tab", framesOnly: false });
    expect(container.textContent).toContain("Reading the page's tab order…");

    await pageSends("trees");
    expect(container.textContent).not.toContain(
      "Reading the page's tab order…",
    );

    await press("A11Y");
    expect(asked().at(-1)).toEqual({ viewMode: "a11y", framesOnly: true });
  });

  it("asks for the whole tree with native mode off", async () => {
    mount({ [SETTING]: false });
    await flush();
    await showTab();
    expect(asked().at(-1)).toEqual({ viewMode: "a11y", framesOnly: false });

    await pageSends("trees");
    expect(inPageRow()).not.toBeNull();
    expect(nativeTree()).toBeNull();
  });

  it("asks for the whole tree where the setting can't be read, as the panel stays on the in-page tree", async () => {
    // Neither the service worker nor storage says.
    chromeMock = installChromeMock({ respond: () => undefined });
    act(() => {
      render(h(App, {}), container);
    });
    await flush();
    await showTab();
    expect(asked().at(-1)).toEqual({ viewMode: "a11y", framesOnly: false });
  });

  it("asks for the whole tree once a change in storage says native mode is off, as the panel had it", async () => {
    // The service worker never answers the panel's own read.
    mount({ [SETTING]: false }, () => new Promise(() => {}));
    await flush();
    act(() => chromeMock.writeStorage({ [SETTING]: false }));
    await flush();
    await showTab();
    expect(asked().at(-1)).toEqual({ viewMode: "a11y", framesOnly: false });
  });

  it("lists none of the stops the page had in Chrome's TAB view while it reads the page again", async () => {
    mount();
    await flush();
    await showTab();
    await pageSends("skeletons");
    const stops = () =>
      [...container.querySelectorAll('[role="option"]')].map((o) =>
        o.textContent?.includes("Save"),
      );
    /** The tree, its buttons tab stops. */
    const withStops = () => {
      const tree = treeData() as Extract<ContentToPanel, { type: "TREE_DATA" }>;
      for (const [, node] of tree.payload.nodes) {
        if (node.a11y.role === "button") {
          (node.interaction as { isFocusable: boolean }).isFocusable = true;
        }
      }
      act(() => chromeMock.emit(tree));
    };

    await press("TAB");
    withStops();
    await flush();
    expect(stops()).toEqual([true, false]);

    await press("A11Y");
    await pageSends("skeletons");
    await press("TAB");
    expect(stops()).toEqual([]);
    expect(container.textContent).toContain("Reading the page's tab order…");
    withStops();
    await flush();
    expect(stops()).toEqual([true, false]);
  });

  it("asks no tab for a tree before one is bound, which would be another window's", async () => {
    // The setting, read before the panel has its tab, changes the tree it
    // wants.
    mount({ [SETTING]: false });
    await flush();
    expect(asked()).toEqual([]);

    await showTab();
    expect(
      chromeMock.sent
        .filter((m) => m.type === "REQUEST_TREE" || m.type === "SET_VIEW_MODE")
        .map((m) => m.tabId),
    ).toEqual(asked().map(() => TAB_ID));
    expect(asked().at(-1)).toEqual({ viewMode: "a11y", framesOnly: false });
  });

  it("asks a service worker that restarted for the tree it wants, which that one forgot", async () => {
    mount();
    await flush();
    await showTab();
    await pageSends("skeletons");
    await press("TAB");
    const before = chromeMock.sent.length;

    act(() => chromeMock.dropPort());
    await flush();
    expect(
      chromeMock.sent
        .slice(before)
        .filter((m) => m.type === "SET_VIEW_MODE")
        .map((m) => (m as { payload: TreeRequest }).payload),
    ).toEqual([{ viewMode: "tab", framesOnly: false }]);
  });
});
