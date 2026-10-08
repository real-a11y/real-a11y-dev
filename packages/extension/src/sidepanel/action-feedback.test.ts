import { describe, it, expect } from "vitest";

import { describeAction } from "./action-feedback.js";

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

  it("says nothing for a step", () => {
    expect(describeAction({ role: "slider", name: "V" }, "increment")).toBe(
      null,
    );
    expect(describeAction({ role: "spinbutton", name: "Q" }, "decrement")).toBe(
      null,
    );
  });
});
