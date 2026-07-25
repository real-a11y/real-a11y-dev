import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CliError } from "../exit.js";

import {
  isAuthenticated,
  sessionFlags,
  producerOf,
  resolveAuditTargets,
  resolvePageList,
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

describe("producerOf", () => {
  it("defaults to dom and passes dom through on any command", () => {
    expect(producerOf({}, "tabs", false)).toBe("dom");
    expect(producerOf({ producer: "dom" }, "audit", true)).toBe("dom");
  });

  it("returns native for a supporting command", () => {
    expect(producerOf({ producer: "native" }, "audit", true)).toBe("native");
    expect(producerOf({ producer: "native" }, "tree", true)).toBe("native");
  });

  it("rejects native on a command that can't support it", () => {
    expect(() => producerOf({ producer: "native" }, "tabs", false)).toThrow(
      /not supported by `tabs`/,
    );
    expect(() => producerOf({ producer: "native" }, "inspect", false)).toThrow(
      CliError,
    );
  });

  it("rejects native combined with a non-body --root", () => {
    expect(() =>
      producerOf({ producer: "native", root: "main" }, "tree", true),
    ).toThrow(/whole document/);
  });

  it("allows native with an explicit --root body (the implicit default)", () => {
    expect(producerOf({ producer: "native", root: "body" }, "tree", true)).toBe(
      "native",
    );
  });

  it("rejects an invalid --producer value regardless of support", () => {
    expect(() => producerOf({ producer: "webkit" }, "audit", true)).toThrow(
      /dom \| native/,
    );
  });
});

describe("resolveAuditTargets", () => {
  /** Write an a11y.config.json into a temp dir and return its path. */
  function configFile(config: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-cfg-"));
    const file = join(dir, "a11y.config.json");
    writeFileSync(file, JSON.stringify(config));
    return file;
  }

  it("carries the per-URL rootSelector through to the target", () => {
    // Regression: audit collapsed config pages to {url, name, fileApproved},
    // so `rootSelector` never reached snapshotPage and every page was audited
    // at `body` — contradicting the documented "rootSelector scopes the audit".
    const config = configFile({
      urls: [
        { name: "example", url: "https://example.com/" },
        {
          name: "iana-learn",
          url: "https://www.iana.org/domains/reserved",
          rootSelector: "main",
        },
      ],
    });
    const targets = resolveAuditTargets([], { config });
    expect(targets).toHaveLength(2);
    expect(targets[0].page.rootSelector).toBeUndefined();
    expect(targets[1].page.rootSelector).toBe("main");
  });

  it("keeps the config name so audit and snapshot fingerprint alike", () => {
    // The page name is part of the v1 fingerprint tuple. Overwriting it with
    // the redacted URL made audit's fingerprints unable to match snapshot's
    // (or the MCP's) for the very same config entry.
    const config = configFile({
      urls: [{ name: "example", url: "https://example.com/" }],
    });
    const targets = resolveAuditTargets([], { config });
    expect(targets[0].name).toBe("example");
    expect(targets[0].url).toBe("https://example.com/");
  });

  it("redacts a name that defaulted to the URL", () => {
    // A bare string entry defaults `name` to the URL, so the name still has to
    // go through redaction — otherwise userinfo and secret query params would
    // ride into the artifact and the baseline under `name`, right beside a
    // carefully redacted `url`.
    const config = configFile({
      urls: ["https://user:pw@example.com/?token=abc123"],
    });
    const targets = resolveAuditTargets([], { config });
    expect(targets[0].name).not.toContain("pw");
    expect(targets[0].name).not.toContain("abc123");
    // URLSearchParams percent-encodes the brackets on the way out.
    expect(targets[0].name).toContain("REDACTED");
  });

  it("settles the name identically for audit and snapshot", () => {
    // The name is the v1 fingerprint's page component and diff's join key, so
    // the two commands must derive it from the same value. `snapshot` builds
    // its targets straight off `resolvePageList`'s `page.name`, so comparing
    // that to audit's `target.name` is the real parity check.
    //
    // Regression: audit re-derived the name with `redactUrl` while snapshot
    // used it raw, so a bare entry like "http://localhost:3000" became
    // ".../" in audit and "..." in snapshot — divergent fingerprints for one
    // configured route.
    const config = configFile({
      urls: [
        "http://localhost:3000",
        { name: "dashboard", url: "http://localhost:3000/app" },
      ],
    });
    const { pages } = resolvePageList([], { config });
    const targets = resolveAuditTargets([], { config });
    expect(targets.map((t) => t.name)).toEqual(pages.map((p) => p.name));
    // …and the bare entry is canonicalized exactly once, on both sides.
    expect(pages[0].name).toBe("http://localhost:3000/");
    expect(pages[1].name).toBe("dashboard");
  });

  it("settles positional names too, so a secret can't reach an artifact", () => {
    const { pages } = resolvePageList(
      ["https://user:pw@example.com/?token=abc123"],
      {},
    );
    expect(pages[0].name).not.toContain("pw");
    expect(pages[0].name).not.toContain("abc123");
  });

  it("throws with guidance when nothing supplies a URL", () => {
    expect(() => resolveAuditTargets([], { "no-config": true })).toThrow(
      CliError,
    );
  });
});
