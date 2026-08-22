/**
 * Load Playwright the same way `--version` reads its package.json:
 * `createRequire` (honours NODE_PATH and a sibling global), then ESM-import
 * the package's `exports["."].import` entry.
 *
 * Bare `import("playwright")` does not see NODE_PATH. That is how
 * `real-a11y --version` could print a Playwright version while `audit` threw
 * `ERR_MODULE_NOT_FOUND` — D2 on Windows + Volta, cli 0.1.0-beta.5.
 *
 * `require.resolve("playwright")` is the CJS entry. A native `import()` of
 * that file yields `{ default }` only — `chromium` is undefined and
 * `chromium.launch` throws. Vitest interops CJS and hid this; the built
 * CLI running under Node does not.
 *
 * Keep the createRequire walk in lockstep with
 * `packages/cli/src/playwright-resolve.ts`.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import type * as Playwright from "playwright";

interface PlaywrightPkg {
  exports?: {
    "."?: {
      import?: string | { default?: string };
    };
  };
  module?: string;
  main?: string;
}

export function resolvePlaywrightEntry(
  fromUrl: string = import.meta.url,
): string | undefined {
  try {
    const require = createRequire(fromUrl);
    const pkgPath = require.resolve("playwright/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PlaywrightPkg;
    const exp = pkg.exports?.["."]?.import;
    const rel =
      (typeof exp === "string" ? exp : exp?.default) ?? pkg.module ?? pkg.main;
    if (!rel) return undefined;
    return join(dirname(pkgPath), rel);
  } catch {
    return undefined;
  }
}

export async function loadPlaywright(
  fromUrl: string = import.meta.url,
): Promise<typeof Playwright> {
  const entry = resolvePlaywrightEntry(fromUrl);
  if (!entry) {
    const err = new Error(
      `Cannot find package 'playwright' imported from ${fromUrl}`,
    ) as NodeJS.ErrnoException;
    err.code = "ERR_MODULE_NOT_FOUND";
    throw err;
  }
  const loaded = (await import(pathToFileURL(entry).href)) as
    typeof Playwright | { default: typeof Playwright };
  const mod = "chromium" in loaded && loaded.chromium ? loaded : loaded.default;
  if (!mod?.chromium) {
    throw new Error(
      `Playwright resolved at ${entry} but has no chromium export`,
    );
  }
  return mod;
}
