import { resolve } from "path";

import { defineConfig } from "vite";

// Chrome extension needs two builds:
// 1. Content script: must be IIFE (no ES module imports allowed)
// 2. Side panel + background: can use ES modules

const isContentScript = process.env.BUILD_TARGET === "content";

// Native mode (`chrome.debugger`) ships in every build now — the store build
// included — gated at runtime by a user setting, off by default. `DOGFOOD=1`
// only controls whether the separate `dist-dogfood/` output additionally
// bundles `DogfoodPanel`, the internal telemetry/diagnostics UI for the
// dogfooding exercise; `__DOGFOOD__` is inlined at build time so that panel
// alone is dead-code-eliminated from the store build. It is NOT what keeps
// `chrome.debugger` out of the store build — nothing does, by design; see
// CLAUDE.md's "Two producers build the tree" section. The dogfood manifest
// is written by scripts/dogfood-manifest.mjs.
const isDogfood = process.env.DOGFOOD === "1";
const outDir = isDogfood ? "dist-dogfood" : "dist";
const define = { __DOGFOOD__: JSON.stringify(isDogfood) };

export default defineConfig(
  isContentScript
    ? {
        // Build 1: Content script (IIFE, self-contained)
        define,
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          lib: {
            entry: resolve(__dirname, "src/content.ts"),
            name: "SemanticNavigatorContent",
            formats: ["iife"],
            fileName: () => "content.js",
          },
          rollupOptions: {
            output: {
              inlineDynamicImports: true,
            },
          },
        },
        resolve: {
          alias: {
            react: "preact/compat",
            "react-dom": "preact/compat",
          },
        },
      }
    : {
        // Build 2: Side panel + background (ES modules)
        base: "./",
        define,
        build: {
          outDir,
          emptyOutDir: true,
          copyPublicDir: true,
          rollupOptions: {
            input: {
              background: resolve(__dirname, "src/background.ts"),
              sidepanel: resolve(__dirname, "src/sidepanel/index.html"),
            },
            output: {
              entryFileNames: "[name].js",
              chunkFileNames: "chunks/[name]-[hash].js",
              assetFileNames: "assets/[name]-[hash][extname]",
            },
          },
        },
        resolve: {
          alias: {
            react: "preact/compat",
            "react-dom": "preact/compat",
            "@ui-styles": resolve(__dirname, "../ui/src/styles"),
          },
        },
        esbuild: {
          jsx: "automatic",
          jsxImportSource: "preact",
        },
      },
);
