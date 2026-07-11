/**
 * URL admission for CLI targets. The rule splits on who authored the string:
 * a positional shell argument (path or file: URL) is allowed without ceremony
 * — the human typing it is the authority and already has read access — while
 * config-supplied file: URLs (phase 2) require an explicit `--allow-file`,
 * because a PR can edit the config to point at `.git/config` and exfiltrate
 * it into a public comment.
 *
 * Not imported from mcp: `assertOpenableUrl` isn't in its export map, and the
 * arg-vs-config split is a genuinely different policy. `BrowserSession.open()`
 * still runs its own env-gated check internally, so after this gate approves a
 * file: target the command layer sets `REAL_A11Y_MCP_ALLOW_FILE=1` in-process
 * (index.ts deletes any ambient value at startup — an inherited shell var must
 * not widen the policy silently).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { CliError } from "./exit.js";

export type UrlSource = "arg" | "config";

const WEB_SCHEMES = new Set(["http", "https", "data"]);

function schemeOf(input: string): string | null {
  try {
    return new URL(input).protocol.replace(/:$/, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Bare-domain heuristic for the "did you mean https://…" hint. */
const DOMAINISH_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|$)/i;

const KNOWN_SCHEMES = new Set(["http", "https", "data", "file"]);

/**
 * host:port shorthand parses as a valid URL "scheme" (`localhost:3000` →
 * scheme "localhost", `example.com:8080` → scheme "example.com") — catch it
 * before trusting the parse, or the most common dev invocation dies with a
 * baffling "refusing to open a localhost: URL".
 */
const HOST_PORT_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*:\d+([/?#]|$)/i;

function suggestHttps(input: string): never {
  throw new CliError(
    `"${input}" is not a URL or an existing file.`,
    `did you mean https://${input} ?`,
  );
}

/**
 * Turn a CLI target into an absolute URL. Known-scheme URLs pass through;
 * everything else is treated as a local path or a typo'd URL. Single-letter
 * schemes are Windows drive paths (`new URL("C:\\site\\a.html")` parses as
 * scheme "c"), which must win over URL interpretation — the primary dev
 * machine is Windows.
 */
export function normalizeTarget(input: string): string {
  const scheme = schemeOf(input);
  if (scheme && KNOWN_SCHEMES.has(scheme)) return input;
  if (existsSync(input)) return pathToFileURL(resolve(input)).href;
  if (HOST_PORT_RE.test(input)) suggestHttps(input);
  // A real foreign scheme (ftp:, chrome:) — let the gate name it in its error.
  if (scheme && scheme.length > 1) return input;
  if (!scheme && DOMAINISH_RE.test(input)) suggestHttps(input);
  throw new CliError(`no such file: ${resolve(input)}`);
}

export interface GateOptions {
  source: UrlSource;
  /** `--allow-file`: unlocks config-supplied file: targets (phase 2). */
  allowFile?: boolean;
}

/**
 * Admit or reject a normalized URL. Returns true when the target is a file:
 * URL the caller approved — the command layer uses that to unlock the
 * engine's internal gate for exactly this run.
 */
export function assertAllowedUrl(url: string, options: GateOptions): boolean {
  const scheme = schemeOf(url);
  if (scheme && WEB_SCHEMES.has(scheme)) return false;
  if (scheme === "file") {
    if (options.source === "arg" || options.allowFile) return true;
    throw new CliError(
      "file:// targets from a config file are disabled by default.",
      "pass --allow-file, or serve the build: npx serve ./dist",
    );
  }
  throw new CliError(
    `refusing to open a ${scheme ?? "invalid"}: URL — only http(s), data:, and file: targets are supported.`,
  );
}

/**
 * Belt-and-braces after navigation: Chromium natively refuses web→file:
 * redirects, but re-assert the scheme of wherever we actually landed before
 * extracting anything from it.
 */
export function assertFinalUrl(finalUrl: string, fileApproved: boolean): void {
  const scheme = schemeOf(finalUrl);
  if (scheme && WEB_SCHEMES.has(scheme)) return;
  if (scheme === "file" && fileApproved) return;
  throw new CliError(
    `navigation landed on a ${scheme ?? "invalid"}: URL — refusing to extract from it.`,
  );
}
