---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

The native tree reads an unlabeled `<input type="file">` as `button ""`, not Chromium's own "Choose File" ("Choose Files" with `multiple`). HTML-AAM gives the input no name and the DOM producer already read it that way; Chromium's button text had hidden the input from `no-unlabeled-interactive`, so `real-a11y audit`, the MCP audit tool and `@real-a11y-dev/testing` with `{ tree: "native" }` reported nothing, and `--redact-input` printed `[redacted]`. Both audit paths now report one `no-unlabeled-interactive` finding for it, a title-only file input included (Chromium makes its `title` the description). The built-in name is found by Chromium's name trace, so it works in any locale; names from `aria-label`, a `<label>` or `aria-labelledby` are untouched. Saved native snapshots, and any native-tree lookup that matched "Choose File", change: the normalized vocabulary version moves from 13 to 14.
