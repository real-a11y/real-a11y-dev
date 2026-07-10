---
"@real-a11y-dev/mcp": minor
---

New package `@real-a11y-dev/mcp` — a Model Context Protocol server that exposes the Real A11y semantic tree and accessibility audits to AI agents over stdio. Point any MCP client at it (`npx -y @real-a11y-dev/mcp`) and an agent can open a page and reason about what assistive tech actually perceives.

Audit-first: `audit_page` runs the same rule engine as `@real-a11y-dev/testing` (`collectFindings`) and returns every violation — unlabeled controls, skipped heading levels, unlabeled dialogs, broken landmark structure — grouped and with per-instance CSS locators. `inspect_page` returns the findings plus the semantic tree, heading outline, and tab order from ONE extraction, so a multi-view report can't be internally inconsistent on a dynamic page. Perception primitives (`get_semantic_tree`, `get_heading_outline`, `get_tab_order`, `list_elements`) let it stand alone without a separate browser-automation MCP; `open_page` handles navigation, settle waits, and mobile/tablet device emulation.

Two MCP-only tools cross-check the custom engine against the browser's own tree: `get_native_tree` reads Chromium's authoritative accessibility tree via CDP, and `compare_trees` diffs the two and reports where they disagree on role or accessible name — a fidelity oracle that surfaces custom-engine bugs.

Playwright is a peer dependency, lazily imported, so importing the server API (`buildServer`, types) never requires a browser to be installed. `file://` navigation is refused by default (an LLM-driven local-file exfiltration primitive) unless `REAL_A11Y_MCP_ALLOW_FILE=1`.
