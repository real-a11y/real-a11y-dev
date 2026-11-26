---
"@real-a11y-dev/testing": patch
---

Set `a11yDiff`'s options once for the whole project. A suite that wants `{ childIds: false }` in every diff no longer has to pass it to every call, and a call that forgets it no longer records a snapshot the other way. Pass the defaults to `registerA11yMatchers` in the setup file:

```ts
// vitest.setup.ts
registerA11yMatchers(expect, {
  diff: { childIds: false, redact: [/\d{2}:\d{2}/] },
});

// a test
expect(a11yDiff(before, root)).toMatchSnapshot(); // childIds: false, times redacted
expect(a11yDiff(before, root, { childIds: true })).toMatchSnapshot(); // this call only
```

In a suite without the matchers, `configureA11y({ diff })` from `@real-a11y-dev/testing` does the same.

- A call's options win key by key, so `{ childIds: true }` keeps the project's `redact`. A call's `redact` replaces the project's list, and `redact: []` turns it off for that call.
- Each call that passes `diff` replaces the diff defaults; `{ diff: {} }` clears them.
- The defaults also apply to the text a `flow().expectChanges("…")` string is compared against and the diff a `ChangeSpec` failure prints, so both diff styles print alike. The snapshot report redacts an `a11yDiff` record with the same patterns as its text.
- The defaults hold across the package's entries and module formats, so a default set through `@real-a11y-dev/testing/matchers` in a Jest (CommonJS) setup file reaches `a11yDiff` imported from `@real-a11y-dev/testing`.

Nothing changes unless you set them: the built-in defaults are as before.

Also fixed: `a11yDiff` on two plain trees (`ExtractionResult`s) threw `ReferenceError: Element is not defined` where there is no DOM, such as a Node test environment. It now diffs them, as documented.
