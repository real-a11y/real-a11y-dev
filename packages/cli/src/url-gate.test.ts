import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CliError } from "./exit.js";
import {
  assertAllowedUrl,
  assertFinalUrl,
  normalizeTarget,
} from "./url-gate.js";

describe("normalizeTarget", () => {
  it("passes real URLs through", () => {
    expect(normalizeTarget("https://example.com/x")).toBe(
      "https://example.com/x",
    );
    expect(normalizeTarget("data:text/html,hi")).toBe("data:text/html,hi");
  });

  it("turns an existing local path into a file: URL", () => {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-"));
    const file = join(dir, "index.html");
    writeFileSync(file, "<main></main>");
    const url = normalizeTarget(file);
    expect(url.startsWith("file:///")).toBe(true);
    expect(url.endsWith("index.html")).toBe(true);
  });

  it("suggests https:// for bare domains", () => {
    try {
      normalizeTarget("example.com");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).hint).toContain("https://example.com");
    }
  });

  it("suggests https:// for host:port shorthand — localhost:3000 must never read as a scheme", () => {
    for (const input of [
      "localhost:3000",
      "example.com:8080/x",
      "127.0.0.1:8080",
    ]) {
      try {
        normalizeTarget(input);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).hint).toContain(`https://${input}`);
      }
    }
  });

  it("passes real foreign schemes through so the gate can name them", () => {
    expect(normalizeTarget("ftp://host/x")).toBe("ftp://host/x");
  });

  it("errors on missing files", () => {
    expect(() => normalizeTarget("./no/such/file.html")).toThrow(CliError);
  });
});

describe("assertAllowedUrl", () => {
  it("allows web schemes from any source", () => {
    expect(
      assertAllowedUrl("https://x", { source: "config", allowFile: false }),
    ).toBe(false);
  });

  it("allows arg-authored file: without a flag — the human is the authority", () => {
    expect(
      assertAllowedUrl("file:///tmp/x.html", {
        source: "arg",
        allowFile: false,
      }),
    ).toBe(true);
  });

  it("blocks config-supplied file: unless --allow-file", () => {
    expect(() =>
      assertAllowedUrl("file:///x", { source: "config", allowFile: false }),
    ).toThrow(CliError);
    expect(
      assertAllowedUrl("file:///x", { source: "config", allowFile: true }),
    ).toBe(true);
  });

  it("refuses other schemes", () => {
    expect(() =>
      assertAllowedUrl("chrome://settings", { source: "arg", allowFile: true }),
    ).toThrow(/refusing to open/);
  });
});

describe("assertFinalUrl", () => {
  it("accepts web landings and approved file landings only", () => {
    expect(() =>
      assertFinalUrl("https://x/after-redirect", false),
    ).not.toThrow();
    expect(() => assertFinalUrl("file:///x", true)).not.toThrow();
    expect(() => assertFinalUrl("file:///etc/passwd", false)).toThrow(
      /landed on/,
    );
  });
});
