---
id: R9
suite: regression
scenario: "MCP perception tools work end to end — open_page, audit_page, inspect_page, get_semantic_tree, get_heading_outline, list_elements, close_browser"
area: MCP
type: Automated
priority: P0
status: Active
validFrom: "mcp ≥ 0.1.0-beta.1. Native list_elements locators from mcp ≥ 0.1.0-beta.2 / browser ≥ 0.1.0-beta.12. From the producer migration (#258): no `producer` param, `rootSelector` on `get_tab_order` + the tree checkpoints only, 19 tools. `get_tab_order` has no end date. Step 6b is from mcp ≥ 0.1.0-beta.2 / audit ≥ 0.1.0-beta.12; earlier releases print a bare `(none)`, which is the old behaviour, not a fail."
validUntil: ""
expected: "each returns non-empty, correctly-shaped text; audit reports the seeded violation; list_elements returns role + name + a CSS locator (native included — that was fixed, docs used to say native carried none), and an empty category explains itself (scanned count + the roles it looked for) rather than a bare (none)"
twin: D4
covers:
  - mcp.tools.open_page
  - mcp.tools.audit_page
  - mcp.tools.inspect_page
  - mcp.tools.get_semantic_tree
  - mcp.tools.get_heading_outline
  - mcp.tools.list_elements
  - mcp.tools.get_tab_order
  - mcp.tools.close_browser
notion: "https://app.notion.com/p/3aa1c354b0b58186b2e6c2f88781d7a0"
---

## Steps

Against a page seeding a known violation:

1. `open_page`
2. `audit_page`
3. `inspect_page`
4. `get_semantic_tree`
5. `get_heading_outline`
6. `list_elements { filter: "image" }`
7. **(6b)** `list_elements { filter: "image" }` on a page whose graphics are
   `<figure>`s rather than `<img>` — a category that legitimately matches nothing
8. `close_browser`, then call a perception tool again
9. `get_semantic_tree { rootSelector: "main" }` — and
   `get_semantic_tree { producer: "native" }`
10. `get_tab_order`, then `get_tab_order { rootSelector: "main" }`
11. `tools/list` — assert the tool _list_, not a remembered count

## Expected

- **2** — reports the seeded violation, grouped and counted, each with a CSS
  locator
- **3** — findings + tree + outline from **one** extraction, so the sections cannot
  disagree
- **4** — a non-empty tree. There is one producer now: Chromium's own,
  whole-document, reaching UA-shadow media controls the old DOM walk missed
- **6** — role + accessible name + **a CSS locator**. Native used to carry none,
  and the docs said so; both were fixed together
- **6b** — **not** a bare `(none)`. From mcp ≥ 0.1.0-beta.2 /
  audit ≥ 0.1.0-beta.12: `(none — filter "image" matched 0 of N nodes; it looks for
  role img)`. **N must be the real tree size** — `0 of 0` means nothing was
  extracted, a different failure with a different fix — and the **role list** is
  what explains the miss. An empty tree says so in its own words instead: _"the
  tree is empty, so nothing could match…"_
- **7** — a clear "no page open" error, not a crash or a stale result
- **8** — **both rejected by the schema**, not by handler prose. The tools declare
  `additionalProperties: false`, so an unknown key fails validation before any
  browser work. This is the assertion that the axis is really gone rather than
  accepted-and-ignored — the failure mode worth catching is a param that validates
  and then does nothing
- **9** — tab order **numbered** at render, and `rootSelector` scopes the walk.
  This is the one read that still takes it
- **10** — 19 tools, `get_tab_order` among them, `compare_producers` absent. Assert
  names: a count alone passes while the wrong tool is missing

Every result must be non-empty and correctly shaped. An empty string that parses is
the failure mode to watch for — it looks like success to a schema check and like a
broken page to an agent. `list_elements` can no longer return one at all: an empty
category comes back as a line saying why, so the tool has no silent-success shape
left.

## Why this exists

These are the tools an agent reaches for first, so their failure mode is an agent
quietly reporting "no issues" on a page full of them.

The locator point in (6) is recent: native `list_elements` returned names with no
addresses, and three docs stated that as intended behaviour. When the producer was
fixed, the docs had to be corrected too — check both.

(6b) is the same class of defect one step further on. A bare `(none)` answered
three different questions identically — the page has none of these, nothing was
extracted, or the category doesn't cover the role you meant — and an agent that
can't tell them apart will report "no images" for a page that never loaded. The
count is what separates those two; the role list is what explains a genuine miss.

**Resolved, opposite to the prediction:** this row expected `get_tab_order` to be
deleted by the native migration and to disappear from `tools/list`. It is still
there, deliberately — native knows whether a node is focusable but cannot produce
the _sequence_, so this is the only tool that can answer the question at all. Its
absence would now be the regression.

What the migration actually removed is the **producer axis**: no `producer` param
anywhere, `rootSelector` only on `get_tab_order` and the tree checkpoints, and
`compare_producers` gone (20 → 19). Step 8 is the guard for that — and it checks
_schema rejection_ on purpose, because a parameter that is accepted and silently
ignored is worse than one that errors, and looks identical from the outside.

## Notes

Producer migration (#258) — `get_tab_order` SURVIVES, on the DOM producer, and is
the one tool that still takes `rootSelector`. It was expected to be deleted; it
wasn't, because native knows per-node `focusable` but not the _sequence_. What did
go is the `producer` param (every read is native now) and `rootSelector` on every
other tool — both are `additionalProperties: false`, so a call passing either is
rejected by the schema. `compare_producers` is gone too: 20 → 19 tools. Steps
4/6/8 rewritten accordingly.
