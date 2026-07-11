import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CliError } from "./exit.js";
import { validateStorageStatePath } from "./storage-state.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "real-a11y-ss-"));
}

describe("validateStorageStatePath", () => {
  it("accepts a well-formed storage-state file and returns the abs path", () => {
    const dir = tmp();
    const file = join(dir, "auth.json");
    writeFileSync(file, JSON.stringify({ cookies: [], origins: [] }));
    expect(validateStorageStatePath(file)).toBe(file);
  });

  it("accepts a file with only cookies or only origins", () => {
    const dir = tmp();
    const f = join(dir, "c.json");
    writeFileSync(f, JSON.stringify({ cookies: [{ name: "s" }] }));
    expect(validateStorageStatePath(f)).toBe(f);
  });

  it("errors (with a login hint) when the file is missing", () => {
    try {
      validateStorageStatePath(join(tmp(), "nope.json"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("not found");
      expect((err as CliError).hint).toContain("real-a11y login");
    }
  });

  it("rejects non-JSON and wrong-shape files without echoing contents", () => {
    const dir = tmp();
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "SECRET_TOKEN_abc not json");
    try {
      validateStorageStatePath(bad);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("not a Playwright storage");
      expect((err as CliError).message).not.toContain("SECRET_TOKEN");
    }

    const wrong = join(dir, "wrong.json");
    writeFileSync(wrong, JSON.stringify({ nope: true }));
    expect(() => validateStorageStatePath(wrong)).toThrow(
      /not a Playwright storage/,
    );
  });
});
