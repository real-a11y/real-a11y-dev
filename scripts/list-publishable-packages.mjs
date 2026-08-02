// Print every workspace package that `pnpm publish -r` would publish to npm, one
// `<name>@<version>` per line — the exact tag names `release-tag.yml` creates
// after a release PR merges.
//
// "Publishable" = a non-private package under packages/ with a name and a
// version. This mirrors the set `pnpm publish -r` acts on (it skips
// `private: true`) and the set scripts/advance-latest.mjs advances `latest` for.
// That definition is duplicated in advance-latest.mjs on purpose — the publish
// path stays free of cross-script imports — so if you change what "publishable"
// means, change it in both.
//
// Usage: node scripts/list-publishable-packages.mjs

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = join(ROOT, "packages");

for (const dir of readdirSync(PACKAGES)) {
  const manifest = join(PACKAGES, dir, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  if (pkg.private || !pkg.name || !pkg.version) continue;
  // e.g. `@real-a11y-dev/core@0.1.0-beta.10` — the changesets tag convention.
  console.log(`${pkg.name}@${pkg.version}`);
}
