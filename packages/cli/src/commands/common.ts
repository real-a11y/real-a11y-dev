/** Shared target/flag plumbing for the browser-driving commands. */

import type { BrowserSession } from "@real-a11y-dev/browser";
import { redactUrl } from "@real-a11y-dev/snapshot";

import { type FlagValues, parseOpenOptions } from "../args.js";
import { resolveConfig, type ConfigPage } from "../config.js";
import { CliError } from "../exit.js";
import { assertWritableTarget } from "../output.js";
import { openPage } from "../session.js";
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
    verbose: flags.verbose === true,
    ...(typeof flags.cdp === "string" ? { cdp: flags.cdp } : {}),
    ...(typeof flags["chrome-path"] === "string"
      ? { chromePath: flags["chrome-path"] }
      : {}),
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
 * Note, once, that a route's `rootSelector` can't scope this run.
 *
 * `audit` and `snapshot` read Chromium's whole-document tree, so a per-URL
 * `rootSelector` no longer narrows what they look at. Warn rather than fail:
 * the entry is still how a route is *identified* in a committed config, it is
 * honoured by `tabs`, and hard-erroring would red every CI that scopes a route
 * — mid-beta, over config that isn't wrong, for a change the user didn't make.
 */
export function warnUnscopable(
  command: string,
  pages: readonly { name: string; rootSelector?: string }[],
): void {
  const scoped = pages.filter((p) => p.rootSelector !== undefined);
  if (scoped.length === 0) return;
  const names = scoped.map((p) => p.name).join(", ");
  process.stderr.write(
    `real-a11y: warning: ${command} reads the whole document — the rootSelector on ` +
      `${scoped.length === 1 ? "" : `${scoped.length} entries: `}${names} no longer scopes it. ` +
      `Findings may now include elements from outside that subtree. ` +
      `('real-a11y tabs --root <selector>' still scopes.)\n`,
  );
}

export function outputOf(flags: FlagValues): string | undefined {
  const target = typeof flags.output === "string" ? flags.output : undefined;
  // Commands call this in their preamble — a typo'd path fails before the
  // browser launches, not after the whole audit ran.
  if (target !== undefined) assertWritableTarget(target);
  return target;
}

function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}

/**
 * Open `target.url` only when the session is not already on it.  Used by both
 * the one-shot commands and the daemon's session-aware runners so repeated
 * invocations against the same session do not reload the page.
 */
export async function ensurePageOpen(
  session: BrowserSession,
  target: Target,
  flags: FlagValues,
): Promise<{ title: string; url: string }> {
  const current = session.currentUrl();
  if (current && sameUrl(current, target.url)) {
    return { title: "", url: current };
  }
  return openPage(
    session,
    target.url,
    parseOpenOptions(flags),
    target.fileApproved,
    isAuthenticated(flags),
  );
}
