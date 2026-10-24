---
id: D4
suite: dogfood
scenario: "MCP from the registry via npx — agent-style session against https://real-a11y.dev"
area: MCP
type: Automated
priority: P0
status: Active
validFrom: "mcp ≥ 0.1.0-beta.1 via npx on the `beta` tag. Tool list: 20 from mcp 0.1.0-beta.2 (act tools); 19 from the producer migration (#258) — `compare_producers` removed, `get_tab_order` kept; **20** from mcp ≥ 0.1.0-beta.3, which adds `list_sessions`. Assert names. Step 5's named `generic` lines from mcp ≥ 0.1.0-beta.9. Step 3 with no Playwright installed beforehand from mcp ≥ 0.1.0-beta.10; earlier releases fail it, the known defect."
validUntil: ""
expected: "npx starts the published server; tools/list matches the documented set EXACTLY (assert the names, not the count); perception + audit tools return real data for the live site"
twin:
  - R8
  - R9
  - R43
covers:
  - packages.@real-a11y-dev/mcp
  - mcp.tools.open_page
  - mcp.tools.audit_page
  - mcp.tools.inspect_page
  - mcp.tools.get_semantic_tree
  - mcp.tools.get_heading_outline
  - mcp.tools.list_elements
  - mcp.tools.get_tab_order
  - mcp.tools.checkpoint_findings
  - mcp.tools.diff_findings
  - mcp.tools.close_browser
notion: "https://app.notion.com/p/3aa1c354b0b581df9b83fd598e5e8b4c"
---

## Steps

Point a real MCP client (Claude Code, Claude Desktop, Cursor) at the **published** server via
`npx` — no local checkout, no build step:

```json
{ "command": "npx", "args": ["-y", "@real-a11y-dev/mcp@beta"] }
```

Run the client somewhere nothing else makes Playwright resolvable: no Playwright in its
working directory or above it, and `NODE_PATH` unset. The agent container sets `NODE_PATH`
to a directory holding a global Playwright, which hid a missing peer through mcp
0.1.0-beta.9.

1. Confirm the server starts and handshakes over stdio
2. `tools/list` — compare the sorted names to the documented set
3. `open_page https://real-a11y.dev`
4. `audit_page`, `inspect_page`
5. `get_semantic_tree` — there is one producer now (Chromium's own); a call passing `producer`
   is rejected by the schema. Then `get_semantic_tree { includeGeneric: true }`
6. `get_heading_outline`, `list_elements`, `get_tab_order` — the last is the only read that
   still takes `rootSelector`
7. `checkpoint_findings` → navigate to another page → `diff_findings`
8. `close_browser`
9. Then, without prompting the agent step by step, ask it something open-ended — _"is this page
   accessible to a screen reader?"_ — and watch which tools it reaches for

## Expected

- **1** — `npx` starts the published server on a machine with nothing installed
- **2** — names match the docs exactly (assert the list, not the count). 20 today;
  `get_tab_order` and `list_sessions` present, `compare_producers` absent
- **3** — `open_page` opens the page with nothing installed beforehand: npx installs the
  Playwright peer with the server. Through mcp 0.1.0-beta.9 the peer was optional, and
  there `open_page` answers `Cannot find package 'playwright'` — the known defect, not a
  new one
- **3–6** — real data for the live site, not empty shells
- **5** — with `includeGeneric`, the tree gains `generic` lines. From mcp ≥ 0.1.0-beta.9, a
  named one is a block of text the page shows, such as a `<div>` of text beside a link, and
  `tools/list` describes the parameter that way; earlier releases print no such line, the old
  behaviour, not a fail
- **7** — the diff reports the real delta between two live pages
- **9** — the agent picks a sensible sequence **from the tool descriptions alone**. If it
  flails, calls tools in the wrong order, or gives up, the descriptions are the finding — not
  the agent. From mcp ≥ 0.1.0-beta.6, `audit_page`'s description distinguishes empty-name
  (AT unnamed) from `label-title-only` (axe best-practice; title still is a name)

## Why this exists

Step 9 is the actual dogfood and the reason this row is post-publish. Everything above it
verifies the server responds; only step 9 tests whether the tools are _usable by an agent that
hasn't been coached_, which is the entire product.

The server `instructions` and each tool's description are the only interface an agent has. They
are shipped text, so they can be wrong in ways no unit test detects — and they're the first
thing that goes stale when tools are added or renamed.

## Notes

Was "the 18 tools" — wrong since the act tools landed, then 20, then 19. **20 today.** The producer
migration (#258) dropped `compare_producers`; `get_tab_order` was predicted to go with it and
survived, so the "back to 18" arithmetic was wrong while the reasoning (assert names, not the
count) was right. Step 5 also loses its `producer: "native"` half — the param is gone and the
schema now rejects it.

Through mcp 0.1.0-beta.9 this row passed in the agent container while the documented
launch failed everywhere else. The peer was optional, so npx never installed Playwright,
and the container's `NODE_PATH` supplied a global one, which `createRequire` honours.
Hence the `NODE_PATH` rule in Steps, and R43 as the pre-publish twin.
