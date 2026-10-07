---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

Internal: the native producer reads which choice states it withholds inside a sensitive field (an option's `selected`) from one list in core, shared with the Chrome extension. The output is unchanged.
