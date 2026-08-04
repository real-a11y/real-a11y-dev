---
id: D4
suite: dogfood
scenario: "MCP from the registry via npx — agent-style session against https://real-a11y.dev"
area: MCP
type: Automated
priority: P0
status: Active
validFrom: "mcp ≥ 0.1.0-beta.1 via npx on the `beta` tag. Tool list: 20 from mcp 0.1.0-beta.2 (act tools); 19 from the producer migration (#258) — `compare_producers` removed, `get_tab_order` kept; **20** from mcp ≥ 0.1.0-beta.3, which adds `list_sessions`. Assert names."
validUntil: ""
expected: "npx starts the published server; tools/list matches the documented set EXACTLY (assert the names, not the count); perception + audit tools return real data for the live site"
twin:
  - R8
  - R9
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

1. Confirm the server starts and handshakes over stdio
2. `tools/list` — compare the sorted names to the documented set
3. `open_page https://real-a11y.dev`
4. `audit_page`, `inspect_page`
5. `get_semantic_tree` — there is one producer now (Chromium's own); a call passing `producer`
   is rejected by the schema
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
- **3–6** — real data for the live site, not empty shells
- **7** — the diff reports the real delta between two live pages
- **9** — the agent picks a sensible sequence **from the tool descriptions alone**. If it
  flails, calls tools in the wrong order, or gives up, the descriptions are the finding — not
  the agent

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
