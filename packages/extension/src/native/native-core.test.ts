import type { RawNativeAXNode } from "@real-a11y-dev/core";
import { beforeEach, describe, expect, it } from "vitest";

import {
  backendNodeIdFrom,
  dispatchNative,
  findNative,
  IN_PAGE_ACTION_SOURCE,
  pageClick,
  pageType,
  readNativeTree,
  type CdpTransport,
} from "./native-core.js";

// A scripted fake CDP transport — records every call, returns programmed
// responses. The same shape the chrome.debugger and Playwright transports have.
type Handler = (method: string, params?: object) => unknown;
class FakeTransport implements CdpTransport {
  calls: { method: string; params?: object }[] = [];
  constructor(private handler: Handler) {}
  async send<T>(method: string, params?: object) {
    this.calls.push({ method, params });
    return this.handler(method, params) as T;
  }
}

/** Resolve any backend node to `objectId`, run `fnResult` from callFunctionOn. */
function resolving(objectId: string | null, fnResult: unknown): Handler {
  return (method) => {
    if (method === "DOM.resolveNode")
      return objectId ? { object: { objectId } } : {};
    if (method === "Runtime.callFunctionOn")
      return { result: { value: fnResult } };
    return {};
  };
}

describe("backendNodeIdFrom", () => {
  it("parses author-DOM ids and rejects unbacked ones", () => {
    expect(backendNodeIdFrom("ax-dom-42")).toBe(42);
    expect(backendNodeIdFrom("ax-7")).toBeNull();
    expect(backendNodeIdFrom("garbage")).toBeNull();
  });
});

describe("readNativeTree", () => {
  it("reads getFullAXTree and normalizes via the shared core vocabulary", async () => {
    const raw: RawNativeAXNode[] = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "RootWebArea" },
        childIds: ["2", "3"],
      },
      {
        nodeId: "2",
        backendDOMNodeId: 20,
        role: { value: "heading" },
        name: { value: "Hi" },
      },
      {
        nodeId: "3",
        backendDOMNodeId: 30,
        role: { value: "button" },
        name: { value: "Save" },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    expect(t.calls[0].method).toBe("Accessibility.enable");
    expect(res.rawCount).toBe(3);
    expect(res.serialized).toContain('button "Save"');
    expect(findNative(res.nodes, "button", "Save")?.id).toBe("ax-dom-30");
  });
});

describe("dispatchNative", () => {
  it("clicks via resolveNode + callFunctionOn", async () => {
    const t = new FakeTransport(resolving("obj-1", { ok: true }));
    const res = await dispatchNative(t, "ax-dom-42", "click");
    expect(res).toEqual({ success: true });
    expect(t.calls.find((c) => c.method === "DOM.resolveNode")?.params).toEqual(
      {
        backendNodeId: 42,
      },
    );
  });

  it("refuses a node with no backing DOM element without any CDP traffic", async () => {
    const t = new FakeTransport(() => ({}));
    const res = await dispatchNative(t, "ax-9", "click");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no backing DOM element/);
    expect(t.calls).toHaveLength(0);
  });

  it("rejects an unsupported action", async () => {
    const t = new FakeTransport(() => ({}));
    // @ts-expect-error — exercising the runtime guard on a bad action.
    const res = await dispatchNative(t, "ax-dom-1", "scroll");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unsupported action/);
    expect(t.calls).toHaveLength(0);
  });

  it("types the value INTO the page but never returns it (R1)", async () => {
    const t = new FakeTransport(resolving("obj-2", { ok: true }));
    const res = await dispatchNative(
      t,
      "ax-dom-5",
      "type",
      "hunter2@example.com",
    );
    expect(res).toEqual({ success: true });
    const call = t.calls.find((c) => c.method === "Runtime.callFunctionOn");
    expect(JSON.stringify(call?.params)).toContain("hunter2@example.com"); // goes in
    expect(JSON.stringify(res)).not.toContain("hunter2@example.com"); // never out
  });

  it("requires a string value for type", async () => {
    const t = new FakeTransport(resolving("obj-3", { ok: true }));
    const res = await dispatchNative(t, "ax-dom-5", "type");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/requires a string value/);
  });

  it("reports a stale id when the node no longer resolves", async () => {
    const t = new FakeTransport(resolving(null, undefined));
    const res = await dispatchNative(t, "ax-dom-42", "click");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/could not resolve/);
  });

  it("surfaces the in-page reason, never a raw error", async () => {
    const t = new FakeTransport((method) => {
      if (method === "DOM.resolveNode") return { object: { objectId: "o" } };
      if (method === "Runtime.callFunctionOn")
        throw new Error("secret@example.com in the page");
      return {};
    });
    const res = await dispatchNative(t, "ax-dom-8", "click");
    expect(res.success).toBe(false);
    expect(res.error).not.toContain("secret@example.com");
  });
});

// The in-page action functions are DOM code that happens to be *delivered* over
// CDP, so they're exercised as DOM code — called with the element as `this`,
// exactly as `Runtime.callFunctionOn` invokes them.

/** Call an in-page function the way Runtime.callFunctionOn does: as `this`. */
function on<A extends unknown[], R>(
  fn: (this: Element, ...args: A) => R,
  el: Element,
  ...args: A
): R {
  return fn.call(el, ...args);
}

function record(el: Element, types: string[]): string[] {
  const seen: string[] = [];
  for (const type of types) el.addEventListener(type, () => seen.push(type));
  return seen;
}

const POINTER_SEQUENCE = [
  "pointerdown",
  "mousedown",
  "pointerup",
  "mouseup",
  "click",
];

describe("in-page actions — click", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("fires the full pointer sequence, not a bare click", () => {
    // Regression: this path used to call `this.click()`, which fires `click`
    // alone. jsaction / Material handlers gate on the pointer sequence, so
    // those pages saw nothing while the marker still reported success.
    const el = document.createElement("button");
    document.body.appendChild(el);
    const seen = record(el, POINTER_SEQUENCE);

    expect(on(pageClick, el)).toEqual({ ok: true });
    expect(seen).toEqual(POINTER_SEQUENCE);
  });

  it("reaches a pointerdown-only handler (the jsaction failure mode)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    let fired = false;
    el.addEventListener("pointerdown", () => {
      fired = true;
    });
    expect(on(pageClick, el)).toEqual({ ok: true });
    expect(fired).toBe(true);
  });

  it("redirects a composite wrapper to the control that carries the handler", () => {
    // `menuitem` and `tab` are in the panel's ACTABLE set, and a delegated
    // handler walks UP from the target — so dispatching on the wrapper misses
    // it entirely and the click silently does nothing.
    for (const role of ["menuitem", "tab", "treeitem", "option"]) {
      document.body.innerHTML = `<div role="${role}"><button>go</button></div>`;
      const wrapper = document.body.firstElementChild as Element;
      const inner = wrapper.querySelector("button") as Element;
      let innerClicked = false;
      inner.addEventListener("click", () => {
        innerClicked = true;
      });

      expect(on(pageClick, wrapper)).toEqual({ ok: true });
      expect(innerClicked).toBe(true);
    }
  });

  it("leaves a well-formed control alone", () => {
    document.body.innerHTML = `<button id="b">go</button>`;
    const el = document.getElementById("b") as Element;
    const seen = record(el, ["click"]);
    expect(on(pageClick, el)).toEqual({ ok: true });
    expect(seen).toEqual(["click"]);
  });
});

describe("in-page actions — type", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("writes a native input through the prototype setter", () => {
    const el = document.createElement("input");
    document.body.appendChild(el);
    const seen = record(el, ["input", "change"]);
    expect(on(pageType, el, "hello")).toEqual({ ok: true });
    expect(el.value).toBe("hello");
    expect(seen).toEqual(["input", "change"]);
  });

  it("gives a model-driven editor a cancelable beforeinput and respects it", () => {
    // Regression: this path used to write `textContent` unconditionally.
    // ProseMirror/Lexical/Draft consume `beforeinput`, insert into their own
    // model, and revert the DOM — so the write was lost while the marker said
    // success. Cancelling must leave the DOM untouched.
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    el.textContent = "original";
    document.body.appendChild(el);
    let sawBeforeInput = false;
    el.addEventListener("beforeinput", (e) => {
      sawBeforeInput = true;
      e.preventDefault(); // the editor handled it
    });

    expect(on(pageType, el, "typed")).toEqual({ ok: true });
    expect(sawBeforeInput).toBe(true);
    expect(el.textContent).toBe("original"); // not clobbered
  });

  it("writes contenteditable when nothing handled beforeinput", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    document.body.appendChild(el);
    expect(on(pageType, el, "typed")).toEqual({ ok: true });
    expect(el.textContent).toBe("typed");
  });

  it("refuses a non-text element instead of reporting success", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(on(pageType, el, "x")).toEqual({
      ok: false,
      reason: "not-a-text-field",
    });
  });

  it("never returns the typed text (R1)", () => {
    const el = document.createElement("input");
    document.body.appendChild(el);
    const marker = on(pageType, el, "hunter2");
    expect(JSON.stringify(marker)).not.toContain("hunter2");
  });
});

describe("in-page action source", () => {
  it("serializes to self-contained source for Runtime.callFunctionOn", () => {
    // Each is shipped as source text, so nothing may reference a module-scope
    // binding — that would be a ReferenceError in the page, not a build error.
    for (const src of Object.values(IN_PAGE_ACTION_SOURCE)) {
      expect(src).toMatch(/^function/);
      expect(src).not.toContain("import");
    }
    // The composite list must live inside the click body, not hoisted.
    expect(IN_PAGE_ACTION_SOURCE.click).toContain("treeitem");
  });
});
