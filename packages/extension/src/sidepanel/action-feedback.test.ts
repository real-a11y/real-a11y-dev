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
    // The row's verdict decides, for every choice item: a native row's own
    // `valueWithheld`, a TAB row's from the content script's reply.
    for (const role of [
      "option",
      "treeitem",
      "radio",
      "menuitemradio",
      "menuitemcheckbox",
    ]) {
      expect(
        describeAction(
          { role, name: "03/31", states: {}, valueWithheld: true },
          "click",
        ),
        role,
      ).toBe("Selected an option in this field");
    }
    // Never the missing state: an option or tree item often carries none.
    for (const role of ["treeitem", "option"]) {
      expect(
        describeAction(
          { role, name: "Docs", states: {}, valueWithheld: false },
          "click",
        ),
        role,
      ).toBe("Click: Docs");
    }
    expect(
      describeAction(
        {
          role: "menuitemradio",
          name: "Red",
          states: {},
          valueWithheld: false,
        },
        "click",
      ),
    ).toBe("Click: Red");
    // A checkbox is its own control, whatever the verdict.
    expect(
      describeAction(
        { role: "checkbox", name: "Save", states: {}, valueWithheld: true },
        "click",
      ),
    ).toBe("Checked: Save");
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
