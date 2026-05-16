import type { Meta, StoryObj } from "@storybook/react";
import {
  ComboboxCorrect,
  ComboboxBroken,
} from "@real-a11y-dev/example-patterns";

/**
 * APG Combobox — paired stories.
 *
 * - **Correct:** react-aria-components `ComboBox` wires
 *   `role="combobox"` + `aria-expanded` + `aria-controls` on the
 *   input, portals a `role="listbox"` popover with `role="option"`
 *   children, and updates `aria-activedescendant` as the user arrows
 *   through. Free-text filtering with announced result count.
 * - **Broken:** plain `<input type="text">` + `<ul>` of `<li>`s. The
 *   input announces as a textbox; the dropdown announces as a generic
 *   list. No combobox/listbox/option role chain.
 */
const meta: Meta<typeof ComboboxCorrect> = {
  title: "APG Patterns/Combobox",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ComboboxCorrect>;

const options = [
  { id: "apple", label: "Apple" },
  { id: "banana", label: "Banana" },
  { id: "cherry", label: "Cherry" },
  { id: "date", label: "Date" },
  { id: "elderberry", label: "Elderberry" },
];

export const Correct: Story = {
  render: () => (
    <ComboboxCorrect
      label="Fruit"
      options={options}
      placeholder="Type to filter…"
    />
  ),
};

export const Broken: Story = {
  render: () => (
    <ComboboxBroken
      label="Fruit"
      options={options}
      placeholder="Type to filter…"
    />
  ),
};
