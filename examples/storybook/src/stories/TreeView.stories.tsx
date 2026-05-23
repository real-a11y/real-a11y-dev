import type { Meta, StoryObj } from "@storybook/react";
import {
  TreeViewCorrect,
  TreeViewBroken,
} from "@real-a11y-dev/example-patterns";

/**
 * APG Tree View — paired stories.
 *
 * React Aria implements this as the WAI-ARIA Treegrid Pattern
 * (`role="treegrid"` + `role="row"` + `role="gridcell"`) rather than
 * the simpler Tree pattern — items still carry full hierarchy
 * metadata.
 *
 * - **Correct:** react-aria-components `Tree` wires `role="treegrid"`
 *   on the container, `role="row"` on each item with computed
 *   `aria-level` / `aria-posinset` / `aria-setsize` / `aria-expanded`,
 *   keyboard nav (↑/↓ + ←/→ to collapse / expand), roving tabindex.
 * - **Broken:** plain nested `<ul>` / `<li>` with chevron buttons. No
 *   treegrid/row roles, no aria-level / aria-expanded — hierarchy is
 *   visible but invisible to AT.
 */
const meta: Meta<typeof TreeViewCorrect> = {
  title: "APG Patterns/Tree View",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof TreeViewCorrect>;

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
  { id: "README.md", label: "README.md" },
];

export const Correct: Story = {
  render: () => (
    <TreeViewCorrect
      label="Project files"
      nodes={nodes}
      defaultExpandedIds={["src", "src/components"]}
    />
  ),
};

export const Broken: Story = {
  render: () => (
    <TreeViewBroken
      label="Project files"
      nodes={nodes}
      defaultExpandedIds={["src", "src/components"]}
    />
  ),
};
