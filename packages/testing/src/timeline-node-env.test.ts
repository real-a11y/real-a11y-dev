// @vitest-environment node
//
// Plain Node, no DOM: the main entry is imported by Playwright specs and other
// Node-side code that never records a timeline, so loading it must not touch
// a DOM global.
import { describe, expect, it } from "vitest";

describe("recordTimeline without a DOM", () => {
  it("imports, and throws only when called", async () => {
    const { recordTimeline } = await import("./index.js");
    expect(typeof recordTimeline).toBe("function");
    expect(() => recordTimeline({} as Element)).toThrow(
      /expected a DOM Element, received object/,
    );
  });
});
