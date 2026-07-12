import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertValidStorageState, parseAllowedOrigins } from "./config.js";

function write(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "real-a11y-mcp-cfg-"));
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

describe("assertValidStorageState", () => {
  it("accepts a well-formed storage-state file", () => {
    const file = write(
      "auth.json",
      JSON.stringify({ cookies: [], origins: [] }),
    );
    expect(() => assertValidStorageState(file)).not.toThrow();
  });

  it("accepts a file with only cookies or only origins", () => {
    const file = write("c.json", JSON.stringify({ cookies: [{ name: "s" }] }));
    expect(() => assertValidStorageState(file)).not.toThrow();
  });

  it("refuses a missing file", () => {
    expect(() =>
      assertValidStorageState(join(tmpdir(), "nope-12345.json")),
    ).toThrow(/REAL_A11Y_MCP_STORAGE_STATE/);
  });

  it("refuses non-JSON and wrong-shape files without echoing contents", () => {
    const bad = write("bad.json", "SECRET_TOKEN_abc not json");
    try {
      assertValidStorageState(bad);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toMatch(/not valid JSON/);
      expect((err as Error).message).not.toContain("SECRET_TOKEN");
    }
    const wrong = write("wrong.json", JSON.stringify({ nope: true }));
    expect(() => assertValidStorageState(wrong)).toThrow(
      /not a Playwright storage-state file/,
    );
  });
});

describe("parseAllowedOrigins", () => {
  it("returns [] for undefined/empty", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("  ")).toEqual([]);
  });

  it("splits, trims, and normalizes to origins", () => {
    expect(
      parseAllowedOrigins(
        "https://app.example.com/dashboard , https://auth.example.com",
      ),
    ).toEqual(["https://app.example.com", "https://auth.example.com"]);
  });

  it("throws on an unparseable origin", () => {
    expect(() => parseAllowedOrigins("https://ok.com, not a url")).toThrow(
      /invalid origin/,
    );
  });
});
