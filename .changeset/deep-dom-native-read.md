---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

Fix the native tree read failing on pages nested about 150 or more levels deep. `tree`, `audit`, `list` and every MCP tree read rejected with `CBOR: stack limit exceeded` (and `audit` reported the page as failed to load), because the DOM was read as one nested `DOM.getDocument` response that Chromium cannot serialize past that depth. The DOM is now read flat, with the nested read kept as a fallback. No role, name or state changes, so saved snapshots do not churn; only pages that previously failed now succeed.
