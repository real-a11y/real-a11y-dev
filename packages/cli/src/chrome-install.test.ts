import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrowserPlatform } from "@puppeteer/browsers";
import { readChromeManifest } from "@real-a11y-dev/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runInstall,
  type HostOs,
  type InstallerDeps,
} from "./chrome-install.js";
import { CliError, EXIT } from "./exit.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "real-a11y-install-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function envFor(d: string): NodeJS.ProcessEnv {
  return { REAL_A11Y_BROWSERS_DIR: d };
}

const LINUX_OS: HostOs = { platform: "linux", arch: "x64" };
const DEFAULT_BUILD_ID = "131.0.6778.87";

/** A fake @puppeteer/browsers surface that actually writes a fake binary to
 * disk on install(), so readChromeManifest()'s existsSync check passes. */
function makeFakeDeps(overrides: Partial<InstallerDeps> = {}) {
  const installedIds = new Set<string>();
  const binFor = (buildId: string) => join(dir, "bin", buildId, "chrome");

  const deps: InstallerDeps = {
    detectBrowserPlatform: () => BrowserPlatform.LINUX,
    resolveBuildId: vi.fn(async () => DEFAULT_BUILD_ID),
    install: vi.fn(async ({ buildId }) => {
      const bin = binFor(buildId);
      mkdirSync(join(dir, "bin", buildId), { recursive: true });
      writeFileSync(bin, "#!/bin/sh\n");
      installedIds.add(buildId);
      return { executablePath: bin };
    }),
    uninstall: vi.fn(async ({ buildId }) => {
      installedIds.delete(buildId);
    }),
    installedBuildIds: vi.fn(async () => [...installedIds]),
    ...overrides,
  };
  return { deps, binFor, installedIds };
}

describe("runInstall — fresh install", () => {
  it("resolves stable, downloads, and writes the manifest", async () => {
    const { deps, binFor } = makeFakeDeps();
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const code = await runInstall(
        { force: false, quiet: true, verbose: false },
        { deps, env: envFor(dir), os: LINUX_OS },
      );
      expect(code).toBe(EXIT.OK);
      expect(deps.resolveBuildId).toHaveBeenCalledWith(
        BrowserPlatform.LINUX,
        "stable",
      );
      expect(deps.install).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(`${binFor(DEFAULT_BUILD_ID)}\n`);
      const manifest = readChromeManifest(envFor(dir));
      expect(manifest).toMatchObject({
        buildId: DEFAULT_BUILD_ID,
        channel: "stable",
        executablePath: binFor(DEFAULT_BUILD_ID),
      });
    } finally {
      write.mockRestore();
    }
  });
});

describe("runInstall — idempotence", () => {
  it("bare re-run does zero network work when already installed", async () => {
    const { deps } = makeFakeDeps();
    await runInstall(
      { force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );
    vi.mocked(deps.resolveBuildId).mockClear();
    vi.mocked(deps.install).mockClear();

    const code = await runInstall(
      { force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );
    expect(code).toBe(EXIT.OK);
    expect(deps.resolveBuildId).not.toHaveBeenCalled();
    expect(deps.install).not.toHaveBeenCalled();
  });

  it("--channel re-resolves but skips download when the build is unchanged", async () => {
    const { deps } = makeFakeDeps();
    await runInstall(
      { force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );
    vi.mocked(deps.install).mockClear();

    const code = await runInstall(
      { channel: "stable", force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );
    expect(code).toBe(EXIT.OK);
    expect(deps.resolveBuildId).toHaveBeenCalled();
    expect(deps.install).not.toHaveBeenCalled();
  });

  it("--channel downloads again when the resolved build changed", async () => {
    const { deps } = makeFakeDeps();
    await runInstall(
      { force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );
    vi.mocked(deps.resolveBuildId).mockResolvedValueOnce("132.0.0.1");
    vi.mocked(deps.install).mockClear();

    const code = await runInstall(
      { channel: "beta", force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );
    expect(code).toBe(EXIT.OK);
    expect(deps.install).toHaveBeenCalledTimes(1);
    expect(readChromeManifest(envFor(dir))).toMatchObject({
      buildId: "132.0.0.1",
    });
  });

  it("--version pinned to the already-installed build never touches the network", async () => {
    const { deps } = makeFakeDeps();
    await runInstall(
      { force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );
    vi.mocked(deps.resolveBuildId).mockClear();
    vi.mocked(deps.install).mockClear();

    const code = await runInstall(
      { version: DEFAULT_BUILD_ID, force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );
    expect(code).toBe(EXIT.OK);
    expect(deps.resolveBuildId).not.toHaveBeenCalled();
    expect(deps.install).not.toHaveBeenCalled();
  });

  it("--version pinned to a different build installs it without resolving a channel", async () => {
    const { deps } = makeFakeDeps();
    const code = await runInstall(
      { version: "999.0.0.1", force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );
    expect(code).toBe(EXIT.OK);
    expect(deps.resolveBuildId).not.toHaveBeenCalled();
    expect(deps.install).toHaveBeenCalledTimes(1);
    expect(readChromeManifest(envFor(dir))).toMatchObject({
      buildId: "999.0.0.1",
    });
    // Pinned installs have no channel to track.
    expect(readChromeManifest(envFor(dir))?.channel).toBeUndefined();
  });

  it("--force reinstalls even when the same build is already present", async () => {
    const { deps } = makeFakeDeps();
    await runInstall(
      { force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );
    vi.mocked(deps.install).mockClear();

    const code = await runInstall(
      { force: true, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );
    expect(code).toBe(EXIT.OK);
    expect(deps.install).toHaveBeenCalledTimes(1);
  });

  it("--force actually replaces an existing build rather than silently reusing it", async () => {
    // @puppeteer/browsers' real install() returns an existing, executable-
    // containing build directory unchanged — even if that binary is
    // corrupted — so this fake mirrors that: it short-circuits whenever the
    // buildId is still tracked as installed, and only writes a fresh binary
    // once it isn't (i.e. after a real uninstall cleared it).
    const { deps, binFor, installedIds } = makeFakeDeps();
    await runInstall(
      { force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );

    writeFileSync(binFor(DEFAULT_BUILD_ID), "CORRUPTED");
    const realInstall = deps.install;
    deps.install = vi.fn(async (opts) => {
      if (installedIds.has(opts.buildId)) {
        return { executablePath: binFor(opts.buildId) };
      }
      return realInstall(opts);
    });

    const code = await runInstall(
      { force: true, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );
    expect(code).toBe(EXIT.OK);
    expect(deps.uninstall).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: DEFAULT_BUILD_ID }),
    );
    expect(readFileSync(binFor(DEFAULT_BUILD_ID), "utf8")).not.toBe(
      "CORRUPTED",
    );
  });
});

describe("runInstall — partial-install recovery", () => {
  it("cleans a broken partial directory and retries once", async () => {
    const { deps } = makeFakeDeps();
    const realInstall = deps.install;
    let attempts = 0;
    deps.install = vi.fn(async (opts) => {
      attempts++;
      if (attempts === 1) {
        throw new Error(
          "The browser folder exists but the executable is missing",
        );
      }
      return realInstall(opts);
    });

    const code = await runInstall(
      { force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );
    expect(code).toBe(EXIT.OK);
    expect(attempts).toBe(2);
    expect(deps.uninstall).toHaveBeenCalledTimes(1);
  });

  it("surfaces a CliError when both install attempts fail", async () => {
    const { deps } = makeFakeDeps({
      install: vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    });
    await expect(
      runInstall(
        { force: false, quiet: true, verbose: false },
        { deps, env: envFor(dir), os: LINUX_OS },
      ),
    ).rejects.toThrow(/could not install Chrome/);
  });
});

describe("runInstall — pruning", () => {
  it("removes other cached builds after a successful install", async () => {
    const { deps, installedIds } = makeFakeDeps();
    installedIds.add("100.0.0.1");
    installedIds.add("100.0.0.2");

    await runInstall(
      { force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    );

    expect(deps.uninstall).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: "100.0.0.1" }),
    );
    expect(deps.uninstall).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: "100.0.0.2" }),
    );
    expect(installedIds.has(DEFAULT_BUILD_ID)).toBe(true);
  });
});

describe("runInstall — platform guards", () => {
  it("refuses cleanly when the platform is unsupported", async () => {
    const { deps } = makeFakeDeps({ detectBrowserPlatform: () => undefined });
    await expect(
      runInstall(
        { force: false, quiet: true, verbose: false },
        { deps, env: envFor(dir), os: { platform: "freebsd", arch: "x64" } },
      ),
    ).rejects.toThrow(/no build for this platform/);
  });

  it("refuses linux/arm64 even though @puppeteer/browsers itself would resolve a (wrong) build", async () => {
    const { deps } = makeFakeDeps();
    await expect(
      runInstall(
        { force: false, quiet: true, verbose: false },
        { deps, env: envFor(dir), os: { platform: "linux", arch: "arm64" } },
      ),
    ).rejects.toThrow(/no linux-arm64 build/);
    expect(deps.install).not.toHaveBeenCalled();
  });
});

describe("runInstall — validation", () => {
  it("rejects --channel combined with --version", async () => {
    const { deps } = makeFakeDeps();
    await expect(
      runInstall(
        {
          channel: "stable",
          version: DEFAULT_BUILD_ID,
          force: false,
          quiet: true,
          verbose: false,
        },
        { deps, env: envFor(dir), os: LINUX_OS },
      ),
    ).rejects.toThrow(CliError);
  });

  it("rejects a malformed --version", async () => {
    const { deps } = makeFakeDeps();
    await expect(
      runInstall(
        { version: "not-a-version", force: false, quiet: true, verbose: false },
        { deps, env: envFor(dir), os: LINUX_OS },
      ),
    ).rejects.toThrow(/expects a Chrome build id/);
  });

  it("wraps a channel-resolution network failure with a --version hint", async () => {
    const { deps } = makeFakeDeps({
      resolveBuildId: vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    });
    const err: CliError = await runInstall(
      { force: false, quiet: true, verbose: false },
      { deps, env: envFor(dir), os: LINUX_OS },
    ).catch((e: unknown) => e as CliError);
    expect(err).toBeInstanceOf(CliError);
    expect(err.hint).toMatch(/--version/);
  });
});
