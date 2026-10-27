import { defineConfig } from "tsup";

import { buildInlineStyles } from "../ui/src/styles/inline.js";

/**
 * Peer deps that must NEVER be bundled.
 *
 * Storybook 9 folded `@storybook/manager-api`, `@storybook/preview-api` and
 * `@storybook/theming` into the `storybook` package as the subpath exports
 * `storybook/manager-api`, `storybook/preview-api` and `storybook/theming`
 * (the standalone packages stopped at 8.6 and are gone from 9 on).
 *
 * The RegExp states the subpath family outright. A bare `"storybook"` would
 * also work today — tsup resolves string externals through bundle-require's
 * `match`, which prefix-matches (`id === p || id.startsWith(p + "/")`) rather
 * than comparing exactly — but that is an undocumented internal of a build
 * dependency, and the failure mode if it ever changes is silent rather than
 * loud: esbuild would inline Storybook's manager runtime, which the manager
 * builder already serves as globals (`__STORYBOOK_API__` and friends), so the
 * addon would run against its own second copy of the API instead of the
 * host's. Being explicit costs nothing and does not depend on that behaviour.
 */
const PEER_EXTERNALS = ["react", "react-dom", /^storybook(\/|$)/];

export default defineConfig([
  // ── Public barrel + preview (runs inside the story iframe) ─────────────────
  // One config for both, because the barrel's default export (`realA11y()`,
  // for a CSF Next `definePreview`) loads the preview with `import()`. Built
  // together, the ESM barrel's `import()` points at the preview entry itself
  // — tsup splits ESM by default — rather than at a bundled copy, so an iframe
  // that loads both gets one copy of core and of the preview's state. Webpack
  // does that: it imports `./preview` for every addon in `main.ts` even when a
  // CSF Next preview also imports the barrel. CJS does not split, so the CJS
  // barrel carries its own lazy copy.
  //
  // Bundles @real-a11y-dev/core so the iframe doesn't need it as a separate
  // script tag. The preview extracts, observes and acts on the tree with core
  // alone; it never imports `@real-a11y-dev/testing`, which is why the addon
  // doesn't depend on it.
  //
  // `dts.resolve` with `noExternal`, because core is private: npm cannot
  // resolve it, in the JS or in the types. It is not defensive here. `index.ts`
  // re-exports `TreeMode` and `TreeUpdatePayload` from `constants.ts`, and both
  // are written in terms of core's `TreeViewMode` (`TreeMode` IS
  // `TreeViewMode`) — so the emitted `index.d.ts` names core directly on the
  // package's public surface.
  {
    entry: { index: "src/index.ts", preview: "src/preview.ts" },
    format: ["esm", "cjs"],
    dts: { resolve: ["@real-a11y-dev/core"] },
    sourcemap: true,
    clean: false,
    noExternal: ["@real-a11y-dev/core"],
    external: PEER_EXTERNALS,
  },

  // ── Manager (runs in the Storybook UI frame) ───────────────────────────────
  // Bundles the UI package (Preact tree view) + core, and inlines all CSS so
  // the shadow root gets the right styles without any extra import.
  //
  // Use the CLASSIC JSX transform (`React.createElement` calls) for this entry.
  // Storybook externalizes `react` for addon manager bundles, but it does NOT
  // externalize `react/jsx-runtime` — so automatic-runtime output would get
  // `jsx-runtime` (and React internals) inlined into the addon bundle, leading
  // to React-version mismatches at runtime (e.g. the `recentlyCreatedOwnerStacks`
  // crash against React 19). Classic output keeps only `React.createElement`
  // calls, and `React` stays external.
  {
    entry: { manager: "src/manager.tsx" },
    format: ["esm", "cjs"],
    // `dts.resolve` alongside the `noExternal` below: both packages there are
    // PRIVATE, so if their types ever reached the emitted declarations they
    // would arrive as `from "@real-a11y-dev/semantic-navigator-ui"` (or
    // `/core`) — unresolvable on npm, and silently `any` under
    // `skipLibCheck: true`. That cannot happen today: `manager.tsx` exports
    // nothing (it only calls `addons.register`), so `manager.d.ts` is an empty
    // `export {}` with or without this option. It is insurance for the day this
    // entry grows an export, not a bug it prevented.
    dts: {
      resolve: ["@real-a11y-dev/semantic-navigator-ui", "@real-a11y-dev/core"],
    },
    sourcemap: true,
    clean: false,
    noExternal: [
      "@real-a11y-dev/core",
      "@real-a11y-dev/semantic-navigator-ui",
      "preact",
      "preact/hooks",
    ],
    external: PEER_EXTERNALS,
    esbuildOptions(options) {
      options.jsx = "transform";
      options.jsxFactory = "React.createElement";
      options.jsxFragment = "React.Fragment";
    },
    define: {
      // Minified here: nothing minifies a string literal later.
      __SN_STYLES__: JSON.stringify(buildInlineStyles()),
    },
  },
]);
