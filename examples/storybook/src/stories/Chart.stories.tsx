import type { Meta, StoryObj } from "@storybook/react";
import { ChartCorrect, ChartBroken } from "@real-a11y-dev/example-patterns";

/**
 * Content pattern: Chart — paired stories.
 *
 * - **Correct:** `<svg role="img" aria-labelledby="…" aria-describedby="…">`
 *   with inline `<title>` + `<desc>`, plus a screen-reader-only
 *   `<table>` alternative so AT users can read the underlying data
 *   values (WCAG 1.1.1 done properly).
 * - **Broken:** `<svg>` with no role, no title/desc, no alt data.
 *   The information payload only exists as pixels.
 */
const meta: Meta<typeof ChartCorrect> = {
  title: "Content Patterns/Chart",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ChartCorrect>;

const data = [
  { id: "jan", label: "Jan", value: 12 },
  { id: "feb", label: "Feb", value: 18 },
  { id: "mar", label: "Mar", value: 9 },
  { id: "apr", label: "Apr", value: 14 },
  { id: "may", label: "May", value: 22 },
];

export const Correct: Story = {
  render: () => (
    <ChartCorrect
      title="Monthly revenue"
      description="Revenue trends across the first five months: peak in May, dip in March."
      data={data}
      unit="USD"
    />
  ),
};

export const Broken: Story = {
  render: () => (
    <ChartBroken
      title="Monthly revenue"
      description="Revenue trends across the first five months: peak in May, dip in March."
      data={data}
      unit="USD"
    />
  ),
};
