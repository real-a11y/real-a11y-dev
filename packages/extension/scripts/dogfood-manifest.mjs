// Mark the copied manifest in `dist-dogfood/` as the dogfood build. Runs after
// the `DOGFOOD=1` vite build, which copies `public/manifest.json` verbatim —
// that manifest already carries `debugger`/`tabs`/`storage` (native mode ships
// in every build now, gated by a runtime setting, not a build-time permission
// split), so this script no longer needs to add them itself. What it still
// does: rename the build so it's unmistakable in chrome://extensions, and
// additionally bundle `DogfoodPanel`, the internal telemetry/diagnostics UI
// for the dogfooding exercise (see `__DOGFOOD__` in vite.config.ts) — that
// panel is the one thing this build has that the store build doesn't.
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

// Make it unmistakable in chrome://extensions that this is the dev build.
manifest.name = `${manifest.name} (native dogfood)`;
manifest.version = pkg.version;

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(
  `dogfood manifest written: ${manifest.name} v${manifest.version} ` +
    `permissions=[${manifest.permissions.join(", ")}]`,
);
