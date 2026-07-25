/** Shared target/flag plumbing for the browser-driving commands. */

import { redactUrl } from "@real-a11y-dev/snapshot";

import { parseProducer, type FlagValues, type Producer } from "../args.js";
import { resolveConfig, type ConfigPage } from "../config.js";
import { CliError } from "../exit.js";
import { assertWritableTarget } from "../output.js";
import type { SessionFlags } from "../session.js";
import { validateStorageStatePath } from "../storage-state.js";
import { assertAllowedUrl, normalizeTarget } from "../url-gate.js";

export interface Target {
  /** Normalized absolute URL (paths become file: URLs). */
  url: string;
  /**
   * Display identity, and the fingerprint page component. Settled once by
   * {@link resolvePageList}, so `audit` and `snapshot` always agree on it for
   * the same page — their fingerprints diverge otherwise (see
   * `buildSnapshotPage`). Never re-derive it here.
   */
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
 * Settle a page's display/fingerprint name once, at the single point both
 * `audit` and `snapshot` read their pages from.
 *
 * The name is the `v1` fingerprint's page component and `diff`'s join key, so
 * the two commands MUST derive it identically or the same route fingerprints
 * differently depending on which command produced the artifact. Normalizing
 * here — rather than in each command's target construction — makes that true
 * by construction.
 *
 * `redactUrl` is the right normalizer for both jobs: a real config `name` isn't
 * a URL, so it passes through with only control characters sanitized, while a
 * name that defaulted to the URL is canonicalized *and* stripped of userinfo
 * and secret-looking query params — which otherwise rode into artifacts and
 * baselines under `name`, beside a carefully redacted `url`.
 */
function withSettledName(page: ConfigPage): ConfigPage {
  return { ...page, name: redactUrl(page.name) };
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
      pages: positionals.map((url) => withSettledName({ name: url, url })),
      source: "arg",
    };
  }
  const env = process.env.A11Y_PAGES;
  if (env) {
    return { pages: parseEnvPages(env).map(withSettledName), source: "config" };
  }
  const resolved = resolveConfig(flags);
  if (resolved) {
    return {
      pages: resolved.config.urls.map(withSettledName),
      source: "config",
      configPath: resolved.path,
    };
  }
  return { pages: [], source: "config" };
}

/** `audit`'s targets: positional URLs, else the project's `urls` list (env or
 *  config) — so a bare `real-a11y audit` in a configured repo audits every
 *  route without re-typing a URL. Single-view commands stay positional-only.
 *
 *  The originating {@link ConfigPage} rides along on each target so `audit` can
 *  honor the per-URL `rootSelector` the config documents, exactly as `snapshot`
 *  does. */
export function resolveAuditTargets(
  positionals: readonly string[],
  flags: FlagValues,
): (Target & { page: ConfigPage })[] {
  const { pages, source } = resolvePageList(positionals, flags);
  if (pages.length === 0) {
    throw new CliError(
      "no URL given",
      "pass a URL (real-a11y audit <url>) or add `urls` to a11y.config.json",
    );
  }
  const targets = pages.map((page) => {
    const url = normalizeTarget(page.url);
    const fileApproved = assertAllowedUrl(url, {
      source,
      allowFile: flags["allow-file"] === true,
    });
    // `page.name` is already settled by `resolvePageList`, so this is the exact
    // value `snapshot` uses for the same entry.
    return { url, name: page.name, fileApproved, page };
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
 * Resolve the `--producer` for a command, enforcing what native can't do.
 *
 * Native (Chromium's own a11y tree over CDP) is whole-document, read-only, and
 * carries no tab order. So a command opts into native only when it needs
 * neither a tab sequence nor the page-bundle's `listByRole` (`supportsNative`),
 * and `--root` scoping is refused under native regardless. Commands that don't
 * support it still call this so `--producer native` fails loudly with guidance,
 * rather than being silently ignored.
 */
export function producerOf(
  flags: FlagValues,
  command: string,
  supportsNative: boolean,
): Producer {
  const producer = parseProducer(flags.producer);
  if (producer === "dom") return "dom";
  if (!supportsNative) {
    throw new CliError(
      `--producer native is not supported by \`${command}\` — a native tree has no tab order and can't be scoped.`,
      "native works with: audit, tree, outline. Use --producer dom (the default) here.",
    );
  }
  if (typeof flags.root === "string" && flags.root !== "body") {
    throw new CliError(
      "--producer native audits the whole document — it can't be combined with --root.",
      "drop --root, or use --producer dom to scope to a selector.",
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
