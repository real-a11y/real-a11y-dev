import { describe, it, expect } from "vitest";

import { isTypableRole } from "./DogfoodPanel.js";

/**
 * ARIA overloads `combobox` across two shapes the native tree's flat
 * role/name/depth data can't tell apart: an editable autocomplete input, and
 * the ARIA APG "Combobox (Select-Only)" pattern — a non-editable trigger that
 * behaves like a `<select>`. Prompting for text on the latter opened a
 * browser `prompt()` dialog and then dispatched a `type` the page had nowhere
 * to put — `pageType` correctly refused it as `not-a-text-field`, but the
 * dogfooder had already answered a modal for nothing when what they wanted
 * was to click the combobox open. Only `textbox` is unambiguously editable.
 */
describe("isTypableRole", () => {
  it("treats a textbox as typable", () => {
    expect(isTypableRole("textbox")).toBe(true);
  });

  it("does not treat a combobox as typable — it may be select-only", () => {
    expect(isTypableRole("combobox")).toBe(false);
  });

  it("does not treat any other actable role as typable", () => {
    for (const role of [
      "button",
      "link",
      "checkbox",
      "radio",
      "switch",
      "tab",
      "menuitem",
    ]) {
      expect(isTypableRole(role)).toBe(false);
    }
  });
});
