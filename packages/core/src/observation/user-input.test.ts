import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PANEL_HOST_ATTRIBUTE } from "../extraction/overlay-reach.js";

import { watchUserInput, type UserInput } from "./user-input.js";

describe("watchUserInput", () => {
  let heard: UserInput[];
  let stop: () => void;
  let field: HTMLInputElement;

  beforeEach(() => {
    heard = [];
    field = document.body.appendChild(document.createElement("input"));
    stop = watchUserInput(document, (input) => heard.push(input));
  });

  afterEach(() => {
    stop();
    field.remove();
  });

  const key = (key: string) =>
    field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

  it("hears a press, a key, a click and typing in a field", () => {
    field.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    key("a");
    field.click();
    field.dispatchEvent(
      new InputEvent("input", { inputType: "insertText", bubbles: true }),
    );
    expect(heard).toEqual(["act", "act", "click", "type"]);
  });

  it("leaves out a modifier key on its own, and an input that isn't typing", () => {
    for (const k of ["Shift", "Control", "Alt", "Meta"]) key(k);
    // A checkbox's or a `<select>`'s: no `inputType`.
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(heard).toEqual([]);
  });

  it("leaves out what happens in one of this project's panels", () => {
    const panel = document.body.appendChild(document.createElement("div"));
    panel.setAttribute(PANEL_HOST_ATTRIBUTE, "");
    const button = panel
      .attachShadow({ mode: "open" })
      .appendChild(document.createElement("button"));
    try {
      button.click();
      expect(heard).toEqual([]);
    } finally {
      panel.remove();
    }
  });

  it("hears nothing once stopped", () => {
    stop();
    field.click();
    expect(heard).toEqual([]);
  });
});
