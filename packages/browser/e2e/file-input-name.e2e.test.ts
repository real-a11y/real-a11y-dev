/**
 * An unlabeled `<input type="file">` in real Chromium, from both producers.
 *
 * Chromium names it from its own button text ("Choose File", localized, and
 * "Choose Files" with `multiple`). HTML-AAM gives it no name, and the DOM
 * producer reads `""`. The native producer drops that built-in name, found by
 * Chromium's name trace rather than by the text, so both audits report the
 * input. The splits from raw Chromium are asserted as splits, so a Chromium
 * change shows up here as a failing test.
 *
 * Names built AROUND the input (a heading, a cell, a region labelled by it) are
 * left as Chromium gives them: native matches raw there, the DOM producer does
 * not, and neither is changed by the fix.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e file-input-name`
 */

import { collectFindings } from "@real-a11y-dev/audit";
import { BrowserSession } from "@real-a11y-dev/browser";
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

/** id, markup, and the name both producers read. */
const BARE: [string, string, string][] = [
  ["plain", `<input id="plain" type="file">`, ""],
  ["multiple", `<input id="multiple" type="file" multiple>`, ""],
  ["empty-label", `<input id="empty-label" type="file" aria-label="">`, ""],
  [
    "empty-ref",
    `<span id="none"></span><input id="empty-ref" type="file" aria-labelledby="none">`,
    "",
  ],
  ["link", `<input id="link" type="file" role="link">`, ""],
  [
    "empty-wrapper",
    `<label><input id="empty-wrapper" type="file"></label>`,
    "",
  ],
];

const LABELLED: [string, string][] = [
  ["aria", `<input id="aria" type="file" aria-label="Upload CV">`],
  ["for", `<label for="for">Upload CV</label><input id="for" type="file">`],
  ["wrapped", `<label>Upload CV <input id="wrapped" type="file"></label>`],
  [
    "ref",
    `<span id="cv">Upload CV</span><input id="ref" type="file" aria-labelledby="cv">`,
  ],
];

async function load(markup: string): Promise<void> {
  await page.setContent(`<body>${markup}</body>`);
}

describe("an unlabeled file input", () => {
  for (const redactInput of [false, true]) {
    const mode = redactInput ? "strict" : "default";

    it(`reads as an empty name in both producers (${mode})`, async () => {
      await load(BARE.map(([, markup]) => markup).join(""));
      const dom = await domById(page, redactInput);
      const native = await nativeById(page, redactInput);
      const raw = await rawById(page);
      for (const [id, , expected] of BARE) {
        expect(dom[id]?.name, `DOM ${id}`).toBe(expected);
        expect(native[id]?.name, `native ${id}`).toBe(expected);
      }
      // The deliberate split: Chromium says "Choose File", native does not.
      for (const id of ["plain", "multiple", "empty-label", "empty-ref"]) {
        expect(raw[id]?.name, `raw ${id}`).toMatch(/^Choose Files?$/);
      }
    });

    it(`leaves a name the page gave it alone (${mode})`, async () => {
      await load(LABELLED.map(([, markup]) => markup).join(""));
      const dom = await domById(page, redactInput);
      const native = await nativeById(page, redactInput);
      for (const [id] of LABELLED) {
        expect(dom[id]?.name, `DOM ${id}`).toBe("Upload CV");
        expect(native[id]?.name, `native ${id}`).toBe("Upload CV");
      }
    });
  }

  it("keeps a description, and a title is a description on the native path", async () => {
    await load(
      `<span id="hint">PDF only</span>` +
        `<input id="described" type="file" aria-describedby="hint">` +
        `<input id="titled" type="file" title="Upload CV">`,
    );
    const native = await nativeById(page, false);
    expect(native["described"]).toEqual({
      name: "",
      description: "PDF only",
    });
    expect(native["titled"]).toEqual({ name: "", description: "Upload CV" });
    // The DOM producer follows HTML-AAM §4.1.7 and names it from the title.
    expect((await domById(page, false))["titled"]?.name).toBe("Upload CV");
  });

  it("does not reach other controls named from their own text", async () => {
    await load(
      `<input id="submit" type="submit">` +
        `<input id="reset" type="reset">` +
        `<input id="image" type="image" src="data:,">` +
        `<input id="send" type="submit" value="Send">` +
        `<button id="b" value="v">B</button>`,
    );
    const native = await nativeById(page, false);
    expect(
      Object.fromEntries(Object.entries(native).map(([k, v]) => [k, v.name])),
    ).toEqual({
      submit: "Submit",
      reset: "Reset",
      image: "Submit",
      send: "Send",
      b: "B",
    });
  });

  it("leaves the names built around the input as Chromium gives them", async () => {
    await load(
      `<h2 id="heading">Up <input type="file"></h2>` +
        `<table><tr><th>H</th></tr><tr><td id="cell"><input type="file"></td></tr></table>` +
        `<div role="region" id="region" aria-labelledby="f"></div><input id="f" type="file">`,
    );
    const native = await nativeById(page, false);
    const raw = await rawById(page);
    for (const id of ["heading", "cell", "region"]) {
      expect(native[id]?.name, id).toBe(raw[id]?.name);
      expect(native[id]?.name, id).toContain("Choose File");
    }
    // The DOM producer reads "Up", "" and "" there.
    const dom = await domById(page, false);
    expect(dom["heading"]?.name).toBe("Up");
    expect(dom["cell"]?.name).toBe("");
    expect(dom["region"]?.name).toBe("");
  });
});

describe("the audit of the D-1 page", () => {
  const FIXTURE = `<!doctype html><html lang="en"><body><main>
  <h1>t</h1>
  <input type="submit">
  <input type="reset">
  <input type="image" src="data:,">
  <button><ul><li>One</li></ul></button>
  <input type="file">
</main></body></html>`;
  const TITLED = `<!doctype html><html lang="en"><body><main><h1>t</h1>
  <input type="file" title="Upload CV"></main></body></html>`;

  const session = new BrowserSession({ headless: true });
  afterAll(async () => {
    await session.close();
  });

  for (const redactInput of [false, true]) {
    it(`reports exactly the file input on both paths (${redactInput ? "strict" : "default"})`, async () => {
      await session.open("data:text/html," + encodeURIComponent(FIXTURE));
      const rules = ["no-unlabeled-interactive"] as const;
      const dom = (
        await session.snapshot("body", { rules: [...rules], redactInput })
      ).findings;
      const native = collectFindings(
        await session.nativeTree({ redactInput }),
        [...rules],
      );
      for (const findings of [dom, native]) {
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
          rule: "no-unlabeled-interactive",
          role: "button",
          tagName: "input",
        });
      }
    });
  }

  it("reports a title-only input as unlabeled on the native path, and as title-only on the DOM path", async () => {
    await session.open("data:text/html," + encodeURIComponent(TITLED));
    const dom = (await session.snapshot("body")).findings.map((f) => f.rule);
    const native = collectFindings(await session.nativeTree()).map(
      (f) => f.rule,
    );
    // Native: the name is gone, and the title is its description.
    expect(native).toContain("no-unlabeled-interactive");
    expect(native).toContain("label-title-only");
    expect(dom).toContain("label-title-only");
    expect(dom).not.toContain("no-unlabeled-interactive");
  });
});
