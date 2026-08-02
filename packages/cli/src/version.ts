/**
 * Read the CLI's own package version in a way that works both in source
 * (under `src/...`) and after tsup bundles the code into `dist/` or
 * `dist/daemon/entry.js`. A static `require("../package.json")` path breaks
 * when the bundler flattens nested source files into the dist root.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findPackageVersion(): string {
  let dir = dirname(fileURLToPath(new URL(".", import.meta.url)));
  for (let i = 0; i < 4; i++) {
    try {
      const raw = readFileSync(join(dir, "package.json"), "utf8");
      const pkg = JSON.parse(raw) as { name?: string; version: string };
      if (pkg.name === "@real-a11y-dev/cli") {
        return pkg.version;
      }
    } catch {
      // keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "0.0.0";
}

export const CLI_VERSION = findPackageVersion();
