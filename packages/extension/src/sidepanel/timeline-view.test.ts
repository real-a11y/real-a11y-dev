import type { TimelineEvent } from "@real-a11y-dev/core";
import { serializeTimeline } from "@real-a11y-dev/serialize";
import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
    act(() => {
      button(label).focus();
      button(label).click();
    });
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
    expect(status()).toBe("Recording…");

    const session = sent("TIMELINE_START")[0]!.payload.session;
    deliver(session, [
      { event: deleteDraft, nodeId: "sn-4" },
      { event: nowhere },
    ]);
    expect(lines()).toEqual([
      'focus     button "Delete draft"',
      "focus     (none)",
    ]);
    // Not the count: the status is a live region.
    expect(status()).toBe("Recording…");
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
    expect(button("Copy").getAttribute("aria-disabled")).toBe("true");
    expect(button("Clear").getAttribute("aria-disabled")).toBe("true");
    // Focus stays on Clear: a disabled button would have dropped it.
    expect(document.activeElement).toBe(button("Clear"));
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

  it("takes focus to its own toggle when the tree's hides with the tree", async () => {
    await mountTimeline();
    // `mountTimeline` pressed the tree toolbar's TIMELINE, which is now out
    // of sight.
    const own = container.querySelector(
      '.sn-timeline .sn-toggle-btn[aria-pressed="true"]',
    );
    expect(own?.textContent).toBe("TIMELINE");
    expect(document.activeElement).toBe(own);
  });

  it("keeps focus on Record as it turns to Stop and back", async () => {
    await mountTimeline();
    await press("● Record");
    expect(document.activeElement?.textContent).toBe("■ Stop");
    await press("■ Stop");
    expect(document.activeElement?.textContent).toBe("● Record");
  });

  it("holds a port while it records, which stops the page when the panel goes", async () => {
    await mountTimeline();
    const session = await recordTwoLines();
    const [port] = chromeMock.otherPorts;
    expect(port).toMatchObject({
      name: "timeline-recording",
      posted: [{ tabId: TAB_ID, session }],
      closed: false,
    });

    // A service worker that restarts drops it: held again.
    act(() => port!.drop());
    expect(chromeMock.otherPorts).toHaveLength(2);
    expect(chromeMock.otherPorts[1]!.posted).toEqual([
      { tabId: TAB_ID, session },
    ]);

    await press("■ Stop");
    expect(chromeMock.otherPorts[1]!.closed).toBe(true);
  });

  it("says when another panel's recording took its place", async () => {
    await mountTimeline();
    const session = await recordTwoLines();
    act(() => {
      chromeMock.emit({
        type: "TIMELINE_ENDED",
        payload: { session, reason: "replaced" },
      } as ContentToPanel);
    });
    expect(status()).toBe(
      "Recording ended: another side panel started recording this page. 2 lines.",
    );
  });

  it("holds its port from before the page answers, and lets go when the start fails", async () => {
    let portsAtStart = -1;
    await mountTimeline({
      respond: (m) => {
        if ((m as { type: string }).type !== "TIMELINE_START") return undefined;
        portsAtStart = chromeMock.otherPorts.length;
        return { success: false, error: "Content script not available" };
      },
    });
    await press("● Record");
    // A panel closing while the start was on its way still stops it.
    expect(portsAtStart).toBe(1);
    expect(chromeMock.otherPorts[0]!.closed).toBe(true);
  });

  it("gives focus back to the tree's view toggle when it leaves through its own", async () => {
    await mountTimeline();
    const own = container.querySelector<HTMLButtonElement>(
      ".sn-timeline .sn-toggle-btn",
    )!;
    expect(own.textContent).toBe("A11Y");
    act(() => {
      own.focus();
      own.click();
    });
    await flush();
    expect(container.querySelector(".sn-timeline")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
  });

  it("holds its port again each time a worker that idled out drops it", async () => {
    await mountTimeline();
    await recordTwoLines();
    const now = Date.now();
    for (let i = 1; i <= 8; i++) {
      // Each drop comes long after its port opened, as an idle worker's does.
      const later = now + i * 60_000;
      const spy = vi.spyOn(Date, "now").mockReturnValue(later);
      act(() => chromeMock.otherPorts.at(-1)!.drop());
      spy.mockRestore();
    }
    expect(chromeMock.otherPorts).toHaveLength(9);
  });

  it("asks a few times at most for a port the worker turns away at once", async () => {
    await mountTimeline();
    await recordTwoLines();
    for (let i = 0; i < 10; i++) {
      act(() => chromeMock.otherPorts.at(-1)!.drop());
    }
    // Asked again after a quick drop, but not without end.
    expect(chromeMock.otherPorts.length).toBeGreaterThan(2);
    expect(chromeMock.otherPorts.length).toBeLessThanOrEqual(6);
  });

  it("still shows a finished recording to copy on a page that can't connect", async () => {
    await mountTimeline();
    await recordTwoLines();
    // To a page no content script runs on (a PDF): nothing connects again.
    act(() => {
      chromeMock.emit({ type: "PAGE_NAVIGATED", tabId: TAB_ID });
    });
    await flush();
    expect(lines()).toHaveLength(2);
    await press("Copy");
    expect(clipboard).toEqual([serializeTimeline([deleteDraft, nowhere])]);
  });

  it("moves no focus when it comes back as a page connects", async () => {
    await mountTimeline();
    await recordTwoLines();
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => {
      chromeMock.emit({ type: "PAGE_NAVIGATED", tabId: TAB_ID });
    });
    await flush();
    act(() => {
      chromeMock.emit(treeData());
    });
    await flush();
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps the finished recording when Record fails on a page that can't connect", async () => {
    let refuse = false;
    await mountTimeline({
      respond: (m) =>
        refuse && (m as { type: string }).type === "TIMELINE_START"
          ? { success: false, error: "Content script not available" }
          : undefined,
    });
    await recordTwoLines();
    act(() => {
      chromeMock.emit({ type: "PAGE_NAVIGATED", tabId: TAB_ID });
    });
    await flush();
    refuse = true;
    await press("● Record");
    expect(lines()).toEqual([
      'focus     button "Delete draft"',
      "focus     (none)",
    ]);
    expect(status()).toBe(
      "Couldn't record this page: Content script not available",
    );
    await press("Copy");
    expect(clipboard).toEqual([serializeTimeline([deleteDraft, nowhere])]);
  });
});
