---
"@real-a11y-dev/mcp": minor
"@real-a11y-dev/cli": minor
---

`BrowserSession` page-state queries are now close-aware.

`hasPage()` returns `false` once the tab has been closed, not just when no page was ever opened. `currentUrl()` and `currentEmulationKey()` route through it, so a closed tab reads as "no page" (`undefined` / `""`) instead of handing back the dead page's last URL or emulation signature. The internal page guard likewise throws "No page is open" for a closed page rather than returning a handle every operation on which would fail.

This changes behavior for consumers that relied on `currentUrl()` surviving a page close (e.g. recording a final URL after a navigation that closed the tab) — read the URL before closing, or fall back to the URL you navigated to, as the MCP server does. The motivation is session reuse: a daemon that reuses a `BrowserSession` across runs must treat a closed tab as "open a fresh page", never as a live page to act on.
