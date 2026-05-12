import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ToastCorrect, ToastBroken } from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

// Live regions are about announcement, not visual structure — assert
// on the actual DOM attributes here. The audit-snapshot view doesn't
// always show the `status` role row consistently across Radix's
// portal mount/unmount lifecycle in jsdom.
describe("APG Toast — correct vs broken", () => {
  it("Radix toast wraps content in a status role (aria-live)", () => {
    const { getByText } = render(
      <ToastCorrect
        trigger="Save"
        title="Saved"
        description="Your changes are stored."
      />,
    );
    fireEvent.click(getByText("Save"));

    // Radix Toast applies role="status" to the toast root once open
    // (or aria-live="polite"). It portals to document.body, so query
    // the whole document. The visible content is announced via a
    // companion live region populated asynchronously, so we assert
    // on role presence — content-announcement timing is fragile in
    // jsdom and belongs in a Playwright e2e test.
    const status = document.querySelector('[role="status"]');
    expect(status).not.toBeNull();
  });

  it("hand-rolled broken toast renders content but no role", () => {
    const { getByText } = render(
      <ToastBroken
        trigger="Save"
        title="Saved"
        description="Your changes are stored."
      />,
    );
    fireEvent.click(getByText("Save"));

    // No role="status" anywhere — the toast is visible only.
    const status = document.querySelector('[role="status"]');
    expect(status).toBeNull();
  });
});
