// Per-route accessibility gate for the deployed docs site.
//
// 1. Axe runs across every route × theme combination; any WCAG 2 / 2.1 /
//    2.2 AA violation (or axe best-practice) fails the build.
//
// 2. A structural a11y-tree snapshot runs once per route via
//    `@real-a11y-dev/testing`'s `auditSnapshot()`. Drift fails the test;
//    intentional changes are accepted by re-running with
//    `--update-snapshots` and committing the regenerated baseline. The
//    baselines live under `tests/a11y.spec.ts-snapshots/` and are
//    reviewable in the PR diff like any other source change.
//
// The route list / theme list / axe tag set live in
// `website/scripts/audit-routes.mjs` so future ad-hoc scripts import
// from the same module instead of drifting.

import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { attach } from "@real-a11y-dev/testing/playwright";

import { AXE_TAGS, ROUTES, THEMES } from "../scripts/audit-routes.mjs";

// Axe: per (route × theme). Themes affect contrast checks, so we run
// the suite under both `colorScheme: "light"` and `"dark"`.
for (const theme of THEMES) {
  test.describe(`axe (${theme})`, () => {
    test.use({ colorScheme: theme as "light" | "dark" });

    for (const route of ROUTES) {
      test(route, async ({ page }) => {
        // `load` (not just `domcontentloaded`) so VitePress finishes
        // hydrating; otherwise axe sees a transient pre-hydration DOM.
        await page.goto(route, { waitUntil: "load" });

        const results = await new AxeBuilder({ page })
          .withTags([...AXE_TAGS])
          .analyze();

        if (results.violations.length > 0) {
          // Custom failure message that fits in a single Playwright
          // report line per violation. Prevents the default `toEqual`
          // from dumping multi-page JSON for a single missing label.
          const summary = results.violations
            .map(
              (v) =>
                `[${v.impact ?? "unknown"}] ${v.id}: ${v.help} (${v.nodes.length} node${
                  v.nodes.length === 1 ? "" : "s"
                })\n   ${v.helpUrl}`,
            )
            .join("\n");
          throw new Error(
            `axe found ${results.violations.length} violation(s):\n${summary}`,
          );
        }
      });
    }
  });
}

// A11y tree snapshot: per route only. The structural tree shape doesn't
// depend on `prefers-color-scheme` for a static docs site, so doubling
// the snapshot count by theme would just duplicate the same content.
test.describe("a11y tree snapshot", () => {
  for (const route of ROUTES) {
    test(route, async ({ page }) => {
      await page.goto(route, { waitUntil: "load" });

      const sn = await attach(page);
      const audit = await sn.auditSnapshot();

      // Snapshot file name: route with `/` replaced by `_`, then the
      // suffix. `/` becomes `_root`, `/guide/why` becomes `_guide_why`.
      const slug = route === "/" ? "_root" : route.replace(/\//g, "_");
      expect(audit).toMatchSnapshot(`${slug}.audit.txt`);
    });
  }
});
