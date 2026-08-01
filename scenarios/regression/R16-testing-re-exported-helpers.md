---
id: R16
suite: regression
scenario: "Testing pkg — re-exported query/diff/interaction helpers are all importable and functional"
area: Testing
type: Automated
priority: P1
status: Active
validFrom: "testing ≥ 0.1.0-beta.11. Pairs with R2 — attw covers the types side of the dual-package hazard, step 9 here covers the runtime side"
validUntil: ""
expected: "findByRole, findAllByRole, linearize, getOutline, getTabSequence, diffTrees, extract, capture, a11yDiff, dispatch, waitForMutations all resolve and behave"
covers:
  - packages.@real-a11y-dev/testing
  - packages.@real-a11y-dev/core
  - packages.@real-a11y-dev/serialize
notion: "https://app.notion.com/p/3aa1c354b0b581149587e82deb0cb5c7"
---

## Steps

From the packed tarball in a scratch project, import each re-export and call it —
resolution alone is not enough, since a broken re-export can still resolve to
`undefined`.

```javascript
import {
  findByRole, findAllByRole, linearize, getOutline, getTabSequence,
  diffTrees, extract, capture, a11yDiff, dispatch, waitForMutations,
} from "@real-a11y-dev/testing";
```

1. Assert each is a **function**, not `undefined`
2. `findByRole` / `findAllByRole` — by role alone, and by role + name
3. Name matching: `"  Save\n Changes "` must match `"save changes"` (lowercased,
   whitespace-collapsed)
4. `linearize` — document order
5. `getOutline`, `getTabSequence`
6. `extract` → mutate → `extract` → `diffTrees`
7. `capture` / `a11yDiff`
8. `dispatch` a click, then `waitForMutations`
9. Repeat the imports under **CJS** `require()`

## Expected

- **1** — every name is a live function. A re-export that resolves to `undefined`
  throws only at call time, often in someone else's test suite
- **2/3** — normalization behaves; `findByRole` returns one, `findAllByRole` returns
  document-ordered matches
- **6** — the diff reports the mutation and nothing else
- **8** — `waitForMutations` resolves after the mutation settles, and doesn't hang
  when nothing changes
- **9** — CJS works too. The dual-package hazard is precisely what this catches

## Why this exists

These are re-exports, so they break in a way the source package's own tests never
see: the underlying function is fine, the export map is wrong. Step 1 exists because
"it imported" and "it works" are different claims — a barrel file with a typo'd name
resolves to `undefined` silently under ESM.

Step 9 pairs with **R2**: `attw` catches the types side of the dual-package hazard,
this catches the runtime side.
