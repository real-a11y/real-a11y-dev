---
"@real-a11y-dev/testing": patch
---

Snapshot an `a11yDiff` or `boxedTreeSnapshot` as its text even when the snapshot serializer isn't registered. Both return a box that prints as plain text only through the serializer `registerA11yMatchers` installs. Without that setup, `toMatchSnapshot()` stored the box object itself, brand key and all, and nothing failed:

```
// before
{
  "@real-a11y-dev/a11y-snapshot": true,
  "text": "~ textbox "Phone": a11y.states.invalid (unset) → true",
}
// after
"~ textbox "Phone": a11y.states.invalid (unset) → true"
```

The box now has a `toJSON()` that returns its text. Vitest and Jest call it on any value no snapshot serializer claims, so the snapshot holds the text as a quoted string, the way a `treeSnapshot` string does. With the serializer registered, nothing changes: it still prints the text plain. Two boxes with the same text are still `toEqual`.

What this changes for you:

- **Snapshots taken without the serializer:** a committed snapshot in the object form above no longer matches, and needs re-recording once. Registering the serializer gives the plain, unquoted form instead.
- **Setup docs:** the README now shows the setup next to `a11yDiff`, and says that `@real-a11y-dev/testing/matchers/vitest` only adds types: importing it registers nothing.
