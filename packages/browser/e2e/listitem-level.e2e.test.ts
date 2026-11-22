/**
 * A list item's `level`, in real Chromium, against both tree producers.
 *
 * Chromium computes a `level` for every `<li>` from its nesting depth. No
 * author set one, the DOM producer prints none, and Core-AAM requires a
 * computed level only for `treeitem` and `comment`. The native producer used
 * to print `(level 1)` / `(level 2)` on every list item; now both agree. A
 * `treeitem` keeps the level Chromium computes for it.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e listitem-level`
 */

import { nativeTree, pageBundleSource } from "@real-a11y-dev/browser";
import { serializeTree } from "@real-a11y-dev/serialize";
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

const REPRO = `<ul><li>Item 1</li><li>Outer<ul><li>Inner</li></ul></li></ul>`;
const TREE = `<ul role="tree" aria-label="T"><li role="treeitem" aria-expanded="true">Parent<ul role="group"><li role="treeitem">Child</li></ul></li></ul>`;

async function bothPrinted(html: string) {
  await page.setContent(html);
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): unknown;
    };
    const tree = ra.extractA11yTree(document.body) as {
      nodes: Map<
        string,
        { a11y: { role: string; name: string; properties: { level?: string } } }
      >;
    };
    return [...tree.nodes.values()].map((n) => ({
      role: n.a11y.role,
      name: n.a11y.name,
      level: n.a11y.properties.level,
    }));
  });
  const native = await nativeTree(page);
  return {
    dom,
    native,
    nativePrinted: serializeTree(native, { markFocus: false }),
  };
}

describe("list item level", () => {
  it("is absent on every listitem, in both producers", async () => {
    const { dom, native, nativePrinted } = await bothPrinted(REPRO);

    expect(nativePrinted).toContain('listitem "Item 1"');
    // The outer item holds a list too, so its own text is a row beside it.
    expect(nativePrinted).toContain('listitem\n    text "Outer"');
    expect(nativePrinted).toContain('listitem "Inner"');
    expect(nativePrinted).not.toMatch(/listitem[^\n]*\(level/);
    for (const n of native.nodes.values()) {
      if (n.a11y.role === "listitem") {
        expect(n.a11y.properties.level).toBeUndefined();
      }
    }
    for (const n of dom.filter((d) => d.role === "listitem")) {
      expect(n.level).toBeUndefined();
    }
    const lines = (tree: typeof native) =>
      serializeTree(tree, { markFocus: false })
        .split("\n")
        .filter((l) => l.includes("listitem"))
        .map((l) => l.trim());
    expect(lines(native)).toEqual([
      'listitem "Item 1"',
      "listitem",
      'listitem "Inner"',
    ]);
  });

  it("still prints the level Chromium computes for a treeitem", async () => {
    const { native } = await bothPrinted(TREE);
    const items = [...native.nodes.values()].filter(
      (n) => n.a11y.role === "treeitem",
    );
    expect(
      items.map((n) => `${n.a11y.name}:${n.a11y.properties.level}`),
    ).toEqual(["Parent:1", "Child:2"]);
  });
});
