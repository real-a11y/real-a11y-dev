import type { Meta, StoryObj } from "@storybook/react";
import {
  DisclosureCorrect,
  DisclosureBroken,
} from "@real-a11y-dev/example-patterns";

/**
 * APG Disclosure (Show/Hide) — paired stories.
 *
 * - **Correct:** Radix `Collapsible` wires the trigger with
 *   `aria-expanded` + `aria-controls` and toggles `hidden` on the
 *   panel. The inspector shows a solid cross-link chip on the trigger
 *   row (→ region) and the panel row (← button).
 * - **Broken:** plain `<button>` + `<div>` toggled by `display`. No
 *   `aria-expanded`, no `aria-controls`. The panel's cross-link chip
 *   disappears (or falls back to dashed/inferred).
 */
const meta: Meta<typeof DisclosureCorrect> = {
  title: "APG Patterns/Disclosure",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof DisclosureCorrect>;

export const Correct: Story = {
  render: () => (
    <DisclosureCorrect trigger="What is Real A11y?">
      <p>Accessibility tooling that works in the real world.</p>
    </DisclosureCorrect>
  ),
};

export const Broken: Story = {
  render: () => (
    <DisclosureBroken trigger="What is Real A11y?">
      <p>Accessibility tooling that works in the real world.</p>
    </DisclosureBroken>
  ),
};
