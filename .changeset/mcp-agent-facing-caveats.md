---
"@real-a11y-dev/mcp": patch
---

Surface three behaviours in the tool descriptions, which is the only documentation an agent actually reads.

Each of these was already decided deliberately and written down correctly — on the website, in the README, in a code comment — but none of it reaches an MCP client. The tool schema is the agent's entire view of the server, so a caveat that lives anywhere else may as well not exist. All three came out of dogfooding the server from an agent.

- **`close_browser` discards saved checkpoints.** `checkpoint_findings` promised that checkpoints "survive navigation" with no further qualification, which reads as "survive everything". Both descriptions now state the loss and point at `export_checkpoint` as the way out.
- **`open_page` reports the browser mode.** Headless is the default, so a human watching for a browser window concluded it never opened. The reply now names the mode, and mentions `REAL_A11Y_MCP_HEADFUL` when there's no window to see — except over `REAL_A11Y_MCP_CDP`, where the attached browser keeps its own window state and that variable does nothing; there it reports the attach instead of guessing at a launch that never happened. `buildServer` gained `headful` and `cdpAttached` options for this — the bin owns both decisions, so the server can only report what it's told.
- **`open_page` names the auth options when there aren't any.** With no saved session, an agent hitting a logged-out page had no way to know the server _can_ authenticate. It now points at `REAL_A11Y_MCP_STORAGE_STATE` and `REAL_A11Y_MCP_CDP` and says plainly not to attempt a login through the tools — there is no credential parameter, deliberately, and env-only shouldn't mean invisible.

No behaviour changes: same tools, same parameters, same results.
