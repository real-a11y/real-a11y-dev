import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  MultiStepFormBroken,
  MultiStepFormCorrect,
} from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

const steps = [
  { id: "account", label: "Account" },
  { id: "profile", label: "Profile" },
  { id: "review", label: "Review" },
];

describe("Content pattern: Multi-step form — correct vs broken", () => {
  it("correct form uses <ol aria-label='Progress'>, aria-current='step', fieldset/legend, aria-invalid + role='alert'", () => {
    const { container, getByRole } = render(
      <MultiStepFormCorrect steps={steps} />,
    );

    // Progress indicator is a named list with the active step marked.
    const progress = container.querySelector('ol[aria-label="Progress"]');
    expect(progress).not.toBeNull();
    const current = progress?.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain("Account");

    // Each step is wrapped in a <fieldset><legend>.
    const fieldset = container.querySelector("fieldset");
    expect(fieldset).not.toBeNull();
    expect(fieldset?.querySelector("legend")?.textContent).toBe("Account");

    // Trigger validation: Next without filling email.
    fireEvent.click(getByRole("button", { name: /next/i }));

    const input = container.querySelector("input");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(input?.getAttribute("aria-describedby")).toBeTruthy();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("required");
  });

  it("correct form's forward button stays operable through Submit on the last step", () => {
    const { container, getByRole } = render(
      <MultiStepFormCorrect steps={steps} />,
    );

    // Fill the required field so step 0 can advance.
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "ada@example.com" } });

    // Step 0 → 1 → 2. On the last step the label becomes "Submit".
    fireEvent.click(getByRole("button", { name: /next/i }));
    fireEvent.click(getByRole("button", { name: /next/i }));

    const submit = getByRole("button", { name: /submit/i });
    // Regression: the Submit button must NOT be disabled (it used to be
    // gated by `disabled={current === steps.length - 1}`, making the
    // final action permanently dead).
    expect(submit.hasAttribute("disabled")).toBe(false);

    fireEvent.click(submit);

    // Submission is announced via a role="status" region.
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("submitted");
  });

  it("broken form has no aria-current, no fieldset/legend, and errors are unlinked <p>s", () => {
    const { container, getByRole } = render(
      <MultiStepFormBroken steps={steps} />,
    );

    expect(container.querySelector("[aria-current]")).toBeNull();
    expect(container.querySelector("fieldset")).toBeNull();
    expect(container.querySelector("legend")).toBeNull();

    fireEvent.click(getByRole("button", { name: /next/i }));

    const input = container.querySelector("input");
    expect(input?.getAttribute("aria-invalid")).toBeNull();
    expect(input?.getAttribute("aria-describedby")).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
