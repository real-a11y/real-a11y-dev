/**
 * CSS generated content and `text-transform` in names, from both producers in
 * real Chromium (accname 1.2 step 2F). jsdom has no pseudo-elements, so the
 * DOM producer's rule is pinned here against the native tree it must match.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e generated-content`
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

type Names = Record<string, string>;

/** Every element's accessible name by id, from the DOM and native producers. */
async function namesById(html: string): Promise<{ dom: Names; native: Names }> {
  await page.setContent(html);
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<
          string,
          {
            dom?: { attributes: Record<string, string> };
            a11y: { name?: string };
          }
        >;
      };
    };
    const out: Record<string, string> = {};
    for (const node of ra.extractA11yTree(document.body).nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id) out[id] = node.a11y.name ?? "";
    }
    return out;
  });
  const native: Names = {};
  for (const node of (await nativeTree(page)).nodes.values()) {
    const id = node.dom?.attributes["id"];
    if (id) native[id] = node.a11y.name ?? "";
  }
  return { dom, native };
}

interface Case {
  id: string;
  css?: string;
  html: string;
  name: string;
  /** The native name, where the DOM producer deliberately differs. */
  native?: string;
}

const CASES: Case[] = [
  {
    id: "before-after",
    css: `.c1::before{content:"before "}.c1::after{content:" after"}`,
    html: `<button id="before-after" class="c1">label</button>`,
    name: "before label after",
  },
  {
    id: "alt",
    css: `.c2::before{content:"★" / "Favourite "}`,
    html: `<button id="alt" class="c2">item</button>`,
    name: "Favourite item",
  },
  {
    id: "alt-empty",
    css: `.c3::before{content:"★" / ""}`,
    html: `<button id="alt-empty" class="c3">item</button>`,
    name: "item",
  },
  {
    id: "heading",
    css: `.c4::before{content:"Step 1: "}`,
    html: `<h2 id="heading" class="c4">Install</h2>`,
    name: "Step 1: Install",
  },
  {
    id: "link",
    css: `.c5::after{content:" (external)"}`,
    html: `<a id="link" class="c5" href="#">Docs</a>`,
    name: "Docs (external)",
  },
  {
    id: "descendant",
    css: `.c6::before{content:"pre-"}`,
    html: `<button id="descendant"><span class="c6">label</span></button>`,
    name: "pre-label",
  },
  {
    id: "labelledby",
    css: `.c7::before{content:"pre "}`,
    html: `<span id="t" class="c7">label</span><button id="labelledby" aria-labelledby="t">x</button>`,
    name: "pre label",
  },
  {
    id: "joiners",
    css: `.c8::before{content:"nospace"}.c8::after{content:"nospace"}`,
    html: `<button id="joiners" class="c8">label</button>`,
    name: "nospacelabelnospace",
  },
  {
    id: "upper",
    html: `<h2 id="upper" style="text-transform:uppercase">Call us</h2>`,
    name: "CALL US",
  },
  {
    id: "capitalize",
    html: `<h2 id="capitalize" style="text-transform:capitalize">call us now</h2>`,
    name: "Call Us Now",
  },
  {
    id: "lower",
    html: `<h2 id="lower" style="text-transform:lowercase">Call US</h2>`,
    name: "call us",
  },
  {
    id: "inline-plus",
    css: `.p1::before{content:"+"}`,
    html: `<button id="inline-plus" class="p1">Add</button>`,
    name: "+Add",
  },
  {
    id: "inline-block-plus",
    css: `.p2::before{content:"+";display:inline-block}`,
    html: `<button id="inline-block-plus" class="p2">Add</button>`,
    name: "+ Add",
  },
  {
    id: "block-plus",
    css: `.p3::before{content:"+";display:block}`,
    html: `<button id="block-plus" class="p3">Add</button>`,
    name: "+ Add",
  },
  {
    id: "attr",
    css: `.a1::before{content:attr(data-x) " "}`,
    html: `<button id="attr" class="a1" data-x="pre">label</button>`,
    name: "pre label",
  },
  {
    id: "attr-alt",
    css: `.a2::before{content:"★" / attr(data-a)}`,
    html: `<button id="attr-alt" class="a2" data-a="Fav ">item</button>`,
    name: "Fav item",
  },
  {
    id: "url",
    css: `.u1::before{content:url("data:image/gif;base64,R0lGODlhAQABAAAAACw=") " New "}`,
    html: `<button id="url" class="u1">label</button>`,
    name: "New label",
  },
  {
    id: "url-alt",
    css: `.u2::before{content:url("data:image/gif;base64,R0lGODlhAQABAAAAACw=") / "Icon "}`,
    html: `<button id="url-alt" class="u2">label</button>`,
    name: "Icon label",
  },
  {
    id: "counter",
    css: `.k1{counter-reset:c 50}.k1::before{content:counter(c) "51 "}`,
    html: `<button id="counter" class="k1">label</button>`,
    name: "51 label",
  },
  {
    id: "wrapping-label",
    css: `.w1::after{content:" *"}`,
    html: `<label class="w1" style="text-transform:uppercase">Email <input id="wrapping-label"></label>`,
    name: "EMAIL *",
  },
  {
    id: "display-none",
    css: `.n1::before{content:"x";display:none}`,
    html: `<button id="display-none" class="n1">Save</button>`,
    name: "Save",
  },
  {
    id: "visibility-hidden",
    css: `.n2::before{content:"x";visibility:hidden}`,
    html: `<button id="visibility-hidden" class="n2">Save</button>`,
    name: "Save",
  },
  // Accepted divergences from Chromium (see the ticket's Decision 2).
  {
    id: "quotes",
    css: `.q1::before{content:open-quote "Hi" close-quote " "}`,
    html: `<button id="quotes" class="q1">label</button>`,
    name: "Hi label",
    native: "“Hi” label",
  },
  {
    id: "counter-alt",
    css: `.k2{counter-reset:c 50}.k2::before{content:"x" / counter(c) "51 "}`,
    html: `<button id="counter-alt" class="k2">label</button>`,
    name: "51 label",
    native: "5051 label",
  },
];

describe("generated content and text-transform in names", () => {
  for (const c of CASES) {
    it(`${c.id}: ${JSON.stringify(c.name)}`, async () => {
      const { dom, native } = await namesById(
        `<style>${c.css ?? ""}</style><main>${c.html}</main>`,
      );
      expect(dom[c.id]).toBe(c.name);
      expect(native[c.id]).toBe(c.native ?? c.name);
    });
  }
});
