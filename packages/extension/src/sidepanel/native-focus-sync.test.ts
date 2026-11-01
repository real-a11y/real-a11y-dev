import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { NativeNode } from "../native/native-actions.js";
import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  TAB_ID,
  installChromeMock,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * Focus sync over Chrome's tree: the content script reports page focus by
 * the numbers a native read gave the page's elements, and the panel selects
 * the row those numbers name in the tree it got from that read.
 */

const NODES: NativeNode[] = [
  {
    id: "ax-root",
    role: "document",
    name: "",
    depth: 0,
    childIds: ["ax-dom-2"],
  },
  {
    id: "ax-dom-2",
    role: "main",
    name: "",
    depth: 1,
    childIds: ["ax-dom-3", "ax-dom-4", "ax-dom-8"],
    pageKey: 2,
  },
  { id: "ax-dom-3", role: "button", name: "Save", depth: 2, pageKey: 5 },
  { id: "ax-dom-4", role: "link", name: "Docs", depth: 2, pageKey: 6 },
  // A frame (3, as the extension knows it), whose document is numbered on
  // its own: its button's 5 is not the top document's.
  {
    id: "ax-dom-8",
    role: "Iframe",
    name: "Frame",
    depth: 2,
    childIds: ["ax-dom-25"],
    pageKey: 7,
    embedsPageFrame: 3,
  },
  {
    id: "ax-dom-25",
    role: "button",
    name: "Inner save",
    depth: 3,
    pageKey: 5,
    pageFrame: 3,
  },
];

describe("native focus sync", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;
  /** What the next NATIVE_READ answers with as its numbering. */
  let readId: string | undefined;
  /** Holds the next NATIVE_READ's reply back until it settles. */
  let hold: Promise<void> | null;

  beforeEach(() => {
    readId = "read-1";
    hold = null;
    stubMatchMedia();
    chromeMock = installChromeMock({
      respond: (message) => {
        const type = (message as { type: string }).type;
        if (type === "NATIVE_READ") {
          // Numbered when the panel asks, as the service worker does.
          const numbered =
            readId !== undefined &&
            (message as { pageKeys?: boolean }).pageKeys === true;
          const reply = {
            ok: true,
            url: "https://example.test/",
            rootId: "ax-root",
            nodes: structuredClone(NODES),
            ...(numbered ? { pageKeysReadId: readId } : {}),
          };
          const held = hold;
          hold = null;
          return held ? held.then(() => reply) : reply;
        }
        return undefined;
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  /** The panel on Chrome's tree for the bound tab, read once. */
  async function showNative(): Promise<void> {
    act(() => {
      render(h(App, {}), container);
    });
    await flush();
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: TAB_ID,
      } as unknown as ContentToPanel);
    });
    act(() => {
      chromeMock.emit(treeData());
    });
    await flush();
    expect(container.querySelector('[data-node-id="ax-dom-3"]')).not.toBeNull();
  }

  function focusOnPage(payload: object): void {
    act(() => {
      chromeMock.emit({
        type: "FOCUS_CHANGED",
        tabId: TAB_ID,
        payload,
      } as unknown as ContentToPanel);
    });
  }

  const selected = () =>
    container
      .querySelector('[role="treeitem"][aria-selected="true"]')
      ?.getAttribute("data-node-id") ?? null;

  const sentOfType = (type: string) =>
    chromeMock.sent.filter((m) => (m as { type: string }).type === type);

  it("selects the row the page's focus went to, by the numbers of the read the tree came from", async () => {
    await showNative();
    focusOnPage({ nodeId: "n3", pageKeys: { "read-1": [6, 2, 0] } });
    expect(selected()).toBe("ax-dom-4");
    // An element with no row of its own: the nearest row above it.
    focusOnPage({ pageKeys: { "read-1": [9, 2, 0] } });
    expect(selected()).toBe("ax-dom-2");
  });

  it("selects a row inside a frame from that frame's report, by that frame's numbers alone", async () => {
    await showNative();
    focusOnPage({ pageKeys: { "read-1": [5, 2, 0] }, frameId: 3 });
    expect(selected()).toBe("ax-dom-25");
    focusOnPage({ pageKeys: { "read-1": [5, 2, 0] }, frameId: 0 });
    expect(selected()).toBe("ax-dom-3");
    focusOnPage({ pageKeys: { "read-1": [5] }, frameId: 3 });
    expect(selected()).toBe("ax-dom-25");
    // A report with no frame is the top frame's.
    focusOnPage({ pageKeys: { "read-1": [5] } });
    expect(selected()).toBe("ax-dom-3");
  });

  it("selects the frame's own row when nothing focused in the frame has one, and nothing for a frame the read didn't number", async () => {
    await showNative();
    focusOnPage({ pageKeys: { "read-1": [5] }, frameId: 4 });
    expect(selected()).toBeNull();
    // The frame's <body>, say: no row of its own, nor any above it there.
    focusOnPage({ pageKeys: { "read-1": [1, 0] }, frameId: 3 });
    expect(selected()).toBe("ax-dom-8");
  });

  it("sends nothing back to the page for it", async () => {
    await showNative();
    const acts = sentOfType("NATIVE_ACT").length;
    const reads = sentOfType("NATIVE_READ").length;
    focusOnPage({ pageKeys: { "read-1": [5] } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(selected()).toBe("ax-dom-3");
    expect(sentOfType("NATIVE_ACT")).toHaveLength(acts);
    expect(sentOfType("NATIVE_READ")).toHaveLength(reads);
  });

  it("ignores numbers from another read, and a report with none", async () => {
    await showNative();
    focusOnPage({ pageKeys: { "read-1": [5] } });
    focusOnPage({ pageKeys: { "read-0": [6] } });
    focusOnPage({ nodeId: "n3" });
    expect(selected()).toBe("ax-dom-3");
  });

  it("follows nothing once a read comes back without numbering the page", async () => {
    await showNative();
    readId = undefined;
    const refresh = [...container.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Refresh native tree",
    )!;
    act(() => refresh.click());
    await flush();
    focusOnPage({ pageKeys: { "read-1": [5] } });
    expect(selected()).toBeNull();
  });

  it("follows nothing while Focus sync is off, and again once it is back on", async () => {
    await showNative();
    const toggle = container.querySelector<HTMLButtonElement>(
      ".sn-focus-tracker-btn",
    )!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(sentOfType("SET_FOCUS_TRACKER").at(-1)).toMatchObject({
      payload: { enabled: false },
    });
    // The service worker turns the content script's tracker back on whenever
    // a frame sends its tree, so reports can still come.
    focusOnPage({ pageKeys: { "read-1": [5] } });
    expect(selected()).toBeNull();

    act(() => toggle.click());
    focusOnPage({ pageKeys: { "read-1": [5] } });
    expect(selected()).toBe("ax-dom-3");
  });

  it("asks for the page numbered only while Focus sync is on, and reads again when it is turned on", async () => {
    await showNative();
    const reads = () =>
      sentOfType("NATIVE_READ") as Array<{ pageKeys?: boolean }>;
    expect(reads().at(-1)?.pageKeys).toBe(true);

    const toggle = container.querySelector<HTMLButtonElement>(
      ".sn-focus-tracker-btn",
    )!;
    const refresh = [...container.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Refresh native tree",
    )!;
    act(() => toggle.click());
    act(() => refresh.click());
    await flush();
    expect(reads().at(-1)?.pageKeys).toBeUndefined();

    // That tree has nothing to follow focus by: turning Focus sync on reads
    // it again, numbered, and quietly, as auto-refresh does.
    const before = reads().length;
    act(() => toggle.click());
    await flush();
    expect(reads()).toHaveLength(before + 1);
    expect(reads().at(-1)).toMatchObject({ pageKeys: true, auto: true });
    focusOnPage({ pageKeys: { "read-1": [5] } });
    expect(selected()).toBe("ax-dom-3");

    // Turned off and on again over a numbered tree, it reads nothing.
    act(() => toggle.click());
    act(() => toggle.click());
    await flush();
    expect(reads()).toHaveLength(before + 1);
  });

  it("numbers the tree once a read under way when Focus sync was turned on comes back without numbers", async () => {
    await showNative();
    const reads = () =>
      sentOfType("NATIVE_READ") as Array<{
        pageKeys?: boolean;
        auto?: boolean;
      }>;
    const toggle = container.querySelector<HTMLButtonElement>(
      ".sn-focus-tracker-btn",
    )!;
    const refresh = [...container.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Refresh native tree",
    )!;
    act(() => toggle.click());
    let release = () => {};
    hold = new Promise<void>((resolve) => (release = resolve));
    act(() => refresh.click());
    await flush();
    // On while that read, sent without numbers, is still out.
    act(() => toggle.click());
    await flush();
    const before = reads().length;
    expect(reads().at(-1)?.pageKeys).toBeUndefined();

    release();
    await flush();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await flush();
    expect(reads()).toHaveLength(before + 1);
    expect(reads().at(-1)).toMatchObject({ pageKeys: true, auto: true });
    focusOnPage({ pageKeys: { "read-1": [6] } });
    expect(selected()).toBe("ax-dom-4");
  });

  it("tells each tab it is bound to how Focus sync is set", async () => {
    await showNative();
    act(() =>
      container
        .querySelector<HTMLButtonElement>(".sn-focus-tracker-btn")!
        .click(),
    );
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: TAB_ID + 1,
      } as unknown as ContentToPanel);
    });
    expect(sentOfType("SET_FOCUS_TRACKER").at(-1)).toMatchObject({
      tabId: TAB_ID + 1,
      payload: { enabled: false },
    });
  });
});
