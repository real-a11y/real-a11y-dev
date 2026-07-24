import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CliError } from "../exit.js";

import {
  isAuthenticated,
  sessionFlags,
  treeModeOf,
  type Target,
} from "./common.js";

function stateFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "real-a11y-cf-"));
  const file = join(dir, "auth.json");
  writeFileSync(file, JSON.stringify({ cookies: [], origins: [] }));
  return file;
}

const target = (url: string): Target => ({
  url,
  name: url,
  fileApproved: false,
});

describe("sessionFlags", () => {
  it("returns only base config with no --storage-state (no origin pinning)", () => {
    const cfg = sessionFlags({ headful: true }, [
      target("https://app.example.com/x"),
    ]);
    expect(cfg.storageState).toBeUndefined();
    expect(cfg.allowedOrigins).toBeUndefined();
  });

  it("pins the target origins when a session is loaded", () => {
    const file = stateFile();
    const cfg = sessionFlags({ "storage-state": file }, [
      target("https://app.example.com/dashboard"),
      target("https://app.example.com/settings"),
    ]);
    expect(cfg.storageState).toBe(file);
    expect(cfg.allowedOrigins).toEqual(["https://app.example.com"]);
  });

  it("extends the allowlist with --audit-origin (normalized to origin)", () => {
    const file = stateFile();
    const cfg = sessionFlags(
      {
        "storage-state": file,
        "audit-origin": ["https://auth.example.com/cb"],
      },
      [target("https://app.example.com/x")],
    );
    expect(new Set(cfg.allowedOrigins)).toEqual(
      new Set(["https://app.example.com", "https://auth.example.com"]),
    );
  });

  it("rejects --storage-state with --cdp", () => {
    const file = stateFile();
    expect(() =>
      sessionFlags({ "storage-state": file, cdp: "http://localhost:9222" }, []),
    ).toThrow(/can't be combined with --cdp/);
  });

  it("rejects a non-origin --audit-origin value", () => {
    const file = stateFile();
    expect(() =>
      sessionFlags({ "storage-state": file, "audit-origin": ["not a url"] }, [
        target("https://app.example.com"),
      ]),
    ).toThrow(CliError);
  });

  it("ignores file:/data: targets when computing the allowlist", () => {
    const file = stateFile();
    const cfg = sessionFlags({ "storage-state": file }, [
      target("file:///C:/site/index.html"),
    ]);
    expect(cfg.allowedOrigins).toEqual([]);
  });
});

describe("isAuthenticated", () => {
  it("is true exactly when --storage-state is present", () => {
    expect(isAuthenticated({ "storage-state": "auth.json" })).toBe(true);
    expect(isAuthenticated({})).toBe(false);
  });
});

describe("treeModeOf", () => {
  it("defaults to dom and passes dom through on any command", () => {
    expect(treeModeOf({}, "tabs", false)).toBe("dom");
    expect(treeModeOf({ tree: "dom" }, "audit", true)).toBe("dom");
  });

  it("returns native for a supporting command", () => {
    expect(treeModeOf({ tree: "native" }, "audit", true)).toBe("native");
    expect(treeModeOf({ tree: "native" }, "tree", true)).toBe("native");
  });

  it("rejects native on a command that can't support it", () => {
    expect(() => treeModeOf({ tree: "native" }, "tabs", false)).toThrow(
      /not supported by `tabs`/,
    );
    expect(() => treeModeOf({ tree: "native" }, "inspect", false)).toThrow(
      CliError,
    );
  });

  it("rejects native combined with a non-body --root", () => {
    expect(() =>
      treeModeOf({ tree: "native", root: "main" }, "tree", true),
    ).toThrow(/whole document/);
  });

  it("allows native with an explicit --root body (the implicit default)", () => {
    expect(treeModeOf({ tree: "native", root: "body" }, "tree", true)).toBe(
      "native",
    );
  });

  it("rejects an invalid --tree value regardless of support", () => {
    expect(() => treeModeOf({ tree: "webkit" }, "audit", true)).toThrow(
      /dom \| native/,
    );
  });
});
