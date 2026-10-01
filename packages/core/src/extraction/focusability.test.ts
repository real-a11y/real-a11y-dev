import { afterEach, describe, expect, it, vi } from "vitest";

import { shadow } from "../test-support/clobber.js";

import {
  isActuallyDisabled,
  isFocusable,
  parseTabindex,
} from "./focusability.js";

/**
 * Most of these rules are tested through the walk, in dom-extractor.test.ts
 * and query.test.ts. The ones here are the elements the walk never emits,
 * because the UA stylesheet gives them `display: none`: jsdom's and Chromium's
 * both, for a hidden input, and for an `<area>` since Chromium 153 (151
 * rendered one inline).
 */
function build(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("isFocusable", () => {
  it("never counts a hidden input, not even with a tabindex", () => {
    const root = build(
      '<input type="hidden" value="csrf">' +
        '<input type="HIDDEN" tabindex="0" value="csrf">',
    );
    for (const input of root.querySelectorAll("input")) {
      expect(isFocusable(input)).toBe(false);
    }
  });

  // Checked in Chromium 151: it focuses a map's areas only while an image
  // uses the map, whichever map the image actually resolves to.
  it("counts an area only while an image uses its map", () => {
    const root = build(`
      <img src="x.gif" alt="Site map" usemap="#nav">
      <map name="nav"><area id="used" href="/home" alt="Home"></map>
      <map name="nav"><area id="duplicate" href="/home" alt="Home"></map>
      <img src="x.gif" alt="Plan" usemap="#floor">
      <map id="floor"><area id="by-id" href="/room" alt="Room"></map>
      <map name="unused"><area id="orphan" href="/old" alt="Old"></map>
      <img src="x.gif" alt="Case" usemap="#Case">
      <map name="case"><area id="case" href="/c" alt="C"></map>
      <img src="x.gif" alt="No hash" usemap="plain">
      <map name="plain"><area id="no-hash" href="/p" alt="P"></map>
      <img src="x.gif" alt="Nav" usemap="#nav2">
      <map name="nav2"><area id="no-href" alt="Nothing"></map>
    `);
    const focusable = (id: string) =>
      isFocusable(root.querySelector(`#${id}`)!);
    expect(focusable("used")).toBe(true);
    expect(focusable("duplicate")).toBe(true);
    expect(focusable("by-id")).toBe(true);
    expect(focusable("orphan")).toBe(false);
    // usemap matches case-sensitively, and only as "#name".
    expect(focusable("case")).toBe(false);
    expect(focusable("no-hash")).toBe(false);
    expect(focusable("no-href")).toBe(false);
  });

  // `<input name="tagName">` makes a form's `tagName` that input. Whether a
  // summary is its details' toggle is read off its parent and its siblings,
  // either of which can be that form.
  it("answers for a form whose control shadows tagName, and the summaries beside it", () => {
    const root = build(`
      <form id="loose"><input name="tagName"><summary>Loose</summary></form>
      <details><form><input name="tagName"></form><summary>More</summary></details>
    `);
    for (const form of root.querySelectorAll("form")) shadow(form, "tagName");

    expect(isFocusable(root.querySelector("#loose")!)).toBe(false);
    // Not a details' summary: plain text to Chromium.
    expect(isFocusable(root.querySelector("#loose summary")!)).toBe(false);
    // The details' first summary, though a form comes before it.
    expect(isFocusable(root.querySelector("details summary")!)).toBe(true);
  });
});

describe("isActuallyDisabled", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the element's own attribute without :disabled", () => {
    const root = build(`
      <fieldset disabled>
        <button id="own" disabled>Save</button>
        <button id="inherited">Send</button>
      </fieldset>
    `);
    vi.spyOn(Element.prototype, "matches").mockImplementation(() => {
      throw new SyntaxError("unsupported selector");
    });
    expect(isActuallyDisabled(root.querySelector("#own")!)).toBe(true);
    // The fallback misses the fieldset case, and only that.
    expect(isActuallyDisabled(root.querySelector("#inherited")!)).toBe(false);
  });
});

describe("parseTabindex", () => {
  it("parses the way HTML parses an integer", () => {
    expect(parseTabindex(null)).toBeNull();
    expect(parseTabindex(undefined)).toBeNull();
    expect(parseTabindex("")).toBeNull();
    expect(parseTabindex("abc")).toBeNull();
    expect(parseTabindex(" 0")).toBeNull();
    expect(parseTabindex("0")).toBe(0);
    expect(parseTabindex(" \t2")).toBe(2);
    expect(parseTabindex("+3")).toBe(3);
    expect(parseTabindex("-1")).toBe(-1);
    expect(parseTabindex("1abc")).toBe(1);
    expect(parseTabindex("2.5")).toBe(2);
  });
});
