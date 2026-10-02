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
