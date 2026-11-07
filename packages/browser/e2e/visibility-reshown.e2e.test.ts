/**
 * A `visibility:visible` child of a `visibility:hidden` element, from both
 * producers in real Chromium.
 *
 * `visibility` is inherited and a descendant can override it, so the hidden
 * element goes while the re-shown child stays. jsdom has no real cascade for
 * this, so the cases run where the CSS is computed.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e visibility-reshown`
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

interface Seen {
  role: string;
  id: string | undefined;
  tag: string | undefined;
}

/** Every node of the a11y tree under `<body>`, from both producers. */
async function trees(): Promise<{ dom: Seen[]; native: Seen[] }> {
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<
          string,
          {
            dom?: { tagName: string; attributes: Record<string, string> };
            a11y: { role: string };
          }
        >;
      };
    };
    return Array.from(ra.extractA11yTree(document.body).nodes.values()).map(
      (n) => ({
        role: n.a11y.role,
        id: n.dom?.attributes["id"],
        tag: n.dom?.tagName,
      }),
    );
  });
  const native = Array.from((await nativeTree(page)).nodes.values()).map(
    (n) => ({
      role: n.a11y.role,
      id: n.dom?.attributes["id"],
      tag: n.dom?.tagName,
    }),
  );
  return { dom, native };
}

describe("a visibility:visible child of a visibility:hidden element", () => {
  it("is exposed, and the hidden element is not", async () => {
    await page.setContent(
      `<div id="hidden" style="visibility:hidden"><p id="shown" style="visibility:visible">x</p><p id="inherits">y</p></div>`,
    );
    const { dom, native } = await trees();
    for (const nodes of [dom, native]) {
      const roles = nodes.map((n) => n.role);
      expect(roles).toContain("paragraph");
      expect(nodes.find((n) => n.id === "hidden")).toBeUndefined();
    }
    // The re-shown child is there; the one that inherits the hiding is not.
    for (const nodes of [dom, native]) {
      expect(nodes.find((n) => n.id === "shown")?.role).toBe("paragraph");
      expect(nodes.find((n) => n.id === "inherits")).toBeUndefined();
    }
  });

  it("keeps the control of an aria-describedby target in a re-shown child", async () => {
    await page.setContent(`
      <input id="field" aria-label="Field" aria-describedby="help">
      <div id="help" style="visibility:hidden">
        Help
        <div style="visibility:visible"><button id="more">More</button></div>
      </div>
    `);
    const { dom, native } = await trees();
    expect(dom.find((n) => n.id === "more")?.role).toBe("button");
    expect(native.some((n) => n.role === "button")).toBe(true);
  });

  it("still hides a whole aria-hidden subtree", async () => {
    await page.setContent(
      `<div aria-hidden="true"><p id="p" aria-hidden="false" style="visibility:visible">x</p></div>`,
    );
    const { dom, native } = await trees();
    expect(dom.find((n) => n.id === "p")).toBeUndefined();
    expect(native.find((n) => n.id === "p")).toBeUndefined();
  });
});
