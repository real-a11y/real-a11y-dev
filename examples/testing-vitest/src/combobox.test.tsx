import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  ComboboxBroken,
  ComboboxCorrect,
} from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

const options = [
  { id: "apple", label: "Apple" },
  { id: "banana", label: "Banana" },
  { id: "cherry", label: "Cherry" },
];

// React Aria's combobox lives in the closed state on first render —
// the listbox is portaled and not present until the popover opens.
// Assert on the *trigger-side* metadata, which is the most visible
// difference between the correct and broken variants.
describe("APG Combobox — correct vs broken", () => {
  it("React Aria combobox exposes role=combobox + aria-expanded on the input", () => {
    const { container } = render(
      <ComboboxCorrect label="Fruit" options={options} />,
    );

    const combobox = container.querySelector('[role="combobox"]');
    expect(combobox).not.toBeNull();
    expect(combobox?.tagName.toLowerCase()).toBe("input");
    // aria-expanded is set on the combobox (closed by default).
    // aria-controls is wired only after the popover opens — assert
    // on what's stable in the closed state instead.
    expect(combobox?.getAttribute("aria-expanded")).toBe("false");
    expect(combobox?.getAttribute("aria-autocomplete")).toBe("list");
  });

  it("hand-rolled broken combobox has no combobox role and no aria-expanded", () => {
    const { container } = render(
      <ComboboxBroken label="Fruit" options={options} />,
    );

    expect(container.querySelector('[role="combobox"]')).toBeNull();

    const input = container.querySelector("input");
    expect(input).not.toBeNull();
    // Plain text input — no combobox metadata
    expect(input?.getAttribute("role")).toBeNull();
    expect(input?.getAttribute("aria-expanded")).toBeNull();
    expect(input?.getAttribute("aria-controls")).toBeNull();
    expect(input?.getAttribute("aria-autocomplete")).toBeNull();
  });
});
