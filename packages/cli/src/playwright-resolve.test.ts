import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cliLayout,
  installCommand,
  isPlaywrightNotInstalled,
  missingPlaywrightHint,
  readPlaywrightVersion,
} from "./playwright-resolve.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readPlaywrightVersion", () => {
  it("reads the workspace playwright via createRequire", () => {
    expect(readPlaywrightVersion()).toEqual(expect.stringMatching(/^\d+\./));
  });

  it("is undefined when createRequire cannot see playwright", () => {
    expect(readPlaywrightVersion("data:text/javascript,")).toBeUndefined();
  });
});

describe("missingPlaywrightHint", () => {
  it("names a global install when the running CLI is not under cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-pw-hint-"));
    temps.push(dir);
    writeFileSync(join(dir, "package.json"), "{}");
    expect(missingPlaywrightHint(dir, join(dir, "elsewhere", "cli"))).toBe(
      "npm i -g playwright && real-a11y install",
    );
  });

  it("names a local install when the running CLI is in cwd/node_modules", () => {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-pw-hint-"));
    temps.push(dir);
    const cliRoot = join(dir, "node_modules", "@real-a11y-dev", "cli");
    mkdirSync(cliRoot, { recursive: true });
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(
      join(cliRoot, "package.json"),
      '{"name":"@real-a11y-dev/cli"}',
    );
    expect(missingPlaywrightHint(dir, cliRoot)).toBe(
      "npm i -D playwright && npx real-a11y install",
    );
  });
});

describe("isPlaywrightNotInstalled", () => {
  it("accepts both ESM and CJS missing-module codes", () => {
    const esm = Object.assign(new Error("Cannot find package 'playwright'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    const cjs = Object.assign(new Error("Cannot find module 'playwright'"), {
      code: "MODULE_NOT_FOUND",
    });
    expect(isPlaywrightNotInstalled(esm)).toBe(true);
    expect(isPlaywrightNotInstalled(cjs)).toBe(true);
    expect(
      isPlaywrightNotInstalled(new Error("net::ERR_NAME_NOT_RESOLVED")),
    ).toBe(false);
  });
});

describe("installCommand and the hints that share its layout", () => {
  function localLayout(): { dir: string; cliRoot: string } {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-layout-"));
    temps.push(dir);
    const cliRoot = join(dir, "node_modules", "@real-a11y-dev", "cli");
    mkdirSync(cliRoot, { recursive: true });
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(
      join(cliRoot, "package.json"),
      '{"name":"@real-a11y-dev/cli"}',
    );
    return { dir, cliRoot };
  }

  it("reaches a project's own CLI with npx real-a11y", () => {
    const { dir, cliRoot } = localLayout();
    expect(cliLayout(dir, cliRoot)).toBe("local");
    expect(installCommand(dir, cliRoot)).toBe("npx real-a11y install");
  });

  it("names the plain binary for a global install", () => {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-layout-"));
    temps.push(dir);
    const cliRoot = join(
      "/usr",
      "lib",
      "node_modules",
      "@real-a11y-dev",
      "cli",
    );
    expect(cliLayout(dir, cliRoot)).toBe("global");
    expect(installCommand(dir, cliRoot)).toBe("real-a11y install");
  });

  it("names the scoped package for a run from npm's npx cache", () => {
    // `npx real-a11y` there asks the registry for an unscoped package that is
    // not ours: an E404 today, and anyone's code once someone publishes it.
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-layout-"));
    temps.push(dir);
    for (const cliRoot of [
      join(
        "/home",
        "me",
        ".npm",
        "_npx",
        "3f2a",
        "node_modules",
        "@real-a11y-dev",
        "cli",
      ),
      "C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\3f2a\\node_modules\\@real-a11y-dev\\cli",
    ]) {
      expect(cliLayout(dir, cliRoot)).toBe("npx");
      expect(installCommand(dir, cliRoot)).toBe(
        "npx -y @real-a11y-dev/cli install",
      );
      // An npx run resolves only what was installed beside it, so a global
      // Playwright would not unblock it.
      expect(missingPlaywrightHint(dir, cliRoot)).toBe(
        "npm i -D @real-a11y-dev/cli playwright && npx real-a11y install",
      );
    }
  });
});

describe("the npx layout's commands", () => {
  it("pin the running CLI's version, so the same CLI does the installing", () => {
    // Unpinned, npx fetches whatever the dist-tag says today: a second CLI,
    // perhaps another version, installing Chrome with its own resolver.
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-npx-"));
    temps.push(dir);
    const cliRoot = join(
      dir,
      "_npx",
      "3f2a",
      "node_modules",
      "@real-a11y-dev",
      "cli",
    );
    mkdirSync(cliRoot, { recursive: true });
    writeFileSync(
      join(cliRoot, "package.json"),
      '{"name":"@real-a11y-dev/cli","version":"0.1.0-beta.10"}',
    );
    expect(installCommand(dir, cliRoot)).toBe(
      "npx -y @real-a11y-dev/cli@0.1.0-beta.10 install",
    );
    expect(missingPlaywrightHint(dir, cliRoot)).toBe(
      "npm i -D @real-a11y-dev/cli@0.1.0-beta.10 playwright && npx real-a11y install",
    );
  });
});
