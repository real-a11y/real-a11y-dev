---
id: R31
suite: regression
scenario: "MCP named sessions — parallel isolation, reuse, and lifecycle"
area: MCP
type: Automated
priority: P1
status: Active
validFrom: "mcp ≥ 0.1.0-beta.2"
validUntil: ""
expected: "Two named sessions hold two independent live pages with isolated checkpoints; `list_sessions` reports them; `close_browser` closes one by name or all at once (never both); the session cap refuses a new name with a remedy; the idle timeout closes browsers but keeps findings checkpoints."
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
9. Restart with `REAL_A11Y_MCP_SESSION_IDLE_TIMEOUT_MS=2000`; `open_page` in `alpha`, `checkpoint_findings` name `base`, wait >2 s, then `list_sessions` and `list_checkpoints` with `session: "alpha"`.
10. Still on that server: `list_checkpoints` with three never-used session names, then `open_page` in a fourth name (default cap 4).
11. `close_browser` with `session: "alpha"` **and** `all: true` together.
12. `list_sessions` with an unknown argument (`{"session": "alpha"}`).
13. Restart with `REAL_A11Y_MCP_MAX_SESSIONS=" "`, then with `REAL_A11Y_MCP_MAX_SESSIONS=2.5`.

## Expected

- **2** — two separate browser pages are live; each session's `open_page` reply
  names its own URL, **redacted** — from mcp ≥ 0.1.0-beta.6 the landing URL goes
  through the same redactor every other printed URL uses, so a secret-looking
  parameter reads `[REDACTED]` in the query *and* in the fragment. The `Title:`
  line beside it is sanitized for the same reason: it is page-controlled, and a
  page that puts an escape sequence or a newline in `document.title` must not be
  able to forge a second `Opened <url>` line. On earlier releases both printed
  raw; either shape passes on its own release.
- **3** — `alpha` lists 1 checkpoint; `beta` lists none (checkpoints are per session).
- **4** — `alpha`'s tree shows the post-click state; `beta`'s tree is unchanged (isolation).
- **5** — both sessions listed with name, redacted URL, and timestamps.
- **6** — only `beta` remains listed; `alpha`'s checkpoints are gone with it.
- **7** — the second `open_page` fails with `session limit reached` naming `close_browser` / `list_sessions` / `REAL_A11Y_MCP_MAX_SESSIONS` as remedies; the `alpha` session still works.
- **8** — reply reports the number of sessions closed; a final `list_sessions` is empty.
- **9** — the idle timer closed the browser: `list_sessions` is empty and a fresh
  `open_page` relaunches — but `list_checkpoints` still reports `base`. The
  baseline outlives the browser it was captured in.
- **10** — the three checkpoint-only calls report "No checkpoints saved" without
  launching anything (`list_sessions` stays empty), and the fourth `open_page`
  succeeds: reading a store never spends a session slot.
- **11** — refused, naming both parameters; nothing is closed. A destructive tool
  never silently does more than it was asked.
- **12** — rejected by the schema (`additionalProperties: false`), not answered
  with the unfiltered list.
- **13** — both refuse to start, naming the variable and the value. The
  whitespace case matters most: `Number(" ")` is `0`, and `0` on the idle
  timeout means "disabled" — the opposite of what the operator typed.

## Why this exists

Named sessions turned the server's "one mutable page" model into a registry of
live pages, and the failure modes are exactly the ones this asserts: checkpoint
bleed between sessions (a diff against another page's baseline is silently
wrong), state bleed (a click in one session visible in another means the name
routed to the wrong browser), and browser leaks (a typo in `session` spawning
an uncapped Chromium per call). The cap-with-remedy step exists because the
refusal is the guard rail — if it ever stops naming the fix, an agent just
retries in a loop.

Steps 9–10 guard the second-order version of the same idea: the lifetime rules
have to match the workflows the tools advertise. A findings checkpoint exists to
be diffed later, and "later" for a cross-deploy review is longer than the
15-minute idle timeout — so the timeout closing browsers must not take baselines
with it, and a checkpoint read must not need (or reserve) a browser at all.
