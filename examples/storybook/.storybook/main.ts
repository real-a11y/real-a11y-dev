import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  // `@storybook/addon-essentials` is gone from Storybook 9 on — controls,
  // actions, viewport and interactions moved into core and load on their own.
  // Only docs still ships as an addon, and the stories here opt in per-meta
  // with `tags: ["autodocs"]` (the old `docs.autodocs` preset was removed
  // alongside essentials).
  addons: ["@storybook/addon-docs", "@real-a11y-dev/storybook-addon"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
};

export default config;
