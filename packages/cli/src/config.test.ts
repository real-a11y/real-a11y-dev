import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";
import { CliError } from "./exit.js";

function writeConfig(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "real-a11y-cfg-"));
  const file = join(dir, "a11y.config.json");
  writeFileSync(
    file,
    typeof content === "string" ? content : JSON.stringify(content),
  );
  return file;
}

describe("loadConfig", () => {
  it("loads a valid config and records its directory", () => {
    const file = writeConfig({
      pages: [{ name: "Home", url: "http://localhost:3000" }],
      rules: ["image-alt"],
      failOn: "error",
    });
    const config = loadConfig(file);
    expect(config.pages).toEqual([
      { name: "Home", url: "http://localhost:3000" },
    ]);
    expect(config.rules).toEqual(["image-alt"]);
    expect(config.failOn).toBe("error");
    expect(config.dir).toBe(file.replace(/[/\\]a11y\.config\.json$/, ""));
  });

  it("fails closed on an unknown top-level key (a typo must not un-gate)", () => {
    const file = writeConfig({
      pages: [{ name: "H", url: "http://x" }],
      failon: "error", // typo
    });
    try {
      loadConfig(file);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toMatch(/unknown key "failon"/);
    }
  });

  it("rejects unknown keys inside a page", () => {
    const file = writeConfig({
      pages: [{ name: "H", url: "http://x", waitUntil: "load" }],
    });
    expect(() => loadConfig(file)).toThrow(
      /unknown key "waitUntil" in pages\[0\]/,
    );
  });

  it("requires a non-empty pages array", () => {
    expect(() => loadConfig(writeConfig({ pages: [] }))).toThrow(
      /non-empty "pages"/,
    );
    expect(() => loadConfig(writeConfig({ rules: [] }))).toThrow(/"pages"/);
  });

  it("validates rules, failOn, and page field types", () => {
    expect(() =>
      loadConfig(
        writeConfig({
          pages: [{ name: "H", url: "http://x" }],
          rules: ["nope"],
        }),
      ),
    ).toThrow(/unknown rule/);
    expect(() =>
      loadConfig(
        writeConfig({
          pages: [{ name: "H", url: "http://x" }],
          failOn: "sometimes",
        }),
      ),
    ).toThrow(/"failOn" must be/);
    expect(() =>
      loadConfig(writeConfig({ pages: [{ name: 5, url: "http://x" }] })),
    ).toThrow(/pages\[0\]\.name must be a string/);
  });

  it("compile-checks redact patterns", () => {
    expect(() =>
      loadConfig(
        writeConfig({ pages: [{ name: "H", url: "http://x" }], redact: ["("] }),
      ),
    ).toThrow(/invalid regex/);
  });

  it("rejects non-JSON and non-object configs", () => {
    expect(() => loadConfig(writeConfig("not json"))).toThrow(/not valid JSON/);
    expect(() => loadConfig(writeConfig([1, 2]))).toThrow(
      /must be a JSON object/,
    );
  });

  it("errors clearly on a missing file", () => {
    expect(() => loadConfig(join(tmpdir(), "nope-config-12345.json"))).toThrow(
      /not found or unreadable/,
    );
  });
});
