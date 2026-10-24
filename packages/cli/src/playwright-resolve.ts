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
 * How the running CLI was installed, which decides the commands that repair it.
 *
 * - `local` — a project dependency: the running binary lives under `cwd`'s (or
 *   an ancestor's) `node_modules/@real-a11y-dev/cli`, and `npx real-a11y`
 *   reaches it. Resolving the package name from cwd is not enough to say so:
 *   `NODE_PATH` makes a global install visible from everywhere.
 * - `npx` — npm's on-demand cache, from `npx @real-a11y-dev/cli`. There is no
 *   `real-a11y` on PATH, and `npx real-a11y` asks the registry for an unscoped
 *   package that is not ours.
 * - `global` — anything else.
 */
export type CliLayout = "local" | "npx" | "global";

export function cliLayout(
  cwd: string = process.cwd(),
  runningCliRoot: string = cliPackageRoot(),
): CliLayout {
  if (cliIsLocalTo(cwd, runningCliRoot)) return "local";
  // npm runs `npx <pkg>` from `<npm cache>/_npx/<hash>/node_modules`.
  if (runningCliRoot.split(/[\\/]/).includes("_npx")) return "npx";
  return "global";
}

/** The command that downloads a browser for the running CLI, in its layout. */
export function installCommand(
  cwd: string = process.cwd(),
  runningCliRoot: string = cliPackageRoot(),
): string {
  switch (cliLayout(cwd, runningCliRoot)) {
    case "local":
      return "npx real-a11y install";
    case "npx":
      return "npx -y @real-a11y-dev/cli install";
    case "global":
      return "real-a11y install";
  }
}

/**
 * Name commands that repair THIS layout. A global CLI is not unblocked by
 * `npm i -D playwright` in an arbitrary project directory, and an npx run is
 * not unblocked by a global Playwright: it resolves only what was installed
 * beside it (or `NODE_PATH`), so it needs both in a project.
 */
export function missingPlaywrightHint(
  cwd: string = process.cwd(),
  runningCliRoot: string = cliPackageRoot(),
): string {
  switch (cliLayout(cwd, runningCliRoot)) {
    case "local":
      return "npm i -D playwright && npx real-a11y install";
    case "npx":
      return "npm i -D @real-a11y-dev/cli playwright && npx real-a11y install";
    case "global":
      return "npm i -g playwright && real-a11y install";
  }
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
