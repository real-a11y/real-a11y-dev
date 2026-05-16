import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  TreeViewBroken,
  TreeViewCorrect,
} from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

const nodes = [
  {
    id: "src",
    label: "src",
    children: [
      { id: "src/index.ts", label: "index.ts" },
      {
        id: "src/components",
        label: "components",
        children: [
          { id: "src/components/Button.tsx", label: "Button.tsx" },
          { id: "src/components/Input.tsx", label: "Input.tsx" },
        ],
      },
    ],
  },
  { id: "package.json", label: "package.json" },
];

// React Aria's <Tree> implements the WAI-ARIA Treegrid Pattern
// (role="treegrid" + role="row" + role="gridcell"), not the simpler
// Tree pattern. Items still carry the hierarchy metadata
// (aria-level / aria-posinset / aria-setsize / aria-expanded) that
// makes the structure announceable.
describe("APG Tree View — correct vs broken", () => {
  it("React Aria tree exposes role=treegrid + row items with hierarchy metadata", () => {
    const { container } = render(
      <TreeViewCorrect
        label="Project files"
        nodes={nodes}
        defaultExpandedIds={["src"]}
      />,
    );

    const tree = container.querySelector('[role="treegrid"]');
    expect(tree).not.toBeNull();
    expect(tree?.getAttribute("aria-label")).toBe("Project files");

    const rows = container.querySelectorAll('[role="row"]');
    // With src expanded: src, index.ts, components, plus package.json at root
    expect(rows.length).toBeGreaterThanOrEqual(4);

    // Every row carries aria-level reflecting its hierarchy position
    rows.forEach((row) => {
      expect(row.getAttribute("aria-level")).toBeTruthy();
    });

    // The src node is a parent — must have aria-expanded
    const srcRow = [...rows].find(
      (el) => el.getAttribute("aria-label") === "src",
    );
    expect(srcRow?.getAttribute("aria-expanded")).toBe("true");
  });

  it("hand-rolled broken tree has no treegrid/row roles and no hierarchy metadata", () => {
    const { container } = render(
      <TreeViewBroken
        label="Project files"
        nodes={nodes}
        defaultExpandedIds={["src"]}
      />,
    );

    expect(container.querySelector('[role="treegrid"]')).toBeNull();
    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(container.querySelector('[role="treeitem"]')).toBeNull();
    expect(container.querySelector('[role="row"]')).toBeNull();
    expect(container.querySelector("[aria-expanded]")).toBeNull();
    expect(container.querySelector("[aria-level]")).toBeNull();

    // Visually still a nested list
    expect(container.querySelectorAll("ul").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
  });
});
