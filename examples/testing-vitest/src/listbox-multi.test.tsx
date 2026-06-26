import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  ListboxMultiBroken,
  ListboxMultiCorrect,
} from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

const options = [
  { id: "a", label: "Apples" },
  { id: "b", label: "Bananas" },
  { id: "c", label: "Cherries" },
  { id: "d", label: "Dates" },
];

describe("APG multi-select Listbox — correct vs broken", () => {
  it("React Aria multi-listbox exposes aria-multiselectable + per-option aria-selected", () => {
    const { container } = render(
      <ListboxMultiCorrect
        label="Fruits"
        options={options}
        defaultSelectedIds={["a", "c"]}
      />,
    );

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox?.getAttribute("aria-multiselectable")).toBe("true");
    expect(listbox?.getAttribute("aria-label")).toBe("Fruits");

    const selected = container.querySelectorAll(
      '[role="option"][aria-selected="true"]',
    );
    // Two options start selected
    expect(selected.length).toBe(2);
    // textContent includes the decorative ✓ glyph React Aria-paired with
    // the row — use a contains-match against the option label instead.
    const selectedText = [...selected]
      .map((el) => el.textContent ?? "")
      .join(" | ");
    expect(selectedText).toContain("Apples");
    expect(selectedText).toContain("Cherries");
  });

  it("hand-rolled broken multi-listbox has no listbox role and no aria-multiselectable", () => {
    const { container } = render(
      <ListboxMultiBroken
        label="Fruits"
        options={options}
        defaultSelectedIds={["a", "c"]}
      />,
    );

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.querySelector('[role="option"]')).toBeNull();
    expect(container.querySelector("[aria-multiselectable]")).toBeNull();
    expect(container.querySelector("[aria-selected]")).toBeNull();

    // Selection is conveyed via native checkboxes — visible/clickable,
    // just not via the listbox / option role chain.
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBe(4);
    const checkedBoxes = [...boxes].filter(
      (b) => (b as HTMLInputElement).checked,
    );
    expect(checkedBoxes.length).toBe(2);
  });
});
