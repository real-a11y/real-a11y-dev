/**
 * The `heading-order` rule gives the same findings on the DOM and native
 * producers, in real Chromium, for headings without a usable level.
 *
 * A `role="heading"` with no valid `aria-level` carries no `level` in the DOM
 * tree; Chromium computes 2. The rule compares such a heading at 2, so both
 * paths agree. `collect-findings.test.ts` pins the messages in jsdom.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e heading-order`
 */

import { collectFindings } from "@real-a11y-dev/audit";
import { nativeTree, pageBundleSource } from "@real-a11y-dev/browser";
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

async function both(html: string) {
  await page.setContent(html);
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      collectFindings(root: Element, rules: string[]): { message: string }[];
    };
    return ra
      .collectFindings(document.body, ["heading-order"])
      .map((f) => f.message);
  });
  const native = collectFindings(await nativeTree(page), ["heading-order"]).map(
    (f) => f.message,
  );
  return { dom, native };
}

const PAGES: Record<string, { html: string; expected: string[] }> = {
  "no aria-level": {
    html: `<main><h1>t</h1><div role="heading">x</div><h3>three</h3></main>`,
    expected: [],
  },
  "empty aria-level": {
    html: `<main><h1>t</h1><div role="heading" aria-level="">x</div><h3>three</h3></main>`,
    expected: [],
  },
  "aria-level 12": {
    html: `<main><h1>t</h1><div role="heading" aria-level="12">x</div><h3>three</h3></main>`,
    expected: [],
  },
  "a skip right after an unlevelled heading": {
    html: `<main><h1>t</h1><div role="heading">x</div><h4>four</h4></main>`,
    expected: [
      'Heading level skipped: "four" is h4 but the previous heading was h2.',
    ],
  },
  "aria-level that is not an integer": {
    html: `<main><h1>t</h1><div role="heading" aria-level="abc">x</div></main>`,
    expected: ['Expected exactly one <h1>, found 2: "t", "x"'],
  },
  "aria-level on an h2": {
    html: `<main><h1>t</h1><h2 aria-level="3">three</h2><h4>four</h4></main>`,
    expected: [
      'Heading level skipped: "three" is h3 but the previous heading was h1.',
    ],
  },
};

describe("heading-order, DOM against native", () => {
  for (const [name, { html, expected }] of Object.entries(PAGES)) {
    it(`agrees on ${name}`, async () => {
      const { dom, native } = await both(html);
      expect(dom).toEqual(native);
      expect(dom).toEqual(expected);
    });
  }
});

describe("heading-order, an SVG heading with no level", () => {
  it("keeps the native skip: Chromium gives the SVG no level, and the fallback is the DOM path's", async () => {
    await page.setContent(
      `<main><h1>Page</h1><svg role="heading" aria-label="Chart"><circle r="5" cx="8" cy="8"/></svg><h3>Details</h3></main>`,
    );
    const tree = await nativeTree(page);
    const svg = [...tree.nodes.values()].find(
      (n) => n.a11y.role === "heading" && n.a11y.name === "Chart",
    );
    // The heading is in the native tree, with no level; the finding below
    // is about it, not about it going missing.
    expect(svg).toBeDefined();
    expect(svg?.a11y.properties?.level).toBeUndefined();
    const native = collectFindings(tree, ["heading-order"]).map(
      (f) => f.message,
    );
    expect(native).toEqual([
      'Heading level skipped: "Details" is h3 but the previous heading was h1.',
    ]);
  });
});
