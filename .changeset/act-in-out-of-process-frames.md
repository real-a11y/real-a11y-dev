---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

`interact`, `click`, `type`, `focus` and the MCP action tools now act inside iframes Chromium runs in a process of their own. Under site isolation (the Chrome for Testing `real-a11y install` fetches, and any Chrome reached over `--cdp`) a cross-site or `sandbox`ed `<iframe>` runs in its own renderer process, so its controls could be read but not used: a payment form or an embedded sign-in stopped a flow at its first step. An action now goes to the frame's own process. If the frame has navigated or been removed since the tree was read, the step fails as a target that changed rather than acting on whatever is there now, and on a session pinned to origins (`--storage-state`, `REAL_A11Y_MCP_ALLOWED_ORIGINS`) a frame from another origin is still left alone.
