import { describe, it, expect } from "vitest";

import { isTypableRole, formatFacets } from "./DogfoodPanel.js";

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
describe("formatFacets", () => {
  // core's normalizeNativeAX (the shared, structural, version-pinned module)
  // never populated states/properties at all — expanded, level and friends
  // were invisible in native mode even though the same widget's DOM/A11Y tree
  // view showed them right next to it. This is the enrichment that closes
  // that gap, formatted the same way TreeNode.tsx badges a DOM node's states
  // (bare key for true, key=value otherwise, false omitted) so the two trees
  // read comparably side by side during the dogfood.
  const base = { id: "1", role: "button", name: "Billing Address", depth: 0 };

  it("renders nothing for a node with no states or properties", () => {
    expect(formatFacets(base)).toBe("");
  });

  it("renders a bare key for a true boolean state", () => {
    expect(formatFacets({ ...base, states: { expanded: true } })).toBe(
      " [expanded]",
    );
  });

  it("omits a false state entirely rather than printing expanded=false", () => {
    expect(formatFacets({ ...base, states: { expanded: false } })).toBe("");
  });

  it("renders key=value for a non-boolean state (a tristate) and a property", () => {
    expect(
      formatFacets({
        ...base,
        states: { pressed: "mixed" },
        properties: { level: "2" },
      }),
    ).toBe(" [pressed=mixed level=2]");
  });
});

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
