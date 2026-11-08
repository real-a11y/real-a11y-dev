/**
 * The readonly state of a field, from both producers in real Chromium.
 *
 * HTML-AAM maps the `readonly` attribute to aria-readonly="true". The DOM
 * producer used to read only the ARIA attribute, so `<input readonly>` came
 * out editable while Chromium's own tree reported `readonly=true`.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e readonly-state`
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

/** Each element's `readonly` state by id, from both producers. */
async function readonlyById(): Promise<{
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
            dom?: { attributes: Record<string, string> };
            a11y: { states: Record<string, unknown> };
          }
        >;
      };
    };
    const out: Record<string, unknown> = {};
    for (const node of ra.extractA11yTree(document.body).nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id) out[id] = node.a11y.states["readonly"] ?? "unset";
    }
    return out;
  });
  const native: Record<string, unknown> = {};
  for (const node of (await nativeTree(page)).nodes.values()) {
    const id = node.dom?.attributes["id"];
    if (id) native[id] = node.a11y.states["readonly"] ?? "unset";
  }
  return { dom, native };
}

describe("the readonly state, against Chromium", () => {
  it("reports readonly for an input and a textarea with the attribute", async () => {
    await page.setContent(`
      <input id="input" readonly aria-label="a">
      <textarea id="textarea" readonly aria-label="a"></textarea>
      <label for="n">Name</label><input id="n" readonly value="Ada">
      <input id="editable" aria-label="e">
    `);
    const { dom, native } = await readonlyById();
    const expected = { input: true, textarea: true, n: true };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
    // A field without the attribute is not read only, from either producer.
    expect(native["editable"]).not.toBe(true);
    expect(dom["editable"]).toBe("unset");
  });

  it("pins what each producer does with readonly on other input types", async () => {
    await page.setContent(`
      <input id="number" type="number" readonly aria-label="Number">
      <input id="checkbox" type="checkbox" readonly aria-label="Check">
    `);
    const { dom, native } = await readonlyById();
    // A checkbox does not take the attribute: neither producer reports it.
    expect(dom["checkbox"]).toBe("unset");
    expect(native["checkbox"]).toBe("unset");
    // A number input does take it, and aria-readonly is supported on its
    // spinbutton role, so the DOM producer follows the spec. Chromium's own
    // tree leaves the state off a spinbutton; this records that divergence,
    // and fails if a Chromium milestone closes it.
    expect(dom["number"]).toBe(true);
    expect(native["number"]).toBe("unset");
  });
});
