import type { Meta, StoryObj } from "@storybook/react";
import { CodeBlock } from "../CodeBlock.js";

/**
 * Decorative token spans on `<pre><code>` blocks.
 *
 * Try:
 * 1. Open the "Semantic Navigator" addon panel.
 * 2. Look at the "Noisy" block. Each token (`const`, `sn`, `=`,
 *    `createInspector`, …) appears as a separate `generic` row — that's
 *    what every site that ships a syntax highlighter looks like in the
 *    a11y tree by default.
 * 3. Look at the "Decorative" block. Same DOM, but every token span has
 *    `role="presentation"`. In Chrome DevTools' built-in Accessibility
 *    panel the spans are dropped and the `<pre>` becomes a single
 *    accessible code block. In our own panel the difference is visible
 *    after the 0.1.0-beta.5 extractor fix.
 */
const meta: Meta<typeof CodeBlock> = {
  title: "Components/CodeBlock",
  component: CodeBlock,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof CodeBlock>;

export const DecorativeTokens: Story = {};
