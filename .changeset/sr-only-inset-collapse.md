---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Stop reading a decorative `clip-path: inset(...)` as the visually-hidden idiom.

The DOM extractor flags an element `dom.isHidden` when it carries the sr-only signature, one half of which is a `clip-path` that clips the box away to nothing. It recognised that by the string the value starts with — `inset(5` or `inset(1` — so it matched `inset(50%)` and `inset(100%)`, but equally `inset(10px)`, `inset(1em)`, `inset(50px)`, `inset(15%)` and anything else whose first component begins with a 1 or a 5. Those crop an edge off an element that stays fully visible.

So a `position: absolute` or `position: fixed` element with a decorative crop — a non-interactive one without a `tabindex`, which is all this signature ever looks at — read as content that is announced but not drawn.

The insets are now parsed, and the element counts as hidden only when they provably clip the box away: an opposing pair meets (`top + bottom >= 100%`, `left + right >= 100%`), or one inset of `100%` crosses the box on its own — the latter only when the edge opposite it is not negative, since a negative inset grows the shape instead (`inset(100% 0 -50% 0)` clips to a strip below the box, where overflowing content still paints). A length can't prove a collapse without the box's size, so it never counts — while a zero counts in any unit. A `calc()` on an edge the answer depends on is left alone rather than guessed at, and a nested function keeps its own parentheses, so `inset(50% calc(50% + 1px))` is read as the two components it is rather than cut at the `calc`'s own `)`.

What this changes for you, on a page with such a crop:

- **`dom.isHidden` is now `false`** on those elements, and a tree diff reports the change against a tree recorded before this release.
- **Snapshots and outlines:** such an element that is _not_ exposed to AT on its own — an unnamed `<div>` wrapper, say — was skipped by the tree walk on the strength of `isHidden` alone, and is now included. **A committed baseline from such a page changes, so re-record it.** An AT-exposed element was kept either way, so its presence is unchanged.
- **Cross-link inference** (`controls` / `controlledBy`) considers those elements as candidates again.

And in the other direction, because the rule now recognises collapses the prefix match missed — `inset(0 100%)`, `inset(60%)`, `inset(0px 40% 0px 60%)`, and in Chromium `rect(0 0 0 0)` / `xywh(0 0 0 0)`, which compute to `inset(0px 100% 100% 0px)`:

- **`dom.isHidden` is now `true`** on those, all correct per CSS. An unnamed wrapper carrying one **drops out** of snapshots and outlines, the mirror image of the bullet above — so a re-recorded baseline can lose nodes as well as gain them.

`cli` and `mcp` bundle `core`, so they are released with it and carry the fix in the one DOM-produced surface they have (`tabs` / `get_tab_order`). Nothing there changes in practice: this signature never looks at an interactive element or one with a `tabindex`, which is all a tab stop can be, and the tab sequence does not read `isHidden`.

Unchanged: the genuine idiom still reads as hidden, both halves of it — `clip-path: inset(50%)` / `inset(100%)`, and the classic `clip: rect(0, 0, 0, 0)` on a 1px box. Bootstrap's `.visually-hidden` and Tailwind's `sr-only` use exactly those, so neither is affected.
