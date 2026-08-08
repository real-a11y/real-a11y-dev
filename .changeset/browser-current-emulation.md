---
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
---

`BrowserSession.currentEmulationKey()` — expose the current viewport/device emulation signature.

`BrowserSession.currentUrl()` was already used to decide whether a reused session page matched a new target. `currentEmulationKey()` extends that with the resolved emulation state, so a caller can detect when a command with different `--device` / `--viewport` flags needs a fresh context instead of silently reusing the wrong one.

Returns `""` when no page is open. Like `currentUrl()`, it is not queued and reads cached state.
