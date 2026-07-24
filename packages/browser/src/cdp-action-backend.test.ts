import type { CDPSession } from "playwright";
import { describe, expect, it } from "vitest";

import { backendNodeIdFrom, CdpActionBackend } from "./cdp-action-backend.js";

// A scripted fake CDP session: `handler` returns the response for each
// `client.send(method, params)`, and every call is recorded for assertions.
type Handler = (method: string, params?: Record<string, unknown>) => unknown;
class FakeCdp {
  calls: { method: string; params?: Record<string, unknown> }[] = [];
  constructor(private handler: Handler) {}
  async send(method: string, params?: Record<string, unknown>) {
    this.calls.push({ method, params });
    return this.handler(method, params);
  }
  async detach() {}
}

function makeBackend(handler: Handler) {
  const cdp = new FakeCdp(handler);
  return { backend: new CdpActionBackend(cdp as unknown as CDPSession), cdp };
}

/** A handler that resolves any backend node to `objectId` and runs `fnResult`. */
function resolving(objectId: string | null, fnResult: unknown): Handler {
  return (method) => {
    if (method === "DOM.resolveNode")
      return objectId ? { object: { objectId } } : {};
    if (method === "Runtime.callFunctionOn")
      return { result: { value: fnResult } };
    return {}; // DOM.enable, etc.
  };
}

describe("backendNodeIdFrom", () => {
  it("parses an author-DOM native id", () => {
    expect(backendNodeIdFrom("ax-dom-42")).toBe(42);
    expect(backendNodeIdFrom("ax-dom-0")).toBe(0);
  });

  it("returns null for a node with no backing DOM element", () => {
    expect(backendNodeIdFrom("ax-7")).toBeNull(); // UA-shadow / synthesized
    expect(backendNodeIdFrom("ax-dom-")).toBeNull();
    expect(backendNodeIdFrom("garbage")).toBeNull();
    expect(backendNodeIdFrom("ax-dom-1x")).toBeNull();
  });
});

describe("CdpActionBackend.dispatch", () => {
  it("rejects an unsupported action without touching the page", async () => {
    const { backend, cdp } = makeBackend(() => ({}));
    const res = await backend.dispatch({
      nodeId: "ax-dom-1",
      action: "scroll",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/does not support "scroll"/);
    expect(cdp.calls).toHaveLength(0); // guarded before any CDP traffic
  });

  it("refuses a node with no backing DOM element (UA-shadow / synthesized)", async () => {
    const { backend, cdp } = makeBackend(() => ({}));
    const res = await backend.dispatch({ nodeId: "ax-9", action: "click" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no backing DOM element/);
    expect(cdp.calls).toHaveLength(0);
  });

  it("clicks by resolving the backendDOMNodeId to an object handle", async () => {
    const { backend, cdp } = makeBackend(resolving("obj-1", { ok: true }));
    const res = await backend.dispatch({
      nodeId: "ax-dom-42",
      action: "click",
    });
    expect(res).toEqual({ success: true });
    // Resolved the right backend node id, then called on the returned handle.
    const resolve = cdp.calls.find((c) => c.method === "DOM.resolveNode");
    expect(resolve?.params).toEqual({ backendNodeId: 42 });
    const call = cdp.calls.find((c) => c.method === "Runtime.callFunctionOn");
    expect(call?.params?.objectId).toBe("obj-1");
  });

  it("reports a stale id when the node no longer resolves", async () => {
    const { backend } = makeBackend(resolving(null, undefined));
    const res = await backend.dispatch({
      nodeId: "ax-dom-42",
      action: "click",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/could not resolve .* re-read the tree/);
  });

  it("types the payload value INTO the page but never returns it (R1)", async () => {
    const { backend, cdp } = makeBackend(resolving("obj-2", { ok: true }));
    const res = await backend.dispatch({
      nodeId: "ax-dom-5",
      action: "type",
      payload: { value: "hunter2@example.com" },
    });
    expect(res).toEqual({ success: true });
    // The value is passed in as a callFunctionOn argument (it must reach the
    // page)…
    const call = cdp.calls.find((c) => c.method === "Runtime.callFunctionOn");
    expect(JSON.stringify(call?.params?.arguments)).toContain(
      "hunter2@example.com",
    );
    // …but it must NEVER come back out in the result.
    expect(JSON.stringify(res)).not.toContain("hunter2@example.com");
    expect(Object.keys(res)).toEqual(["success"]);
  });

  it("requires a string payload.value for type", async () => {
    const { backend } = makeBackend(resolving("obj-3", { ok: true }));
    const res = await backend.dispatch({ nodeId: "ax-dom-5", action: "type" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/requires a string payload\.value/);
  });

  it("surfaces the in-page failure reason, not page content", async () => {
    const { backend } = makeBackend(
      resolving("obj-4", { ok: false, reason: "not-a-text-field" }),
    );
    const res = await backend.dispatch({
      nodeId: "ax-dom-6",
      action: "type",
      payload: { value: "x" },
    });
    expect(res).toEqual({ success: false, error: "not-a-text-field" });
  });

  it("focus on a text field advertises requiresInput + the structural inputType", async () => {
    const { backend } = makeBackend(
      resolving("obj-5", {
        ok: true,
        requiresInput: true,
        inputType: "email",
      }),
    );
    const res = await backend.dispatch({ nodeId: "ax-dom-7", action: "focus" });
    expect(res).toEqual({
      success: true,
      requiresInput: true,
      inputType: "email",
    });
  });

  it("never surfaces a raw CDP error message", async () => {
    const { backend } = makeBackend((method) => {
      if (method === "DOM.resolveNode") return { object: { objectId: "o" } };
      if (method === "Runtime.callFunctionOn")
        throw new Error("Cannot read property of secret@example.com");
      return {};
    });
    const res = await backend.dispatch({ nodeId: "ax-dom-8", action: "click" });
    expect(res.success).toBe(false);
    expect(res.error).not.toContain("secret@example.com");
  });
});
