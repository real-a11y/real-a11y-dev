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

/**
 * Focus sync walks up from the focused element to the nearest node in the
 * tree. A form rendered since the last extraction isn't in it yet — a dialog's
 * form that focuses its first field as it opens is focused before the
 * debounced refresh runs — so the walk has to get past the form.
 */
describe("content: focus inside a form whose control shadows its properties", () => {
  let h: Harness;
  const scrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    // jsdom has no scrollIntoView, which highlighting the focused node calls.
    Element.prototype.scrollIntoView = () => {};
    document.body.innerHTML = `<main id="app"></main>`;
    h = makeHarness();
    (globalThis as { chrome?: unknown }).chrome = h.chromeMock;
    await import("./content.js");
    h.send({ type: "REQUEST_TREE", payload: { viewMode: "a11y" } });
    h.send({ type: "SET_FOCUS_TRACKER", payload: { enabled: true } });
  });

  afterEach(() => {
    h.send({ type: "SET_FOCUS_TRACKER", payload: { enabled: false } });
    h.send({ type: "SET_OBSERVING", payload: { enabled: false } });
    vi.clearAllTimers();
    vi.useRealTimers();
    Element.prototype.scrollIntoView = scrollIntoView;
    delete (globalThis as { chrome?: unknown }).chrome;
    document.body.innerHTML = "";
  });

  it("walks past the form to the nearest node in the tree", () => {
    const mainId = nodeIdByTag(h, "main");
    document.getElementById("app")!.innerHTML =
      `<form><input type="hidden" name="parentElement">` +
      `<input id="inside" aria-label="Inside"></form>`;
    // In a browser `form.parentElement` is that control, whose parent is the
    // form again, so a plain walk never ends. Forced, because jsdom doesn't
    // shadow a form's properties.
    const form = document.querySelector("form")!;
    Object.defineProperty(form, "parentElement", {
      configurable: true,
      get: () => form.querySelector('[name="parentElement"]'),
    });
    h.sent.length = 0;

    document
      .getElementById("inside")!
      .dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(h.sent.filter((m) => m.type === "FOCUS_CHANGED")).toEqual([
      { type: "FOCUS_CHANGED", payload: { nodeId: mainId } },
    ]);
  });

  it("walks past a form whose control shadows nodeType", () => {
    // `form.nodeType` is then that control, not 1, so the walk took the form
    // for no element at all and stopped below it, syncing nothing.
    const mainId = nodeIdByTag(h, "main");
    document.getElementById("app")!.innerHTML =
      `<form><input type="hidden" name="nodeType">` +
      `<input id="inside" aria-label="Inside"></form>`;
    const form = document.querySelector("form")!;
    const control = form.querySelector('[name="nodeType"]');
    Object.defineProperty(form, "nodeType", {
      configurable: true,
      get: () => control,
    });
    h.sent.length = 0;

    document
      .getElementById("inside")!
      .dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(h.sent.filter((m) => m.type === "FOCUS_CHANGED")).toEqual([
      { type: "FOCUS_CHANGED", payload: { nodeId: mainId } },
    ]);
  });

  it("moves focus to an editable form selected in the panel", () => {
    // The form is the editing host: its parent is not editable. Read through
    // the control, which inherits the form's editability, it looked like an
    // element inside an editor, which takes no focus of its own.
    document.getElementById("app")!.innerHTML =
      `<form contenteditable="true" aria-label="Note">` +
      `<input name="parentElement" aria-label="Title"></form>`;
    const form = document.querySelector("form")!;
    Object.defineProperty(form, "parentElement", {
      configurable: true,
      get: () => form.querySelector('[name="parentElement"]'),
    });
    // jsdom has no isContentEditable; give each element Chrome's answer.
    const editable: Array<[Element, boolean]> = [
      [document.getElementById("app")!, false],
      [form, true],
      [form.querySelector("input")!, true],
    ];
    for (const [el, value] of editable) {
      Object.defineProperty(el, "isContentEditable", {
        configurable: true,
        value,
      });
    }
    const focus = vi.spyOn(form, "focus");
    h.send({ type: "REQUEST_TREE", payload: { viewMode: "a11y" } });

    h.send({
      type: "HIGHLIGHT_NODE",
      payload: { nodeId: nodeIdByTag(h, "form") },
    });

    expect(focus).toHaveBeenCalled();
  });
});

/**
 * The live-region observer reports what a screen reader would announce when a
 * `status`/`alert`/`log`/`aria-live` region changes, and sends it over the
 * extension's message channel to the panel. What the page never shows as
 * text has no business on that channel — least of all a `<textarea>`'s
 * markup text, which is its DEFAULT value and, for a sensitive field
 * (ADR-0001), the secret itself.
 */
describe("content: live regions", () => {
  let h: Harness;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML =
      `<div id="ready" role="status">Ready</div>` +
      `<div id="status" role="status"></div>` +
      `<div id="polite" aria-live="polite"></div>` +
      `<p id="elsewhere">Not a region</p>`;
    h = makeHarness();
    (globalThis as { chrome?: unknown }).chrome = h.chromeMock;
    await import("./content.js");
    // Arms the observers, as a panel opening does.
    h.send({ type: "REQUEST_TREE", payload: { viewMode: "a11y" } });
    h.sent.length = 0;
  });

  afterEach(() => {
    h.send({ type: "SET_OBSERVING", payload: { enabled: false } });
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
    document.body.innerHTML = "";
  });

  /** Replace region `id`'s content and let the observer's debounce run. */
  async function announce(id: string, html: string): Promise<unknown[]> {
    document.getElementById(id)!.innerHTML = html;
    await vi.advanceTimersByTimeAsync(500);
    return h.sent.filter((m) => m.type === "LIVE_REGION").map((m) => m.payload);
  }

  it("reports a region's text", async () => {
    expect(await announce("status", "Saved")).toEqual([
      { text: "Saved", level: "polite", role: "status" },
    ]);
  });

  it("announces no region that nothing changed in", async () => {
    // `#ready` held its text before the panel opened. A screen reader never
    // announces that, and reading every region on each change used to log it
    // the first time anything on the page moved.
    expect(await announce("elsewhere", "Changed")).toEqual([]);
  });

  it("reads a region added with its text", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<section><div role="alert">Session expired</div></section>`,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(
      h.sent.filter((m) => m.type === "LIVE_REGION").map((m) => m.payload),
    ).toEqual([{ text: "Session expired", level: "assertive", role: "alert" }]);
  });

  it("never sends a sensitive textarea's markup text", async () => {
    const sent = await announce(
      "status",
      `Code sent <textarea autocomplete="one-time-code">902114</textarea>`,
    );
    expect(sent).toEqual([
      { text: "Code sent", level: "polite", role: "status" },
    ]);
    expect(JSON.stringify(sent)).not.toContain("902114");
  });

  it("never sends the markup text of a textarea that is the region", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<textarea id="otp" aria-live="polite" autocomplete="one-time-code"></textarea>`,
    );
    const sent = await announce("otp", "902114");
    expect(JSON.stringify(sent)).not.toContain("902114");
  });

  it("reads no control's child text as the region's", async () => {
    const sent = await announce(
      "polite",
      `Draft saved<textarea>first draft</textarea>` +
        `<select><option>Apple</option><option>Pear</option></select>`,
    );
    expect(sent).toEqual([
      { text: "Draft saved", level: "polite", role: "status" },
    ]);
  });

  it("leaves out what a screen reader would not announce", async () => {
    const sent = await announce(
      "status",
      `3 results` +
        `<span aria-hidden="true"> ✓</span>` +
        `<span hidden> hidden</span>` +
        `<span style="display: none"> display-none</span>` +
        `<span style="visibility: hidden"> invisible</span>` +
        `<span inert> inert</span>` +
        `<style>.x { color: red }</style>` +
        `<script>window.leak = 1</script>`,
    );
    expect(sent).toEqual([
      { text: "3 results", level: "polite", role: "status" },
    ]);
  });

  it("sends nothing from a region hidden from assistive technology", async () => {
    document.getElementById("status")!.setAttribute("aria-hidden", "true");
    expect(await announce("status", "Saved")).toEqual([]);
  });

  it("sends nothing from a region inside something hidden", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div style="display: none"><div id="toast" role="status"></div></div>` +
        `<div aria-hidden="true"><div id="backdrop" aria-live="polite"></div></div>`,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(await announce("toast", "Saved")).toEqual([]);
    expect(await announce("backdrop", "Loading")).toEqual([]);
  });

  it("reads text a child shows again under visibility: hidden", async () => {
    // `visibility` is inherited but overridable: the child is on screen and
    // announced, while its parent's own text is not.
    const sent = await announce(
      "status",
      `<div style="visibility: hidden">Draft saved ` +
        `<span style="visibility: visible">Card declined</span></div>`,
    );
    expect(sent).toEqual([
      { text: "Card declined", level: "polite", role: "status" },
    ]);
  });

  it("reads a closed <details> as its summary", async () => {
    const sent = await announce(
      "status",
      `Saved. <details><summary>Details</summary>debug trace</details>`,
    );
    expect(sent).toEqual([
      { text: "Saved. Details", level: "polite", role: "status" },
    ]);
  });

  it("reads a region's shadow tree as rendered", async () => {
    // The shadow tree renders, with the light DOM slotted into it; light
    // children no slot takes don't render at all.
    const status = document.getElementById("status")!;
    status.attachShadow({ mode: "open" }).innerHTML =
      `<b>Saved</b> <slot name="detail"></slot>`;
    const sent = await announce(
      "status",
      `<span slot="detail">2 files</span><span>unslotted</span>`,
    );
    expect(sent).toEqual([
      { text: "Saved 2 files", level: "polite", role: "status" },
    ]);
  });

  it("still reads a form whose control shadows hasAttribute", async () => {
    // In a browser `form.hasAttribute` is that control, so core's hidden-check
    // throws calling it. Forced, because jsdom doesn't shadow a form's
    // properties. (A shadowed `nodeType` can't be modelled here: jsdom's own
    // getComputedStyle reads it and throws, where Chromium's never does.) The
    // region still reports the text it shows.
    const status = document.getElementById("status")!;
    status.innerHTML = `<form><input name="hasAttribute">Sent</form>`;
    const form = status.querySelector("form")!;
    Object.defineProperty(form, "hasAttribute", {
      configurable: true,
      get: () => form.querySelector('[name="hasAttribute"]'),
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(
      h.sent.filter((m) => m.type === "LIVE_REGION").map((m) => m.payload),
    ).toEqual([{ text: "Sent", level: "polite", role: "status" }]);
  });
});
