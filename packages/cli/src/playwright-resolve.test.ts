import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
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
