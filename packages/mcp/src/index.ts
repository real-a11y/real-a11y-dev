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
 *   REAL_A11Y_MCP_CDP         Attach to a running Chrome over CDP (e.g. http://localhost:9222)
 *   REAL_A11Y_MCP_HEADFUL     Set to "1" to launch a visible browser instead of headless
 *   REAL_A11Y_MCP_ALLOW_FILE  Set to "1" to permit auditing file:// URLs (off by default)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { BrowserSession } from "./browser.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const session = new BrowserSession({
    cdpEndpoint: process.env.REAL_A11Y_MCP_CDP,
    headless: process.env.REAL_A11Y_MCP_HEADFUL !== "1",
  });
  const server = buildServer(session);

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
}

main().catch((err) => {
  process.stderr.write(
    `real-a11y MCP server failed to start: ${String(err)}\n`,
  );
  process.exit(1);
});
