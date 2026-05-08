import type { Meta, StoryObj } from "@storybook/react";
import { TabsCorrect, TabsBroken } from "@real-a11y-dev/example-patterns";

/**
 * APG Tabs pattern — paired stories for the same UI built on Radix
 * (`Correct`) and a deliberately broken hand-roll (`Broken`).
 *
 * Open the Semantic Navigator panel and switch between the two stories:
 *
 * - **Correct:** Radix produces `tablist > tab*` with `aria-controls`,
 *   `aria-selected`, roving tabindex, and ←/→/Home/End keyboard nav.
 *   The panel shows a clean tab structure; tab-sequence has 1 entry.
 * - **Broken:** Plain `<div>` of `<button>`s. Same pixels, missing every
 *   ARIA tab relationship and keyboard model. The panel shows N
 *   buttons in a generic group; tab-sequence has N entries; the
 *   IssuesBadge highlights the missing tab roles.
 */
const meta: Meta<typeof TabsCorrect> = {
  title: "APG Patterns/Tabs",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof TabsCorrect>;

const samplePanels = [
  {
    id: "overview",
    label: "Overview",
    content: <p>What is Real A11y, in one paragraph.</p>,
  },
  {
    id: "install",
    label: "Install",
    content: <p>How to install via npm / pnpm / yarn.</p>,
  },
  {
    id: "usage",
    label: "Usage",
    content: <p>Mounting the inspector against your app.</p>,
  },
];

export const Correct: Story = {
  render: () => (
    <TabsCorrect
      defaultValue="overview"
      label="Documentation sections"
      panels={samplePanels}
    />
  ),
};

export const Broken: Story = {
  render: () => <TabsBroken defaultValue="overview" panels={samplePanels} />,
};
