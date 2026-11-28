---
id: R49
suite: regression
scenario: "Testing pkg — `recordTimeline` records focus moves and live-region announcements in the order the page made them"
area: Testing
type: Automated
priority: P1
status: Active
validFrom: "testing ≥ 0.1.0-beta.25. The live-region text it prints comes from `pageText` in `core`, which is PRIVATE and bundled, so assert against the published package only."
validUntil: ""
expected: "a delete that drops focus reads focus / announce / focus (none) / announce / focus, in order; a status set and cleared in one block prints nothing; the same text again prints nothing until the region empties; `{ announcements: false }` and `{ focus: false }` each print one half; both off throws; the main entry imports in plain Node; with `{ interactions: true }` a Tab, a click and typing print press / click / type lines in order, and nothing typed reaches a line"
covers:
  - packages.@real-a11y-dev/testing
notion: ""
---

## Steps

From the packed tarball in a scratch Vitest project (`environment: "jsdom"`,
`registerA11yMatchers(expect)` in a setup file), mount:

```html
<main>
  <p role="status" id="s"></p>
  <ul><li>Draft <button id="d">Delete draft</button></li></ul>
  <button id="n">New draft</button>
</main>
```

`tick` is `() => new Promise((r) => setTimeout(r, 0))`.

1. Focus `#d`, then `const timeline = recordTimeline(main)`. Set `#s` to
   `"Deleting…"`, `await tick()`. Remove `#d`'s `<li>` and set `#s` to `""`,
   `await tick()`. Set `#s` to `"Draft deleted."` and focus `#n`.
   `expect(timeline.stop()).toMatchInlineSnapshot()`
2. A fresh recorder: set `#s` to `"Saving…"` then `""` in one synchronous block,
   `await tick()`, stop
3. A fresh recorder: set `#s` to `"Saved."`, tick, set it to `"Saved."` again,
   tick, set it to `""`, tick, set it to `"Saved."`, tick, stop
4. Step 1 again with `{ announcements: false }`, then with `{ focus: false }`
5. `recordTimeline(main, { focus: false, announcements: false })`
6. In a plain Node script (no jsdom), `import { recordTimeline } from
   "@real-a11y-dev/testing"`, then `require` it under CJS
7. Add `<label>Password <input type="password" id="pw"></label>` to `main`
   and give `#n` a click listener that sets `#s` to `"Saved."`. Focus `#d`,
   then `const timeline = recordTimeline(main, { interactions: true })`.
   Dispatch a `keydown` for `Tab` on `#d` and focus `#n`, `await tick()`.
   `fireEvent.click(#n)`, `await tick()`. Focus `#pw`, and for each
   character of `"hunter2"` dispatch a `keydown` with it as the key, append
   it to the value and dispatch an `input` with it as `data`, with an
   `await tick()` after each. Stop. Then run step 1 again unchanged

## Expected

- **1** — exactly, in this order:
  ```
  focus     button "Delete draft"
  announce  status "Deleting…"
  focus     (none)
  announce  status "Draft deleted."
  focus     button "New draft"
  ```
  `focus     (none)` is the drop to `<body>` when the focused button was removed,
  which jsdom fires no event for
- **2** — `(nothing recorded)`: text set and cleared in one synchronous run
  never rendered, so it is never announced. (Separated by an `await`, even of a
  resolved promise, the two writes are read apart and the first prints; the
  docs say so.)
- **3** — two `announce  status "Saved."` lines, not three
- **4** — the three `focus` lines alone, then the two `announce` lines alone
- **5** — throws a `TypeError` saying it records nothing
- **6** — both import without touching a DOM global; `recordTimeline` is a function
- **7** — exactly, in this order, and `hunter2` (or any one of its
  characters as a key) nowhere in it:
  ```
  focus     button "Delete draft"
  press     Tab
  focus     button "New draft"
  click     button "New draft"
  announce  status "Saved."
  focus     textbox "Password"
  type      textbox "Password"
  ```
  One `type` line for seven keystrokes, and no `press` line for any of them.
  Step 1 run again without the option prints the same five lines as before:
  interactions are off by default

## Why this exists

A diff sees the page at two moments, so a focus drop or a status that comes and
goes between them passes every other snapshot. This is the one helper that sees
the sequence, and the sequence is the whole claim it makes: an order that comes
out wrong is a wrong answer, not a cosmetic one.

Step 7 exists because a `type` line sits one property read away from the
text it must never print (ADR-0001), and because interactions are opt-in: a
release that turned them on by default would move every committed timeline.

Step 6 exists because the first build of this feature read a DOM prototype at
module scope, which made the whole main entry throw on import in plain Node,
for every caller, not only the ones that record a timeline. The surface
extractor caught it; nothing in the jsdom suites could.
