---
id: R25
suite: regression
scenario: "MCP act tools — click_element / type_text / focus_element complete the agent loop"
area: MCP
type: Automated
priority: P0
status: Active
validFrom: "mcp ≥ 0.1.0-beta.2 (unreleased — mcp-act-by-role is a pending changeset)"
validUntil: ""
expected: "checkpoint_tree → act → diff_tree reports exactly the introduced delta. Each tool resolves role + name against a FRESH native tree immediately before dispatch, so no node id ever crosses the wire. Ambiguity lists nth candidates with NO dispatch; a disabled target is refused; a stale/mid-action miss says the page mutated and to retry. focus_element surfaces whether the target accepts text entry. Annotations are correct (click: idempotent false, openWorld true)."
twin: D11
covers:
  - mcp.tools.click_element
  - mcp.tools.type_text
  - mcp.tools.focus_element
notion: "https://app.notion.com/p/3ab1c354b0b581c3a5ebd89a36826ebd"
---

## Steps

Drive the **packed** server, not a workspace build.

1. `tools/list` — confirm `click_element`, `type_text`, `focus_element` are present with
   descriptions + `inputSchema`
2. `open_page` → `checkpoint_tree` → `click_element {role:"button", name:"Open menu"}` →
   `diff_tree`
3. `click_element` against a name matched by **two** nodes
4. Re-issue with `nth: 2`
5. `click_element` against a `disabled` control
6. `type_text {role:"textbox", name:"Email", text:"<sentinel>"}` — see **R24** for the
   sentinel
7. `focus_element` on a text field, then on a button
8. `click_element` with `nth: 0`
9. Read `type_text`'s own description text
10. `listTools` annotations for `click_element`

## Expected

- **2** — the diff reports exactly the introduced delta, nothing more
- **3** — an error listing `nth=1 …` / `nth=2 …` candidates, and **no** dispatch.
  Ambiguity must be recoverable from what the error prints
- **4** — acts on the second node specifically
- **5** — refused with the cause; never success + empty diff
- **6** — result never echoes the text (R24 covers the full grep)
- **7** — the result says whether the target accepts text entry, so a caller knows a
  `type_text` can follow
- **8** — rejected by schema. `nth` is 1-based, so off-by-one should be unrepresentable,
  not merely validated
- **9** — states it has deliberately **no credential parameter** and is not a login
  mechanism, pointing at `REAL_A11Y_MCP_STORAGE_STATE` / `REAL_A11Y_MCP_CDP`
- **10** — `click_element` is `idempotent: false`, `openWorld: true`; `type_text` and
  `focus_element` are `idempotent: true`

Every tool re-reads a **fresh** native tree immediately before dispatching, so no node id
ever crosses the wire. A stale or mid-action miss must say the page mutated and to retry —
not repeat the backend's "re-read the tree" advice, which presumes a caller holding ids.

## Why this exists

The top ask from the beta-dogfooding pass: agents could run checkpoint → interact → diff
_except_ the interact step, so a human had to click while the agent watched.

Assert the description caveat in (9) the same way the CDP caveats are asserted — an
invariant nobody can read is one nobody keeps, and the credential rule only works if it is
in the text the agent actually sees.

## Notes

`type_text` must state in its own description that it has deliberately NO credential
parameter and is not a login mechanism — pages behind auth use
`REAL_A11Y_MCP_STORAGE_STATE` or `_CDP`. Assert that caveat is present in the description,
the way the CDP caveats are asserted: an invariant nobody can read is one nobody keeps.
