---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

The DOM producer no longer reports an authored `aria-selected` or `aria-checked` on a role that does not support it. `<button aria-selected="true">` and `<a href aria-checked="true">` used to come out `selected` or `checked`; Chromium exposes neither, so assistive technology never announced them and the native tree (CLI, MCP) already showed none. `selected` is now kept on `option`, `row`, `tab`, `treeitem`, `gridcell`, `columnheader` and `rowheader`, and `checked` on `checkbox`, `radio`, `switch`, `menuitemcheckbox`, `menuitemradio`, `option` and `treeitem`. Panel badges, `findByRole(..., { selected })` and `{ checked }`, and `serializeTreeDiff` state changes can differ on markup that used these attributes on other roles.

`@real-a11y-dev/cli` and `@real-a11y-dev/mcp` bundle the same engine but read Chromium's own tree, so their output does not change.
