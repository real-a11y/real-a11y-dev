/**
 * A form control an aria-labelledby or aria-describedby reference points at
 * lends its own name, and an empty field lends its name to a name it sits in,
 * from both producers in real Chromium.
 *
 * `<button aria-labelledby="c">Toggle</button>` over `<label for="c">Checkbox
 * Label Text</label><input type="checkbox" id="c">` is "Checkbox Label Text"
 * in Chromium; the DOM producer read "Toggle". The jsdom cases live in core's
 * `labelledby-control.test.ts`; this pins them to Chromium's raw CDP tree.
 *
 * Gaps left as they are, each its own change: a hidden `<label for>` names a
 * control in the DOM producer but not in Chromium; Chromium names a `<button>`
 * from its `<label for>`; a file input lends Chromium's own "No file chosen";
 * Chromium gives an ARIA slider or spinbutton with no value a default one.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e labelledby-control`
 */

import { REDACTED_VALUE } from "@real-a11y-dev/core";
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
 * One case per entry: `markup(c)` holds the target with id `c`, which a
 * button `b-<key>` is labelled by and a button `d-<key>` described by.
 */
type Case = [key: string, markup: (c: string) => string];

function page_(cases: Case[]): string {
  return cases
    .map(
      ([key, markup]) =>
        `<div>${markup(`c-${key}`)}` +
        `<button id="b-${key}" aria-labelledby="c-${key}">Toggle</button>` +
        `<button id="d-${key}" aria-describedby="c-${key}">Go</button></div>`,
    )
    .join("");
}

// The finding's two repro tables.
const REPRO: Case[] = [
  [
    "cb-for",
    (c) =>
      `<label for="${c}">Checkbox Label Text</label><input type="checkbox" id="${c}">`,
  ],
  [
    "radio-for",
    (c) =>
      `<label for="${c}">Radio Label Text</label><input type="radio" id="${c}">`,
  ],
  ["wrapped", (c) => `<label>Wrapped Label <input id="${c}"></label>`],
  ["value", (c) => `<input id="${c}" value="typed">`],
  ["textarea-ph", (c) => `<textarea id="${c}" placeholder="Reply"></textarea>`],
  ["title", (c) => `<input id="${c}" title="Email">`],
  [
    "select",
    (c) =>
      `<select id="${c}"><option>Alpha</option><option selected>Beta</option></select>`,
  ],
  [
    "fieldset",
    (c) => `<fieldset id="${c}"><legend>Legend text</legend><input></fieldset>`,
  ],
  [
    "table",
    (c) => `<table id="${c}"><caption>Cap</caption><tr><td>A</td></tr></table>`,
  ],
  ["svg", (c) => `<svg id="${c}"><title>Shape</title><circle r="4"/></svg>`],
];

const ORDER: Case[] = [
  [
    "for-value",
    (c) => `<label for="${c}">Lab</label><input id="${c}" value="typed">`,
  ],
  ["wrap-value", (c) => `<label>Lab <input id="${c}" value="typed"></label>`],
  [
    "in-al",
    (c) => `<label for="${c}">Lab</label><input id="${c}" aria-label="AL">`,
  ],
  [
    "label-title",
    (c) => `<label for="${c}">Lab</label><input id="${c}" title="T">`,
  ],
  [
    "label-ph",
    (c) => `<label for="${c}">Lab</label><input id="${c}" placeholder="P">`,
  ],
  ["title-ph", (c) => `<input id="${c}" title="T" placeholder="P">`],
  [
    "ta-label",
    (c) => `<label for="${c}">Lab</label><textarea id="${c}"></textarea>`,
  ],
  ["cb-title", (c) => `<input type="checkbox" id="${c}" title="Agree">`],
  [
    "two-labels",
    (c) =>
      `<label for="${c}">One</label><label for="${c}">Two</label><input type="checkbox" id="${c}">`,
  ],
  [
    "for-and-wrap",
    (c) =>
      `<label for="${c}">One</label><label>Two <input type="checkbox" id="${c}"></label>`,
  ],
  [
    "label-embeds",
    (c) =>
      `<label for="${c}">Flash <input value="3"> times</label><input type="checkbox" id="${c}">`,
  ],
  [
    "label-embeds-empty",
    (c) =>
      `<label for="${c}">Name <input placeholder="P"></label><input type="checkbox" id="${c}">`,
  ],
  [
    "nested-lb",
    (c) =>
      `<span id="o-${c}">Other</span><label for="${c}">Lab</label><input type="checkbox" id="${c}" aria-labelledby="o-${c}">`,
  ],
  [
    "hidden-target",
    (c) =>
      `<label for="${c}">Lab</label><input type="checkbox" id="${c}" hidden>`,
  ],
  ["submit", (c) => `<input type="submit" id="${c}" value="Send">`],
  ["submit-default", (c) => `<input type="submit" id="${c}">`],
  ["submit-title", (c) => `<input type="submit" id="${c}" title="T">`],
  ["image-alt", (c) => `<input type="image" id="${c}" alt="Go">`],
  ["image-title", (c) => `<input type="image" id="${c}" title="T">`],
  ["image-none", (c) => `<input type="image" id="${c}">`],
  ["button-title", (c) => `<button id="${c}" title="T">Go</button>`],
  ["button-empty-title", (c) => `<button id="${c}" title="T"></button>`],
  [
    "output-label",
    (c) => `<label for="${c}">Total</label><output id="${c}">42</output>`,
  ],
  ["output-title", (c) => `<output id="${c}" title="T">42</output>`],
  [
    "meter-label",
    (c) =>
      `<label for="${c}">Disk</label><meter id="${c}" value="0.6"></meter>`,
  ],
  [
    "progress-label",
    (c) => `<label for="${c}">Load</label><progress id="${c}"></progress>`,
  ],
  [
    "date-label",
    (c) =>
      `<label for="${c}">Day</label><input type="date" id="${c}" value="1991-09-10">`,
  ],
  [
    "listbox-select",
    (c) =>
      `<label for="${c}">Lab</label><select id="${c}" size="3"><option>A</option></select>`,
  ],
  [
    "aria-listbox",
    (c) =>
      `<ul role="listbox" id="${c}" aria-label="AL"><li role="option">A</li></ul>`,
  ],
  [
    "input-combobox",
    (c) => `<input role="combobox" id="${c}" aria-label="AL">`,
  ],
  ["span-title", (c) => `<span id="${c}" title="T"></span>`],
  ["span-title-content", (c) => `<span id="${c}" title="T">content</span>`],
  // Content that is only whitespace, or only an empty box's spacing, names
  // nothing, so the title still does.
  ["span-title-space", (c) => `<span id="${c}" title="T"> </span>`],
  ["span-title-block", (c) => `<span id="${c}" title="T"><div></div></span>`],
  [
    "div-title-blocks",
    (c) => `<div id="${c}" title="T"><div></div> <div></div></div>`,
  ],
  [
    "aria-checkbox-title",
    (c) => `<div role="checkbox" id="${c}" tabindex="0" title="T"></div>`,
  ],
  ["empty", (c) => `<input id="${c}">`],
  ["checkbox-bare", (c) => `<input type="checkbox" id="${c}">`],
  // Chromium lends an empty single select's or ARIA text field's chosen
  // value and stops there: these fall back to "Toggle".
  ["select-empty-al", (c) => `<select id="${c}" aria-label="Pick"></select>`],
  [
    "select-empty-label",
    (c) => `<label for="${c}">Lab</label><select id="${c}" title="T"></select>`,
  ],
  [
    "aria-combobox-al",
    (c) => `<div role="combobox" id="${c}" tabindex="0" aria-label="AL"></div>`,
  ],
  [
    "aria-textbox-al",
    (c) => `<div role="textbox" id="${c}" aria-label="AL"></div>`,
  ],
];

// An empty field lends its name to the name it sits in.
const EMBEDDED = `
  <h2 id="h-ph">Save <input placeholder="P"> now</h2>
  <h2 id="h-title">Save <input title="T"> now</h2>
  <h2 id="h-al">Save <input aria-label="AL"> now</h2>
  <h2 id="h-ta">Save <textarea placeholder="P"></textarea> now</h2>
  <label for="h-ta-l-i">Lab</label><h2 id="h-ta-l">Save <textarea id="h-ta-l-i"></textarea> now</h2>
  <span id="h-lb-x">X</span><h2 id="h-lb">Save <input aria-labelledby="h-lb-x"> now</h2>
  <button id="h-lb-ref" aria-labelledby="h-lb">b</button>
  <h2 id="h-color">Save <input type="color" title="T"> now</h2>
  <h2 id="h-date">Save <input type="date" aria-label="AL" value="1991-09-10"> now</h2>
  <h2 id="h-lbsel">Save <select size="3" aria-label="AL"><option>A</option></select> now</h2>
  <h2 id="h-aria-lb">Save <ul role="listbox" aria-label="AL"><li role="option">A</li></ul> now</h2>
  <h2 id="h-progress">Save <progress aria-label="AL"></progress> now</h2>
  <h2 id="h-number">Save <input type="number" aria-label="AL"> now</h2>
  <h2 id="h-combo">Save <input role="combobox" aria-label="AL"> now</h2>
  <h2 id="h-search">Save <input type="search" title="T" placeholder="P"> now</h2>
  <h2 id="h-pw">Save <input type="password" placeholder="P"> now</h2>
  <h2 id="h-select-empty">Save <select aria-label="AL"></select> now</h2>
  <h2 id="h-div-combo">Save <div role="combobox" tabindex="0" aria-label="AL"></div> now</h2>
  <h2 id="h-ce">Save <span role="textbox" contenteditable tabindex="0" aria-label="AL"></span> now</h2>
  <label><input type="checkbox" id="h-label"> Flash <input aria-label="n"> times</label>
  <label>Name <input id="h-own" placeholder="P"></label>
`;

const keys = (cases: Case[]) => cases.map(([key]) => key);

describe("a referenced form control's own name, against Chromium", () => {
  it("names the finding's repro cases as Chromium does", async () => {
    await page.setContent(page_(REPRO));
    const [dom, native, raw] = [
      await domById(page, false),
      await nativeById(page, false),
      await rawById(page),
    ];
    expect(raw["b-cb-for"]?.name).toBe("Checkbox Label Text");
    for (const key of keys(REPRO)) {
      expect(dom[`b-${key}`]?.name, `dom ${key}`).toBe(raw[`b-${key}`]?.name);
      expect(native[`b-${key}`]?.name, `native ${key}`).toBe(
        raw[`b-${key}`]?.name,
      );
      expect(dom[`d-${key}`]?.description, `dom desc ${key}`).toBe(
        raw[`d-${key}`]?.description,
      );
    }
  });

  it("orders a target's sources as Chromium does", async () => {
    await page.setContent(page_(ORDER));
    const [dom, raw] = [await domById(page, false), await rawById(page)];
    expect(raw["b-select-empty-al"]?.name).toBe("Toggle");
    for (const key of keys(ORDER)) {
      expect(dom[`b-${key}`]?.name, key).toBe(raw[`b-${key}`]?.name);
      expect(dom[`d-${key}`]?.description, `desc ${key}`).toBe(
        raw[`d-${key}`]?.description,
      );
    }
  });

  it("lends an empty embedded field's name as Chromium does", async () => {
    await page.setContent(EMBEDDED);
    const [dom, raw] = [await domById(page, false), await rawById(page)];
    expect(raw["h-ph"]?.name).toBe("Save P now");
    // Each host, not the span or field a host points at.
    const ids = [...EMBEDDED.matchAll(/ id="(h-[a-z-]+)"/g)]
      .map((m) => m[1]!)
      .filter((id) => !/-(x|i)$/.test(id));
    for (const id of ids) {
      expect(dom[id]?.name, id).toBe(raw[id]?.name);
    }
  });

  it("keeps a name read from markup alone in strict mode, and withholds a value, as native does", async () => {
    const strict: Case[] = [
      ...REPRO.slice(0, 3),
      ["textarea-ph", REPRO[4]![1]],
      [
        "pw-empty",
        (c) =>
          `<label for="${c}">Password</label><input type="password" id="${c}">`,
      ],
      [
        "pw-value",
        (c) =>
          `<label for="${c}">Password</label><input type="password" id="${c}" value="hunter2">`,
      ],
      ["for-value", ORDER[0]![1]],
    ];
    // A value in the label of the control a reference names. The native
    // producer prints Chromium's name for that reference whole, value and
    // all, a gap of its own; the DOM producer withholds it.
    const reached: Case[] = [
      ["label-embeds", ORDER[10]![1]],
      [
        "label-otp",
        (c) =>
          `<label for="${c}">Code <input autocomplete="one-time-code" value="482913"></label><input type="checkbox" id="${c}">`,
      ],
    ];
    await page.setContent(
      page_([...strict, ...reached]) +
        `<h2 id="h-ph">Save <input placeholder="P"> now</h2>`,
    );
    for (const redactInput of [false, true]) {
      const [dom, native] = [
        await domById(page, redactInput),
        await nativeById(page, redactInput),
      ];
      const at = `strict: ${redactInput}`;
      for (const id of [...keys(strict).map((key) => `b-${key}`), "h-ph"]) {
        expect(dom[id]?.name, `${id} (${at})`).toBe(native[id]?.name);
      }
      expect(dom["b-pw-value"]?.name, at).toBe(REDACTED_VALUE);
      expect(dom["b-cb-for"]?.name, at).toBe("Checkbox Label Text");
      expect(dom["h-ph"]?.name, at).toBe("Save P now");
      expect(dom["b-label-otp"]?.name, at).toBe(REDACTED_VALUE);
      expect(dom["d-label-otp"]?.description, at).toBe("");
      expect(dom["b-label-embeds"]?.name, at).toBe(
        redactInput ? REDACTED_VALUE : "Flash 3 times",
      );
      if (redactInput) {
        expect(dom["b-for-value"]?.name).toBe(REDACTED_VALUE);
      }
    }
  });
});
