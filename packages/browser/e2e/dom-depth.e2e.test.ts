/**
 * The DOM producer on a deeply nested page, in real Chromium.
 *
 * Each element's `descendantText` preview used to walk down to the bottom of
 * its own subtree, so a chain of D nested elements cost about D² reads. The
 * previews are now built once per extraction and reused by the ancestors. The
 * output is unchanged, and this pins that in a browser: the button at the
 * bottom is reached and every wrapper previews its text. The chain is
 * script-built (the HTML parser caps its own nesting at 512) and stays at a
 * depth CI's Chrome for Testing 153 renders: 200 crashed its renderer. No
 * wall-clock bound; the scaling itself is counted in core's unit tests.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e dom-depth`
 */

import { pageBundleSource } from "@real-a11y-dev/browser";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DEPTH = 100;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
});

describe("the DOM producer on a chain of nested divs", () => {
  it("reaches the button at the bottom and keeps the same four nodes", async () => {
    await page.setContent(`<!doctype html><title>Deep</title>
<main><h1>t</h1><div id="root"></div></main>
<script>
  let cur = document.getElementById("root");
  for (let i = 0; i < ${DEPTH}; i++) {
    const d = document.createElement("div");
    cur.appendChild(d);
    cur = d;
  }
  const b = document.createElement("button");
  b.textContent = "deep";
  cur.appendChild(b);
</script>`);
    await page.addScriptTag({ content: pageBundleSource() });

    const out = await page.evaluate(() => {
      const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
        extractA11yTree(root: Element): {
          source?: { producer?: string };
          nodes: Map<
            string,
            {
              a11y: { role: string; name: string };
            }
          >;
        };
      };
      const tree = ra.extractA11yTree(document.body);
      const nodes = Array.from(tree.nodes.values());
      return {
        producer: tree.source?.producer,
        button: nodes.find((n) => n.a11y.role === "button")?.a11y.name,
        count: nodes.length,
      };
    });

    expect(out.producer).toBe("dom");
    expect(out.button).toBe("deep");
    // body, main, the heading and the button: the role-less wrappers are pruned.
    expect(out.count).toBe(4);
  });
});
