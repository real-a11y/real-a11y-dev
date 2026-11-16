/**
 * The invalid state, from both producers in real Chromium.
 *
 * The DOM producer used to ignore `aria-invalid`, so a field marked invalid
 * read the same as a valid one in a jsdom diff or snapshot, while Chromium's
 * own tree reported `invalid=true`.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e invalid-state`
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

/** Each element's `invalid` state by id, from both producers. */
async function invalidById(): Promise<{
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
      if (id) out[id] = node.a11y.states["invalid"] ?? "unset";
    }
    return out;
  });
  const native: Record<string, unknown> = {};
  for (const node of (await nativeTree(page)).nodes.values()) {
    const id = node.dom?.attributes["id"];
    if (id) native[id] = node.a11y.states["invalid"] ?? "unset";
  }
  return { dom, native };
}

describe("the invalid state, against Chromium", () => {
  it("reads aria-invalid's values as Chromium does", async () => {
    await page.setContent(`
      <input id="true" aria-invalid="true" aria-label="a">
      <input id="upper" aria-invalid="TRUE" aria-label="b">
      <input id="yes" aria-invalid="yes" aria-label="c">
      <input id="padded-false" aria-invalid=" false" aria-label="d">
      <input id="upper-undefined" aria-invalid="UNDEFINED" aria-label="e">
      <input id="false" aria-invalid="False" aria-label="f">
      <div id="group" role="group" aria-invalid="true" aria-label="g">x</div>
      <a id="link" href="#h" aria-invalid="true">h</a>
      <button id="button" aria-invalid="false">i</button>
      <select id="select" aria-invalid="true" aria-label="j"><option>k</option></select>
      <input id="checkbox" type="checkbox" aria-invalid="true" aria-label="l">
    `);
    const { dom, native } = await invalidById();
    const expected = {
      true: true,
      upper: true,
      yes: true,
      "padded-false": true,
      "upper-undefined": true,
      false: false,
      group: true,
      link: true,
      button: false,
      select: true,
      checkbox: true,
    };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });

  it("reads grammar and spelling as invalid on a textbox only", async () => {
    await page.setContent(`
      <input id="input" aria-invalid="grammar" aria-label="a">
      <input id="email" type="email" aria-invalid="SPELLING" aria-label="b">
      <textarea id="textarea" aria-invalid="spelling" aria-label="c"></textarea>
      <div id="div-textbox" role="textbox" aria-invalid="Grammar" aria-label="d"></div>
      <div id="searchbox" role="searchbox" aria-invalid="spelling" aria-label="e"></div>
      <div id="combobox" role="combobox" aria-invalid="grammar" aria-label="f"></div>
      <div id="group" role="group" aria-invalid="spelling" aria-label="g">x</div>
      <div id="padded-group" role="group" aria-invalid="grammar " aria-label="h">x</div>
      <input id="search" type="search" aria-invalid="spelling" aria-label="i">
      <input id="input-combobox" role="combobox" aria-invalid="grammar" aria-label="j">
      <input id="list" list="choices" aria-invalid="spelling" aria-label="k">
      <datalist id="choices"><option value="l"></option></datalist>
    `);
    const { dom, native } = await invalidById();
    const expected = {
      input: true,
      email: true,
      textarea: true,
      "div-textbox": true,
      searchbox: "unset",
      combobox: "unset",
      group: "unset",
      "padded-group": true,
      // A native text field in another role takes the rule for that role.
      search: "unset",
      "input-combobox": "unset",
      list: "unset",
    };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });

  it("leaves a role with no aria-invalid unset in both", async () => {
    await page.setContent(`
      <div id="group" role="group" aria-label="a">x</div>
      <div id="empty" role="group" aria-invalid="" aria-label="b">x</div>
      <div id="undefined" role="group" aria-invalid="undefined" aria-label="c">x</div>
    `);
    const { dom, native } = await invalidById();
    const expected = { group: "unset", empty: "unset", undefined: "unset" };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });

  it("pins what each producer does with a form control's own validity", async () => {
    await page.setContent(`
      <input id="plain" aria-label="a">
      <input id="required" required aria-label="b">
      <input id="bad-email" type="email" value="not-an-email" aria-label="c">
    `);
    const { dom, native } = await invalidById();
    // Chromium reads a form control's own validity into the state when no
    // aria-invalid sets it: `false` on every valid control, and `true` on one
    // with a type mismatch. A required field left empty counts as valid. The
    // DOM producer reads aria-invalid only. This records that divergence, and
    // fails if either side changes.
    expect(native).toMatchObject({
      plain: false,
      required: false,
      "bad-email": true,
    });
    expect(dom).toMatchObject({
      plain: "unset",
      required: "unset",
      "bad-email": "unset",
    });
  });
});
