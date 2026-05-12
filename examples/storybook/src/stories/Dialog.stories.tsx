import type { Meta, StoryObj } from "@storybook/react";
import { DialogCorrect, DialogBroken } from "@real-a11y-dev/example-patterns";

/**
 * APG Modal Dialog — paired stories.
 *
 * - **Correct:** Radix `Dialog` sets `role="dialog"` + `aria-modal`,
 *   wires `aria-labelledby`/`aria-describedby` to title/description,
 *   traps focus, returns focus to the trigger on close, locks body
 *   scroll, and closes on Escape. The inspector's modality tracker
 *   recognises it as the active modal.
 * - **Broken:** plain `<div>` overlay + content. No dialog role, no
 *   aria-modal, no focus trap, no return-focus. Inspector sees no
 *   modality change.
 */
const meta: Meta<typeof DialogCorrect> = {
  title: "APG Patterns/Dialog",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof DialogCorrect>;

export const Correct: Story = {
  render: () => (
    <DialogCorrect
      trigger="Open dialog"
      title="Delete account"
      description="This action cannot be undone."
    >
      <p>All your data will be permanently deleted.</p>
    </DialogCorrect>
  ),
};

export const Broken: Story = {
  render: () => (
    <DialogBroken
      trigger="Open dialog"
      title="Delete account"
      description="This action cannot be undone."
    >
      <p>All your data will be permanently deleted.</p>
    </DialogBroken>
  ),
};
