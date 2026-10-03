/**
 * Which roles carry an `expanded` state, from both producers in real Chromium.
 *
 * `dom-extractor.test.ts` pins the rule in jsdom across every role. This pins
 * a sample of it against the tree it was measured from, so a Chromium
 * milestone that gives another role the state, or takes it from one, fails
 * here: each case states what Chromium reports, and the DOM producer must
 * agree.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e`
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

/** Each element's `expanded` state by id, from both producers. */
async function expandedById(): Promise<{
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
      if (id) out[id] = node.a11y.states["expanded"] ?? "unset";
    }
    return out;
  });
  const native: Record<string, unknown> = {};
  for (const node of (await nativeTree(page)).nodes.values()) {
    const id = node.dom?.attributes["id"];
    if (id) native[id] = node.a11y.states["expanded"] ?? "unset";
  }
  return { dom, native };
}

describe("the roles with an expanded state, against Chromium", () => {
  it("reads aria-expanded only on a role Chromium gives the state", async () => {
    await page.setContent(`
      <button id="button" aria-expanded="true">Button</button>
      <div role="tablist" aria-label="Tabs">
        <div id="tab" role="tab" aria-expanded="false">Tab</div>
      </div>
      <ul><li id="listitem" aria-expanded="true">Item</li></ul>
      <table>
        <tr><th id="columnheader" aria-expanded="true">Head</th></tr>
        <tr id="row" aria-expanded="false"><td id="cell" aria-expanded="true">Cell</td></tr>
      </table>
      <table role="grid" aria-label="Grid">
        <tr><td id="grid-td" aria-expanded="true">Grid td</td>
        <td id="gridcell" role="gridcell" aria-expanded="true">Grid cell</td></tr>
      </table>
      <button id="button-radio" role="radio" aria-checked="false" aria-expanded="true">Radio</button>
      <button id="button-heading" role="heading" aria-expanded="true">Heading</button>
      <div id="listbox" role="listbox" tabindex="0" aria-label="Listbox" aria-expanded="true">
        <div role="option">Option</div>
      </div>
      <input id="text" type="text" aria-label="Text" aria-expanded="true">
      <input id="input-list" list="choices" aria-label="Choice" aria-expanded="true">
      <datalist id="choices"><option value="A"></option></datalist>
      <select id="select-menu" role="menu" aria-label="Menu" aria-expanded="true"><option>a</option></select>
      <select id="select-tab" role="tab" aria-label="Select tab" aria-expanded="true"><option>a</option></select>
    `);

    const { dom, native } = await expandedById();
    const expected = {
      button: true,
      tab: false,
      listitem: true,
      columnheader: true,
      row: false,
      cell: "unset",
      // A grid's <td> is a gridcell in Chromium's tree, but has no expanded
      // state unless the author wrote role="gridcell".
      "grid-td": "unset",
      gridcell: true,
      "button-radio": "unset",
      "button-heading": "unset",
      listbox: "unset",
      text: "unset",
      // A text input with a list is a combobox, which has the state.
      "input-list": true,
      "select-menu": "unset",
      "select-tab": true,
    };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });

  it("reads aria-expanded on a role only in its required context", async () => {
    await page.setContent(`
      <div role="list"><div id="listitem" role="listitem" aria-expanded="true">In a list</div></div>
      <div role="tree" aria-label="Tree">
        <div id="treeitem" role="treeitem" aria-expanded="true">In a tree</div>
      </div>
      <div id="listitem-alone" role="listitem" tabindex="0" aria-label="Alone item" aria-expanded="true">x</div>
      <div id="treeitem-alone" role="treeitem" tabindex="0" aria-label="Alone tree item" aria-expanded="true">x</div>
    `);

    const { dom, native } = await expandedById();
    const expected = {
      listitem: true,
      treeitem: true,
      // Out of its context each role falls back to generic, which has none.
      "listitem-alone": "unset",
      "treeitem-alone": "unset",
    };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });

  it("puts a details' state on its summary, in an expandable role", async () => {
    await page.setContent(`
      <details id="details" open aria-label="Details" aria-expanded="false">
        <summary id="summary">Summary</summary>Body
      </details>
      <details open><summary id="summary-link" role="link">Link</summary>Body</details>
      <details open><summary id="summary-heading" role="heading" aria-expanded="true">Heading</summary>Body</details>
      <details id="details-button" role="button" aria-label="Details button" aria-expanded="true">
        <summary>Inner</summary>Body
      </details>
    `);

    const { dom, native } = await expandedById();
    const expected = {
      // The group has none, from `open` or aria-expanded.
      details: "unset",
      summary: true,
      "summary-link": true,
      "summary-heading": "unset",
      // In an expandable role aria-expanded decides, and `open` never does.
      "details-button": true,
    };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });
});
