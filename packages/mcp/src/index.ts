#!/usr/bin/env node
/**
 * Real A11y MCP server — stdio entry point.
 *
 * Wire into an MCP client config (launched from an arbitrary cwd, so use the
 * package-name form, not the bare bin):
 *
 *   {
 *     "mcpServers": {
 *       "real-a11y": { "command": "npx", "args": ["-y", "@real-a11y-dev/mcp"] }
 *     }
 *   }
 *
 * Environment:
 *   REAL_A11Y_MCP_CDP             Attach to a running Chrome over CDP (e.g. http://localhost:9222)
 *   REAL_A11Y_MCP_HEADFUL        Set to "1" to launch a visible browser instead of headless
 *   REAL_A11Y_MCP_ALLOW_FILE     Set to "1" to permit auditing file:// URLs (off by default)
 *   REAL_A11Y_MCP_STORAGE_STATE  Path to a Playwright storage-state JSON — audit pages
 *                                behind a login as that session (create it out-of-band, e.g.
 *                                `real-a11y login`; never a tool parameter)
 *   REAL_A11Y_MCP_ALLOWED_ORIGINS  Comma-separated origins extraction is restricted to when a
 *                                storage state is loaded (origin pinning). Strongly recommended
 *                                with STORAGE_STATE so a redirect can't audit an unintended site.
 *   REAL_A11Y_CHROME_PATH        Launch this Chrome binary instead of Playwright's bundled
 *                                Chromium (e.g. a system Chrome). Ignored under CDP. A bad path
 *                                refuses to start rather than silently falling back.
 *   REAL_A11Y_BROWSERS_DIR       Cache directory `real-a11y install` downloaded Chrome for
 *                                Testing into, if not the platform default (~/.cache/real-a11y).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  BrowserSession,
  resolveChromeExecutable,
} from "@real-a11y-dev/browser";

import { assertValidStorageState, parseAllowedOrigins } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const storageState = process.env.REAL_A11Y_MCP_STORAGE_STATE;
  if (storageState) assertValidStorageState(storageState);
  const allowedOrigins = parseAllowedOrigins(
    process.env.REAL_A11Y_MCP_ALLOWED_ORIGINS,
  );

  const cdpEndpoint = process.env.REAL_A11Y_MCP_CDP;
  const headful = process.env.REAL_A11Y_MCP_HEADFUL === "1";
  // CDP mode reuses a running browser — there's no binary for us to pick. A
  // bad REAL_A11Y_CHROME_PATH throws here and refuses to start (below), same
  // philosophy as an invalid REAL_A11Y_MCP_STORAGE_STATE above: silently
  // falling back to a different browser than the operator configured would
  // be worse than refusing to start.
  const chrome = cdpEndpoint ? undefined : resolveChromeExecutable();

  const session = new BrowserSession({
    cdpEndpoint,
    // Ignored when `cdpEndpoint` is set: `connectOverCDP` reuses the running
    // browser, window state and all. `open_page` reports that case separately
    // rather than repeating a launch flag that had no say in it.
    headless: !headful,
    // Auth material is env-configured, never a tool parameter — session tokens
    // never enter the agent's context. The constructor rejects storageState +
    // cdpEndpoint together (a CDP connection carries its own session).
    ...(storageState ? { storageState } : {}),
    ...(allowedOrigins.length ? { allowedOrigins } : {}),
    ...(chrome ? { executablePath: chrome.executablePath } : {}),
  });
  const server = buildServer(session, {
    authenticated: Boolean(storageState),
    headful,
    cdpAttached: Boolean(cdpEndpoint),
  });

  // Tear down the browser exactly once on any shutdown signal. The SDK's stdio
  // transport doesn't reliably fire onclose on stdin EOF, so wire every path.
  let shuttingDown = false;
  const shutdown = async (code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await session.close().catch(() => {});
    await server.close().catch(() => {});
    process.exit(code);
  };
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  process.stdin.on("end", () => void shutdown(0));
  process.stdin.on("close", () => void shutdown(0));
  server.server.onclose = () => void shutdown(0);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is the protocol channel — log to stderr only.
  process.stderr.write("real-a11y MCP server running on stdio\n");
  if (chrome) {
    process.stderr.write(
      `  browser: ${chrome.executablePath} (${chrome.source})\n`,
    );
  }
  if (storageState) {
    // Operator-facing: confirm the session is armed. The path is fine to log;
    // the file's contents (tokens) never are.
    process.stderr.write(
      `  authenticated session: storage state loaded from ${storageState}\n`,
    );
    process.stderr.write(
      allowedOrigins.length
        ? `  audit origins restricted to: ${allowedOrigins.join(", ")}\n`
        : `  warning: no REAL_A11Y_MCP_ALLOWED_ORIGINS set — audits aren't origin-pinned; a redirect could audit another site with this session.\n`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(
    `real-a11y MCP server failed to start: ${String(err)}\n`,
  );
  process.exit(1);
});
