import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../exit.js";

import { browserCommand, recordsDirFor } from "./show-report.js";

describe("recordsDirFor", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "real-a11y-show-report-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("defaults to the reporter's folder, which may not exist yet", () => {
    expect(recordsDirFor(undefined)).toBe(resolve("a11y-snapshots", "records"));
  });

  it("reads the records inside an output folder", () => {
    mkdirSync(join(root, "records"));
    expect(recordsDirFor(root)).toBe(join(root, "records"));
  });

  it("takes a folder of records itself", () => {
    expect(recordsDirFor(root)).toBe(root);
  });

  it("refuses a folder you named that isn't there", () => {
    expect(() => recordsDirFor(join(root, "typo"))).toThrow(/no such folder/);
  });

  it("refuses a file", () => {
    const file = join(root, "index.html");
    writeFileSync(file, "");
    expect(() => recordsDirFor(file)).toThrow(/not a folder/);
  });

  it("points a URL at the commands that take one", () => {
    let error: unknown;
    try {
      recordsDirFor("https://example.com");
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/not a URL/);
    expect((error as CliError).hint).toContain("real-a11y snapshot <url>");
  });
});

describe("browserCommand", () => {
  const url = "http://127.0.0.1:9324/";

  it("uses each platform's opener", () => {
    expect(browserCommand(url, "darwin")).toEqual(["open", [url]]);
    expect(browserCommand(url, "linux")).toEqual(["xdg-open", [url]]);
  });

  it("gives Windows' start an empty title, or it takes the URL for one", () => {
    expect(browserCommand(url, "win32")).toEqual([
      "cmd",
      ["/c", "start", "", url],
    ]);
  });
});
