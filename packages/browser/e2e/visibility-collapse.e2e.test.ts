/**
 * `visibility:collapse` from both producers in real Chromium.
 *
 * AccName 1.2 §4.3.2 step 2A counts it as hidden beside `visibility:hidden`.
 * A cell in a collapsed row takes the row's inherited value, which only a real
 * cascade computes, so jsdom cannot close this.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e visibility-collapse`
 */

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

interface Seen {
  role: string;
  name: string;
}

/** Every node of the a11y tree under `<body>`, from both producers. */
async function trees(): Promise<{ dom: Seen[]; native: Seen[] }> {
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<string, { a11y: { role: string; name: string } }>;
      };
    };
    return Array.from(ra.extractA11yTree(document.body).nodes.values()).map(
      (n) => ({ role: n.a11y.role, name: n.a11y.name }),
    );
  });
  const native = Array.from((await nativeTree(page)).nodes.values()).map(
    (n) => ({ role: n.a11y.role, name: n.a11y.name }),
  );
  return { dom, native };
}

const has = (seen: Seen[], role: string, name: string) =>
  seen.some((n) => n.role === role && n.name === name);

describe("visibility:collapse", () => {
  it("hides a paragraph and a cell in a collapsed row from both producers", async () => {
    await page.setContent(
      `<p style="visibility:collapse">x</p>
       <table><tr style="visibility:collapse"><td>y</td></tr></table>`,
    );
    const { dom, native } = await trees();
    for (const seen of [dom, native]) {
      expect(has(seen, "paragraph", "x")).toBe(false);
      expect(has(seen, "cell", "y")).toBe(false);
    }
  });

  it("keeps opacity:0, clipped and off-screen content exposed", async () => {
    await page.setContent(
      `<p style="opacity:0">a</p>
       <p style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">b</p>
       <p style="position:absolute;left:-9999px">c</p>`,
    );
    const { dom } = await trees();
    for (const name of ["a", "b", "c"]) {
      expect(has(dom, "paragraph", name)).toBe(true);
    }
  });
});
