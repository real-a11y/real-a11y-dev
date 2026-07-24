/** Shared target/flag plumbing for the browser-driving commands. */

import { redactUrl } from "@real-a11y-dev/snapshot";

import { parseTree, type FlagValues, type TreeMode } from "../args.js";
import { resolveConfig, type ConfigPage } from "../config.js";
import { CliError } from "../exit.js";
import { assertWritableTarget } from "../output.js";
import type { SessionFlags } from "../session.js";
import { validateStorageStatePath } from "../storage-state.js";
import { assertAllowedUrl, normalizeTarget } from "../url-gate.js";

export interface Target {
  /** Normalized absolute URL (paths become file: URLs). */
  url: string;
  /** Display identity: the redacted URL. Also the fingerprint page component. */
  name: string;
  /** True when this is a file: target the gate approved. */
  fileApproved: boolean;
}

/**
 * Normalize + admit every positional target, fail-fast before any browser
 * launches. Approving a file: target unlocks the engine's internal env gate
 * for this process (index.ts wiped any inherited value at startup).
 */
export function resolveTargets(
  positionals: readonly string[],
  flags: FlagValues,
): Target[] {
  if (positionals.length === 0) {
    throw new CliError(
      "no URL given",
      "usage: real-a11y <command> <url> — see --help",
    );
  }
  const targets = positionals.map((input) => {
    const url = normalizeTarget(input);
    const fileApproved = assertAllowedUrl(url, {
      source: "arg",
      allowFile: flags["allow-file"] === true,
    });
    return { url, name: redactUrl(url), fileApproved };
  });
  if (targets.some((t) => t.fileApproved)) {
    process.env.REAL_A11Y_MCP_ALLOW_FILE = "1";
  }
  return targets;
}

export function singleTarget(
  positionals: readonly string[],
  flags: FlagValues,
  command: string,
): Target {
  if (positionals.length !== 1) {
    throw new CliError(
      `${command} takes exactly one URL (got ${positionals.length})`,
      `usage: real-a11y ${command} <url>`,
    );
  }
  return resolveTargets(positionals, flags)[0];
}

function parseEnvPages(env: string): ConfigPage[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(env);
  } catch {
    throw new CliError("A11Y_PAGES is not valid JSON (expected [{name,url}])");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new CliError("A11Y_PAGES must be a non-empty [{name,url}] array");
  }
  return parsed.map((p, i) => {
    const o = p as Record<string, unknown>;
    if (typeof o?.name !== "string" || typeof o?.url !== "string") {
      throw new CliError(`A11Y_PAGES[${i}] needs string "name" and "url"`);
    }
    return { name: o.name, url: o.url };
  });
}

/**
 * The audit list in precedence order: positional URLs → `A11Y_PAGES` env → the
 * config `urls`. `source` is the url-gate source ("arg" for positionals, the
 * stricter "config" for env/config). `configPath` (absolute) is set only on the
 * config path — `sarif` anchors to it. Empty `pages` = nothing was supplied.
 * Shared by `audit` and `snapshot` so both resolve targets identically.
 */
export function resolvePageList(
  positionals: readonly string[],
  flags: FlagValues,
): { pages: ConfigPage[]; source: "arg" | "config"; configPath?: string } {
  if (positionals.length > 0) {
    return {
      pages: positionals.map((url) => ({ name: url, url })),
      source: "arg",
    };
  }
  const env = process.env.A11Y_PAGES;
  if (env) return { pages: parseEnvPages(env), source: "config" };
  const resolved = resolveConfig(flags);
  if (resolved) {
    return {
      pages: resolved.config.urls,
      source: "config",
      configPath: resolved.path,
    };
  }
  return { pages: [], source: "config" };
}

/** `audit`'s targets: positional URLs, else the project's `urls` list (env or
 *  config) — so a bare `real-a11y audit` in a configured repo audits every
 *  route without re-typing a URL. Single-view commands stay positional-only. */
export function resolveAuditTargets(
  positionals: readonly string[],
  flags: FlagValues,
): Target[] {
  const { pages, source } = resolvePageList(positionals, flags);
  if (pages.length === 0) {
    throw new CliError(
      "no URL given",
      "pass a URL (real-a11y audit <url>) or add `urls` to a11y.config.json",
    );
  }
  const targets = pages.map((p) => {
    const url = normalizeTarget(p.url);
    const fileApproved = assertAllowedUrl(url, {
      source,
      allowFile: flags["allow-file"] === true,
    });
    return { url, name: redactUrl(url), fileApproved };
  });
  if (targets.some((t) => t.fileApproved)) {
    process.env.REAL_A11Y_MCP_ALLOW_FILE = "1";
  }
  return targets;
}

/** True when this run loads a saved session — commands thread it to openPage. */
export function isAuthenticated(flags: FlagValues): boolean {
  return typeof flags["storage-state"] === "string";
}

function auditOrigins(flags: FlagValues): string[] {
  const raw = flags["audit-origin"];
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? [raw]
      : [];
  return values.map((value) => {
    let origin: string;
    try {
      origin = new URL(value).origin;
    } catch {
      throw new CliError(
        `--audit-origin expects an origin like https://app.example.com — got "${value}"`,
      );
    }
    return origin;
  });
}

/**
 * Build the session config. When `--storage-state` is set the run is
 * authenticated, so we also compute the origin allowlist (the http(s) target
 * origins plus any `--audit-origin`) — origin pinning that stops a redirect
 * from routing extraction to an unintended, cookie-matching origin.
 */
export function sessionFlags(
  flags: FlagValues,
  targets: readonly Target[] = [],
): SessionFlags {
  const base: SessionFlags = {
    headful: flags.headful === true,
    ...(typeof flags.cdp === "string" ? { cdp: flags.cdp } : {}),
  };
  const stateFlag = flags["storage-state"];
  if (typeof stateFlag !== "string") return base;
  if (typeof flags.cdp === "string") {
    throw new CliError(
      "--storage-state can't be combined with --cdp.",
      "--cdp reuses your running Chrome's session — the storage state file is for fresh launches.",
    );
  }
  const storageState = validateStorageStatePath(stateFlag);
  const origins = new Set<string>(auditOrigins(flags));
  for (const target of targets) {
    try {
      const { protocol, origin } = new URL(target.url);
      if (protocol === "http:" || protocol === "https:") origins.add(origin);
    } catch {
      // file:/data: targets have no meaningful origin — nothing to pin.
    }
  }
  return { ...base, storageState, allowedOrigins: [...origins] };
}

export function rootOf(flags: FlagValues): string {
  return typeof flags.root === "string" ? flags.root : "body";
}

/**
 * Resolve the `--tree` producer for a command, enforcing what native can't do.
 *
 * Native (Chromium's own a11y tree over CDP) is whole-document, read-only, and
 * carries no tab order. So a command opts into native only when it needs
 * neither a tab sequence nor the page-bundle's `listByRole` (`supportsNative`),
 * and `--root` scoping is refused under native regardless. Commands that don't
 * support it still call this so `--tree native` fails loudly with guidance,
 * rather than being silently ignored.
 */
export function treeModeOf(
  flags: FlagValues,
  command: string,
  supportsNative: boolean,
): TreeMode {
  const mode = parseTree(flags.tree);
  if (mode === "dom") return "dom";
  if (!supportsNative) {
    throw new CliError(
      `--tree native is not supported by \`${command}\` — a native tree has no tab order and can't be scoped.`,
      "native works with: audit, tree, outline. Use --tree dom (the default) here.",
    );
  }
  if (typeof flags.root === "string" && flags.root !== "body") {
    throw new CliError(
      "--tree native audits the whole document — it can't be combined with --root.",
      "drop --root, or use --tree dom to scope to a selector.",
    );
  }
  return "native";
}

export function outputOf(flags: FlagValues): string | undefined {
  const target = typeof flags.output === "string" ? flags.output : undefined;
  // Commands call this in their preamble — a typo'd path fails before the
  // browser launches, not after the whole audit ran.
  if (target !== undefined) assertWritableTarget(target);
  return target;
}
