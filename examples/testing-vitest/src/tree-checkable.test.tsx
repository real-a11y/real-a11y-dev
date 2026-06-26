import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  TreeCheckableBroken,
  TreeCheckableCorrect,
} from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

const nodes = [
  {
    id: "fruits",
    label: "Fruits",
    children: [
      { id: "apple", label: "Apple" },
      { id: "banana", label: "Banana" },
      { id: "cherry", label: "Cherry" },
    ],
  },
  {
    id: "veg",
    label: "Vegetables",
    children: [
      { id: "carrot", label: "Carrot" },
      { id: "potato", label: "Potato" },
    ],
  },
];

describe("APG Tree with checkboxes — correct vs broken", () => {
  it("correct tree exposes aria-checked tri-state (true/false/mixed) on every treeitem", () => {
    const { container } = render(
      <TreeCheckableCorrect
        label="Inventory"
        nodes={nodes}
        defaultExpandedIds={["fruits", "veg"]}
        defaultCheckedIds={["apple"]}
      />,
    );

    const tree = container.querySelector('[role="tree"]');
    expect(tree).not.toBeNull();
    expect(tree?.getAttribute("aria-label")).toBe("Inventory");

    const treeitems = container.querySelectorAll('[role="treeitem"]');
    // 2 parents + 3 + 2 children = 7 visible items
    expect(treeitems.length).toBe(7);

    // Find rows by their visible label.
    function rowFor(label: string) {
      return [...treeitems].find((el) => el.textContent?.includes(label));
    }

    // Parent of one checked child (apple) → mixed
    expect(rowFor("Fruits")?.getAttribute("aria-checked")).toBe("mixed");
    // Parent with no checked descendants → false
    expect(rowFor("Vegetables")?.getAttribute("aria-checked")).toBe("false");
    // Checked leaf → true
    expect(rowFor("Apple")?.getAttribute("aria-checked")).toBe("true");
    // Unchecked leaf → false
    expect(rowFor("Banana")?.getAttribute("aria-checked")).toBe("false");
  });

  it("broken tree has no tree/treeitem roles and no aria-checked", () => {
    const { container } = render(
      <TreeCheckableBroken
        label="Inventory"
        nodes={nodes}
        defaultExpandedIds={["fruits", "veg"]}
        defaultCheckedIds={["apple"]}
      />,
    );

    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(container.querySelector('[role="treeitem"]')).toBeNull();
    expect(container.querySelector("[aria-checked]")).toBeNull();
    expect(container.querySelector("[aria-level]")).toBeNull();

    // Visually a nested list with native checkboxes — selection is
    // visible, just no group-level role chain or tri-state.
    expect(container.querySelectorAll("ul").length).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('input[type="checkbox"]').length,
    ).toBeGreaterThan(0);
  });
});
