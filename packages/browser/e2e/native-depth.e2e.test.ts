/**
 * A page nested past ~150 levels, from both producers in real Chromium.
 *
 * `DOM.getDocument({ depth: -1 })` nests two JSON levels per DOM level and
 * Chromium's CDP writer stops at 300, so the native producer's single nested
 * read rejected ("CBOR: stack limit exceeded") even though
 * `Accessibility.getFullAXTree` was fine. The DOM producer was never affected.
 * The chain is script-built: the HTML parser caps its own nesting at 512.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e native-depth`
 */

import {
  BrowserSession,
  nativeTree,
  pageBundleSource,
} from "@real-a11y-dev/browser";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DEPTH = 160;
const SECRET = "hunter2-DEEP-SECRET";

const FIXTURE = `<!doctype html><title>Deep ${DEPTH}</title>
<main>
  <h1>Deep page</h1>
  <div id="root"></div>
  <a href="#after">After the chain</a>
</main>
<script>
  let cur = document.getElementById("root");
  for (let i = 0; i < ${DEPTH}; i++) {
    const d = document.createElement("div");
    cur.appendChild(d);
    cur = d;
  }
  const b = document.createElement("button");
  b.id = "deep-button";
  b.textContent = "Deep button";
  cur.appendChild(b);
  const pw = document.createElement("input");
  pw.type = "password";
  pw.setAttribute("aria-label", "Deep password");
  pw.value = "${SECRET}";
  cur.appendChild(pw);
</script>`;

const session = new BrowserSession({ headless: true });
let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent(FIXTURE);
  await session.open("data:text/html," + encodeURIComponent(FIXTURE));
});

afterAll(async () => {
  await browser.close();
  await session.close();
});

describe("a page nested past the CDP serializer's depth limit", () => {
  it("the nested DOM.getDocument read really does fail here", async () => {
    // Guards the premise: if Chromium stops failing, the rest proves nothing.
    const client = await page.context().newCDPSession(page);
    try {
      await expect(
        client.send("DOM.getDocument", { depth: -1, pierce: true }),
      ).rejects.toThrow(/stack limit/);
    } finally {
      await client.detach();
    }
  });

  it("both producers reach the button", async () => {
    await page.addScriptTag({ content: pageBundleSource() });
    const domNames = await page.evaluate(() => {
      const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
        extractA11yTree(root: Element): {
          nodes: Map<string, { a11y: { role: string; name: string } }>;
        };
      };
      return [...ra.extractA11yTree(document.body).nodes.values()].map(
        (n) => `${n.a11y.role} ${n.a11y.name}`,
      );
    });
    expect(domNames).toContain("button Deep button");

    const tree = await nativeTree(page);
    expect(tree.source?.producer).toBe("native");
    const native = [...tree.nodes.values()];
    const button = native.find(
      (n) => n.a11y.role === "button" && n.a11y.name === "Deep button",
    );
    expect(button).toBeDefined();
    expect(
      native.some(
        (n) => n.a11y.role === "link" && n.a11y.name === "After the chain",
      ),
    ).toBe(true);
    // The enrichment survived the flat read: attributes and a locator.
    expect(button?.dom?.attributes["id"]).toBe("deep-button");
    expect(button?.dom?.locator).toBe("#deep-button");
  });

  it("never puts the password's value in the native tree", async () => {
    const tree = await nativeTree(page);
    expect(JSON.stringify([...tree.nodes.values()])).not.toContain(SECRET);
    const view = await session.nativeAX();
    expect(JSON.stringify(view)).not.toContain(SECRET);
  });

  it("nativeAXViewOf reads the deep page", async () => {
    const { tree } = await session.nativeAX();
    expect(tree).toContain("Deep button");
  });
});
