/**
 * The selected state of a native <option>, from both producers in real
 * Chromium.
 *
 * HTML-AAM maps an option's selectedness to aria-selected. The DOM producer
 * used to give a native option no `selected` state at all, while Chromium's
 * own tree reported true on the chosen option and false on the others. An
 * authored aria-selected on an option wins over selectedness in Chromium, so
 * the DOM producer follows it.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e option-selected`
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

/** Each option's `selected` state by name, from both producers. */
async function selectedByName(): Promise<{
  dom: Record<string, unknown>;
  native: Record<string, unknown>;
}> {
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<
          string,
          {
            a11y: {
              role: string;
              name: string;
              states: Record<string, unknown>;
            };
          }
        >;
      };
    };
    const out: Record<string, unknown> = {};
    for (const { a11y } of ra.extractA11yTree(document.body).nodes.values())
      if (a11y.role === "option") out[a11y.name] = a11y.states["selected"];
    return out;
  });
  const native: Record<string, unknown> = {};
  for (const { a11y } of (await nativeTree(page)).nodes.values())
    if (a11y.role === "option") native[a11y.name] = a11y.states["selected"];
  return { dom, native };
}

describe("the selected state of an <option>, against Chromium", () => {
  it("agrees for a drop-down and a multiple select", async () => {
    await page.setContent(
      `<main><select aria-label="One"><option>a</option><option selected>b</option></select>` +
        `<select aria-label="Many" multiple><option selected>c</option><option selected>d</option><option>e</option></select></main>`,
    );
    const { dom, native } = await selectedByName();
    expect(dom).toEqual({ a: false, b: true, c: true, d: true, e: false });
    expect(native).toEqual(dom);
  });

  it("lets an authored aria-selected win in both producers", async () => {
    await page.setContent(
      `<main><select aria-label="One"><option aria-selected="true">a</option><option selected aria-selected="false">b</option></select></main>`,
    );
    const { dom, native } = await selectedByName();
    expect(dom).toEqual({ a: true, b: false });
    expect(native).toEqual(dom);
  });
});
