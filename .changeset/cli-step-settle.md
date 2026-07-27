---
"@real-a11y-dev/cli": minor
---

`--step-settle` — give a step's effect time to land before reading the page.

A dispatch returning is not the same as its effect having landed. A React state update flushes on a later tick, a dialog mounts on the next frame, and an immediate read reports "no changes" for a click that plainly did something:

```
setTimeout(() => location.href = "/b", 300)   # a deferred navigation
act() returned after 8ms
read done at 17ms  ->  diff: (no changes)     # the page was about to navigate
```

`--step-settle <ms>` (default `200`, the same debounce `@real-a11y-dev/testing`'s `flow()` already settled on) waits after **each** step, so it gates the next step's targeting as much as the final diff — a step that opens a menu has to have opened it before the step that clicks an item can resolve that item against a fresh tree. `0` opts out and reads immediately; `stepSettleMs` sets it project-wide, beside `settleMs`.

Deliberately separate from `--settle`, which waits once after the initial page load — conflating them would make one number serve two unrelated jobs, and `--settle`'s default of `0` is right for its job and wrong for this one.

It is a **heuristic wait, not a synchronisation point**. Nothing can tell you a page is _about_ to navigate, so a reaction landing later than the settle still won't appear, and "no changes" is never proof that nothing happened. A synchronous navigation was never affected either way: the dispatch already blocks until it commits.
