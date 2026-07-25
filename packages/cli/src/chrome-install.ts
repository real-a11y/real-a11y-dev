/**
 * The actual `real-a11y install` downloader. Resolves a Chrome for Testing
 * build via `@puppeteer/browsers`, downloads/unpacks it into Real A11y's own
 * cache, and commits an atomic manifest recording the executable path — the
 * write side of the contract `resolveChromeExecutable` (in
 * `@real-a11y-dev/browser`) reads back at launch time.
 *
 * The `@puppeteer/browsers` surface we use is wrapped behind {@link
 * InstallerDeps} so unit tests can run fully offline, never touch the real
 * filesystem cache, and never depend on `Browser`/`BrowserPlatform` shapes
 * from a third-party package.
 */

import { mkdirSync } from "node:fs";
import { arch, platform as osPlatform } from "node:os";

import {
  Browser,
  detectBrowserPlatform,
  getInstalledBrowsers,
  install,
  resolveBuildId,
  uninstall,
  type BrowserPlatform,
} from "@puppeteer/browsers";

import {
  CHROME_MANIFEST_VERSION,
  chromeCacheDir,
  chromeManifestPath,
  readChromeManifest,
  type ChromeChannel,
  type InstalledChrome,
} from "@real-a11y-dev/browser";

import { CliError, EXIT } from "./exit.js";
import { progress, writeFileAtomic } from "./output.js";

export interface InstallRequest {
  /** Explicit `--channel`; undefined when the flag wasn't passed at all. */
  channel?: ChromeChannel;
  /** Explicit `--version` (a Chrome build id, e.g. "131.0.6778.87"). */
  version?: string;
  force: boolean;
  quiet: boolean;
  verbose: boolean;
}

/** The subset of `@puppeteer/browsers` this installer needs, as our own
 * interface — never the package's own (overloaded) function signatures — so
 * a test double never has to know about `Browser`/`BrowserPlatform`. */
export interface InstallerDeps {
  detectBrowserPlatform(): BrowserPlatform | undefined;
  resolveBuildId(platform: BrowserPlatform, tag: string): Promise<string>;
  install(opts: {
    buildId: string;
    cacheDir: string;
    platform: BrowserPlatform;
    onProgress?: (downloadedBytes: number, totalBytes: number) => void;
  }): Promise<{ executablePath: string }>;
  uninstall(opts: {
    buildId: string;
    cacheDir: string;
    platform: BrowserPlatform;
  }): Promise<void>;
  /** Every currently-installed Chrome build id under `cacheDir`. */
  installedBuildIds(cacheDir: string): Promise<string[]>;
}

const REAL_DEPS: InstallerDeps = {
  detectBrowserPlatform,
  resolveBuildId: (platform, tag) =>
    resolveBuildId(Browser.CHROME, platform, tag),
  install: async ({ buildId, cacheDir, platform, onProgress }) => {
    const installed = await install({
      browser: Browser.CHROME,
      buildId,
      cacheDir,
      platform,
      ...(onProgress ? { downloadProgressCallback: onProgress } : {}),
    });
    return { executablePath: installed.executablePath };
  },
  uninstall: ({ buildId, cacheDir, platform }) =>
    uninstall({ browser: Browser.CHROME, buildId, cacheDir, platform }),
  installedBuildIds: async (cacheDir) => {
    const installed = await getInstalledBrowsers({ cacheDir });
    return installed
      .filter((b) => b.browser === Browser.CHROME)
      .map((b) => b.buildId);
  },
};

const VERSION_RE = /^\d+\.\d+\.\d+\.\d+$/;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The OS facts {@link assertSupportedPlatform} needs — a small seam so tests
 * can exercise the arm64/unsupported-platform paths without depending on the
 * machine actually running the test suite. */
export interface HostOs {
  platform: string;
  arch: string;
}

/**
 * Refuse before downloading anything wrong. `detectBrowserPlatform()` returns
 * `undefined` only on truly unsupported OSes — but on Linux/arm64 it returns
 * `linux_arm`, and `@puppeteer/browsers` silently maps that to the x64
 * `linux64` Chrome for Testing archive (CfT publishes no arm64 Linux build),
 * which won't execute here. Catch that case ourselves rather than let it
 * download a binary that fails at launch time instead of at install time.
 */
function assertSupportedPlatform(
  detected: BrowserPlatform | undefined,
  os: HostOs,
): BrowserPlatform {
  if (!detected) {
    throw new CliError(
      `Chrome for Testing has no build for this platform (${os.platform}/${os.arch}).`,
      "install Playwright's own Chromium instead: npx playwright install chromium",
    );
  }
  if (os.platform === "linux" && os.arch === "arm64") {
    throw new CliError(
      "Chrome for Testing publishes no linux-arm64 build.",
      "Playwright's own Chromium does ship linux-arm64 — install it with: npx playwright install chromium",
    );
  }
  return detected;
}

/** stderr progress callback: a rewritten `\r` percentage on a TTY, else lines at 25/50/75/100%. */
function makeProgressCallback(
  quiet: boolean,
): ((downloaded: number, total: number) => void) | undefined {
  if (quiet) return undefined;
  const isTTY = Boolean(process.stderr.isTTY);
  let lastStep = -1;
  return (downloaded, total) => {
    if (!total) return;
    const pct = Math.floor((downloaded / total) * 100);
    if (isTTY) {
      process.stderr.write(`\rdownloading… ${pct}%${pct >= 100 ? "\n" : ""}`);
      return;
    }
    const step = Math.floor(pct / 25) * 25;
    if (step > lastStep && step > 0) {
      lastStep = step;
      process.stderr.write(`downloading… ${step}%\n`);
    }
  };
}

/**
 * Install `buildId`, self-healing a partial directory left by a previously
 * interrupted install: `@puppeteer/browsers` refuses to touch a versioned
 * folder that exists but has no executable in it, so clear that one buildId
 * and retry once rather than surfacing a confusing nested error.
 */
async function installFresh(
  deps: InstallerDeps,
  cacheDir: string,
  platform: BrowserPlatform,
  buildId: string,
  quiet: boolean,
): Promise<{ executablePath: string }> {
  const onProgress = makeProgressCallback(quiet);
  try {
    return await deps.install({ buildId, cacheDir, platform, onProgress });
  } catch {
    await deps.uninstall({ buildId, cacheDir, platform }).catch(() => {});
    return await deps.install({ buildId, cacheDir, platform, onProgress });
  }
}

/** Best-effort: never fail the install itself over cache cleanup. */
async function pruneOtherBuilds(
  deps: InstallerDeps,
  cacheDir: string,
  platform: BrowserPlatform,
  keepBuildId: string,
  quiet: boolean,
): Promise<void> {
  let others: string[];
  try {
    others = (await deps.installedBuildIds(cacheDir)).filter(
      (id) => id !== keepBuildId,
    );
  } catch {
    return;
  }
  for (const buildId of others) {
    const removed = await deps
      .uninstall({ buildId, cacheDir, platform })
      .then(() => true)
      .catch(() => false);
    if (removed) progress(`removed old Chrome ${buildId}`, { quiet });
  }
}

function writeManifest(
  env: NodeJS.ProcessEnv,
  manifest: InstalledChrome,
): void {
  mkdirSync(chromeCacheDir(env), { recursive: true });
  writeFileAtomic(
    chromeManifestPath(env),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function reportAlreadyInstalled(
  existing: InstalledChrome,
  quiet: boolean,
): number {
  progress(
    `Chrome ${existing.buildId} already installed (use --force to reinstall)`,
    { quiet },
  );
  process.stdout.write(`${existing.executablePath}\n`);
  return EXIT.OK;
}

/**
 * Orchestrates the whole `install` command: skip-check → resolve buildId →
 * clean partials → download with progress → verify → write the manifest
 * atomically (the commit point) → prune old versions → print the path.
 */
export async function runInstall(
  req: InstallRequest,
  overrides: {
    deps?: Partial<InstallerDeps>;
    env?: NodeJS.ProcessEnv;
    os?: HostOs;
  } = {},
): Promise<number> {
  const env = overrides.env ?? process.env;
  const deps: InstallerDeps = { ...REAL_DEPS, ...overrides.deps };
  const os = overrides.os ?? { platform: osPlatform(), arch: arch() };

  if (req.channel && req.version) {
    throw new CliError(
      "--channel and --version can't be combined.",
      "pick one: a channel to track (--channel stable), or an exact build to pin (--version 131.0.6778.87).",
    );
  }
  if (req.version !== undefined && !VERSION_RE.test(req.version)) {
    throw new CliError(
      `--version expects a Chrome build id like 131.0.6778.66 — got "${req.version}".`,
    );
  }

  const cacheDir = chromeCacheDir(env);
  const platform = assertSupportedPlatform(deps.detectBrowserPlatform(), os);
  if (req.verbose) {
    process.stderr.write(`cache directory: ${cacheDir}\n`);
  }

  const existing = readChromeManifest(env);
  const usingVersion = req.version !== undefined;

  if (existing && !req.force) {
    if (usingVersion && existing.buildId === req.version) {
      return reportAlreadyInstalled(existing, req.quiet);
    }
    if (!usingVersion && !req.channel) {
      // Bare `install`, nothing pinned/tracked explicitly: trust the cache,
      // zero network — this is what makes re-runs instant.
      return reportAlreadyInstalled(existing, req.quiet);
    }
  }

  const channel: ChromeChannel = req.channel ?? "stable";
  let buildId: string;
  if (usingVersion) {
    buildId = req.version as string;
  } else {
    progress(`resolving Chrome ${channel}…`, { quiet: req.quiet });
    try {
      buildId = await deps.resolveBuildId(platform, channel);
    } catch (err) {
      throw new CliError(
        `could not resolve the Chrome ${channel} version: ${errMessage(err)}`,
        "the Chrome for Testing version endpoint may be unreachable — pin an exact build instead: --version <buildId> (see https://googlechromelabs.github.io/chrome-for-testing/).",
      );
    }
  }

  if (existing && !req.force && existing.buildId === buildId) {
    return reportAlreadyInstalled(existing, req.quiet);
  }

  progress(`downloading Chrome ${buildId} (${platform})…`, {
    quiet: req.quiet,
  });
  let installed: { executablePath: string };
  try {
    installed = await installFresh(
      deps,
      cacheDir,
      platform,
      buildId,
      req.quiet,
    );
  } catch (err) {
    throw new CliError(
      `could not install Chrome ${buildId}: ${errMessage(err)}`,
      "check your network connection, or pin a known-good build with --version.",
    );
  }

  const manifest: InstalledChrome = {
    manifestVersion: CHROME_MANIFEST_VERSION,
    buildId,
    platform,
    executablePath: installed.executablePath,
    installedAt: new Date().toISOString(),
    ...(usingVersion ? {} : { channel }),
  };
  writeManifest(env, manifest);

  await pruneOtherBuilds(deps, cacheDir, platform, buildId, req.quiet);

  progress(`installed Chrome ${buildId} → ${installed.executablePath}`, {
    quiet: req.quiet,
  });
  process.stdout.write(`${installed.executablePath}\n`);
  return EXIT.OK;
}
