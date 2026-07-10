# @real-a11y-dev/mcp

> A Model Context Protocol (MCP) server that exposes the Real A11y semantic
> accessibility tree — and its audits — to AI agents.

Unlike a general browser-automation MCP (which hands an agent the browser's raw
accessibility snapshot so it can _click things_), this server is **audit-first**:
its flagship tool tells an agent what a real screen reader would announce as
_broken_. The tree-inspection tools are perception primitives layered on top.

## Tools

| Tool | Purpose |
| --- | --- |
| `open_page` | Navigate to a URL and prepare it for queries (call first). `waitUntil` / `settleMs` settle dynamic pages; `device` (e.g. `"iPhone 13"`) audits the **mobile/tablet** layout. |
| `audit_page` | **Flagship.** Return every accessibility violation — unlabeled controls, images missing alt, heading gaps, unlabeled dialogs, broken landmarks — as structured findings (grouped, each with a CSS locator + severity). |
| `inspect_page` | Findings **plus** semantic tree, heading outline, and tab order — all from **one** extraction, so they can't disagree. Prefer on dynamic pages. |
| `get_semantic_tree` | Deterministic role + accessible-name outline of the page. |
| `get_heading_outline` | Heading structure (h1..h6) in document order. |
| `get_tab_order` | Focusable elements in keyboard Tab order. |
| `list_elements` | Every element of one category (`link`/`button`/`form`/`landmark`/`image`/`heading`) as role + name + locator. |
| `get_native_tree` | Chromium's own accessibility tree (Blink, via CDP) — the authoritative browser tree. |
| `compare_trees` | Diff custom vs. native and report role/name divergences — a fidelity oracle. |
| `close_browser` | Tear down the session. |

### Consistency & determinism

- **`inspect_page`** derives all four views from a single extraction, so a report
  can't be internally inconsistent (e.g. an audit finding referencing a node the
  tree doesn't show) on a page that changes between separate calls.
- **`open_page`'s `waitUntil` / `settleMs`** let dynamic pages (SPAs, consent
  dialogs) reach a stable state before extraction, so results don't vary run to
  run. Use `waitUntil: "networkidle"` and/or a `settleMs` buffer for heavy SPAs.
- **`open_page`'s `device` / `viewport`** emulate a phone or tablet, so you audit
  the tree users on that device actually get — a responsive site can differ
  substantially from desktop (hamburger nav, hidden content, touch-only
  controls). Open the same URL at desktop and `device: "iPhone 13"` to diff them.

## How it works

It reuses the exact pieces the testing package already ships:

1. Playwright drives a real browser (a real browser is required — the engine
   depends on layout/`getComputedStyle` to decide AT exposure).
2. The pre-built IIFE page-bundle from `@real-a11y-dev/testing` is evaluated in
   the page via `page.evaluate()`, setting `globalThis.__realA11y__`. (It is run
   this way rather than `addScriptTag` so it works on pages served under a
   Trusted Types CSP — `require-trusted-types-for 'script'` — which blocks the
   `<script>` injection `addScriptTag` uses.)
3. Each tool then routes through `page.evaluate()` and calls the shared
   `collectFindings` / serialize helpers.

## Install & run

Playwright is a peer dependency and a Chromium binary is required:

```bash
npx playwright install chromium
```

Wire it into an MCP client — no install step needed, `npx -y` fetches the
package on first run (use the package name, not the bare `real-a11y-mcp` bin,
since the client launches it from an arbitrary working directory):

```json
{
  "mcpServers": {
    "real-a11y": { "command": "npx", "args": ["-y", "@real-a11y-dev/mcp"] }
  }
}
```

To pin the version instead, add it to your project (`pnpm add -D
@real-a11y-dev/mcp playwright`) and point `command`/`args` at the local install.

> **Scoping.** Every audit/inspection tool takes an optional `rootSelector`
> (default `body`) to confine extraction to one region — e.g. audit just a
> `<main>` or a specific component — which also keeps output within the agent's
> context budget. The two native-tree tools (`get_native_tree`, `compare_trees`)
> always read the whole document.

### Environment

| Var | Effect |
| --- | --- |
| `REAL_A11Y_MCP_CDP` | Attach to a running Chrome over CDP (e.g. `http://localhost:9222`) instead of launching one. |
| `REAL_A11Y_MCP_HEADFUL` | `1` launches a visible browser instead of headless. |
| `REAL_A11Y_MCP_ALLOW_FILE` | `1` permits auditing `file://` URLs. Off by default: an LLM-driven server that can open `file:///…/.env` and read the DOM back is a local-file exfiltration primitive. |

## Status

Beta, published on npm. Part of the `@real-a11y-dev` family (`core`, `testing`,
`validate`, …); API and tool surface may still change before 1.0.
