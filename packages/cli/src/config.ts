/**
 * `a11y.config.json` — "your policy lives in your repo". Strict JSON (no JS
 * config, no eval), hand-validated and **fail-closed**: an unknown or typo'd
 * key is a hard error, because a silently-ignored `"failon"` must never
 * un-gate CI. The file is repo-controlled, so it's low-trust — hence the size
 * / page caps and the redact-pattern compile check.
 *
 * The `defaults` block seeds flag values for EVERY command (the Jest/ESLint
 * model): each key mirrors a flag, and `resolveConfig` + `mergeDefaults` turn
 * a default into a "virtual flag" so the command's own parser validates the
 * value — precedence is `flag > env > defaults > built-in`. Load-time checks
 * here are structural (allowlist + coarse type, plus the cheap rule/failOn
 * enums); the finer value validation happens when the virtual flag hits its
 * parser at command time.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ALL_RULES, type A11yRule } from "@real-a11y-dev/testing";

import { CliError, type FailOn } from "./exit.js";

export interface ConfigPage {
  name: string;
  url: string;
  rootSelector?: string;
  /** Repo-relative path for SARIF file anchoring (phase 2 reporters). */
  sourcePath?: string;
}

/** Project-wide flag defaults. Each key mirrors a CLI flag; see KEY_TO_FLAG. */
export interface A11yDefaults {
  root?: string;
  device?: string;
  viewport?: string;
  waitUntil?: string;
  settleMs?: number;
  timeoutMs?: number;
  headful?: boolean;
  storageState?: string;
  auditOrigins?: string[];
  format?: string;
  rules?: A11yRule[];
  failOn?: FailOn;
  annotate?: boolean;
  includeGeneric?: boolean;
  baseline?: string;
  ignoreViewLine?: string[];
  maxLines?: number;
  maxPages?: number;
  explain?: boolean;
}

export interface A11yConfig {
  pages: ConfigPage[];
  /** Always present (possibly empty). Top-level rules/failOn/device fold in. */
  defaults: A11yDefaults;
  redact?: string[];
  /** Directory the config lives in — relative page/path defaults resolve here. */
  dir: string;
}

const MAX_BYTES = 1_000_000;
const MAX_PAGES = 100;
// Top-level: `pages` + `defaults` + `redact`, plus rules/failOn/device kept as
// back-compat shorthand that folds into `defaults`.
const TOP_KEYS = new Set([
  "pages",
  "defaults",
  "redact",
  "rules",
  "failOn",
  "device",
]);
const PAGE_KEYS = new Set(["name", "url", "rootSelector", "sourcePath"]);
const RULE_SET: ReadonlySet<string> = new Set(ALL_RULES);

// Coarse types validated at load; "rules"/"failOn" get the extra enum check.
const DEFAULT_TYPES = {
  root: "string",
  device: "string",
  viewport: "string",
  waitUntil: "string",
  settleMs: "number",
  timeoutMs: "number",
  headful: "boolean",
  storageState: "string",
  auditOrigins: "string[]",
  format: "string",
  rules: "rules",
  failOn: "failOn",
  annotate: "boolean",
  includeGeneric: "boolean",
  baseline: "string",
  ignoreViewLine: "string[]",
  maxLines: "number",
  maxPages: "number",
  explain: "boolean",
} as const;
const DEFAULT_KEYS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_TYPES));

function rejectUnknown(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  where: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new CliError(
        `unknown key "${key}" in ${where}`,
        `valid keys: ${[...allowed].join(", ")}`,
      );
    }
  }
}

function asString(v: unknown, where: string): string {
  if (typeof v !== "string") throw new CliError(`${where} must be a string`);
  return v;
}

function asStringArray(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.some((e) => typeof e !== "string")) {
    throw new CliError(`${where} must be an array of strings`);
  }
  return v as string[];
}

function validateRules(v: unknown, where: string): A11yRule[] {
  if (!Array.isArray(v)) throw new CliError(`${where} must be an array`);
  for (const rule of v) {
    if (typeof rule !== "string" || !RULE_SET.has(rule)) {
      throw new CliError(
        `unknown rule ${JSON.stringify(rule)} in ${where}`,
        `valid rules: ${ALL_RULES.join(", ")}`,
      );
    }
  }
  return v as A11yRule[];
}

function validateFailOn(v: unknown, where: string): FailOn {
  if (v !== "error" && v !== "warning" && v !== "never") {
    throw new CliError(
      `${where} must be error, warning, or never — got ${JSON.stringify(v)}`,
    );
  }
  return v;
}

/** Structural validation of a `defaults` object (allowlist + coarse type). The
 * command parsers do the finer value validation via the virtual-flag merge. */
function validateDefaults(raw: unknown): A11yDefaults {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new CliError('"defaults" must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  rejectUnknown(obj, DEFAULT_KEYS, "defaults");
  const out: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(DEFAULT_TYPES)) {
    const v = obj[key];
    if (v === undefined) continue;
    const where = `defaults.${key}`;
    switch (kind) {
      case "string":
        out[key] = asString(v, where);
        break;
      case "boolean":
        if (typeof v !== "boolean") {
          throw new CliError(`${where} must be true or false`);
        }
        out[key] = v;
        break;
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v)) {
          throw new CliError(`${where} must be a number`);
        }
        out[key] = v;
        break;
      case "string[]":
        out[key] = asStringArray(v, where);
        break;
      case "rules":
        out[key] = validateRules(v, where);
        break;
      case "failOn":
        out[key] = validateFailOn(v, where);
        break;
    }
  }
  return out as A11yDefaults;
}

export function loadConfig(path: string): A11yConfig {
  const abs = resolve(path);
  let raw: string;
  try {
    if (statSync(abs).size > MAX_BYTES) {
      throw new CliError(`config is larger than 1 MB: ${abs}`);
    }
    raw = readFileSync(abs, "utf8");
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(`config file not found or unreadable: ${abs}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(`config is not valid JSON: ${abs}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliError(`config must be a JSON object: ${abs}`);
  }
  const c = parsed as Record<string, unknown>;
  rejectUnknown(c, TOP_KEYS, "a11y.config.json");

  if (!Array.isArray(c.pages) || c.pages.length === 0) {
    throw new CliError('config needs a non-empty "pages" array');
  }
  if (c.pages.length > MAX_PAGES) {
    throw new CliError(
      `config has ${c.pages.length} pages — the cap is ${MAX_PAGES}`,
    );
  }
  const pages: ConfigPage[] = c.pages.map((raw, i) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new CliError(`pages[${i}] must be an object`);
    }
    const p = raw as Record<string, unknown>;
    rejectUnknown(p, PAGE_KEYS, `pages[${i}]`);
    const page: ConfigPage = {
      name: asString(p.name, `pages[${i}].name`),
      url: asString(p.url, `pages[${i}].url`),
    };
    if (p.rootSelector !== undefined) {
      page.rootSelector = asString(p.rootSelector, `pages[${i}].rootSelector`);
    }
    if (p.sourcePath !== undefined) {
      page.sourcePath = asString(p.sourcePath, `pages[${i}].sourcePath`);
    }
    return page;
  });

  const defaults: A11yDefaults =
    c.defaults !== undefined ? validateDefaults(c.defaults) : {};

  // Back-compat: top-level rules/failOn/device are shorthand for defaults.*.
  // `defaults` wins if a key is set in both.
  if (c.rules !== undefined && defaults.rules === undefined) {
    defaults.rules = validateRules(c.rules, "rules");
  }
  if (c.failOn !== undefined && defaults.failOn === undefined) {
    defaults.failOn = validateFailOn(c.failOn, '"failOn"');
  }
  if (
    c.device !== undefined &&
    c.device !== null &&
    defaults.device === undefined
  ) {
    defaults.device = asString(c.device, '"device"');
  }

  const config: A11yConfig = { pages, defaults, dir: dirname(abs) };

  if (c.redact !== undefined) {
    if (!Array.isArray(c.redact)) {
      throw new CliError('"redact" must be an array of regex strings');
    }
    for (const pattern of c.redact) {
      if (typeof pattern !== "string") {
        throw new CliError('"redact" entries must be strings');
      }
      try {
        // Compile-check now so a bad pattern fails at load, not mid-run.
        new RegExp(pattern);
      } catch {
        throw new CliError(
          `invalid regex in "redact": ${JSON.stringify(pattern)}`,
        );
      }
    }
    config.redact = c.redact as string[];
  }

  return config;
}

// ── discovery + the virtual-flag merge ───────────────────────────────────────

type ConfigFlags = { config?: unknown; "no-config"?: unknown };

/** --config <file> wins; --no-config skips; else auto-discover in cwd (no
 * upward walk in v1 — you inherit only a config in the directory you run from). */
function discoverConfigPath(flags: ConfigFlags): string | undefined {
  if (typeof flags.config === "string") return flags.config;
  if (flags["no-config"] === true) return undefined;
  return existsSync("a11y.config.json") ? "a11y.config.json" : undefined;
}

let configCache: { path: string; config: A11yConfig } | undefined;

/** Discover + load the config once, memoized by resolved path — so run.ts and
 * snapshot's resolvePages don't parse the file twice. Returns the config plus
 * its path (snapshot needs the path for SARIF anchoring). */
export function resolveConfig(
  flags: ConfigFlags,
): { config: A11yConfig; path: string } | undefined {
  const rel = discoverConfigPath(flags);
  if (!rel) return undefined;
  const abs = resolve(rel);
  if (configCache?.path !== abs) {
    configCache = { path: abs, config: loadConfig(rel) };
  }
  return { config: configCache.config, path: abs };
}

/** Test-only: drop the memoized config (each test uses a fresh temp file). */
export function clearConfigCache(): void {
  configCache = undefined;
}

// Config key → the parseArgs flag name (kebab). Identity for the rest.
const KEY_TO_FLAG: Record<string, string> = {
  waitUntil: "wait-until",
  settleMs: "settle",
  timeoutMs: "timeout",
  storageState: "storage-state",
  auditOrigins: "audit-origin",
  failOn: "fail-on",
  includeGeneric: "include-generic",
  ignoreViewLine: "ignore-view-line",
  maxLines: "max-lines",
  maxPages: "max-pages",
  annotate: "no-annotate",
};
/** The set of parseArgs flag names a config default can populate — every
 * DEFAULT_KEYS entry mapped through KEY_TO_FLAG. Exported for the lockstep test
 * that asserts each is a real flag. */
export const DEFAULTABLE_FLAGS: readonly string[] = [...DEFAULT_KEYS].map(
  (k) => KEY_TO_FLAG[k] ?? k,
);

// Path-valued defaults resolve relative to the config file's dir, so a
// committed config is portable regardless of the cwd a command runs from.
const PATH_KEYS = new Set(["storageState", "baseline"]);

/**
 * Merge a config's `defaults` into the parsed flags as "virtual flags": for
 * each default whose flag is unset, inject the value in the flag's raw shape so
 * the command's own parser validates it. Mutates `values`. `flag > default`
 * falls out of the unset check.
 */
export function mergeDefaults(
  values: Record<string, unknown>,
  config: A11yConfig,
): void {
  const d = config.defaults as Record<string, unknown>;
  for (const key of Object.keys(d)) {
    const val = d[key];
    if (val === undefined) continue;
    // `annotate` is the positive form of the negated flag `--no-annotate`.
    if (key === "annotate") {
      if (val === false && values["no-annotate"] === undefined) {
        values["no-annotate"] = true;
      }
      continue;
    }
    const flag = KEY_TO_FLAG[key] ?? key;
    if (values[flag] !== undefined) continue; // an explicit flag wins
    if (key === "rules") values[flag] = (val as string[]).join(",");
    else if (Array.isArray(val)) values[flag] = val as string[];
    else if (typeof val === "number") values[flag] = String(val);
    else if (PATH_KEYS.has(key) && typeof val === "string") {
      values[flag] = resolve(config.dir, val);
    } else values[flag] = val as string | boolean;
  }
}
