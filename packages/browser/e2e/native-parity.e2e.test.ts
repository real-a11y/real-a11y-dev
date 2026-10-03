/**
 * End-to-end DOM↔native parity harness (RFC PR E).
 *
 * For each corpus page it loads real Chromium once and serializes it two ways —
 * the DOM producer (the injected page-bundle) and the native producer
 * (`BrowserSession.nativeTree()`, which reads Chromium's own AX tree over CDP)
 * — then measures how much of the DOM tree the native tree covers. This is the
 * gate the RFC requires before defaulting any surface to native: the producers
 * are never byte-identical, so we assert an overlap FLOOR (and log the actual)
 * rather than equality.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e`
 * (needs a Chromium binary: `pnpm exec playwright install chromium`).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BrowserSession,
  nativeTree,
  pageBundleSource,
} from "@real-a11y-dev/browser";
import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";
import { serializeTree } from "@real-a11y-dev/serialize";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { computeParity } from "./parity.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The bar to beat, and the hard floor. Spike 4 measured ~89% role+name overlap
 * on the app-shell corpus; the product producers land in the same range. The
 * floor is set conservatively below the observed watermark so ordinary
 * Chromium-milestone drift doesn't flake the gate, while a real regression
 * (the native normalizer dropping a whole class of nodes) still trips it.
 * Tighten toward the watermark as the corpus and normalizer stabilize.
 */
const PARITY_FLOOR = 0.8;

/** Corpus of fixture pages. Grow this — iframes, portals, virtualized lists,
 *  contenteditable — per the RFC backlog; each new page tightens the gate. */
const CORPUS = [
  { name: "app-shell", file: "app-shell.html" },
  { name: "web-components", file: "web-components.html" },
] as const;

function dataUrl(html: string): string {
  return "data:text/html," + encodeURIComponent(html);
}

const session = new BrowserSession({ headless: true });

beforeAll(async () => {
  // Nothing global; each test opens its own page through the shared session.
});

afterAll(async () => {
  await session.close();
});

describe("DOM ↔ native parity (corpus)", () => {
  for (const page of CORPUS) {
    it(`covers the DOM tree on "${page.name}" (overlap ≥ ${PARITY_FLOOR})`, async () => {
      const html = readFileSync(join(here, "corpus", page.file), "utf8");
      await session.open(dataUrl(html));

      // DOM producer (page-bundle) and native producer (CDP), both serialized
      // to the same `role "name"` shape with no focus marker (native carries
      // none, so a marker on the DOM side would read as a spurious divergence).
      const domTree = await session.call<string>("treeSnapshot", "body", [
        { markFocus: false },
      ]);
      const native = await session.nativeTree();
      const nativeTree = serializeTree(native, { markFocus: false });

      const report = computeParity(domTree, nativeTree);

      // Always surface the breakdown so CI logs the watermark over time.
      console.log(
        [
          "",
          `===== PARITY: ${page.name} =====`,
          `dom pairs: ${report.domCount}  native pairs: ${report.nativeCount}  shared: ${report.shared}`,
          `overlap vs dom: ${(report.overlap * 100).toFixed(1)}%  (floor ${(PARITY_FLOOR * 100).toFixed(0)}%)`,
          report.onlyDom.length
            ? `only-dom (${report.onlyDom.length}): ${report.onlyDom.slice(0, 12).join(", ")}`
            : "only-dom: (none)",
          report.onlyNative.length
            ? `only-native (${report.onlyNative.length}): ${report.onlyNative.slice(0, 12).join(", ")}`
            : "only-native: (none)",
        ].join("\n"),
      );

      expect(native.source.producer).toBe("native");
      expect(report.overlap).toBeGreaterThanOrEqual(PARITY_FLOOR);
    });
  }
});

describe("nativeAX() ↔ nativeTree() (one native vocabulary)", () => {
  // Both read the same `getFullAXTree`; both must normalize it with core's
  // shared vocabulary. `nativeAX()` once carried a private copy of the tables
  // that drifted (dropped named generics, unmapped Video/Audio), so the two
  // native views of one page disagreed about what was on it.
  for (const page of CORPUS) {
    it(`agree on every node of "${page.name}"`, async () => {
      const html = readFileSync(join(here, "corpus", page.file), "utf8");
      await session.open(dataUrl(html));

      const { tree, pairs } = await session.nativeAX();
      const native = await session.nativeTree();
      const fromTree = [...native.nodes.values()]
        .filter((n) => n.id !== "ax-root")
        .map((n) =>
          n.a11y.name ? `${n.a11y.role} "${n.a11y.name}"` : n.a11y.role,
        );

      expect(pairs).toEqual(tree.split("\n").map((l) => l.trim()));
      expect([...pairs].sort()).toEqual(fromTree.sort());
    });
  }
});

// ARIA 1.3's `image` is a synonym of `img`: Chromium exposes both as its one
// image role, and neither takes a name from its content. The DOM producer once
// kept the raw token and named it by its text — `image "🎉"` against native's
// bare `img` — so the image-alt audit never saw it.
describe("the img synonym role=image", () => {
  it("is an unnamed img in both producers", async () => {
    await session.open(
      dataUrl(
        `<main><span role="image">🎉</span><button role="image">🎊</button><span role="image" aria-label="Party">🥳</span></main>`,
      ),
    );
    const domTree = await session.call<string>("treeSnapshot", "body", [
      { markFocus: false },
    ]);
    const nativeTree = serializeTree(await session.nativeTree(), {
      markFocus: false,
    });

    for (const tree of [domTree, nativeTree]) {
      const lines = tree.split("\n").map((l) => l.trim());
      expect(lines.filter((l) => l === "img")).toHaveLength(2);
      expect(lines).toContain('img "Party"');
      expect(tree).not.toMatch(/\bimage\b/);
      expect(tree).not.toMatch(/🎉|🎊/);
    }
  });
});

// An input whose `list` names a <datalist> is a combobox in Chromium's tree
// for the text, number, date and time types. The DOM producer once ignored
// `list`, so every one of them read as a textbox (or a searchbox, or a
// spinbutton) there and a combobox in native.
describe("an input whose list names a <datalist>", () => {
  it("has the same role in both producers", async () => {
    const field = (label: string, attrs: string) =>
      `<input ${attrs} aria-label="${label}">`;
    await session.open(
      dataUrl(
        `<main>
          <datalist id="dl"><option value="a"></datalist>
          ${field("Text", 'list="dl"')}
          ${field("Search", 'type="search" list="dl"')}
          ${field("Email", 'type="email" list="dl"')}
          ${field("Tel", 'type="tel" list="dl"')}
          ${field("Url", 'type="url" list="dl"')}
          ${field("Number", 'type="number" list="dl"')}
          ${field("Date", 'type="date" list="dl"')}
          ${field("Time", 'type="time" list="dl"')}
          ${field("Later", 'list="later"')}
          ${field("Missing", 'list="nope"')}
          ${field("Search missing", 'type="search" list="nope"')}
          ${field("Not a datalist", 'list="adiv"')}
          ${field("Password", 'type="password" list="dl"')}
          ${field("Range", 'type="range" list="dl"')}
          ${field("Authored", 'list="dl" role="textbox"')}
          <div id="adiv">x</div>
          <div id="host"></div>
          <datalist id="later"></datalist>
        </main>
        <script>
          document.getElementById("host").attachShadow({ mode: "open" }).innerHTML =
            '<input list="dl" aria-label="Across a shadow root">' +
            '<input list="own" aria-label="Inside a shadow root"><datalist id="own"></datalist>';
        </script>`,
      ),
    );
    const domTree = await session.call<string>("treeSnapshot", "body", [
      { markFocus: false },
    ]);
    const nativeTree = serializeTree(await session.nativeTree(), {
      markFocus: false,
    });

    for (const tree of [domTree, nativeTree]) {
      const lines = tree.split("\n").map((l) => l.trim());
      const roleOf = (name: string) =>
        lines.find((l) => l.endsWith(`"${name}"`))?.split(" ")[0];
      for (const name of [
        "Text",
        "Search",
        "Email",
        "Tel",
        "Url",
        "Number",
        "Date",
        "Time",
        "Later",
        "Inside a shadow root",
      ]) {
        expect(roleOf(name), name).toBe("combobox");
      }
      expect(roleOf("Missing")).toBe("textbox");
      expect(roleOf("Search missing")).toBe("searchbox");
      expect(roleOf("Not a datalist")).toBe("textbox");
      expect(roleOf("Password")).toBe("textbox");
      expect(roleOf("Range")).toBe("slider");
      expect(roleOf("Authored")).toBe("textbox");
      expect(roleOf("Across a shadow root")).toBe("textbox");
    }
  });
});

// Only a drop-down has a picker for `expanded` to describe: collapsed while it
// is closed and expanded while it is open, whatever aria-expanded says. On a
// list box, the combobox role is the author's and reads aria-expanded like any
// other. The DOM tree's states don't cross `session.call()`, so one page of
// our own feeds both producers.
describe("a combobox <select>'s expanded state follows its picker", () => {
  it("agrees in both producers", async () => {
    const listBox = { absent: undefined, true: true, false: false };
    const dropDown = { absent: false, true: false, false: false };
    const shapes = [
      ["multiple", listBox],
      ["size=3", listBox],
      ["size=1", dropDown],
      ["size=0", dropDown],
      ["multiple size=1", dropDown],
    ] as const;
    const want: Record<string, boolean | undefined> = {};
    let selects = "";
    for (const [attrs, states] of shapes) {
      for (const [state, expanded] of Object.entries(states)) {
        const name = `${attrs}, aria-expanded ${state}`;
        const aria = state === "absent" ? "" : ` aria-expanded="${state}"`;
        selects += `<select aria-label="${name}" ${attrs} role="combobox"${aria}><option>o</option></select>`;
        want[name] = expanded;
      }
    }

    const expandedByName = (nodes: Iterable<SemanticNode>) =>
      Object.fromEntries(
        [...nodes]
          .filter((n) => n.a11y.role === "combobox")
          .map((n) => [n.a11y.name, n.a11y.states.expanded]),
      );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`<main>${selects}</main>`);
      await page.addScriptTag({ content: pageBundleSource() });
      const bothReport = async (expected: typeof want) => {
        const dom = await page.evaluate(() => {
          const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
            extractA11yTree(root: Element): ExtractionResult;
          };
          return [...ra.extractA11yTree(document.body).nodes.values()];
        });
        const native = await nativeTree(page);
        // Strict, so a select missing from a tree can't pass as "unset".
        expect(expandedByName(native.nodes.values())).toStrictEqual(expected);
        expect(expandedByName(dom)).toStrictEqual(expected);
      };

      // Every picker closed.
      await bothReport(want);

      // A click opens a drop-down's picker, which expands it even against
      // aria-expanded="false". A list box has no picker, so it stays as it was.
      for (const [attrs, states] of shapes) {
        const name = `${attrs}, aria-expanded false`;
        await page.click(`select[aria-label="${name}"]`);
        await bothReport({
          ...want,
          [name]: states === dropDown || want[name],
        });
        await page.keyboard.press("Escape");
      }
    } finally {
      await browser.close();
    }
  });
});

// A <select> showing more than one row is a listbox in Chromium's tree, and
// one showing a single row is a drop-down combobox, `multiple` or not. The DOM
// producer once keyed on `multiple` alone, so `size="3"` read as a combobox
// and `multiple size="1"` as a listbox.
describe("a <select>'s role follows the rows it shows", () => {
  it("agrees in both producers", async () => {
    await session.open(
      dataUrl(
        `<main>
          <select aria-label="Plain"><option>o</option></select>
          <select aria-label="Three rows" size="3"><option>o</option></select>
          <select aria-label="Parsed rows" size=" 2abc"><option>o</option></select>
          <select aria-label="Zero rows" size="0"><option>o</option></select>
          <select aria-label="Many" multiple><option>o</option></select>
          <select aria-label="One row of many" multiple size="1"><option>o</option></select>
        </main>`,
      ),
    );
    const domTree = await session.call<string>("treeSnapshot", "body", [
      { markFocus: false },
    ]);
    const nativeTree = serializeTree(await session.nativeTree(), {
      markFocus: false,
    });

    for (const tree of [domTree, nativeTree]) {
      const lines = tree.split("\n").map((l) => l.trim());
      const roleOf = (name: string) =>
        lines.find((l) => l.includes(`"${name}"`))?.split(" ")[0];
      expect(roleOf("Plain")).toBe("combobox");
      expect(roleOf("Three rows")).toBe("listbox");
      expect(roleOf("Parsed rows")).toBe("listbox");
      expect(roleOf("Zero rows")).toBe("combobox");
      expect(roleOf("Many")).toBe("listbox");
      expect(roleOf("One row of many")).toBe("combobox");
    }
  });
});

// Chromium resolves `role` to the first token it recognises — skipping unknown
// and abstract ones, folding case — and drops a listitem, option or treeitem
// outside its required context, for the next token or the element's own role.
// The DOM producer once kept whatever the first token said: `foo "Save"`,
// `listitem` outside any list, `option` inside a list.
describe("roles Chromium discards", () => {
  it("are discarded by both producers", async () => {
    await session.open(
      dataUrl(
        `<main>` +
          `<div role="foo button" tabindex="0">Save</div>` +
          `<div role="widget link" tabindex="0">Docs</div>` +
          `<div role="BUTTON" tabindex="0">Upper</div>` +
          `<div role="directory" aria-label="Dir"><div role="listitem">x</div></div>` +
          `<div role="list" aria-label="Broken"><section><div role="listitem"><a href="#a">A</a></div></section></div>` +
          `<div role="listbox" aria-label="Fruit"><div role="option" aria-selected="false">Apple</div></div>` +
          `<ul role="list" aria-label="Not a listbox"><li role="option"><a href="#s">Spain</a></li></ul>` +
          `<button><span role="option">Apple</span> pie</button>` +
          `<ul role="none"><li><a href="#h">Home</a></li></ul>` +
          `</main>`,
      ),
    );
    const domTree = await session.call<string>("treeSnapshot", "body", [
      { markFocus: false },
    ]);
    const nativeTree = serializeTree(await session.nativeTree(), {
      markFocus: false,
    });

    for (const [producer, tree] of [
      ["dom", domTree],
      ["native", nativeTree],
    ]) {
      const lines = tree.split("\n").map((l) => l.trim());
      const roles = (role: string) =>
        lines.filter((l) => l === role || l.startsWith(`${role} `));
      expect(lines, producer).toContain('button "Save"');
      expect(lines, producer).toContain('link "Docs"');
      expect(lines, producer).toContain('button "Upper"');
      expect(lines, producer).toContain('list "Dir"');
      expect(lines, producer).toContain('option "Apple"');
      expect(lines, producer).toContain('button "Apple pie"');
      // The directory's item, and the <li role="option"> back on its own role.
      expect(roles("listitem"), producer).toHaveLength(2);
      expect(roles("option"), producer).toHaveLength(1);
      expect(tree, producer).not.toMatch(/\b(foo|widget|directory|BUTTON)\b/);
    }
  });
});

// The DOM producer walks the flat tree through open shadow roots and slots,
// as Chromium does. Before that, every node below came from native only.
describe("web components reach the DOM producer", () => {
  it("extracts shadow content, slotted content and shadow-scoped IDREFs", async () => {
    const html = readFileSync(
      join(here, "corpus", "web-components.html"),
      "utf8",
    );
    await session.open(dataUrl(html));
    const domTree = await session.call<string>("treeSnapshot", "body", [
      { markFocus: false },
    ]);
    const nativeTree = serializeTree(await session.nativeTree(), {
      markFocus: false,
    });

    for (const tree of [domTree, nativeTree]) {
      expect(tree).toContain('button "Skip To Content, shortcut Alt + 0"');
      expect(tree).toContain('heading "Card title"');
      expect(tree).toContain('link "Read the docs"');
      expect(tree).toContain('button "Close card"');
      expect(tree).toContain('textbox "Email address"');
      expect(tree).toContain('navigation "Inner"');
      expect(tree).toContain('link "Forwarded link"');
      expect(tree).not.toContain("Unrendered");
      expect(tree).not.toContain("Wrong label");
    }
  });
});
