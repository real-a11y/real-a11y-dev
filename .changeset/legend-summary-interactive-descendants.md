---
"@real-a11y-dev/core": minor
---

Keep interactive descendants of `<legend>` and `<summary>` in the a11y tree. Both tags were suppressed with their **entire** subtree, on the reasoning that their text is already consumed as the `<fieldset>` / `<details>` accessible name. That holds for text, but not for controls: in

```html
<legend>Payment <a href="/help">(help)</a></legend>
<summary>Details <button>Copy</button></summary>
```

the link and the button are focusable and operable on the real page, yet were invisible in the inspector panel, uncounted by audits, and undispatchable by `testing`/`cli`/`mcp` — a keyboard-reachable control the tooling swore did not exist.

`<legend>` and `<summary>` now go through the same promotion the `<label>` branch already used: the element itself is still dropped, child subtrees that lead to an interactive descendant are promoted to the parent, and text-only children are still discarded so the name isn't duplicated as a stray `generic` row.

**Breaking change.** Pages with a link or button nested inside a `<legend>` or `<summary>` gain nodes they didn't have before, so stored snapshots and node counts for those pages will change. Migration: re-record the affected baselines — re-run `real-a11y snapshot` for stored CLI artifacts, and update `expect(a11ySnapshot(root)).toMatchSnapshot()` files with your runner's update flag (`vitest -u` / `jest -u`). The new nodes are the ones assistive technology exposes — if an audit now reports a finding on one of them, that finding was always there, just hidden. Trees with no interactive content inside a `<legend>`/`<summary>` are byte-identical to before.
