---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Separate a name-from-content child that has a box of its own with a space, instead of gluing it to the text beside it.

The DOM extractor appended each element child's contribution with no separator at all, so a label split across two blocks came out as one word: `<button><div>Save</div><div>now</div></button>` was named `"Savenow"`, and `<h1><p>One</p><p>Two</p></h1>` `"OneTwo"`. Chromium — and the screen reader reading it — announce "Save now" and "One Two". accname-1.2 §4.3.2 step 2F appends each descendant's result "with a space".

The rule is the one Chromium applies: **a child that has a box of its own separates the text either side of it, whether or not it lends the name any text.** Spacing therefore follows the child's computed `display`, and every case below matches what Chromium 141 computes for the same markup:

- **Spaced:** blocks, list items, table parts, and the atomic inline-level boxes (`inline-block`, `inline-flex`, `inline-table`), which Chromium separates even though they sit on the line. Flex and grid items, floats and absolutely positioned children come along with them, because CSS blockifies their computed `display`. A `<br>` now separates the text either side of it (`<a>Read<br>more</a>` is `"Read more"`, not `"Readmore"`), and so does an empty block (`<button>Save<div></div>now</button>`).
- **Spaced even though they lend no text:** a child that name-from-content skips but that still renders — a form control or other name-barrier element (`<h1>Save<input>now</h1>` is `"Save now"`), and a rendered `aria-hidden="true"` child.
- **Not spaced, so unchanged:** the inline boxes text really does flow into — `display: inline` (including a `<div>` an author styled that way), `inline list-item`, and the `ruby` family. `<button><span>Sa</span><span>ve</span></button>` is still `"Save"`, not `"Sa ve"`. A child with no box at all — `display: none`, `[hidden]` — separates nothing, and `display: contents` generates no box, so its children decide their own spacing.

The existing whitespace normalization collapses the padding, so no name gains a leading, trailing or doubled space.

**Expect snapshot changes** where a named element's label is split across children with boxes of their own: those names gain the spaces assistive technology announces. Re-record the affected baselines. Names built from inline children are byte-for-byte unchanged.

`cli` and `mcp` only change in the tab sequence (`real-a11y tabs`, the `get_tab_order` tool), the one view built by the in-page walk. Native trees are untouched.

Because the rule reads computed `display`, a name computed in jsdom can differ from the same markup in a browser where jsdom's CSS engine differs: jsdom does not blockify flex or grid items, floats or absolutely positioned children, and it gives `<select>` / `<textarea>` `display: inline` where Chromium gives `inline-block`. Those cases keep their old unspaced names under a jsdom-based matcher while a real browser spaces them.

Three differences from Chromium remain, all pre-existing and none about spacing: an `<img alt="…">` and an `<iframe title="…">` inside a name-from-content element still contribute nothing (Chromium reads the `alt` / `title`), and a `<wbr>`, which Chromium treats as a word separator, does not separate.
