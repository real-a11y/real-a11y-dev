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
