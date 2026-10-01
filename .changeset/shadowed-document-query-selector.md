---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Find the audit root on a page that names an image `querySelector`. The document lets a named `<img>`, `<form>`, `<embed>` or `<object>` shadow its own members, and the in-page lookup that finds the root called `document.querySelector`. So on a page with `<img name="querySelector">` it threw before the tree was built — even with no `rootSelector`, since the default is the selector `"body"`.

- **`testing`:** every `attach(page)` call — `treeSnapshot()`, `outlineSnapshot()`, `tabSequenceSnapshot()` and every `assert*` — rejected with `TypeError: document.querySelector is not a function`. They now audit the page.
- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` reported the same failure as `Invalid rootSelector: "body"`, naming a selector nobody passed, and `tabs` exited 2. They now list the tab stops.

Pages without such a name are unaffected, and a `rootSelector` that matches nothing still fails loudly. `attach(page, { tree: "native" })` and the other `cli` / `mcp` commands never ran this lookup.
