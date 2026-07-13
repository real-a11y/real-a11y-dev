import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { COMMANDS } from "./args.js";
import {
  clearConfigCache,
  DEFAULTABLE_FLAGS,
  loadConfig,
  mergeDefaults,
  resolveConfig,
  type A11yConfig,
} from "./config.js";
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
    // Top-level rules/failOn/device are back-compat shorthand — they fold into
    // `defaults`, the single home the merge layer reads.
    expect(config.defaults.rules).toEqual(["image-alt"]);
    expect(config.defaults.failOn).toBe("error");
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

const PAGES = [{ name: "H", url: "http://x" }];

describe("config defaults", () => {
  it("loads an allowlisted defaults block", () => {
    const { defaults } = loadConfig(
      writeConfig({
        pages: PAGES,
        defaults: { device: "iPhone 13", failOn: "warning", maxLines: 20 },
      }),
    );
    expect(defaults).toEqual({
      device: "iPhone 13",
      failOn: "warning",
      maxLines: 20,
    });
  });

  it("fails closed on an unknown or mistyped defaults key", () => {
    expect(() =>
      loadConfig(writeConfig({ pages: PAGES, defaults: { devise: "x" } })),
    ).toThrow(/unknown key "devise" in defaults/);
    expect(() =>
      loadConfig(writeConfig({ pages: PAGES, defaults: { headful: "yes" } })),
    ).toThrow(/defaults.headful must be true or false/);
    expect(() =>
      loadConfig(writeConfig({ pages: PAGES, defaults: { rules: ["nope"] } })),
    ).toThrow(/unknown rule/);
    expect(() =>
      loadConfig(
        writeConfig({ pages: PAGES, defaults: { failOn: "sometimes" } }),
      ),
    ).toThrow(/defaults.failOn must be/);
  });

  it("top-level rules/failOn/device fold into defaults; defaults wins", () => {
    // both set → defaults wins
    const { defaults } = loadConfig(
      writeConfig({
        pages: PAGES,
        failOn: "error",
        defaults: { failOn: "never" },
      }),
    );
    expect(defaults.failOn).toBe("never");
  });
});

describe("mergeDefaults (virtual flags)", () => {
  const config = (
    defaults: A11yConfig["defaults"],
    dir = "/repo",
  ): A11yConfig => ({
    pages: PAGES,
    defaults,
    dir,
  });
  // A permissive declared set (every defaultable flag) for the tests that only
  // exercise shaping/precedence; the scoping tests below pass a real command's
  // narrower set on purpose.
  const ALL = new Set(DEFAULTABLE_FLAGS);

  it("seeds an unset flag but never overrides an explicit one", () => {
    const values: Record<string, unknown> = { device: "Pixel 7" }; // explicit
    mergeDefaults(
      values,
      config({ device: "iPhone 13", failOn: "warning" }),
      ALL,
    );
    expect(values.device).toBe("Pixel 7"); // flag wins
    expect(values["fail-on"]).toBe("warning"); // camel→kebab, filled in
  });

  it("shapes each value into the flag's raw form", () => {
    const values: Record<string, unknown> = {};
    mergeDefaults(
      values,
      config({
        settleMs: 500,
        rules: ["image-alt", "heading-order"],
        auditOrigins: ["https://a.com"],
        explain: true,
      }),
      ALL,
    );
    expect(values.settle).toBe("500"); // number → string (parseMs takes a string)
    expect(values.rules).toBe("image-alt,heading-order"); // array → CSV flag
    expect(values["audit-origin"]).toEqual(["https://a.com"]); // multiple → string[]
    expect(values.explain).toBe(true);
  });

  it("maps annotate:false to the negated --no-annotate flag", () => {
    const off: Record<string, unknown> = {};
    mergeDefaults(off, config({ annotate: false }), ALL);
    expect(off["no-annotate"]).toBe(true);
    const on: Record<string, unknown> = {};
    mergeDefaults(on, config({ annotate: true }), ALL);
    expect(on["no-annotate"]).toBeUndefined(); // the default — no negation
  });

  it("resolves path-valued defaults relative to the config dir", () => {
    const values: Record<string, unknown> = {};
    mergeDefaults(
      values,
      config({ baseline: ".a11y-baseline.json" }, "/repo/cfg"),
      ALL,
    );
    expect(values.baseline).toBe(resolve("/repo/cfg", ".a11y-baseline.json"));
  });

  it("skips a default the running command doesn't declare", () => {
    // `login` is interactive/desktop-only: its flag set omits emulation. A
    // config default must not reach a flag the command would reject.
    const loginFlags = new Set(Object.keys(COMMANDS.login.options));
    const values: Record<string, unknown> = {};
    mergeDefaults(
      values,
      config({ device: "iPhone 13", settleMs: 200 }),
      loginFlags,
    );
    expect(values.device).toBeUndefined(); // login has no --device → not seeded
    expect(values.settle).toBe("200"); // login declares --settle → seeded
  });

  it("won't let a default defeat a mutually-exclusive explicit flag", () => {
    // --cdp excludes emulation + --storage-state (their guards would hard-error).
    const cdp: Record<string, unknown> = { cdp: "http://127.0.0.1:9222" };
    mergeDefaults(
      cdp,
      config({
        device: "iPhone 13",
        storageState: "auth.json",
        waitUntil: "networkidle",
      }),
      ALL,
    );
    expect(cdp.device).toBeUndefined(); // suppressed by explicit --cdp
    expect(cdp["storage-state"]).toBeUndefined(); // suppressed by explicit --cdp
    expect(cdp["wait-until"]).toBe("networkidle"); // unrelated default still seeds

    // --md is the alias for --format md, so it excludes a config `format`.
    const md: Record<string, unknown> = { md: true };
    mergeDefaults(md, config({ format: "json" }), ALL);
    expect(md.format).toBeUndefined();
  });
});

describe("resolveConfig", () => {
  it("discovers via --config and memoizes by path; --no-config skips", () => {
    clearConfigCache();
    const file = writeConfig({ pages: PAGES, defaults: { device: "X" } });
    const a = resolveConfig({ config: file });
    const b = resolveConfig({ config: file });
    expect(a?.config).toBe(b?.config); // same instance — memoized, one parse
    expect(a?.path).toBe(resolve(file));
    expect(resolveConfig({ "no-config": true })).toBeUndefined();
  });
});

describe("DEFAULTABLE_FLAGS lockstep", () => {
  it("every defaultable flag is a real parseArgs flag on some command", () => {
    const declared = new Set<string>();
    for (const spec of Object.values(COMMANDS)) {
      for (const key of Object.keys(spec.options)) declared.add(key);
    }
    for (const flag of DEFAULTABLE_FLAGS) {
      expect(declared.has(flag), `${flag} is not a declared flag`).toBe(true);
    }
  });
});
