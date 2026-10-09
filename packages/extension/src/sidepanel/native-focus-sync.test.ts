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
    childIds: ["ax-dom-3", "ax-dom-4"],
    pageKey: 2,
  },
  { id: "ax-dom-3", role: "button", name: "Save", depth: 2, pageKey: 5 },
  { id: "ax-dom-4", role: "link", name: "Docs", depth: 2, pageKey: 6 },
];

describe("native focus sync", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;
  /** What the next NATIVE_READ answers with as its numbering. */
  let readId: string | undefined;

  beforeEach(() => {
    readId = "read-1";
    stubMatchMedia();
    chromeMock = installChromeMock({
      respond: (message) => {
        const type = (message as { type: string }).type;
        if (type === "NATIVE_FLAG_GET") return { enabled: true };
        if (type === "NATIVE_READ") {
          return {
            ok: true,
            url: "https://example.test/",
            rootId: "ax-root",
            nodes: structuredClone(NODES),
            ...(readId !== undefined ? { pageKeysReadId: readId } : {}),
          };
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
});
