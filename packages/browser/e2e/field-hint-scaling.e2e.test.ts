/**
 * DOM extraction time on a long form, in real Chromium.
 *
 * Every field below has a `<label for>`, an `aria-describedby` and a hint
 * `<p>`. Folding a hint and naming a field once rescanned the page per field,
 * so the time grew with the square of the page: about 30x when the page grew
 * 5x. It is linear now. The bound is a ratio between two sizes, not a time, so
 * it holds on a slow or loaded machine too. jsdom has no layout and no real
 * query cost, so this has to run in a browser.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e field-hint-scaling`
 */

import { pageBundleSource } from "@real-a11y-dev/browser";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
});

/** Best of three in-page extractions of a form with `fields` fields, in ms. */
async function extractionMs(fields: number): Promise<{
  ms: number;
  nodes: number;
  hints: number;
}> {
  await page.setContent("<!doctype html><body></body>");
  await page.evaluate((count) => {
    let html = "<main><h1>t</h1>";
    for (let i = 0; i < count; i++) {
      html +=
        `<label for="f${i}">Field ${i}</label>` +
        `<input id="f${i}" aria-describedby="h${i}" title="t${i}">` +
        `<p id="h${i}">Help ${i}</p>`;
    }
    document.body.innerHTML = html + "</main>";
  }, fields);
  await page.addScriptTag({ content: pageBundleSource() });
  return page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<string, { dom?: { tagName: string } }>;
      };
    };
    let ms = Infinity;
    let tree = ra.extractA11yTree(document.body);
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      tree = ra.extractA11yTree(document.body);
      ms = Math.min(ms, performance.now() - start);
    }
    const all = Array.from(tree.nodes.values());
    return {
      ms,
      nodes: all.length,
      hints: all.filter((n) => n.dom?.tagName === "p").length,
    };
  });
}

describe("extraction of a long form with a hint under every field", () => {
  it("grows close to linearly with the page", async () => {
    const small = await extractionMs(500);
    const large = await extractionMs(2500);

    // The hints fold and the fields stay: same output at both sizes.
    expect(small.hints).toBe(0);
    expect(large.hints).toBe(0);
    expect(large.nodes).toBeGreaterThan(small.nodes * 4);

    // 5x the page. Linear is about 5x; the per-field rescans were about 30x.
    // Floor the small time so a very fast machine's timer noise cannot inflate
    // the ratio.
    const ratio = large.ms / Math.max(small.ms, 1);
    expect(ratio, `${small.ms}ms -> ${large.ms}ms`).toBeLessThan(10);
  }, 120_000);
});
