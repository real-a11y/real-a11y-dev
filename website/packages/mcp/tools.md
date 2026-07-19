---
title: "@real-a11y-dev/mcp — tools reference"
description: Every tool the Real A11y MCP server exposes — open_page, audit_page, the view tools, compare_trees — with parameters and examples.
---

# MCP tools reference

The Real A11y MCP server exposes **ten tools** to an MCP client (Claude Code, Claude Desktop, Cursor, and any other MCP-capable assistant). Each tool drives a real Chromium page and reports what a screen reader would actually perceive — computed roles, accessible names, and the defects assistive tech announces as broken — not what the HTML source claims.

The tools share **one** browser page. A typical run is [`open_page`](#open_page) → an audit or view tool ([`audit_page`](#audit_page), [`inspect_page`](#inspect_page), or a `get_*` view) → [`close_browser`](#close_browser). Because every tool reads the same mutable page, calls must run **sequentially, never in parallel** — a second call mid-flight would race the first's navigation.

Every audit and extraction tool takes an optional `rootSelector` (default `"body"`) that scopes the work to one region or component. The two native-tree tools ([`get_native_tree`](#get_native_tree), [`compare_trees`](#compare_trees)) read the whole document and take no arguments. Tool output is capped at **40,000 characters** — a larger page is truncated with a note to narrow with `rootSelector`.

Server behavior is configured entirely through [environment variables](#environment) — saved-login sessions, origin pinning, `file://` access, CDP attach. Credentials are never tool parameters, so session tokens stay out of the agent's context. On startup the server validates that configuration and **refuses to start** on a malformed storage-state file or an invalid origin (see [Environment](#environment)).

## Session

Bracket every audit with these two. `open_page` navigates and readies the page; `close_browser` tears the browser down.

### `open_page`

*Session · mutates the shared page · call first.*

Navigate the browser to a URL and inject the extraction engine so the page is ready for queries. On dynamic sites (SPAs, consent dialogs) set `waitUntil: "networkidle"` and/or `settleMs` so the page settles before extraction. Pass `device` to audit the **mobile or tablet** layout — which can differ substantially from desktop (a `menubar` collapses to a hamburger `button`, content is hidden or reordered).

Parameters:

- **`url`** — string (absolute URL) — **required** — the page to open. Only `http`, `https`, and `data:` are allowed; `file://` is refused unless [`REAL_A11Y_MCP_ALLOW_FILE=1`](#real-a11y-mcp-allow-file).
- **`waitUntil`** — `"load"` \| `"domcontentloaded"` \| `"networkidle"` \| `"commit"` — optional (default `"load"`) — navigation wait state. `"networkidle"` is the most reliable "the SPA finished rendering" signal, at the cost of latency.
- **`settleMs`** — integer, 0–15000 — optional (default `0`) — extra fixed wait after the wait state for late JS and consent dialogs to settle.
- **`timeoutMs`** — integer, 0–120000 — optional (default `30000`) — navigation timeout.
- **`device`** — string — optional — a Playwright device name (`"iPhone 13"`, `"Pixel 7"`, `"iPad Pro 11"`) to emulate. Omit for desktop. Not supported over [`REAL_A11Y_MCP_CDP`](#real-a11y-mcp-cdp).
- **`viewport`** — object `{ width: integer, height: integer }` (both positive) — optional — explicit viewport override, layered on top of `device`.

An agent calls this before any other tool, e.g. to open a signup flow's mobile layout before auditing it:

```json
{ "url": "https://example.com/signup", "waitUntil": "networkidle", "settleMs": 500, "device": "iPhone 13" }
```

### `close_browser`

*Session · tears down the browser · takes no arguments.*

Close the browser session and free resources. Over a CDP attach it closes only the tab the server created and disconnects — it never closes the user's own Chrome or their other tabs.

Parameters: none.

## Audit

The reason the server exists. Both tools report violations a screen reader would announce; [`inspect_page`](#inspect_page) adds the three views from the same extraction.

### `audit_page`

*Read-only · scoped by `rootSelector` · the primary tool.*

Run the accessibility rules against the current page and return every violation — unlabeled interactive controls, images missing alt text, skipped/missing/duplicate heading levels, unlabeled dialogs, and broken landmark structure. Findings come back grouped and counted (so "17 unlabeled links" is one row, each with its CSS locator) plus a machine-readable JSON block.

Parameters:

- **`rootSelector`** — string — optional (default `"body"`) — CSS selector for the audit root.
- **`rules`** — array of `"no-unlabeled-interactive"` \| `"image-alt"` \| `"heading-order"` \| `"dialog-labeled"` \| `"landmark-structure"` — optional — a subset of rules to run. Omit to run all.

An agent calls this to get the full defect list, or narrows it — e.g. audit only the cookie-consent dialog for labeling:

```json
{ "rootSelector": "[role=dialog]", "rules": ["dialog-labeled", "no-unlabeled-interactive"] }
```

### `inspect_page`

*Read-only · scoped by `rootSelector` · prefer on dynamic pages.*

Return the audit findings **and** the semantic tree, heading outline, and tab order — all derived from **one** extraction, so they are guaranteed to describe the same instant. The element focused at capture time is marked `[focused]` in each view, so the agent can see, e.g., that opening a dialog moved focus into it. Prefer this over separate [`audit_page`](#audit_page) + `get_*` calls on moving pages (SPAs, pages with consent dialogs), where each separate call could catch a different state.

Parameters:

- **`rootSelector`** — string — optional (default `"body"`) — CSS selector for the extraction root.
- **`rules`** — array of the five rule ids above — optional — subset for the findings section. Omit to run all.
- **`includeGeneric`** — boolean — optional (default `false`) — include generic container nodes (`role=generic`) in the tree.

An agent calls this for a consistent whole-page picture in a single round-trip:

```json
{ "rootSelector": "main", "includeGeneric": false }
```

## Views

Token-efficient perception primitives — the individual slices of what a screen reader traverses. All are read-only and scoped by `rootSelector`.

### `get_semantic_tree`

*Read-only · scoped by `rootSelector`.*

Return the page's accessibility tree as a deterministic, indented role + accessible-name outline — what a screen reader would traverse. The element focused at capture time is marked `[focused]`. Stable across runs and token-efficient.

Parameters:

- **`rootSelector`** — string — optional (default `"body"`).
- **`includeGeneric`** — boolean — optional (default `false`) — include generic container nodes (`role=generic`).

An agent calls this to reason about page structure or diff it against another rendering.

### `get_heading_outline`

*Read-only · scoped by `rootSelector`.*

Return the heading outline (`h1`–`h6` in document order) as an indented list — the structure a screen-reader user navigates by heading.

Parameters:

- **`rootSelector`** — string — optional (default `"body"`).

An agent calls this to flag skipped levels or a missing/duplicate `h1`.

### `get_tab_order`

*Read-only · scoped by `rootSelector`.*

Return the focusable elements in the order a keyboard user reaches them with Tab — numbered, each with role + accessible name. The stop focused at capture time is marked `[focused]`. Surfaces focus traps, illogical order, and unreachable controls.

Parameters:

- **`rootSelector`** — string — optional (default `"body"`).

An agent calls this to check keyboard operability of a form or menu.

### `list_elements`

*Read-only · scoped by `rootSelector`.*

List every element of one category as role + accessible name + CSS locator — a focused view of one kind of element (e.g. `image` pairs with the `image-alt` rule, `form` with labeling).

Parameters:

- **`filter`** — `"heading"` \| `"link"` \| `"button"` \| `"form"` \| `"landmark"` \| `"image"` — **required** — the category to list.
- **`rootSelector`** — string — optional (default `"body"`).

An agent calls this to review one element type without pulling the whole tree:

```json
{ "filter": "image", "rootSelector": "main" }
```

## Checkpoints

Give the agent the CLI's snapshot + diff power mid-session: capture the page's findings under a name, change something (deploy, feature toggle, DOM edit), then ask what's **new / changed / fixed** — with the same `v1:` fingerprint identity the CI a11y-diff bot uses. Checkpoints are held in memory (LRU-capped at 20) and **survive navigation by design**, so you can checkpoint one deploy and diff another. `close_browser` clears the store. (Unlike Axis-A tree-checkpoints, these are pure data — not bound to the page instance that was live when saved.)

### `save_checkpoint`

_Snapshots the current page into the named store._

Snapshot the current page's accessibility findings and store them under `name`; re-saving a name overwrites it. Fingerprints go through the same `buildSnapshotPage` the CLI's `snapshot` command uses, so a checkpoint is directly comparable to a CI baseline.

Parameters:

- **`name`** — string — required — the checkpoint label (the store key).
- **`rootSelector`** — string — optional (default `"body"`) — CSS selector for the snapshot root.
- **`rules`** — array of the five rule ids — optional — subset for the findings. Omit to run all.

### `diff_checkpoint`

_Read-only · re-snapshots the current page and diffs it against a stored checkpoint._

Re-snapshot the current page and diff it against checkpoint `name`: which findings are **NEW** (the only class that gates CI), **CHANGED**, or **FIXED**, plus an advisory structural summary. Use after a change, or after navigating to a different deploy of the same page.

Parameters:

- **`name`** — string — required — the checkpoint to diff against.
- **`rootSelector`** — string — optional (default `"body"`).

The headline cross-deploy workflow — diff prod against a preview in one session:

```json
// open_page("https://example.com")       → save_checkpoint({ "name": "prod" })
// open_page("https://preview.example.com") → diff_checkpoint({ "name": "prod" })
```

### `diff_checkpoints`

_Read-only · diffs two stored checkpoints._

Diff two already-stored checkpoints against each other (no re-snapshot): which findings are new / changed / fixed going from `base` to `head`.

Parameters:

- **`base`** — string — required.
- **`head`** — string — required.

### `list_checkpoints`

_Read-only._

List the stored checkpoint labels with their finding counts and approximate tree sizes. No parameters.

### `export_checkpoint`

_Read-only._

Return a stored checkpoint as a Real A11y snapshot artifact — the same `a11y-snapshot.json` the CLI writes (same `schemaVersion`, same fingerprints). Persist it to your own file to diff across sessions, or feed it to the CI a11y-diff. Output is capped, so it is best for small roots.

Parameters:

- **`name`** — string — required.

### `import_checkpoint`

_Loads an external artifact into the store._

Load an externally-held Real A11y snapshot artifact (e.g. a CLI-generated baseline) into the store under `name`, so a live page can be diffed against it. Input is validated strictly; the artifact's first page is stored.

Parameters:

- **`name`** — string — required — the label to store it under.
- **`artifact`** — string — required — a serialized Real A11y snapshot artifact (JSON).

## Native cross-check

Chromium-only fidelity oracles. Both read the whole document, take no arguments, and compare Real A11y's custom engine against the browser's own computation.

### `get_native_tree`

*Read-only · whole document · Chromium only.*

Return Chromium's **own** accessibility tree — computed by Blink, read via CDP — as role + accessible name. This is the browser's authoritative tree, not Real A11y's custom extraction.

Parameters: none.

An agent calls this to see what the browser itself exposes, independent of the custom engine.

### `compare_trees`

*Read-only · whole document · Chromium only.*

Diff Real A11y's custom tree against Chromium's native tree and report where they disagree on role or accessible name — a fidelity oracle that surfaces custom-engine bugs (e.g. an unlabeled input the custom engine names by its typed value). Compares only name-bearing roles, order- and indent-insensitively; matching nodes are omitted. Some "only in native" entries are iframe/shadow-DOM content the custom engine doesn't traverse, not name bugs.

Parameters: none.

An agent calls this to sanity-check the engine before trusting a surprising finding.

## Environment

Set these on the server process — most clients accept an `"env"` object alongside `command` / `args`. All are read by the stdio entry point at startup; the storage-state and origin values are **validated before the server accepts any tool call**.

### `REAL_A11Y_MCP_CDP`

*string (URL) · optional.*

Attach to an already-running Chrome over the DevTools protocol (e.g. `http://localhost:9222`) instead of launching a fresh browser — the interactive way to audit a login. Device/viewport emulation is **not** available over CDP (it reuses the running browser's own context). Use a throwaway profile, not your everyday Chrome:

```sh
chrome --remote-debugging-port=9222 --user-data-dir=/tmp/a11y-cdp
```

### `REAL_A11Y_MCP_HEADFUL`

*`"1"` · optional.*

Set to `1` to launch a visible browser instead of headless. Ignored when [`REAL_A11Y_MCP_CDP`](#real-a11y-mcp-cdp) is set.

### `REAL_A11Y_MCP_ALLOW_FILE`

*`"1"` · optional.*

Set to `1` to permit auditing `file://` URLs. Off by default — an agent that can open `file:///…/.env` and read the DOM back is a local-file exfiltration risk. `data:` URLs are always allowed (caller-supplied inline content, not a filesystem read).

### `REAL_A11Y_MCP_STORAGE_STATE`

*string (path) · optional.*

Path to a saved login session — a Playwright storage-state JSON (cookies + origin storage) — loaded into every launched context so pages open already authenticated. Create it out-of-band (e.g. the CLI's `login` helper); it is **never** a tool parameter, so session tokens stay out of the agent's context. When set, [`open_page`](#open_page) tells the agent the session is active so it won't try to log in. At startup the server verifies the path is a readable file containing a valid storage-state shape (`"cookies"` / `"origins"`) and refuses to start otherwise; errors quote the path only, never its contents. Cannot be combined with [`REAL_A11Y_MCP_CDP`](#real-a11y-mcp-cdp) (a CDP connection carries its own session).

### `REAL_A11Y_MCP_ALLOWED_ORIGINS`

*comma-separated origins · optional.*

Origins that auditing is pinned to — enforced on the **final** URL after redirects, so a redirect can't route to an unintended site. The pin applies **whenever this variable is set**, with or without a loaded session. It's strongly recommended alongside [`REAL_A11Y_MCP_STORAGE_STATE`](#real-a11y-mcp-storage-state) — and the server prints a startup warning if a session is loaded _without_ it — but the pin itself doesn't depend on a session. Each entry is normalized to its origin at startup, and an invalid value refuses to start.

```json
{
  "env": {
    "REAL_A11Y_MCP_STORAGE_STATE": "/absolute/path/to/auth.json",
    "REAL_A11Y_MCP_ALLOWED_ORIGINS": "https://app.example.com,https://admin.example.com"
  }
}
```

::: tip Proxy
There is no `REAL_A11Y_MCP_PROXY` variable — Chromium doesn't honor `HTTP_PROXY`/`HTTPS_PROXY` on its own, and a proxy is a **programmatic** `BrowserSession` constructor option, not read from the environment by the stdio server. Configure it only if you embed `BrowserSession` directly.
:::
