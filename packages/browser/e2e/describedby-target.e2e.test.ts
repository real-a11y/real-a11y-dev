/**
 * An element an `aria-describedby` points at stays in the tree, in both
 * producers, in real Chromium.
 *
 * WAI-ARIA 1.2 §7.2: a non-hidden element whose id another element references
 * MUST get an accessible object. A description is a property of the referrer;
 * it does not take the target out of the page. `dom-extractor.test.ts` pins
 * the rule in jsdom; this pins it against Chromium's tree, and pins the hidden
 * cases, which need a real layout engine.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e describedby-target`
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

/** Every `role "name"` the DOM producer reports for the page. */
async function domRoles(): Promise<string[]> {
  await page.addScriptTag({ content: pageBundleSource() });
  return page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<string, { a11y: { role: string; name: string } }>;
      };
    };
    return [...ra.extractA11yTree(document.body).nodes.values()].map(
      (n) => `${n.a11y.role} "${n.a11y.name}"`,
    );
  });
}

/** Every `role "name"` the native producer reports for the page. */
async function nativeRoles(): Promise<string[]> {
  return [...(await nativeTree(page)).nodes.values()].map(
    (n) => `${n.a11y.role} "${n.a11y.name}"`,
  );
}

async function both(html: string) {
  await page.setContent(html);
  return { dom: await domRoles(), native: await nativeRoles() };
}

describe("aria-describedby targets, against Chromium", () => {
  it("keeps a text-only target as a paragraph in both producers", async () => {
    const { dom, native } = await both(
      `<input aria-describedby="h" aria-label="pw"><p id="h">Must be 8 chars</p>`,
    );
    for (const roles of [dom, native]) {
      expect(roles).toContain('textbox "pw"');
      expect(roles).toContain('paragraph "Must be 8 chars"');
    }
  });

  it("keeps a heading target in both producers", async () => {
    const { dom, native } = await both(
      `<input aria-describedby="h" aria-label="pw"><h2 id="h">Password rules</h2>`,
    );
    for (const roles of [dom, native]) {
      expect(roles).toContain('heading "Password rules"');
    }
  });

  it("keeps a list target with its items in both producers", async () => {
    const { dom, native } = await both(
      `<button aria-describedby="l">b</button><ul id="l"><li>One</li><li>Two</li></ul>`,
    );
    for (const roles of [dom, native]) {
      expect(roles.some((r) => r.startsWith("list "))).toBe(true);
      expect(roles.filter((r) => r.startsWith("listitem "))).toHaveLength(2);
    }
  });

  it("leaves a hidden or display:none target out of both trees", async () => {
    for (const hidden of ["hidden", 'style="display: none"']) {
      const { dom, native } = await both(
        `<input aria-describedby="h" aria-label="pw"><p id="h" ${hidden}>Hidden help</p>`,
      );
      for (const roles of [dom, native]) {
        expect(roles).toContain('textbox "pw"');
        expect(roles.some((r) => r.includes("Hidden help"))).toBe(false);
      }
    }
  });
});
