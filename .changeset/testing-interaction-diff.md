---
"@real-a11y-dev/testing": minor
---

Add the interaction-diff ergonomics — assert what an interaction **changed** in the a11y tree, the differentiator over element-querying. Two styles over one underlying diff (core's `diffTrees` rendered by `serializeTreeDiff`):

- **`capture(root)`** → `{ tree, focus }`, the before/after primitive; **`a11yDiff(before, after, opts?)`** boxes the change list for `expect(...).toMatchSnapshot()` / `.toMatchInlineSnapshot()`, rendered by the same serializer as `a11ySnapshot`. `after` may be a live `Element` (captured for you); a `focus:` line appears only when both sides carry focus context.

  ```ts
  const before = capture(container);
  fireEvent.click(screen.getByRole("combobox", { name: /country/i }));
  expect(a11yDiff(before, container)).toMatchInlineSnapshot(`
    + option "Spain"
    ~ combobox "Country": a11y.states.expanded false → true
  `);
  ```

- **`flow().expectChanges(spec | string | fn)`** — fluent, diffing everything since the chain's first action (resets after each call). The `ChangeSpec` form matches `added`/`removed`/`changed` by role + name, subset by default (`exact: true` asserts nothing else changed; a `childIds`-only container change is treated as the structural shadow of an add/remove and never counts as an extra). Also accepts the raw `serializeTreeDiff` string or a `(diff) => void` predicate.

Also re-exports `serializeTreeDiff` and `extract` from the main entry, for building custom before-trees. Internally, the snapshot-serializer box moved to its own module so `a11yDiff` and `a11ySnapshot` share one brand without the diff API pulling in the jest matcher augmentation — `a11ySnapshot` / `a11ySnapshotSerializer` / `registerA11yMatchers` are unchanged.
