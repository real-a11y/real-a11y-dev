---
name: wire-up-mcp
description: >-
  Connect @real-a11y-dev/mcp to Cursor, Claude Code, Claude Desktop, VS Code, or
  other MCP clients. Use when adding Real A11y MCP, configuring npx
  @real-a11y-dev/mcp, setting storage-state / CDP / ALLOWED_ORIGINS, or smoking
  audit_page from an agent.
---

# Wire up Real A11y MCP

Gives an AI agent a real browser and the accessibility tree — audit, inspect,
checkpoint/diff, and act by role+name. Source of truth:
https://real-a11y.dev/packages/mcp

## Prerequisites

- Node.js 20+
- A Chromium binary: `npx real-a11y install` (or `npx playwright install chromium`)
- An MCP-capable client

## Client config

Point the client at `npx -y @real-a11y-dev/mcp` (no global install required).

**Claude Code**

```sh
claude mcp add real-a11y -- npx -y @real-a11y-dev/mcp
```

**VS Code**

```sh
code --add-mcp '{"name":"real-a11y","command":"npx","args":["-y","@real-a11y-dev/mcp"]}'
```

**Config file** (Cursor `~/.cursor/mcp.json` or project `.cursor/mcp.json`,
Claude Desktop `claude_desktop_config.json`, Windsurf, etc.):

```json
{
  "mcpServers": {
    "real-a11y": {
      "command": "npx",
      "args": ["-y", "@real-a11y-dev/mcp"]
    }
  }
}
```

Then once:

```sh
npx real-a11y install
```

To pin a version, install locally (`npm i -D @real-a11y-dev/mcp@beta playwright`)
and point `command`/`args` at the local binary instead of `npx -y`.

## Auth (pages behind login)

Never pass credentials as MCP tool arguments. Human logs in once; agent reuses
the session:

1. `npx real-a11y login <url> --save ./auth.json` (keep `auth.json` out of VCS)
2. Set env for the MCP server process:
   - `REAL_A11Y_MCP_STORAGE_STATE` — **absolute** path to the storage-state file
   - `REAL_A11Y_MCP_ALLOWED_ORIGINS` — comma-separated trusted origins (required
     with storage state)

`REAL_A11Y_MCP_CDP` (attach to an existing browser) and storage-state are
**mutually exclusive**. A bad storage-state path or missing origins should fail
at server startup — do not work around that.

`file://` is blocked by default; only enable if the docs’ allow-file flag is
appropriate for the user’s threat model.

## Smoke test

1. Confirm the client lists Real A11y tools.
2. Ask: “Audit https://example.com for accessibility problems.”
3. Expected tool sequence: `open_page` → `audit_page` (or `inspect_page`) →
   explain findings → `close_browser` when done.

Discover tools from their descriptions — do not invent tool names or parameter
shapes. Full reference: https://real-a11y.dev/packages/mcp/tools

## Next skills

- First audit workflows → `audit-a-page`
- Interact then re-check → `a11y-act-loop`
