/**
 * Pin the page bundle's export surface.
 *
 * The bundle is a published artifact: a caller can evaluate the IIFE and invoke
 * `__realA11y__.<name>` directly — the documented path for a page under a
 * Trusted Types CSP. So its exports are an API, and every one of them ships into
 * every audited page.
 *
 * Nothing described that surface before, which is how `listByRole` came to sit
 * in it with no caller: the producer migration moved category listing to Node,
 * and the in-page copy just stayed, costing 0.37 kB gzipped of every page it was
 * injected into. A plain snapshot of "whatever is exported" would not have
 * caught that — it would have happily recorded the dead entry. So this pins the
 * list *next to who dispatches on it*: adding an export means naming its
 * consumer, and removing a consumer means the export shows up here as orphaned.
 */
import { describe, expect, it } from "vitest";

import * as bundle from "./page-bundle.js";

/**
 * Every export, with the consumer that names it. Grouped by how it is reached,
 * because that is what makes an orphan visible.
 *
 * Names are resolved dynamically at both call sites (`ra[fn]`), so TypeScript
 * cannot connect them — these strings are the only link, and this table is the
 * only place it is written down.
 */
const CONSUMERS: Record<string, string> = {
  // BrowserSession.snapshot() — one extraction, four views, in a single evaluate.
  extractA11yTree: "browser.ts snapshot()",
  collectFindings: "browser.ts snapshot()",
  auditSnapshot: "browser.ts snapshot() + testing/playwright auditSnapshot()",
  outlineSnapshot: "browser.ts snapshot() + testing/playwright evalFn()",
  tabSequenceSnapshot: "browser.ts snapshot() + testing/playwright evalFn()",

  // BrowserSession.call(fn, …) — the CLI and MCP tree checkpoints.
  checkpointTree: "cli/mcp via session.call()",
  diffSinceCheckpoint: "cli/mcp via session.call()",

  // testing/playwright evalFn() — the Vitest/Jest assertion matchers.
  assertNoUnlabeledInteractive: "testing/playwright evalFn()",
  assertHeadingOrder: "testing/playwright evalFn()",
  assertDialogsLabeled: "testing/playwright evalFn()",
  assertLandmarkStructure: "testing/playwright evalFn()",

  // Thrown by the assert* helpers inside the page. Exported so a caller
  // evaluating the IIFE directly can identify what it caught; the class itself
  // is in the bundle either way, since the helpers throw it.
  A11yAssertionError: "thrown by the assert* helpers in-page",

  // Kept for direct `__realA11y__` callers even though our own code reaches
  // them through the serializers. Cheap: removing all of these saved 0.07 kB,
  // because what stays pulls them in anyway — measured, not assumed.
  findByRole: "direct __realA11y__ callers",
  findAllByRole: "direct __realA11y__ callers",
  getOutline: "direct __realA11y__ callers",
  getTabSequence: "direct __realA11y__ callers",
  linearize: "direct __realA11y__ callers",
};

describe("page bundle export surface", () => {
  it("exports exactly the documented set — no more, no less", () => {
    // Sorted so the failure diff reads as added/removed names rather than a
    // reordering.
    expect(Object.keys(bundle).sort()).toEqual(Object.keys(CONSUMERS).sort());
  });

  it("every export is callable in the page", () => {
    for (const name of Object.keys(CONSUMERS)) {
      expect(
        typeof bundle[name as keyof typeof bundle],
        `${name} must be a function or class`,
      ).toBe("function");
    }
  });

  it("does NOT ship listByRole — it has no in-page caller", () => {
    // The regression this file exists for. `real-a11y list` and the MCP's
    // `list_elements` both run it in Node over a native tree; testing
    // re-exports it for jsdom. An in-page copy is 0.37 kB of dead weight in
    // every audited page.
    expect(bundle).not.toHaveProperty("listByRole");
  });
});
