import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  DialogNestedBroken,
  DialogNestedCorrect,
} from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

// Radix dialogs portal into <body> and rely on focus-stack management
// that's hard to drive cleanly through jsdom. Assert on the *outer*
// trigger metadata only — that's the most stable signal and matches
// what the inspector panel surfaces before the dialog opens.
describe("APG nested Dialog — correct vs broken", () => {
  it("Radix nested dialog outer trigger announces aria-expanded + aria-haspopup", () => {
    const { getByRole } = render(
      <DialogNestedCorrect
        outerTrigger="Open settings"
        outerTitle="Settings"
        innerTrigger="Confirm action"
        innerTitle="Confirm"
      />,
    );

    const outerTrigger = getByRole("button", { name: "Open settings" });
    expect(outerTrigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(outerTrigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("hand-rolled broken nested dialog: outer trigger has no aria-haspopup or aria-expanded", () => {
    const { getByRole } = render(
      <DialogNestedBroken
        outerTrigger="Open settings"
        outerTitle="Settings"
        innerTrigger="Confirm action"
        innerTitle="Confirm"
      />,
    );

    const outerTrigger = getByRole("button", { name: "Open settings" });
    expect(outerTrigger.getAttribute("aria-haspopup")).toBeNull();
    expect(outerTrigger.getAttribute("aria-expanded")).toBeNull();
  });
});
