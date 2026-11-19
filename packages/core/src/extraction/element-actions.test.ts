import { describe, it, expect } from "vitest";

import { getActions } from "./element-actions.js";

function make(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild!;
}

describe("getActions", () => {
  it("lets a tag's empty answer stand over the role", () => {
    expect(getActions(make('<input type="hidden" role="button">'))).toEqual([]);
  });

  it("falls through to the role when a link is not live", () => {
    expect(getActions(make('<a role="button">x</a>'))).toEqual(["click"]);
  });

  it("types into an editable combobox and clicks a select-only one", () => {
    expect(
      getActions(make('<div role="combobox" contenteditable="true"></div>')),
    ).toEqual(["focus", "type"]);
    expect(getActions(make('<div role="combobox"></div>'))).toEqual(["click"]);
  });

  it("offers submit on a submit input and stepping on a number input", () => {
    expect(getActions(make('<input type="submit">'))).toEqual([
      "click",
      "submit",
    ]);
    expect(getActions(make('<input type="number">'))).toEqual([
      "focus",
      "type",
      "increment",
      "decrement",
    ]);
  });

  it("falls back to type for a bare editing host and click for tabindex", () => {
    expect(getActions(make('<div contenteditable="true"></div>'))).toEqual([
      "focus",
      "type",
    ]);
    expect(getActions(make('<div tabindex="0"></div>'))).toEqual(["click"]);
  });
});
