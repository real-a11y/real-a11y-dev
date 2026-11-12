/**
 * U+00A0 in accessible names, from both producers in real Chromium.
 *
 * AccName 1.2 defines no collapse for text and trims only ASCII whitespace
 * (the WPT `accname/name/comp_text_node` and `comp_label` cases), so Chromium
 * keeps a non-breaking space inside a name and at either end. The jsdom cases
 * live in `dom-extractor.test.ts` and `ax-normalize.test.ts`; this pins the
 * DOM and native producers to what Chromium itself reports, taken from its
 * raw CDP tree, so a milestone that changes it fails here.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e nbsp-names`
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

interface Names {
  dom: Record<string, string>;
  native: Record<string, string>;
  raw: Record<string, string>;
}

/** Every `id`-ed element's name from the DOM, native and raw CDP trees. */
async function namesById(): Promise<Names> {
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<
          string,
          {
            dom?: { attributes: Record<string, string> };
            a11y: { name: string };
          }
        >;
      };
    };
    const out: Record<string, string> = {};
    for (const node of ra.extractA11yTree(document.body).nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id) out[id] = node.a11y.name;
    }
    return out;
  });
  const native: Record<string, string> = {};
  for (const node of (await nativeTree(page)).nodes.values()) {
    const id = node.dom?.attributes["id"];
    if (id) native[id] = node.a11y.name;
  }
  const raw: Record<string, string> = {};
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("Accessibility.enable");
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes: {
        backendDOMNodeId?: number;
        ignored?: boolean;
        name?: { value?: string };
      }[];
    };
    for (const n of nodes) {
      if (n.ignored || n.backendDOMNodeId === undefined) continue;
      const { node } = (await cdp.send("DOM.describeNode", {
        backendNodeId: n.backendDOMNodeId,
      })) as { node: { attributes?: string[] } };
      const attrs = node.attributes ?? [];
      const at = attrs.indexOf("id");
      if (at >= 0) raw[attrs[at + 1]!] = n.name?.value ?? "";
    }
  } finally {
    await cdp.detach();
  }
  return { dom, native, raw };
}

const NBSP = " ";

describe("non-breaking spaces in names, against Chromium", () => {
  it("keeps U+00A0 inside and at the ends of a name", async () => {
    await page.setContent(`
      <button id="one">button&nbsp;label</button>
      <button id="three">button&nbsp;&nbsp;&nbsp;label</button>
      <button id="edges">&nbsp;label&nbsp;</button>
      <button id="mixed">button   &nbsp;   label</button>
      <h2 id="heading">&nbsp;heading&nbsp;</h2>
      <a id="link" href="#">link&nbsp;text</a>
      <div id="role-button" role="button">span&nbsp;&nbsp;role</div>
    `);
    const { dom, native, raw } = await namesById();
    expect(raw["one"]).toBe(`button${NBSP}label`);
    for (const id of [
      "one",
      "three",
      "edges",
      "mixed",
      "heading",
      "link",
      "role-button",
    ]) {
      expect(dom[id], `dom ${id}`).toBe(raw[id]);
      expect(native[id], `native ${id}`).toBe(raw[id]);
    }
  });

  it("keeps U+00A0 at the ends of an aria-label", async () => {
    await page.setContent(`
      <nav id="trail" aria-label="label&nbsp;">x</nav>
      <button id="lead" aria-label="&nbsp;label">x</button>
    `);
    const { dom, native, raw } = await namesById();
    expect(raw["trail"]).toBe(`label${NBSP}`);
    expect(raw["lead"]).toBe(`${NBSP}label`);
    for (const id of ["trail", "lead"]) {
      expect(dom[id], `dom ${id}`).toBe(raw[id]);
      expect(native[id], `native ${id}`).toBe(raw[id]);
    }
  });

  it("still folds tabs and line breaks to one ASCII space", async () => {
    await page.setContent(
      `<button id="ws">one\t\ttwo\n\n  three</button><h2 id="h">\n  Title\n</h2>`,
    );
    const { dom, native, raw } = await namesById();
    expect(raw["ws"]).toBe("one two three");
    for (const id of ["ws", "h"]) {
      expect(dom[id], `dom ${id}`).toBe(raw[id]);
      expect(native[id], `native ${id}`).toBe(raw[id]);
    }
  });

  it("treats an aria-label of only U+00A0 as Chromium does", async () => {
    await page.setContent(
      `<button id="blank" aria-label="&nbsp;">Save</button>`,
    );
    const { dom, native, raw } = await namesById();
    // Not ASCII whitespace, so not blank: the label wins in every tree.
    expect(raw["blank"]).toBe(NBSP);
    expect(dom["blank"]).toBe(raw["blank"]);
    expect(native["blank"]).toBe(raw["blank"]);
  });
});
