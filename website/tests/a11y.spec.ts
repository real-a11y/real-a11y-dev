// Per-route accessibility gate for the deployed docs site.
//
// 1. Axe runs across every route × theme combination; any WCAG 2 / 2.1 /
//    2.2 AA violation (or axe best-practice) fails the build.
//
// 2. Three structural snapshots run once per route via
//    `@real-a11y-dev/testing`:
//      - `auditSnapshot()` — the a11y tree (roles + names, indented)
//      - `outlineSnapshot()` — the heading outline ("level N → name")
//      - `tabSequenceSnapshot()` — focusable elements in tab order
//    Drift fails the test; intentional changes are accepted by
//    re-running with `--update-snapshots` and committing the
//    regenerated baselines. They live under
//    `tests/a11y.spec.ts-snapshots/` and are reviewable in the PR diff
//    like any other source change. Per-shape isolation means a tab-order
//    regression doesn't mask a tree-shape regression in the same run.
//
// The route list / theme list / axe tag set live in
// `website/scripts/audit-routes.mjs` so future ad-hoc scripts import
// from the same module instead of drifting.

import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { attach } from "@real-a11y-dev/testing/playwright";

import { AXE_TAGS, ROUTES, THEMES } from "../scripts/audit-routes.mjs";

// How much per-node detail to include in the failure log. Capping the
// node count keeps a 70-violation contrast failure from burying the
// stdout; capping the HTML length keeps a single `<table>` from
// taking 500 columns.
const MAX_NODES_PER_VIOLATION = 5;
const MAX_HTML_LEN = 160;

// Minimal local shape — avoids pulling axe-core's type package into
// website devDeps just for the formatter. Matches what
// `AxeBuilder({ page }).analyze()` returns at runtime.
interface AxeNodeLike {
  target: string[] | string;
  html: string;
  failureSummary?: string;
}
interface AxeViolationLike {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl: string;
  nodes: AxeNodeLike[];
}

// Build a human-readable failure message from axe's `violations`.
// Each violation gets a header line (impact, id, help, count, doc URL)
// followed by per-node detail: selector, truncated outerHTML, and the
// concrete reason from `failureSummary`. The previous version only
// printed the header, which meant every CI failure required a follow-
// up "show me the element" round-trip.
function formatAxeViolations(violations: AxeViolationLike[]): string {
  return violations
    .map((v) => {
      const header =
        `[${v.impact ?? "unknown"}] ${v.id}: ${v.help} ` +
        `(${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"})\n` +
        `   ${v.helpUrl}`;

      const nodeLines = v.nodes
        .slice(0, MAX_NODES_PER_VIOLATION)
        .map((n, i) => {
          const selector = Array.isArray(n.target)
            ? n.target.join(" > ")
            : String(n.target);

          // axe's `failureSummary` is multi-line and starts with
          // "Fix any of the following:" — strip that header and
          // collapse the remaining bullets onto one line.
          const detail = n.failureSummary
            ?.split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("Fix "))
            .join(" · ");

          // outerHTML — truncated so a `<table>` doesn't bury the log.
          const html =
            n.html.length > MAX_HTML_LEN
              ? `${n.html.slice(0, MAX_HTML_LEN - 1)}…`
              : n.html;

          return [
            `   ${i + 1}. ${selector}`,
            `      ${html}`,
            `      ${detail ?? "(no detail)"}`,
          ].join("\n");
        });

      const more =
        v.nodes.length > MAX_NODES_PER_VIOLATION
          ? `\n   … and ${v.nodes.length - MAX_NODES_PER_VIOLATION} more node(s)`
          : "";

      return [header, ...nodeLines].join("\n") + more;
    })
    .join("\n\n");
}

// Snapshot file name: route with `/` replaced by `_`, then the suffix.
// `/` becomes `_root`, `/guide/why` becomes `_guide_why`.
function slugFor(route: string): string {
  return route === "/" ? "_root" : route.replace(/\//g, "_");
}

// Per-route axe rules to skip until the design system / VitePress theme
// fixes them at the source. Every other route still enforces them, and
// `color-contrast` is suppressed globally below for the same reason.
//
// `/` (VitePress home layout): no `<main>` landmark. `landmark-one-main`
// fires because the home layout's hero/features sections sit outside any
// landmark. `region` is a downstream firing of the same problem.
const ROUTE_DISABLED_RULES: Record<string, string[]> = {
  "/": ["landmark-one-main", "region"],
};

// Axe: per (route × theme). Themes affect contrast checks, so we run
// the suite under both `colorScheme: "light"` and `"dark"`.
for (const theme of THEMES) {
  test.describe(`axe (${theme})`, () => {
    test.use({ colorScheme: theme as "light" | "dark" });

    for (const route of ROUTES) {
      test(route, async ({ page }) => {
        // `networkidle` waits for 500ms of no network activity — VitePress's
        // Vue hydration sets `document.title` and `<html lang>` reactively,
        // so `waitUntil: "load"` would catch the page mid-hydration and
        // intermittently see empty title / missing lang / orphaned main.
        // `networkidle` is the standard fix for "axe sees a transient DOM."
        await page.goto(route, { waitUntil: "networkidle" });

        const results = await new AxeBuilder({ page })
          .withTags([...AXE_TAGS])
          .disableRules(ROUTE_DISABLED_RULES[route] ?? [])
          .analyze();

        if (results.violations.length > 0) {
          throw new Error(
            `axe found ${results.violations.length} violation(s):\n` +
              formatAxeViolations(results.violations),
          );
        }
      });
    }
  });
}

// Snapshots: per route only. Structural shape doesn't depend on
// `prefers-color-scheme` for a static docs site, so doubling by theme
// would just duplicate the same content.
// VitePress renders the file's git mtime into a `<time>` element on
// every doc page ("Last updated: 4/25/26, 7:01 PM"). The text changes
// every time the docs rebuild — so we redact the content before
// snapshotting. Anything inside `time "..."` becomes a placeholder.
function redactTimes(audit: string): string {
  return audit.replace(/time "[^"]*"/g, 'time "[redacted]"');
}

test.describe("a11y tree snapshot", () => {
  for (const route of ROUTES) {
    test(route, async ({ page }) => {
      await page.goto(route, { waitUntil: "load" });
      const sn = await attach(page);
      const audit = redactTimes(await sn.auditSnapshot());
      expect(audit).toMatchSnapshot(`${slugFor(route)}.audit.txt`);
    });
  }
});

test.describe("heading outline snapshot", () => {
  for (const route of ROUTES) {
    test(route, async ({ page }) => {
      await page.goto(route, { waitUntil: "load" });
      const sn = await attach(page);
      const outline = await sn.outlineSnapshot();
      expect(outline).toMatchSnapshot(`${slugFor(route)}.outline.txt`);
    });
  }
});

test.describe("tab sequence snapshot", () => {
  for (const route of ROUTES) {
    test(route, async ({ page }) => {
      await page.goto(route, { waitUntil: "load" });
      const sn = await attach(page);
      const tabs = await sn.tabSequenceSnapshot();
      expect(tabs).toMatchSnapshot(`${slugFor(route)}.tabs.txt`);
    });
  }
});
