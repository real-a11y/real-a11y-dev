/**
 * A field's value in the label of a control another name reads, against real
 * Chromium.
 *
 * Chromium reads a form control into another node's name — through an
 * `aria-labelledby` or `aria-describedby` pointing at it, or as content of a
 * cell, a link or a label around it — and when the control has no value to
 * lend, it reads the control's `<label>`s instead, with any field's value in
 * them: `<label for="c">Code <input autocomplete="one-time-code"
 * value="482913"></label><input type="checkbox" id="c">` makes `<button
 * aria-labelledby="c">` `button "Code 482913"`. The native producer withholds
 * every such name and description (`valueRegions()` in core, which follows a
 * control's labels); this pins it to what Chromium reports, taken from its raw
 * CDP tree, so a milestone that changes the rule fails here.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e referenced-control-label`
 */

import { REDACTED_VALUE } from "@real-a11y-dev/core";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nativeById, rawById } from "./names-by-id.js";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
});

const OTP = `autocomplete="one-time-code" value="482913"`;

/** A button labelled by `c` (`<key>-b`) and one described by it (`<key>-d`). */
const readers = (key: string) =>
  `<button id="${key}-b" aria-labelledby="${key}-c">Toggle</button>` +
  `<button id="${key}-d" aria-describedby="${key}-c">Go</button>`;

describe("a value in the label of a control another name reads, against Chromium", () => {
  it("is withheld from a name and a description when the field is sensitive", async () => {
    await page.setContent(`
      <label for="for-c">Code <input ${OTP}></label>
      <input type="checkbox" id="for-c">${readers("for")}
      <label><input type="checkbox" id="wrap-c"> Code <input ${OTP}></label>
      ${readers("wrap")}
      <label for="date-c">Code <input ${OTP}></label>
      <input type="date" id="date-c" value="1991-09-10">${readers("date")}
      <label for="hid-c">Code <input ${OTP}></label>
      <input type="checkbox" id="hid-c" hidden>${readers("hid")}
      <label for="pw-c">Pass <input type="password" value="hunter2"></label>
      <input type="checkbox" id="pw-c">${readers("pw")}
      <label for="in-c">Opt in <input type="checkbox" id="in-e"></label>
      <input type="checkbox" id="in-c">${readers("in")}
      <label for="in-e">Code <input ${OTP}></label>
      <table><tr><td id="cell">Row <input type="checkbox" id="cell-e"></td></tr></table>
      <label for="cell-e">Code <input ${OTP}></label>
      <span id="span">Pick <input type="checkbox" id="span-e"></span>
      <label for="span-e">Code <input ${OTP}></label>
      <button id="span-b" aria-labelledby="span">Toggle</button>
      <span id="hspan" hidden>Pick <input type="checkbox" id="hspan-e"></span>
      <label for="hspan-e">Code <input ${OTP}></label>
      <button id="hspan-b" aria-labelledby="hspan">Toggle</button>
      <button id="hspan-d" aria-describedby="hspan">Go</button>
      <span id="aspan" aria-hidden="true">Pick <input type="checkbox" id="aspan-e"></span>
      <label for="aspan-e">Code <input ${OTP}></label>
      <button id="aspan-b" aria-labelledby="aspan">Toggle</button>
      <div style="display:none"><label id="nlabel">Opt <input type="checkbox" id="nlabel-e"></label></div>
      <label for="nlabel-e">Code <input ${OTP}></label>
      <button id="nlabel-b" aria-labelledby="nlabel">Toggle</button>
    `);
    const raw = await rawById(page);
    // Chromium itself puts the code there, a hidden checkbox's label too.
    for (const key of ["for", "wrap", "date", "hid"]) {
      expect(raw[`${key}-b`]?.name, key).toBe("Code 482913");
      expect(raw[`${key}-d`]?.description, key).toBe("Code 482913");
    }
    expect(raw["pw-b"]?.name).toMatch(/^Pass [•●]{7}$/);
    // ...and through a labelled control inside the label, or inside content.
    expect(raw["in-b"]?.name).toBe("Opt in Code 482913");
    expect(raw["cell"]?.name).toBe("Row Code 482913");
    expect(raw["span-b"]?.name).toBe("Pick Code 482913");
    // A hidden target is read whole: a hidden checkbox in it by its label.
    expect(raw["hspan-b"]?.name).toBe("Pick Code 482913");
    expect(raw["hspan-d"]?.description).toBe("Pick Code 482913");
    expect(raw["aspan-b"]?.name).toBe("Pick Code 482913");
    expect(raw["nlabel-b"]?.name).toBe("Opt Code 482913");

    for (const redactInput of [false, true]) {
      const native = await nativeById(page, redactInput);
      const at = `strict: ${redactInput}`;
      for (const key of ["for", "wrap", "date", "hid", "pw", "in"]) {
        expect(native[`${key}-b`]?.name, `${key} (${at})`).toBe(REDACTED_VALUE);
        expect(native[`${key}-d`]?.name, `${key} (${at})`).toBe("Go");
        expect(native[`${key}-d`]?.description, `${key} (${at})`).toBe("");
      }
      expect(native["cell"]?.name, at).toBe(REDACTED_VALUE);
      for (const id of ["span-b", "hspan-b", "aspan-b", "nlabel-b"]) {
        expect(native[id]?.name, `${id} (${at})`).toBe(REDACTED_VALUE);
      }
      expect(native["hspan-d"]?.description, at).toBe("");
      for (const read of Object.values(native)) {
        expect(`${read.name} ${read.description}`, at).not.toMatch(
          /482913|•|●/,
        );
      }
    }
  });

  it("is withheld for any entered value in strict mode, and shown as Chromium has it otherwise", async () => {
    await page.setContent(`
      <label for="text-c">Name <input value="typed"></label>
      <input type="checkbox" id="text-c">${readers("text")}
      <label for="area-c">Note <textarea>typed note</textarea></label>
      <input type="checkbox" id="area-c">${readers("area")}
      <label for="pick-c">Pick <select><option>A</option><option selected>Bee</option></select></label>
      <input type="checkbox" id="pick-c">${readers("pick")}
      <label for="ed-c">Ed <span contenteditable>typed text</span></label>
      <input type="checkbox" id="ed-c">${readers("ed")}
      <span id="hid-c" hidden>Pick <input type="checkbox" id="hid-e"></span>
      <label for="hid-e">Name <input value="typed"></label>${readers("hid")}
    `);
    const raw = await rawById(page);
    expect(raw["text-b"]?.name).toBe("Name typed");
    expect(raw["area-d"]?.description).toBe("Note typed note");
    expect(raw["pick-b"]?.name).toBe("Pick Bee");
    expect(raw["ed-b"]?.name).toBe("Ed typed text");

    const shown = await nativeById(page, false);
    const strict = await nativeById(page, true);
    expect(raw["hid-b"]?.name).toBe("Pick Name typed");
    for (const key of ["text", "area", "pick", "ed", "hid"]) {
      expect(shown[`${key}-b`]?.name, key).toBe(raw[`${key}-b`]?.name);
      expect(shown[`${key}-d`]?.description, key).toBe(
        raw[`${key}-d`]?.description,
      );
      expect(strict[`${key}-b`]?.name, key).toBe(REDACTED_VALUE);
      expect(strict[`${key}-d`]?.name, key).toBe("Go");
      expect(strict[`${key}-d`]?.description, key).toBe("");
    }
  });

  it("keeps a name read from markup alone, beside filled fields", async () => {
    await page.setContent(`
      <label for="plain-c">Code</label>
      <input type="checkbox" id="plain-c">${readers("plain")}
      <label for="empty-c">Code <input autocomplete="one-time-code"></label>
      <input type="checkbox" id="empty-c">${readers("empty")}
      <label for="al-c">Code <input ${OTP}></label>
      <input type="checkbox" id="al-c" aria-label="Agree">${readers("al")}
      <span id="other">Other <input ${OTP}></span>
      <label for="own-c">Lab</label>
      <input type="checkbox" id="own-c" aria-labelledby="other">${readers("own")}
      <label for="hidp-c">Plain</label>
      <input type="checkbox" id="hidp-c" hidden>${readers("hidp")}
      <table><tr><td id="cell">Row <input type="checkbox" aria-label="Sel"></td></tr></table>
      <label>Name <input id="self" value="typed"></label>
      <span id="vh-c">Pick <input type="checkbox" id="vh-e" hidden></span>
      <label for="vh-e">Code <input ${OTP}></label>${readers("vh")}
      <span id="va-c">Pick <input type="checkbox" id="va-e" aria-hidden="true"></span>
      <label for="va-e">Code <input ${OTP}></label>${readers("va")}
      <span id="vv-c">Pick <input type="checkbox" id="vv-e" style="visibility:hidden"></span>
      <label for="vv-e">Code <input ${OTP}></label>${readers("vv")}
      <label id="cyc-l">Code <input type="checkbox" id="cyc-c"> <input id="cyc" aria-labelledby="cyc-l" ${OTP}></label>
      <label id="cyt-l">Name <input type="checkbox" id="cyt-c"> <input id="cyt" aria-labelledby="cyt-l" value="typed"></label>
    `);
    const raw = await rawById(page);
    // A reference skips the checkbox's own aria-labelledby and reads the
    // label, which holds no value; an aria-label is read before any label.
    expect(raw["own-b"]?.name).toBe("Lab");
    expect(raw["al-b"]?.name).toBe("Agree");
    expect(raw["empty-b"]?.name).toBe("Code");
    expect(raw["hidp-b"]?.name).toBe("Plain");
    // A visible target's content skips a hidden checkbox in it, labels and
    // all; a field named by a label around it skips its own value, even read
    // back through the checkbox that label labels.
    for (const key of ["vh", "va", "vv"]) {
      expect(raw[`${key}-b`]?.name, key).toBe("Pick");
    }
    expect(raw["cyc-c"]?.name).toBe("Code 482913");
    expect(raw["cyc"]?.name).toBe("Code");
    expect(raw["cyt"]?.name).toBe("Name");

    for (const redactInput of [false, true]) {
      const native = await nativeById(page, redactInput);
      const at = `strict: ${redactInput}`;
      for (const key of [
        "plain",
        "empty",
        "al",
        "own",
        "hidp",
        "vh",
        "va",
        "vv",
      ]) {
        expect(native[`${key}-b`]?.name, `${key} (${at})`).toBe(
          raw[`${key}-b`]?.name,
        );
        expect(native[`${key}-d`]?.description, `${key} (${at})`).toBe(
          raw[`${key}-d`]?.description.trim(),
        );
      }
      expect(native["cell"]?.name, at).toBe("Row Sel");
      // A field's own label around it skips its own value, strict or not.
      expect(native["self"]?.name, at).toBe("Name");
      expect(native["cyc"]?.name, at).toBe("Code");
      expect(native["cyc-c"]?.name, at).toBe(REDACTED_VALUE);
      expect(native["cyt"]?.name, at).toBe("Name");
      expect(native["cyt-c"]?.name, at).toBe(
        redactInput ? REDACTED_VALUE : "Name typed",
      );
    }
  });
});
