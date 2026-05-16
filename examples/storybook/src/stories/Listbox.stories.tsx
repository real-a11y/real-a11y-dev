import type { Meta, StoryObj } from "@storybook/react";
import { ListboxCorrect, ListboxBroken } from "@real-a11y-dev/example-patterns";

/**
 * APG Listbox — paired stories.
 *
 * - **Correct:** react-aria-components `ListBox` wires `role="listbox"`
 *   + per-item `role="option"` with `aria-selected` reflecting state,
 *   plus single-select selection model, keyboard nav (↑/↓, Home/End,
 *   typeahead, Enter/Space), and roving tabindex.
 * - **Broken:** plain `<div>` + buttons. Selection is conveyed
 *   visually (bold) only — no listbox/option roles, no
 *   `aria-selected`, every button stays in the tab sequence.
 */
const meta: Meta<typeof ListboxCorrect> = {
  title: "APG Patterns/Listbox",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ListboxCorrect>;

const options = [
  { id: "low", label: "Low" },
  { id: "med", label: "Medium" },
  { id: "high", label: "High" },
];

export const Correct: Story = {
  render: () => (
    <ListboxCorrect
      label="Priority"
      options={options}
      defaultSelectedId="med"
    />
  ),
};

export const Broken: Story = {
  render: () => (
    <ListboxBroken label="Priority" options={options} defaultSelectedId="med" />
  ),
};
