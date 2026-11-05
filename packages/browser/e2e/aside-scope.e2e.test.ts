/**
 * An `<aside>` inside sectioning content is a landmark only when named
 * (HTML-AAM 3.5.9 / 3.5.10), in both producers in real Chromium.
 *
 * `role-map.test.ts` pins the rule in jsdom; this checks the DOM producer and
 * Chromium's own tree agree on it.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e aside-scope`
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

/** Whether each `<aside id>` comes out as a complementary node, per producer. */
async function complementaryById(
  html: string,
): Promise<{ dom: Record<string, boolean>; native: Record<string, boolean> }> {
  await page.setContent(html);
  await page.addScriptTag({ content: pageBundleSource() });
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("aside[id]")].map((a) => a.id),
  );
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<
          string,
          {
            dom?: { attributes: Record<string, string> };
            a11y: { role: string };
          }
        >;
      };
    };
    const out: Record<string, boolean> = {};
    for (const node of ra.extractA11yTree(document.body).nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id) out[id] = node.a11y.role === "complementary";
    }
    return out;
  });
  const native: Record<string, boolean> = {};
  for (const node of (await nativeTree(page)).nodes.values()) {
    const id = node.dom?.attributes["id"];
    if (id) native[id] = node.a11y.role === "complementary";
  }
  const fill = (m: Record<string, boolean>) =>
    Object.fromEntries(ids.map((id) => [id, m[id] ?? false]));
  return { dom: fill(dom), native: fill(native) };
}

describe("<aside> scope", () => {
  it("is generic when unnamed inside sectioning content", async () => {
    const { dom, native } = await complementaryById(`
      <article><aside id="a">x</aside></article>
      <section><aside id="s">x</aside></section>
      <nav><aside id="n">x</aside></nav>
      <aside><aside id="i">x</aside></aside>
      <main><article><aside id="m">x</aside></article></main>
      <section><aside id="l1" aria-label="">x</aside></section>
      <section><aside id="l2" aria-label=" ">x</aside></section>
      <section><aside id="l3" aria-labelledby="nope">x</aside></section>`);
    for (const id of ["a", "s", "n", "i", "m", "l1", "l2", "l3"]) {
      expect(dom[id], `dom ${id}`).toBe(false);
      expect(native[id], `native ${id}`).toBe(false);
    }
  });

  it("is complementary under body or main, or when named", async () => {
    const { dom, native } = await complementaryById(`
      <span id="lbl">Related</span>
      <aside id="body">x</aside>
      <main><aside id="main">x</aside></main>
      <section><aside id="label" aria-label="Related">x</aside></section>
      <section><aside id="title" title="Related">x</aside></section>
      <section><aside id="by" aria-labelledby="lbl">x</aside></section>`);
    for (const id of ["body", "main", "label", "title", "by"]) {
      expect(dom[id], `dom ${id}`).toBe(true);
      expect(native[id], `native ${id}`).toBe(true);
    }
  });

  it('title="": the DOM producer follows the spec, Chromium keeps complementary', async () => {
    const { dom, native } = await complementaryById(
      `<section><aside id="t" title="">x</aside></section>`,
    );
    expect(dom["t"]).toBe(false);
    // Chromium divergence (WPT el-aside-in-section-title-empty expects generic).
    expect(native["t"]).toBe(true);
  });
});
