---
title: "@real-a11y-dev/mcp — accessibility audits for AI agents"
description: A Model Context Protocol server that exposes the Real A11y semantic tree and accessibility audits to AI agents, so an assistant can audit any live page.
---

# @real-a11y-dev/mcp

::: warning Beta — preview page
Published on npm as a **beta**: the API and tool surface may still change before
1.0, and audit fidelity is bounded by known engine issues. Pin a version rather
than tracking the latest tag if you build on it.
:::

The Real A11y MCP server gives an AI assistant a real browser and the
accessibility tree behind any page, so it can **audit** a URL and report the
defects a screen reader would announce — not guess from pasted HTML (which hides
computed roles and visibility) or a screenshot (which has no semantics). Point any
[Model Context Protocol](https://modelcontextprotocol.io) client at it and ask it
to audit a page in plain language.

Accessibility is a property of the **rendered** page — the roles, names, and
visibility a browser actually computes, not what's in the HTML source. So the
server drives a real browser (via Playwright) rather than parsing markup. You
need:

- **Node.js 20+** — the server runs under Node and is fetched with `npx`.
- **A Chromium binary** — install one with `npx playwright install chromium`.
- **An MCP client** — Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, or
  any other MCP-capable tool.

## Connect it to your client

The server speaks MCP over stdio — point your client at
`npx -y @real-a11y-dev/mcp`. No install step is needed; `npx` fetches it on first
run.

::: code-group

```sh [Claude Code]
claude mcp add real-a11y -- npx -y @real-a11y-dev/mcp
```

```sh [VS Code]
code --add-mcp '{"name":"real-a11y","command":"npx","args":["-y","@real-a11y-dev/mcp"]}'
```

```json [Config file]
{
  "mcpServers": {
    "real-a11y": {
      "command": "npx",
      "args": ["-y", "@real-a11y-dev/mcp"]
    }
  }
}
```

:::

For clients configured by file, add the `mcpServers` block above to:

- **Claude Desktop** — `claude_desktop_config.json` (Settings → Developer → Edit
  Config).
- **Cursor** — `~/.cursor/mcp.json`, or a project-local `.cursor/mcp.json`.
- **Windsurf and others** — that client's MCP config, using the same block.

Then install a browser once:

```sh
npx playwright install chromium
```

To pin a version instead of tracking the latest, add it to your project
(`npm install -D @real-a11y-dev/mcp playwright`) and point `command` / `args` at
the local install.

## Your first audit

Once it's connected, ask in plain language — the assistant picks the tools:

> **You:** "Audit example.com for accessibility problems."
>
> **Assistant:** calls `open_page("https://example.com")` → `audit_page()` → gets
> structured findings → explains them and proposes fixes.

Because it drives a real browser, JS-heavy SPAs render fully, and any URL the
browser can reach works — public sites, a **local dev server**, or staging.

::: tip Every tool + parameters → [/packages/mcp/tools](/packages/mcp/tools)
This is a guide. For the full tool reference — all sixteen tools, their
parameters, and when to reach for each — see the
[tools reference](/packages/mcp/tools).
:::

## Auditing a page behind a login

To audit a page only a logged-in user can see, save a browser session once, then
point the server at it — the assistant never touches credentials.

1. **Save a session** with the CLI's login helper (a one-time human step):

   ```sh
   npx -y @real-a11y-dev/cli login https://app.example.com --save auth.json
   ```

   A real browser opens; sign in by hand (passwords, SSO, MFA, and passkeys all
   work), then press Enter. Playwright's storage state — cookies and origin
   storage — is written to `auth.json`. Keep that file out of version control; it
   holds live session tokens.

2. **Point the server at it** with two environment variables in your MCP config:

   ```json
   {
     "mcpServers": {
       "real-a11y": {
         "command": "npx",
         "args": ["-y", "@real-a11y-dev/mcp"],
         "env": {
           "REAL_A11Y_MCP_STORAGE_STATE": "/absolute/path/to/auth.json",
           "REAL_A11Y_MCP_ALLOWED_ORIGINS": "https://app.example.com"
         }
       }
     }
   }
   ```

3. **Audit as usual.** Every page now opens already authenticated, and
   `open_page` tells the assistant the session is active so it won't try to log
   in. `REAL_A11Y_MCP_ALLOWED_ORIGINS` pins auditing to that origin, so a redirect
   can't route your session to another site.

The session path is server configuration, never a tool argument, so tokens stay
out of the assistant's context. See
[Authenticated pages](/guide/authenticated-pages) for the full workflow and
security rules.

## Configuration

All server behavior is set through `REAL_A11Y_MCP_*` environment variables, in
the `"env"` block of the config above — attaching to a running Chrome over CDP,
headful mode, `file://` access, a saved login session, and origin pinning. Each
one, with its values and security notes, is documented in
[Environment](/packages/mcp/tools#environment) in the tools reference.

## Scripting audits without an MCP client

Beyond the server, the package ships a `./browser` subpath export that gives you
the Playwright-backed session standalone — without pulling in the MCP SDK
dependency graph:

```ts
import { BrowserSession } from "@real-a11y-dev/mcp/browser";
```

`BrowserSession` (with its option types `BrowserSessionOptions`, `OpenOptions`,
`SnapshotOptions`) drives a real browser, injects the extraction bundle, and
returns findings, tree, outline, and tab order from a single extraction — handy
for scripting audits directly in Node.

## How it compares to Playwright MCP

This **complements** a browser-automation MCP such as
[Playwright MCP](https://github.com/microsoft/playwright-mcp) — it doesn't try to
replace it. They solve different halves of the problem:

- **Playwright MCP** lets an agent _drive_ a page — click, type, navigate — using
  the accessibility snapshot as a means to _act_.
- **Real A11y** lets an agent _judge_ a page — it reports what assistive
  technology would announce as _broken_, with a semantic tree tuned to what a
  screen reader actually perceives.

Use Playwright MCP to act; use Real A11y to audit. They pair naturally: drive a
flow to a given state with one, then check that state's accessibility with the
other.

::: tip Two different "Playwrights"
This package is _built on_ **Playwright the library** — the browser driver you
install as a peer dependency. It _complements_ **Playwright MCP**, the automation
server above. Same underlying engine, different jobs.
:::

## Limitations

- **Scope.** It runs five rules today — unlabeled interactive elements, images
  missing alt text, heading order, dialog labeling, and landmark structure — plus
  the full semantic tree. It is not a complete WCAG or axe-core suite; it is
  semantic-tree-based and tuned to "what a screen reader announces." For contrast,
  focus visibility, and other rendered/interactive checks, pair it with
  [axe-core](https://github.com/dequelabs/axe-core) and manual testing.
- **Fidelity follows the engine.** The tree is a reimplementation of
  accessible-name / role computation, not the browser's native accessibility tree.
  It is tuned to match what assistive tech announces, but can diverge on edge
  cases.
- **Requires a real browser.** The assistant's environment must be able to launch
  Chromium or connect to one over CDP.

## See also

- [Tools reference](/packages/mcp/tools) — every tool, its parameters, and when to
  use it.
- [`@real-a11y-dev/testing` — Assertions](/packages/testing/assertions) — the same
  `collectFindings` engine, for unit and end-to-end tests.
