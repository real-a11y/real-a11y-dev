# @real-a11y-dev/mcp

> A Model Context Protocol (MCP) server that exposes the Real A11y semantic
> accessibility tree — and its audits — to AI agents.

Unlike a general browser-automation MCP (which hands an agent the browser's raw
accessibility snapshot and a selector engine), this server is **audit-first,
act-capable**: its flagship tool tells an agent what a real screen reader would
announce as _broken_, and its action tools drive the page **through that same
tree** — click, type, and focus target role + accessible name, so anything the
agent can operate is something assistive tech can reach, and `diff_tree`
reports what each action changed. The tree-inspection tools are perception
primitives layered underneath.

## Tools

Twenty tools, grouped. Every page tool takes an optional `session` — a name
selecting an independent live page with its own checkpoints; calls within one
session are serialized automatically, and different sessions run in parallel.
Omit it everywhere for the single default page. Every tool reads **Chromium's
own accessibility tree**
over CDP — whole-document, and reaching structure no in-page walk can — except
`get_tab_order`, which is the one view that tree cannot produce (see
[below](#one-producer-per-surface)). Full parameter reference:
**[real-a11y.dev/packages/mcp/tools](https://real-a11y.dev/packages/mcp/tools)**.

**Session**

| Tool | Purpose |
| --- | --- |
| `open_page` | Navigate to a URL and ready it for queries (call first). `waitUntil` / `settleMs` settle dynamic pages; `device` audits the **mobile/tablet** layout. |
| `close_browser` | Close one named session (or `all: true` for every one — not both). Discards that session's findings checkpoints — `export_checkpoint` first if one needs to outlive it. |
| `list_sessions` | List the live named sessions — URL (redacted), busy state, timestamps. |

**Audit**

| Tool | Purpose |
| --- | --- |
| `audit_page` | **Flagship.** Every accessibility violation — unlabeled controls, missing alt, heading gaps, unlabeled dialogs, broken landmarks — grouped, each with a CSS locator + severity. |
| `inspect_page` | Findings **plus** semantic tree and heading outline — all from **one** read, so they can't disagree. Prefer on dynamic pages. |

**Views**

| Tool | Purpose |
| --- | --- |
| `get_semantic_tree` | Deterministic role + accessible-name outline of the page. |
| `get_heading_outline` | Heading structure (h1..h6) in document order. |
| `get_tab_order` | Focusable elements in keyboard Tab order. The one in-page read, and the one tool `rootSelector` scopes. |
| `list_elements` | Every element of one category (`link`/`button`/`form`/`landmark`/`image`/`heading`) as role + name + locator. |

**Findings checkpoints** — capture the page's findings under a name, then diff what's **new / changed / fixed** with the same `v1:` fingerprints the CI a11y-diff uses. Survive navigation, so you can checkpoint one deploy and diff another.

| Tool | Purpose |
| --- | --- |
| `checkpoint_findings` | Snapshot the current page's findings under a name. |
| `diff_findings` | Re-snapshot the page and diff against a checkpoint. |
| `diff_checkpoints` | Diff two already-stored checkpoints (no re-snapshot). |
| `list_checkpoints` | List stored checkpoint labels with finding counts. |
| `export_checkpoint` | Export a checkpoint as a snapshot JSON artifact (CLI-compatible). |
| `import_checkpoint` | Load an external snapshot artifact as a checkpoint. |

Diffing prod against a preview is the headline workflow, so only the **origin** is
allowed to differ. When the two sides are different pages — a different path,
query or fragment — the diff tools say so and drop the advisory structural
summary, which across unrelated routes describes a rewrite rather than a
regression. Findings still match by fingerprint.

**Tree checkpoints** — capture the tree, interact, then see exactly what an interaction changed for a screen reader. Held outside the page, so a navigation is reported as a replaced document rather than silently losing the baseline.

| Tool | Purpose |
| --- | --- |
| `checkpoint_tree` | Capture the current tree as an interaction-diff baseline. |
| `diff_tree` | Diff the tree since `checkpoint_tree` — nodes added / removed / changed, plus focus move. |

**Act** — the write side of that same tree. Targets are described the way
the tree prints them — **role + accessible name** (plus a 1-based `nth` when
several match), never a CSS selector or node id. If role and name can't reach a
control, assistive technology can't reach it either — that's a finding, not a
targeting gap. The loop: `checkpoint_tree` → act → `diff_tree`. Chromium only.

| Tool | Purpose |
| --- | --- |
| `click_element` | Dispatch a real click at the matched node. Can submit and navigate — if it navigates, `diff_tree` says so instead of diffing. |
| `type_text` | Replace a text field's value (input/change events fire, so framework-controlled inputs register it). The result never echoes the typed text. |
| `focus_element` | Move real keyboard focus; reports whether the target is a text field so a `type_text` can follow. |

### One producer per surface

Every read above is built from **Chromium's own accessibility tree**, read over
CDP. It reaches structure no in-page walk can — most visibly a
`<video controls>`'s play/scrubber/mute controls, which live in a closed
user-agent shadow root — and it is the same tree the act tools target, so a node
you click by name can't come back in a report under another one.

That tree is **whole-document**, which is why no tool takes a `rootSelector`
except the one exception below. There is no `producer` parameter: each surface
has exactly one correct producer, so there was nothing left to choose.

**`get_tab_order` is the exception, and not a fallback.** Chromium's tree knows
whether a node is *focusable*, but not the *sequence*: `tabindex` never reaches a
native node, and ordering by it is DOM/layout work the AX tree doesn't expose.
So tab order is built from the in-page walk — the only source there is — and
`get_tab_order` is the one tool `rootSelector` still scopes.

Because a native tree carries no tab order, `inspect_page` has no tab-order
section at all. It doesn't print an empty one: an empty block reads as *nothing
on this page is focusable*, which is a very different claim from *not measured
here*. Call `get_tab_order` for the sequence.

Chromium only.

### Consistency & determinism

- **`inspect_page`** derives its findings, tree, and outline from a single
  extraction, so a report can't be internally inconsistent (e.g. an audit finding
  referencing a node the tree doesn't show) on a page that changes between
  separate calls. This is also why it carries no tab order: a second,
  DOM-derived read would describe a different instant.
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

Playwright is a peer dependency and a Chrome binary is required:

```bash
npx real-a11y install   # downloads Chrome for Testing, first time only
```

(`npx playwright install chromium` also works — `install` just sidesteps the version-mismatch pitfall that command can hit.) The server also honors `REAL_A11Y_CHROME_PATH` to launch a specific binary directly, and `REAL_A11Y_BROWSERS_DIR` to point at a non-default cache directory.

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

> **Scoping.** Reads are whole-document: they come from Chromium's own
> accessibility tree, which has no notion of a subtree to narrow to. Only
> `get_tab_order` and the tree checkpoints take a `rootSelector` — they run in
> the page, where a selector means something. Output is capped at 40,000
> characters so a large page can't blow the agent's context budget; the
> truncation note names the lever that tool actually has — a `rules` subset, a
> narrower `rootSelector` where one applies, or a smaller sibling read.

### Environment

| Var | Effect |
| --- | --- |
| `REAL_A11Y_MCP_CDP` | Attach to a running Chrome over CDP (e.g. `http://localhost:9222`) instead of launching one — audit pages behind a login you're already signed into. |
| `REAL_A11Y_MCP_HEADFUL` | `1` launches a visible browser instead of headless. Ignored under `REAL_A11Y_MCP_CDP` (the attached browser keeps its own window state); `open_page` reports which mode it's actually in. |
| `REAL_A11Y_MCP_ALLOW_FILE` | `1` permits auditing `file://` URLs. Off by default: an LLM-driven server that can open `file:///…/.env` and read the DOM back is a local-file exfiltration primitive. |
| `REAL_A11Y_MCP_STORAGE_STATE` | Path to a Playwright storage-state file — audit pages behind a login as that saved session. Create it out-of-band (e.g. `real-a11y login`); it's never a tool parameter, so session tokens never enter the agent's context. The server refuses to start if the file is missing or malformed. |
| `REAL_A11Y_MCP_ALLOWED_ORIGINS` | Comma-separated origins that auditing is restricted to when a storage state is loaded (origin pinning). **Strongly recommended** alongside `STORAGE_STATE`: without it, a redirect could audit an unintended site with your session. |
| `REAL_A11Y_MCP_MAX_SESSIONS` | Cap on concurrently live named sessions (default 4) — each session is its own browser, so this keeps a `session` typo from accumulating Chromiums. |
| `REAL_A11Y_MCP_SESSION_IDLE_TIMEOUT_MS` | Idle ms before all sessions close (default 900000 = 15 min; 0 disables; capped at 1 hour). The server stays up, the next call relaunches, and saved findings checkpoints survive — only `close_browser` discards those. |

Auth material is always operator-configured, never a tool parameter — the agent
just benefits from a session you set up. Use a dedicated low-privilege test
account, and keep the storage-state file out of version control.

## Programmatic use

For scripting audits without an MCP client, the route is the **CLI**, not a
library — `@real-a11y-dev/cli` runs the same engine and prints machine formats:

```sh
npx -y @real-a11y-dev/cli audit https://example.com --format json -o report.json
```

`snapshot` / `diff` gate a PR, `--session <name>` keeps one browser alive across
invocations, and `click` / `type` / `focus` / `interact` act on the page and
print the tree diff each action caused. Full reference:
<https://real-a11y.dev/packages/cli/commands>.

What that leaves out is an in-process Node API. `@real-a11y-dev/browser` — the
Playwright-backed session this server drives — was published through
`0.1.0-beta.13` and is workspace-internal from `0.1.0-beta.4` of this package
on, bundled into it, the CLI and the testing adapter, with nothing to install by
that name. This package still exports
`BrowserSession` and its session types (`A11ySession`, `BrowserSessionOptions`,
`PageSnapshot`, `SnapshotOptions`), because `buildServer` takes an `A11ySession`
and a custom `SessionManager` has to name that contract — an embedding surface
that arrives with the whole MCP SDK, not a standalone session package. If you
already hold a Playwright `Page`, `attach(page)` from
`@real-a11y-dev/testing/playwright` runs the same helpers against it.

## Status

Beta, published on npm. Part of the `@real-a11y-dev` family (`core`, `testing`,
`validate`, …); API and tool surface may still change before 1.0.
