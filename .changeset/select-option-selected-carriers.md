---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Bundle the core engine that now reports which option of a native `<select>` is selected in the DOM producer. The CLI and MCP read the native tree, which already reported it, so their output doesn't change.
