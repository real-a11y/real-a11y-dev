import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { Button } from "../Button.js";

/**
 * The Button component demonstrates the Semantic Navigator panel.
 *
 * Try:
 * 1. Click the "Semantic Navigator" tab — see the Tree, Outline, Tab sequence views.
 * 2. Toggle `disabled` in Controls — the tab sequence empties immediately.
 * 3. Toggle the A11y / DOM mode in the panel — see roles vs. tag names.
 */
const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
  args: {
    onClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: {
    label: "Save changes",
    variant: "primary",
  },
};

export const Secondary: Story = {
  args: {
    label: "Cancel",
    variant: "secondary",
  },
};

export const Danger: Story = {
  args: {
    label: "Delete account",
    variant: "danger",
  },
};

export const Disabled: Story = {
  args: {
    label: "Submit (disabled)",
    variant: "primary",
    disabled: true,
  },
};
