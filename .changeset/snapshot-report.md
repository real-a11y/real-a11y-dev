---
"@real-a11y-dev/testing": minor
---

Add the **snapshot report**: `@real-a11y-dev/testing/reporter` for Vitest and `@real-a11y-dev/testing/reporter/jest` for Jest, reporters that draw every boxed snapshot of a run the way the Semantic Navigator panel draws a tree, in one HTML page.

A snapshot's text leaves much of the tree out, by design: it prints a short list of states, and nothing about what an element takes. The report shows the rest. Add the reporter, and after every run `a11y-snapshots/index.html` lists each `boxedTreeSnapshot()` and `a11yDiff()` snapshot by test file and test:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    reporters: ["default", "@real-a11y-dev/testing/reporter"],
  },
});
```

```js
// jest.config.js
module.exports = {
  reporters: ["default", "@real-a11y-dev/testing/reporter/jest"],
};
```

- **A tree snapshot** is a tree you can open and close, with each row's states and what it takes, the panel's filters, and the TAB view.
- **A diff** opens on its after tree with what changed marked: new rows, changed rows with the field that changed, and a count of rows removed. The before tree is one click away.
- **The snapshot's text** sits beside it, its `+`, `-` and `~` lines coloured.

The page is one self-contained file that opens from disk, so it also works as a CI artifact. A rerun in watch mode replaces only the records of the files it ran. `outputDir` moves it (default `"a11y-snapshots"`, relative to Vitest's `root` or Jest's `rootDir`). The reporters need Vitest 3 or later, or Jest 29 or later, and Node 20.16 or later.

What this changes for you:

- **Nothing, unless you add the reporter.** It changes no `.snap` text, which is still what a test asserts. The report never fails a run.
- **A record carries nothing typed into the page.** It carries the tree's states, as the text does, but no field value, even where the snapshot printed one with `values: true` (the text beside the tree still shows it), and nothing inside a rich-text editor. Sensitive fields stay masked, `redactInput: true` withholds every value as it does from the text, and a snapshot's `redact` patterns apply to everything in a record the page supplied (names, descriptions, text and attribute values), never to its node ids, roles, `tabindex`, heading levels or states.
- **Only boxed snapshots appear.** A snapshot of a plain string, such as `expect(treeSnapshot(el)).toMatchSnapshot()`, has no tree behind it; snapshot `boxedTreeSnapshot(el)` instead. A record is named after its test, which the reporter reads from the `expect` given to `registerA11yMatchers(expect)`, or the runner's own. Concurrent tests aren't recorded: their shared `expect` can't say which of them took a snapshot.
- **The report deletes only what it wrote.** Pointed at an `outputDir` whose `records/` folder it didn't make, it leaves that folder alone and records nothing. An `index.html` it didn't write stays as it is, and the run says so.
- **`REAL_A11Y_TREES_DIR`** is the switch the reporter sets for its run: while it is set, each boxed snapshot also writes the tree behind it to that directory as JSON. Set it yourself only to keep those records without the reporter.
