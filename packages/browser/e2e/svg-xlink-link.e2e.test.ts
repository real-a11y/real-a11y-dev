/**
 * An SVG `<a>` that carries only `xlink:href`, in real Chromium, against both
 * tree producers and the DOM tab sequence.
 *
 * SVG-AAM 1.0 maps an `a` with a valid `href` or `xlink:href` to `link`.
 * Chromium does, and the DOM producer already counted such an element as a tab
 * stop, so it listed a focusable `generic`. The claim here is agreement with
 * Chromium, and it relies on the HTML parser putting `xlink:href` in the XLink
 * namespace inside `<svg>`, which only a real browser does.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e svg-xlink-link`
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

const REPRO = `<svg tabindex="0" width="10" height="10" data-t="svg"></svg><svg width="10" height="10"><a href="/" data-t="svga"><text y="9">x</text></a></svg><svg width="10" height="10"><a xlink:href="/" data-t="svgx"><text y="9">y</text></a></svg><button data-t="end">end</button>`;

describe("SVG <a xlink:href>", () => {
  it("is a link, and a link tab stop, in both producers", async () => {
    await page.setContent(REPRO);
    await page.addScriptTag({ content: pageBundleSource() });

    const dom = await page.evaluate(() => {
      const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
        extractA11yTree(root: Element): {
          nodes: Map<string, { a11y: { role: string; name: string } }>;
        };
        getTabSequence(tree: unknown): Array<{ id: string }>;
      };
      const tree = ra.extractA11yTree(document.body);
      return {
        nodes: [...tree.nodes.values()].map(
          (n) => `${n.a11y.role} "${n.a11y.name}"`,
        ),
        tabs: ra.getTabSequence(tree).map((n) => {
          const a = tree.nodes.get(n.id)!.a11y;
          return a.name ? `${a.role} "${a.name}"` : a.role;
        }),
      };
    });
    const native = [...(await nativeTree(page)).nodes.values()].map(
      (n) => `${n.a11y.role} "${n.a11y.name}"`,
    );

    expect(native).toContain('link "x"');
    expect(native).toContain('link "y"');
    expect(dom.nodes).toContain('link "x"');
    expect(dom.nodes).toContain('link "y"');
    // The tab sequence, which used to read `img | link "x" | generic "y" | …`.
    expect(dom.tabs).toEqual(["img", 'link "x"', 'link "y"', 'button "end"']);
  });

  it("is reached by Tab in Chromium, as the tab sequence says", async () => {
    await page.setContent(REPRO);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      const t = await page.evaluate(
        () =>
          document.activeElement?.getAttribute("data-t") ??
          (document.activeElement === document.body ? "<body>" : "?"),
      );
      if (t === "<body>" || seen.includes(t)) break;
      seen.push(t);
    }
    expect(seen).toEqual(["svg", "svga", "svgx", "end"]);
  });
});
