/**
 * Frames in the DOM producer's tab sequence, against what Chromium's Tab does.
 *
 * A frame is listed once, where Tab enters it, however many stops it holds.
 * `<iframe>` and an `<object>` showing a document are stops; an image, a failed
 * load, `display: contents`, `inert`, `visibility: hidden` and a negative
 * `tabindex` are not. This depends on layout and a real nested document, so
 * jsdom cannot close it.
 *
 * Known difference, pinned below: a keyboard-focusable scroller is a stop in
 * Chromium and is not listed yet (the "DOM tab sequence skips
 * keyboard-focusable scroll containers" ticket).
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e tab-sequence`
 */

import { pageBundleSource } from "@real-a11y-dev/browser";
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

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const HTML_DOC = "data:text/html,<button>o</button>";
const SVG_DOC =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>";

/** The DOM producer's sequence, by accessible name, or role when unnamed. */
async function domSequence(): Promise<string[]> {
  await page.addScriptTag({ content: pageBundleSource() });
  return page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): unknown;
      getTabSequence(tree: unknown): Array<{ id: string }>;
    };
    const tree = ra.extractA11yTree(document.body) as {
      nodes: Map<string, { a11y: { name: string; role: string } }>;
    };
    return ra
      .getTabSequence(tree)
      .map((n) => tree.nodes.get(n.id)!.a11y)
      .map((a) => a.name || a.role);
  });
}

/**
 * What Tab focuses, as `data-t` of the first thing focused in each element
 * on the page's top document. A press that moves focus inside a frame counts
 * as the frame, once.
 */
async function chromiumSequence(): Promise<string[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  const seen: string[] = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    const t = await page.evaluate(
      () =>
        document.activeElement?.getAttribute("data-t") ??
        (document.activeElement === document.body ? "<body>" : "?"),
    );
    if (t === "<body>") break;
    if (seen[seen.length - 1] !== t) seen.push(t);
    if (seen.length > 12) break;
  }
  return seen;
}

async function both(html: string) {
  await page.setContent(html);
  // `object` data: URLs load asynchronously.
  await page.waitForLoadState("load");
  await page.waitForTimeout(150);
  const dom = await domSequence();
  const real = await chromiumSequence();
  // The DOM sequence must be what Tab actually visits, frame entries included.
  expect(dom).toEqual(real);
  return { dom, real };
}

const FRAME = (attrs = "") =>
  `<iframe srcdoc="<button>in</button>" title="if" data-t="if" ${attrs}></iframe>`;

describe("frames in the tab sequence", () => {
  it("lists an iframe, an object and media where Tab enters them", async () => {
    const { dom } = await both(
      `<a href="/" data-t="a1">a1</a>${FRAME()}<object data="${HTML_DOC}" data-t="generic"></object><video controls data-t="video"></video><a href="/" data-t="a2">a2</a>`,
    );
    expect(dom).toEqual(["a1", "if", "generic", "video", "a2"]);
  });

  it("lists a frame between the controls around it", async () => {
    const { dom, real } = await both(
      `<button data-t="before">before</button>${FRAME()}<button data-t="after">after</button>`,
    );
    expect(dom).toEqual(["before", "if", "after"]);
    expect(real[0]).toBe("before");
    expect(real).toContain("after");
  });

  it("lists a frame holding three buttons once", async () => {
    const { dom } = await both(
      `<button data-t="before">before</button><iframe srcdoc="<button>1</button><button>2</button><button>3</button>" title="if" data-t="if"></iframe><button data-t="after">after</button>`,
    );
    expect(dom).toEqual(["before", "if", "after"]);
  });

  it.each([
    ["text only", `<iframe srcdoc="text" title="if" data-t="if"></iframe>`],
    ["about:blank", `<iframe title="if" data-t="if"></iframe>`],
  ])("lists an empty frame (%s) once", async (_name, frame) => {
    const { dom } = await both(
      `<button data-t="before">before</button>${frame}<button data-t="after">after</button>`,
    );
    expect(dom).toEqual(["before", "if", "after"]);
  });

  it.each([
    ["tabindex=-1", `tabindex="-1"`],
    ["inert", `inert`],
    ["visibility:hidden", `style="visibility:hidden"`],
    ["display:contents", `style="display:contents"`],
  ])("leaves a frame out with %s", async (_name, attrs) => {
    const { dom, real } = await both(
      `<button data-t="before">before</button>${FRAME(attrs)}<button data-t="after">after</button>`,
    );
    expect(dom).toEqual(["before", "after"]);
    expect(real).toEqual(["before", "after"]);
  });

  it("sorts a frame with a positive tabindex first", async () => {
    const { dom } = await both(
      `<button data-t="b1">b1</button>${FRAME(`tabindex="1"`)}<button data-t="b2">b2</button>`,
    );
    expect(dom).toEqual(["if", "b1", "b2"]);
  });

  it("keeps a role=presentation frame and an aria-disabled one a stop", async () => {
    const pres = await both(
      `<button data-t="before">before</button>${FRAME(`role="presentation"`)}<button data-t="after">after</button>`,
    );
    expect(pres.dom).toEqual(["before", "if", "after"]);
    const dis = await both(
      `<button data-t="before">before</button><div aria-disabled="true">${FRAME()}</div><button data-t="after">after</button>`,
    );
    expect(dis.dom).toEqual(["before", "if", "after"]);
  });

  it.each([
    ["an HTML document", HTML_DOC, true],
    ["an SVG document", SVG_DOC, true],
    ["a PNG", PNG, false],
  ])("treats an object showing %s", async (_name, data, stop) => {
    const { dom } = await both(
      `<button data-t="before">before</button><object data="${data}" data-t="generic"></object><button data-t="after">after</button>`,
    );
    expect(dom).toEqual(
      stop ? ["before", "generic", "after"] : ["before", "after"],
    );
  });

  it("leaves out an object with no data, and keeps a failed one's fallback", async () => {
    const none = await both(
      `<button data-t="before">before</button><object data-t="generic">text</object><button data-t="after">after</button>`,
    );
    expect(none.dom).toEqual(["before", "after"]);
    const failed = await both(
      `<button data-t="before">before</button><object data="http://127.0.0.1:1/x.html" data-t="generic"><button data-t="fb">fb</button></object><button data-t="after">after</button>`,
    );
    expect(failed.dom).toContain("fb");
    expect(failed.dom).not.toContain("generic");
  });

  it("knows a difference: a keyboard-focusable scroller is not listed yet", async () => {
    // Chromium tabs to a scroller with no focusable child. Tracked in the
    // "DOM tab sequence skips keyboard-focusable scroll containers" ticket.
    await page.setContent(
      `<div style="overflow:auto;height:40px" data-t="sc"><p style="height:400px">tall</p></div><button data-t="end">end</button>`,
    );
    expect(await domSequence()).toEqual(["end"]);
    expect(await chromiumSequence()).toEqual(["sc", "end"]);
  });
});
