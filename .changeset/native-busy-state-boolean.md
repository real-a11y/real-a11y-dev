---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

Report `aria-busy="true"` as `busy: true` in a native tree. Chromium sends the `busy` state over CDP as a number under a boolean type, `{"type":"boolean","value":1}`, where every other boolean state arrives as `true` or `false`. The native producer turned that into the string `"1"`, so a native tree carried `a11y.states.busy: "1"` for the same element the DOM producer reports as `busy: true`.

The native producer now decodes a state by its CDP value type. A boolean-typed value is a boolean whatever its JSON type, and `0` reads as `false`. The tristate strings `"true"` / `"false"` still read as booleans, and `"mixed"` or a token such as `invalid`'s `"grammar"` stays a string. `busy` is the only property that arrives as a number in Chromium 151 and 153, checked across every ARIA state and property.

- **`cli` / `mcp` tree diffs:** after a step that sets `aria-busy`, `real-a11y interact` (and `click` / `type` / `focus`) and the `diff_tree` tool printed `~ region "Results": a11y.states.busy (unset) → "1"`. They now print `→ true`, the same line `a11yDiff` prints for a DOM tree. The `diff` string in `--format json` changes the same way.
- **Queries:** unaffected. `findByRole` has no `busy` filter, and `list` / `list_elements` don't read states.
- **Snapshots:** unchanged. An a11y snapshot prints roles and names, not states.
- **`testing`:** nothing it prints changes. `attach(page, { tree: "native" })` bundles the fixed producer, but its snapshots and assertions don't read `busy`.
