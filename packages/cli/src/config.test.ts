import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { COMMANDS } from "./args.js";
import {
  clearConfigCache,
  CONFIG_FILENAME,
  configSource,
  DEFAULTABLE_FLAGS,
  describeConfigSource,
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
      urls: [{ name: "Home", url: "http://localhost:3000" }],
      rules: ["image-alt"],
      failOn: "error",
    });
    const config = loadConfig(file);
    expect(config.urls).toEqual([
      { name: "Home", url: "http://localhost:3000" },
    ]);
    // Top-level rules/failOn/device are back-compat shorthand — they fold into
    // `defaults`, the single home the merge layer reads.
    expect(config.defaults.rules).toEqual(["image-alt"]);
    expect(config.defaults.failOn).toBe("error");
    expect(config.dir).toBe(file.replace(/[/\\]a11y\.config\.json$/, ""));
  });

  it("accepts bare-string urls and an object; name defaults to the url", () => {
    const { urls } = loadConfig(
      writeConfig({
        urls: ["http://localhost:3000/", { url: "http://x/about" }],
      }),
    );
    expect(urls).toEqual([
      { name: "http://localhost:3000/", url: "http://localhost:3000/" },
      { name: "http://x/about", url: "http://x/about" },
    ]);
  });

  it("is valid with no url list (a defaults-only config)", () => {
    const { urls, defaults } = loadConfig(
      writeConfig({ defaults: { device: "iPhone 13" } }),
    );
    expect(urls).toEqual([]);
    expect(defaults.device).toBe("iPhone 13");
  });

  it("accepts `pages` as a legacy alias for `urls`", () => {
    const { urls } = loadConfig(
      writeConfig({ pages: [{ name: "H", url: "http://x" }] }),
    );
    expect(urls).toEqual([{ name: "H", url: "http://x" }]);
  });

  it("fails closed on an unknown top-level key (a typo must not un-gate)", () => {
    const file = writeConfig({
      urls: [{ name: "H", url: "http://x" }],
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

  it("rejects unknown keys inside a url entry", () => {
    const file = writeConfig({
      urls: [{ name: "H", url: "http://x", waitUntil: "load" }],
    });
    expect(() => loadConfig(file)).toThrow(
      /unknown key "waitUntil" in urls\[0\]/,
    );
  });

  it("rejects an explicitly empty url list (each name kept in the error)", () => {
    expect(() => loadConfig(writeConfig({ urls: [] }))).toThrow(
      /"urls" must be a non-empty/,
    );
    expect(() => loadConfig(writeConfig({ pages: [] }))).toThrow(
      /"pages" must be a non-empty/,
    );
  });

  it("validates rules, failOn, and url field types", () => {
    expect(() =>
      loadConfig(
        writeConfig({
          urls: [{ name: "H", url: "http://x" }],
          rules: ["nope"],
        }),
      ),
    ).toThrow(/unknown rule/);
    expect(() =>
      loadConfig(
        writeConfig({
          urls: [{ name: "H", url: "http://x" }],
          failOn: "sometimes",
        }),
      ),
    ).toThrow(/"failOn" must be/);
    expect(() =>
      loadConfig(writeConfig({ urls: [{ name: 5, url: "http://x" }] })),
    ).toThrow(/urls\[0\]\.name must be a string/);
    expect(() => loadConfig(writeConfig({ urls: [{ name: "H" }] }))).toThrow(
      /urls\[0\]\.url must be a string/,
    );
  });

  it("compile-checks redact patterns", () => {
    expect(() =>
      loadConfig(
        writeConfig({ urls: [{ name: "H", url: "http://x" }], redact: ["("] }),
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
  it("loads an allowlisted defaults block (no url list required)", () => {
    const { defaults } = loadConfig(
      writeConfig({
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
      loadConfig(writeConfig({ defaults: { devise: "x" } })),
    ).toThrow(/unknown key "devise" in defaults/);
    expect(() =>
      loadConfig(writeConfig({ defaults: { headful: "yes" } })),
    ).toThrow(/defaults.headful must be true or false/);
    expect(() =>
      loadConfig(writeConfig({ defaults: { rules: ["nope"] } })),
    ).toThrow(/unknown rule/);
    expect(() =>
      loadConfig(writeConfig({ defaults: { failOn: "sometimes" } })),
    ).toThrow(/defaults.failOn must be/);
  });

  it("top-level rules/failOn/device fold into defaults; defaults wins", () => {
    // both set → defaults wins
    const { defaults } = loadConfig(
      writeConfig({ failOn: "error", defaults: { failOn: "never" } }),
    );
    expect(defaults.failOn).toBe("never");
  });
});

describe("mergeDefaults (virtual flags)", () => {
  const config = (
    defaults: A11yConfig["defaults"],
    dir = "/repo",
  ): A11yConfig => ({
    urls: PAGES,
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
    const file = writeConfig({ urls: PAGES, defaults: { device: "X" } });
    const a = resolveConfig({ config: file });
    const b = resolveConfig({ config: file });
    expect(a?.config).toBe(b?.config); // same instance — memoized, one parse
    expect(a?.path).toBe(resolve(file));
    expect(resolveConfig({ "no-config": true })).toBeUndefined();
  });
});

describe("configSource", () => {
  it("reports --config as the source, unresolved", () => {
    // The path stays as given; `describeConfigSource` is what absolutises it,
    // so the two concerns don't have to agree about cwd.
    expect(configSource({ config: "./custom.json" })).toEqual({
      kind: "flag",
      path: "./custom.json",
    });
  });

  it("reports --no-config as skipped, and --config wins over it", () => {
    expect(configSource({ "no-config": true })).toEqual({ kind: "skipped" });
    expect(configSource({ config: "x.json", "no-config": true }).kind).toBe(
      "flag",
    );
  });

  it("distinguishes discovered from absent, and names the path it checked", () => {
    const cwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-src-"));
    try {
      process.chdir(dir);
      const absent = configSource({});
      expect(absent.kind).toBe("absent");
      // The absolute path is the whole point — it is what tells a user their
      // config is real but somewhere else.
      expect(absent).toMatchObject({ searched: resolve(CONFIG_FILENAME) });

      writeFileSync(join(dir, CONFIG_FILENAME), "{}");
      expect(configSource({})).toEqual({
        kind: "discovered",
        path: CONFIG_FILENAME,
      });
    } finally {
      process.chdir(cwd);
    }
  });

  it("does not walk upward — a config in the parent is still absent", () => {
    // The documented v1 limitation, pinned. If an upward walk is ever added,
    // this test is the place that says the behaviour changed on purpose.
    const cwd = process.cwd();
    const parent = mkdtempSync(join(tmpdir(), "real-a11y-up-"));
    const child = join(parent, "nested");
    mkdirSync(child);
    writeFileSync(join(parent, CONFIG_FILENAME), "{}");
    try {
      process.chdir(child);
      expect(configSource({}).kind).toBe("absent");
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("describeConfigSource", () => {
  it("absolutises every path it prints", () => {
    // A relative path is exactly as useless as printing nothing here: the user
    // already believes they have "a11y.config.json".
    const flag = describeConfigSource({ kind: "flag", path: "./custom.json" });
    expect(flag).toContain(resolve("./custom.json"));
    expect(flag).toContain("--config");

    const found = describeConfigSource({
      kind: "discovered",
      path: CONFIG_FILENAME,
    });
    expect(found).toContain(resolve(CONFIG_FILENAME));
    expect(found).toContain("auto-discovered");
  });

  it("names the built-in defaults when discovery was skipped", () => {
    expect(describeConfigSource({ kind: "skipped" })).toMatch(
      /--no-config.*built-in defaults/,
    );
  });

  it("the absent line carries the path, the rule, AND the way out", () => {
    // All three, because each answers a different question: where did you look,
    // why won't looking elsewhere help, and what do I do now. This is the line
    // the whole change exists for.
    const out = describeConfigSource({
      kind: "absent",
      searched: "/work/app/a11y.config.json",
    });
    expect(out).toContain("/work/app/a11y.config.json");
    expect(out).toMatch(/does not walk upward/);
    expect(out).toMatch(/--config <file>/);
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
