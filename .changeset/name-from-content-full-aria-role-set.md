---
"@real-a11y-dev/core": minor
---

Compute the accessible name from content for every role ARIA says supports it. The role whitelist behind step 8 of the name computation held eight roles — `button`, `link`, `heading`, `option`, `treeitem`, `tab`, `menuitem`, `cell` — while ARIA 1.2's `nameFromContent` list also contains `checkbox`, `radio`, `switch`, `menuitemcheckbox`, `menuitemradio`, `gridcell`, `columnheader`, `rowheader`, `row`, and `tooltip`. So

```html
<div role="checkbox"><span>Accept terms</span></div>
```

came out **nameless** where Chrome announces "Accept terms" — a custom control that reads fine in a screen reader, reported by the inspector, the audits, and `@real-a11y-dev/testing` as unlabeled. The gap only showed when the label sat inside a child element; markup with direct text children was caught by the fallback below the whitelist, which is how ten missing roles went unnoticed.

Naming from content is the opposite direction to the name **barrier** set, and most of these roles sit in both: a `gridcell` now names itself from its content and still contributes nothing to the name of the row containing it, exactly as `cell` and `treeitem` already did.

**Breaking change.** Elements with those ten roles gain accessible names they didn't have before, so stored snapshots, contract assertions, and unlabeled-control findings change for pages that use them.

_Migration:_ re-record affected baselines — re-run `real-a11y snapshot` for stored CLI artifacts, and update `toMatchSnapshot()` files with your runner's update flag (`vitest -u` / `jest -u`). An audit finding that disappears was a false positive: the control had a name all along and only this library couldn't see it. Trees with none of these roles, and ones whose labels are direct text children, are byte-identical to before.
