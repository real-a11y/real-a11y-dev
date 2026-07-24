import type { RawNativeAXNode } from "@real-a11y-dev/core";
import { describe, expect, it } from "vitest";

import {
  backendNodeIdFrom,
  dispatchNative,
  findNative,
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
