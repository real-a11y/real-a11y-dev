---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Add a `childIds: false` option to `a11yDiff`, to leave out a container's `childIds` line when its `+`/`-` lines already explain it. When a node is added or removed, the diff also prints a count line for its container, and in a committed diff snapshot that line is mostly noise:

```ts
a11yDiff(before, after);
// + alert "Phone is missing."
// ~ main: childIds 1 child → 2 children

a11yDiff(before, after, { childIds: false });
// + alert "Phone is missing."
```

The line is left out only when every child the container gained or lost has its own `+`/`-` line and the children it kept stay in order. It still prints for a child that moved in from another container, which has no `+`/`-` line, for a reorder, and for a change that also reorders the children the container kept.

It is off by default, so nothing changes unless you pass it. The count line is also the only one that says which container a node joined: with two lists each gaining an item, only the count lines tell you which item went where.

`cli` and `mcp` re-release the bundled engine; their output is unchanged by this release. Their `interact` and checkpoint diffs use the same renderer, but never pass the option.
