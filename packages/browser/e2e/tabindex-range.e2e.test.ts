/**
 * Which elements are tab stops, in real Chromium, against the DOM producer's
 * tab sequence.
 *
 * A `tabindex` outside the signed 32-bit range is ignored by Chromium, and an
 * element with `display: contents` has no box to focus. HTML's tabindex
 * parsing reads the integer with the "rules for parsing integers"; the range
 * limit and the `display: contents` case are taken from Chromium's observed
 * Tab order (the HTML Standard text on focusable areas leaves rendering to the
 * UA), so a divergence here is Chromium's call, not a spec sentence.
 *
 * `display: contents` depends on CSS, so jsdom cannot close this.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e tabindex-range`
 */

import { pageBundleSource } from "@real-a11y-dev/browser";
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

/** The tab sequence the DOM producer reports, by accessible name, or role when unnamed. */
async function domSequence(): Promise<string[]> {
  await page.addScriptTag({ content: pageBundleSource() });
  return page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): unknown;
      getTabSequence(tree: unknown): Array<{ id: string; dom?: unknown }>;
    };
    const tree = ra.extractA11yTree(document.body) as {
      nodes: Map<
        string,
        {
          a11y: { name: string };
          dom?: { attributes?: Record<string, string> };
        }
      >;
    };
    return ra.getTabSequence(tree).map((n) => {
      const a = tree.nodes.get(n.id)!.a11y;
      return a.name || a.role;
    });
  });
}

/** What Tab actually focuses, read off `document.activeElement`. */
async function chromiumSequence(): Promise<string[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  const seen: string[] = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    const t = await page.evaluate(
      () =>
        document.activeElement?.getAttribute("data-t") ??
        (document.activeElement === document.body ? "<body>" : "?"),
    );
    if (t === "<body>" || seen.includes(t)) break;
    seen.push(t);
  }
  return seen;
}

describe("tab stops", () => {
  it("ignores a tabindex outside the signed 32-bit range", async () => {
    await page.setContent(
      `<div tabindex="1abc" data-t="a">a</div><div tabindex=" 2" data-t="b">b</div><div tabindex="+3" data-t="c">c</div><div tabindex="-0" data-t="d">d</div><div tabindex="0.5" data-t="e">e</div><div tabindex="" data-t="f">f</div><div tabindex="abc" data-t="g">g</div><div tabindex="2147483648" data-t="h">h</div><div tabindex="2147483647" data-t="i">i</div><div tabindex="0" data-t="z">z</div>`,
    );
    const chromium = await chromiumSequence();
    expect(chromium).not.toContain("h");
    // 2147483647 is the largest positive value, so it sorts after a, b, c.
    expect(chromium).toEqual(["a", "b", "c", "i", "d", "e", "z"]);
    expect(await domSequence()).toEqual(["a", "b", "c", "i", "d", "e", "z"]);
  });

  it("leaves a display:contents element out but keeps its focusable child", async () => {
    await page.setContent(
      `<div tabindex="0" style="display:contents" data-t="dc">dc<button data-t="kid">kid</button></div><div tabindex="0" style="visibility:hidden" data-t="vh">vh</div><div inert><button data-t="inert">inert</button></div><dialog open tabindex="0" data-t="dlg">dlg</dialog><button data-t="end">end</button>`,
    );
    const real = await chromiumSequence();
    expect(real).toEqual(["kid", "dlg", "end"]);
    // The dialog has no name, so it reads by role.
    expect(await domSequence()).toEqual(["kid", "dialog", "end"]);
  });
});
