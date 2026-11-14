/**
 * An embedded control's value in the name around it (AccName 1.2 step 2C),
 * from both producers in real Chromium.
 *
 * A control the user adjusts lends its value to a name or description it sits
 * in: `<label><input type="checkbox"> Flash the screen <input value="3">
 * times</label>` is checkbox "Flash the screen 3 times". The jsdom cases live
 * in core's `embedded-control.test.ts`; this pins the DOM producer to what
 * Chromium reports, taken from its raw CDP tree and from the native producer,
 * including the spacing around a value, which comes from computed `display`
 * and which jsdom doesn't match.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e embedded-control`
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

const REPRO = `
  <label><input id="r1" type="checkbox"> Flash the screen <input value="3" aria-label="number of times"> times</label>
  <label><input id="r2" type="checkbox"> Flash the screen <span role="textbox" contenteditable tabindex="0" aria-label="n">5</span> times</label>
  <h2 id="r3">Items: <input value="12"></h2>
  <h2 id="r4">Sort by <select><option>Name</option><option selected>Date</option></select></h2>
  <div role="tablist"><div role="tab" id="r5">Tab <input value="x" aria-label="n"></div></div>
  <input id="r6-i" value="hi"><button id="r6" aria-labelledby="r6-i">b</button>
`;

const VARIANTS: [string, string][] = [
  [
    "select",
    `<select><option>One</option><option selected>Two</option></select>`,
  ],
  [
    "select-size",
    `<select size="2"><option>One</option><option selected>Two</option></select>`,
  ],
  ["input-combobox", `<input role="combobox" value="Choice">`],
  ["span-combobox", `<span role="combobox" tabindex="0">Choice</span>`],
  ["div-combobox", `<div role="combobox" tabindex="0">Choice</div>`],
  [
    "aria-listbox",
    `<ul role="listbox"><li role="option">One</li><li role="option" aria-selected="true">Two</li></ul>`,
  ],
  ["range", `<input type="range" min="0" max="10" value="4">`],
  ["number", `<input type="number" value="7">`],
  ["slider-now", `<div role="slider" tabindex="0" aria-valuenow="5"></div>`],
  [
    "slider-text",
    `<div role="slider" tabindex="0" aria-valuenow="5" aria-valuetext="five"></div>`,
  ],
  ["spin-now", `<div role="spinbutton" tabindex="0" aria-valuenow="3"></div>`],
  [
    "spin-text",
    `<div role="spinbutton" tabindex="0" aria-valuenow="3" aria-valuetext="three"></div>`,
  ],
];

const REFERENCES = `
  <input id="lv-i" value="typed" aria-label="Field"><button id="lv" aria-labelledby="lv-i">b</button>
  <input id="le-i" aria-label="Field"><button id="le" aria-labelledby="le-i">b</button>
  <div role="slider" id="sl-i" tabindex="0" aria-valuenow="5" aria-label="Vol"></div><button id="sl" aria-labelledby="sl-i">b</button>
  <input id="dv-i" value="hint text" aria-label="Field"><button id="dv" aria-describedby="dv-i">Go</button>
  <select id="ls-i"><option>Alpha</option><option selected>Beta</option></select><button id="ls" aria-labelledby="ls-i">b</button>
`;

const UNLENT = `
  <label><input id="own" value="x"> Name</label>
  <h2 id="color">Head <input type="color" value="#ff0000"></h2>
  <h2 id="date">Head <input type="date" value="1991-09-10"></h2>
  <h2 id="time">Head <input type="time" value="13:45"></h2>
  <h2 id="hidden-opt">Pick <ul role="listbox"><li role="option">A</li><li role="option" aria-selected="true" style="display:none">B</li></ul></h2>
  <h2 id="hidden-wrap">Pick <ul role="listbox"><li role="option">A</li><div aria-hidden="true"><span role="option" aria-selected="true">B</span></div></ul></h2>
  <h2 id="vis-inherit">Pick <ul role="listbox"><li role="option">A</li><div style="visibility:hidden"><span role="option" aria-selected="true">B</span></div></ul></h2>
  <h2 id="vis-override">Pick <ul role="listbox"><li role="option">A</li><div style="visibility:hidden"><span role="option" aria-selected="true" style="visibility:visible">B</span></div></ul></h2>
  <h2 id="opts">Pick <select><option>Apple</option><option selected>Pear</option><option>Plum</option></select></h2>
  <h2 id="lb-none">Pick <ul role="listbox"><li role="option">A</li><li role="option">B</li></ul></h2>
  <h2 id="indeterminate">Loading <progress></progress></h2>
  <h2 id="empty">Save<input>now</h2>
`;

// Chromium reads a range the page sets too, though AccName 2C names only a
// control the user adjusts; strict mode keeps it, as the page's own state.
const PAGE_STATE = `
  <h2 id="meter">Disk <meter value="0.6"></meter></h2>
  <h2 id="progress">Upload <progress value="40" max="100"></progress></h2>
  <h2 id="pbar">Upload <div role="progressbar" aria-valuenow="40"></div></h2>
  <h2 id="ameter">Disk <div role="meter" aria-valuenow="60" aria-valuetext="60 percent"></div></h2>
  <h2 id="multi">Pick <select multiple size="3"><option selected>A</option><option>B</option><option selected>C</option></select></h2>
`;

describe("an embedded control's value, against Chromium", () => {
  it("names the finding's six repro cases as Chromium does", async () => {
    await page.setContent(REPRO);
    const [dom, native, raw] = [
      await domById(page, false),
      await nativeById(page, false),
      await rawById(page),
    ];
    expect(raw["r1"]?.name).toBe("Flash the screen 3 times");
    for (const id of ["r1", "r2", "r3", "r4", "r5", "r6"]) {
      expect(dom[id]?.name, `dom ${id}`).toBe(raw[id]?.name);
      expect(native[id]?.name, `native ${id}`).toBe(raw[id]?.name);
    }
  });

  it("reads each kind of control's value as Chromium does", async () => {
    await page.setContent(
      VARIANTS.map(
        ([id, control]) =>
          `<label><input id="${id}" type="checkbox"> Flash the screen ${control} times</label>`,
      ).join("") +
        // A listbox whose options it owns from elsewhere.
        `<h2 id="owned">Pick <div role="listbox" tabindex="0" aria-owns="owned-a owned-b"></div></h2>` +
        `<span role="option" id="owned-a">One</span><span role="option" id="owned-b" aria-selected="true">Two</span>` +
        // ...and one whose options sit in a wrapper it owns, which Chromium
        // doesn't read as its choice.
        `<h2 id="owned-wrap">Pick <div role="listbox" tabindex="0" aria-owns="owned-w"></div></h2>` +
        `<div id="owned-w"><span role="option">Three</span><span role="option" aria-selected="true">Four</span></div>`,
    );
    const [dom, raw] = [await domById(page, false), await rawById(page)];
    expect(raw["owned"]?.name).toBe("Pick Two");
    expect(raw["owned-wrap"]?.name).toBe("Pick");
    for (const id of [...VARIANTS.map(([id]) => id), "owned", "owned-wrap"]) {
      expect(dom[id]?.name, id).toBe(raw[id]?.name);
    }
  });

  it("reads a referenced control as Chromium does", async () => {
    await page.setContent(REFERENCES);
    const [dom, raw] = [await domById(page, false), await rawById(page)];
    expect(raw["lv"]?.name).toBe("typed");
    for (const id of ["lv", "le", "sl", "ls"]) {
      expect(dom[id]?.name, id).toBe(raw[id]?.name);
    }
    expect(dom["dv"]?.description).toBe(raw["dv"]?.description);
  });

  it("lends nothing where Chromium lends nothing", async () => {
    await page.setContent(UNLENT);
    const [dom, raw] = [await domById(page, false), await rawById(page)];
    for (const id of [
      "own",
      "opts",
      "lb-none",
      "indeterminate",
      "empty",
      "color",
      "date",
      "time",
      "hidden-opt",
      "hidden-wrap",
      "vis-inherit",
      "vis-override",
    ]) {
      expect(dom[id]?.name, id).toBe(raw[id]?.name);
    }
  });

  it("reads a range the page sets, and keeps it in strict mode, as native does", async () => {
    await page.setContent(PAGE_STATE);
    const [dom, raw] = [await domById(page, false), await rawById(page)];
    expect(raw["meter"]?.name).toBe("Disk 0.6");
    for (const id of ["meter", "progress", "pbar", "ameter", "multi"]) {
      expect(dom[id]?.name, id).toBe(raw[id]?.name);
    }
    const [strictDom, strictNative] = [
      await domById(page, true),
      await nativeById(page, true),
    ];
    for (const id of ["meter", "progress", "pbar", "ameter"]) {
      expect(strictDom[id]?.name, id).toBe(strictNative[id]?.name);
      expect(strictDom[id]?.name, id).not.toBe(REDACTED_VALUE);
    }
  });

  it("withholds a sensitive value, and every value in strict mode, as native does", async () => {
    await page.setContent(`
      <label><input id="otp" type="checkbox"> Send <input autocomplete="one-time-code" value="482913"> now</label>
      <h2 id="pin">PIN <input type="password" value="hunter2"></h2>
      <input id="cc-i" autocomplete="cc-number" value="4111111111111111"><button id="cc" aria-labelledby="cc-i">b</button>
      <input id="csc-i" autocomplete="cc-csc" value="321"><button id="csc" aria-describedby="csc-i">Pay</button>
      ${REPRO}
    `);
    for (const redactInput of [false, true]) {
      const [dom, native] = [
        await domById(page, redactInput),
        await nativeById(page, redactInput),
      ];
      const at = `strict: ${redactInput}`;
      for (const id of ["otp", "pin", "cc"]) {
        expect(dom[id]?.name, `dom ${id} (${at})`).toBe(REDACTED_VALUE);
        expect(native[id]?.name, `native ${id} (${at})`).toBe(REDACTED_VALUE);
      }
      expect(dom["csc"]).toEqual({ name: "Pay", description: "" });
      expect(native["csc"]).toEqual({ name: "Pay", description: "" });
      // Strict mode withholds every value, so both producers read each
      // repro host `[redacted]`.
      if (redactInput) {
        for (const id of ["r1", "r2", "r3", "r4", "r5", "r6"]) {
          expect(dom[id]?.name, `dom ${id}`).toBe(REDACTED_VALUE);
          expect(native[id]?.name, `native ${id}`).toBe(REDACTED_VALUE);
        }
      }
    }
  });
});
