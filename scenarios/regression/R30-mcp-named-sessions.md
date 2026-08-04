---
id: R30
suite: regression
scenario: "MCP named sessions — parallel isolation, reuse, and lifecycle"
area: MCP
type: Automated
priority: P1
status: Active
validFrom: "mcp ≥ 0.1.0-beta.2"
validUntil: ""
expected: "Two named sessions hold two independent live pages with isolated checkpoints; `list_sessions` reports them; `close_browser` closes one by name or all at once; the session cap refuses a new name with a remedy."
covers:
  - mcp.tools.list_sessions
  - mcp.tools.open_page.params.session
  - mcp.tools.click_element.params.session
  - mcp.tools.get_semantic_tree.params.session
  - mcp.tools.checkpoint_findings.params.session
  - mcp.tools.list_checkpoints.params.session
  - mcp.tools.close_browser.params.session
  - mcp.tools.close_browser.params.all
  - env.REAL_A11Y_MCP_MAX_SESSIONS
  - env.REAL_A11Y_MCP_SESSION_IDLE_TIMEOUT_MS
---

## Steps

1. Start the packed MCP server on stdio (no session-related env vars set).
2. `open_page` fixture A with `session: "alpha"`, then fixture B with `session: "beta"`.
3. `checkpoint_findings` name `base` with `session: "alpha"`; `list_checkpoints` in both sessions.
4. `click_element` a state-toggling button in `alpha`; `get_semantic_tree` in both sessions.
5. `list_sessions`.
6. `close_browser` with `session: "alpha"`; `list_sessions` again.
7. Restart the server with `REAL_A11Y_MCP_MAX_SESSIONS=1`; `open_page` in `alpha`, then attempt `open_page` in `beta`.
8. `close_browser` with `all: true`.
9. Restart with `REAL_A11Y_MCP_SESSION_IDLE_TIMEOUT_MS=2000`; `open_page` in `alpha`, wait >2 s, then `list_sessions`.

## Expected

- **2** — two separate browser pages are live; each session's `open_page` reply names its own URL.
- **3** — `alpha` lists 1 checkpoint; `beta` lists none (checkpoints are per session).
- **4** — `alpha`'s tree shows the post-click state; `beta`'s tree is unchanged (isolation).
- **5** — both sessions listed with name, redacted URL, and timestamps.
- **6** — only `beta` remains listed; `alpha`'s checkpoints are gone with it.
- **7** — the second `open_page` fails with `session limit reached` naming `close_browser` / `list_sessions` / `REAL_A11Y_MCP_MAX_SESSIONS` as remedies; the `alpha` session still works.
- **8** — reply reports the number of sessions closed; a final `list_sessions` is empty.
- **9** — the idle timer closed the session: `list_sessions` is empty, the server is still responsive, and a fresh `open_page` relaunches.

## Why this exists

Named sessions turned the server's "one mutable page" model into a registry of
live pages, and the failure modes are exactly the ones this asserts: checkpoint
bleed between sessions (a diff against another page's baseline is silently
wrong), state bleed (a click in one session visible in another means the name
routed to the wrong browser), and browser leaks (a typo in `session` spawning
an uncapped Chromium per call). The cap-with-remedy step exists because the
refusal is the guard rail — if it ever stops naming the fix, an agent just
retries in a loop.
