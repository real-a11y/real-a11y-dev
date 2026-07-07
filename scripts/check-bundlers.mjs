// Guard against bundled-package staleness.
//
// Some packages inline workspace deps at build time (tsup `noExternal`) instead
// of depending on them at runtime — the inspector and the storybook addon bundle
// core/ui so consumers get a self-contained build. The catch: a published build
// *freezes* whatever version of those deps it bundled. If a bundled dep is
// re-released but the bundler isn't, the bundler keeps shipping a stale engine.
//
// That is exactly what happened to `@real-a11y-dev/inspector`: it sat at beta.6
// while core moved to beta.7, so its published build kept the pre-beta.7 engine
// (missing the aria-labelledby fix, the accname cycle guard, redaction, …).
// changesets can't catch this on its own — the bundled deps are `workspace:*`
// devDependencies, so there is no tracked runtime dependency to cascade from.
//
// This check fails when a *pending* changeset re-releases a bundled dep without
// also re-releasing the bundler that inlines it. It runs in `pnpm verify`, so it
// gates both CI and the local pre-push hook. It is fully derived from each
// package's tsup config, so it never drifts as the bundle graph changes.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = join(ROOT, "packages");
const CHANGESETS = join(ROOT, ".changeset");

// Discover bundlers by scanning tsup configs for `noExternal` entries that name
// a workspace package. Returns [{ name, bundles: string[] }].
function discoverBundlers() {
  const bundlers = [];
  for (const dir of readdirSync(PACKAGES)) {
    const config = ["tsup.config.ts", "tsup.config.js", "tsup.config.mjs"]
      .map((f) => join(PACKAGES, dir, f))
      .find(existsSync);
    const manifest = join(PACKAGES, dir, "package.json");
    if (!config || !existsSync(manifest)) continue;

    const bundles = new Set();
    const src = readFileSync(config, "utf8");
    // Every `noExternal: [ … ]` array, single- or multi-line.
    for (const arr of src.matchAll(/noExternal\s*:\s*\[([\s\S]*?)\]/g)) {
      for (const dep of arr[1].matchAll(/@real-a11y-dev\/[\w-]+/g)) {
        bundles.add(dep[0]);
      }
    }
    if (bundles.size) {
      const { name } = JSON.parse(readFileSync(manifest, "utf8"));
      bundlers.push({ name, bundles: [...bundles] });
    }
  }
  return bundlers;
}

// Packages bumped by *pending* changesets. In pre mode consumed changesets stay
// on disk but are recorded in pre.json — exclude those so we only look at the
// not-yet-released ones.
function pendingBumps() {
  const consumed = new Set();
  const pre = join(CHANGESETS, "pre.json");
  if (existsSync(pre)) {
    for (const id of JSON.parse(readFileSync(pre, "utf8")).changesets ?? []) {
      consumed.add(id);
    }
  }

  const bumped = new Set();
  for (const file of readdirSync(CHANGESETS)) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    if (consumed.has(file.replace(/\.md$/, ""))) continue;

    const src = readFileSync(join(CHANGESETS, file), "utf8");
    const frontmatter = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatter) continue;
    for (const line of frontmatter[1].matchAll(
      /^\s*["']?(@real-a11y-dev\/[\w-]+)["']?\s*:/gm,
    )) {
      bumped.add(line[1]);
    }
  }
  return bumped;
}

const bundlers = discoverBundlers();
const bumped = pendingBumps();

const violations = [];
for (const { name, bundles } of bundlers) {
  if (bumped.has(name)) continue; // the bundler is being re-released — fine.
  const stale = bundles.filter((dep) => bumped.has(dep));
  if (stale.length) violations.push({ name, stale });
}

if (violations.length) {
  console.error("\n✖ Bundled-package staleness check failed.\n");
  console.error(
    "These packages inline workspace deps at build time, so a published build\n" +
      "freezes the bundled version. A pending changeset re-releases a bundled dep\n" +
      "without re-releasing the bundler, which would ship a stale engine:\n",
  );
  for (const { name, stale } of violations) {
    console.error(`  • ${name} bundles ${stale.join(", ")}`);
  }
  console.error(
    "\nAdd a changeset that bumps each listed package too (a `patch` is enough):\n" +
      "  pnpm changeset\n\n" +
      "If a change genuinely does not affect the bundled output, bump it anyway —\n" +
      "the published build still needs to be rebuilt to pick up the new dep.\n",
  );
  process.exit(1);
}

console.log(
  `✓ Bundled-package check: ${bundlers.length} bundler(s) scanned, no stale re-releases pending.`,
);
