---
title: "@real-a11y-dev/mcp — tools reference"
description: Every tool the Real A11y MCP server exposes — open_page, audit_page, the view tools, compare_producers — with parameters and examples.
---

# MCP tools reference

The Real A11y MCP server exposes **seventeen tools** to an MCP client (Claude Code, Claude Desktop, Cursor, and any other MCP-capable assistant). Each tool drives a real Chromium page and reports what a screen reader would actually perceive — computed roles, accessible names, and the defects assistive tech announces as broken — not what the HTML source claims.

The tools share **one** browser page. A typical run is [`open_page`](#open_page) → an audit or view tool ([`audit_page`](#audit_page), [`inspect_page`](#inspect_page), or a `get_*` view) → [`close_browser`](#close_browser). Because every tool reads the same mutable page, calls must run **sequentially, never in parallel** — a second call mid-flight would race the first's navigation.

Every audit and extraction tool takes an optional `rootSelector` (default `"body"`) that scopes the work to one region or component, and — except [`get_tab_order`](#get_tab_order) — a `producer` (`"dom"` default, or `"native"` for Chromium's own accessibility tree read over CDP). [`compare_producers`](#compare_producers) and any tool called with `producer: "native"` read the whole document (`rootSelector` must stay `"body"`). Tool output is capped at **40,000 characters** — a larger page is truncated with a note to narrow with `rootSelector`.

Server behavior is configured entirely through [environment variables](#environment) — saved-login sessions, origin pinning, `file://` access, CDP attach. Credentials are never tool parameters, so session tokens stay out of the agent's context. On startup the server validates that configuration and **refuses to start** on a malformed storage-state file or an invalid origin (see [Environment](#environment)).

## All tools at a glance

The **Producer** column shows which tools accept `producer: "native"` (Chromium's own tree over CDP, whole-document) versus the DOM walk. Click a tool for its parameters.

**Session**

| Tool | Purpose | Producer |
| --- | --- | --- |
| [`open_page`](#open_page) | Navigate to a URL and ready it for queries — call first. | — |
| [`close_browser`](#close_browser) | Tear down the browser session. | — |

**Audit**

| Tool | Purpose | Producer |
| --- | --- | --- |
| [`audit_page`](#audit_page) | Every accessibility violation, grouped with CSS locators + severity — the flagship. | `dom` · `native` |
| [`inspect_page`](#inspect_page) | Findings **plus** tree + outline + tab order from one extraction. | `dom` · `native` (tab order N/A) |

**Views**

| Tool | Purpose | Producer |
| --- | --- | --- |
| [`get_semantic_tree`](#get_semantic_tree) | Role + accessible-name tree — what a screen reader traverses. | `dom` · `native` |
| [`get_heading_outline`](#get_heading_outline) | Heading outline (h1–h6) in document order. | `dom` · `native` |
| [`get_tab_order`](#get_tab_order) | Focusable elements in keyboard Tab order. | `dom` only |
| [`list_elements`](#list_elements) | Every element of one category (link / button / form / landmark / image / heading). | `dom` · `native` (no locators) |

**Producer parity**

| Tool | Purpose | Producer |
| --- | --- | --- |
| [`compare_producers`](#compare_producers) | Diff the DOM producer against the native producer — a fidelity oracle. | reads both |

**Findings checkpoints**

| Tool | Purpose | Producer |
| --- | --- | --- |
| [`checkpoint_findings`](#checkpoint_findings) | Snapshot the page's findings under a name (survives navigation). | — |
| [`diff_findings`](#diff_findings) | Re-snapshot the page and diff it against a checkpoint: new / changed / fixed. | — |
| [`diff_checkpoints`](#diff_checkpoints) | Diff two already-stored checkpoints (no re-snapshot). | — |
| [`list_checkpoints`](#list_checkpoints) | List stored checkpoint labels with finding counts. | — |
| [`export_checkpoint`](#export_checkpoint) | Export a checkpoint as a snapshot JSON artifact (CLI-compatible). | — |
| [`import_checkpoint`](#import_checkpoint) | Load an external snapshot artifact as a checkpoint. | — |

**Tree checkpoints**

| Tool | Purpose | Producer |
| --- | --- | --- |
| [`checkpoint_tree`](#checkpoint_tree) | Capture the current tree as an interaction-diff baseline (page-bound). | — |
| [`diff_tree`](#diff_tree) | Diff the tree since `checkpoint_tree` — what an interaction changed. | — |

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
- **`producer`** — `"dom"` \| `"native"` — optional (default `"dom"`) — which producer builds the tree. `"native"` audits **Chromium's own accessibility tree** (read over CDP) instead of the in-page DOM walk, reaching structure no in-page walk can — most visibly a `<video controls>`'s user-agent-shadow media controls. Native is whole-document, so `rootSelector` must stay `"body"` (any other value is refused). Chromium only.

An agent calls this to get the full defect list, or narrows it — e.g. audit only the cookie-consent dialog for labeling:

```json
{ "rootSelector": "[role=dialog]", "rules": ["dialog-labeled", "no-unlabeled-interactive"] }
```

Or audits the native tree to catch what the DOM walk can't reach (e.g. a media player's controls):

```json
{ "producer": "native" }
```

### `inspect_page`

*Read-only · scoped by `rootSelector` · prefer on dynamic pages.*

Return the audit findings **and** the semantic tree, heading outline, and tab order — all derived from **one** extraction, so they are guaranteed to describe the same instant. The element focused at capture time is marked `[focused]` in each view, so the agent can see, e.g., that opening a dialog moved focus into it. Prefer this over separate [`audit_page`](#audit_page) + `get_*` calls on moving pages (SPAs, pages with consent dialogs), where each separate call could catch a different state.

Parameters:

- **`rootSelector`** — string — optional (default `"body"`) — CSS selector for the extraction root.
- **`rules`** — array of the five rule ids above — optional — subset for the findings section. Omit to run all.
- **`includeGeneric`** — boolean — optional (default `false`) — include generic container nodes (`role=generic`) in the tree.
- **`producer`** — `"dom"` \| `"native"` — optional (default `"dom"`) — build the snapshot from Chromium's own accessibility tree (findings + tree + outline). A native tree carries no tab order, so that section reports N/A; `rootSelector` must stay `"body"`. Chromium only.

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
- **`producer`** — `"dom"` \| `"native"` — optional (default `"dom"`) — `"native"` returns Chromium's own accessibility tree (read over CDP), whole-document (`rootSelector` must stay `"body"`). This is how you *view* the native tree.

An agent calls this to reason about page structure or diff it against another rendering.

### `get_heading_outline`

*Read-only · scoped by `rootSelector`.*

Return the heading outline (`h1`–`h6` in document order) as an indented list — the structure a screen-reader user navigates by heading.

Parameters:

- **`rootSelector`** — string — optional (default `"body"`).
- **`producer`** — `"dom"` \| `"native"` — optional (default `"dom"`) — `"native"` derives the outline from Chromium's own accessibility tree, whole-document (`rootSelector` must stay `"body"`).

An agent calls this to flag skipped levels or a missing/duplicate `h1`.

### `get_tab_order`

*Read-only · scoped by `rootSelector`.*

Return the focusable elements in the order a keyboard user reaches them with Tab — numbered, each with role + accessible name. The stop focused at capture time is marked `[focused]`. Surfaces focus traps, illogical order, and unreachable controls.

Parameters:

- **`rootSelector`** — string — optional (default `"body"`).

**DOM-only** — a native tree carries no tab order, so this tool takes no `producer`. An agent calls this to check keyboard operability of a form or menu.

### `list_elements`

*Read-only · scoped by `rootSelector`.*

List every element of one category as role + accessible name + CSS locator — a focused view of one kind of element (e.g. `image` pairs with the `image-alt` rule, `form` with labeling).

Parameters:

- **`filter`** — `"heading"` \| `"link"` \| `"button"` \| `"form"` \| `"landmark"` \| `"image"` — **required** — the category to list.
- **`rootSelector`** — string — optional (default `"body"`).
- **`producer`** — `"dom"` \| `"native"` — optional (default `"dom"`) — `"native"` lists from Chromium's own accessibility tree, whole-document (`rootSelector` must stay `"body"`; native nodes carry no CSS locator).

An agent calls this to review one element type without pulling the whole tree:

```json
{ "filter": "image", "rootSelector": "main" }
```

## Findings checkpoints

Give the agent the CLI's snapshot + diff power mid-session: capture the page's findings under a name, change something (deploy, feature toggle, DOM edit), then ask what's **new / changed / fixed** — with the same `v1:` fingerprint identity the CI a11y-diff bot uses. Checkpoints are held in memory (LRU-capped at 20) and **survive navigation by design**, so you can checkpoint one deploy and diff another. `close_browser` clears the store.

These capture the accessibility _problems_. To capture the tree _structure_ and diff what an interaction changed, see [tree checkpoints](#tree-checkpoints) — which are bound to the page instance and do not survive navigation.

### `checkpoint_findings`

_Snapshots the current page into the named store._

Snapshot the current page's accessibility findings and store them under `name`; re-saving a name overwrites it. Fingerprints go through the same `buildSnapshotPage` the CLI's `snapshot` command uses, so a checkpoint is directly comparable to a CI baseline.

Parameters:

- **`name`** — string — required — the checkpoint label (the store key).
- **`rootSelector`** — string — optional (default `"body"`) — CSS selector for the snapshot root.
- **`rules`** — array of the five rule ids — optional — subset for the findings. Omit to run all.

### `diff_findings`

_Read-only · re-snapshots the current page and diffs it against a stored checkpoint._

Re-snapshot the current page and diff it against checkpoint `name`: which findings are **NEW** (the only class that gates CI), **CHANGED**, or **FIXED**, plus an advisory structural summary. Use after a change, or after navigating to a different deploy of the same page.

Parameters:

- **`name`** — string — required — the checkpoint to diff against.
- **`rootSelector`** — string — optional (default `"body"`).

The headline cross-deploy workflow — diff prod against a preview in one session:

```json
// open_page("https://example.com")       → checkpoint_findings({ "name": "prod" })
// open_page("https://preview.example.com") → diff_findings({ "name": "prod" })
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

## Tree checkpoints

Where the [findings checkpoints](#findings-checkpoints) answer _"what accessibility problems changed?"_, these answer _"what did that interaction change?"_ — the precise structural delta of a click, a keypress, or a dialog opening.

The two are deliberately different in lifetime. A snapshot checkpoint is pure data and **survives navigation**. A tree checkpoint holds the extracted tree **inside the page** — its node identities are bound to that page instance — so it is **discarded the moment the page navigates**. Capture, interact, diff, all within one page load.

### `checkpoint_tree`

_Captures the current tree in the page as a comparison point._

Capture the current accessibility tree as the baseline for an interaction diff. Then interact with the page and call [`diff_tree`](#diff_tree). Re-capturing re-baselines.

Parameters:

- **`rootSelector`** — string — optional (default `"body"`) — CSS selector for the extraction root.

### `diff_tree`

_Read-only · diffs the live tree against the checkpoint._

Diff the current accessibility tree against the one captured by `checkpoint_tree`: which nodes were **added**, **removed**, or **changed**, plus a `focus:` line when focus moved. This is what makes an interaction's effect legible — e.g. that opening a dialog added a `dialog` node _and_ moved focus into it, or that a "Load more" button appended twelve links but left focus stranded.

Parameters:

- **`rootSelector`** — string — optional — CSS root for the re-extraction. **Defaults to the root the checkpoint was captured with**, so the diff stays like-for-like instead of silently widening to `body` and reporting the rest of the page as added.

Errors if no checkpoint exists on the current page — including after a navigation, which discards it.

## Producer parity

A Chromium-only fidelity oracle that compares the two producers. To *view* the native tree, use [`get_semantic_tree`](#get_semantic_tree) with `producer: "native"`; to *audit* it, [`audit_page`](#audit_page) with `producer: "native"`.

### `compare_producers`

*Read-only · whole document · Chromium only.*

Diff the **DOM producer's** tree against the **native producer's** (Chromium's own tree over CDP) and report where they disagree on role or accessible name — a fidelity oracle that surfaces DOM-engine gaps (e.g. an unlabeled input the DOM engine names by its typed value) and structure only the native tree reaches (media controls). Compares only name-bearing roles, order- and indent-insensitively; matching nodes are omitted. Some "only in native" entries are iframe / shadow-DOM / user-agent-shadow content the DOM walk doesn't traverse, not name bugs.

This is a **producer** diff (dom vs native at one instant) — distinct from [`diff_checkpoints`](#diff_checkpoints), which diffs two checkpoints **over time**.

Parameters: none.

An agent calls this to sanity-check the DOM producer before trusting a surprising finding, or to decide whether a page needs the native producer.

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
