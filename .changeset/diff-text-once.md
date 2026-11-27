---
"@real-a11y-dev/testing": minor
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

`a11yDiff` prints a text change once. When an element's text changed and the text is its name before and after, the diff printed the same news twice, as an `a11y.name` line and a `dom.textContent` line with the same two strings. A live region announcing a message always got the pair. It now prints the `a11y.name` line alone:

```
// was
~ status "That hour is closed.": a11y.name "" → "That hour is closed."
~ status "That hour is closed.": dom.textContent "" → "That hour is closed."

// now
~ status "That hour is closed.": a11y.name "" → "That hour is closed."
```

When the two differ, both lines still print. A button whose `aria-label` stays put while its text changes prints only its `dom.textContent` line, as before. So does a name from `aria-labelledby`, or one that also reads text in nested elements.

**Breaking change.** A check that compares against the printed diff can fail where it held the pair:

- **Snapshots:** a committed `a11yDiff` snapshot that holds such a pair loses its `dom.textContent` line. Re-record it (`vitest -u`, `jest -u`).
- **`flow().expectChanges("…")` strings:** one that lists the pair fails until you delete its `dom.textContent` line.

What does not change: `diffTrees` still lists both `a11y.name` and `dom.textContent` in a change's `changes`, so a `ChangeSpec` that asks for `changes: ["dom.textContent"]` still matches. A diff you pass to `serializeTreeDiff` with `a11y.name` filtered out of `changes` still prints its `dom.textContent` line, since no name line says it.

`cli` and `mcp` re-release the bundled renderer; their output is unchanged by this release. Their `interact` and checkpoint diffs compare native trees, which carry no `dom.textContent`.
