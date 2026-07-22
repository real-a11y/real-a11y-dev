import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  DisclosureCorrect,
  DisclosureBroken,
} from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

// `disclosure.test.ts` (existing) tests a different Disclosure
// component from this example app. This file covers the APG-pattern
// Disclosure shipped by @real-a11y-dev/example-patterns.
describe("APG Disclosure — correct vs broken", () => {
  it("Radix disclosure trigger has aria-expanded; aria-controls only when open", () => {
    // Radix ≥1.1.13 omits aria-controls while collapsed because the
    // content node is removed from the DOM — referencing a missing id is
    // worse than omitting the attribute.
    const { getByRole } = render(
      <DisclosureCorrect trigger="Details" defaultOpen={false}>
        <p>Body</p>
      </DisclosureCorrect>,
    );
    const trigger = getByRole("button", { name: "Details" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).not.toBeNull();
  });

  it("hand-rolled broken disclosure trigger has neither attribute", () => {
    const { getByRole } = render(
      <DisclosureBroken trigger="Details" defaultOpen={false}>
        <p>Body</p>
      </DisclosureBroken>,
    );
    const trigger = getByRole("button", { name: "Details" });
    expect(trigger.getAttribute("aria-expanded")).toBeNull();
    expect(trigger.getAttribute("aria-controls")).toBeNull();
  });
});
