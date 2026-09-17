import type { RawNativeAXNode } from "@real-a11y-dev/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  backendNodeIdFrom,
  dispatchNative,
  findNative,
  IN_PAGE_ACTION_SOURCE,
  pageClick,
  pageReadValue,
  pageSelectOption,
  pageStep,
  pageType,
  readNativeTree,
  rootIdOf,
  type CdpTransport,
  type EnrichedNativeNode,
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

  it("attaches states/properties — the enrichment normalizeNativeAX doesn't do", async () => {
    // core's normalizeNativeAX only reads role/name/tree-shape, so a bare
    // property list would never surface `expanded`, `level`, etc. at all —
    // this is the enrichment layered on top, mirroring browser's axFacets.
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "RootWebArea" },
        childIds: ["2", "3"],
      },
      {
        nodeId: "2",
        backendDOMNodeId: 20,
        role: { value: "button" },
        name: { value: "Billing Address" },
        properties: [
          { name: "expanded", value: { value: true } },
          { name: "hasPopup", value: { value: "listbox" } },
        ],
      },
      {
        nodeId: "3",
        backendDOMNodeId: 30,
        role: { value: "heading" },
        name: { value: "Personal Information" },
        properties: [{ name: "level", value: { value: 2 } }],
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);

    const button = findNative(res.nodes, "button", "Billing Address");
    expect(button?.states).toEqual({ expanded: true });
    expect(button?.properties).toEqual({ hasPopup: "listbox" });

    const heading = findNative(res.nodes, "heading", "Personal Information");
    expect(heading?.states).toEqual({});
    expect(heading?.properties).toEqual({ level: "2" });
  });

  /**
   * Live dogfood finding: "error messages not visible on native tree" — an
   * invalid form field's `aria-describedby`-linked error text ("Ingresa tu
   * e-mail.") showed up in the DOM/A11Y tree view but was entirely absent
   * from the native tree, because `EnrichedNativeNode` never carried a
   * `description` field at all. Unlike `states`/`properties`, this is a
   * top-level AX `description` field, not one of the `properties` array —
   * `browser`'s own native producer (`native-tree.ts`) already reads it
   * from exactly this shape, with no redaction gate: it's page-authored
   * help/error text, not user input (R1 only concerns typed field values).
   */
  it("attaches the accessible description from the raw AX node's top-level description field", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "combobox" },
        name: { value: "E-mail" },
        description: { value: "  Ingresa tu e-mail.  " },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    const field = findNative(res.nodes, "combobox", "E-mail");
    // Cleaned the same way browser's own cleanText does — collapsed
    // whitespace, trimmed.
    expect(field?.description).toBe("Ingresa tu e-mail.");
  });

  it("gives an empty description, not undefined, when the raw node has none", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "button" },
        name: { value: "Save" },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "button", "Save")?.description).toBe("");
  });

  it("never surfaces valuenow/valuetext — R1", async () => {
    // These two AX properties ARE the user's current input for a value-bearing
    // control (spinbutton, slider). Letting them through the enrichment would
    // carry a field value into the dogfood panel — the exact thing R1 forbids.
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "slider" },
        name: { value: "Volume" },
        properties: [
          { name: "valuenow", value: { value: 42 } },
          { name: "valuetext", value: { value: "42%" } },
          { name: "valuemin", value: { value: 0 } },
        ],
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    const slider = findNative(res.nodes, "slider", "Volume");
    expect(slider?.properties).toEqual({ valuemin: "0" });
    expect(slider?.properties).not.toHaveProperty("valuenow");
    expect(slider?.properties).not.toHaveProperty("valuetext");
  });

  it("attaches a field value for a value-bearing role via the in-page read-back", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "textbox" },
        name: { value: "Name:" },
      },
    ];
    const t = new FakeTransport((method) => {
      if (method === "Accessibility.getFullAXTree") return { nodes: raw };
      if (method === "DOM.resolveNode") return { object: { objectId: "obj" } };
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: { value: "456465" } } };
      }
      return {};
    });
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "textbox", "Name:")?.value).toBe("456465");
  });

  it("carries a redacted marker through instead of a value", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "textbox" },
        name: { value: "Password" },
      },
    ];
    const t = new FakeTransport((method) => {
      if (method === "Accessibility.getFullAXTree") return { nodes: raw };
      if (method === "DOM.resolveNode") return { object: { objectId: "obj" } };
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: { redacted: true } } };
      }
      return {};
    });
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "textbox", "Password")?.value).toBe(
      "[redacted]",
    );
  });

  it("never resolves a node whose role isn't value-bearing — no wasted round trip", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "button" },
        name: { value: "Save" },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    expect(findNative(res.nodes, "button", "Save")?.value).toBeUndefined();
    expect(t.calls.some((c) => c.method === "DOM.resolveNode")).toBe(false);
  });

  /**
   * A real page's `<header>`/`<main>`/`<footer>` layout is the ordinary case,
   * not an edge case: `normalizeNativeAX` drops `RootWebArea`, so a plain
   * multi-landmark page yields several parent-less nodes with no single
   * `rootId` a tree UI can render from — the dogfood panel never needed one
   * (a flat depth-indented list has no root concept at all), but a real
   * expand/collapse tree does. See `rootIdOf`'s own tests for the pure
   * logic; this pins that `readNativeTree` actually wires it through.
   */
  it("synthesizes a rootId when Chromium's tree has more than one parent-less node", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "RootWebArea" },
        childIds: ["2", "3"],
      },
      {
        nodeId: "2",
        parentId: "1",
        backendDOMNodeId: 20,
        role: { value: "heading" },
        name: { value: "Hi" },
      },
      {
        nodeId: "3",
        parentId: "1",
        backendDOMNodeId: 30,
        role: { value: "button" },
        name: { value: "Save" },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    expect(res.rootId).toBe("ax-root");
  });

  it("uses the single surviving node as rootId when there's only one", async () => {
    const raw = [
      {
        nodeId: "1",
        backendDOMNodeId: 10,
        role: { value: "RootWebArea" },
        childIds: ["2"],
      },
      {
        nodeId: "2",
        parentId: "1",
        backendDOMNodeId: 20,
        role: { value: "main" },
        name: { value: "" },
      },
    ];
    const t = new FakeTransport((method) =>
      method === "Accessibility.getFullAXTree" ? { nodes: raw } : {},
    );
    const res = await readNativeTree(t);
    expect(res.rootId).toBe("ax-dom-20");
  });
});

/** Minimal `EnrichedNativeNode` fixture — only the fields `rootIdOf` reads. */
function node(
  id: string,
  childIds: string[] = [],
  depth = 0,
): EnrichedNativeNode {
  return {
    id,
    role: "generic",
    name: "",
    depth,
    backendDOMNodeId: null,
    childIds,
    states: {},
    properties: {},
    description: "",
  };
}

/**
 * Live dogfood finding: rounds up to this point never needed a `rootId` at
 * all — the dogfood panel renders a flat depth-indented list. Restoring a
 * real tree structure for the production panel integration needs one, the
 * same way the DOM producer always has exactly one root. Mirrors
 * `@real-a11y-dev/browser`'s own `native-tree.ts` root-synthesis exactly.
 */
describe("rootIdOf", () => {
  it("returns the single node's id when there's exactly one root", () => {
    const nodes = [node("a", ["b"]), node("b", [], 1)];
    expect(rootIdOf(nodes)).toBe("a");
  });

  it("returns empty string for an empty tree", () => {
    expect(rootIdOf([])).toBe("");
  });

  it("synthesizes an ax-root wrapper adopting every parent-less node", () => {
    const nodes = [node("a"), node("b")];
    const rootId = rootIdOf(nodes);
    expect(rootId).toBe("ax-root");
    const synthetic = nodes.find((n) => n.id === "ax-root");
    expect(synthetic?.role).toBe("document");
    expect(synthetic?.childIds).toEqual(["a", "b"]);
  });

  it("pushes the synthetic root into the array so a consumer can find it by id", () => {
    const nodes = [node("a"), node("b")];
    rootIdOf(nodes);
    expect(nodes).toHaveLength(3);
  });

  /**
   * Wrapping shifts every former root down a level — without recomputing
   * depth, a consumer indenting rows by `node.depth` would render the two
   * top-level landmarks at the SAME indentation as the synthetic root that
   * now contains them, and their own children one level too shallow.
   */
  it("recomputes depth for every node relative to the real root after wrapping", () => {
    const nodes = [node("a", ["a1"], 0), node("a1", [], 1), node("b", [], 0)];
    rootIdOf(nodes);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get("ax-root")?.depth).toBe(0);
    expect(byId.get("a")?.depth).toBe(1);
    expect(byId.get("a1")?.depth).toBe(2);
    expect(byId.get("b")?.depth).toBe(1);
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

  /**
   * Found by `/code-review`: every other `pageStep` test calls the
   * exported function directly with an explicit numeric delta
   * (`on(pageStep, el, 1)`), bypassing `runInPage`'s own
   * `action === "increment" ? 1 : -1` mapping entirely — so nothing pinned
   * that mapping itself. A swapped ternary there would silently turn every
   * dogfood "increment" into a decrement with no test catching it.
   */
  it("passes delta 1 for increment and -1 for decrement as the CDP argument", async () => {
    const incT = new FakeTransport(resolving("obj-inc", { ok: true }));
    await dispatchNative(incT, "ax-dom-1", "increment");
    const incCall = incT.calls.find(
      (c) => c.method === "Runtime.callFunctionOn",
    );
    expect(
      (incCall?.params as { arguments?: Array<{ value: number }> })
        ?.arguments?.[0]?.value,
    ).toBe(1);

    const decT = new FakeTransport(resolving("obj-dec", { ok: true }));
    await dispatchNative(decT, "ax-dom-1", "decrement");
    const decCall = decT.calls.find(
      (c) => c.method === "Runtime.callFunctionOn",
    );
    expect(
      (decCall?.params as { arguments?: Array<{ value: number }> })
        ?.arguments?.[0]?.value,
    ).toBe(-1);
  });

  /**
   * Live dogfood finding: "combobox options are not interactive" — a native
   * `<select>`'s `option` children had no action at all. `select` resolves
   * and dispatches exactly like `click`/`increment` do — this pins that the
   * new action reaches `runInPage` through the same path, not a special one.
   */
  it("dispatches a select action via resolveNode + callFunctionOn", async () => {
    const t = new FakeTransport(resolving("obj-opt", { ok: true }));
    const res = await dispatchNative(t, "ax-dom-77", "select");
    expect(res).toEqual({ success: true });
    expect(
      t.calls.find((c) => c.method === "Runtime.callFunctionOn")?.params,
    ).toMatchObject({ functionDeclaration: String(pageSelectOption) });
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

describe("in-page actions — read value", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("reads a plain text input's value", () => {
    const el = document.createElement("input");
    el.value = "456465";
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({ value: "456465" });
  });

  it("reads a textarea and a select the same way", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "hello";
    document.body.appendChild(textarea);
    expect(on(pageReadValue, textarea)).toEqual({ value: "hello" });

    const select = document.createElement("select");
    const option = document.createElement("option");
    option.value = "fr";
    option.textContent = "France";
    select.appendChild(option);
    select.value = "fr";
    document.body.appendChild(select);
    expect(on(pageReadValue, select)).toEqual({ value: "fr" });
  });

  it("returns nothing for an empty field — no value, not even a redacted marker", () => {
    const el = document.createElement("input");
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({});
  });

  /**
   * Live need for the production panel integration: acting on a native
   * typable field opens the same `InputPanel` text modal the DOM path uses,
   * which shows a placeholder hint. Placeholder is page-authored, not user
   * input (same distinction `description` already draws — R1 only concerns
   * a field's live VALUE), so unlike `value` it is never redacted and is
   * returned even when the field is empty — exactly the case a placeholder
   * hint matters most for.
   */
  it("returns a placeholder for an empty field", () => {
    const el = document.createElement("input");
    el.placeholder = "you@example.com";
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({ placeholder: "you@example.com" });
  });

  it("returns both value and placeholder together for a filled field", () => {
    const el = document.createElement("input");
    el.placeholder = "you@example.com";
    el.value = "ada@example.com";
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({
      value: "ada@example.com",
      placeholder: "you@example.com",
    });
  });

  it("returns the placeholder alongside a redacted marker — it is not user input", () => {
    const el = document.createElement("input");
    el.type = "password";
    el.placeholder = "Password";
    el.value = "hunter2";
    document.body.appendChild(el);
    const result = on(pageReadValue, el);
    expect(result).toEqual({ redacted: true, placeholder: "Password" });
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("reads a textarea's placeholder the same way", () => {
    const el = document.createElement("textarea");
    el.placeholder = "Leave a comment";
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({ placeholder: "Leave a comment" });
  });

  it("omits placeholder for a select — it has no such attribute", () => {
    const select = document.createElement("select");
    const option = document.createElement("option");
    option.value = "fr";
    select.appendChild(option);
    select.value = "fr";
    document.body.appendChild(select);
    expect(on(pageReadValue, select)).toEqual({ value: "fr" });
  });

  it("redacts a password field instead of returning the typed secret (R1)", () => {
    const el = document.createElement("input");
    el.type = "password";
    el.value = "hunter2";
    document.body.appendChild(el);
    const result = on(pageReadValue, el);
    expect(result).toEqual({ redacted: true });
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("redacts a text-type field with a sensitive autocomplete token (R1)", () => {
    const el = document.createElement("input");
    el.type = "text";
    el.autocomplete = "cc-number";
    el.value = "4111111111111111";
    document.body.appendChild(el);
    const result = on(pageReadValue, el);
    expect(result).toEqual({ redacted: true });
    expect(JSON.stringify(result)).not.toContain("4111111111111111");
  });

  it("does not treat a normal autocomplete token as sensitive", () => {
    const el = document.createElement("input");
    el.autocomplete = "given-name";
    el.value = "Ada";
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({ value: "Ada" });
  });

  it("returns nothing for a non-field element — a custom contenteditable widget is out of scope here", () => {
    const el = document.createElement("div");
    el.setAttribute("role", "textbox");
    el.setAttribute("contenteditable", "true");
    el.textContent = "typed text";
    document.body.appendChild(el);
    expect(on(pageReadValue, el)).toEqual({});
  });

  /**
   * Found by `/security-review`: reading `.type`/`.getAttribute` directly
   * trusts accessors the inspected page's own JS realm controls — a page
   * could shadow an instance property to make a password/`cc-number` field
   * misreport as ordinary text, defeating the redaction gate. Pinning to
   * each class's own property descriptor (matching `pageType`'s existing
   * defense for its setter) closes the realistic case: an instance-level
   * override, which is what a page shadowing its own element's properties
   * actually looks like. It does not close a page that redefines the
   * PROTOTYPE'S accessor before this function ever runs — no in-page read
   * can un-patch an already-patched prototype — but that residual is not
   * new: `core`'s `isSensitiveField`, the already-shipped DOM producer
   * redaction this mirrors, has no pinning at all today.
   */
  it("resists an instance-level property lying about a sensitive field's type", () => {
    const el = document.createElement("input");
    el.type = "password";
    el.value = "hunter2";
    document.body.appendChild(el);
    // A shadowed own property, not the real setter — the realistic
    // tampering case, and what pinning to the prototype's descriptor
    // defends against.
    Object.defineProperty(el, "type", { value: "text", configurable: true });
    const result = on(pageReadValue, el);
    expect(result).toEqual({ redacted: true });
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("resists an instance-level getAttribute lying about a sensitive autocomplete token", () => {
    const el = document.createElement("input");
    el.type = "text";
    el.autocomplete = "cc-number";
    el.value = "4111111111111111";
    document.body.appendChild(el);
    (el as unknown as { getAttribute: () => null }).getAttribute = () => null;
    const result = on(pageReadValue, el);
    expect(result).toEqual({ redacted: true });
    expect(JSON.stringify(result)).not.toContain("4111111111111111");
  });
});

/**
 * Live dogfood finding: "slider controls are not interactable" — the W3C
 * multi-thumb slider example's thumbs had no way to act on them at all.
 * `pageStep` mirrors core's `ActionDispatcher.handleStep`/`dispatchArrowStep`
 * (`core/src/interaction/action-dispatcher.ts`): native `stepUp()`/
 * `stepDown()` for a real range/number input, else `ArrowRight`/`ArrowLeft`
 * dispatched on the element itself (a custom ARIA slider installs its
 * keyboard listener there, not wherever focus happens to be).
 */
describe("in-page actions — step", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("steps a native range input via stepUp/stepDown, not the keyboard path", () => {
    const el = document.createElement("input");
    el.type = "range";
    el.min = "0";
    el.max = "10";
    el.value = "5";
    document.body.appendChild(el);
    const seen = record(el, ["input", "change"]);

    expect(on(pageStep, el, 1)).toEqual({ ok: true });
    expect(el.value).toBe("6");
    expect(seen).toEqual(["input", "change"]);

    expect(on(pageStep, el, -1)).toEqual({ ok: true });
    expect(el.value).toBe("5");
  });

  it("steps a native number input the same way", () => {
    const el = document.createElement("input");
    el.type = "number";
    el.value = "3";
    document.body.appendChild(el);
    expect(on(pageStep, el, 1)).toEqual({ ok: true });
    expect(el.value).toBe("4");
  });

  it("dispatches ArrowRight/ArrowLeft on a custom ARIA slider", () => {
    const el = document.createElement("div");
    el.setAttribute("role", "slider");
    el.setAttribute("tabindex", "0");
    document.body.appendChild(el);
    const seenKeys: string[] = [];
    el.addEventListener("keydown", (e) =>
      seenKeys.push(`down:${(e as KeyboardEvent).key}`),
    );
    el.addEventListener("keyup", (e) =>
      seenKeys.push(`up:${(e as KeyboardEvent).key}`),
    );

    expect(on(pageStep, el, 1)).toEqual({ ok: true });
    expect(seenKeys).toEqual(["down:ArrowRight", "up:ArrowRight"]);

    seenKeys.length = 0;
    expect(on(pageStep, el, -1)).toEqual({ ok: true });
    expect(seenKeys).toEqual(["down:ArrowLeft", "up:ArrowLeft"]);
  });

  it("falls back to the keyboard path when stepUp/stepDown throws", () => {
    // A range input with no step increment configured correctly (min > max)
    // makes stepUp throw in real browsers; jsdom doesn't reject this
    // construction, so simulate the throw directly to exercise the fallback.
    const el = document.createElement("input");
    el.type = "range";
    document.body.appendChild(el);
    el.stepUp = () => {
      throw new Error("invalid state");
    };
    const seenKeys: string[] = [];
    el.addEventListener("keydown", (e) =>
      seenKeys.push((e as KeyboardEvent).key),
    );

    expect(on(pageStep, el, 1)).toEqual({ ok: true });
    expect(seenKeys).toEqual(["ArrowRight"]);
  });

  it("does not steal focus when nothing focuses itself in response", () => {
    const button = document.createElement("button");
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    document.body.appendChild(button);
    document.body.appendChild(slider);
    button.focus();
    expect(document.activeElement).toBe(button);

    on(pageStep, slider, 1);
    expect(document.activeElement).toBe(button);
  });

  /**
   * Found by `/code-review`: the test above never exercises the restore
   * logic at all — nothing in it ever moves focus away from `button`, so
   * the assertion would pass identically even with both restore stages
   * deleted. These two tests simulate the two cases the two-stage design
   * exists for: a widget that focuses itself synchronously inside its own
   * keydown handler (restore's synchronous call), and one that schedules
   * the focus call for later — the Radix-style state-update-then-re-render
   * pattern the docstring names (restore's `setTimeout(0)` call).
   */
  it("restores focus synchronously when the widget focuses itself inside its own keydown handler", () => {
    const button = document.createElement("button");
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    slider.tabIndex = 0;
    document.body.appendChild(button);
    document.body.appendChild(slider);
    slider.addEventListener("keydown", () => slider.focus());
    button.focus();

    on(pageStep, slider, 1);
    // No fake timers needed — this widget shape steals focus synchronously,
    // inside dispatchEvent itself, so the synchronous restore() call right
    // after must already have put it back before pageStep even returns.
    expect(document.activeElement).toBe(button);
  });

  /**
   * Live dogfood finding: "still unable to interact with the sliders" — the
   * W3C multi-thumb slider example's thumbs still didn't move after round
   * 12's fix. Its keydown handler (and a real share of hand-written ARIA
   * widgets generally) gates on `document.activeElement === this`, a
   * reasonable assumption for widget code a real user can only reach by
   * having tabbed there first. Without a real `.focus()` call, `pageStep`
   * reported `{ ok: true }` — the events genuinely dispatched — while the
   * widget silently ignored them because it never saw itself as focused.
   */
  it("focuses the element first so a widget that gates its handler on real focus still reacts", () => {
    const button = document.createElement("button");
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    slider.tabIndex = 0;
    document.body.appendChild(button);
    document.body.appendChild(slider);
    let valueNow = 100;
    slider.addEventListener("keydown", (e) => {
      if (document.activeElement !== slider) return; // the real-world guard
      if ((e as KeyboardEvent).key === "ArrowRight") valueNow += 1;
    });
    button.focus();
    expect(document.activeElement).toBe(button);

    expect(on(pageStep, slider, 1)).toEqual({ ok: true });

    expect(valueNow).toBe(101);
    // The two-stage restore already in place undoes our own upfront focus()
    // call the same way it undoes a widget stealing focus as a side effect —
    // so the dogfooder's panel button ends up with focus back, same as before.
    expect(document.activeElement).toBe(button);
  });

  it("restores focus after a deferred (setTimeout-scheduled) focus steal", () => {
    vi.useFakeTimers();
    try {
      const button = document.createElement("button");
      const slider = document.createElement("div");
      slider.setAttribute("role", "slider");
      slider.tabIndex = 0;
      document.body.appendChild(button);
      document.body.appendChild(slider);
      // Radix-style: the keydown handler doesn't focus synchronously, it
      // schedules the focus call for a later tick (standing in for a state
      // update + re-render landing on a microtask/RAF boundary).
      slider.addEventListener("keydown", () => {
        setTimeout(() => slider.focus(), 0);
      });
      button.focus();

      on(pageStep, slider, 1);
      // The widget's own deferred focus call hasn't run yet — nothing to
      // restore from at this instant, so the synchronous restore is a no-op
      // and focus is still on the button.
      expect(document.activeElement).toBe(button);

      // Both the widget's own scheduled focus() and pageStep's own
      // setTimeout(restore, 0) are due at the same tick, in schedule order
      // (widget's first, pageStep's restore second) — running due timers
      // fires both within this one advance, ending back on the button.
      // Without pageStep's deferred restore stage, this would leave focus
      // stranded on the slider instead.
      vi.advanceTimersByTime(0);
      expect(document.activeElement).toBe(button);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns not-element for a null this", () => {
    expect(on(pageStep, null as unknown as Element, 1)).toEqual({
      ok: false,
      reason: "not-element",
    });
  });
});

/**
 * Live dogfood finding: "combobox options are not interactive" — Amazon's
 * department dropdown is a real `<select>`; Chromium normalizes it to
 * `combobox` → `menuListPopup` → `option`, and each `option` row had no
 * native-tree action at all. A generic `click` was never the fix — a
 * synthetic pointer sequence on a real `<option>` is a no-op, since the open
 * list is OS chrome — so this is a dedicated action that sets the owning
 * `<select>`'s value and fires `change`, exactly like the DOM/A11Y tree
 * view's own `handleSelect` (`core/src/interaction/action-dispatcher.ts`).
 */
describe("in-page actions — select", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("sets the owning select's value and fires change", () => {
    document.body.innerHTML = `
      <select id="dept">
        <option value="all">All</option>
        <option value="electronics">Electronics</option>
      </select>
    `;
    const select = document.getElementById("dept") as HTMLSelectElement;
    const option = select.options[1];
    const changes = record(select, ["change"]);

    const result = on(pageSelectOption, option);

    expect(result).toEqual({ ok: true });
    expect(select.value).toBe("electronics");
    expect(changes).toEqual(["change"]);
  });

  it('refuses a non-option element instead of guessing — a custom role="option" widget', () => {
    document.body.innerHTML = `<div role="option">Fake option</div>`;
    const el = document.querySelector('[role="option"]')!;
    expect(on(pageSelectOption, el)).toEqual({
      ok: false,
      reason: "not-an-option",
    });
  });

  it("refuses an option with no select ancestor", () => {
    document.body.innerHTML = `<option value="orphan">Orphan</option>`;
    const option = document.querySelector("option")!;
    expect(on(pageSelectOption, option)).toEqual({
      ok: false,
      reason: "no-select-ancestor",
    });
  });

  it("returns not-element for a null this", () => {
    expect(on(pageSelectOption, null as unknown as Element)).toEqual({
      ok: false,
      reason: "not-element",
    });
  });
});

describe("in-page action source", () => {
  it("serializes to self-contained source for Runtime.callFunctionOn", () => {
    // Each is shipped as source text, so nothing may reference a module-scope
    // binding — that would be a ReferenceError in the page, not a build error.
    // pageReadValue is checked the same way, even though it isn't a
    // NativeAction / IN_PAGE_ACTION_SOURCE entry: it crosses into the page as
    // source text exactly like the three actions do (Runtime.callFunctionOn,
    // readFieldValue), so the same constraint applies and the same class of
    // mistake (e.g. hoisting SENSITIVE_AUTOCOMPLETE_TOKENS to module scope)
    // would otherwise only surface as a runtime ReferenceError in the page.
    for (const src of [
      ...Object.values(IN_PAGE_ACTION_SOURCE),
      String(pageReadValue),
    ]) {
      expect(src).toMatch(/^function/);
      expect(src).not.toContain("import");
    }
    // The composite list must live inside the click body, not hoisted.
    expect(IN_PAGE_ACTION_SOURCE.click).toContain("treeitem");
    // The sensitive-token list must live inside pageReadValue's own body too.
    expect(String(pageReadValue)).toContain("cc-number");
  });
});
