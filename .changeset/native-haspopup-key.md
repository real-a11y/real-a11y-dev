---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

The native tree now keys a node's popup property as `haspopup`, not `hasPopup`. `a11y.properties.hasPopup` was Chromium's own spelling, and every other key, and the printed `{haspopup=menu}`, is the ARIA attribute name without `aria-`, in lowercase. The JSON that `tree`, `audit` and the MCP tools return, and `@real-a11y-dev/testing`'s native mode, carry `haspopup`; read that key where you read `hasPopup`. The key was never documented, so this is a patch, but it is data you receive. The printed tree text is unchanged.

A native node whose `aria-roledescription` is empty or only whitespace no longer carries a `roledescription` property: WAI-ARIA 1.2 says user agents must not expose one. `@real-a11y-dev/testing`'s validator now reads a property back under its real attribute name, so a node with `haspopup` validates with `aria-haspopup` and one with the media `captions` flag no longer gets a stray `aria-captions`.

`inspector`, `react` and `storybook-addon` also bundle the engine, but they read no native tree and the DOM tree they build is unchanged, so they take no entry.
