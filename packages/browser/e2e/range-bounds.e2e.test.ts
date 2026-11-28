/**
 * A range widget's `valuemin`/`valuemax`, from both producers in real
 * Chromium.
 *
 * `dom-extractor.test.ts` pins the rule in jsdom. This checks the DOM
 * producer reports the same bounds as Chromium's own tree for the same page,
 * and that neither invents a current value where the DOM producer knows of
 * none.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e range-bounds`
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
  props: Record<string, string>;
  value: string | undefined;
}

/** Each element's range properties and value by id, from both producers. */
async function boundsById(): Promise<{
  dom: Record<string, Seen>;
  native: Record<string, Seen>;
}> {
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<
          string,
          {
            dom?: { attributes: Record<string, string> };
            a11y: { properties: Record<string, string>; value?: string };
          }
        >;
      };
    };
    const out: Record<string, Seen> = {};
    for (const node of ra.extractA11yTree(document.body).nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (!id) continue;
      const { valuemin, valuemax } = node.a11y.properties;
      out[id] = {
        props: {
          ...(valuemin !== undefined ? { valuemin } : {}),
          ...(valuemax !== undefined ? { valuemax } : {}),
        },
        value: node.a11y.value,
      };
    }
    return out;
  });
  const native: Record<string, Seen> = {};
  for (const node of (await nativeTree(page)).nodes.values()) {
    const id = node.dom?.attributes["id"];
    if (!id) continue;
    const { valuemin, valuemax } = node.a11y.properties;
    native[id] = {
      props: {
        ...(valuemin !== undefined ? { valuemin } : {}),
        ...(valuemax !== undefined ? { valuemax } : {}),
      },
      value: node.a11y.value,
    };
  }
  return { dom, native };
}

describe("range bounds, against Chromium", () => {
  it("reports the same bounds as Chromium's tree", async () => {
    await page.setContent(`
      <div id="aria" role="slider" aria-valuenow="5" aria-valuemin="1" aria-valuemax="9" aria-valuetext="five" aria-label="s"></div>
      <input id="range" type="range" min="0" max="10" step="2" value="4" aria-label="r">
      <input id="range-default" type="range" aria-label="rd">
      <input id="range-both" type="range" min="0" max="10" aria-valuemin="2" aria-valuemax="8" aria-label="rb">
      <progress id="progress" max="100" value="30"></progress>
      <progress id="indeterminate"></progress>
      <meter id="meter" min="0" max="10" value="6"></meter>
      <div id="bare" role="slider" aria-label="bare"></div>
    `);
    const { dom, native } = await boundsById();
    const expected = {
      aria: { valuemin: "1", valuemax: "9" },
      range: { valuemin: "0", valuemax: "10" },
      "range-default": { valuemin: "0", valuemax: "100" },
      "range-both": { valuemin: "2", valuemax: "8" },
      progress: { valuemin: "0", valuemax: "100" },
      indeterminate: { valuemin: "0", valuemax: "1" },
      meter: { valuemin: "0", valuemax: "10" },
      bare: { valuemin: "0", valuemax: "100" },
    };
    for (const [id, props] of Object.entries(expected)) {
      expect(native[id]?.props, `native ${id}`).toEqual(props);
      expect(dom[id]?.props, `dom ${id}`).toEqual(props);
    }
    expect(dom["aria"]?.value).toBe("five");
    expect(dom["range"]?.value).toBe("4");
    // Chromium invents value="50" for a slider with no aria-valuenow, and
    // ARIA 1.2 implies no current value, so only the DOM producer is right.
    expect(dom["bare"]?.value).toBeUndefined();
  });

  it("gives a spinbutton no default bounds, where Chromium says 0 and 0", async () => {
    await page.setContent(`
      <div id="spin" role="spinbutton" aria-label="n"></div>
      <input id="num" type="number" value="2" min="1" aria-label="num">
    `);
    const { dom } = await boundsById();
    // Chromium reports valuemin=0 valuemax=0 for a bare spinbutton, and
    // valuemax=0 under min=1: a Chromium divergence, so only the DOM
    // producer is asserted.
    expect(dom["spin"]?.props).toEqual({});
    expect(dom["num"]?.props).toEqual({ valuemin: "1" });
  });
});
