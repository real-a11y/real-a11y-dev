import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ListboxBroken, ListboxCorrect } from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

const options = [
  { id: "low", label: "Low" },
  { id: "med", label: "Medium" },
  { id: "high", label: "High" },
];

describe("APG Listbox — correct vs broken", () => {
  it("React Aria listbox exposes role=listbox + option children with aria-selected", () => {
    const { container } = render(
      <ListboxCorrect
        label="Priority"
        options={options}
        defaultSelectedId="med"
      />,
    );

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox?.getAttribute("aria-label")).toBe("Priority");

    const optionEls = container.querySelectorAll('[role="option"]');
    expect(optionEls.length).toBe(3);

    const selected = container.querySelector(
      '[role="option"][aria-selected="true"]',
    );
    expect(selected?.textContent).toBe("Medium");
  });

  it("hand-rolled broken listbox has no listbox/option roles or aria-selected", () => {
    const { container } = render(
      <ListboxBroken
        label="Priority"
        options={options}
        defaultSelectedId="med"
      />,
    );

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.querySelector('[role="option"]')).toBeNull();
    expect(container.querySelector("[aria-selected]")).toBeNull();

    // Items render as plain buttons — visible and clickable, just no AT signal.
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(3);
  });
});
