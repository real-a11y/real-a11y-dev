import { describe, it, expect } from "vitest";

import { pageClick } from "../native/native-core.js";

import {
  ACTABLE,
  isTypableRole,
  formatFacets,
  formatValue,
} from "./DogfoodPanel.js";

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

/**
 * The native tree originally withheld every field's current value outright —
 * R1's blanket exclusion of `valuenow`/`valuetext`. That under-served the
 * product's actual purpose: Screen Curtain mode has the user rely entirely on
 * the accessible tree, which for a value-bearing control means confirming
 * what they just typed. `formatValue` renders the read-back
 * `native-core.ts`'s `pageReadValue` now attaches, the same `= "value"`
 * convention the DOM/A11Y tree view uses.
 */
describe("formatValue", () => {
  const base = { id: "1", role: "textbox", name: "Name:", depth: 0 };

  it("renders nothing for a node with no value", () => {
    expect(formatValue(base)).toBe("");
  });

  it("renders the value quoted, right after the name", () => {
    expect(formatValue({ ...base, value: "456465" })).toBe(' = "456465"');
  });

  it("renders a redacted marker the same way, never the raw secret", () => {
    expect(formatValue({ ...base, value: "[redacted]" })).toBe(
      ' = "[redacted]"',
    );
  });
});

describe("isTypableRole", () => {
  it("treats a textbox as typable", () => {
    expect(isTypableRole("textbox")).toBe(true);
  });

  it("treats a searchbox as typable — same focus,type actions as textbox", () => {
    expect(isTypableRole("searchbox")).toBe(true);
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

/**
 * "Menu items are not interactive on native tree" — `menuitemradio` rows in
 * the ARIA APG menubar-editor example show a CLICK button in the DOM/A11Y
 * tree view but not here, because `ACTABLE` (this panel's own allowlist)
 * hadn't caught up with what the DOM producer's `getActions` already
 * recognizes and `pageClick`'s composite-redirect list already dispatches
 * correctly. These roles come straight from `getActions`'s ARIA role-based
 * branches (`core/src/extraction/dom-extractor.ts`).
 */
describe("ACTABLE", () => {
  it("recognizes every role the DOM producer's getActions treats as clickable that isn't also a plain native element's implicit role", () => {
    for (const role of [
      "button",
      "link",
      "checkbox",
      "radio",
      "switch",
      "combobox",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "tab",
      "treeitem",
      "gridcell",
    ]) {
      expect(ACTABLE.has(role)).toBe(true);
    }
  });

  it("excludes slider/spinbutton — the DOM producer gives them increment/decrement, not click", () => {
    expect(ACTABLE.has("slider")).toBe(false);
    expect(ACTABLE.has("spinbutton")).toBe(false);
  });

  it("excludes bare cell — pageClick redirects it for safety, but getActions never treats it as actionable", () => {
    expect(ACTABLE.has("cell")).toBe(false);
  });

  /**
   * `row`, `listbox`, and `option` each have a getActions click branch, but
   * they are also the IMPLICIT ARIA role of a plain native element (`<tr>`,
   * `<select multiple>`, `<option>` — `core/src/extraction/role-map.ts`),
   * which Chromium's own AX tree reports identically with no ARIA authoring.
   * getActions only reaches those branches off the element's LITERAL `role`
   * attribute (a plain `<tr>` never has one), so a native-tree node — which
   * carries only a role string, no tag — can't tell a real table row/select/
   * option apart from a custom ARIA-authored one. Offering CLICK on every
   * table row and native dropdown would misfire far more than it would help.
   */
  it("excludes row/listbox/option — indistinguishable from a plain native element on a role-only tree", () => {
    expect(ACTABLE.has("row")).toBe(false);
    expect(ACTABLE.has("listbox")).toBe(false);
    expect(ACTABLE.has("option")).toBe(false);
  });

  /**
   * Every wrapper-composite role in ACTABLE must also be one `pageClick`
   * redirects past the wrapper to its inner control — otherwise offering a
   * CLICK button here would dispatch a click on the wrong element. Asserted
   * by stringifying `pageClick` (it is serialized as source text for
   * `Runtime.callFunctionOn`, so its own composite list is a plain string
   * literal in the function body) rather than importing a shared constant,
   * since the two lists are deliberately hand-kept-in-step, not derived from
   * one source — same pattern as `nativeIdOf`.
   */
  it("keeps its wrapper-composite roles in lockstep with pageClick's redirect list", () => {
    const source = pageClick.toString();
    const wrapperComposites = [
      "treeitem",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "tab",
      "gridcell",
    ];
    for (const role of wrapperComposites) {
      expect(ACTABLE.has(role)).toBe(true);
      expect(source).toContain(`"${role}"`);
    }
  });
});
