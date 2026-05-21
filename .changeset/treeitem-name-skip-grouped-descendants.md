---
"@real-a11y-dev/core": patch
---

Stop treeitem / menuitem / option / etc. accessible-name computation
from concatenating every nested row's text. The previous walker
recursed into all descendants for name-from-content, so a tree shaped
like

```html
<li role="treeitem">
  Reports
  <ul role="group">
    <li role="treeitem">report-1</li>
    <li role="treeitem">report-2 …</li>
  </ul>
</li>
```

reported the outer treeitem's name as `"Reports report-1 report-2
…"` — visible in the inspector panel on the WAI-ARIA APG Tree View
example surfaced by PR #80. Real assistive tech reads only `"Reports"`
for that row; each nested treeitem is a sibling with its own
announceable name.

Adds a `NAME_BARRIER_ROLES` set used while walking children for
`computeAccessibleName` and `computeAccessibleDescription`. Subtrees
whose computed role is a container (`group`, `list`, `menu`, `tree`,
`listbox`, `tablist`, `toolbar`, `treegrid`, `grid`, `table`,
`rowgroup`, `combobox`), a self-named row/item widget (`treeitem`,
`menuitem*`, `option`, `tab`, `listitem`, `row`, `cell`, `gridcell`,
`columnheader`, `rowheader`), an interactive widget (`button`, `link`,
`checkbox`, `radio`, `switch`, `slider`, `spinbutton`, `textbox`,
`searchbox`), or a display/live-region widget (`dialog`,
`alertdialog`, `tabpanel`, `alert`, `status`, `log`, `tooltip`,
`progressbar`, `meter`) contribute the empty string.

Inline formatting roles (`strong`, `emphasis`, `code`, `mark`, etc.)
and `heading` are intentionally **not** barriers — `<button>Save
<strong>changes</strong></button>` keeps its full label, and a
`<button><h3>…</h3></button>` card-style trigger still picks up the
heading text.
