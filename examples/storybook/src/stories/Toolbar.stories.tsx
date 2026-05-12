import type { Meta, StoryObj } from "@storybook/react";
import { ToolbarCorrect, ToolbarBroken } from "@real-a11y-dev/example-patterns";

/**
 * APG Toolbar — paired stories.
 *
 * - **Correct:** Radix `Toolbar` sets `role="toolbar"` + the supplied
 *   `aria-label`, with roving tabindex so Tab enters the toolbar
 *   once and ←/→ move within. Tab-sequence snapshot has 1 entry.
 * - **Broken:** plain `<div>` of `<button>`s. No `toolbar` role, no
 *   roving tabindex. Tab walks through every button — tab-sequence
 *   has N entries.
 */
const meta: Meta<typeof ToolbarCorrect> = {
  title: "APG Patterns/Toolbar",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ToolbarCorrect>;

const items = [
  { id: "bold", label: "Bold" },
  { id: "italic", label: "Italic" },
  { id: "underline", label: "Underline" },
];

export const Correct: Story = {
  render: () => <ToolbarCorrect label="Text formatting" items={items} />,
};

export const Broken: Story = {
  render: () => <ToolbarBroken label="Text formatting" items={items} />,
};
