/**
 * Playwright peer resolution for the CLI — `--version`, the missing-driver
 * hint, and the error catalog.
 *
 * Uses `createRequire`, not bare `import("playwright")`. ESM import ignores
 * NODE_PATH, so a sibling `npm i -g playwright` was visible to `--version`
 * and invisible to `audit` (D2, cli 0.1.0-beta.5, Windows + Volta).
 *
 * Keep this resolver in lockstep with `packages/browser/src/playwright-load.ts`.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function readPlaywrightVersion(
  fromUrl: string = import.meta.url,
): string | undefined {
  try {
    const pkg = createRequire(fromUrl)("playwright/package.json") as {
      version?: string;
    };
    return pkg.version;
  } catch {
    return undefined;
  }
}

export function isPlaywrightNotInstalled(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") {
    return false;
  }
  return /playwright/i.test(err.message);
}

export function cliPackageRoot(fromUrl: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    const pkgFile = join(dir, "package.json");
    if (existsSync(pkgFile)) {
      try {
        const name = (
          JSON.parse(readFileSync(pkgFile, "utf8")) as { name?: string }
        ).name;
        if (name === "@real-a11y-dev/cli") return dir;
      } catch {
        /* ignore a broken package.json and keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(
    createRequire(fromUrl).resolve("@real-a11y-dev/cli/package.json"),
  );
}

/**
 * Name commands that repair THIS layout. A global CLI is not unblocked by
 * `npm i -D playwright` in an arbitrary project directory.
 *
 * "Local" means the running binary lives under `cwd`'s (or an ancestor's)
 * `node_modules/@real-a11y-dev/cli`. Resolving the package name from cwd is
 * not enough: `NODE_PATH` makes a global install visible from everywhere.
 */
export function missingPlaywrightHint(
  cwd: string = process.cwd(),
  runningCliRoot: string = cliPackageRoot(),
): string {
  if (cliIsLocalTo(cwd, runningCliRoot)) {
    return "npm i -D playwright && npx real-a11y install";
  }
  return "npm i -g playwright && real-a11y install";
}

function cliIsLocalTo(cwd: string, cliRoot: string): boolean {
  let cliReal: string;
  try {
    cliReal = realpathSync(cliRoot);
  } catch {
    return false;
  }
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, "node_modules", "@real-a11y-dev", "cli");
    if (existsSync(candidate)) {
      try {
        if (realpathSync(candidate) === cliReal) return true;
      } catch {
        /* ignore a dangling link and keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}
