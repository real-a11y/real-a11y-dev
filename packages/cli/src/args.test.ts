import { describe, expect, it } from "vitest";

import {
  parseFailOn,
  parseFormat,
  parseListCategory,
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

describe("parseOpenOptions", () => {
  it("parses viewport WxH", () => {
    expect(parseOpenOptions({ viewport: "1280x800" }).viewport).toEqual({
      width: 1280,
      height: 800,
    });
    expect(() => parseOpenOptions({ viewport: "big" })).toThrow(
      /WIDTHxHEIGHT/,
    );
  });

  it("validates wait states", () => {
    expect(parseOpenOptions({ "wait-until": "networkidle" }).waitUntil).toBe(
      "networkidle",
    );
    expect(() => parseOpenOptions({ "wait-until": "ready" })).toThrow(
      CliError,
    );
  });

  it("clamps settle and timeout to their caps", () => {
    expect(parseOpenOptions({ settle: "99999999" }).settleMs).toBe(30_000);
    expect(parseOpenOptions({ timeout: "999999" }).timeoutMs).toBe(120_000);
    expect(() => parseOpenOptions({ timeout: "-4" })).toThrow(CliError);
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
