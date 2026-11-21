import { describe, it, expect } from "vitest";

import { describeAction, describeSelection } from "./action-feedback.js";

describe("describeAction", () => {
  it("says the action's label and the node's name", () => {
    expect(describeAction({ role: "button", name: "Save" }, "click")).toBe(
      "Click: Save",
    );
    expect(describeAction({ role: "link", name: "Home" }, "navigate")).toBe(
      "Navigate: Home",
    );
  });

  it("says what a checkbox or switch became", () => {
    expect(
      describeAction(
        { role: "checkbox", name: "Remember me", checked: false },
        "click",
      ),
    ).toBe("Checked: Remember me");
    expect(
      describeAction(
        { role: "switch", name: "Wi-Fi", checked: true },
        "toggle",
      ),
    ).toBe("Unchecked: Wi-Fi");
  });

  it("says the plain label for a mixed checkbox", () => {
    expect(
      describeAction(
        { role: "checkbox", name: "Select all", checked: "mixed" },
        "click",
      ),
    ).toBe("Click: Select all");
  });

  it("says Selected for a radio and a selection, Typed in for a field", () => {
    expect(describeAction({ role: "radio", name: "Small" }, "click")).toBe(
      "Selected: Small",
    );
    expect(describeAction({ role: "option", name: "Spain" }, "select")).toBe(
      "Selected: Spain",
    );
    expect(describeAction({ role: "textbox", name: "Email" }, "type")).toBe(
      "Typed in Email",
    );
  });

  it("names no item whose choice the tree withholds", () => {
    // A TAB row: a radio or menu item with no `checked`, which ARIA
    // requires of it, had it withheld in a sensitive field's popup; one that
    // carries its state names itself.
    for (const role of ["radio", "menuitemradio", "menuitemcheckbox"]) {
      expect(
        describeAction({ role, name: "03/31", states: {} }, "click"),
        role,
      ).toBe("Selected an option in this field");
    }
    // An option or tree item often carries no state at all: an ordinary
    // tree branch names itself.
    for (const role of ["treeitem", "option"]) {
      expect(
        describeAction({ role, name: "Docs", states: {} }, "click"),
        role,
      ).toBe("Click: Docs");
    }
    expect(
      describeAction(
        { role: "menuitemradio", name: "Red", states: { checked: false } },
        "click",
      ),
    ).toBe("Click: Red");
    // A checkbox is its own control.
    expect(
      describeAction({ role: "checkbox", name: "Save", states: {} }, "click"),
    ).toBe("Checked: Save");
    // A native row's verdict decides, never the missing state.
    expect(
      describeAction(
        { role: "menuitemradio", name: "03/31", valueWithheld: true },
        "click",
      ),
    ).toBe("Selected an option in this field");
    expect(
      describeAction(
        { role: "treeitem", name: "Docs", states: {}, valueWithheld: false },
        "click",
      ),
    ).toBe("Click: Docs");
  });

  it("says nothing for a step", () => {
    expect(describeAction({ role: "slider", name: "V" }, "increment")).toBe(
      null,
    );
    expect(describeAction({ role: "spinbutton", name: "Q" }, "decrement")).toBe(
      null,
    );
  });
});

describe("describeSelection", () => {
  it("names the option chosen in an ordinary select", () => {
    expect(describeSelection("Country", "Spain", false)).toBe(
      "Selected: Spain",
    );
  });

  it("names only the field for a sensitive one, never the option", () => {
    expect(describeSelection("Expiry month", "02", true)).toBe(
      "Selected an option in Expiry month",
    );
  });
});
