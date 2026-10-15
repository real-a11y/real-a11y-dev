import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { NativeNode } from "../native/native-actions.js";
import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import {
  ACTION_FOLLOW_MS,
  AUTO_REFRESH_MIN_GAP_MS,
  AUTO_REFRESH_QUIET_MS,
  NATIVE_SETTLE_MS,
} from "./native-auto-refresh.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  TAB_ID,
  installChromeMock,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * Chrome's tree after the user clicks or presses Enter on the page itself
 * (`PAGE_INPUT`): what the page does in the next few seconds is read, as
 * after an action sent through the tree, but a change the panel had heard
 * of before the input is the page's own doing, and leaves the tree alone.
 */

const NODES: NativeNode[] = [
  { id: "ax-root", role: "document", name: "", depth: 0, childIds: ["b"] },
  { id: "b", role: "button", name: "Save", depth: 1 },
];

describe("Chrome's tree after the user acts on the page", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;
  /** The user cancels Chrome's bar on each read while this is set. */
  let cancelReads: boolean;

  beforeEach(() => {
    cancelReads = false;
    vi.useFakeTimers();
    stubMatchMedia();
    chromeMock = installChromeMock({
      respond: (message) => {
        const type = (message as { type: string }).type;
        if (type === "NATIVE_FLAG_GET") return { enabled: true };
        if (type === "NATIVE_READ") {
          if (cancelReads) return { ok: false, error: "cancelled-by-user" };
          return {
            ok: true,
            url: "https://example.test/",
            rootId: "ax-root",
            nodes: structuredClone(NODES),
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
    vi.useRealTimers();
  });

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

  /** The panel on Chrome's tree, read once a while ago, with nothing sent
   *  since. */
  async function showNative(): Promise<void> {
    act(() => {
      render(h(App, {}), container);
    });
    await flush();
    emit({ type: "ACTIVE_TAB_CHANGED", tabId: TAB_ID });
    act(() => {
      chromeMock.emit(treeData());
    });
    await flush();
    expect(reads()).toBe(1);
    chromeMock.sent.length = 0;
    await wait(AUTO_REFRESH_MIN_GAP_MS);
  }

  function emit(message: object): void {
    act(() => {
      chromeMock.emit(message as unknown as ContentToPanel);
    });
  }

  /** A burst of page changes, as the service worker reports it. */
  function pageChanged(at: number): void {
    const data = treeData() as { payload: Record<string, unknown> };
    emit({
      ...data,
      payload: { ...data.payload, pageChangedAt: [at] },
    });
  }

  const reads = () =>
    chromeMock.sent.filter(
      (m) => (m as { type: string }).type === "NATIVE_READ",
    ).length;

  it("reads what the page does after the user clicks it", async () => {
    await showNative();
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
  });

  it("reads nothing for a click that changes nothing", async () => {
    await showNative();
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(ACTION_FOLLOW_MS + AUTO_REFRESH_QUIET_MS);
    expect(reads()).toBe(0);
  });

  it("leaves alone a change heard of before the click, which the page made itself", async () => {
    await showNative();
    // Heard of; the quiet period after it is still running when the user
    // clicks something that does nothing.
    pageChanged(Date.now() - 500);
    await wait(AUTO_REFRESH_QUIET_MS - 200);
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(ACTION_FOLLOW_MS);
    expect(reads()).toBe(0);
  });

  it("still reads what the click does after such a change", async () => {
    await showNative();
    pageChanged(Date.now() - 500);
    await wait(AUTO_REFRESH_QUIET_MS - 200);
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
  });

  it("leaves alone a change made before one already heard of", async () => {
    // Another frame's, whose report came late: since the tree was read,
    // but before the click.
    await showNative();
    const heardAt = Date.now() - 500;
    pageChanged(heardAt);
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    emit({ type: "PAGE_INPUT", at: Date.now() });
    pageChanged(heardAt - 200);
    await wait(ACTION_FOLLOW_MS);
    expect(reads()).toBe(0);
  });
  it("reads a change a window that just closed followed, though a click opens another", async () => {
    await showNative();
    emit({ type: "PAGE_INPUT", at: Date.now() });
    // What the first click loaded, late in its window, still in its quiet
    // period when the user clicks again.
    await wait(ACTION_FOLLOW_MS + 100);
    pageChanged(Date.now() - 500);
    await wait(100);
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(AUTO_REFRESH_QUIET_MS);
    expect(reads()).toBe(1);
  });

  it("stretches the window for a click while it is open", async () => {
    await showNative();
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(3000);
    emit({ type: "PAGE_INPUT", at: Date.now() });
    // Past the first click's window, inside the second's.
    await wait(3000);
    pageChanged(Date.now() - 300);
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
  });

  it("reads a later burst no sooner than the minimum gap after the read before", async () => {
    await showNative();
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
    // A second burst, such as the form a spinner made way for.
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
    await wait(AUTO_REFRESH_MIN_GAP_MS - AUTO_REFRESH_QUIET_MS - 400);
    expect(reads()).toBe(2);
  });
  it("follows the page a click leads to at the click's pace", async () => {
    await showNative();
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(1000);
    emit({ type: "PAGE_NAVIGATED", tabId: TAB_ID });
    // The new page reports itself, and is read once it goes quiet.
    await wait(500);
    pageChanged(Date.now() - 300);
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
    // What it adds after that read is followed, no closer than the gap.
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
    await wait(AUTO_REFRESH_MIN_GAP_MS);
    expect(reads()).toBe(2);
  });

  it("still reads each burst at once after a key sent through the tree", async () => {
    await showNative();
    const enter = container.querySelector<HTMLButtonElement>(
      'button[title="Send Enter key"]',
    );
    act(() => {
      enter!.click();
    });
    await flush();
    // The key's own re-read, once the page has had time to react.
    await wait(NATIVE_SETTLE_MS + 10);
    expect(reads()).toBe(1);
    for (const n of [2, 3]) {
      await wait(400);
      pageChanged(Date.now() - 300);
      await wait(AUTO_REFRESH_QUIET_MS + 10);
      expect(reads()).toBe(n);
    }
  });
  it("follows nothing for a click while auto-refresh is paused", async () => {
    await showNative();
    // An automatic read the user cancels on Chrome's bar pauses it.
    cancelReads = true;
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
    cancelReads = false;
    await wait(ACTION_FOLLOW_MS);
    // A click while paused, then the user's Refresh, which resumes it.
    emit({ type: "PAGE_INPUT", at: Date.now() });
    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Refresh native tree"]',
        )!
        .click();
    });
    await flush();
    expect(reads()).toBe(2);
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(ACTION_FOLLOW_MS);
    expect(reads()).toBe(2);
  });
  it("stops following once the user types", async () => {
    await showNative();
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(400);
    emit({ type: "PAGE_TYPING", at: Date.now() });
    // What the typing changed.
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(ACTION_FOLLOW_MS);
    expect(reads()).toBe(0);
  });

  it("still reads what the click did before the user typed", async () => {
    await showNative();
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(400);
    pageChanged(Date.now() - 300);
    emit({ type: "PAGE_TYPING", at: Date.now() });
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
  });
  it("stops following at the moment the user typed, though heard of later", async () => {
    await showNative();
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(400);
    const typedAt = Date.now();
    // What the typing changed, dated just after it, and the report of the
    // typing reaching the panel a moment later.
    await wait(5);
    emit({ type: "PAGE_TYPING", at: typedAt });
    pageChanged(typedAt + 1);
    await wait(ACTION_FOLLOW_MS);
    expect(reads()).toBe(0);
  });

  it("follows no click the user typed after, though its busy frame reported it last", async () => {
    await showNative();
    const clickedAt = Date.now();
    // Typing in another frame, reported at once, then the click's report.
    await wait(200);
    emit({ type: "PAGE_TYPING", at: Date.now() });
    await wait(500);
    emit({ type: "PAGE_INPUT", at: clickedAt });
    // What the typing changed.
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(ACTION_FOLLOW_MS);
    expect(reads()).toBe(0);
  });

  it("keeps following a click the user typed before, though the typing's busy frame reported it last", async () => {
    await showNative();
    const typedAt = Date.now();
    // A click in another frame, reported at once, then the typing's report:
    // the edit made late, the key pressed before the click.
    await wait(200);
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(500);
    emit({ type: "PAGE_TYPING", at: Date.now(), pressedAt: typedAt });
    // What the click loaded.
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
  });

  it("follows a click made after the user typed, though their busy frame made the edit after it", async () => {
    await showNative();
    const pressedAt = Date.now();
    await wait(200);
    const clickedAt = Date.now();
    // The frame, busy, makes the edit, then dispatches the click.
    await wait(500);
    emit({ type: "PAGE_TYPING", at: Date.now(), pressedAt });
    emit({ type: "PAGE_INPUT", at: clickedAt });
    // What the click loaded.
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
  });

  it("stops following once the user types, though the page's clock runs ahead", async () => {
    await showNative();
    emit({ type: "PAGE_INPUT", at: Date.now() + 60_000 });
    await wait(400);
    emit({ type: "PAGE_TYPING", at: Date.now() });
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(ACTION_FOLLOW_MS);
    expect(reads()).toBe(0);
  });

  it("takes a click dated ahead of now as made when it was heard of", async () => {
    await showNative();
    emit({ type: "PAGE_INPUT", at: Date.now() + 60_000 });
    const heardAt = Date.now();
    // Typing whose key was pressed before that, reported after it.
    await wait(400);
    emit({ type: "PAGE_TYPING", at: Date.now(), pressedAt: heardAt - 100 });
    // What the click loaded.
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
  });

  it("takes a key dated after its edit as pressed when the edit was made", async () => {
    await showNative();
    const typedAt = Date.now();
    emit({ type: "PAGE_TYPING", at: typedAt, pressedAt: typedAt + 2000 });
    // A click after the edit, which a busy frame reported late.
    await wait(3000);
    emit({ type: "PAGE_INPUT", at: typedAt + 1000 });
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
  });

  it("follows nothing for a report that doesn't say when", async () => {
    await showNative();
    emit({ type: "PAGE_INPUT" });
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(ACTION_FOLLOW_MS);
    expect(reads()).toBe(0);
  });

  it("doesn't follow the page a click led to once the user types there", async () => {
    await showNative();
    emit({ type: "PAGE_INPUT", at: Date.now() });
    await wait(1000);
    emit({ type: "PAGE_NAVIGATED", tabId: TAB_ID });
    await wait(500);
    // The new page's first report, and the user typing before it is read.
    pageChanged(Date.now() - 300);
    emit({ type: "PAGE_TYPING", at: Date.now() });
    await wait(AUTO_REFRESH_QUIET_MS + 10);
    expect(reads()).toBe(1);
    await wait(400);
    pageChanged(Date.now() - 300);
    await wait(ACTION_FOLLOW_MS);
    expect(reads()).toBe(1);
  });
});
