---
id: R14
suite: regression
scenario: "Testing pkg — flow() interaction chain + expectTree/expectChanges"
area: Testing
type: Automated
priority: P1
status: Active
validFrom: "testing ≥ 0.1.0-beta.11. flow()'s ~200ms settle is the same problem the CLI's --step-settle solves (cli ≥ 0.1.0-beta.2)"
validUntil: ""
expected: "click/type/select/toggle/submit all dispatch; a chain runs exactly once even if awaited twice; failures name the first differing line"
covers:
  - packages.@real-a11y-dev/testing
notion: "https://app.notion.com/p/3aa1c354b0b58162a033c8231ca8d360"
---

## Steps

1. `flow(root).click(...)` — a button that mutates the DOM
2. `.type(...)` into a **React-controlled** input, not a plain one
3. `.select(...)`, `.toggle(...)`, `.submit(...)`
4. Chain several verbs and `await` the chain
5. `await` the **same** chain object a second time
6. `expectTree(...)` against the post-flow tree, once matching and once not
7. `expectChanges(...)` for an expected delta, and for one that didn't happen
8. A flow whose effect lands asynchronously (`setTimeout`, a transition)
9. A flow targeting an element that isn't there
10. Read the failure text from 6, 7 and 9

## Expected

- **2** — the framework registers the value. Writing `.value` directly does not
  notify React; it must go through the prototype setter plus `input`/`change`
- **4** — verbs run in order, each seeing the previous one's effect
- **5** — the chain runs **exactly once**. A second `await` must not re-dispatch —
  re-running a submit is a real-world foot-gun
- **6/7** — mismatches name the **first differing line**, not a wall of diff
- **8** — the flow settles before asserting. It debounces (~200ms) for exactly this
- **9** — an actionable failure naming what it looked for, not a null dereference
- **10** — each message is usable by someone who didn't write the test

## Why this exists

`flow()` is the interaction story for people who never touch the CLI, so its
failures are read by test authors under time pressure.

Two subtleties worth deliberate checking:

- **Idempotent await** (5). Chain objects that are thenable and stateful re-run if
  awaited twice — easy to write, invisible until a `.submit()` fires two orders.
- **Async settling** (8). This is the same class of problem the CLI's
  `--step-settle` exists for: a dispatch returning is not the effect having landed.
  `flow()` is where the 200ms debounce was first found to be necessary.
