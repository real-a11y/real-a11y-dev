import { describe, it, expect } from "vitest";

import type { NativeNode } from "../native/native-actions.js";

import {
  findNativeModalDialog,
  nativeActionFeedback,
} from "./native-feedback.js";

function node(
  role: string,
  name: string,
  states: NativeNode["states"] = {},
  id = `n-${role}`,
): NativeNode {
  return { id, role, name, depth: 1, childIds: [], states, properties: {} };
}

describe("nativeActionFeedback", () => {
  it("names a clicked node by its name, never its id", () => {
    expect(nativeActionFeedback(node("button", "Save"), "click")).toBe(
      "Click: Save",
    );
  });

  it("reads a checkbox's new state from the state it had before", () => {
    expect(
      nativeActionFeedback(
        node("checkbox", "Remember me", { checked: false }),
        "click",
      ),
    ).toBe("Checked: Remember me");
    expect(
      nativeActionFeedback(node("switch", "Wi-Fi", { checked: true }), "click"),
    ).toBe("Unchecked: Wi-Fi");
  });

  it("says Click for a mixed checkbox, whose outcome it can't know", () => {
    expect(
      nativeActionFeedback(
        node("checkbox", "Select all", { checked: "mixed" }),
        "click",
      ),
    ).toBe("Click: Select all");
  });

  it("says Selected for a radio and an option", () => {
    expect(nativeActionFeedback(node("radio", "Small"), "click")).toBe(
      "Selected: Small",
    );
    expect(nativeActionFeedback(node("option", "Spain"), "select")).toBe(
      "Selected: Spain",
    );
  });

  it("says Typed in for a field", () => {
    expect(nativeActionFeedback(node("textbox", "Email"), "type")).toBe(
      "Typed in Email",
    );
  });

  it("shows nothing for a step, as the DOM tree doesn't", () => {
    expect(nativeActionFeedback(node("slider", "Volume"), "increment")).toBe(
      null,
    );
    expect(nativeActionFeedback(node("slider", "Volume"), "decrement")).toBe(
      null,
    );
  });

  it("words a link's click as the DOM tree does, as a navigation", () => {
    expect(nativeActionFeedback(node("link", "Home"), "click")).toBe(
      "Navigate: Home",
    );
  });

  it("words a reveal as a focus", () => {
    expect(nativeActionFeedback(node("textbox", "Email"), "reveal")).toBe(
      "Focus: Email",
    );
  });

  it("says Click for a menu item, as the DOM tree does", () => {
    expect(
      nativeActionFeedback(
        node("menuitemcheckbox", "Bold", { checked: false }),
        "click",
      ),
    ).toBe("Click: Bold");
    expect(nativeActionFeedback(node("menuitemradio", "Large"), "click")).toBe(
      "Click: Large",
    );
  });

  it("falls back to the role for an unnamed node, and copes with none", () => {
    expect(nativeActionFeedback(node("button", ""), "click")).toBe(
      "Click: button",
    );
    expect(nativeActionFeedback(undefined, "click")).toBe("Click: element");
  });
});

describe("findNativeModalDialog", () => {
  it("finds a dialog or alertdialog that Chromium marks modal", () => {
    const modal = node("alertdialog", "Delete?", { modal: true }, "d2");
    const nodes = new Map([
      ["d1", node("dialog", "Non-modal", {}, "d1")],
      ["d2", modal],
    ]);
    expect(findNativeModalDialog(nodes)).toBe(modal);
  });

  it("finds nothing when no dialog is modal", () => {
    const nodes = new Map([
      ["d1", node("dialog", "Settings", { modal: false }, "d1")],
      ["b", node("button", "Open", {}, "b")],
    ]);
    expect(findNativeModalDialog(nodes)).toBeUndefined();
  });
});

describe("selecting an option row", () => {
  /** A drop-down `<select>` as the native tree reads it: the combobox, its
   *  popup, and two options, "11" chosen. */
  function select(valueWithheld: boolean | undefined) {
    const nodes = new Map<string, NativeNode>([
      [
        "sel",
        {
          ...node("combobox", "Expiry month", {}, "sel"),
          childIds: ["popup"],
          ...(valueWithheld === undefined ? {} : { valueWithheld }),
        },
      ],
      [
        "popup",
        { ...node("MenuListPopup", "", {}, "popup"), childIds: ["o1", "o2"] },
      ],
      ["o1", node("option", "01", {}, "o1")],
      ["o2", node("option", "11", {}, "o2")],
    ]);
    return nodes;
  }

  it("names only the field of a sensitive select, never the option", () => {
    const nodes = select(true);
    expect(nativeActionFeedback(nodes.get("o2"), "select", nodes)).toBe(
      "Selected an option in Expiry month",
    );
  });

  it("fails closed for a select it couldn't classify", () => {
    const nodes = select(undefined);
    expect(nativeActionFeedback(nodes.get("o2"), "select", nodes)).toBe(
      "Selected an option in Expiry month",
    );
  });

  it("names the option of a select classified as not sensitive", () => {
    const nodes = select(false);
    expect(nativeActionFeedback(nodes.get("o2"), "select", nodes)).toBe(
      "Selected: 11",
    );
  });

  it("names a list box's option unless it sits inside a sensitive field", () => {
    expect(nativeActionFeedback(node("option", "Books"), "select")).toBe(
      "Selected: Books",
    );
    expect(
      nativeActionFeedback(
        { ...node("option", "2041"), valueWithheld: true },
        "select",
      ),
    ).toBe("Selected an option in this field");
  });
});
