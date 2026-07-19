import type { Meta, StoryObj } from "@storybook/react";

import { SlackComposer } from "../SlackComposer.js";

/**
 * Slack's message box and search, replicated as plain ARIA markup (no editor
 * library). Both are `contenteditable`-hosted: a `role="textbox"` message box
 * and an editable `role="combobox"` search. Open the Semantic Navigator panel
 * to see them extracted as a named textbox and a named combobox.
 */
const meta: Meta<typeof SlackComposer> = {
  title: "Rich text/Slack composer (replica)",
  component: SlackComposer,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof SlackComposer>;

export const Default: Story = {};
