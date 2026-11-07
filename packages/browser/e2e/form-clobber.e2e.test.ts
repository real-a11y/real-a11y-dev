/**
 * A `<form>` with a control named `tagName` or `getAttribute`, from both
 * producers in real Chromium.
 *
 * A form has `[LegacyOverrideBuiltIns]`, so a control named after a DOM member
 * shadows that member on the form. The DOM producer used to read both plainly,
 * the read threw, and the form went with every field and button inside it.
 * This case uses Chromium's own named-property override, with no test helpers.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e form-clobber`
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
    const markup = `<form><input name="${name}" aria-label="Field"><button>Go</button></form><button>Sibling</button>`;

    it("keeps the textbox and button in the DOM tree and the tab sequence", async () => {
      await page.setContent(markup);
      await page.addScriptTag({ content: pageBundleSource() });
      const { roles, tabs } = await page.evaluate(() => {
        const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
          extractA11yTree(root: Element): {
            nodes: Map<string, { a11y: { role: string; name: string } }>;
          };
          tabSequenceSnapshot(tree: unknown): string;
        };
        const tree = ra.extractA11yTree(document.body);
        return {
          roles: Array.from(tree.nodes.values()).map(
            (n) => `${n.a11y.role} ${n.a11y.name}`,
          ),
          tabs: ra.tabSequenceSnapshot(tree),
        };
      });
      expect(roles).toContain("textbox Field");
      expect(roles).toContain("button Go");
      expect(roles).toContain("button Sibling");
      expect(tabs).toContain('textbox "Field"');
      expect(tabs).toContain('button "Go"');
      expect(tabs).toContain('button "Sibling"');
    });

    it("still shows the same controls in the native tree", async () => {
      await page.setContent(markup);
      const roles = Array.from((await nativeTree(page)).nodes.values()).map(
        (n) => `${n.a11y.role} ${n.a11y.name}`,
      );
      expect(roles).toContain("textbox Field");
      expect(roles).toContain("button Go");
      expect(roles).toContain("button Sibling");
    });
  },
);
