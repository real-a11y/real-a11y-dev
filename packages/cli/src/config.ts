/**
 * `a11y.config.json` — "your policy lives in your repo". Strict JSON (no JS
 * config, no eval), hand-validated and **fail-closed**: an unknown or typo'd
 * key is a hard error, because a silently-ignored `"failon"` must never
 * un-gate CI. The file is repo-controlled, so it's low-trust — hence the size
 * / page caps and the redact-pattern compile check.
 */

import { readFileSync, statSync } from "node:fs";
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

export interface A11yConfig {
  pages: ConfigPage[];
  rules?: A11yRule[];
  failOn?: FailOn;
  device?: string;
  redact?: string[];
  /** Directory the config lives in — relative page paths resolve against it. */
  dir: string;
}

const MAX_BYTES = 1_000_000;
const MAX_PAGES = 100;
const TOP_KEYS = new Set(["pages", "rules", "failOn", "device", "redact"]);
const PAGE_KEYS = new Set(["name", "url", "rootSelector", "sourcePath"]);
const RULE_SET: ReadonlySet<string> = new Set(ALL_RULES);

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

  const config: A11yConfig = { pages, dir: dirname(abs) };

  if (c.rules !== undefined) {
    if (!Array.isArray(c.rules)) throw new CliError('"rules" must be an array');
    for (const rule of c.rules) {
      if (typeof rule !== "string" || !RULE_SET.has(rule)) {
        throw new CliError(
          `unknown rule ${JSON.stringify(rule)} in config`,
          `valid rules: ${ALL_RULES.join(", ")}`,
        );
      }
    }
    config.rules = c.rules as A11yRule[];
  }

  if (c.failOn !== undefined) {
    if (
      c.failOn !== "error" &&
      c.failOn !== "warning" &&
      c.failOn !== "never"
    ) {
      throw new CliError(
        `"failOn" must be error, warning, or never — got ${JSON.stringify(c.failOn)}`,
      );
    }
    config.failOn = c.failOn;
  }

  if (c.device !== undefined && c.device !== null) {
    config.device = asString(c.device, '"device"');
  }

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
