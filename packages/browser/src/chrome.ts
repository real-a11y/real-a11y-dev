/**
 * Chrome for Testing cache layout + manifest contract, shared by the CLI's
 * `real-a11y install` (write side, in @real-a11y-dev/cli) and every launch
 * path (read side, here) — so the CLI and the MCP server can never disagree
 * about which binary `install` set up. Dependency-free (`node:fs`/`os`/`path`
 * only) so importing it never pulls in playwright or a downloader.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { join } from "node:path";

export const CHROME_MANIFEST_VERSION = 1;

/** Chrome release channel, as named by Chrome for Testing's own endpoints. */
export type ChromeChannel = "stable" | "beta" | "dev" | "canary";

/** The manifest `real-a11y install` writes after a successful download. */
export interface InstalledChrome {
  manifestVersion: number;
  buildId: string;
  /** Absent when installed via a pinned `--version` (no channel to track). */
  channel?: ChromeChannel;
  /** `@puppeteer/browsers`' own platform id (e.g. "linux", "mac_arm"). */
  platform: string;
  executablePath: string;
  installedAt: string;
}

/** `REAL_A11Y_BROWSERS_DIR`, else the platform's cache directory + `/real-a11y`. */
export function chromeCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.REAL_A11Y_BROWSERS_DIR;
  if (override) return override;
  const home = homedir();
  switch (osPlatform()) {
    case "darwin":
      return join(home, "Library", "Caches", "real-a11y");
    case "win32":
      return join(
        env.LOCALAPPDATA || join(home, "AppData", "Local"),
        "real-a11y",
      );
    default:
      return join(env.XDG_CACHE_HOME || join(home, ".cache"), "real-a11y");
  }
}

export function chromeManifestPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(chromeCacheDir(env), "chrome-manifest.json");
}

function isInstalledChromeShape(value: unknown): value is InstalledChrome {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.manifestVersion === CHROME_MANIFEST_VERSION &&
    typeof v.buildId === "string" &&
    typeof v.platform === "string" &&
    typeof v.executablePath === "string" &&
    typeof v.installedAt === "string"
  );
}

/**
 * Read + validate the installed-Chrome manifest. Never throws — a
 * missing/corrupt manifest, or one whose recorded binary no longer exists on
 * disk, is treated the same as "nothing installed": callers fall back to
 * Playwright's own bundled Chromium.
 */
export function readChromeManifest(
  env: NodeJS.ProcessEnv = process.env,
): InstalledChrome | undefined {
  let raw: string;
  try {
    raw = readFileSync(chromeManifestPath(env), "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isInstalledChromeShape(parsed)) return undefined;
  if (!existsSync(parsed.executablePath)) return undefined;
  return parsed;
}

export interface ResolvedChromeExecutable {
  executablePath: string;
  source: "flag" | "env" | "installed";
}

/**
 * The one precedence spec both the CLI and the MCP server use to pick a
 * launchable Chrome binary:
 *
 *   1. `explicitPath` (CLI `--chrome-path`)  — hard error if it doesn't exist
 *   2. `REAL_A11Y_CHROME_PATH` env           — hard error if it doesn't exist
 *   3. the `real-a11y install` manifest      — soft: skip if absent/stale
 *   4. undefined → caller launches Playwright's own bundled Chromium
 *
 * An explicit override (flag or env) that silently fell back would hide a
 * typo; the manifest is soft because "nothing installed yet" is the normal,
 * expected state on a fresh machine.
 */
export function resolveChromeExecutable(
  opts: { explicitPath?: string; env?: NodeJS.ProcessEnv } = {},
): ResolvedChromeExecutable | undefined {
  const env = opts.env ?? process.env;

  if (opts.explicitPath) {
    if (!existsSync(opts.explicitPath)) {
      throw new Error(`--chrome-path does not exist: ${opts.explicitPath}`);
    }
    return { executablePath: opts.explicitPath, source: "flag" };
  }

  const fromEnv = env.REAL_A11Y_CHROME_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      throw new Error(`REAL_A11Y_CHROME_PATH does not exist: ${fromEnv}`);
    }
    return { executablePath: fromEnv, source: "env" };
  }

  const manifest = readChromeManifest(env);
  if (manifest) {
    return { executablePath: manifest.executablePath, source: "installed" };
  }
  return undefined;
}
