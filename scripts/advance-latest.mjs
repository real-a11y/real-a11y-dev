// Advance the npm `latest` dist-tag after a prerelease publish.
//
// publish.yml ships under `--tag beta`, and `--tag beta` never moves `latest`.
// Pre-1.0 that's a footgun: `npm install <pkg>` resolves `latest`, so it keeps
// handing out an old version, and the npm page headlines a stale one. (This is
// why every @real-a11y-dev/* package showed beta.6 as "latest" while beta.7 was
// the newest publish.) This advances `latest` to each just-published version so
// the newest beta is the default install.
//
// Guards — both matter:
//   1. Skipped when the publish already went to `latest` (nothing to advance).
//   2. Only while in changesets prerelease mode (`.changeset/pre.json` mode ===
//      "pre"). Once a stable `latest` exists, moving it back to a prerelease
//      would regress every default install — so after `changeset pre exit` this
//      no-ops and the stable publish's own `--tag latest` owns `latest`.
//
// Auth: reuses the NODE_AUTH_TOKEN / .npmrc that the publish step set up.
//
// Usage: node scripts/advance-latest.mjs --published-tag <tag> [--dry-run]

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = join(ROOT, "packages");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const tagIndex = argv.indexOf("--published-tag");
const publishedTag = tagIndex >= 0 ? argv[tagIndex + 1] : "beta";

// Guard 1: the publish already set `latest` — nothing to advance.
if (publishedTag === "latest") {
  console.log("Published under `latest` already — nothing to advance.");
  process.exit(0);
}

// Guard 2: only manage latest-from-prerelease while pre-1.0.
const prePath = join(ROOT, ".changeset", "pre.json");
const pre = existsSync(prePath)
  ? JSON.parse(readFileSync(prePath, "utf8"))
  : null;
if (pre?.mode !== "pre") {
  console.log(
    "Not in changesets prerelease mode — `latest` is owned by the stable publish; nothing to do.",
  );
  process.exit(0);
}

// Publishable set = non-private workspace packages (mirrors `pnpm publish -r`).
const targets = [];
for (const dir of readdirSync(PACKAGES)) {
  const manifest = join(PACKAGES, dir, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  if (pkg.private || !pkg.name || !pkg.version) continue;
  targets.push({ name: pkg.name, version: pkg.version });
}

if (!targets.length) {
  console.log("No publishable packages found.");
  process.exit(0);
}

let failed = 0;
for (const { name, version } of targets) {
  const spec = `${name}@${version}`;
  if (dryRun) {
    console.log(`[dry-run] npm dist-tag add ${spec} latest`);
    continue;
  }
  try {
    execFileSync("npm", ["dist-tag", "add", spec, "latest"], {
      stdio: "inherit",
    });
  } catch {
    console.error(`✖ failed to set latest → ${spec}`);
    failed++;
  }
}

if (failed) {
  console.error(`\n${failed} package(s) could not be advanced to latest.`);
  process.exit(1);
}
console.log(
  `\n✓ latest → newest published version for ${targets.length} package(s)${dryRun ? " (dry run)" : ""}.`,
);
