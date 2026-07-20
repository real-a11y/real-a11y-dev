import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  PaginationCorrect,
  PaginationBroken,
} from "@real-a11y-dev/example-patterns";

/**
 * Content pattern: Pagination — paired stories.
 *
 * - **Correct:** `<nav aria-label="Pagination">` + `<ol>` of buttons
 *   with per-page `aria-label` and `aria-current="page"` on the
 *   active button. Prev/Next use `aria-disabled` at bounds so the
 *   tab order stays stable.
 * - **Broken:** flat row of buttons with no landmark, no
 *   `aria-current`, and no per-page label — number-only text.
 */
const meta: Meta<typeof PaginationCorrect> = {
  title: "Content Patterns/Pagination",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof PaginationCorrect>;

function Interactive({ variant }: { variant: "correct" | "broken" }) {
  const [page, setPage] = useState(3);
  const Component =
    variant === "correct" ? PaginationCorrect : PaginationBroken;
  return <Component currentPage={page} totalPages={7} onPageChange={setPage} />;
}

export const Correct: Story = {
  render: () => <Interactive variant="correct" />,
};
export const Broken: Story = { render: () => <Interactive variant="broken" /> };
