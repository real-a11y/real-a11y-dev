---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Resolve `role` the way Chromium does. The DOM producer took the first token of `role` whatever it said, so it kept roles Chromium's accessibility tree throws away. Each rule below was measured over CDP in Chromium 151 and 153, which agree:

- **An unknown or abstract token is skipped** for the next token, and with none left the element keeps its own role. `role="foo"` and `role="widget"` on a `<div>` are a `generic`, `<button role="foo">` is a `button`, and `role="foo button"` is a `button` named by its content. Tokens are read ASCII-case-insensitively — `role="BUTTON"` is a button — and the deprecated `directory` is a `list`.
- **`listitem`, `option` and `treeitem` need their container.** Outside `<ul>`/`<ol>`/`<menu>` or `role="list"`, `<select>` or `role="listbox"`, `role="tree"` — or a `role="group"` — the role is dropped for the next token or the element's own: a lone `<div role="listitem">` is a `generic`, `<details role="treeitem">` a `group`, `<li role="option">` in a list a `listitem`. Role-less `div`/`span`/custom-element wrappers and presentational elements may sit in between, and an `aria-owns` owner counts; anything else, such as a `<section>`, breaks the context. No other role is dropped for its context.
- **An `<li>` whose list carries a role other than `list` is presentational**, so `<ul role="none">` strips its items as well as itself.

Everything that follows the role follows too: an element's name from content, whether it folds out of the a11y view, and whether its text reaches an ancestor's name — `<button><span role="option">Apple</span> pie</button>` is now "Apple pie", as Chromium names it.

- **Snapshots:** a DOM-mode snapshot changes wherever one of these appears. `foo "x"` becomes the element's own role (for a `<div>`, the same `generic` a role-less one gives), an item outside its container loses its role, and the items of a `<ul role="none">` drop out. Re-record those baselines.
- **`toBeValidA11yTree`** still reports the role that was written, even once the element has folded out of the view: `"foo" is not a valid ARIA role`. A role the browser drops for its missing container is now an error — `role "listitem" is discarded outside its required context (directory / list)` — where it was at most an advisory warning, so markup like a lone `role="listitem"` or an `option` with a `<section>` between it and its listbox now fails. Put the item in its container, or remove the role. An uppercase role Chromium accepts (`role="BUTTON"`) is no longer reported as invalid. The audits (`collectFindings` and the `assert*` helpers) judge the corrected roles too.
- **`cli` / `mcp`:** only the tab sequence (`real-a11y tabs`, the `get_tab_order` tool) changes, as the one view built by the in-page walk. Native trees already reported Chromium's roles and are untouched.
