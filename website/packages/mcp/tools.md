---
title: "@real-a11y-dev/mcp — tools reference"
description: Every tool the Real A11y MCP server exposes — open_page, audit_page, the view tools, the checkpoint tools, the act tools — with parameters and examples.
---

# MCP tools reference

The Real A11y MCP server exposes **twenty tools** to an MCP client (Claude Code, Claude Desktop, Cursor, and any other MCP-capable assistant). Each tool drives a real Chromium page and reports what a screen reader would actually perceive — computed roles, accessible names, and the defects assistive tech announces as broken — not what the HTML source claims.

Every page tool takes an optional **`session`** — a name (1–32 characters from `A–Z a–z 0–9 _ -`) selecting an independent live page with its own findings checkpoints and tree checkpoint. Omit it everywhere and the server behaves as a single-page tool (the `default` session). A typical run is [`open_page`](#open-page) → an audit or view tool ([`audit_page`](#audit-page), [`inspect_page`](#inspect-page), or a `get_*` view) → [`close_browser`](#close-browser). To interact, the loop is [`checkpoint_tree`](#checkpoint-tree) → an [act tool](#act) ([`click_element`](#click-element), [`type_text`](#type-text), [`focus_element`](#focus-element)) → [`diff_tree`](#diff-tree). Calls within one session are **serialized automatically** (a second call waits its turn instead of racing the first's navigation); different sessions run in parallel, each in its own browser. Sessions launch lazily on first use, are capped by [`REAL_A11Y_MCP_MAX_SESSIONS`](#real-a11y-mcp-max-sessions), and close on the [idle timeout](#real-a11y-mcp-session-idle-timeout-ms) or [`close_browser`](#close-browser). The `session` name selects a page context only — auth stays [operator-configured](#environment) and identical across sessions, never a tool parameter.

Every read is built from **Chromium's own accessibility tree**, read over CDP. There is no `producer` parameter: each surface has exactly one correct producer, so there is nothing to choose. That tree is whole-document, so the audit and view tools take no `rootSelector` — the exceptions are [`get_tab_order`](#get-tab-order) and the tree checkpoints, which run in the page, where a selector means something. Tool output is capped at **40,000 characters**; a larger page is truncated with a note naming the lever that tool actually has — a `rules` subset, a narrower `rootSelector` where one applies, or a smaller sibling read such as [`get_heading_outline`](#get-heading-outline). [`export_checkpoint`](#export-checkpoint) is the one exception: a JSON artifact can't be truncated and stay parseable, so it fails instead.

Server behavior is configured entirely through [environment variables](#environment) — saved-login sessions, origin pinning, `file://` access, CDP attach. Credentials are never tool parameters, so session tokens stay out of the agent's context. On startup the server validates that configuration and **refuses to start** on a malformed storage-state file or an invalid origin (see [Environment](#environment)).

## All tools at a glance

Click a tool for its parameters.

**Session**

<!-- surface:begin mcp-tools-session -->

| Tool | Purpose |
| --- | --- |
| [`open_page`](#open-page) | Navigate to a URL and ready it for queries — call first. |
| [`close_browser`](#close-browser) | Close one named browser session, or all of them. |
| [`list_sessions`](#list-sessions) | List the live named sessions — URL, busy state, timestamps. |

<!-- surface:end mcp-tools-session -->

**Audit**

<!-- surface:begin mcp-tools-audit -->

| Tool | Purpose |
| --- | --- |
| [`audit_page`](#audit-page) | Every accessibility violation, grouped with CSS locators + severity — the flagship. |
| [`inspect_page`](#inspect-page) | Findings **plus** tree + outline from one read. |

<!-- surface:end mcp-tools-audit -->

**Views**

<!-- surface:begin mcp-tools-views -->

| Tool | Purpose |
| --- | --- |
| [`get_semantic_tree`](#get-semantic-tree) | Role + accessible-name tree — what a screen reader traverses. |
| [`get_heading_outline`](#get-heading-outline) | Heading outline (h1–h6) in document order. |
| [`get_tab_order`](#get-tab-order) | Focusable elements in keyboard Tab order — the one in-page read. |
| [`list_elements`](#list-elements) | Every element of one category (link / button / form / landmark / image / heading). |

<!-- surface:end mcp-tools-views -->

**Findings checkpoints**

<!-- surface:begin mcp-tools-findings-checkpoints -->

| Tool | Purpose |
| --- | --- |
| [`checkpoint_findings`](#checkpoint-findings) | Snapshot the page's findings under a name (survives navigation). |
| [`diff_findings`](#diff-findings) | Re-snapshot the page and diff it against a checkpoint: new / changed / fixed. |
| [`diff_checkpoints`](#diff-checkpoints) | Diff two already-stored checkpoints (no re-snapshot). |
| [`list_checkpoints`](#list-checkpoints) | List stored checkpoint labels with finding counts. |
| [`export_checkpoint`](#export-checkpoint) | Export a checkpoint as a snapshot JSON artifact (CLI-compatible). |
| [`import_checkpoint`](#import-checkpoint) | Load an external snapshot artifact as a checkpoint. |

<!-- surface:end mcp-tools-findings-checkpoints -->

**Tree checkpoints**

<!-- surface:begin mcp-tools-tree-checkpoints -->

| Tool | Purpose |
| --- | --- |
| [`checkpoint_tree`](#checkpoint-tree) | Capture the current tree as an interaction-diff baseline (page-bound). |
| [`diff_tree`](#diff-tree) | Diff the tree since `checkpoint_tree` — what an interaction changed. |

<!-- surface:end mcp-tools-tree-checkpoints -->

**Act**

<!-- surface:begin mcp-tools-act -->

| Tool | Purpose |
| --- | --- |
| [`click_element`](#click-element) | Real click at the node matched by role + accessible name. |
| [`type_text`](#type-text) | Replace a text field's value; the result never echoes the text. |
| [`focus_element`](#focus-element) | Move real keyboard focus; flags text fields for a follow-up `type_text`. |

<!-- surface:end mcp-tools-act -->

## Session

Bracket every audit with these. `open_page` navigates and readies a page; `close_browser` tears sessions down; `list_sessions` shows what is live. Every page tool's optional **`session`** parameter names which live page it operates on — see the [overview](#mcp-tools-reference) for the semantics.

### `open_page`

*Session · mutates its session's page · call first.*

Navigate the browser to a URL and inject the extraction engine so the page is ready for queries. On dynamic sites (SPAs, consent dialogs) set `waitUntil: "networkidle"` and/or `settleMs` so the page settles before extraction. Pass `device` to audit the **mobile or tablet** layout — which can differ substantially from desktop (a `menubar` collapses to a hamburger `button`, content is hidden or reordered).

Parameters:

- **`url`** — string (absolute URL) — **required** — the page to open. Only `http`, `https`, and `data:` are allowed; `file://` is refused unless [`REAL_A11Y_MCP_ALLOW_FILE=1`](#real-a11y-mcp-allow-file).
- **`waitUntil`** — `"load"` \| `"domcontentloaded"` \| `"networkidle"` \| `"commit"` — optional (default `"load"`) — navigation wait state. `"networkidle"` is the most reliable "the SPA finished rendering" signal, at the cost of latency.
- **`settleMs`** — integer, 0–15000 — optional (default `0`) — extra fixed wait after the wait state for late JS and consent dialogs to settle.
- **`timeoutMs`** — integer, 0–120000 — optional (default `30000`) — navigation timeout.
- **`device`** — string — optional — a Playwright device name (`"iPhone 13"`, `"Pixel 7"`, `"iPad Pro 11"`) to emulate. Omit for desktop. Not supported over [`REAL_A11Y_MCP_CDP`](#real-a11y-mcp-cdp).
- **`viewport`** — object `{ width: integer, height: integer }` (both positive) — optional — explicit viewport override, layered on top of `device`.
- **`session`** — string, `1–32` characters from `A–Z a–z 0–9 _ -` — optional (default `"default"`) — the named session to open the page in. Every page tool takes this parameter with the same meaning; it is documented once here.

An agent calls this before any other tool, e.g. to open a signup flow's mobile layout before auditing it:

```json
{ "url": "https://example.com/signup", "waitUntil": "networkidle", "settleMs": 500, "device": "iPhone 13" }
```

The reply reports the resolved URL, the page title, any device/viewport emulation, and the **browser mode** — headless is the default, so without that line a human watching for a window concludes the browser never opened; over a CDP attach it reports the attach instead, since the window belongs to the browser it joined.

The tool description also states the **session** state, because an agent that can't tell whether it's looking at a logged-out page will either try to log in or misreport what it audited. Three cases:

| Server started with | What the agent is told |
| --- | --- |
| [`REAL_A11Y_MCP_STORAGE_STATE`](#real-a11y-mcp-storage-state) | Pages open **already authenticated** — don't visit a login page. |
| [`REAL_A11Y_MCP_CDP`](#real-a11y-mcp-cdp) | Pages inherit whatever sessions **that** browser holds — check what you got. If it's logged out, only the human at that window can sign in; no variable changes it. |
| neither | Pages behind auth open **logged out** — here are the two variables that fix it. |

The CDP row is its own case rather than a flavour of "unauthenticated": an attach never carries a storage state (the two are mutually exclusive), yet it reuses the attached browser's own context, so its pages usually *are* signed in. Telling that agent to restart with `REAL_A11Y_MCP_CDP` would prescribe the setup already in force.

In all three, there is deliberately **no credential parameter** — auth is operator-configured so session tokens never enter the agent's context.

### `close_browser`

*Session · tears sessions down.*

Close a named browser session and free its resources, or every live session at once. Over a CDP attach it closes only the tabs the server created and disconnects — it never closes the user's own Chrome or their other tabs.

Closing a session also **discards that session's saved findings checkpoints** — [`export_checkpoint`](#export-checkpoint) anything that needs to outlive it first.

Parameters:

- **`session`** — string — optional (default `"default"`) — the session to close. Closing a session that isn't open reports that rather than failing.
- **`all`** — boolean — optional (default `false`) — close **every** live session instead of just one.

### `list_sessions`

*Session · read-only · takes no arguments.*

List every live named session: its name, current URL (redacted the same way the CLI's `session list` redacts), whether a call is running on it right now, and created / last-used timestamps. Sessions are created lazily by the first tool call that names them, so an empty list just means nothing has opened a page yet.

Parameters: none.

## Audit

The reason the server exists. Both tools report violations a screen reader would announce; [`inspect_page`](#inspect-page) adds the three views from the same extraction.

### `audit_page`

*Read-only · whole-document · the primary tool.*

Run the accessibility rules against the current page and return every violation — unlabeled interactive controls, images missing alt text, skipped/missing/duplicate heading levels, unlabeled dialogs, and broken landmark structure. Findings come back grouped and counted (so "17 unlabeled links" is one row, each with its CSS locator) plus a machine-readable JSON block.

Parameters:

- **`rules`** — array of `"no-unlabeled-interactive"` \| `"image-alt"` \| `"heading-order"` \| `"dialog-labeled"` \| `"landmark-structure"` — optional — a subset of rules to run. Omit to run all.

Audits **Chromium's own accessibility tree**, read over CDP, so it reaches structure no in-page walk can — most visibly a `<video controls>`'s user-agent-shadow media controls. Findings carry CSS locators, so that reach costs nothing in actionability. Whole-document; Chromium only.

An agent calls this to get the full defect list, or narrows it to the rules it cares about:

```json
{ "rules": ["dialog-labeled", "no-unlabeled-interactive"] }
```

### `inspect_page`

*Read-only · whole-document · prefer on dynamic pages.*

Return the audit findings **and** the semantic tree and heading outline — all derived from **one** read, so they are guaranteed to describe the same instant. The element focused at capture time is marked `[focused]`, so the agent can see, e.g., that opening a dialog moved focus into it. Prefer this over separate [`audit_page`](#audit-page) + `get_*` calls on moving pages (SPAs, pages with consent dialogs), where each separate call could catch a different state.

There is **no tab-order section**: the tree this reads carries none, and printing an empty block would read as *nothing on this page is focusable* — a very different claim from *not measured here*. Call [`get_tab_order`](#get-tab-order) for the keyboard sequence.

Parameters:

- **`rules`** — array of the five rule ids above — optional — subset for the findings section. Omit to run all.
- **`includeGeneric`** — boolean — optional (default `false`) — include generic container nodes (`role=generic`) in the tree.

An agent calls this for a consistent whole-page picture in a single round-trip:

```json
{ "includeGeneric": false }
```

## Views

Token-efficient perception primitives — the individual slices of what a screen reader traverses. All are read-only. All read Chromium's own tree (whole-document) except [`get_tab_order`](#get-tab-order).

### `get_semantic_tree`

*Read-only · whole-document.*

Return the page's accessibility tree as a deterministic, indented role + accessible-name outline — what a screen reader would traverse — read from **Chromium's own accessibility tree** over CDP. The element focused at capture time is marked `[focused]`. Stable across runs and token-efficient.

This is the vocabulary the [act tools](#act) target in, so a node you aim at by role + name here is the same node they dispatch against.

Parameters:

- **`includeGeneric`** — boolean — optional (default `false`) — include generic container nodes (`role=generic`).

An agent calls this to reason about page structure or diff it against another rendering.

### `get_heading_outline`

*Read-only · whole-document · takes no parameters.*

Return the heading outline (`h1`–`h6` in document order) as an indented list — the structure a screen-reader user navigates by heading. Derived from Chromium's own accessibility tree.

An agent calls this to flag skipped levels or a missing/duplicate `h1`.

### `get_tab_order`

*Read-only · the one in-page read · the one tool `rootSelector` scopes.*

Return the focusable elements in the order a keyboard user reaches them with Tab — numbered, each with role + accessible name. The stop focused at capture time is marked `[focused]`. Surfaces focus traps, illogical order, and unreachable controls.

Parameters:

- **`rootSelector`** — string — optional (default `"body"`) — CSS selector for the walk.

**Built from the in-page DOM walk — the only source there is, not a fallback.** Chromium's accessibility tree knows whether a node is *focusable*, but not the *sequence*: `tabindex` never reaches a native node, and ordering by it is DOM/layout work the AX tree doesn't expose. Because this one runs in the page, a selector means something here — which is why it keeps `rootSelector`.

An agent calls this to check keyboard operability of a form or menu.

### `list_elements`

*Read-only · whole-document.*

List every element of one category as role + accessible name + CSS locator — a focused view of one kind of element (e.g. `image` pairs with the `image-alt` rule, `form` with labeling). Listed from Chromium's own accessibility tree, so it agrees node for node with [`get_semantic_tree`](#get-semantic-tree) and [`audit_page`](#audit-page). An element inside a shadow root has no whole-document selector, so its locator path stops at the boundary.

Parameters:

- **`filter`** — `"heading"` \| `"link"` \| `"button"` \| `"form"` \| `"landmark"` \| `"image"` — **required** — the category to list.

An empty category says why, because "none" otherwise answers three different questions the same way — the page has none of these, nothing was extracted, or the category doesn't cover the role you meant:

```
(none — filter "image" matched 0 of 412 nodes; it looks for role img)
(none — the tree is empty, so nothing could match filter "image"; the page may not have loaded, or extraction failed)
```

The role list matters more than it looks. `image` looks for exactly `img`, so a page whose graphics are `figure`s reports none — and `landmark` includes the `form` role while `form` does **not**, since that filter looks for the fields. Both read as a bug until the roles are visible.

An agent calls this to review one element type without pulling the whole tree:

```json
{ "filter": "image" }
```

## Findings checkpoints

Give the agent the CLI's snapshot + diff power mid-session: capture the page's findings under a name, change something (deploy, feature toggle, DOM edit), then ask what's **new / changed / fixed** — with the same `v1:` fingerprint identity the CI a11y-diff bot uses. Checkpoints are held in memory (LRU-capped at 20) and **survive navigation by design**, so you can checkpoint one deploy and diff another. `close_browser` clears the store.

These capture the accessibility _problems_. To capture the tree _structure_ and diff what an interaction changed, see [tree checkpoints](#tree-checkpoints) — which are bound to the page instance and do not survive navigation.

### `checkpoint_findings`

_Snapshots the current page into the named store._

Snapshot the current page's accessibility findings and store them under `name`; re-saving a name overwrites it. Fingerprints go through the same `buildSnapshotPage` the CLI's `snapshot` command uses, so a checkpoint is directly comparable to a CI baseline.

Parameters:

- **`name`** — string — required — the checkpoint label (the store key).
- **`rules`** — array of the five rule ids — optional — subset for the findings. Omit to run all.

Whole-document, and built from the same producer `real-a11y snapshot` uses — which is what lets a checkpoint captured here be diffed by the CLI, and vice versa. The exported artifact records which views it measured (`meta.views`) and omits the tabs view rather than storing an empty one.

The recorded URL is read **when the checkpoint is taken**, not when `open_page` ran — a [`click_element`](#click-element) can navigate, so those are not the same address. It is what the diff tools compare to decide whether two sides are the same page.

### `diff_findings`

_Read-only · re-snapshots the current page and diffs it against a stored checkpoint._

Re-snapshot the current page and diff it against checkpoint `name`: which findings are **NEW** (the only class that gates CI), **CHANGED**, or **FIXED**, plus an advisory structural summary. Use after a change, or after navigating to a different deploy of the same page.

Parameters:

- **`name`** — string — required — the checkpoint to diff against.

The re-snapshot carries the same rule subset the checkpoint was captured with, so rules the base never ran can't surface as spurious NEW.

The header names the operation and the checkpoint it read, so an output can be traced back to its input when several are stored:

```
Live page vs. saved checkpoint "prod": 1 new, 0 fixed, 0 changed, 12 unchanged.
```

The headline cross-deploy workflow — diff prod against a preview in one session:

```json
// open_page("https://example.com")       → checkpoint_findings({ "name": "prod" })
// open_page("https://preview.example.com") → diff_findings({ "name": "prod" })
```

That works because only the **origin** differs. Checkpoints deliberately survive navigation, so it is just as easy to check one route and diff another by accident — and there the structural summary would report the whole page as rewritten. When the two sides are different pages, the diff says so and drops that section:

```
Live page vs. saved checkpoint "pricing": 0 new, 0 fixed, 0 changed, 3 unchanged.
NOTE: different page — the base was captured at `https://example.com/pricing`,
this side at `https://example.com/careers`. The structural summary is suppressed:
two different pages differ almost everywhere, so it would describe a rewrite, not
a regression. Findings are still matched by fingerprint.
```

"Different page" means the **path, query or fragment** differs. Host, port and scheme are ignored on purpose: that is exactly the prod-vs-preview diff above, and the structural summary is the whole point of it. An address that can't be parsed is never treated as a mismatch — silently dropping the section on a guess would be worse than printing a noisy one.

### `diff_checkpoints`

_Read-only · diffs two stored checkpoints._

Diff two already-stored checkpoints against each other (no re-snapshot): which findings are new / changed / fixed going from `base` to `head`.

Parameters:

- **`base`** — string — required.
- **`head`** — string — required.

Its header says no browser was read, so a stored-vs-stored comparison is never mistaken for a live one:

```
Saved checkpoints: "prod" → "preview" (no re-snapshot): 0 new, 2 fixed, 0 changed, 9 unchanged.
```

Same different-page rule as [`diff_findings`](#diff-findings) — two checkpoints of unrelated routes diff their findings and skip the structural summary.

### `list_checkpoints`

_Read-only._

List the stored checkpoint labels with their finding counts and approximate tree sizes. No parameters.

### `export_checkpoint`

_Read-only._

Return a stored checkpoint as a Real A11y snapshot artifact — the same `a11y-snapshot.json` the CLI writes (same `schemaVersion`, same fingerprints). Persist it to your own file to diff across sessions, or feed it to the CI a11y-diff.

The artifact has to come back as **one valid JSON string**, so it is never truncated — a checkpoint over the 40,000-character cap fails instead. Checkpoints are whole-document, so there is no scope to narrow (a `rules` subset shrinks the findings, never the tree); the error reports both sizes so you can tell which. To *compare* an oversized checkpoint, diff it in-session with [`diff_findings`](#diff-findings) / [`diff_checkpoints`](#diff-checkpoints), which need no export. To *keep* one, capture the page with the CLI instead — `real-a11y snapshot <url> --output a11y-snapshot.json` writes the identical artifact to a file, uncapped.

Parameters:

- **`name`** — string — required.

### `import_checkpoint`

_Loads an external artifact into the store._

Load an externally-held Real A11y snapshot artifact (e.g. a CLI-generated baseline) into the store under `name`, so a live page can be diffed against it. Input is validated strictly; the artifact's first page is stored.

Parameters:

- **`name`** — string — required — the label to store it under, and **only** a label. The imported page keeps the identity it arrived with (derived from its URL), so a CLI-written artifact of `/pricing` diffs against a live page at `/pricing` whatever you call it here. Earlier releases rewrote the page under this label, which made an imported artifact join on the store name instead of the route — the reason the cross-tool diff didn't work before.
- **`artifact`** — string — required — a serialized Real A11y snapshot artifact (JSON).

## Tree checkpoints

Where the [findings checkpoints](#findings-checkpoints) answer _"what accessibility problems changed?"_, these answer _"what did that interaction change?"_ — the precise structural delta of a click, a keypress, or a dialog opening.

The two are deliberately different in lifetime. A snapshot checkpoint is pure data and **survives navigation**. A tree checkpoint holds the extracted tree **inside the page** — its node identities are bound to that page instance — so it is **discarded the moment the page navigates**. Capture, interact, diff, all within one page load.

### `checkpoint_tree`

_Captures the current tree in the page as a comparison point._

Capture the current accessibility tree as the baseline for an interaction diff. Then interact with the page and call [`diff_tree`](#diff-tree). Re-capturing re-baselines.

Parameters:

- **`rootSelector`** — string — optional (default `"body"`) — CSS selector for the extraction root.

### `diff_tree`

_Read-only · diffs the live tree against the checkpoint._

Diff the current accessibility tree against the one captured by `checkpoint_tree`: which nodes were **added**, **removed**, or **changed**, plus a `focus:` line when focus moved. This is what makes an interaction's effect legible — e.g. that opening a dialog added a `dialog` node _and_ moved focus into it, or that a "Load more" button appended twelve links but left focus stranded.

Parameters:

- **`rootSelector`** — string — optional — CSS root for the re-extraction. **Defaults to the root the checkpoint was captured with**, so the diff stays like-for-like instead of silently widening to `body` and reporting the rest of the page as added.

Errors if no checkpoint exists on the current page — including after a navigation, which discards it.

## Act

The write side of the same tree every read tool uses: dispatch a real click, replace a text field's value, or move real keyboard focus — over CDP, against the node matched in **Chromium's own accessibility tree**. Chromium only.

Targeting is deliberately **role + accessible name**, never a CSS selector or a node id. The tools resolve the target against a fresh tree immediately before every dispatch — the same view [`get_semantic_tree`](#get-semantic-tree) prints — so a node you aim at by one name can't come back in a report under another, and if role and name can't reach a control, assistive technology can't reach it either. That is an accessibility finding rather than a targeting inconvenience.

All three tools share the targeting parameters:

- **`role`** — string — required — ARIA role exactly as the tree prints it (`button`, `link`, `textbox`, `checkbox`, `menuitem`, …).
- **`name`** — string — optional — accessible name; case-insensitive, whitespace-normalized **exact** match against the tree [`get_semantic_tree`](#get-semantic-tree) returns. Pass `""` to target an unlabeled control; omit to match any name.
- **`nth`** — integer ≥ 1 — optional — 1-based pick among the role+name-filtered matches, in document order.

When several nodes match and no `nth` was given, the tool errors and **lists the candidates as `nth=1 · role "name"` lines** — the remedy is copy-paste. A **disabled** target is refused with the cause (the page would silently ignore the action, and the empty diff that followed would mislead). A match with no backing DOM element (a synthesized node such as the document root) is refused before any CDP traffic.

The payoff is the loop: [`checkpoint_tree`](#checkpoint-tree) first, act, then [`diff_tree`](#diff-tree) — the diff is the answer to _"what did that action change for a screen reader?"_.

### `click_element`

_Acts on the page · targets by role + accessible name · Chromium only._

Dispatch a **real** click against the matched element. It can submit forms, toggle state, and **navigate** — and navigation discards the page's tree checkpoint, so re-checkpoint after any click that changes the page instance.

An agent calls this to open the dialog it is about to audit, expand a disclosure, or demonstrate that an unlabeled-but-reachable button actually does something:

```json
{ "role": "button", "name": "Save", "nth": 2 }
```

### `type_text`

_Acts on the page · replaces the field's value · the result never echoes the text._

Set the value of the matched text field (role is usually `textbox`, `searchbox`, or `combobox`). The value is applied through the prototype value setter with `input`/`change` events, so framework-controlled inputs (React et al.) register it — and it **replaces** the field's current value rather than appending.

Additional parameter:

- **`text`** — string — required — the text to enter. **Never echoed back in the result** (the same R1 redaction discipline the read path applies).

There is deliberately **no credential parameter**, and this tool must not be used to log in — a password typed here would enter the agent's context. For pages behind auth, start the server with [`REAL_A11Y_MCP_STORAGE_STATE`](#real-a11y-mcp-storage-state) or [`REAL_A11Y_MCP_CDP`](#real-a11y-mcp-cdp) instead.

```json
{ "role": "textbox", "name": "Search", "text": "keyboard traps" }
```

### `focus_element`

_Acts on the page · moves real keyboard focus._

Move keyboard focus to the matched element — what a keyboard user's <kbd>Tab</kbd> journey would land on, teleported. The result says whether the target is a text field (and its input type), so the agent knows a [`type_text`](#type-text) should follow. Pairs with [`get_tab_order`](#get-tab-order) for focus-order work.

```json
{ "role": "searchbox", "name": "Search docs" }
```

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

Set to `1` to launch a visible browser instead of headless. Ignored when [`REAL_A11Y_MCP_CDP`](#real-a11y-mcp-cdp) is set — a CDP attach reuses the running browser, window state and all.

[`open_page`](#open-page)'s reply names the mode it's actually in, so a human watching for a window knows whether to expect one. Over CDP it reports the attach rather than a launch mode, and doesn't offer this variable as a fix — it has no say there.

### `REAL_A11Y_MCP_ALLOW_FILE`

*`"1"` · optional.*

Set to `1` to permit auditing `file://` URLs. Off by default — an agent that can open `file:///…/.env` and read the DOM back is a local-file exfiltration risk. `data:` URLs are always allowed (caller-supplied inline content, not a filesystem read).

### `REAL_A11Y_MCP_STORAGE_STATE`

*string (path) · optional.*

Path to a saved login session — a Playwright storage-state JSON (cookies + origin storage) — loaded into every launched context so pages open already authenticated. Create it out-of-band (e.g. the CLI's `login` helper); it is **never** a tool parameter, so session tokens stay out of the agent's context. When set, [`open_page`](#open-page) tells the agent the session is active so it won't try to log in. At startup the server verifies the path is a readable file containing a valid storage-state shape (`"cookies"` / `"origins"`) and refuses to start otherwise; errors quote the path only, never its contents. Cannot be combined with [`REAL_A11Y_MCP_CDP`](#real-a11y-mcp-cdp) (a CDP connection carries its own session).

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
### `REAL_A11Y_MCP_MAX_SESSIONS`

*integer · optional (default `4`).*

Cap on concurrently live [named sessions](#session). Each session is its own browser, so the cap is what keeps an agent typo in `session` from accumulating Chromiums; a call naming a new session beyond it fails with an error pointing at [`list_sessions`](#list-sessions) and [`close_browser`](#close-browser). Calls to already-live sessions are unaffected.

### `REAL_A11Y_MCP_SESSION_IDLE_TIMEOUT_MS`

*integer (ms) · optional (default `900000` = 15 minutes).*

How long the server keeps sessions alive with no tool call before closing them all — the same idle discipline as the CLI daemon's `--session-idle-timeout`. `0` disables the timer; values are capped at one hour. Only the browsers close: the server process stays up, and the next tool call relaunches its session from scratch (checkpoints are discarded with the session).

There is no `REAL_A11Y_MCP_PROXY` variable — Chromium doesn't honor `HTTP_PROXY`/`HTTPS_PROXY` on its own, and a proxy is a **programmatic** `BrowserSession` constructor option, not read from the environment by the stdio server. Configure it only if you embed `BrowserSession` directly.
:::
