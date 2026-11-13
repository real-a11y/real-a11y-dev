/**
 * A field's own value in its own name or description, against real Chromium.
 *
 * Chromium reads a field's value into the field's own name when the field is
 * in its own `aria-labelledby` (`aria-labelledby="label card"` is
 * `textbox "Card 4111…"`), into its own description through any
 * `aria-describedby` that reaches it, and, through an `aria-labelledby` naming
 * an element around it, the parts of a date input or a `div` combobox's text.
 * Only a label around the field skips what is typed in it. The native producer
 * withholds every such name and description (`valueRegions().references()` in
 * core); this pins it to what Chromium reports, taken from its raw CDP tree,
 * so a milestone that changes the rule fails here.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e field-own-label`
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

describe("a field's own value in its own name, against Chromium", () => {
  it("is withheld from a sensitive field's name and description", async () => {
    await page.setContent(`
      <span id="self-l">Card</span>
      <input id="self" aria-labelledby="self-l self" autocomplete="cc-number" value="4111111111111111">
      <span id="pin-l">PIN</span>
      <input id="pin" type="password" aria-labelledby="pin-l pin" value="4321">
      <label id="exp-l">Expiry <input id="exp" type="month" aria-labelledby="exp-l" autocomplete="cc-exp" value="2030-04"></label>
      <input id="desc" aria-label="Card" aria-describedby="desc" autocomplete="cc-number" value="4222222222222222">
      <label id="desc-w-l">Card <input id="desc-w" aria-label="Card" aria-describedby="desc-w-l" autocomplete="cc-number" value="4333333333333333"></label>
      <label id="wrap-l">Card <input id="wrap" aria-labelledby="wrap-l" autocomplete="cc-number" value="4444444444444444"></label>
      <label>Expiry <input id="exp-host" type="month" autocomplete="cc-exp" value="2031-05"></label>
    `);
    const raw = await rawById();
    // Chromium itself puts the value there.
    expect(raw.get("self")?.name).toBe("Card 4111111111111111");
    expect(raw.get("pin")?.name).toMatch(/^PIN [•●]{4}$/);
    expect(raw.get("exp")?.name).toContain("2030");
    expect(raw.get("desc")?.description).toBe("4222222222222222");
    expect(raw.get("desc-w")?.description).toContain("4333333333333333");
    // ...and skips it through a label around a text field, or a <label>.
    expect(raw.get("wrap")?.name.trim()).toBe("Card");
    expect(raw.get("exp-host")?.name).toBe("Expiry");

    for (const redactInput of [false, true]) {
      const native = await nativeById(redactInput);
      const at = `strict: ${redactInput}`;
      for (const id of ["self", "pin", "exp"]) {
        expect(native.get(id)?.name, `${id} (${at})`).toBe(REDACTED_VALUE);
      }
      for (const id of ["desc", "desc-w"]) {
        expect(native.get(id)?.name, `${id} (${at})`).toBe("Card");
        expect(native.get(id)?.description, `${id} (${at})`).toBe("");
      }
      expect(native.get("wrap")?.name, at).toBe("Card");
      expect(native.get("exp-host")?.name, at).toBe("Expiry");
    }
  });

  it("is withheld from any field's name in strict mode", async () => {
    await page.setContent(`
      <span id="age-l">Age</span>
      <div role="combobox" id="age" tabindex="0" aria-labelledby="age-l age">Ten</div>
      <div contenteditable role="textbox" id="into" aria-labelledby="into-s"><span id="into-s">typed into</span></div>
      <label id="day-l">Day <input id="day" type="date" aria-labelledby="day-l" value="1991-09-10"></label>
      <div id="note-l"><span>Note</span><div contenteditable role="textbox" id="note" aria-labelledby="note-l">typed note</div></div>
      <label id="num-l">Count <input id="num" type="number" aria-labelledby="num-l" value="7"></label>
    `);
    const raw = await rawById();
    expect(raw.get("age")?.name).toBe("Age Ten");
    expect(raw.get("into")?.name).toBe("typed into");
    expect(raw.get("day")?.name).toContain("1991");
    expect(raw.get("note")?.name).toBe("Note");
    expect(raw.get("num")?.name.trim()).toBe("Count");

    const loose = await nativeById(false);
    expect(loose.get("age")?.name).toBe("Age Ten");
    const strict = await nativeById(true);
    for (const id of ["age", "into", "day"]) {
      expect(strict.get(id)?.name, id).toBe(REDACTED_VALUE);
    }
    expect(strict.get("note")?.name).toBe("Note");
    expect(strict.get("num")?.name).toBe("Count");
  });
});
