// @vitest-environment jsdom
/**
 * The timeline bundle (ADR-0002): its export surface, pinned next to who
 * calls it as the page bundle's is, and what `start` / `stop` do in a page.
 * The page bundle must not carry the recorder: that is the 3.9 kB of every
 * audited page ADR-0002 decided against.
 */
import { afterEach, describe, expect, it } from "vitest";

import * as pageBundle from "./page-bundle.js";
import * as bundle from "./timeline-bundle.js";

const CONSUMERS: Record<string, string> = {
  start: "timeline.ts startPageTimeline()",
  stop: "timeline.ts startPageTimeline().stop()",
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const g = globalThis as Record<string, unknown>;

afterEach(() => {
  bundle.stop("t");
  bundle.stop("u");
  delete g.__send;
  document.body.innerHTML = "";
});

describe("timeline bundle export surface", () => {
  it("exports exactly the documented set", () => {
    expect(Object.keys(bundle).sort()).toEqual(Object.keys(CONSUMERS).sort());
    for (const name of Object.keys(CONSUMERS)) {
      expect(typeof bundle[name as keyof typeof bundle]).toBe("function");
    }
  });

  it("keeps the recorder out of the page bundle", () => {
    expect(Object.keys(pageBundle)).not.toContain("startTimeline");
    expect(Object.keys(pageBundle)).not.toContain("start");
  });
});

describe("start / stop", () => {
  it("streams each run through the binding, tagged with its token", async () => {
    document.body.innerHTML = `<main><button id="b">Save</button><p role="status" id="s"></p></main>`;
    const sent: string[] = [];
    g.__send = (payload: string) => sent.push(payload);
    bundle.start({ selector: "main", token: "t", binding: "__send" });
    document.getElementById("b")!.focus();
    document.getElementById("s")!.textContent = "Saved.";
    await tick();
    const streamed = sent.flatMap((p) => {
      const parsed = JSON.parse(p) as { token: string; events: unknown[] };
      expect(parsed.token).toBe("t");
      return parsed.events;
    });
    const all = bundle.stop("t");
    expect(all).toHaveLength(2);
    expect(streamed).toEqual(JSON.parse(JSON.stringify(all)));
  });

  it("returns null for a token it doesn't hold, and after stopping", () => {
    document.body.innerHTML = `<main></main>`;
    bundle.start({ selector: "main", token: "t" });
    expect(bundle.stop("u")).toBeNull();
    expect(bundle.stop("t")).toEqual([]);
    expect(bundle.stop("t")).toBeNull();
  });

  it("holds one recording per document", () => {
    document.body.innerHTML = `<main></main>`;
    bundle.start({ selector: "main", token: "t" });
    expect(() => bundle.start({ selector: "main", token: "u" })).toThrow(
      /already recording/,
    );
  });

  it("refuses a root that matches nothing, and a binding that isn't there", () => {
    document.body.innerHTML = `<main></main>`;
    expect(() => bundle.start({ selector: "#nope", token: "t" })).toThrow(
      /matched no element/,
    );
    expect(() =>
      bundle.start({ selector: "main", token: "t", binding: "__missing" }),
    ).toThrow(/not on the page/);
    // Neither left a recording behind.
    expect(bundle.stop("t")).toBeNull();
  });

  it("names a focused node in strict mode as a strict tree does", async () => {
    document.body.innerHTML = `<main><div contenteditable="true"><a href="#" id="a">my secret draft</a></div></main>`;
    bundle.start({ selector: "main", token: "t", redactInput: true });
    document.getElementById("a")!.focus();
    await tick();
    expect(JSON.stringify(bundle.stop("t"))).not.toMatch(/secret/);
  });
});
