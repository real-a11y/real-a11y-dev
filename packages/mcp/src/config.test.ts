import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertValidStorageState,
  envInt,
  parseAllowedOrigins,
} from "./config.js";

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

describe("envInt", () => {
  it("falls back when unset or set to nothing", () => {
    expect(envInt("X", undefined, 4)).toBe(4);
    expect(envInt("X", "", 4)).toBe(4);
  });

  it("parses digits, tolerating surrounding whitespace", () => {
    expect(envInt("X", "8", 4)).toBe(8);
    expect(envInt("X", " 8 ", 4)).toBe(8);
    expect(envInt("X", "0", 4)).toBe(0);
  });

  it("treats whitespace-only as unset rather than reading it as 0", () => {
    // The bug this guards: `Number(" ")` and `Number("\n")` are both 0, and 0
    // DISABLES the idle timeout. A stray space or a trailing newline (env
    // files, `VAR=$(cat …)`) must never silently turn the timeout off — it is
    // indistinguishable from `VAR=`, so it means "unset".
    expect(envInt("X", " ", 900_000)).toBe(900_000);
    expect(envInt("X", "\n", 900_000)).toBe(900_000);
  });

  it("refuses hex, fractions, signs and junk", () => {
    // "0x10" would be 16 and "2.5" would make a cap of 2.5 — a limit no
    // operator typed, printed back as "2.5 live sessions".
    for (const raw of ["0x10", "2.5", "-1", "1e3", "12abc", "abc"]) {
      expect(() => envInt("X", raw, 4)).toThrow(/non-negative integer/);
    }
  });

  it("names the variable and echoes what was set", () => {
    expect(() => envInt("REAL_A11Y_MCP_MAX_SESSIONS", "lots", 4)).toThrow(
      /REAL_A11Y_MCP_MAX_SESSIONS must be a non-negative integer, got "lots"/,
    );
  });
});
