/**
 * A `<td>` in a `grid` or `treegrid` table is a `gridcell`, in both producers
 * in real Chromium (HTML-AAM 3.5.130).
 *
 * `role-map.test.ts` pins the rule in jsdom; this checks the DOM producer and
 * Chromium's own tree agree on it.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e grid-cell-role`
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

/** Role and name of every node named `name`, per producer. */
async function rolesByName(
  html: string,
): Promise<{ dom: string[]; native: string[] }> {
  await page.setContent(html);
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<string, { a11y: { role: string; name: string } }>;
      };
    };
    return [...ra.extractA11yTree(document.body).nodes.values()].map(
      (n) => `${n.a11y.role} "${n.a11y.name}"`,
    );
  });
  const native = [...(await nativeTree(page)).nodes.values()].map(
    (n) => `${n.a11y.role} "${n.a11y.name}"`,
  );
  return { dom, native };
}

describe("<td> role by table role", () => {
  it("is gridcell under grid and treegrid", async () => {
    const { dom, native } = await rolesByName(`
      <table role="grid"><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>
      <table role="treegrid"><tr><td>T</td></tr></table>`);
    for (const label of ['gridcell "C"', 'gridcell "T"']) {
      expect(dom, `dom ${label}`).toContain(label);
      expect(native, `native ${label}`).toContain(label);
    }
    expect(dom).toContain('columnheader "H"');
  });

  it("is cell under a plain table", async () => {
    const { dom, native } = await rolesByName(
      `<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>P</td></tr></tbody></table>`,
    );
    expect(dom).toContain('cell "P"');
    expect(native).toContain('cell "P"');
  });
});
