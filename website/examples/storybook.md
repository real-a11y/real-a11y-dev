# Example: Storybook

A Storybook 8 project with `@real-a11y-dev/storybook-addon` enabled — demonstrating the panel on real component stories.

**Source:** [`examples/storybook/`](https://github.com/real-a11y/real-a11y-dev/tree/main/examples/storybook)

## What it shows

- Addon panel auto-appearing for every story
- Tree, Outline, and Tab sequence views
- A11y mode vs DOM mode toggle
- Panel updating live when a story's controls change (e.g., toggle a disabled prop)
- Stories for: Button, Form, Dialog, Menu, Toolbar, and more

## Run it locally

```sh
git clone https://github.com/real-a11y/real-a11y-dev.git
cd real-a11y-dev
pnpm install
pnpm --filter @real-a11y-dev/example-storybook storybook
```

Opens at `http://localhost:6006`.

## Setup

```ts
// examples/storybook/.storybook/main.ts
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-essentials",
    "@real-a11y-dev/storybook-addon",
  ],
  framework: { name: "@storybook/react-vite", options: {} },
};

export default config;
```

## Example story

```tsx
// examples/storybook/src/stories/Button.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../Button";

const meta: Meta<typeof Button> = {
  component: Button,
  args: { label: "Click me", disabled: false },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};

// The Semantic Navigator panel will automatically show:
// Tree:         button "Click me"
// Outline:      (no headings)
// Tab sequence: 1. button "Click me"
//
// For Disabled:
// Tree:         button "Click me" (disabled)
// Tab sequence: (empty — disabled button is not in tab order)
```

## What to look for in the panel

Open any story and click the **Semantic Navigator** tab:

1. **Tree view** — see the role, accessible name, and ARIA states for every element in the story canvas.
2. **Outline view** — check heading structure at a glance.
3. **Tab sequence** — verify that the tab order matches user expectations.
4. **Mode toggle** — switch to DOM mode to see raw tag names instead of ARIA roles.

Try the **Controls** panel alongside Semantic Navigator — changing a prop (like toggling `disabled`) triggers a new extraction and the panel updates within 200ms.
