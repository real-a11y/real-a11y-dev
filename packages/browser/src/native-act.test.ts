import type { CDPSession, Frame, Page } from "playwright";
import { describe, expect, it } from "vitest";

import { actOnNativeNode } from "./native-act.js";

const PAGE_ORIGIN = "https://app.example";

/** A CDP session that records what it was sent. */
class FakeSession {
  sent: string[] = [];
  detached = 0;
  constructor(
    private readonly shown?: {
      id: string;
      loaderId?: string;
      url?: string;
      securityOrigin?: string;
    } | null,
  ) {}
  async send(method: string) {
    this.sent.push(method);
    if (method === "Page.getFrameTree") {
      if (this.shown === null) throw new Error("target closed");
      return { frameTree: { frame: this.shown } };
    }
    if (method === "DOM.resolveNode") return { object: { objectId: "obj" } };
    if (method === "Runtime.callFunctionOn") {
      return { result: { value: { ok: true } } };
    }
    return {};
  }
  async detach() {
    this.detached++;
  }
  /** Whether an action reached the page through this session. */
  get acted() {
    return this.sent.includes("DOM.resolveNode");
  }
}

interface FakeFrameSpec {
  url: string;
  parent?: Frame;
  /** No session: the frame shares its parent's process. */
  session?: FakeSession;
}

function fakePage(specs: (main: Frame) => FakeFrameSpec[]) {
  const main = {
    url: () => `${PAGE_ORIGIN}/`,
    parentFrame: () => null,
  } as unknown as Frame;
  const pageSession = new FakeSession();
  const sessions = new Map<unknown, FakeSession>();
  const frames = specs(main).map((spec) => {
    const frame = {
      url: () => spec.url,
      parentFrame: () => spec.parent ?? main,
    } as unknown as Frame;
    if (spec.session) sessions.set(frame, spec.session);
    return frame;
  });
  const page = {
    mainFrame: () => main,
    frames: () => [main, ...frames],
    context: () => ({
      newCDPSession: async (target: unknown) => {
        if (!frames.includes(target as Frame)) {
          return pageSession as unknown as CDPSession;
        }
        const session = sessions.get(target);
        if (!session) {
          throw new Error("This frame does not have a separate CDP session");
        }
        return session as unknown as CDPSession;
      },
    }),
  } as unknown as Page;
  return { page, pageSession, frames };
}

const shown = (
  id: string,
  loaderId: string,
  origin = "https://pay.example",
) => ({
  id,
  loaderId,
  url: `${origin}/frame`,
  securityOrigin: origin,
});

const click = (nodeId: string) => ({ nodeId, action: "click" as const });

describe("actOnNativeNode", () => {
  it("acts on a node of the page over the page's session", async () => {
    const remote = new FakeSession(shown("F1", "D1"));
    const { page, pageSession } = fakePage(() => [
      { url: "https://pay.example/frame", session: remote },
    ]);

    const res = await actOnNativeNode(page, click("ax-dom-12"));

    expect(res).toEqual({ success: true });
    expect(pageSession.acted).toBe(true);
    expect(pageSession.detached).toBe(1);
    expect(remote.sent).toEqual([]);
  });

  it("acts on a frame's node over that frame's session, and no other", async () => {
    const decoy = new FakeSession(shown("F0", "D0"));
    const target = new FakeSession(shown("F1", "D1"));
    const { page, pageSession } = fakePage(() => [
      { url: "https://app.example/same-process" },
      { url: "https://pay.example/frame", session: decoy },
      { url: "https://pay.example/frame", session: target },
    ]);

    const res = await actOnNativeNode(page, click("ax-dom-12@F1.D1"));

    expect(res).toEqual({ success: true });
    expect(target.acted).toBe(true);
    // The same backend id means something else in these two processes.
    expect(pageSession.sent).toEqual([]);
    expect(decoy.acted).toBe(false);
    expect([decoy.detached, target.detached]).toEqual([1, 1]);
  });

  it("refuses a frame that has moved on to another document", async () => {
    const remote = new FakeSession(shown("F1", "D2"));
    const { page, pageSession } = fakePage(() => [
      { url: "https://pay.example/frame", session: remote },
    ]);

    const res = await actOnNativeNode(page, click("ax-dom-12@F1.D1"));

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/could not resolve node/);
    expect(remote.acted).toBe(false);
    expect(pageSession.sent).toEqual([]);
    expect(remote.detached).toBe(1);
  });

  it("refuses a frame that is gone, or stops answering", async () => {
    const closing = new FakeSession(null);
    const { page, pageSession } = fakePage(() => [
      { url: "https://pay.example/frame", session: closing },
    ]);

    const res = await actOnNativeNode(page, click("ax-dom-12@F1.D1"));

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/could not resolve node/);
    expect(pageSession.sent).toEqual([]);
    expect(closing.detached).toBe(1);
  });

  describe("on a session pinned to origins", () => {
    const pin = { frameOrigins: [PAGE_ORIGIN] };

    it("acts in a frame from a pinned origin", async () => {
      const remote = new FakeSession(shown("F1", "D1", PAGE_ORIGIN));
      const { page } = fakePage(() => [
        { url: `${PAGE_ORIGIN}/frame`, session: remote },
      ]);

      const res = await actOnNativeNode(page, click("ax-dom-12@F1.D1"), pin);

      expect(res).toEqual({ success: true });
      expect(remote.acted).toBe(true);
    });

    it("refuses a frame from another origin", async () => {
      const remote = new FakeSession(shown("F1", "D1"));
      const { page } = fakePage(() => [
        { url: "https://pay.example/frame", session: remote },
      ]);

      const res = await actOnNativeNode(page, click("ax-dom-12@F1.D1"), pin);

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not allowed to read/);
      expect(remote.acted).toBe(false);
      expect(remote.detached).toBe(1);
    });

    it("calls a frame that redirected off the pin a changed target", async () => {
      const remote = new FakeSession(shown("F1", "D2"));
      const { page } = fakePage(() => [
        { url: "https://pay.example/frame", session: remote },
      ]);

      const res = await actOnNativeNode(page, click("ax-dom-12@F1.D1"), pin);

      expect(res.error).toMatch(/could not resolve node/);
      expect(remote.acted).toBe(false);
    });

    it("refuses a frame running as another origin on about:blank", async () => {
      const remote = new FakeSession({
        id: "F1",
        loaderId: "D1",
        url: "about:blank",
        securityOrigin: "https://pay.example",
      });
      const { page } = fakePage(() => [
        { url: "about:blank", session: remote },
      ]);

      const res = await actOnNativeNode(page, click("ax-dom-12@F1.D1"), pin);

      expect(res.error).toMatch(/not allowed to read/);
      expect(remote.acted).toBe(false);
    });

    it("refuses a pinned frame inside a frame from another origin", async () => {
      const remote = new FakeSession(shown("F1", "D1", PAGE_ORIGIN));
      const { page } = fakePage((main) => {
        const outer = {
          url: () => "https://ads.example/",
          parentFrame: () => main,
        } as unknown as Frame;
        return [
          { url: `${PAGE_ORIGIN}/frame`, parent: outer, session: remote },
        ];
      });

      const res = await actOnNativeNode(page, click("ax-dom-12@F1.D1"), pin);

      expect(res.error).toMatch(/not allowed to read/);
      expect(remote.acted).toBe(false);
    });
  });
});
