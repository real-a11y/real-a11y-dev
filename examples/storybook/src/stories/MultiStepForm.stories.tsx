import type { Meta, StoryObj } from "@storybook/react";
import {
  MultiStepFormCorrect,
  MultiStepFormBroken,
} from "@real-a11y-dev/example-patterns";

/**
 * Content pattern: Multi-step form — paired stories.
 *
 * - **Correct:** progress `<ol aria-label="Progress">` with the
 *   active step marked `aria-current="step"`, each step's fields
 *   wrapped in `<fieldset><legend>`, and validation errors linked
 *   via `aria-invalid` + `aria-describedby` to a `role="alert"`
 *   message element.
 * - **Broken:** `<div>`s for the progress indicator (no
 *   `aria-current`), no `<fieldset>`/`<legend>`, and errors as
 *   unlinked `<p>` styled red — visually equivalent, entirely
 *   invisible to AT.
 *
 * Try pressing **Next** without filling the email field to see the
 * error affordances differ.
 */
const meta: Meta<typeof MultiStepFormCorrect> = {
  title: "Content Patterns/Multi-step Form",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof MultiStepFormCorrect>;

const steps = [
  { id: "account", label: "Account" },
  { id: "profile", label: "Profile" },
  { id: "review", label: "Review" },
];

export const Correct: Story = {
  render: () => <MultiStepFormCorrect steps={steps} />,
};

export const Broken: Story = {
  render: () => <MultiStepFormBroken steps={steps} />,
};
