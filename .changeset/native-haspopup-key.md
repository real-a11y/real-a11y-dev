---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

The native tree now keys a node's popup property as `haspopup`, not `hasPopup`. `a11y.properties.hasPopup` was Chromium's own spelling, and every other key, and the printed `{haspopup=menu}`, is the ARIA attribute name without `aria-`, in lowercase. Code that reads a native tree's `a11y.properties` as data, such as a `@real-a11y-dev/testing` helper that takes a native tree from Playwright, now finds `haspopup`; read that key where you read `hasPopup`. The key was never documented, so this is a patch. The printed tree text that `cli` and `mcp` return, and the text of saved snapshots and contracts, is unchanged, except for the whitespace-only `roledescription` case below.

A native node whose `aria-roledescription` is empty or only whitespace no longer carries a `roledescription` property, and so no longer prints one in the tree text: WAI-ARIA 1.2 says user agents must not expose one. `@real-a11y-dev/testing`'s validator now reads a property back under its real attribute name, so a node with `haspopup` validates with `aria-haspopup` and one with the media `captions` flag no longer gets a stray `aria-captions`.

`inspector`, `react` and `storybook-addon` also bundle the engine and take a size-budget increase, but they read no native tree and the DOM tree they build is unchanged, so they take no entry.
