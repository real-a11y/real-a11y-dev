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

import { nativeTree } from "@real-a11y-dev/browser";
import { REDACTED_VALUE } from "@real-a11y-dev/core";
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

interface Read {
  name: string;
  description: string;
}

/** Every `id`-ed node's name and description from the native tree. */
async function nativeById(redactInput: boolean): Promise<Map<string, Read>> {
  const out = new Map<string, Read>();
  for (const node of (await nativeTree(page, { redactInput })).nodes.values()) {
    const id = node.dom?.attributes["id"];
    if (id) {
      out.set(id, {
        name: node.a11y.name,
        description: node.a11y.description ?? "",
      });
    }
  }
  return out;
}

/** The same, straight from Chromium's raw CDP tree. */
async function rawById(): Promise<Map<string, Read>> {
  const out = new Map<string, Read>();
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("Accessibility.enable");
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes: {
        backendDOMNodeId?: number;
        ignored?: boolean;
        name?: { value?: string };
        description?: { value?: string };
      }[];
    };
    for (const n of nodes) {
      if (n.ignored || n.backendDOMNodeId === undefined) continue;
      const { node } = (await cdp.send("DOM.describeNode", {
        backendNodeId: n.backendDOMNodeId,
      })) as { node: { attributes?: string[] } };
      const attrs = node.attributes ?? [];
      const at = attrs.indexOf("id");
      if (at >= 0) {
        out.set(attrs[at + 1]!, {
          name: n.name?.value ?? "",
          description: n.description?.value ?? "",
        });
      }
    }
  } finally {
    await cdp.detach();
  }
  return out;
}

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
    const raw = await rawById();
    // Chromium itself puts the code there, a hidden checkbox's label too.
    for (const key of ["for", "wrap", "date", "hid"]) {
      expect(raw.get(`${key}-b`)?.name, key).toBe("Code 482913");
      expect(raw.get(`${key}-d`)?.description, key).toBe("Code 482913");
    }
    expect(raw.get("pw-b")?.name).toMatch(/^Pass [•●]{7}$/);
    // ...and through a labelled control inside the label, or inside content.
    expect(raw.get("in-b")?.name).toBe("Opt in Code 482913");
    expect(raw.get("cell")?.name).toBe("Row Code 482913");
    expect(raw.get("span-b")?.name).toBe("Pick Code 482913");
    // A hidden target is read whole: a hidden checkbox in it by its label.
    expect(raw.get("hspan-b")?.name).toBe("Pick Code 482913");
    expect(raw.get("hspan-d")?.description).toBe("Pick Code 482913");
    expect(raw.get("aspan-b")?.name).toBe("Pick Code 482913");
    expect(raw.get("nlabel-b")?.name).toBe("Opt Code 482913");

    for (const redactInput of [false, true]) {
      const native = await nativeById(redactInput);
      const at = `strict: ${redactInput}`;
      for (const key of ["for", "wrap", "date", "hid", "pw", "in"]) {
        expect(native.get(`${key}-b`)?.name, `${key} (${at})`).toBe(
          REDACTED_VALUE,
        );
        expect(native.get(`${key}-d`)?.name, `${key} (${at})`).toBe("Go");
        expect(native.get(`${key}-d`)?.description, `${key} (${at})`).toBe("");
      }
      expect(native.get("cell")?.name, at).toBe(REDACTED_VALUE);
      for (const id of ["span-b", "hspan-b", "aspan-b", "nlabel-b"]) {
        expect(native.get(id)?.name, `${id} (${at})`).toBe(REDACTED_VALUE);
      }
      expect(native.get("hspan-d")?.description, at).toBe("");
      for (const read of native.values()) {
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
    const raw = await rawById();
    expect(raw.get("text-b")?.name).toBe("Name typed");
    expect(raw.get("area-d")?.description).toBe("Note typed note");
    expect(raw.get("pick-b")?.name).toBe("Pick Bee");
    expect(raw.get("ed-b")?.name).toBe("Ed typed text");

    const shown = await nativeById(false);
    const strict = await nativeById(true);
    expect(raw.get("hid-b")?.name).toBe("Pick Name typed");
    for (const key of ["text", "area", "pick", "ed", "hid"]) {
      expect(shown.get(`${key}-b`)?.name, key).toBe(raw.get(`${key}-b`)?.name);
      expect(shown.get(`${key}-d`)?.description, key).toBe(
        raw.get(`${key}-d`)?.description,
      );
      expect(strict.get(`${key}-b`)?.name, key).toBe(REDACTED_VALUE);
      expect(strict.get(`${key}-d`)?.name, key).toBe("Go");
      expect(strict.get(`${key}-d`)?.description, key).toBe("");
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
    const raw = await rawById();
    // A reference skips the checkbox's own aria-labelledby and reads the
    // label, which holds no value; an aria-label is read before any label.
    expect(raw.get("own-b")?.name).toBe("Lab");
    expect(raw.get("al-b")?.name).toBe("Agree");
    expect(raw.get("empty-b")?.name).toBe("Code");
    expect(raw.get("hidp-b")?.name).toBe("Plain");
    // A visible target's content skips a hidden checkbox in it, labels and
    // all; a field named by a label around it skips its own value, even read
    // back through the checkbox that label labels.
    for (const key of ["vh", "va", "vv"]) {
      expect(raw.get(`${key}-b`)?.name.trim(), key).toBe("Pick");
    }
    expect(raw.get("cyc-c")?.name).toBe("Code 482913");
    expect(raw.get("cyc")?.name.trim()).toBe("Code");
    expect(raw.get("cyt")?.name.trim()).toBe("Name");

    for (const redactInput of [false, true]) {
      const native = await nativeById(redactInput);
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
        expect(native.get(`${key}-b`)?.name, `${key} (${at})`).toBe(
          raw.get(`${key}-b`)?.name.trim(),
        );
        expect(native.get(`${key}-d`)?.description, `${key} (${at})`).toBe(
          raw.get(`${key}-d`)?.description.trim(),
        );
      }
      expect(native.get("cell")?.name, at).toBe("Row Sel");
      // A field's own label around it skips its own value, strict or not.
      expect(native.get("self")?.name, at).toBe("Name");
      expect(native.get("cyc")?.name, at).toBe("Code");
      expect(native.get("cyc-c")?.name, at).toBe(REDACTED_VALUE);
      expect(native.get("cyt")?.name, at).toBe("Name");
      expect(native.get("cyt-c")?.name, at).toBe(
        redactInput ? REDACTED_VALUE : "Name typed",
      );
    }
  });
});
