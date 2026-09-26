/**
 * Content-script integration tests.
 *
 * Like `background.ts`, `content.ts` is wiring rather than a pure module: it
 * registers the `chrome.runtime.onMessage` listener and owns the per-frame
 * state (pick mode, curtain, observation) that the handlers read. The
 * interaction between a panel-driven action and the element picker is only
 * observable at that level, so these tests stand up a fake `chrome`, import
 * the real module, and drive it through the listener it registers.
 */

import type { SemanticNode } from "@real-a11y-dev/core";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const EXTENSION_ID = "test-extension-id";

type MessageListener = (
  message: { type: string; payload?: unknown },
  sender: { id?: string; tab?: { id: number }; frameId?: number },
  sendResponse: (response?: unknown) => void,
) => unknown;

interface Harness {
  /** Everything the content script sent to the background. */
  sent: Array<{ type: string; payload?: unknown }>;
  /** Deliver a message as the background would, returning the response. */
  send: (message: { type: string; payload?: unknown }) => unknown;
  chromeMock: unknown;
}

function makeHarness(): Harness {
  const sent: Array<{ type: string; payload?: unknown }> = [];
  const listeners: MessageListener[] = [];

  const chromeMock = {
    runtime: {
      id: EXTENSION_ID,
      onMessage: {
        addListener: (fn: MessageListener) => listeners.push(fn),
      },
      sendMessage: (msg: { type: string; payload?: unknown }) => {
        sent.push(msg);
      },
    },
  };

  return {
    sent,
    chromeMock,
    send(message) {
      let response: unknown;
      for (const fn of listeners) {
        // The real background is the only sender the content script trusts.
        fn(message, { id: EXTENSION_ID }, (r) => {
          response = r;
        });
      }
      return response;
    },
  };
}

/** The most recent tree the content script announced. */
function lastTree(h: Harness): Array<[string, SemanticNode]> {
  const frames = h.sent.filter((m) => m.type === "FRAME_TREE_DATA");
  const last = frames[frames.length - 1] as
    { payload: { nodes: Array<[string, SemanticNode]> } } | undefined;
  return last?.payload.nodes ?? [];
}

/** Node id of the first node whose DOM element is `tagName`. */
function nodeIdByTag(h: Harness, tagName: string): string {
  const match = lastTree(h).find(
    ([, node]) => node.dom?.tagName.toLowerCase() === tagName.toLowerCase(),
  );
  if (!match) throw new Error(`no ${tagName} node in the announced tree`);
  return match[0];
}

describe("content: panel-driven actions vs. the element picker", () => {
  let h: Harness;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML =
      `<button id="target">Click me</button>` +
      `<input id="field" type="text" aria-label="Field" />`;
    h = makeHarness();
    (globalThis as { chrome?: unknown }).chrome = h.chromeMock;
    await import("./content.js");
    // Populate the element-ref map so node ids resolve, then start from a
    // clean slate so assertions only see what the test itself provoked.
    h.send({ type: "REQUEST_TREE", payload: { viewMode: "a11y" } });
  });

  afterEach(() => {
    // Everything this module armed hangs off `document`, which outlives
    // `vi.resetModules()`: the picker's capture-phase listeners and the
    // DomObserver / live-region MutationObserver that `REQUEST_TREE` starts.
    // A module left armed keeps intercepting clicks and pushing stray
    // FRAME_TREE_DATA into the NEXT test's `h.sent` — which is what
    // `lastTree()` reads — through a `chrome` global it no longer owns.
    // Disarm both while this test's module is still the live one.
    h.send({ type: "SET_PICK_MODE", payload: { enabled: false } });
    h.send({ type: "SET_OBSERVING", payload: { enabled: false } });
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
    document.body.innerHTML = "";
  });

  it("does not report a spurious pick when an action is dispatched in pick mode", () => {
    const nodeId = nodeIdByTag(h, "button");
    h.send({ type: "SET_PICK_MODE", payload: { enabled: true } });
    h.sent.length = 0;

    h.send({
      type: "DISPATCH_ACTION",
      payload: { nodeId, action: "click" },
    });

    // The action arrived by node id from the panel — the user did not point
    // at anything, so nothing was picked.
    expect(h.sent.filter((m) => m.type === "NODE_PICKED")).toEqual([]);
  });

  it("stays in pick mode when an action is dispatched in pick mode", () => {
    const nodeId = nodeIdByTag(h, "button");
    h.send({ type: "SET_PICK_MODE", payload: { enabled: true } });
    h.sent.length = 0;

    h.send({
      type: "DISPATCH_ACTION",
      payload: { nodeId, action: "click" },
    });

    // Pick mode is the user's mode to leave; a panel action must not end it.
    expect(h.sent.filter((m) => m.type === "PICK_MODE_CHANGED")).toEqual([]);
  });

  it("still reports a real user pick while pick mode is on", () => {
    h.send({ type: "SET_PICK_MODE", payload: { enabled: true } });
    h.sent.length = 0;

    // A genuine click from the page, not one the dispatcher synthesized.
    document
      .getElementById("target")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(h.sent.filter((m) => m.type === "NODE_PICKED")).toHaveLength(1);
    expect(
      h.sent.filter(
        (m) =>
          m.type === "PICK_MODE_CHANGED" &&
          (m.payload as { enabled: boolean }).enabled === false,
      ),
    ).toHaveLength(1);
  });

  // The key bar is deliberately NOT gated. Escape is the one key the picker
  // reacts to, and leaving pick mode is a reasonable thing for Escape to do —
  // refusing it would leave the button inert instead, since the page does not
  // receive the key either way. Pinned so the gate is not widened to match
  // DISPATCH_ACTION's on the assumption that it was an oversight.
  it("lets the key bar's Escape leave pick mode, as it always has", () => {
    h.send({ type: "SET_PICK_MODE", payload: { enabled: true } });
    h.sent.length = 0;

    const result = h.send({
      type: "SEND_KEY",
      payload: { key: "Escape", code: "Escape", keyCode: 27 },
    });

    expect(result).toEqual({ success: true });
    expect(
      h.sent.filter(
        (m) =>
          m.type === "PICK_MODE_CHANGED" &&
          (m.payload as { enabled: boolean }).enabled === false,
      ),
    ).toHaveLength(1);
  });

  // The action gate is narrow: the picker swallows pointer events, so
  // everything else must keep working while it is armed. Blocking `type` in
  // particular would strand a value the user already typed into the panel's
  // input, which closes on submit whatever the frame answers.
  it("still types into a field while pick mode is on", () => {
    const nodeId = nodeIdByTag(h, "input");
    h.send({ type: "SET_PICK_MODE", payload: { enabled: true } });

    const result = h.send({
      type: "DISPATCH_ACTION",
      payload: { nodeId, action: "type", payload: { value: "hello" } },
    });

    expect(result).toEqual({ success: true });
    expect((document.getElementById("field") as HTMLInputElement).value).toBe(
      "hello",
    );
  });

  it("still toggles a <details> while pick mode is on", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<details id="d"><summary>More</summary>body</details>`,
    );
    h.send({ type: "REQUEST_TREE", payload: { viewMode: "a11y" } });
    const nodeId = nodeIdByTag(h, "details");
    h.send({ type: "SET_PICK_MODE", payload: { enabled: true } });

    const result = h.send({
      type: "DISPATCH_ACTION",
      payload: { nodeId, action: "toggle" },
    });

    // `toggle` flips `.open` directly — no pointer events, nothing for the
    // picker to swallow, so it is not in POINTER_ACTIONS.
    expect(result).toEqual({ success: true });
    expect((document.getElementById("d") as HTMLDetailsElement).open).toBe(
      true,
    );
  });

  it("still dispatches the action itself when pick mode is off", () => {
    const nodeId = nodeIdByTag(h, "button");
    const clicks: Event[] = [];
    document
      .getElementById("target")!
      .addEventListener("click", (e) => clicks.push(e));

    const result = h.send({
      type: "DISPATCH_ACTION",
      payload: { nodeId, action: "click" },
    });

    expect(result).toEqual({ success: true });
    expect(clicks).toHaveLength(1);
  });
});

/**
 * Regression (Devin Review, PR #412): the native tree's own selection-focus
 * follow (App.tsx's `focusNativeSelectionOnPage`) moves real page focus over
 * `chrome.debugger` — a real `focusin` event this content script cannot
 * otherwise tell apart from a genuine user-driven one. Without
 * `SUPPRESS_NATIVE_FOCUS_TRACK`, the reverse focus-sync listener below (on
 * by default, independent of which producer the panel is showing) reacted
 * to it and re-highlighted/scrolled to the element, fighting the
 * `preventScroll` the native dispatch had already passed.
 */
describe("content: native focus-follow suppresses the reverse focus-sync", () => {
  let h: Harness;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    // jsdom has no real layout engine, so `highlightElement`'s own
    // `scrollIntoView` call (the exact behavior these tests exist to
    // confirm is suppressed) has nothing to call through to.
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
    document.body.innerHTML = `<button id="target">Click me</button>`;
    h = makeHarness();
    (globalThis as { chrome?: unknown }).chrome = h.chromeMock;
    await import("./content.js");
    h.send({ type: "REQUEST_TREE", payload: { viewMode: "a11y" } });
    h.send({ type: "SET_FOCUS_TRACKER", payload: { enabled: true } });
  });

  afterEach(() => {
    // The focusin listener hangs off `document`, same as every other
    // listener this module arms — and unlike SET_PICK_MODE/SET_OBSERVING
    // above, no earlier test in this file ever turned SET_FOCUS_TRACKER on,
    // so this specific leak had nothing to expose until this describe block.
    // Left enabled, a stale listener from THIS test still fires (and still
    // reaches the CURRENT test's `chrome.runtime.sendMessage`, since it's
    // read off `globalThis` at call time, not captured) once the next test's
    // `vi.resetModules()` layers a second listener on top of it.
    h.send({ type: "SET_FOCUS_TRACKER", payload: { enabled: false } });
    h.send({ type: "SET_OBSERVING", payload: { enabled: false } });
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
    document.body.innerHTML = "";
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  function focusTarget(): void {
    document
      .getElementById("target")!
      .dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  }

  it("reports a real focus change to the panel when nothing suppressed it", () => {
    // Baseline: the tracker itself works absent this PR's own new message.
    h.sent.length = 0;
    focusTarget();
    expect(h.sent.filter((m) => m.type === "FOCUS_CHANGED")).toHaveLength(1);
  });

  function suppress(seq: number, active: boolean): void {
    h.send({
      type: "SUPPRESS_NATIVE_FOCUS_TRACK",
      payload: { seq, active },
    });
  }

  function reported(): number {
    return h.sent.filter((m) => m.type === "FOCUS_CHANGED").length;
  }

  it("drops the focus change the native dispatch causes while armed", () => {
    suppress(1, true);
    h.sent.length = 0;

    focusTarget();

    expect(reported()).toBe(0);
  });

  it("drops only that ONE focus change, not every one inside the window", () => {
    // Regression (Devin Review, second round): a blanket window swallowed a
    // genuine user click or Tab landing in the same 800ms, leaving reverse
    // focus sync stale until the next focus event.
    suppress(1, true);
    h.sent.length = 0;

    focusTarget();
    focusTarget();

    expect(reported()).toBe(1);
  });

  it("stops suppressing once the panel releases it", () => {
    suppress(1, true);
    suppress(1, false);
    h.sent.length = 0;

    focusTarget();

    expect(reported()).toBe(1);
  });

  it("ignores a late release from an older follow", () => {
    suppress(1, true);
    suppress(2, true);
    suppress(1, false);
    h.sent.length = 0;

    focusTarget();

    expect(reported()).toBe(0);
  });

  it("resumes tracking once the deadline passes with no release", () => {
    suppress(1, true);
    vi.advanceTimersByTime(801);
    h.sent.length = 0;

    focusTarget();

    expect(reported()).toBe(1);
  });
});

/**
 * What a frame does before any side panel connects to it.
 *
 * The content script is injected into every frame of every page the user
 * visits — banking, webmail, credential pages included — so what it does
 * while dormant is a privacy property, not just a cost one. These pin it:
 * an unarmed frame announces itself and nothing more.
 */
describe("content: a frame whose panel never connected", () => {
  let h: Harness;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML = `<button id="target">Click me</button>`;
    h = makeHarness();
    (globalThis as { chrome?: unknown }).chrome = h.chromeMock;
    // Deliberately no REQUEST_TREE / SET_OBSERVING: this is a frame the
    // background never armed, because no panel is open for its tab.
    await import("./content.js");
  });

  afterEach(() => {
    h.send({ type: "SET_PICK_MODE", payload: { enabled: false } });
    h.send({ type: "SET_OBSERVING", payload: { enabled: false } });
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
    document.body.innerHTML = "";
  });

  it("announces itself without extracting a tree", () => {
    expect(h.sent.map((m) => m.type)).toEqual(["FRAME_HELLO"]);
  });

  it("tells the background nothing about the page it is in", () => {
    // The announce is payload-free by design: the background identifies the
    // frame from `sender.tab.id` / `sender.frameId`, so a URL here would be
    // page data leaving a page the extension was never opened on.
    expect(h.sent).toEqual([{ type: "FRAME_HELLO" }]);
  });

  it("does not extract when the page mutates", async () => {
    h.sent.length = 0;
    document.body.appendChild(document.createElement("section"));
    await vi.advanceTimersByTimeAsync(2000);

    expect(h.sent).toEqual([]);
  });
});
