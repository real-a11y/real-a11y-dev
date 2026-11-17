/**
 * The snapshot viewer: draws the records the `testing` package's recorder
 * writes (`REAL_A11Y_TREES_DIR`) with the shared panel — the tree the
 * extension shows.
 *
 * Two ways in. `vite build` makes `dist/viewer.js` and `dist/viewer.css`, a
 * classic script and a stylesheet that `@real-a11y-dev/testing/reporter`
 * inlines into one HTML file with the run's records: a classic script, since
 * a module script won't load from `file://`. `vite` (dev) serves the same app
 * against a records directory, and tells the page to reload them whenever it
 * changes, so a test run in watch mode shows up as it happens.
 *
 * The panel and core are read from source, so nothing needs building first.
 */
import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

import { readRecords } from "../testing/src/snapshot-report.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "../..");
const recordsDir = normalize(
  resolve(process.env.REAL_A11Y_TREES_DIR ?? join(repo, ".a11y-trees")),
);

export default defineConfig({
  plugins: [records(recordsDir)],
  resolve: {
    alias: [
      {
        find: /^@real-a11y-dev\/core$/,
        replacement: join(repo, "packages/core/src/index.ts"),
      },
      {
        find: /^@real-a11y-dev\/semantic-navigator-ui$/,
        replacement: join(repo, "packages/ui/src/index.ts"),
      },
      { find: "@ui-styles", replacement: join(repo, "packages/ui/src/styles") },
    ],
    // The panel's source reaches Preact from packages/ui: one copy, or its
    // hooks run against a renderer that never set them up.
    dedupe: ["preact"],
  },
  // Bundled up front, so the page never meets a second, later-optimized copy.
  optimizeDeps: {
    include: ["preact", "preact/hooks", "preact/jsx-runtime"],
  },
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  server: { port: 5310, fs: { allow: [repo] } },
  // A library build doesn't settle this by itself, and the page runs as is.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    lib: {
      entry: join(here, "src/main.tsx"),
      name: "A11ySnapshotViewer",
      formats: ["iife"],
      fileName: () => "viewer.js",
      cssFileName: "viewer",
    },
    emptyOutDir: true,
  },
});

/** Serves `GET /__records` and announces changes to the directory. */
function records(dir: string): Plugin {
  return {
    name: "a11y-snapshot-records",
    configureServer(server) {
      server.middlewares.use("/__records", (_req, res) => {
        res.setHeader("content-type", "application/json");
        // The report's own reader: the same records, the same version check.
        res.end(JSON.stringify({ dir, records: readRecords(dir) }));
      });
      server.watcher.add(dir);
      let pending: ReturnType<typeof setTimeout> | undefined;
      server.watcher.on("all", (_event, file) => {
        if (!normalize(file).startsWith(dir)) return;
        // A run writes many records at once: announce them together.
        clearTimeout(pending);
        pending = setTimeout(
          () => server.ws.send({ type: "custom", event: "a11y-records" }),
          250,
        );
      });
    },
  };
}
