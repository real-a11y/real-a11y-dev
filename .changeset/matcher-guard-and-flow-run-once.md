---
"@real-a11y-dev/testing": minor
---

Stop two ways a test suite could pass while lying to you.

**Matchers no longer go silent on a wrong-typed value.** The `instanceof Element` guards returned `{ pass: false }`, which is exactly what `.not` inverts — so `expect(container.firstChild).not.toHaveNoUnlabeledInteractive()` reported success without running the audit at all whenever `firstChild` was `null`. The guards now throw (as jest-dom does), which fails in both directions. Covers `toHaveTabSequence`, `toBeValidA11yTree`, `toMatchA11yContract`, and every assertion matcher.

**A `flow()` chain now executes exactly once.** `then()` called `run()` on every resolution and `run()` replays the whole step array, so `await chain` twice — or `Promise.all([chain, chain])`, or a stray double-await — re-dispatched every prior action: a second click on "Delete", a second form submit, corrupting the state under test. The run is memoized, and adding steps after the chain has been awaited now throws rather than silently doing nothing.

**Breaking change:** both fixes can turn a currently-green test red.

_Migration:_ a failure like `expected a DOM Element, received null` means that assertion was never actually running — pass a real element (the classic case is `container.firstChild` where you meant `container`). A failure like `cannot add steps after the chain has been awaited` means steps were being appended to an already-awaited chain; start a new `flow()` for those interactions. No change is needed for matchers given real elements, or for chains awaited once.
