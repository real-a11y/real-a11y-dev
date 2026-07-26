import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CHROME_MANIFEST_VERSION,
  chromeCacheDir,
  chromeManifestPath,
  readChromeManifest,
  resolveChromeExecutable,
  type InstalledChrome,
} from "./chrome.js";

let dir: string;
let binPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "real-a11y-chrome-test-"));
  binPath = join(dir, "chrome-bin");
  writeFileSync(binPath, "#!/bin/sh\n");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function envWith(cacheDir: string): NodeJS.ProcessEnv {
  return { REAL_A11Y_BROWSERS_DIR: cacheDir };
}

function writeManifest(
  cacheDir: string,
  overrides: Partial<InstalledChrome> = {},
): void {
  mkdirSync(cacheDir, { recursive: true });
  const manifest: InstalledChrome = {
    manifestVersion: CHROME_MANIFEST_VERSION,
    buildId: "131.0.6778.87",
    channel: "stable",
    platform: "linux",
    executablePath: binPath,
    installedAt: new Date(0).toISOString(),
    ...overrides,
  };
  writeFileSync(
    chromeManifestPath(envWith(cacheDir)),
    JSON.stringify(manifest),
  );
}

describe("chromeCacheDir", () => {
  it("honors REAL_A11Y_BROWSERS_DIR above any platform default", () => {
    expect(chromeCacheDir(envWith("/custom/cache"))).toBe("/custom/cache");
  });

  it("falls back to a platform default when unset", () => {
    expect(chromeCacheDir({})).toContain("real-a11y");
  });
});

describe("readChromeManifest", () => {
  it("returns undefined when no manifest exists", () => {
    expect(readChromeManifest(envWith(dir))).toBeUndefined();
  });

  it("returns the manifest when valid and the binary exists", () => {
    writeManifest(dir);
    expect(readChromeManifest(envWith(dir))).toMatchObject({
      buildId: "131.0.6778.87",
      executablePath: binPath,
    });
  });

  it("returns undefined for corrupt JSON", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(chromeManifestPath(envWith(dir)), "{ not json");
    expect(readChromeManifest(envWith(dir))).toBeUndefined();
  });

  it("returns undefined for a wrong-shape manifest", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      chromeManifestPath(envWith(dir)),
      JSON.stringify({ foo: "bar" }),
    );
    expect(readChromeManifest(envWith(dir))).toBeUndefined();
  });

  it("returns undefined when manifestVersion doesn't match", () => {
    writeManifest(dir, { manifestVersion: 999 });
    expect(readChromeManifest(envWith(dir))).toBeUndefined();
  });

  it("returns undefined when the recorded binary no longer exists", () => {
    writeManifest(dir, { executablePath: join(dir, "gone") });
    expect(readChromeManifest(envWith(dir))).toBeUndefined();
  });
});

describe("resolveChromeExecutable", () => {
  it("prefers an explicit path over everything else", () => {
    writeManifest(dir);
    expect(
      resolveChromeExecutable({ explicitPath: binPath, env: envWith(dir) }),
    ).toEqual({ executablePath: binPath, source: "flag" });
  });

  it("throws when the explicit path doesn't exist", () => {
    expect(() =>
      resolveChromeExecutable({ explicitPath: join(dir, "missing") }),
    ).toThrow(/--chrome-path does not exist/);
  });

  it("falls back to REAL_A11Y_CHROME_PATH when no explicit path is given", () => {
    expect(
      resolveChromeExecutable({
        env: { ...envWith(dir), REAL_A11Y_CHROME_PATH: binPath },
      }),
    ).toEqual({ executablePath: binPath, source: "env" });
  });

  it("throws when REAL_A11Y_CHROME_PATH doesn't exist", () => {
    expect(() =>
      resolveChromeExecutable({
        env: { REAL_A11Y_CHROME_PATH: join(dir, "missing") },
      }),
    ).toThrow(/REAL_A11Y_CHROME_PATH does not exist/);
  });

  it("falls back to the installed manifest when no flag/env is set", () => {
    writeManifest(dir);
    expect(resolveChromeExecutable({ env: envWith(dir) })).toEqual({
      executablePath: binPath,
      source: "installed",
    });
  });

  it("returns undefined when nothing is configured or installed", () => {
    expect(resolveChromeExecutable({ env: envWith(dir) })).toBeUndefined();
  });
});
