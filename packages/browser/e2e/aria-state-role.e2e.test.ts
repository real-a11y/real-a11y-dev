/**
 * Which roles keep an authored `aria-selected` or `aria-checked`, from both
 * producers in real Chromium.
 *
 * `dom-extractor.test.ts` pins the rule in jsdom. This pins a sample of it
 * against the tree it was measured from: each case states what Chromium
 * reports, and the DOM producer must agree.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e e2e/aria-state-role.e2e.test.ts`
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

type Pair = { selected: unknown; checked: unknown };

/** Each element's `selected` and `checked` states by id, from both producers. */
async function statesById(): Promise<{
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
            a11y: { states: Record<string, unknown> };
          }
        >;
      };
    };
    const out: Record<string, { selected: unknown; checked: unknown }> = {};
    for (const node of ra.extractA11yTree(document.body).nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id)
        out[id] = {
          selected: node.a11y.states["selected"] ?? "unset",
          checked: node.a11y.states["checked"] ?? "unset",
        };
    }
    return out;
  });
  const native: Record<string, Pair> = {};
  for (const node of (await nativeTree(page)).nodes.values()) {
    const id = node.dom?.attributes["id"];
    if (id)
      native[id] = {
        selected: node.a11y.states["selected"] ?? "unset",
        checked: node.a11y.states["checked"] ?? "unset",
      };
  }
  return { dom, native };
}

describe("aria-selected and aria-checked by role, against Chromium", () => {
  it("drops both on a role that does not support them", async () => {
    await page.setContent(`
      <button id="button-selected" aria-selected="true">x</button>
      <button id="button-checked" aria-checked="true">x</button>
      <a id="link-checked" href="/" aria-checked="true">y</a>
    `);
    const { dom, native } = await statesById();
    const none = { selected: "unset", checked: "unset" };
    const expected = {
      "button-selected": none,
      "button-checked": none,
      "link-checked": none,
    };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });

  it("keeps them on the roles that support them", async () => {
    await page.setContent(`
      <div role="tablist"><div id="tab" role="tab" aria-selected="true">Tab</div></div>
      <div role="listbox" aria-label="List">
        <div id="option" role="option" aria-selected="true" aria-checked="true">Option</div>
      </div>
      <div id="checkbox" role="checkbox" tabindex="0" aria-checked="true">Checkbox</div>
      <div id="radio" role="radio" tabindex="0" aria-checked="true">Radio</div>
      <div id="switch" role="switch" tabindex="0" aria-checked="true">Switch</div>
    `);
    const { dom, native } = await statesById();
    const expected = {
      tab: { selected: true, checked: "unset" },
      option: { selected: true, checked: true },
      checkbox: { selected: "unset", checked: true },
      radio: { selected: "unset", checked: true },
      switch: { selected: "unset", checked: true },
    };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });
});
