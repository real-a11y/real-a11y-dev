// Overlay the DEV-ONLY dogfood permissions onto the copied manifest in
// `dist-dogfood/` (RFC PR H). Runs after the `DOGFOOD=1` vite build, which
// copies the clean `public/manifest.json`. This adds the `debugger` (and
// `tabs`) permission the native mode needs — kept OUT of the store build's
// `public/manifest.json` so the published listing never requests it.
//
// The build output is meant to be loaded UNPACKED for dogfooding; it is never
// submitted to the Chrome Web Store.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const pkg = JSON.parse(
  await readFile(resolve(pkgRoot, "package.json"), "utf8"),
);
const manifestPath = resolve(pkgRoot, "dist-dogfood/manifest.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

// Powerful permission — this is exactly why the build is dev-only and unpacked.
const permissions = new Set(manifest.permissions ?? []);
permissions.add("debugger"); // read/dispatch the native AX tree over CDP
permissions.add("tabs"); // resolve the active tab id to attach to
manifest.permissions = [...permissions];

// Make it unmistakable in chrome://extensions that this is the dev build.
manifest.name = `${manifest.name} (native dogfood)`;
manifest.version = pkg.version;

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(
  `dogfood manifest written: ${manifest.name} v${manifest.version} ` +
    `permissions=[${manifest.permissions.join(", ")}]`,
);
