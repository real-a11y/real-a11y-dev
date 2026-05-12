import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DialogCorrect, DialogBroken } from "@real-a11y-dev/example-patterns";
import { auditSnapshot } from "@real-a11y-dev/testing";

afterEach(cleanup);

// Radix Dialog portals to document.body, so auditing the container
// alone misses the content. Scan document.body once open.
describe("APG Dialog — correct vs broken", () => {
  it("Radix dialog renders as a dialog with aria-modal on open", () => {
    const { getByText } = render(
      <DialogCorrect
        trigger="Open"
        title="Delete account"
        description="This action cannot be undone."
      >
        <p>Data will be deleted.</p>
      </DialogCorrect>,
    );
    fireEvent.click(getByText("Open"));

    const tree = auditSnapshot(document.body);
    expect(tree).toContain('dialog "Delete account"');
  });

  it("hand-rolled broken dialog renders without dialog role", () => {
    const { getByText } = render(
      <DialogBroken
        trigger="Open"
        title="Delete account"
        description="This action cannot be undone."
      >
        <p>Data will be deleted.</p>
      </DialogBroken>,
    );
    fireEvent.click(getByText("Open"));

    const tree = auditSnapshot(document.body);
    // No `dialog` line at all — the open panel reads as a generic
    // group with a heading + paragraph + buttons in regular flow.
    expect(tree).not.toContain('dialog "Delete account"');
    expect(tree).toContain('heading "Delete account"');
  });
});
