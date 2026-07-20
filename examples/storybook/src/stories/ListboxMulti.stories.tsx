import type { Meta, StoryObj } from "@storybook/react";
import {
  ListboxMultiCorrect,
  ListboxMultiBroken,
} from "@real-a11y-dev/example-patterns";

/**
 * APG multi-select Listbox — paired stories.
 *
 * - **Correct:** react-aria-components `ListBox` with
 *   `selectionMode="multiple"` wires `aria-multiselectable="true"`,
 *   per-option `aria-selected`, Shift+click range select / Ctrl/Cmd+
 *   click toggle, Space-to-toggle, roving tabindex.
 * - **Broken:** `<div>` of `<label>` + native checkboxes. Selection
 *   is visible but the listbox / option role chain and
 *   `aria-multiselectable` are missing.
 */
const meta: Meta<typeof ListboxMultiCorrect> = {
  title: "APG Patterns/Listbox (multi-select)",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ListboxMultiCorrect>;

const options = [
  { id: "a", label: "Apples" },
  { id: "b", label: "Bananas" },
  { id: "c", label: "Cherries" },
  { id: "d", label: "Dates" },
  { id: "e", label: "Elderberries" },
];

export const Correct: Story = {
  render: () => (
    <ListboxMultiCorrect
      label="Fruits"
      options={options}
      defaultSelectedIds={["a", "c"]}
    />
  ),
};

export const Broken: Story = {
  render: () => (
    <ListboxMultiBroken
      label="Fruits"
      options={options}
      defaultSelectedIds={["a", "c"]}
    />
  ),
};
