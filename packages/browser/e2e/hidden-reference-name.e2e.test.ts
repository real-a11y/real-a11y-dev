/**
 * A hidden `aria-labelledby` target is read whole, from both producers in real
 * Chromium (accname 1.2 §2A/§2B): when the directly referenced node is hidden,
 * so is every node in its subtree, and all of them still name the widget.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e hidden-reference-name`
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
  id: string | undefined;
  name: string;
  description: string | undefined;
}

/** Name and description of every node with an id, from both producers. */
async function trees(): Promise<{ dom: Seen[]; native: Seen[] }> {
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<
          string,
          {
            dom?: { attributes: Record<string, string> };
            a11y: { name: string; description?: string };
          }
        >;
      };
    };
    return Array.from(ra.extractA11yTree(document.body).nodes.values()).map(
      (n) => ({
        id: n.dom?.attributes["id"],
        name: n.a11y.name,
        description: n.a11y.description,
      }),
    );
  });
  const native = Array.from((await nativeTree(page)).nodes.values()).map(
    (n) => ({
      id: n.dom?.attributes["id"],
      name: n.a11y.name,
      description: n.a11y.description,
    }),
  );
  return { dom, native };
}

const CASES: Array<{ title: string; html: string; id: string; name: string }> =
  [
    {
      title: "a display:none child of a display:none target",
      html: `<span id="l" style="display:none">foo <span style="display:none">bar</span></span><button id="b" aria-labelledby="l">x</button>`,
      id: "b",
      name: "foo bar",
    },
    {
      title: "a target whose text is all in hidden children, over aria-label",
      html: `<button id="b" aria-labelledby="s1" aria-label="foo"><span id="s1" style="display:none;"><span style="display:none;">label</span></span>x</button>`,
      id: "b",
      name: "label",
    },
    {
      title: "a [hidden] child of a [hidden] target",
      html: `<span id="a" hidden>Outer <span hidden>inner</span></span><button id="b" aria-labelledby="a">b</button>`,
      id: "b",
      name: "Outer inner",
    },
    {
      title: "a visible target still drops its hidden child (counter-case)",
      html: `<span id="a">Vis <span style="display:none">gone</span></span><button id="b" aria-labelledby="a">b</button>`,
      id: "b",
      name: "Vis",
    },
    {
      title: "a named link inside a hidden target",
      html: `<span id="a" hidden>Go <a href="/x">to <span hidden>the</span> docs</a></span><button id="b" aria-labelledby="a">b</button>`,
      id: "b",
      name: "Go to the docs",
    },
    {
      title: "a hidden child with no space before it",
      html: `<span id="a" hidden>foo<span hidden>bar</span>baz</span><button id="b" aria-labelledby="a">b</button>`,
      id: "b",
      name: "foo bar baz",
    },
  ];

describe("a hidden aria-labelledby target", () => {
  for (const c of CASES) {
    it(`names the widget from ${c.title}`, async () => {
      await page.setContent(c.html);
      const { dom, native } = await trees();
      expect(dom.find((n) => n.id === c.id)?.name).toBe(c.name);
      expect(native.find((n) => n.id === c.id)?.name).toBe(c.name);
    });
  }

  it("reads the same subtree into an aria-describedby description", async () => {
    await page.setContent(
      `<span id="d" style="display:none">foo <span style="display:none">bar</span></span><button id="b" aria-describedby="d">x</button>`,
    );
    const { dom, native } = await trees();
    expect(dom.find((n) => n.id === "b")?.description).toBe("foo bar");
    expect(native.find((n) => n.id === "b")?.description).toBe("foo bar");
  });
});
