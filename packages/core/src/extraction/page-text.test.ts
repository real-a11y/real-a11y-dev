import { afterEach, describe, expect, it } from "vitest";

import { liveRegionLevel } from "./overlay-scope.js";
import { pageText } from "./page-text.js";

function mount(html: string): Element {
  document.body.innerHTML = `<div id="r">${html}</div>`;
  return document.getElementById("r")!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("pageText", () => {
  it("reads text as it stands, without what the page never shows", () => {
    const root = mount(
      `Hi <b>there</b><span hidden>x</span><textarea>secret</textarea><script>s()</script>`,
    );
    expect(pageText(root)).toBe("Hi there");
  });

  it("leaves out aria-hidden text only when announced", () => {
    const root = mount(`Saved <span aria-hidden="true">✓</span>`);
    expect(pageText(root)).toBe("Saved ✓");
    expect(pageText(root, { announced: true })).toBe("Saved ");
  });

  it("reads nothing announced for a root a screen reader can't reach", () => {
    document.body.innerHTML = `<div aria-hidden="true"><p id="r">Saved</p></div>`;
    const root = document.getElementById("r")!;
    expect(pageText(root, { announced: true })).toBe("");
    expect(pageText(root)).toBe("Saved");
  });

  it("reads text under visibility: hidden only where a child shows it again", () => {
    const root = mount(
      `<div style="visibility: hidden">gone <span style="visibility: visible">back</span></div>`,
    );
    expect(pageText(root)).toBe("back");
  });

  it("breaks lines at blocks and <br>, collapsing the markup's white space", () => {
    const root = mount(`
      <p>Dear   Sam,</p>
      <p>Thanks!<br>
         Jo</p>`);
    expect(pageText(root, { lines: true })).toBe("Dear Sam,\nThanks!\nJo");
    expect(pageText(root).replace(/\s+/g, " ").trim()).toBe(
      "Dear Sam, Thanks! Jo",
    );
  });

  it("keeps the white space a pre-wrap element keeps", () => {
    const root = mount(`<div style="white-space: pre-wrap">a  b\n c</div>`);
    expect(pageText(root, { lines: true })).toBe("a  b\n c");
  });

  it("notes the text nodes it read, when asked", () => {
    const root = mount(
      `Hi <b>there</b><span hidden>x</span><span aria-hidden="true">✓</span>`,
    );
    const texts: Text[] = [];
    pageText(root, { announced: true, texts });
    expect(texts.map((t) => t.data)).toEqual(["Hi ", "there"]);
    texts.length = 0;
    pageText(root, { texts });
    expect(texts.map((t) => t.data)).toEqual(["Hi ", "there", "✓"]);
  });

  it("reads only the text nodes keep accepts, layout kept", () => {
    const root = mount(`<p>Saved <span id="n">1</span> files</p><p>Done</p>`);
    const n = document.getElementById("n")!.firstChild;
    const texts: Text[] = [];
    const text = pageText(root, {
      lines: true,
      texts,
      keep: (node) => node !== n,
    });
    expect(text).toBe("Saved files\nDone");
    expect(texts.map((t) => t.data)).toEqual(["Saved ", " files", "Done"]);
  });

  it("reads slotted content where the shadow tree renders it", () => {
    const root = mount(`<div id="host"><span>middle</span></div>`);
    const shadow = document
      .getElementById("host")!
      .attachShadow({ mode: "open" });
    shadow.innerHTML = `first <slot></slot> last`;
    expect(pageText(root)).toBe("first middle last");
  });
});

describe("liveRegionLevel", () => {
  const level = (html: string) =>
    liveRegionLevel(mount(html).firstElementChild!);

  it("reads the politeness a live role implies", () => {
    expect(level(`<div role="alert"></div>`)).toBe("assertive");
    expect(level(`<div role="status"></div>`)).toBe("polite");
    expect(level(`<div role="log"></div>`)).toBe("polite");
    expect(level(`<div role="toast status"></div>`)).toBe("polite");
  });

  it("lets aria-live decide, with off meaning none", () => {
    expect(level(`<div aria-live="POLITE"></div>`)).toBe("polite");
    expect(level(`<div role="status" aria-live="assertive"></div>`)).toBe(
      "assertive",
    );
    expect(level(`<div role="alert" aria-live="off"></div>`)).toBeNull();
  });

  it("falls back to the role for an absent or invalid aria-live", () => {
    expect(level(`<div aria-live></div>`)).toBeNull();
    expect(level(`<div aria-live="none"></div>`)).toBeNull();
    expect(level(`<div role="alert" aria-live="polit"></div>`)).toBe(
      "assertive",
    );
    expect(level(`<p></p>`)).toBeNull();
  });
});
