import { describe, expect, it } from "vitest";

import {
  parseFailOn,
  parseFormat,
  parseListCategory,
  parseOnly,
  parseOpenOptions,
  parseRules,
} from "./args.js";
import { CliError } from "./exit.js";

describe("parseRules", () => {
  it("accepts a valid csv subset", () => {
    expect(parseRules("image-alt, heading-order")).toEqual([
      "image-alt",
      "heading-order",
    ]);
  });

  it("returns undefined (= all rules) when omitted", () => {
    expect(parseRules(undefined)).toBeUndefined();
  });

  it("lists every valid rule on an unknown one", () => {
    expect(() => parseRules("imgalt")).toThrow(/no-unlabeled-interactive/);
  });
});

describe("parseFailOn / parseFormat", () => {
  it("applies per-command defaults", () => {
    expect(parseFailOn(undefined, "error")).toBe("error");
    expect(parseFailOn("never", "error")).toBe("never");
    expect(() => parseFailOn("any", "error")).toThrow(CliError);
  });

  it("validates formats against the shipped list", () => {
    expect(parseFormat(undefined, ["pretty", "json"])).toBe("pretty");
    expect(() => parseFormat("sarif", ["pretty", "json"])).toThrow(
      /pretty \| json/,
    );
  });
});

describe("parseOnly", () => {
  it("returns undefined (= full report) when omitted", () => {
    expect(parseOnly(undefined)).toBeUndefined();
  });

  it("accepts the two axes", () => {
    expect(parseOnly("findings")).toBe("findings");
    expect(parseOnly("views")).toBe("views");
  });

  it("rejects anything else, naming the valid values", () => {
    expect(() => parseOnly("a11y-trees")).toThrow(CliError);
    expect(() => parseOnly("a11y-trees")).toThrow(/findings \| views/);
    // A bare `--only` (boolean true from parseArgs) is not a valid axis.
    expect(() => parseOnly(true)).toThrow(CliError);
  });
});

describe("parseOpenOptions", () => {
  it("parses viewport WxH", () => {
    expect(parseOpenOptions({ viewport: "1280x800" }).viewport).toEqual({
      width: 1280,
      height: 800,
    });
    expect(() => parseOpenOptions({ viewport: "big" })).toThrow(/WIDTHxHEIGHT/);
  });

  it("validates wait states", () => {
    expect(parseOpenOptions({ "wait-until": "networkidle" }).waitUntil).toBe(
      "networkidle",
    );
    expect(() => parseOpenOptions({ "wait-until": "ready" })).toThrow(CliError);
  });

  it("clamps settle and timeout to their caps", () => {
    expect(parseOpenOptions({ settle: "99999999" }).settleMs).toBe(30_000);
    expect(parseOpenOptions({ timeout: "999999" }).timeoutMs).toBe(120_000);
    expect(() => parseOpenOptions({ timeout: "-4" })).toThrow(CliError);
  });

  it("rejects empty and zero timeouts — 0 means wait-forever in Playwright", () => {
    expect(() => parseOpenOptions({ timeout: "" })).toThrow(CliError);
    expect(() => parseOpenOptions({ timeout: "  " })).toThrow(CliError);
    expect(() => parseOpenOptions({ timeout: "0" })).toThrow(CliError);
    expect(parseOpenOptions({ settle: "0" }).settleMs).toBe(0);
  });

  it("rejects emulation flags over --cdp", () => {
    expect(() =>
      parseOpenOptions({ cdp: "http://localhost:9222", device: "iPhone 13" }),
    ).toThrow(/--cdp/);
  });
});

describe("parseListCategory", () => {
  it("accepts the six categories, rejects the rest", () => {
    expect(parseListCategory("landmark")).toBe("landmark");
    expect(() => parseListCategory("widgets")).toThrow(/heading, link/);
    expect(() => parseListCategory(undefined)).toThrow(CliError);
  });
});
