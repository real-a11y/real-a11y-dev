/**
 * The `{…}` states block, from both producers in real Chromium.
 *
 * Tree text used to print role and name only, so a checked and an unchecked
 * checkbox serialized identically (D-10). The serializer now prints the
 * states a screen reader presents, from either producer's tree. The print
 * rules hide each producer's defaults, so the two agree where both report a
 * state: native's `invalid=false` and `focusable=true` print nothing.
 *
 * Where only one producer reports a property (native's `roledescription` and
 * `haspopup`, until the DOM producer reads them), the lines differ by that
 * token, and this pins native's side.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e states-block`
 */

import { nativeTree, pageBundleSource } from "@real-a11y-dev/browser";
import { serializeTree } from "@real-a11y-dev/serialize";
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

/** D-10's repro. */
const REPRO = `
  <input type="checkbox" checked aria-label="Subscribe">
  <input type="checkbox" aria-label="Subscribe">
  <button aria-roledescription="slide" aria-describedby="d">x</button>
  <p id="d" hidden>Hint</p>`;

/** The tree text of `html`, from each producer. */
async function treeText(
  html: string,
): Promise<{ dom: string[]; native: string[] }> {
  await page.setContent(html);
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      treeSnapshot(root: Element): string;
    };
    return ra.treeSnapshot(document.body);
  });
  const native = serializeTree(await nativeTree(page));
  const lines = (text: string) => text.split("\n").map((l) => l.trim());
  return { dom: lines(dom), native: lines(native) };
}

describe("the states block in real Chromium", () => {
  it("prints a checked and an unchecked checkbox differently, alike in both producers", async () => {
    const { dom, native } = await treeText(REPRO);
    const boxes = (lines: string[]) =>
      lines.filter((l) => l.startsWith("checkbox"));
    expect(boxes(dom)).toEqual([
      'checkbox "Subscribe" {checked}',
      'checkbox "Subscribe" {checked=false}',
    ]);
    // Native reports `invalid=false` and `focusable=true` on both boxes too;
    // the print rules leave them out, so the lines match.
    expect(boxes(native)).toEqual(boxes(dom));
  });

  it("carries native's role description, and the description from both", async () => {
    const { dom, native } = await treeText(REPRO);
    expect(dom).toContain('button "x" {description="Hint"}');
    expect(native).toContain(
      'button "x" {roledescription="slide", description="Hint"}',
    );
  });

  it("agrees on the states both producers read", async () => {
    const { dom, native } = await treeText(`
      <button aria-expanded="false" aria-pressed="mixed">Menu</button>
      <button disabled>Off</button>
      <input aria-label="Email" required aria-invalid="true">
      <input aria-label="Name" readonly>
      <div role="listbox" aria-label="L">
        <div role="option" aria-selected="true">A</div>
        <div role="option" aria-selected="false">B</div>
      </div>`);
    for (const line of [
      'button "Menu" {pressed=mixed, expanded=false}',
      'button "Off" {disabled}',
      'textbox "Email" {required, invalid}',
      'textbox "Name" {readonly}',
      'option "A" {selected}',
      'option "B"',
    ]) {
      expect(dom, `DOM: ${line}`).toContain(line);
      expect(native, `native: ${line}`).toContain(line);
    }
  });
});
