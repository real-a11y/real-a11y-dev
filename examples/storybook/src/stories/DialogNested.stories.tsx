import type { Meta, StoryObj } from "@storybook/react";
import {
  DialogNestedCorrect,
  DialogNestedBroken,
} from "@real-a11y-dev/example-patterns";

/**
 * APG nested Dialog — paired stories.
 *
 * - **Correct:** Radix `Dialog.Root` stacks naturally. Each
 *   `<Dialog.Content>` emits `role="dialog"` + `aria-modal="true"`;
 *   focus moves into the new modal on open, Escape closes the
 *   inner first (restoring focus to the inner trigger inside the
 *   outer dialog), Escape again closes the outer.
 * - **Broken:** Two flat dialogs with `role="dialog"` /
 *   `aria-modal="true"` but no focus trap, no focus stack on close,
 *   no Escape handler.
 */
const meta: Meta<typeof DialogNestedCorrect> = {
  title: "APG Patterns/Dialog (nested)",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof DialogNestedCorrect>;

export const Correct: Story = {
  render: () => (
    <DialogNestedCorrect
      outerTrigger="Open settings"
      outerTitle="Settings"
      innerTrigger="Confirm action"
      innerTitle="Are you sure?"
    />
  ),
};

export const Broken: Story = {
  render: () => (
    <DialogNestedBroken
      outerTrigger="Open settings"
      outerTitle="Settings"
      innerTrigger="Confirm action"
      innerTitle="Are you sure?"
    />
  ),
};
