import type { Meta, StoryObj } from "@storybook/react";
import { ToastCorrect, ToastBroken } from "@real-a11y-dev/example-patterns";

/**
 * APG Status message / Live region — paired stories.
 *
 * - **Correct:** Radix `Toast` renders with `role="status"` +
 *   `aria-live="polite"` so screen readers announce the contents on
 *   appearance without stealing focus.
 * - **Broken:** plain `<div>` toast. Visible but silent — no live
 *   region, no role, no announcement.
 */
const meta: Meta<typeof ToastCorrect> = {
  title: "APG Patterns/Toast",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ToastCorrect>;

export const Correct: Story = {
  render: () => (
    <ToastCorrect
      trigger="Show toast"
      title="Saved"
      description="Your changes were saved successfully."
    />
  ),
};

export const Broken: Story = {
  render: () => (
    <ToastBroken
      trigger="Show toast"
      title="Saved"
      description="Your changes were saved successfully."
    />
  ),
};
