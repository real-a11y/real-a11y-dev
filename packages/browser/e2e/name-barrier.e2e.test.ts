/**
 * Where name-from-content stops, from both producers in real Chromium.
 *
 * AccName 1.2 §2F recurses into every rendered child; Chromium stops only at
 * container roles (group, menu, tree, listbox, tablist, toolbar, grid, a data
 * table, rowgroup, row, dialog, live regions...) and reads into lists, list
 * items, cells, grid cells, headers and a visible tooltip. This pins the DOM
 * producer to that, name and spacing both, from the native producer and
 * Chromium's raw CDP tree, and a row to being named from its cells only in a
 * grid or treegrid. The deliberate splits are asserted as splits, so a
 * Chromium change shows up here as a failing test.
 *
 * The jsdom cases live in core's `dom-extractor.test.ts`.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e name-barrier`
 */

import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { domById, nativeById, rawById } from "./names-by-id.js";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
});

/**
 * A row outside a grid with a bare text child: the native producer reads it as
 * "Totals" (its own-text fallback names the row), where Chromium and the DOM
 * producer read "". A native-normalizer gap, out of scope here, so the native
 * read is not asserted for these two.
 */
const NATIVE_NAMES_TEXT_ROW = new Set(["table-row-text", "orphan-text"]);

/** id, markup, the name all three read. */
const AGREE: [string, string, string][] = [
  [
    "ul",
    `<button id="ul"><ul><li>One</li><li>Two</li></ul></button>`,
    "One Two",
  ],
  ["li", `<button id="li"><li>One</li><li>Two</li></button>`, "One Two"],
  [
    "inline",
    `<button id="inline"><ul style="display:inline;padding:0"><li style="display:inline">One</li><li style="display:inline">Two</li></ul></button>`,
    "OneTwo",
  ],
  ["dl", `<button id="dl"><dl><dt>T</dt><dd>D</dd></dl></button>`, "T D"],
  ["link", `<a id="link" href="/"><ul><li>x</li></ul></a>`, "x"],
  [
    "label",
    `<input id="label"><label for="label"><ul><li>Lbl</li></ul></label>`,
    "Lbl",
  ],
  [
    "labelledby",
    `<button id="labelledby" aria-labelledby="l">b</button><div id="l"><ul><li>L1</li><li>L2</li></ul></div>`,
    "L1 L2",
  ],
  ["heading", `<h2 id="heading">Items <ul><li>a</li></ul></h2>`, "Items a"],
  [
    "td",
    `<table><tr><th>H</th></tr><tr><td id="td"><ul><li>a</li><li>b</li></ul></td></tr></table>`,
    "a b",
  ],
  [
    "li-label",
    `<button id="li-label">Open <ul><li aria-label="LI">Inner</li></ul></button>`,
    "Open LI",
  ],
  [
    "menu-in-li",
    `<button id="menu-in-li"><ul><li>A<ul role="menu"><li role="menuitem">M</li></ul></li></ul></button>`,
    "A",
  ],
  [
    "tip",
    `<button id="tip">Open<div role="tooltip">Tip text</div></button>`,
    "Open Tip text",
  ],
  [
    "tip-span",
    `<button id="tip-span">Save<span role="tooltip">Saves the file</span></button>`,
    "SaveSaves the file",
  ],
  [
    "tip-described",
    `<button id="tip-described" aria-describedby="t">Save<span role="tooltip" id="t">Tip</span></button>`,
    "SaveTip",
  ],
  [
    "tip-label",
    `<button id="tip-label">Open <div role="tooltip" aria-label="TL">Inner</div></button>`,
    "Open TL",
  ],
  [
    "tip-hidden",
    `<button id="tip-hidden">Save<span role="tooltip" hidden>Tip</span></button>`,
    "Save",
  ],
  [
    "tip-none",
    `<button id="tip-none">Save<span role="tooltip" style="display:none">Tip</span></button>`,
    "Save",
  ],
  // Rows: named from their cells in a grid or treegrid, and only there.
  [
    "grid-row",
    `<table role="grid"><tr id="grid-row"><th>H</th><td>C</td></tr></table>`,
    "H C",
  ],
  [
    "grid-body",
    `<table role="grid"><tbody><tr id="grid-body"><td>A</td><td>B</td></tr></tbody></table>`,
    "A B",
  ],
  [
    "treegrid-row",
    `<table role="treegrid"><tr id="treegrid-row"><td>A</td><td>B</td></tr></table>`,
    "A B",
  ],
  [
    "grid-pres",
    `<table role="grid"><tr id="grid-pres"><td>A</td><td role="presentation">B</td></tr></table>`,
    "A B",
  ],
  [
    "aria-grid",
    `<div role="grid"><div id="aria-grid" role="row"><div role="gridcell">A</div><div role="gridcell">B</div></div></div>`,
    "A B",
  ],
  [
    "aria-grid-group",
    `<div role="grid"><div role="rowgroup"><div id="aria-grid-group" role="row"><div role="gridcell">A</div><div role="gridcell">B</div></div></div></div>`,
    "A B",
  ],
  [
    "aria-treegrid",
    `<div role="treegrid"><div id="aria-treegrid" role="row" aria-level="1"><div role="gridcell">A</div><div role="gridcell">B</div></div></div>`,
    "A B",
  ],
  [
    "grid-headers",
    `<div role="grid"><div id="grid-headers" role="row"><div role="columnheader">H</div><div role="rowheader">R</div><div role="gridcell">C</div></div></div>`,
    "H R C",
  ],
  [
    "grid-checkbox",
    `<div role="grid"><div id="grid-checkbox" role="row"><div role="gridcell"><div role="checkbox"><span>Accept</span></div></div></div></div>`,
    "Accept",
  ],
  [
    "grid-cell-label",
    `<div role="grid"><div id="grid-cell-label" role="row"><div role="gridcell" aria-label="G">A</div><div role="gridcell">B</div></div></div>`,
    "G B",
  ],
  [
    "grid-cell-list",
    `<div role="grid"><div id="grid-cell-list" role="row"><div role="gridcell"><ul><li>a</li><li>b</li></ul></div></div></div>`,
    "a b",
  ],
  [
    "grid-cell-tip",
    `<div role="grid"><div id="grid-cell-tip" role="row"><div role="gridcell">A<span role="tooltip">T</span></div></div></div>`,
    "AT",
  ],
  [
    "grid-text",
    `<div role="grid"><div id="grid-text" role="row"><span>Totals</span></div></div>`,
    "Totals",
  ],
  [
    "grid-label",
    `<div role="grid"><div id="grid-label" role="row" aria-label="Lbl"><span>x</span></div></div>`,
    "Lbl",
  ],
  [
    "data-row",
    `<table><tr id="data-row"><th>H</th><td>C</td></tr></table>`,
    "",
  ],
  [
    "data-row-focus",
    `<table><tr><th>H</th></tr><tr id="data-row-focus" tabindex="0"><td>A</td></tr></table>`,
    "",
  ],
  [
    "table-row",
    `<div role="table"><div id="table-row" role="row"><div role="cell">A</div><div role="cell">B</div></div></div>`,
    "",
  ],
  [
    "table-row-text",
    `<div role="table"><div id="table-row-text" role="row"><span>Totals</span></div></div>`,
    "",
  ],
  [
    "orphan-text",
    `<div id="orphan-text" role="row"><span>Totals</span></div>`,
    "",
  ],
  [
    "orphan-cells",
    `<div id="orphan-cells" role="row"><div role="cell">A</div><div role="cell">B</div></div>`,
    "",
  ],
  [
    "orphan-checkbox",
    `<div id="orphan-checkbox" role="row"><div role="checkbox"><span>Accept</span></div></div>`,
    "",
  ],
  // Containers that stay barriers.
  [
    "data-table",
    `<a id="data-table" href="/"><table><tr><th>H</th></tr><tr><td>Cell</td></tr></table></a>`,
    "",
  ],
  [
    "button-table",
    `<button id="button-table"><table><tr><th>H</th><td>C</td></tr></table></button>`,
    "",
  ],
  [
    "button-grid",
    `<button id="button-grid"><table role="grid"><tr><td>A</td><td>B</td></tr></table></button>`,
    "",
  ],
  [
    "tree-group",
    `<div role="tree"><div id="tree-group" role="treeitem">Reports<div role="group"><div role="treeitem">Q1</div></div></div></div>`,
    "Reports",
  ],
  [
    "menu-nested",
    `<div role="menubar"><div id="menu-nested" role="menuitem">File<div role="menu"><div role="menuitem">New</div></div></div></div>`,
    "File",
  ],
  [
    "option-group",
    `<div role="listbox"><div id="option-group" role="option">Opt<div role="group"><div role="option">Sub</div></div></div></div>`,
    "Opt",
  ],
];

/**
 * A header-less table is a layout table to Chromium, which walks straight
 * through it. The DOM producer keeps `table` a barrier; whether it adopts that
 * heuristic is a role-mapping question, tracked with the layout-table and
 * presentational-table role findings. [id, markup, dom, raw]
 */
const LAYOUT: [string, string, string, string][] = [
  [
    "layout-link",
    `<a id="layout-link" href="/"><table><tr><td>Cell</td></tr></table></a>`,
    "",
    "Cell",
  ],
  [
    "layout-button",
    `<button id="layout-button"><table><tr><td>A</td><td>B</td></tr></table></button>`,
    "",
    "A B",
  ],
];

describe("name-from-content barriers, against Chromium", () => {
  it("reads through lists, cells and tooltips, and stops at containers, as Chromium does", async () => {
    await page.setContent(AGREE.map(([, html]) => html).join("\n"));
    const [dom, native, raw] = [
      await domById(page, false),
      await nativeById(page, false),
      await rawById(page),
    ];
    const wrong: string[] = [];
    for (const [id, , expected] of AGREE) {
      for (const [who, read] of [
        ["raw", raw],
        ["dom", dom],
        ["native", native],
      ] as const) {
        if (who === "native" && NATIVE_NAMES_TEXT_ROW.has(id)) continue;
        if (read[id]?.name !== expected)
          wrong.push(
            `${who} ${id}: ${JSON.stringify(read[id]?.name)} != ${JSON.stringify(expected)}`,
          );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("keeps a header-less table a barrier, where Chromium reads it as a layout table", async () => {
    await page.setContent(LAYOUT.map(([, html]) => html).join("\n"));
    const [dom, raw] = [await domById(page, false), await rawById(page)];
    for (const [id, , domName, rawName] of LAYOUT) {
      expect(dom[id]?.name, `dom ${id}`).toBe(domName);
      expect(raw[id]?.name, `raw ${id}`).toBe(rawName);
    }
  });
});
