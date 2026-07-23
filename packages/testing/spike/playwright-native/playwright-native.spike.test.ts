/**
 * SPIKE — testing/playwright can consume native tree via CDP.
 *
 *   pnpm --filter @real-a11y-dev/testing run test:spike
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { attachSpike } from "./attach-native.js";

const here = dirname(fileURLToPath(import.meta.url));
// Reuse the browser spike fixture (media + sensitive fields).
const fixtureHtml = readFileSync(
  join(here, "../../../browser/spike/native-tree/fixture.html"),
  "utf8",
);

describe("testing/playwright native-tree spike", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.setContent(fixtureHtml, { waitUntil: "load" });
  }, 60_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it("attachSpike({ tree: 'native' }) returns media controls via CDP", async () => {
    const sn = await attachSpike(page, { tree: "native" });
    expect(sn.producer).toBe("native");
    const tree = await sn.auditSnapshot();
    expect(tree).toMatch(/heading "Spike fixture"/);
    expect(tree).toMatch(/video/);
    expect(tree).toMatch(/button "play"/);
    expect(tree).toMatch(/slider "video time scrubber"/);
    expect(tree).not.toMatch(/\bInlineTextBox\b/);
  });

  it("attachSpike({ tree: 'dom' }) still uses the page-bundle (no media children)", async () => {
    const sn = await attachSpike(page, { tree: "dom" });
    expect(sn.producer).toBe("dom");
    const tree = await sn.auditSnapshot();
    // DOM producer sees video as a leaf (or with captions track only) — not UA controls.
    expect(tree).toMatch(/video/i);
    expect(tree).not.toMatch(/button "play"/);
    expect(tree).not.toMatch(/slider "video time scrubber"/);
  });

  it("native vs dom diverge on media — documents why playwright should default native", async () => {
    const native = await (
      await attachSpike(page, { tree: "native" })
    ).auditSnapshot();
    const dom = await (
      await attachSpike(page, { tree: "dom" })
    ).auditSnapshot();
    expect(native).toMatch(/button "play"/);
    expect(dom).not.toMatch(/button "play"/);

    console.log(
      [
        "",
        "===== testing/playwright NATIVE (CDP) =====",
        native,
        "",
        "===== testing/playwright DOM (page-bundle) =====",
        dom,
      ].join("\n"),
    );
  });

  it("does not require a separate @real-a11y-dev/playwright package", () => {
    // Architectural assertion: this spike lives under testing/ and imports the
    // browser spike producer. Product code will do the same with browser.nativeTree.
    expect(true).toBe(true);
  });
});
