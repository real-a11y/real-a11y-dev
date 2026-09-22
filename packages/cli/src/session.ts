/**
 * Adapter between CLI flags and the shared engine's BrowserSession — imported
 * from `@real-a11y-dev/browser` (a standalone package that carries none of the
 * MCP SDK graph), and only ever dynamically, so browser-free invocations never
 * resolve playwright.
 *
 * Also owns the two friendliest errors in the tool: Playwright missing and
 * Chromium not downloaded. Driver setup is the #1 complaint class against
 * comparable CLIs — these messages are a feature.
 */

import type {
  BrowserSession,
  OpenOptions,
  SnapshotOptions,
} from "@real-a11y-dev/browser";

import {
  projectNativeTree,
  projectSnapshot,
  redactUrl,
  redactUrlsIn,
  sanitizeText,
  type CleanSnapshot,
  type NativeSnapshotOptions,
} from "@real-a11y-dev/snapshot";

import { registerCleanup } from "./cleanup.js";
import { CliError } from "./exit.js";
import {
  missingPlaywrightHint,
  readPlaywrightVersion,
} from "./playwright-resolve.js";
import { assertFinalUrl } from "./url-gate.js";

export interface ProxyConfig {
  server: string;
  bypass?: string;
  username?: string;
  password?: string;
}

export function proxyFromEnv(): ProxyConfig | undefined {
  const env = process.env;
  const raw =
    env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  if (!raw) return undefined;
  const bypass = env.NO_PROXY ?? env.no_proxy;
  // Corporate proxies embed credentials in the env URL, but Chromium only
  // authenticates via explicit username/password launch fields.
  try {
    const url = new URL(raw);
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    url.username = "";
    url.password = "";
    return {
      server: url.toString().replace(/\/$/, ""),
      ...(username ? { username, password } : {}),
      ...(bypass ? { bypass } : {}),
    };
  } catch {
    return { server: raw, ...(bypass ? { bypass } : {}) };
  }
}

export interface SessionFlags {
  headful?: boolean;
  cdp?: string;
  /** Validated absolute path to a storage-state file (see storage-state.ts). */
  storageState?: string;
  /** Origins allowed for extraction when a session is loaded (origin pinning). */
  allowedOrigins?: string[];
  /** `--chrome-path` — a specific browser binary to launch. Ignored with `cdp`. */
  chromePath?: string;
  /**
   * `REAL_A11Y_CHROME_PATH` as seen by the spawner, recorded for session
   * identity only. The actual launch still goes through `resolveChromeExecutable`
   * so the source label and error text remain accurate.
   */
  realA11yChromePath?: string;
  /**
   * `REAL_A11Y_BROWSERS_DIR` as seen by the spawner, recorded for session
   * identity only. The actual install-cache lookup still uses `process.env`
   * (set by the per-run env snapshot) so the resolution path is accurate.
   */
  realA11yBrowsersDir?: string;
  /** Resolved proxy to use for this browser launch. */
  proxy?: ProxyConfig;
  /** Note which Chrome binary was chosen, and why, on stderr. */
  verbose?: boolean;
  /**
   * Working directory the session was started from. Pinned to the first run so a
   * later caller cannot make a long-lived session auto-discover a config from an
   * arbitrary directory.
   */
  cwd?: string;
}

export async function createSession(
  flags: SessionFlags,
): Promise<BrowserSession> {
  // Same createRequire walk as `--version`. Do not preflight with
  // `import("playwright")` — ESM ignores NODE_PATH, which is the D2 lie.
  if (!readPlaywrightVersion()) {
    throw new CliError(
      "Playwright is required to drive a browser, but it isn't installed.",
      missingPlaywrightHint(flags.cwd ?? process.cwd()),
    );
  }
  const { BrowserSession, resolveChromeExecutable } =
    await import("@real-a11y-dev/browser");
  const proxy = flags.proxy ?? proxyFromEnv();
  // CDP mode reuses a running browser — there's no binary for us to choose.
  // Otherwise: --chrome-path (hard error if missing) > REAL_A11Y_CHROME_PATH
  // (hard error if missing) > the `real-a11y install` manifest (soft, if any)
  // > Playwright's own bundled Chromium.
  let chrome: ReturnType<typeof resolveChromeExecutable>;
  if (!flags.cdp) {
    try {
      chrome = resolveChromeExecutable({ explicitPath: flags.chromePath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CliError(
        message,
        "re-run: real-a11y install — or fix/unset --chrome-path / REAL_A11Y_CHROME_PATH.",
      );
    }
    if (chrome && flags.verbose) {
      process.stderr.write(
        `using Chrome for Testing at ${chrome.executablePath} (source: ${chrome.source})\n`,
      );
    }
  }
  const session = new BrowserSession({
    headless: !flags.headful,
    ...(flags.cdp ? { cdpEndpoint: flags.cdp } : {}),
    ...(proxy ? { proxy } : {}),
    ...(flags.storageState ? { storageState: flags.storageState } : {}),
    ...(flags.allowedOrigins && flags.allowedOrigins.length
      ? { allowedOrigins: flags.allowedOrigins }
      : {}),
    ...(chrome ? { executablePath: chrome.executablePath } : {}),
  });
  const unregister = registerCleanup(() => session.close());
  const originalClose = session.close.bind(session);
  let closed = false;
  session.close = async (): Promise<void> => {
    if (!closed) {
      closed = true;
      unregister();
    }
    return originalClose();
  };
  return session;
}

/**
 * Chromium net errors worth naming, in match order. The navigation catch-all
 * used to answer every failure with "is the server running? Try --wait-until
 * …", which is advice for a page that loads too slowly — and nonsense for a
 * hostname that doesn't resolve or a port Chrome refuses outright (both hit
 * during CLI dogfooding, against `…invalid/` and `127.0.0.1:1`). The exit code
 * was right; the hint sent people to tune timeouts instead of fixing the URL.
 *
 * Matched against the RAW message: these are Chromium's own `net::ERR_*`
 * tokens, which carry no user data, and matching before redaction keeps them
 * intact no matter how a URL is rewritten. Each pattern is tested against
 * the single error token `navigationHint` extracts, never the whole message:
 * Playwright quotes the target URL in the same message, and a URL can carry
 * `net::ERR_*` text of its own.
 */
const NAVIGATION_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /net::ERR_NAME_NOT_RESOLVED|net::ERR_NAME_RESOLUTION_FAILED/,
    "that hostname does not resolve — check the spelling, your DNS, or whether the host is only reachable over a VPN.",
  ],
  [
    /net::ERR_UNSAFE_PORT/,
    "Chrome refuses to connect on this port — serve the page on an ordinary one (3000, 8080, …).",
  ],
  [
    /net::ERR_CONNECTION_REFUSED/,
    "nothing is listening there — start the server, or check the host and port.",
  ],
  [
    /net::ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE|PROXY_CONNECTION_FAILED)/,
    "the network is unreachable from here — check connectivity, or the proxy you passed to --proxy.",
  ],
  [
    /net::ERR_(CERT_|SSL_)/,
    "the site's TLS certificate was rejected — trust the certificate locally, or audit the plain-http origin.",
  ],
  [
    /net::ERR_TOO_MANY_REDIRECTS/,
    "the URL redirects in a loop — a login wall is the usual cause; see --storage-state for auditing signed-in pages.",
  ],
  [
    /net::ERR_(CONNECTION_RESET|EMPTY_RESPONSE)/,
    "the server closed the connection without answering — check it speaks the scheme you used (http:// vs https://).",
  ],
];

/**
 * The hint for a failed navigation. Falls back to the timeout advice, which is
 * what an unrecognised failure most often is: a page that never settled.
 */
function navigationHint(raw: string): string {
  // Classify Chromium's OWN error only: the first `net::ERR_*` token, which
  // Playwright prints before the target URL (`page.goto: net::ERR_X at <url>`).
  // A URL may legally carry the same text — `?q=net::ERR_NAME_NOT_RESOLVED` —
  // so matching the whole message would let the URL pick the hint.
  const token = /net::ERR_[A-Z0-9_]+/.exec(raw)?.[0];
  if (token) {
    for (const [pattern, hint] of NAVIGATION_HINTS) {
      if (pattern.test(token)) return hint;
    }
  }
  return "is the server running? Try --wait-until domcontentloaded or --timeout 60000.";
}

/** Navigate with the full error catalog applied; re-asserts the final scheme. */
export async function openPage(
  session: BrowserSession,
  url: string,
  options: OpenOptions,
  fileApproved: boolean,
  authenticated = false,
): Promise<{ title: string; url: string }> {
  try {
    const result = await session.open(url, options);
    assertFinalUrl(result.url, fileApproved);
    noteCrossOrigin(url, result.url, authenticated);
    return result;
  } catch (err) {
    if (err instanceof CliError) throw err;
    const raw = err instanceof Error ? err.message : String(err);
    // Playwright quotes the full target URL (userinfo, query secrets and
    // all) inside its messages — redact before the message reaches any sink.
    const message = sanitizeText(redactUrlsIn(raw), { singleLine: true });
    if (/Executable doesn't exist/i.test(raw)) {
      throw new CliError(
        "No browser is downloaded yet.",
        "npx real-a11y install  (or: npx playwright install chromium — CI on Linux may also need: npx playwright install-deps chromium)",
      );
    }
    if (/error while loading shared libraries/i.test(raw)) {
      throw new CliError(
        message,
        "Chrome needs system libraries this machine lacks — run: npx playwright install-deps chromium (Debian/Ubuntu), or install your distro's Chrome dependencies.",
      );
    }
    if (/spawn .*EACCES|ENOEXEC|Failed to launch/i.test(raw)) {
      throw new CliError(
        message,
        "the configured Chrome binary looks broken — re-run: real-a11y install --force (or check --chrome-path / REAL_A11Y_CHROME_PATH).",
      );
    }
    if (/Unknown device/.test(raw)) {
      throw new CliError(
        message,
        'device names come from Playwright\'s registry — e.g. "iPhone 13", "Pixel 7".',
      );
    }
    if (/emulation is not supported over a CDP/i.test(raw)) {
      throw new CliError(message);
    }
    // Origin pinning refused extraction — a redirect left the intended site
    // while a session was loaded. Surface it as its own catalog entry.
    if (/not an allowed audit origin/i.test(raw)) {
      throw new CliError(
        message,
        "the page redirected off the audited origin; pass --audit-origin <origin> if that's expected.",
      );
    }
    if (/connect ECONNREFUSED|browserType.connectOverCDP/i.test(raw)) {
      throw new CliError(
        `could not reach the CDP endpoint: ${message}`,
        "is Chrome running with --remote-debugging-port?",
      );
    }
    throw new CliError(
      `could not open ${redactUrl(url)}: ${message}`,
      navigationHint(raw),
    );
  }
}

/**
 * Read Chromium's own accessibility tree over CDP, serialize + audit it in
 * Node, and project to clean data. Whole-document by nature — there is no root
 * to pass — and it carries no tab order: `snapshot.tabOrder` is always `""`,
 * which callers must record as *unmeasured*, never as an empty view.
 *
 * This is the producer for every read except `tabs`.
 */
export async function nativeSnapshot(
  session: BrowserSession,
  options: SnapshotOptions = {},
): Promise<CleanSnapshot> {
  try {
    return projectNativeTree(await session.nativeTree(), {
      // `parseRules` already validated these against the rule set; the engine
      // types them loosely as `string[]` across the browser boundary.
      rules: options.rules as NativeSnapshotOptions["rules"],
      includeGeneric: options.includeGeneric,
    });
  } catch (err) {
    throw mapPageError(err, "body");
  }
}

/** The raw native extraction, for the Node-side consumers (`list`) that want
 *  the tree itself rather than a projected snapshot. Same error mapping. */
export async function nativeTree(
  session: BrowserSession,
): Promise<Awaited<ReturnType<BrowserSession["nativeTree"]>>> {
  try {
    return await session.nativeTree();
  } catch (err) {
    throw mapPageError(err, "body");
  }
}

/**
 * The in-page DOM walk: serializes and audits inside the page and returns all
 * four views from one `page.evaluate`. Only `tabs` still reads through this —
 * the tab SEQUENCE is DOM/layout work Chromium's AX tree doesn't expose — and
 * `root` is the scope that walk honours.
 */
export async function snapshotPage(
  session: BrowserSession,
  root: string,
  options: SnapshotOptions,
): Promise<CleanSnapshot> {
  try {
    return projectSnapshot(await session.snapshot(root, options));
  } catch (err) {
    throw mapPageError(err, root);
  }
}

/** Run a named page-bundle export (e.g. listByRole) with the same error mapping. */
export async function callPage<T>(
  session: BrowserSession,
  fn: string,
  root: string,
  args: unknown[],
): Promise<T> {
  try {
    return await session.call<T>(fn, root, args);
  } catch (err) {
    throw mapPageError(err, root);
  }
}

/**
 * Auth flows redirect routinely, so landing on another origin isn't fatal —
 * but content from an unexpected host quietly entering a report is worth a
 * visible note (it may end up in a PR comment in phase 2).
 */
export function noteCrossOrigin(
  requested: string,
  landed: string,
  authenticated: boolean,
): void {
  try {
    const from = new URL(requested);
    const to = new URL(landed);
    if (
      (from.protocol === "http:" || from.protocol === "https:") &&
      from.origin !== to.origin
    ) {
      // Under a loaded session, an unexpected origin often means the session
      // expired and the site bounced to a login page — say so.
      const suffix = authenticated
        ? " — if this is a login page, the storage state may have expired; re-run: real-a11y login <url> --save <file>"
        : "";
      process.stderr.write(
        `note: landed on ${redactUrl(to.origin)} (requested ${redactUrl(from.origin)})${suffix}\n`,
      );
    }
  } catch {
    // Non-URL edge (data:, about:) — nothing to compare.
  }
}

function mapPageError(err: unknown, root: string): CliError {
  if (err instanceof CliError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const message = sanitizeText(redactUrlsIn(raw), { singleLine: true });
  if (/matched no element/.test(raw)) {
    return new CliError(
      `no element matches --root "${root}" on the page`,
      "verify with: real-a11y tree <url>",
    );
  }
  return new CliError(message);
}
