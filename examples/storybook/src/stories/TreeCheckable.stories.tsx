import type { Meta, StoryObj } from "@storybook/react";
import {
  TreeCheckableCorrect,
  TreeCheckableBroken,
} from "@real-a11y-dev/example-patterns";

/**
 * APG Tree with checkboxes — paired stories.
 *
 * - **Correct:** hand-rolled `role="tree"` + `role="treeitem"` with
 *   tri-state `aria-checked` (`"true"` / `"false"` / `"mixed"`) on
 *   every row. Parents derive from descendants; toggling a parent
 *   propagates to all leaves under it. Full keyboard model
 *   (↑/↓/←/→/Home/End, Space to toggle), roving tabindex,
 *   `aria-level` / `aria-posinset` / `aria-setsize` / `aria-expanded`.
 * - **Broken:** nested `<ul>`/`<li>` with plain native checkboxes,
 *   one per row, no propagation. Parents stay "false" even when
 *   children are checked; no tree/treeitem roles, no
 *   `aria-checked="mixed"`.
 */
const meta: Meta<typeof TreeCheckableCorrect> = {
  title: "APG Patterns/Tree (with checkboxes)",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof TreeCheckableCorrect>;

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
      { id: "tomato", label: "Tomato" },
    ],
  },
];

export const Correct: Story = {
  render: () => (
    <TreeCheckableCorrect
      label="Inventory"
      nodes={nodes}
      defaultExpandedIds={["fruits", "veg"]}
      defaultCheckedIds={["apple"]}
    />
  ),
};

export const Broken: Story = {
  render: () => (
    <TreeCheckableBroken
      label="Inventory"
      nodes={nodes}
      defaultExpandedIds={["fruits", "veg"]}
      defaultCheckedIds={["apple"]}
    />
  ),
};
