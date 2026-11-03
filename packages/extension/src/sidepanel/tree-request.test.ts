import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { ContentToPanel, TreeRequest } from "../types.js";

import { App } from "./App.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  NATIVE_TREE,
  TAB_ID,
  installChromeMock,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * The tree the panel asks the page for (`TreeRequest`). While Chrome's tree
 * shows its A11Y view, each frame sends only its skeleton: enough to say the
 * page is there, its title, when it changed and which of its frames it
 * shows. The TAB view lists the in-page walk's tab stops, so the panel asks
 * for the whole tree while it shows.
 */

describe("the tree the panel asks the page for", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  function mount(storage: Record<string, unknown> = {}): void {
    chromeMock = installChromeMock({
      storage: { "settings.nativeNoticeSeen": true, ...storage },
      nativeTree: NATIVE_TREE,
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

  const nativeTree = () =>
    container.querySelector(
      '[role="tree"][aria-label^="Native accessibility tree"]',
    );

  it("asks a page for its frames' skeletons while Chrome's tree shows, and connects on them", async () => {
    mount();
    await flush();
    await showTab();
    expect(asked().at(-1)).toEqual({ framesOnly: true });

    await pageSends("skeletons");
    // The page is there: Chrome's tree reads it.
    expect(nativeTree()).not.toBeNull();
    expect(asked().at(-1)).toEqual({ framesOnly: true });
  });

  it("asks for the whole tree for the TAB view, reading the tab order until it lands", async () => {
    mount();
    await flush();
    await showTab();
    await pageSends("skeletons");

    await press("TAB");
    expect(asked().at(-1)).toEqual({ framesOnly: false });
    expect(container.textContent).toContain("Reading the page's tab order…");

    await pageSends("trees");
    expect(container.textContent).not.toContain(
      "Reading the page's tab order…",
    );

    await press("A11Y");
    expect(asked().at(-1)).toEqual({ framesOnly: true });
  });

  it("shows Chrome's tree where an older version stored native mode off", async () => {
    // Up to 0.1.17 the user could turn native mode off, and the panel then
    // asked each page for its whole tree. The setting is gone, and what it
    // stored no longer counts.
    mount({ "settings.nativeModeEnabled": false });
    await flush();
    await showTab();
    expect(asked().at(-1)).toEqual({ framesOnly: true });

    await pageSends("skeletons");
    expect(nativeTree()).not.toBeNull();
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
    mount();
    await flush();
    expect(asked()).toEqual([]);

    await showTab();
    expect(
      chromeMock.sent
        .filter((m) => m.type === "REQUEST_TREE" || m.type === "SET_VIEW_MODE")
        .map((m) => m.tabId),
    ).toEqual(asked().map(() => TAB_ID));
    expect(asked().at(-1)).toEqual({ framesOnly: true });
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
    ).toEqual([{ framesOnly: false }]);
  });
});
