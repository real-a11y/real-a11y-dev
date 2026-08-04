/** Shared target/flag plumbing for the browser-driving commands. */

import type { BrowserSession } from "@real-a11y-dev/browser";
import { pageIdOf, redactUrl } from "@real-a11y-dev/snapshot";

import { type FlagValues, parseOpenOptions } from "../args.js";
import { resolveConfig, type ConfigPage } from "../config.js";
import { CliError } from "../exit.js";
import { assertWritableTarget } from "../output.js";
import {
  noteCrossOrigin,
  openPage,
  proxyFromEnv,
  type SessionFlags,
} from "../session.js";
import { validateStorageStatePath } from "../storage-state.js";
import {
  assertAllowedUrl,
  assertFinalUrl,
  normalizeTarget,
} from "../url-gate.js";

export interface Target {
  /** Normalized absolute URL (paths become file: URLs). */
  url: string;
  /**
   * Display label. Settled once by {@link resolvePageList} so every command
   * shows the same page the same way.
   *
   * **No longer the fingerprint page component** — that is the page's id now,
   * derived from the redacted url (see `pageIdOf`). While the two were one
   * field, renaming a config entry silently changed every finding's identity
   * and un-suppressed its baseline. Only the fallback survives: a URL with no
   * route (a `data:` document) has no id to derive, and the label is what's
   * left.
   */
  name: string;
  /** True when this is a file: target the gate approved. */
  fileApproved: boolean;
}

/**
 * The page identity every command fingerprints and joins under.
 *
 * One function because the alternative was tried and drifted: `audit` and
 * `inspect` derived from the LANDED url (`opened.url`) while `snapshot` handed
 * `buildSnapshotPage` the REQUESTED one, so any redirect that changed the path
 * (`/` → `/en`) gave a single finding two different "stable" ids depending on
 * which command reported it — the exact divergence page identity exists to
 * close, reintroduced one call site over.
 *
 * **Requested, not landed.** The landed address is where the findings came from
 * and stays in `page.url` for that reason, but identity must not move when a
 * redirect is added or removed later — that is the same rename-sensitivity in
 * another costume. What the user declared is the stable thing.
 *
 * Mirrors `buildSnapshotPage`'s own fallback chain exactly (explicit id →
 * derived from the redacted url → display label), so the snapshot path, which
 * derives inside the package, lands on the same string.
 */
export function pageIdentityOf(target: Target, page?: ConfigPage): string {
  return page?.id ?? pageIdOf(redactUrl(target.url)) ?? target.name;
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
  } else {
    delete process.env.REAL_A11Y_MCP_ALLOW_FILE;
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
    // `id` is optional here for the same reason it exists in the config: two
    // pages that resolve to one identity are refused, and without a way to
    // express an id on THIS page source the refusal would name a remedy the
    // user cannot reach. A11Y_PAGES is the documented drop-in for the CI guide,
    // so "rewrite it as a config file" is not an acceptable answer.
    if (o.id !== undefined && (typeof o.id !== "string" || o.id.length === 0)) {
      throw new CliError(
        `A11Y_PAGES[${i}].id must be a non-empty string`,
        'omit "id" to derive the page identity from the url',
      );
    }
    return {
      ...(typeof o.id === "string" ? { id: o.id } : {}),
      name: o.name,
      url: o.url,
    };
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
  } else {
    delete process.env.REAL_A11Y_MCP_ALLOW_FILE;
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
  const explicitChromePath =
    typeof flags["chrome-path"] === "string" ? flags["chrome-path"] : undefined;
  const realA11yChromePath = process.env.REAL_A11Y_CHROME_PATH;
  const realA11yBrowsersDir = process.env.REAL_A11Y_BROWSERS_DIR;
  const base: SessionFlags = {
    headful: flags.headful === true,
    verbose: flags.verbose === true,
    proxy: proxyFromEnv(),
    ...(typeof flags.cdp === "string" ? { cdp: flags.cdp } : {}),
    ...(explicitChromePath ? { chromePath: explicitChromePath } : {}),
    ...(realA11yChromePath ? { realA11yChromePath } : {}),
    ...(realA11yBrowsersDir ? { realA11yBrowsersDir } : {}),
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
 * Open `target.url` only when the session is not already on it with the same
 * emulation. Used by both the one-shot commands and the daemon's session-aware
 * runners so repeated invocations against the same session do not reload the
 * page, while a changed `--device` or `--viewport` still rebuilds the context.
 */
export async function ensurePageOpen(
  session: BrowserSession,
  target: Target,
  flags: FlagValues,
  allowedOrigins?: readonly string[],
): Promise<{ title: string; url: string }> {
  const current = session.currentUrl();
  const options = parseOpenOptions(flags);
  // Origin pinning is per-run, not per-session, so the reused session doesn't
  // inherit a wider allowlist from an earlier invocation. When the caller has
  // multiple targets (audit/snapshot), pass the invocation-wide allowlist so a
  // redirect to another explicit target is still allowed.
  options.allowedOrigins = allowedOrigins
    ? [...allowedOrigins]
    : sessionFlags(flags, [target]).allowedOrigins;
  const requestedKey = JSON.stringify({
    device: options.device ?? null,
    viewport: options.viewport ?? null,
  });
  // A CDP session never records an emulation key (emulation is rejected over
  // CDP), so an empty key means "nothing to compare", not a mismatch.
  const emulationKey = session.currentEmulationKey();
  if (
    current &&
    sameUrl(current, target.url) &&
    (emulationKey === "" || emulationKey === requestedKey)
  ) {
    // Re-apply the per-run URL gate even when we skip a redundant navigation.
    assertFinalUrl(current, target.fileApproved);
    try {
      session.assertAllowedOrigin(current, options.allowedOrigins);
    } catch (err) {
      // `assertAllowedOrigin` throws a plain Error; map it like `openPage`
      // does so audit/snapshot record a per-page error entry instead of
      // aborting the whole multi-page run as an unexpected failure. The
      // per-run allowlist always contains the target's own origin today, so
      // this is unreachable — but the invariant is implicit, and a future
      // caller passing a narrower allowlist must not change the error shape.
      throw new CliError(
        err instanceof Error ? err.message : String(err),
        "the page redirected off the audited origin; pass --audit-origin <origin> if that's expected.",
      );
    }
    noteCrossOrigin(target.url, current, isAuthenticated(flags));
    return { title: "", url: current };
  }
  return openPage(
    session,
    target.url,
    options,
    target.fileApproved,
    isAuthenticated(flags),
  );
}
