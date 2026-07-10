---
title: "@real-a11y-dev/mcp — accessibility audits for AI agents"
description: A Model Context Protocol server that exposes the Real A11y semantic tree and accessibility audits to AI agents, so an assistant can audit any live page.
---

# @real-a11y-dev/mcp

::: warning Beta — preview page
Published on npm as a **beta**: the API and tool surface may still change before
1.0, and audit fidelity is bounded by known engine issues (see the Limitations
section below). This page is a preview and isn't in the sidebar yet — pin a
version rather than tracking the latest tag if you build on it.
:::

The Real A11y MCP server gives an AI assistant a real browser and the
accessibility tree behind any page, so it can **audit** a URL and report the
defects a screen reader would announce — not guess from pasted HTML (which hides
computed roles and visibility) or a screenshot (which has no semantics). Point any
[Model Context Protocol](https://modelcontextprotocol.io) client at it and ask it
to audit a page in plain language.

## Prerequisites

Accessibility is a property of the **rendered** page — the roles, names, and
visibility a browser actually computes, not what's in the HTML source. So the
server drives a real browser (via Playwright) rather than parsing markup, and
needs:

- **Node.js 20+** — the server runs under Node and is fetched with `npx`.
- **A Chromium binary** — it drives a real browser; install one with
  `npx playwright install chromium`.
- **An MCP client** — Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, or
  any other MCP-capable tool.

## Getting started

### Installation

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

### Your first audit

Once it's connected, ask in plain language — the assistant picks the tools:

> **You:** "Audit example.com for accessibility problems."
>
> **Assistant:** calls `open_page("https://example.com")` → `audit_page()` → gets
> structured findings → explains them and proposes fixes.

Because it drives a real browser, JS-heavy SPAs render fully, and any URL the
browser can reach works — public sites, a **local dev server**, or staging.

## Tools

| Tool | Purpose |
| --- | --- |
| `open_page` | Navigate to a URL and prepare it for queries. Call first. `waitUntil` / `settleMs` settle dynamic pages; `device` (e.g. `"iPhone 13"`, `"iPad Pro 11"`) audits the mobile/tablet layout. |
| **`audit_page`** | **Flagship.** Every accessibility violation — unlabeled controls, images missing alt text, skipped/missing/duplicate headings, unlabeled dialogs, broken landmark structure — as structured findings, each with a CSS **locator** + **severity**, grouped and counted, plus a summary. |
| `inspect_page` | Findings **plus** the semantic tree, heading outline, and tab order — all from **one** extraction, guaranteed internally consistent. Prefer on dynamic pages. |
| `get_semantic_tree` | Deterministic role + accessible-name outline of the page. |
| `get_heading_outline` | Heading structure (h1–h6) in document order. |
| `get_tab_order` | Focusable elements in keyboard Tab order. |
| `list_elements` | Every element of one category — `link` / `button` / `form` / `landmark` / `image` / `heading` — as role + name + locator. A focused, token-efficient view. |
| `get_native_tree` | Chromium's **own** accessibility tree (Blink, via CDP) — the authoritative browser tree, for cross-checking. |
| `compare_trees` | Diff the custom tree against the native one and report role/name disagreements — a cross-check on the engine's fidelity. |
| `close_browser` | Tear down the session. |

Every audit/inspection tool takes an optional `rootSelector` (default `body`) to
scope extraction to a single region or component. The two native-tree tools
(`get_native_tree`, `compare_trees`) read the whole document.

## Features

### Consistency on dynamic pages

Live pages move — SPAs hydrate, consent dialogs appear. Two features keep results
trustworthy:

- **`inspect_page`** derives findings, tree, outline, and tab order from a
  _single_ extraction, so they always describe the same instant (separate
  `audit_page` + `get_*` calls can each catch a different state).
- **`open_page`'s `waitUntil: "networkidle"` and `settleMs`** let the page settle
  before extraction, so runs are repeatable instead of racing async content.

### Mobile & tablet

Pass `device` (a Playwright device name like `"iPhone 13"` or `"iPad Pro 11"`) to
`open_page` and the tree reflects the **mobile/tablet** layout — a responsive site
can differ substantially from desktop (a `menubar` becomes a hamburger `button`,
content is hidden or reordered). Open the same URL at desktop and on a device to
diff how accessible each rendering is. Emulation isn't available over
`REAL_A11Y_MCP_CDP` (it reuses the running browser's context).

### Cross-checking against the browser

Every audit and query uses Real A11y's **custom** engine — the same portable
extraction that runs in the extension and in tests. Because the server also drives
Chromium, two optional tools let you cross-check it against the browser's own
computation: **`get_native_tree`** returns Chromium's native accessibility tree
(via CDP), and **`compare_trees`** diffs the two and flags any role or name
disagreements. The custom engine is the default everywhere; native is an opt-in,
Chromium-only sanity check.

## Configuration

Set these environment variables on the server process — most clients accept an
`"env"` object alongside `command` / `args` in the config block above.

| Variable | Effect |
| --- | --- |
| `REAL_A11Y_MCP_CDP` | Attach to an already-running Chrome over CDP (e.g. `http://localhost:9222`) instead of launching one — use this to audit pages behind a login. |
| `REAL_A11Y_MCP_HEADFUL` | `1` launches a visible browser instead of headless. |
| `REAL_A11Y_MCP_ALLOW_FILE` | `1` permits auditing `file://` URLs (off by default — an agent that can open `file:///…/.env` and read the DOM back is a local-file exfiltration risk). |

::: warning Use a dedicated profile for CDP
Attaching over CDP connects to whatever Chrome is listening on that port —
**including your everyday browser and its logged-in sessions**, which an
LLM-driven server can then read. Launch a throwaway instance rather than enabling
remote debugging on your main profile:
:::

```sh
chrome --remote-debugging-port=9222 --user-data-dir=/tmp/a11y-cdp
```

## Quick reference

Drive it in natural language; the assistant maps each request to the right tools.

| Ask | What it does |
| --- | --- |
| _"Audit `https://example.com` and list every issue with its CSS selector, grouped by severity."_ | Full page audit, with locators |
| _"Open `http://localhost:3000`, inspect the signup form, and tell me which fields are missing labels."_ | Scoped audit + fixes |
| _"Compare the nav of `https://mysite.com` on desktop and on an iPhone 13 — does mobile stay accessible?"_ | Desktop vs. device layout |
| _"On `https://example.com`, audit just the cookie-consent dialog."_ | Scope with `rootSelector` |
| _"Get the heading outline of `https://blog.example.com` and flag skipped levels."_ | Heading structure |
| _"Log in, open the dashboard, then audit that screen."_ | Pair a browser-automation MCP for the flow, audit with this one |

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

## Under the hood

It reuses the pieces `@real-a11y-dev/testing` already ships:

1. **Playwright** (the library) drives a real browser — required, because the
   engine relies on layout / `getComputedStyle` to decide what is exposed to
   assistive tech, which a serverside DOM (jsdom) cannot faithfully reproduce.
2. The prebuilt page-bundle is injected by evaluating it through the CDP runtime
   (`page.evaluate`), which sets `window.__realA11y__` and works even on sites
   that enforce a strict CSP / Trusted Types — where DOM `<script>` injection
   (`addScriptTag`) is blocked.
3. Each tool routes through `page.evaluate()` and calls the shared
   [`collectFindings`](/packages/testing/assertions) / serialize helpers — the
   same audit logic the testing package's assertions use.

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

- [`@real-a11y-dev/testing` — Assertions](/packages/testing/assertions) — the same
  `collectFindings` engine, for unit and end-to-end tests.
- [Reading Good Semantics](/guide/reading-good-semantics) — how to read the tree
  the tools hand back.
