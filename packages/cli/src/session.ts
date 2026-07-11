/**
 * Adapter between CLI flags and the shared engine's BrowserSession — imported
 * from `@real-a11y-dev/mcp/browser` (the subpath that carries none of the MCP
 * SDK graph), and only ever dynamically, so browser-free invocations never
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
} from "@real-a11y-dev/mcp/browser";

import { registerCleanup } from "./cleanup.js";
import { CliError } from "./exit.js";
import {
  projectSnapshot,
  redactUrl,
  redactUrlsIn,
  sanitizeText,
  type CleanSnapshot,
} from "./sanitize.js";
import { assertFinalUrl } from "./url-gate.js";

function proxyFromEnv():
  | { server: string; bypass?: string; username?: string; password?: string }
  | undefined {
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

function isPlaywrightNotInstalled(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" &&
    err.message.includes("playwright")
  );
}

export interface SessionFlags {
  headful?: boolean;
  cdp?: string;
}

export async function createSession(
  flags: SessionFlags,
): Promise<BrowserSession> {
  try {
    // Chromium doesn't honor proxy env vars on its own; map them to the
    // launch option so corporate-network CI works without extra flags.
    await import("playwright");
  } catch (err) {
    if (isPlaywrightNotInstalled(err)) {
      throw new CliError(
        "Playwright is required to drive a browser, but it isn't installed.",
        "npm i -D playwright && npx playwright install chromium",
      );
    }
    throw err;
  }
  const { BrowserSession } = await import("@real-a11y-dev/mcp/browser");
  const proxy = proxyFromEnv();
  const session = new BrowserSession({
    headless: !flags.headful,
    ...(flags.cdp ? { cdpEndpoint: flags.cdp } : {}),
    ...(proxy ? { proxy } : {}),
  });
  registerCleanup(() => session.close());
  return session;
}

/** Navigate with the full error catalog applied; re-asserts the final scheme. */
export async function openPage(
  session: BrowserSession,
  url: string,
  options: OpenOptions,
  fileApproved: boolean,
): Promise<{ title: string; url: string }> {
  try {
    const result = await session.open(url, options);
    assertFinalUrl(result.url, fileApproved);
    noteCrossOrigin(url, result.url);
    return result;
  } catch (err) {
    if (err instanceof CliError) throw err;
    const raw = err instanceof Error ? err.message : String(err);
    // Playwright quotes the full target URL (userinfo, query secrets and
    // all) inside its messages — redact before the message reaches any sink.
    const message = sanitizeText(redactUrlsIn(raw), { singleLine: true });
    if (/Executable doesn't exist/i.test(raw)) {
      throw new CliError(
        "Chromium isn't downloaded yet.",
        "npx playwright install chromium  (CI: add --with-deps)",
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
    if (/connect ECONNREFUSED|browserType.connectOverCDP/i.test(raw)) {
      throw new CliError(
        `could not reach the CDP endpoint: ${message}`,
        "is Chrome running with --remote-debugging-port?",
      );
    }
    throw new CliError(
      `could not open ${redactUrl(url)}: ${message}`,
      "is the server running? Try --wait-until domcontentloaded or --timeout 60000.",
    );
  }
}

/** Extract all four views (one extraction) and project them to clean data. */
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
function noteCrossOrigin(requested: string, landed: string): void {
  try {
    const from = new URL(requested);
    const to = new URL(landed);
    if (
      (from.protocol === "http:" || from.protocol === "https:") &&
      from.origin !== to.origin
    ) {
      process.stderr.write(
        `note: landed on ${redactUrl(to.origin)} (requested ${redactUrl(from.origin)})\n`,
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
