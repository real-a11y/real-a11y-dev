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
| `audit_page` | **Flagship.** Return every accessibility violation — unlabeled controls, images missing alt, heading gaps, unlabeled dialogs, broken landmarks — as structured findings (grouped, each with a CSS locator + severity). Pass `producer: "native"` to audit Chromium's own tree (see below). |
| `inspect_page` | Findings **plus** semantic tree, heading outline, and tab order — all from **one** extraction, so they can't disagree. Prefer on dynamic pages. Accepts `producer: "native"` (findings + tree + outline; tab order is N/A). |
| `get_semantic_tree` | Deterministic role + accessible-name outline of the page. Accepts `producer: "native"`. |
| `get_heading_outline` | Heading structure (h1..h6) in document order. Accepts `producer: "native"`. |
| `get_tab_order` | Focusable elements in keyboard Tab order. DOM-only (a native tree has no tab order). |
| `list_elements` | Every element of one category (`link`/`button`/`form`/`landmark`/`image`/`heading`) as role + name + locator. Accepts `producer: "native"` (no locators). |
| `compare_producers` | Diff the DOM producer against the native producer and report role/name divergences — a fidelity oracle. Not to be confused with `diff_checkpoints` (two checkpoints over time). |
| `close_browser` | Tear down the session. |

### The native producer — `producer: "native"`

By default every tree/findings/outline/list tool walks the page's light DOM (the
**DOM producer**). Pass `producer: "native"` to `audit_page`, `inspect_page`,
`get_semantic_tree`, `get_heading_outline`, or `list_elements` to work over
**Chromium's own accessibility tree** (read over CDP) instead — it reaches
structure no in-page walk can, most visibly a `<video controls>`'s
play/scrubber/mute controls, which live in a closed user-agent shadow root. To
*view* the native tree, call `get_semantic_tree` with `producer: "native"`; to
*audit* it, `audit_page`; to *compare* it against the DOM producer,
`compare_producers`.

Native is whole-document and read-only: `rootSelector` must stay `"body"`
(passing another selector is refused — native can't scope), and it carries no tab
order — so `get_tab_order` is DOM-only and `inspect_page`'s tab-order section
reports N/A. Chromium only.

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
> context budget. `compare_producers` and any tool called with
> `producer: "native"` always read the whole document (native can't scope).

### Environment

| Var | Effect |
| --- | --- |
| `REAL_A11Y_MCP_CDP` | Attach to a running Chrome over CDP (e.g. `http://localhost:9222`) instead of launching one — audit pages behind a login you're already signed into. |
| `REAL_A11Y_MCP_HEADFUL` | `1` launches a visible browser instead of headless. |
| `REAL_A11Y_MCP_ALLOW_FILE` | `1` permits auditing `file://` URLs. Off by default: an LLM-driven server that can open `file:///…/.env` and read the DOM back is a local-file exfiltration primitive. |
| `REAL_A11Y_MCP_STORAGE_STATE` | Path to a Playwright storage-state file — audit pages behind a login as that saved session. Create it out-of-band (e.g. `real-a11y login`); it's never a tool parameter, so session tokens never enter the agent's context. The server refuses to start if the file is missing or malformed. |
| `REAL_A11Y_MCP_ALLOWED_ORIGINS` | Comma-separated origins that auditing is restricted to when a storage state is loaded (origin pinning). **Strongly recommended** alongside `STORAGE_STATE`: without it, a redirect could audit an unintended site with your session. |

Auth material is always operator-configured, never a tool parameter — the agent
just benefits from a session you set up. Use a dedicated low-privilege test
account, and keep the storage-state file out of version control.

## Programmatic use

Beyond the MCP server, the package ships a `./browser` subpath export that gives
you the Playwright-backed session standalone — without pulling in the MCP SDK
dependency graph:

```ts
import { BrowserSession } from "@real-a11y-dev/mcp/browser";
```

`BrowserSession` (and its option types `BrowserSessionOptions`, `OpenOptions`,
`SnapshotOptions`) drives a real browser, injects the extraction bundle, and
returns findings / tree / outline / tab order from a single extraction — handy
for scripting audits directly in Node without an MCP client.

## Status

Beta, published on npm. Part of the `@real-a11y-dev` family (`core`, `testing`,
`validate`, …); API and tool surface may still change before 1.0.
