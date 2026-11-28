// The Node side of the timeline (ADR-0002), over a fake page and CDP session:
// what it takes out of the page, what it keeps at a navigation, and what it
// refuses. The real-Chromium path is `e2e/timeline.e2e.test.ts`.
import { EventEmitter } from "node:events";

import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";

import { asTimelineEvent, startPageTimeline } from "./timeline.js";

const FOCUS = {
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
} as const;
const ANNOUNCE = {
  kind: "announce",
  role: "status",
  text: "Draft deleted.",
  live: "polite",
} as const;

const g = globalThis as Record<string, unknown>;

interface Started {
  token: string;
  binding: string;
  selector: string;
  redactInput: boolean;
}

/** A page whose `evaluate` runs the function here, against a fake
 *  `__realA11yTimeline__`, and a CDP session whose events a test emits. */
function fakePage(stopResult: (token: string) => unknown = () => []) {
  const client = Object.assign(new EventEmitter(), {
    // As Chromium does, `addBinding` puts a global function on the page.
    send: vi.fn(async (method: string, params?: { name?: string }) => {
      if (method === "Runtime.addBinding") g[params!.name!] = () => {};
      return {};
    }),
    detach: vi.fn(async () => {}),
  });
  const pageEvents = new EventEmitter();
  let started: Started | undefined;
  let url = "https://example.test/";
  let closed = false;
  let evaluateError: Error | undefined;
  g.__realA11yTimeline__ = {
    start: (opts: Started) => {
      started = opts;
    },
    stop: (token: string) => stopResult(token),
  };
  const page = {
    context: () => ({ newCDPSession: async () => client }),
    evaluate: async (fn: unknown, arg?: unknown) => {
      if (evaluateError) throw evaluateError;
      return typeof fn === "function" ? fn(arg) : undefined;
    },
    on: (name: string, fn: () => void) => pageEvents.on(name, fn),
    off: (name: string, fn: () => void) => pageEvents.off(name, fn),
    url: () => url,
    isClosed: () => closed,
  } as unknown as Page;
  const send = (events: unknown[], over: Partial<Started> = {}) =>
    client.emit("Runtime.bindingCalled", {
      name: over.binding ?? started!.binding,
      payload: JSON.stringify({ token: over.token ?? started!.token, events }),
    });
  return {
    page,
    client,
    send,
    started: () => started!,
    navigate: (to: string) => {
      url = to;
      client.emit("Runtime.executionContextsCleared", {});
    },
    close: () => {
      closed = true;
      pageEvents.emit("close");
    },
    failEvaluate: (err: Error) => {
      evaluateError = err;
    },
  };
}

afterEach(() => {
  delete g.__realA11yTimeline__;
});

describe("startPageTimeline", () => {
  it("starts on the root with a random binding and token, Runtime enabled", async () => {
    const fake = fakePage();
    await startPageTimeline(fake.page, { root: "main", redactInput: true });
    const { binding, token, selector, redactInput } = fake.started();
    expect(selector).toBe("main");
    expect(redactInput).toBe(true);
    expect(binding).toMatch(/^__realA11yTimeline_[0-9a-f]{16}$/);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(fake.client.send).toHaveBeenCalledWith("Runtime.enable");
    expect(fake.client.send).toHaveBeenCalledWith("Runtime.addBinding", {
      name: binding,
    });
  });

  it("streams each run out, and hands it to onEvents", async () => {
    const fake = fakePage();
    const runs: unknown[] = [];
    const timeline = await startPageTimeline(fake.page, {
      onEvents: (events) => runs.push(events),
    });
    fake.send([FOCUS]);
    fake.send([ANNOUNCE]);
    expect(timeline.events()).toEqual([FOCUS, ANNOUNCE]);
    expect(runs).toEqual([[FOCUS], [ANNOUNCE]]);
  });

  it("ignores another binding, another token, and malformed events", async () => {
    const fake = fakePage();
    const timeline = await startPageTimeline(fake.page);
    fake.send([ANNOUNCE], { binding: "__other" });
    fake.send([ANNOUNCE], { token: "forged" });
    fake.client.emit("Runtime.bindingCalled", {
      name: fake.started().binding,
      payload: "not json",
    });
    fake.send([{ kind: "announce", role: 1 }, { kind: "nope" }, FOCUS]);
    expect(timeline.events()).toEqual([FOCUS]);
  });

  it("keeps on going when onEvents throws", async () => {
    const fake = fakePage();
    const timeline = await startPageTimeline(fake.page, {
      onEvents: () => {
        throw new Error("boom");
      },
    });
    fake.send([FOCUS]);
    fake.send([ANNOUNCE]);
    expect(timeline.events()).toHaveLength(2);
  });

  it("stops with the page's own list on the same document, and cleans up", async () => {
    const fake = fakePage(() => [FOCUS, ANNOUNCE]);
    const timeline = await startPageTimeline(fake.page);
    fake.send([FOCUS]);
    const result = await timeline.stop();
    expect(result).toEqual({
      events: [FOCUS, ANNOUNCE],
      end: "stopped",
      truncated: false,
    });
    expect(fake.client.send).toHaveBeenCalledWith("Runtime.removeBinding", {
      name: fake.started().binding,
    });
    expect(fake.client.detach).toHaveBeenCalled();
    // Later calls return the same result, and nothing more leaves the page.
    fake.send([ANNOUNCE]);
    expect(await timeline.stop()).toBe(result);
  });

  it("keeps what streamed before a navigation, and says where it went", async () => {
    // The new document holds no recording with this token.
    const fake = fakePage(() => null);
    const timeline = await startPageTimeline(fake.page);
    fake.send([FOCUS]);
    fake.navigate("https://example.test/next");
    expect(timeline.ended()).toBe("navigated");
    // Nothing from the new document is taken as this recording's.
    fake.send([ANNOUNCE]);
    expect(await timeline.stop()).toEqual({
      events: [FOCUS],
      end: "navigated",
      url: "https://example.test/next",
      truncated: false,
    });
  });

  it("trusts the token over a navigation seen while it started", async () => {
    // The page navigated as the recorder was being started, and the start
    // landed in the new document: that document holds the recording.
    const fake = fakePage(() => [FOCUS, ANNOUNCE]);
    const timeline = await startPageTimeline(fake.page);
    fake.navigate("https://example.test/landed");
    const result = await timeline.stop();
    expect(result.end).toBe("stopped");
    expect(result.events).toEqual([FOCUS, ANNOUNCE]);
  });

  it("hands onEvents the block that settled at stop()", async () => {
    const fake = fakePage(() => [FOCUS, ANNOUNCE]);
    const runs: unknown[] = [];
    const timeline = await startPageTimeline(fake.page, {
      onEvents: (events) => runs.push(events),
    });
    fake.send([FOCUS]);
    await timeline.stop();
    expect(runs).toEqual([[FOCUS], [ANNOUNCE]]);
    expect(timeline.events()).toEqual([FOCUS, ANNOUNCE]);
  });

  it("stops a recording larger than the engine's argument limit", async () => {
    const many = Array.from({ length: 200_000 }, () => ANNOUNCE);
    const fake = fakePage(() => many);
    const timeline = await startPageTimeline(fake.page, {
      maxEvents: 200_000,
    });
    const result = await timeline.stop();
    expect(result.events).toHaveLength(200_000);
    expect(timeline.events()).toHaveLength(200_000);
  });

  it("streams a run larger than the engine's argument limit", async () => {
    // One synchronous block can announce without end: a single run that big
    // arrives through the binding, not at stop().
    const many = Array.from({ length: 200_000 }, () => ANNOUNCE);
    const fake = fakePage();
    const timeline = await startPageTimeline(fake.page, {
      maxEvents: 200_000,
    });
    fake.send(many);
    expect(timeline.events()).toHaveLength(200_000);
  });

  it("refuses a maxEvents that isn't a whole number", async () => {
    const fake = fakePage();
    for (const maxEvents of [Number.NaN, -1, 1.5]) {
      await expect(startPageTimeline(fake.page, { maxEvents })).rejects.toThrow(
        /maxEvents must be a whole number/,
      );
    }
  });

  it("injects the bundle when the global is only a clobbering element", async () => {
    const fake = fakePage();
    const evaluate = vi.spyOn(fake.page, "evaluate");
    // A `<form name="__realA11yTimeline__">` is an object on `window`, with
    // no `start`. The fake's injection installs nothing, so the start fails.
    g.__realA11yTimeline__ = {};
    await expect(startPageTimeline(fake.page)).rejects.toThrow(
      /did not initialize/,
    );
    expect(evaluate.mock.calls.some(([fn]) => typeof fn === "string")).toBe(
      true,
    );
  });

  it("reads a document with no such recording as replaced", async () => {
    const fake = fakePage(() => null);
    const timeline = await startPageTimeline(fake.page);
    fake.send([FOCUS]);
    const result = await timeline.stop();
    expect(result.end).toBe("navigated");
    expect(result.events).toEqual([FOCUS]);
  });

  it("reads a context destroyed under stop() as a navigation", async () => {
    const fake = fakePage();
    const timeline = await startPageTimeline(fake.page);
    fake.send([FOCUS]);
    fake.failEvaluate(
      new Error("page.evaluate: Execution context was destroyed"),
    );
    expect((await timeline.stop()).end).toBe("navigated");
  });

  it("ends as closed when the page closes", async () => {
    const fake = fakePage();
    const timeline = await startPageTimeline(fake.page);
    fake.send([FOCUS]);
    fake.close();
    expect(await timeline.stop()).toEqual({
      events: [FOCUS],
      end: "closed",
      truncated: false,
    });
  });

  it("keeps at most maxEvents, and says it dropped the rest", async () => {
    const fake = fakePage(() => [FOCUS, ANNOUNCE, ANNOUNCE]);
    const timeline = await startPageTimeline(fake.page, { maxEvents: 2 });
    fake.send([FOCUS, ANNOUNCE, ANNOUNCE]);
    expect(timeline.events()).toHaveLength(2);
    const result = await timeline.stop();
    expect(result.events).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("cleans up when the page refuses to start", async () => {
    const fake = fakePage();
    g.__realA11yTimeline__ = {
      start: () => {
        throw new Error('rootSelector "#x" matched no element on the page.');
      },
    };
    const binding = () =>
      fake.client.send.mock.calls.find(
        ([method]) => method === "Runtime.addBinding",
      )![1] as { name: string };
    await expect(startPageTimeline(fake.page, { root: "#x" })).rejects.toThrow(
      /matched no element/,
    );
    expect(fake.client.detach).toHaveBeenCalled();
    // The binding's global is taken back off the page.
    expect(binding().name in g).toBe(false);
  });
});

describe("asTimelineEvent", () => {
  it("never carries a value, whatever the page sent", () => {
    const event = asTimelineEvent({
      ...FOCUS,
      stop: { ...FOCUS.stop, value: "hunter2" },
    });
    expect(JSON.stringify(event)).not.toContain("hunter2");
  });

  it("keeps only the fields a stop has, with values of their types", () => {
    const event = asTimelineEvent(
      JSON.parse(
        JSON.stringify({
          ...FOCUS,
          stop: {
            ...FOCUS.stop,
            extra: "x",
            states: { expanded: true, bad: { nested: 1 } },
            properties: { roledescription: "slide", bad: 2 },
          },
        }).replace('"extra"', '"__proto__":{"polluted":1},"extra"'),
      ),
    );
    expect(event).toEqual({
      ...FOCUS,
      stop: {
        ...FOCUS.stop,
        states: { expanded: true },
        properties: { roledescription: "slide" },
      },
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("takes only the fields an event has", () => {
    expect(asTimelineEvent({ ...ANNOUNCE, extra: "x" })).toEqual(ANNOUNCE);
    expect(
      asTimelineEvent({ kind: "focus", stop: null, hidden: true }),
    ).toEqual({ kind: "focus", stop: null, hidden: true });
  });

  it("rejects what isn't an event", () => {
    for (const bad of [
      null,
      [],
      "focus",
      { kind: "announce", role: "status", text: "x", live: "off" },
      { kind: "focus", stop: null },
      { kind: "focus", stop: { role: "button" }, hidden: false },
    ]) {
      expect(asTimelineEvent(bad)).toBeNull();
    }
  });
});
