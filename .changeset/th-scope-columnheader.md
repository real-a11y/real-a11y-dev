---
"@real-a11y-dev/core": minor
---

Resolve `<th>` to `columnheader` / `rowheader` the way HTML-AAM's auto
algorithm does, instead of treating every cell without `scope="col"` as a
`rowheader`.

The old rule was a single ternary — `scope === "col" ? "columnheader" :
"rowheader"` — so the overwhelmingly common markup

```html
<table>
  <thead>
    <tr>
      <th>Name</th>
      <th>Born</th>
    </tr>
  </thead>
  …
</table>
```

came out as two `rowheader`s. Chrome, Firefox, and HTML-AAM all expose those
as `columnheader`, so a plain `<thead>` table read back from the tree
described its own structure wrongly, and `scope="colgroup"` / `scope="rowgroup"`
were ignored outright.

The resolution is now:

- `scope="col"` or `scope="colgroup"` → `columnheader`
- `scope="row"` or `scope="rowgroup"` → `rowheader`
- no `scope` → the cell's position decides: a `<th>` inside `<thead>`, or in
  the table's first row when the table has no `<thead>`, is a `columnheader`;
  anything else (the leading `<th>` of a body row) stays a `rowheader`

Position is read with an ancestor walk and two `querySelector` calls — no
layout reads, so extraction cost is unchanged.

**Breaking change.** Trees extracted from tables whose header cells omit
`scope` now report `columnheader` where they previously reported `rowheader`.
If you have accessibility snapshots or `toMatchA11yTree`-style assertions
covering such a table, they will fail until re-baselined — the new role is the
one assistive technology actually announces. Re-record the snapshot
(`--update-snapshots`, or your suite's equivalent) to adopt it; if you assert
on roles directly, change the expected `rowheader` to `columnheader` for cells
in the header row. Tables that already spell out `scope="col"` / `scope="row"`
are unaffected.
