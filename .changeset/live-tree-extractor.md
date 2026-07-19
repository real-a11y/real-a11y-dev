---
"@real-a11y-dev/core": minor
"@real-a11y-dev/semantic-navigator-extension": minor
"@real-a11y-dev/react": minor
"@real-a11y-dev/storybook-addon": minor
---

Add `LiveTreeExtractor` for incremental DOM and accessibility tree updates.

`@real-a11y-dev/core` now exposes a `LiveTreeExtractor` class that keeps the
previous extraction in memory and re-extracts only the dirty subtrees reported
by `DomObserver`. It falls back to a full extraction when a mutation can affect
non-local accessibility state (modal/portal scope, `id`, `aria-labelledby`,
`aria-describedby`, `for`, etc.). The result is the same `ExtractionResult`
shape as `extractA11yTree` / `extractDomTree`.

`DomObserver` callbacks now receive an optional `TreeChange` payload containing
the accumulated `MutationRecord`s and synthetic dirty roots from `input`/`change`
events, which `LiveTreeExtractor.refresh(change)` consumes.

The Chrome extension, React `useSemanticTree` hook, and Storybook addon preview
have been wired to use `LiveTreeExtractor` so live updates avoid a full page
re-extraction when only a small region changed.
