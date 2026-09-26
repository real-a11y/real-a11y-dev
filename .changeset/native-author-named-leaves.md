---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

In the native tree, an image, dialog, landmark or form field no longer takes its text as its name. An unlabeled `<span role="img">🎉</span>` is now reported by `image-alt`. It used to pass.

Chromium names these roles from the author only: `alt`, `aria-label`, `aria-labelledby`, `<label>` or `title`. With none of those, Chromium leaves the name empty and puts the text on a child. The native normalizer then copied that text into the name whenever the element had no other children. So `<span role="img">🎉</span>` printed as `img "🎉"`, and `image-alt` skipped it because it had a name. The same happened to:

- `<div role="dialog">Unsaved changes</div>`, which printed `dialog "Unsaved changes"` and passed `dialog-labeled`
- `<div role="listbox"><label>Choose a plan</label></div>`, which printed `listbox "Choose a plan"` and passed `no-unlabeled-interactive`
- `<svg role="img"><text>Chart</text></svg>`, which printed `img "Chart"`
- a landmark whose only content is text, like `<footer>© 2026 Acme</footer>` or `<nav>Menu</nav>`

Each now prints bare (`img`, `dialog`, `listbox`, `contentinfo`), as Chromium names it, and the audit rule reports it. An element whose author did name it keeps that name: `<span role="img" aria-label="Party">🎉</span>` is still `img "Party"`.

The roles are images, dialogs and alert dialogs, the landmarks (`banner`, `complementary`, `contentinfo`, `form`, `main`, `navigation`, `region`, `search`), and the form fields that `no-unlabeled-interactive` checks and Chromium never names from content (`combobox`, `listbox`, `searchbox`, `slider`, `spinbutton`, `textbox`). A field's typed value no longer reaches its name at this step either; the CLI and MCP already removed it later.

Other elements still read their text as before. That covers list items, code, paragraphs, alerts, status messages, groups and articles, and controls Chromium names from their content, like a checkbox with its label inside it.

This affects the native tree only: `real-a11y tree`, `audit` and the other native CLI commands, the MCP tools, and `testing`'s native producer.

**Expect new findings and snapshot changes.** `audit` reports images, dialogs and fields that were silently passing. Native snapshots of pages with text-only landmarks, dialogs or `role="img"` lose those names.
