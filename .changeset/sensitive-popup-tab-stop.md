---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

The tab order no longer says which item a sensitive field's popup has chosen. Under a roving `tabindex` a popup's one tab stop is its chosen item, so although its `selected` was withheld, `real-a11y tabs` printed `option "03"` for a payment combobox's list box, and `button "31"` for a date grid's pressed day. Now a tab stop that is one of the items such a popup's choice is made among (a choice item, or anything inside one of its list boxes, grids, trees, menus or radio groups) reads `"[redacted]"`, with no description, in every surface that reads the tab order: `real-a11y tabs`, the MCP `get_tab_order` tool, `tabSequenceSnapshot` and the Playwright adapter's, `toHaveTabSequence`, `getTabSequence`, and the inspector, React and Storybook TAB views, whose search no longer finds it by its text. The popup's other controls (a dialog's `Cancel`) and the popup itself keep their names, and the tree still names every item, the chosen one beside the others. Strict mode (`redactInput`) does the same for an option in any list box.

The DOM producer marks such a node with a new optional `a11y.choiceWithheld: true`, which is what `getTabSequence` reads, so the tab order withholds the same stops wherever a tree is read, a panel's included. It appears on those nodes in JSON output.
