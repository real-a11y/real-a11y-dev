---
title: Storybook + React 19
description: The one viteFinal tweak some Storybook + React 19 projects need to make the Real A11y Storybook addon work cleanly. Fixes React-not-defined errors.
---

# Storybook + React 19

`@real-a11y-dev/storybook-addon` supports Storybook 9.x and 10.x with React 18 or React 19; its own suite runs on React 19. If you hit `React is not defined` at story render time, the Vite pipeline needs one small nudge — explained below.

## Install

```sh
npm install -D @real-a11y-dev/storybook-addon
```

Peer dependencies (`storybook` 9.x or 10.x, your framework package, and React)
must already be installed in your project. Storybook 8 is not supported — see
[the package page](/packages/storybook-addon#install) for why.

## Register the addon

```ts
// .storybook/main.ts
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@real-a11y-dev/storybook-addon"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
};

export default config;
```

A **Semantic Navigator** panel appears next to Controls and A11y for every story, showing the tree, heading outline, and tab sequence.

---

## React 19 — pin the JSX runtime

Storybook externalizes `react` for addon manager bundles but does **not** externalize `react/jsx-runtime` — still true as of Storybook 11's manager globals map. When Vite's esbuild falls back to the classic JSX transform (which it does for some source files under React 19), story files emit `React.createElement(...)` calls that fail with `ReferenceError: React is not defined` — because automatic runtime is the default for React 19 projects and classic transform needs `React` in scope.

The one-line fix lives in `.storybook/main.ts`:

```ts
// .storybook/main.ts
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite"; // [!code ++]

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@real-a11y-dev/storybook-addon"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  // Force esbuild's automatic JSX runtime on source .tsx files — matches  // [!code ++]
  // the React 19 / Next.js default so stories don't need to import React.  // [!code ++]
  async viteFinal(config) {                                                 // [!code ++]
    return mergeConfig(config, {                                            // [!code ++]
      esbuild: { jsx: "automatic", jsxImportSource: "react" },              // [!code ++]
    });                                                                      // [!code ++]
  },                                                                         // [!code ++]
};

export default config;
```

No source-file changes required — stories can keep writing JSX without `import React from "react"`.

## When you *don't* need this

- React 18 projects — the default transform is already compatible.
- Projects that always `import React from "react"` at the top of every component/story (classic-runtime hygiene).
- Future Storybook versions where this is fixed upstream.

If you hit `React is not defined` at story render time, add the `viteFinal` override.

---

## Clear the cache after adding the addon

Storybook caches its addon bundles under `node_modules/.cache/storybook/`. If you install the addon and it doesn't appear — or if you change addon configuration and nothing updates — clear the cache:

```sh
rm -rf node_modules/.cache/storybook
```

Then restart `storybook dev`.

---

## CI

Storybook's addon build is deterministic; include Storybook in your regular CI jobs.

```yaml
- run: npm run build-storybook
```

For accessibility-specific CI coverage on Storybook stories, pair it with the Playwright adapter — load the built Storybook and run `treeSnapshot()` against each story's iframe. That's more setup than most projects need; for per-story audits the panel itself + manual review is usually enough.

---

## Known constraints

- **Storybook 9.x or 10.x** is required. The addon's manager entry imports `storybook/manager-api` and its preview entry imports `storybook/preview-api` — the subpath exports Storybook 9 introduced when it folded the standalone `@storybook/*-api` packages into core. Those packages stopped publishing at 8.6 and `storybook@8` has no equivalent subpath, so 8.x cannot be supported by the same build.
- **Storybook 11** is not in the peer range yet. The addon already type-checks, builds and passes its tests against `storybook@11.0.0-alpha.0`; the range widens when 11 ships stable.
- **React 18 or 19** as a peer. React 19 works with the `viteFinal` override above.
- **Mixed React versions on the page will fail.** If anything in your Storybook config transitively loads a second copy of React (some legacy addons do this), the manager will crash. Run `npm ls react` — there should be exactly one resolution.
