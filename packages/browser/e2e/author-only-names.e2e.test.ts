/**
 * Roles only their author can name — article, group, doc-toc, graphics-document
 * and the like — come out unnamed in both producers, as in Chromium's raw tree.
 * Their text is content, not a name (WAI-ARIA 1.2 §5.2.8, DPUB-ARIA 1.1,
 * Graphics-ARIA 1.0).
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e author-only-names`
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

const HTML = `
  <article id="art">a</article>
  <address id="addr">x</address>
  <div id="grp" role="group">gr</div>
  <nav id="toc" role="doc-toc">x</nav>
  <div id="gdoc" role="graphics-document">x</div>`;

const ROLES: Record<string, string> = {
  art: "article",
  addr: "group",
  grp: "group",
  toc: "doc-toc",
  gdoc: "graphics-document",
};

describe("author-only roles", () => {
  it("are unnamed in raw Chromium, the DOM producer and the native producer", async () => {
    await page.setContent(HTML);
    await page.addScriptTag({ content: pageBundleSource() });

    const dom = await page.evaluate(() => {
      const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
        extractA11yTree(root: Element): {
          nodes: Map<
            string,
            {
              dom?: { attributes: Record<string, string> };
              a11y: { role: string; name: string };
            }
          >;
        };
      };
      const out: Record<string, { role: string; name: string }> = {};
      for (const n of ra.extractA11yTree(document.body).nodes.values()) {
        const id = n.dom?.attributes["id"];
        if (id) out[id] = n.a11y;
      }
      return out;
    });

    const native: Record<string, { role: string; name: string }> = {};
    for (const n of (await nativeTree(page)).nodes.values()) {
      const id = n.dom?.attributes["id"];
      if (id) native[id] = n.a11y;
    }

    // Chromium's raw tree: every one of these roles, with no name.
    const cdp = await page.context().newCDPSession(page);
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes: { role?: { value: string }; name?: { value: string } }[];
    };
    const wanted = new Set(Object.values(ROLES));
    const raw = nodes.filter((n) => wanted.has(n.role?.value ?? ""));
    expect(raw.length).toBeGreaterThanOrEqual(Object.keys(ROLES).length);
    for (const n of raw) expect(n.name?.value ?? "", n.role?.value).toBe("");

    for (const [id, role] of Object.entries(ROLES)) {
      expect(dom[id]?.name, `dom ${id}`).toBe("");
      expect(native[id]?.role, `native ${id} role`).toBe(role);
      expect(native[id]?.name, `native ${id}`).toBe("");
    }
  });
});
