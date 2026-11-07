/**
 * A `<form>` with a control named after one of its own members, in real
 * Chromium.
 *
 * A form has `[LegacyOverrideBuiltIns]`: `<input name="tagName">` makes
 * `form.tagName` that input, and `<input name="getAttribute">` makes
 * `form.getAttribute` it. The DOM producer once threw on the form and dropped
 * the form with every field and button in it. This uses the browser's real
 * named-property override, with no test helpers.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e form-control-clobber`
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

describe.each(["tagName", "getAttribute"])(
  "a form with a control named %s",
  (name) => {
    it("keeps the form's controls in the tree and the tab sequence, in both producers", async () => {
      await page.setContent(
        `<form><input name="${name}" aria-label="Field"><button>Go</button></form><button>Sibling</button>`,
      );
      await page.addScriptTag({ content: pageBundleSource() });
      const dom = await page.evaluate(() => {
        const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
          extractA11yTree(root: Element): {
            nodes: Map<string, { a11y: { role: string; name: string } }>;
          };
          tabSequenceSnapshot(tree: unknown): string;
        };
        const tree = ra.extractA11yTree(document.body);
        return {
          nodes: Array.from(tree.nodes.values()).map(
            (n) => `${n.a11y.role} ${n.a11y.name}`,
          ),
          tabs: ra.tabSequenceSnapshot(tree),
        };
      });
      expect(dom.nodes).toContain("textbox Field");
      expect(dom.nodes).toContain("button Go");
      expect(dom.nodes).toContain("button Sibling");
      expect(dom.tabs).toContain("Field");
      expect(dom.tabs).toContain("Go");
      expect(dom.tabs).toContain("Sibling");

      const native = Array.from((await nativeTree(page)).nodes.values()).map(
        (n) => `${n.a11y.role} ${n.a11y.name}`,
      );
      expect(native).toContain("textbox Field");
      expect(native).toContain("button Go");
    });
  },
);
