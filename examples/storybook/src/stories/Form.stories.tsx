import type { Meta, StoryObj } from "@storybook/react";
import { Form } from "../Form.js";

/**
 * The Form demonstrates labeled vs unlabeled fields.
 *
 * Try:
 * 1. Open "Semantic Navigator" tab — see all labeled form controls.
 * 2. Switch to "With unlabeled field" — the panel shows an unlabeled textbox.
 * 3. Check "Tab sequence" — the unlabeled field is still reachable (focus isn't
 *    removed, just the name is missing).
 */
const meta: Meta<typeof Form> = {
  title: "Components/Form",
  component: Form,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Form>;

export const FullyLabeled: Story = {
  args: {
    includeUnlabeledField: false,
  },
};

export const WithUnlabeledField: Story = {
  args: {
    includeUnlabeledField: true,
  },
};
