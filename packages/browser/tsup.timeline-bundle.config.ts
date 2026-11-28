import { defineConfig } from "tsup";

// ── IIFE timeline-bundle — built SECOND, after the page-bundle ──────────────
//
// The timeline view's recorder (ADR-0002), injected only while a timeline
// records, never into every audited page as the page-bundle is. Its own
// config rather than a second entry beside the page-bundle's: tsup gives
// every entry of one config the same `globalName`, and this one needs its
// own (`__realA11yTimeline__`).
//
// `build` runs this between the page-bundle pass, which owns the clean, and
// the main pass, which inlines this file's output as a string
// (`__REAL_A11Y_TIMELINE_BUNDLE__`) — so it must not clean, and must exist
// before the main pass reads it. Emitted as
// dist/timeline-bundle.iife.global.js.
export default defineConfig({
  entry: { "timeline-bundle.iife": "src/timeline-bundle.ts" },
  format: ["iife"],
  globalName: "__realA11yTimeline__",
  // No sourcemap, for the page-bundle's reason: it is injected as inline
  // source into someone else's page, where a sourceMappingURL 404s.
  sourcemap: false,
  treeshake: true,
  dts: false,
  clean: false,
  outDir: "dist",
});
