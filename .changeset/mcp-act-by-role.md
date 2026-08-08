---
"@real-a11y-dev/mcp": minor
---

Add **act tools** to the MCP server — `click_element`, `type_text`, and `focus_element` — closing the `checkpoint_tree` → interact → `diff_tree` loop an agent previously couldn't complete alone. Each dispatches a real action over CDP through `A11ySession.act()`, the write side the native producer shipped and nothing drove.

Targeting is deliberately **role + accessible name** (plus a 1-based `nth` for duplicates), never a CSS selector or node id. `@real-a11y-dev/browser` gains `resolveTarget`, which resolves the query against a **fresh** native tree immediately before each dispatch — node ids stay internal (the serializer invariant holds), staleness shrinks to the instant between resolve and act, and a control that role + name can't reach is surfaced as what it is: an accessibility finding, not a targeting inconvenience. Ambiguity errors list the candidates as copy-paste `nth=` lines; disabled targets are refused with the cause rather than clicked into a void.

The R1 redaction discipline extends to the new write path's results: `type_text` never echoes the typed value — in success or failure — and backend CDP errors stay content-free.
