# Snapshot viewer (private)

Draws the trees behind a11y test snapshots in the same panel the extension,
the inspector and the Storybook addon use, with the states, actions and
change marks that the `.snap` text leaves out.

It reaches users two ways, and this package is never published. Its `vite
build` (one classic script and one stylesheet) ships in `testing`'s `dist/viewer`,
where **`@real-a11y-dev/testing/reporter`** inlines it, with the run's records,
into one HTML page. The same build ships in `cli`'s `dist/viewer`, where
**`real-a11y show-report`** serves it next to the records as they change. User
docs: <https://real-a11y.dev/packages/testing/snapshots#the-snapshot-report>.

## How it works

1. **Recording.** While `REAL_A11Y_TREES_DIR` is set (the reporter sets it for
   its run), every boxed snapshot a test takes (`boxedTreeSnapshot` or
   `a11yDiff`) also writes the tree it was printed from to
   `<dir>/<test file>/<test name>-<n>.json`. A diff saves both the before and
   the after tree. See `packages/testing/src/snapshot-record.ts`.
2. **Viewing.** The app lists every record by test file and draws the selected
   one with `TreePanel`. A diff opens on the after tree with what changed
   marked, and switches to the before tree. The snapshot text sits alongside.
   In the report the records come inlined (`window.__A11Y_SNAPSHOTS__`). Under
   `show-report` and the dev server they come from `GET /__records`, and
   `GET /__records/events` (server-sent events) says when to read them again.

## Develop it

```bash
# Records to look at: run the Vitest example, whose config adds the reporter
pnpm --filter @real-a11y-dev/example-testing test

# The dev server, reading those records and reloading when they change
REAL_A11Y_TREES_DIR="$(git rev-parse --show-toplevel)/examples/testing-vitest/a11y-snapshots/records" \
  pnpm --filter @real-a11y-dev/snapshot-viewer dev
```

Then open <http://localhost:5310>. Without `REAL_A11Y_TREES_DIR` it reads
`<repo>/.a11y-trees`. `pnpm --filter @real-a11y-dev/snapshot-viewer build`
writes the files `testing`'s build copies.
