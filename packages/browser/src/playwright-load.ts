/**
 * Load Playwright the same way `--version` reads its package.json:
 * `createRequire` (honours NODE_PATH and a sibling global), then ESM-import
 * the resolved entry.
 *
 * Bare `import("playwright")` does not see NODE_PATH. That is how
 * `real-a11y --version` could print a Playwright version while `audit` threw
 * `ERR_MODULE_NOT_FOUND` — D2 on Windows + Volta, cli 0.1.0-beta.5.
 *
 * Keep this resolver in lockstep with `packages/cli/src/playwright-resolve.ts`.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import type * as Playwright from "playwright";

export function resolvePlaywrightEntry(
  fromUrl: string = import.meta.url,
): string | undefined {
  try {
    return createRequire(fromUrl).resolve("playwright");
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
  return import(pathToFileURL(entry).href);
}
