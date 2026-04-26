import fs from "fs";
import path from "path";

import { defineConfig } from "tsup";

const stylesDir = path.resolve(__dirname, "../../packages/ui/src/styles");
const treeCSS = fs.readFileSync(path.join(stylesDir, "tree.css"), "utf-8");
const themesCSS = fs.readFileSync(path.join(stylesDir, "themes.css"), "utf-8");
const allCSS = JSON.stringify(themesCSS + "\n" + treeCSS);

/** Peer deps that must NEVER be bundled. */
const PEER_EXTERNALS = [
  "react",
  "react-dom",
  "@storybook/manager-api",
  "@storybook/preview-api",
  "@storybook/theming",
  "storybook",
];

export default defineConfig([
  // ── Public re-export (constants only) ──────────────────────────────────────
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: false,
    external: [...PEER_EXTERNALS, "@real-a11y-dev/core", "preact"],
  },

  // ── Preview (runs inside the story iframe) ─────────────────────────────────
  // Bundles @real-a11y-dev/core and @real-a11y-dev/testing so the iframe doesn't need
  // them as separate script tags.
  {
    entry: { preview: "src/preview.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: false,
    noExternal: ["@real-a11y-dev/core", "@real-a11y-dev/testing"],
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
    dts: true,
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
      __SN_STYLES__: allCSS,
    },
  },
]);
