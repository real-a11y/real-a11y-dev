---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

In the native tree, an indeterminate progress bar and a static separator no longer take their text as their name. `<div role="progressbar">Loading files</div>` printed `progressbar "Loading files"`, and `<div role="separator">Or</div>` printed `separator "Or"`. Both now print bare (`progressbar`, `separator`), as Chromium names them. Text inside a nested element, like `<div role="progressbar"><span>Loading</span></div>`, is covered too.

ARIA names a progress bar, meter, scrollbar or separator from its author only. The text inside one is fallback for its value, not its name. Chromium leaves them unnamed and reports a value for most of them, which already kept their text out. An indeterminate progress bar and a separator that can't be focused have no value, so their text still became a name. The native normalizer now lists all four roles among those it never names from text, as the DOM producer already did.

A label the author gave is kept: `<div role="progressbar" aria-label="Upload">` is still `progressbar "Upload"`. No audit rule reads these names, so no finding appears or disappears.

This affects the native tree only: `real-a11y tree` and the other native CLI commands, the MCP tools, and `testing`'s native producer. `NATIVE_AX_VOCABULARY_VERSION` goes to 7.

**Expect snapshot changes** on pages with a text-only indeterminate progress bar or a static separator with text: those nodes lose that text as their name.
