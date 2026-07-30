---
id: D11
suite: dogfood
scenario: "MCP act loop from the registry — an agent completes checkpoint → act → diff unaided"
area: MCP
type: Automated
priority: P0
status: Active
validFrom: "mcp ≥ 0.1.0-beta.2 (unreleased). Not runnable until click_element / type_text / focus_element publish — mark N/A for earlier releases"
validUntil: ""
expected: "Against the published server via npx: open_page → checkpoint_tree → click_element → diff_tree returns a diff naming the real change. The agent should be able to do this from the tool DESCRIPTIONS alone, without being told the order — if it can't, the descriptions are the bug. Ambiguity must be recoverable from what the error prints (the nth candidates). type_text never echoes its value."
twin: R25
covers:
  - mcp.tools.click_element
  - mcp.tools.type_text
  - mcp.tools.focus_element
  - mcp.tools.checkpoint_tree
  - mcp.tools.diff_tree
notion: "https://app.notion.com/p/3ab1c354b0b581278b90f3a52ddd18d9"
---

## Steps

Published server via `npx`, driven by a real MCP client. Two passes, and the second is the one that
counts.

**Pass 1 — scripted, does it work**

1. `open_page https://real-a11y.dev`
2. `checkpoint_tree`
3. `click_element` on a control read from `get_semantic_tree`
4. `diff_tree`
5. `click_element` on an ambiguous name; recover with `nth`
6. `type_text` with the **R24** sentinel into a real field
7. `focus_element`, then `diff_tree`

**Pass 2 — unscripted, is it usable**

8. Fresh session. Ask the agent something open-ended: _"open real-a11y.dev, open the main
   navigation, and tell me what that changed for a screen reader."_
9. Do **not** name the tools or the order. Watch what it does
10. If it stalls, note the exact point and what the description said at that point

## Expected

- **4** — the diff names the real change on the live page
- **5** — recoverable from the printed candidates alone
- **6** — the value appears in no tool result and no later tree or audit output
- **7** — the focus move is reported as a focus move
- **8/9** — the agent finds `checkpoint_tree` → `click_element` → `diff_tree` **on its own**, from
  the descriptions. It should not need to be told the order
- **10** — where it stalls, the **description** is the finding, not the agent

## Why this exists

This is the row that closes the loop the beta-dogfooding pass opened. The finding then was that
agents could run checkpoint → interact → diff _except_ the interact step — a human had to click
while the agent watched. The act tools exist to remove that human.

Pass 2 is the only way to know whether they did. Everything else here proves the server responds
correctly to a sequence someone already knew to send; only step 8 tests whether an uncoached agent
can discover that sequence, which is what "an agent can drive the page" actually means.

Treat a stall in pass 2 as a docs/description bug by default. The tool text is the entire interface
an agent has, and it ships — so it can be wrong in ways no unit test will ever surface.

## Notes

This was the top ask from the beta-dogfooding pass: agents could run checkpoint → interact → diff
EXCEPT the interact step, so a human had to click while the agent watched. That gap is what the act
tools closed — this row is the check that it actually closed for a real agent, against a real
registry install, not just in our e2e.
