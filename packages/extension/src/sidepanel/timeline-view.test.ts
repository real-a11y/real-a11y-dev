import type { TimelineEvent } from "@real-a11y-dev/core";
import { serializeTimeline } from "@real-a11y-dev/serialize";
import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { ContentToPanel, PanelToContent } from "../types.js";

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
 * The TIMELINE view's controls, each through the whole panel: Record and
 * Stop reach the page's top frame through the service worker, the lines are
 * `serializeTimeline`'s, Copy puts exactly those on the clipboard, and
 * nothing of a recording goes anywhere but the panel's memory.
 */

const deleteDraft: TimelineEvent = {
  kind: "focus",
  stop: {
    role: "button",
    name: "Delete draft",
    description: "",
    states: {},
    properties: {},
    isExposedToAT: true,
  },
  hidden: false,
};
const nowhere: TimelineEvent = { kind: "focus", stop: null, hidden: false };

describe("the TIMELINE view", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;
  let clipboard: string[];

  beforeEach(() => {
    stubMatchMedia();
    clipboard = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          clipboard.push(text);
        },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  const button = (label: string): HTMLButtonElement => {
    const found = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === label,
    );
    if (!found) throw new Error(`no ${label} button rendered`);
    return found;
  };
  const press = async (label: string) => {
    act(() => button(label).click());
    await flush();
  };
  const sent = (type: string) =>
    chromeMock.sent.filter(
      (m) => (m as { type: string }).type === type,
    ) as Array<PanelToContent & { payload: { session: string } }>;
  const lines = () =>
    [...container.querySelectorAll(".sn-timeline-line")].map(
      (el) => el.textContent,
    );
  const status = () =>
    container.querySelector(".sn-timeline-status")?.textContent ?? "";

  /** The panel bound to the page, on the TIMELINE view. */
  async function mountTimeline(
    options: Parameters<typeof installChromeMock>[0] = {},
  ): Promise<void> {
    chromeMock = installChromeMock({ nativeTree: NATIVE_TREE, ...options });
    act(() => {
      render(h(App, {}), container);
    });
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
    await press("TIMELINE");
  }

  /** The top frame's run of events for `session`. */
  function deliver(session: string, items: unknown[]): void {
    act(() => {
      chromeMock.emit({
        type: "TIMELINE_EVENTS",
        payload: { session, items },
      } as ContentToPanel);
    });
  }

  async function recordTwoLines(): Promise<string> {
    await press("● Record");
    const session = sent("TIMELINE_START")[0]!.payload.session;
    deliver(session, [
      { event: deleteDraft, nodeId: "sn-4" },
      { event: nowhere },
    ]);
    return session;
  }

  it("records: starts in the bound tab and streams the lines in", async () => {
    await mountTimeline();
    expect(status()).toBe("Press Record, then use the page.");

    await press("● Record");
    expect(sent("TIMELINE_START")).toEqual([
      {
        type: "TIMELINE_START",
        tabId: TAB_ID,
        payload: { session: expect.any(String) },
      },
    ]);
    expect(status()).toBe("Recording — 0 lines");

    const session = sent("TIMELINE_START")[0]!.payload.session;
    deliver(session, [
      { event: deleteDraft, nodeId: "sn-4" },
      { event: nowhere },
    ]);
    expect(lines()).toEqual([
      'focus     button "Delete draft"',
      "focus     (none)",
    ]);
    expect(status()).toBe("Recording — 2 lines");
  });

  it("says when the page can't record", async () => {
    await mountTimeline({
      respond: (m) =>
        (m as { type: string }).type === "TIMELINE_START"
          ? { success: false, error: "Content script not available" }
          : undefined,
    });
    await press("● Record");
    expect(status()).toBe(
      "Couldn't record this page: Content script not available",
    );
    expect(button("● Record")).toBeTruthy();
  });

  it("stops: tells the page, and keeps the lines", async () => {
    await mountTimeline();
    const session = await recordTwoLines();

    await press("■ Stop");
    expect(sent("TIMELINE_STOP")).toEqual([
      { type: "TIMELINE_STOP", tabId: TAB_ID, payload: { session } },
    ]);
    expect(status()).toBe("Stopped — 2 lines.");
    expect(lines()).toHaveLength(2);
    expect(button("● Record")).toBeTruthy();
  });

  it("copies exactly serializeTimeline's lines", async () => {
    await mountTimeline();
    await recordTwoLines();

    await press("Copy");
    expect(clipboard).toEqual([serializeTimeline([deleteDraft, nowhere])]);
  });

  it("clears the lines", async () => {
    await mountTimeline();
    await recordTwoLines();
    await press("■ Stop");

    await press("Clear");
    expect(lines()).toEqual([]);
    expect(button("Copy").disabled).toBe(true);
    expect(button("Clear").disabled).toBe(true);
  });

  it("shows a line's node on the page, leaving the page's focus alone", async () => {
    await mountTimeline();
    await recordTwoLines();

    const [named, none] = [...container.querySelectorAll(".sn-timeline-line")];
    // `(none)` names nothing to show.
    expect(none!.tagName).toBe("SPAN");
    act(() => (named as HTMLButtonElement).click());
    expect(sent("HIGHLIGHT_NODE").at(-1)).toEqual({
      type: "HIGHLIGHT_NODE",
      tabId: TAB_ID,
      payload: { nodeId: "sn-4", keepFocus: true },
    });
  });

  it("ends at a navigation: the lines stay, and none is clickable", async () => {
    await mountTimeline();
    const session = await recordTwoLines();

    act(() => {
      chromeMock.emit({ type: "PAGE_NAVIGATED", tabId: TAB_ID });
    });
    await flush();
    // The new page connects, and the panel shows its views again: the lines
    // were the panel's all along.
    act(() => {
      chromeMock.emit(treeData());
    });
    await flush();
    expect(lines()).toHaveLength(2);
    expect(status()).toBe("Recording ended: the page navigated. 2 lines.");
    expect(container.querySelectorAll("button.sn-timeline-line")).toHaveLength(
      0,
    );
    // The recorder in the page is told to stop too, in case it never left.
    expect(sent("TIMELINE_STOP")).toEqual([
      { type: "TIMELINE_STOP", tabId: TAB_ID, payload: { session } },
    ]);
  });

  it("drops the lines of an earlier recording", async () => {
    await mountTimeline();
    const first = await recordTwoLines();
    await press("■ Stop");
    await press("● Record");

    deliver(first, [{ event: deleteDraft }]);
    expect(lines()).toEqual([]);
  });

  it("shows an event of a kind it doesn't know, without failing", async () => {
    await mountTimeline();
    await press("● Record");
    const session = sent("TIMELINE_START")[0]!.payload.session;
    deliver(session, [
      { event: { kind: "press", key: "Delete" } },
      { event: nowhere },
    ]);
    expect(lines()).toHaveLength(2);
    expect(lines()[0]).toMatch(/^press {5}/);
    expect(lines()[1]).toBe("focus     (none)");
  });

  it("keeps the recording in the panel's memory alone", async () => {
    await mountTimeline({ storage: {} });
    await recordTwoLines();
    await press("Copy");
    await press("■ Stop");
    // Not a line, nor the name in one, in extension storage.
    expect(JSON.stringify(chromeMock.stored)).not.toContain("Delete draft");
    expect(JSON.stringify(chromeMock.stored)).not.toContain("focus");
  });
});
