import type { Meta, StoryObj } from "@storybook/react";
import {
  ComboboxAsyncCorrect,
  ComboboxAsyncBroken,
} from "@real-a11y-dev/example-patterns";

/**
 * APG async Combobox — paired stories.
 *
 * - **Correct:** react-aria-components `ComboBox` + a `role="status"`
 *   live region. Adds `aria-busy="true"` on the listbox while a
 *   simulated fetch is in flight and announces the result count
 *   (or empty state) to AT after each settled fetch.
 * - **Broken:** plain `<input>` + `<ul>` dropdown. The fetch happens
 *   silently — no aria-busy, no live region, no announced result
 *   count.
 */
const meta: Meta<typeof ComboboxAsyncCorrect> = {
  title: "APG Patterns/Combobox (async)",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ComboboxAsyncCorrect>;

export const Correct: Story = {
  render: () => (
    <ComboboxAsyncCorrect label="Codename" placeholder="Type to filter…" />
  ),
};

export const Broken: Story = {
  render: () => (
    <ComboboxAsyncBroken label="Codename" placeholder="Type to filter…" />
  ),
};
