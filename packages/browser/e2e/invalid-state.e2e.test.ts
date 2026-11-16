/**
 * The invalid state, from both producers in real Chromium.
 *
 * The DOM producer used to read neither `aria-invalid` nor a form control's
 * own validity, so a field marked invalid, or failing its `pattern`, read the
 * same as a valid one in a jsdom diff or snapshot, while Chromium's own tree
 * reported `invalid=true`.
 *
 * The two producers agree on most cases. Where they don't, the DOM producer
 * follows the specs on purpose, and each case below gives both producers'
 * answers, so a test fails if either side changes:
 *
 * - `grammar` and `spelling` stay tokens, as WAI-ARIA 1.2 defines them.
 * - A required control that is only empty is invalid once `:user-invalid`
 *   matches it, as HTML-AAM's `required` row says.
 * - A control HTML bars from validation is never invalid, custom error or not.
 *
 * A valid control is unset in a DOM tree and `false` in a native one.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e invalid-state`
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

/** Each element's `invalid` state by id, from both producers. */
async function invalidById(): Promise<{
  dom: Record<string, unknown>;
  native: Record<string, unknown>;
}> {
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<
          string,
          {
            dom?: { attributes: Record<string, string> };
            a11y: { states: Record<string, unknown> };
          }
        >;
      };
    };
    const out: Record<string, unknown> = {};
    for (const node of ra.extractA11yTree(document.body).nodes.values()) {
      const id = node.dom?.attributes["id"];
      if (id) out[id] = node.a11y.states["invalid"] ?? "unset";
    }
    return out;
  });
  const native: Record<string, unknown> = {};
  for (const node of (await nativeTree(page)).nodes.values()) {
    const id = node.dom?.attributes["id"];
    if (id) native[id] = node.a11y.states["invalid"] ?? "unset";
  }
  return { dom, native };
}

/** Give each listed control a custom validity error. */
async function setCustomErrors(ids: string[]): Promise<void> {
  await page.evaluate((list) => {
    for (const id of list)
      (document.getElementById(id) as HTMLInputElement).setCustomValidity(
        "Not like that",
      );
  }, ids);
}

describe("aria-invalid, against Chromium", () => {
  it("reads its values as Chromium does", async () => {
    await page.setContent(`
      <input id="true" aria-invalid="true" aria-label="a">
      <input id="upper" aria-invalid="TRUE" aria-label="b">
      <input id="yes" aria-invalid="yes" aria-label="c">
      <input id="padded-false" aria-invalid=" false" aria-label="d">
      <input id="upper-undefined" aria-invalid="UNDEFINED" aria-label="e">
      <input id="false" aria-invalid="False" aria-label="f">
      <div id="group" role="group" aria-invalid="true" aria-label="g">x</div>
      <a id="link" href="#h" aria-invalid="true">h</a>
      <button id="button" aria-invalid="false">i</button>
      <select id="select" aria-invalid="true" aria-label="j"><option>k</option></select>
      <input id="checkbox" type="checkbox" aria-invalid="true" aria-label="l">
    `);
    const { dom, native } = await invalidById();
    const expected = {
      true: true,
      upper: true,
      yes: true,
      "padded-false": true,
      "upper-undefined": true,
      false: false,
      group: true,
      link: true,
      button: false,
      select: true,
      checkbox: true,
    };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });

  it("leaves a role with no aria-invalid unset in both", async () => {
    await page.setContent(`
      <div id="group" role="group" aria-label="a">x</div>
      <div id="empty" role="group" aria-invalid="" aria-label="b">x</div>
      <div id="undefined" role="group" aria-invalid="undefined" aria-label="c">x</div>
    `);
    const { dom, native } = await invalidById();
    const expected = { group: "unset", empty: "unset", undefined: "unset" };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });

  it("keeps grammar and spelling as tokens, where Chromium does not", async () => {
    await page.setContent(`
      <input id="input" aria-invalid="grammar" aria-label="a">
      <textarea id="textarea" aria-invalid="SPELLING" aria-label="b"></textarea>
      <div id="div-textbox" role="textbox" aria-invalid="Grammar" aria-label="c"></div>
      <input id="search" type="search" aria-invalid="spelling" aria-label="d">
      <div id="group" role="group" aria-invalid="spelling" aria-label="e">x</div>
      <div id="padded" role="group" aria-invalid="grammar " aria-label="f">x</div>
    `);
    const { dom, native } = await invalidById();
    // WAI-ARIA 1.2: a token on every role.
    expect(dom).toMatchObject({
      input: "grammar",
      textarea: "spelling",
      "div-textbox": "grammar",
      search: "spelling",
      group: "spelling",
      padded: true,
    });
    // Chromium: true on a textbox, nothing on any other role.
    expect(native).toMatchObject({
      input: true,
      textarea: true,
      "div-textbox": true,
      search: "unset",
      group: "unset",
      padded: true,
    });
  });
});

describe("a form control's own validity, against Chromium", () => {
  it("agrees on a control that fails or passes validation", async () => {
    await page.setContent(`
      <input id="pattern" pattern="[0-9]+" value="abc" aria-label="a">
      <input id="email" type="email" value="nope" aria-label="b">
      <input id="url" type="url" value="nope" aria-label="c">
      <input id="under" type="number" min="5" value="1" aria-label="d">
      <input id="custom" aria-label="e">
      <select id="select-custom" aria-label="f"><option>g</option></select>
      <button id="submit-custom">h</button>
      <input id="pattern-ok" pattern="[0-9]+" value="123" aria-label="i">
      <input id="disabled" disabled pattern="[0-9]+" value="abc" aria-label="j">
      <input id="readonly" readonly pattern="[0-9]+" value="abc" aria-label="k">
      <fieldset disabled><input id="in-fieldset" pattern="[0-9]+" value="abc" aria-label="l"></fieldset>
      <input id="aria-false" aria-invalid="false" pattern="[0-9]+" value="abc" aria-label="m">
      <input id="aria-empty" aria-invalid="" pattern="[0-9]+" value="abc" aria-label="n">
      <input id="required" required aria-label="o">
      <textarea id="textarea-required" required aria-label="p"></textarea>
    `);
    await setCustomErrors(["custom", "select-custom", "submit-custom"]);
    const { dom, native } = await invalidById();
    const failing = {
      pattern: true,
      email: true,
      url: true,
      under: true,
      custom: true,
      "select-custom": true,
      "submit-custom": true,
      // An authored aria-invalid wins, and an empty one sets nothing.
      "aria-false": false,
      "aria-empty": true,
    };
    // Valid, barred, or only empty and untouched.
    const passing = [
      "pattern-ok",
      "disabled",
      "readonly",
      "in-fieldset",
      "required",
      "textarea-required",
    ];
    expect(dom).toMatchObject({
      ...failing,
      ...Object.fromEntries(passing.map((id) => [id, "unset"])),
    });
    expect(native).toMatchObject({
      ...failing,
      ...Object.fromEntries(passing.map((id) => [id, false])),
    });
  });

  it("waits for interaction before an empty required control is invalid", async () => {
    await page.setContent(`
      <form id="form">
        <input id="input" required aria-label="a">
        <select id="select" required aria-label="b"><option value="">-</option><option>c</option></select>
        <input id="checkbox" type="checkbox" required aria-label="d">
        <input id="radio" type="radio" name="r" required aria-label="e">
      </form>
    `);
    const untouched = await invalidById();
    // HTML-AAM: "MUST NOT expose the element with an initial invalid state".
    // Chromium reports the last three invalid from the start.
    expect(untouched.dom).toMatchObject({
      input: "unset",
      select: "unset",
      checkbox: "unset",
      radio: "unset",
    });
    expect(untouched.native).toMatchObject({
      input: false,
      select: true,
      checkbox: true,
      radio: true,
    });

    // A submission attempt makes `:user-invalid` match all four.
    await page.evaluate(() =>
      (document.getElementById("form") as HTMLFormElement).requestSubmit(),
    );
    const submitted = await invalidById();
    expect(submitted.dom).toMatchObject({
      input: true,
      select: true,
      checkbox: true,
      radio: true,
    });
    // Chromium never reports an empty text field invalid.
    expect(submitted.native).toMatchObject({
      input: false,
      select: true,
      checkbox: true,
      radio: true,
    });
  });

  it("never reports a barred control invalid, where Chromium does", async () => {
    await page.setContent(`
      <input id="readonly-custom" readonly aria-label="a">
      <button id="button-custom" type="button">b</button>
      <output id="output-custom" aria-label="c">d</output>
      <x-field id="custom-element" role="textbox" aria-label="e"></x-field>
      <script>
        customElements.define("x-field", class extends HTMLElement {
          static formAssociated = true;
          constructor() {
            super();
            this.attachInternals().setValidity({ typeMismatch: true }, "Bad");
          }
        });
      </script>
    `);
    await setCustomErrors([
      "readonly-custom",
      "button-custom",
      "output-custom",
    ]);
    const { dom, native } = await invalidById();
    // HTML bars the first three from validation, so their custom error fails
    // nothing. A form-associated custom element keeps its validity in its
    // ElementInternals, which page script outside it can't read.
    expect(dom).toMatchObject({
      "readonly-custom": "unset",
      "button-custom": "unset",
      "output-custom": "unset",
      "custom-element": "unset",
    });
    expect(native).toMatchObject({
      "readonly-custom": true,
      "button-custom": true,
      "output-custom": true,
      "custom-element": true,
    });
  });
});
