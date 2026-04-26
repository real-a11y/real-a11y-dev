import { defineConfig } from "vite";
import { resolve } from "path";

// Chrome extension needs two builds:
// 1. Content script: must be IIFE (no ES module imports allowed)
// 2. Side panel + background: can use ES modules

const isContentScript = process.env.BUILD_TARGET === "content";

export default defineConfig(
  isContentScript
    ? {
        // Build 1: Content script (IIFE, self-contained)
        build: {
          outDir: "dist",
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
        build: {
          outDir: "dist",
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
