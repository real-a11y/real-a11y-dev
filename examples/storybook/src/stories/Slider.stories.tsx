import type { Meta, StoryObj } from "@storybook/react";
import { SliderCorrect, SliderBroken } from "@real-a11y-dev/example-patterns";

/**
 * APG Slider pattern — paired stories.
 *
 * - **Correct:** Radix slider produces `role="slider"` on the thumb
 *   with `aria-valuemin/max/now`, full keyboard support
 *   (←/→/↑/↓/Home/End/PageUp/PageDown), and focus management. Audit
 *   shows `slider "<label>"` with the current value.
 * - **Broken:** plain `<div>` track + thumb. No role, no value
 *   attributes, no keyboard support. Audit has no slider line at
 *   all; tab-sequence skips it entirely.
 */
const meta: Meta<typeof SliderCorrect> = {
  title: "APG Patterns/Slider",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof SliderCorrect>;

export const Correct: Story = {
  render: () => <SliderCorrect label="Volume" defaultValue={50} />,
};

export const Broken: Story = {
  render: () => <SliderBroken label="Volume" defaultValue={50} />,
};
