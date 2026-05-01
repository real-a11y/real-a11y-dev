// Keep public/manifest.json's `version` in sync with package.json.
//
// Runs as `prebuild` so every build (local + CI) writes the canonical
// version into the manifest before Vite copies it into dist/. Without
// this, the two files drift — which already happened once and shipped
// to the store with a stale version.
//
// `--check` mode: fail the build instead of mutating the file. Used in
// CI so PRs that forget to bump the manifest are caught early.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const pkgPath = resolve(pkgRoot, "package.json");
const manifestPath = resolve(pkgRoot, "public/manifest.json");

const checkOnly = process.argv.includes("--check");

const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
const manifestRaw = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);

if (manifest.version === pkg.version) {
  process.exit(0);
}

if (checkOnly) {
  console.error(
    `manifest version mismatch: package.json=${pkg.version} manifest.json=${manifest.version}`,
  );
  console.error(
    `run \`pnpm --filter @real-a11y-dev/semantic-navigator-extension prebuild\` and commit the change.`,
  );
  process.exit(1);
}

manifest.version = pkg.version;
const next = JSON.stringify(manifest, null, 2) + "\n";
await writeFile(manifestPath, next);
console.log(
  `synced manifest.version → ${pkg.version} (was ${JSON.parse(manifestRaw).version})`,
);
