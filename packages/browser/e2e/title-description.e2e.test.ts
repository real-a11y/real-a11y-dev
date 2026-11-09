/**
 * `title` as the accessible description, from both producers in real Chromium.
 *
 * HTML-AAM §4.2 makes the `title` the last description source, used when it
 * was not the name. The DOM producer used to leave the description empty, so
 * `<button aria-label="AL" title="Ti">` was described by Chromium and the
 * native producer but not by the DOM producer. The serialized tree prints no
 * description, so this compares the `a11y.description` field itself.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e title-description`
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

type Pair = { name: string; description: string };

/** Each element's name and description by id, from both producers. */
async function pairsById(): Promise<{
  dom: Record<string, Pair>;
  native: Record<string, Pair>;
}> {
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<
          string,
          {
            dom?: { attributes: Record<string, string> };
            a11y: { name: string; description?: string };
          }
        >;
      };
    };
    const out: Record<string, { name: string; description: string }> = {};
    for (const node of ra.extractA11yTree(document.body).nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id)
        out[id] = {
          name: node.a11y.name,
          description: node.a11y.description ?? "",
        };
    }
    return out;
  });
  const native: Record<string, Pair> = {};
  for (const node of (await nativeTree(page)).nodes.values()) {
    const id = node.dom?.attributes["id"];
    if (id)
      native[id] = {
        name: node.a11y.name,
        description: node.a11y.description ?? "",
      };
  }
  return { dom, native };
}

describe("title as the description, against Chromium", () => {
  it("describes elements whose name came from another source", async () => {
    await page.setContent(`
      <button id="b" aria-label="AL" title="Ti">Save</button>
      <img id="i" alt="Alt" title="Ti" src="data:,">
      <label for="t">Lab</label><input id="t" title="Ti">
    `);
    const { dom, native } = await pairsById();
    const expected = {
      b: { name: "AL", description: "Ti" },
      i: { name: "Alt", description: "Ti" },
      t: { name: "Lab", description: "Ti" },
    };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });

  it("keeps a title that is the name out of the description", async () => {
    await page.setContent(`
      <a id="a" href="/" title="Tooltip"></a>
      <button id="c" title="Ti">Save</button>
    `);
    const { dom, native } = await pairsById();
    const expected = {
      a: { name: "Tooltip", description: "" },
      c: { name: "Save", description: "Ti" },
    };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });

  it("falls back to title when aria-describedby names no element", async () => {
    await page.setContent(`
      <button id="e" aria-label="E" aria-describedby="missing" title="Ti">x</button>
    `);
    const { dom, native } = await pairsById();
    expect(native["e"]).toEqual({ name: "E", description: "Ti" });
    expect(dom["e"]).toEqual({ name: "E", description: "Ti" });
  });
});
