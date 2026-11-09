/**
 * Several labels on one control, from both producers in real Chromium.
 *
 * HTML-AAM §4.1 says to concatenate the subtrees of every associated label by
 * DOM order, delimited by spaces. The DOM producer used to read one label only,
 * so `<label for=x>First</label><label for=x>Second</label><input id=x>` was
 * "First" there and "First Second" in Chromium and the native producer.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e label-names`
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

/** Each element's name by id, from both producers. */
async function namesById(): Promise<{
  dom: Record<string, string>;
  native: Record<string, string>;
}> {
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<
          string,
          {
            dom?: { attributes: Record<string, string> };
            a11y: { name: string };
          }
        >;
      };
    };
    const out: Record<string, string> = {};
    for (const node of ra.extractA11yTree(document.body).nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id) out[id] = node.a11y.name;
    }
    return out;
  });
  const native: Record<string, string> = {};
  for (const node of (await nativeTree(page)).nodes.values()) {
    const id = node.dom?.attributes["id"];
    if (id) native[id] = node.a11y.name;
  }
  return { dom, native };
}

describe("every associated label names the control, against Chromium", () => {
  it.each([
    [
      "two label[for]",
      `<label for="x">First</label><label for="x">Second</label><input id="x">`,
      "First Second",
    ],
    [
      "a label[for] then a wrapping label",
      `<label for="x">Outer</label><label>Wrap <input id="x"></label>`,
      "Outer Wrap",
    ],
    [
      "a wrapping label then a label[for]",
      `<label>Wrap <input id="x"></label><label for="x">After</label>`,
      "Wrap After",
    ],
    [
      "two labels on a select",
      `<label for="x">A</label><label for="x">B</label><select id="x"><option>o</option></select>`,
      "A B",
    ],
  ])("%s", async (_case, html, name) => {
    await page.setContent(html);
    const { dom, native } = await namesById();
    expect(native["x"]).toBe(name);
    expect(dom["x"]).toBe(name);
  });
});
