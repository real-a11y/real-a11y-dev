import type { Meta, StoryObj } from "@storybook/react";
import { MenuCorrect, MenuBroken } from "@real-a11y-dev/example-patterns";

/**
 * APG Menu Button + Menu — paired stories.
 *
 * - **Correct:** Radix `DropdownMenu` wires `aria-haspopup` +
 *   `aria-expanded` + `aria-controls` on the trigger, sets
 *   `role="menu"` + `role="menuitem"` on the panel, manages focus
 *   into/out of the menu, supports ↑/↓/Home/End/typeahead/Escape.
 *   Inspector shows the solid cross-link chip on the trigger row.
 * - **Broken:** plain `<button>` + `<div>` of `<button>`s. No menu
 *   role, no haspopup/expanded, no focus management.
 */
const meta: Meta<typeof MenuCorrect> = {
  title: "APG Patterns/Menu",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof MenuCorrect>;

const items = [
  { id: "profile", label: "Edit profile" },
  { id: "settings", label: "Settings" },
  { id: "signout", label: "Sign out" },
];

export const Correct: Story = {
  render: () => <MenuCorrect trigger="Account" items={items} />,
};

export const Broken: Story = {
  render: () => <MenuBroken trigger="Account" items={items} />,
};
