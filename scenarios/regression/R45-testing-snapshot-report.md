---
id: R45
suite: regression
scenario: "Testing pkg — the snapshot report: Vitest and Jest reporters write one page drawing every boxed snapshot as the panel's tree"
area: Testing
type: Manual
priority: P1
status: Active
validFrom: "testing ≥ 0.1.0-beta.24 (installed from the packed tarball, not a workspace link)"
validUntil: ""
expected: "after a run, a11y-snapshots/index.html opens from disk and lists every boxed snapshot and a11yDiff snapshot, a tree with its states, a tab sequence on the TAB view, an outline on its headings, and a diff with its changes marked; Jest loads the reporter through require; a rerun replaces only the files it ran; no field value the text didn't print reaches a record, a password never does; the library entries still bundle for the browser"
covers:
  - packages.@real-a11y-dev/testing
  - env.REAL_A11Y_TREES_DIR
notion: ""
---

## Steps

Install the **packed tarball** into a scratch project with Vitest 3+ and jsdom,
and a second one with Jest 29+, `ts-jest` and `jest-environment-jsdom`, CommonJS
(no `"type": "module"`). Each registers the matchers in its setup file with
`registerA11yMatchers(expect)`.

Fixture: a form with a filled text field (`value="VALUE-SENTINEL"`), a filled
`type="password"` field (`value="PW-SENTINEL"`), a heading, a button and a link.
Tests:

- **tree** — `expect(boxedTreeSnapshot(root)).toMatchSnapshot()`
- **diff** — `capture(root)`, then insert `<div role="alert" tabindex="-1">` with
  a message before the form, set `aria-invalid="true"` on the text field, focus
  the alert, and `expect(a11yDiff(before, root)).toMatchSnapshot()`
- **values** — `boxedTreeSnapshot(root, { values: true })`
- **plain** — `expect(treeSnapshot(root)).toMatchSnapshot()`
- **redacted** — a button named `Order 4821-7730`, snapshotted with
  `boxedTreeSnapshot(root, { redact: [/\d{4}-\d{4}/] })`
- **tabs** _(testing ≥ the first release after 0.1.0-beta.24)_ —
  `expect(boxedTabSequenceSnapshot(root)).toMatchSnapshot()`
- **outline** _(same)_ — `expect(boxedOutlineSnapshot(root)).toMatchSnapshot()`

1. Vitest: add `reporters: ["default", "@real-a11y-dev/testing/reporter"]` and
   run `vitest run` with `REAL_A11Y_TREES_DIR` unset
2. Open the printed `file://` link in Chrome, straight from disk
3. Select the **diff** record, then **Before**, then the TAB view
4. `grep -r "VALUE-SENTINEL\|PW-SENTINEL\|4821-7730" a11y-snapshots/`
   - _(testing ≥ the first release after 0.1.0-beta.24)_ Then select the
     **tabs** record, then the **outline** record, then switch its Headings
     filter off
5. In watch mode (`vitest`), edit the **tree** test's file so it reruns alone
6. Jest: add `reporters: ["default", "@real-a11y-dev/testing/reporter/jest"]`
   and run `jest`, then again with two test files and `--maxWorkers=2`, then
   `jest --watch` and edit one of the two files so it reruns alone
7. With `{ outputDir: "." }` in a folder holding its own `records/` and
   `index.html`, run the tests again
8. Bundle the library entry for the browser:
   `npx esbuild node_modules/@real-a11y-dev/testing/dist/index.js --bundle --platform=browser --outfile=/dev/null`
   (and the same for `dist/matchers.js`)

## Expected

- **1** — the run passes as before and ends with
  `a11y snapshots  4 recorded → file:///…/a11y-snapshots/index.html` (`6
  recorded` with the **tabs** and **outline** tests). The **plain** test isn't
  among them: a string snapshot has no tree behind it. The **tabs** and
  **outline** `.snap` entries hold the lines `tabSequenceSnapshot` and
  `outlineSnapshot` print, unquoted
- **2** — the page renders with no console error and no server: a list by test
  file and test, TREE and DIFF badges, and the selected record's tree with
  `interactive` / `focusable` badges on the controls
- **3** — the diff opens on its after tree, the alert marked `new` and the text
  field marked `changed` with `invalid`; a bar counts them. **Before** shows the
  tree without the alert. The TAB view lists the tab stops in order. The text
  pane shows the `.snap` text with `+` and `~` lines coloured
- **4** — `VALUE-SENTINEL` appears **only** in the **values** record's
  snapshot text (its `text`), never in a tree; `PW-SENTINEL` appears nowhere,
  the password reading `[redacted]` even there; `4821-7730` appears nowhere, the button reading
  `Order [REDACTED]`. The **tabs** record, badged TABS, opens on the TAB view
  with the tab stops in order; the **outline** record, badged OUTLINE, opens
  on the A11Y view with the Headings filter pressed and only the heading
  listed; switching the filter off shows its whole tree
- **5** — the page is written again; the rerun file's records are replaced and
  the other files' are still listed
- **6** — Jest loads the reporter through `require`, prints the same line, and
  writes the same page; with two files on two workers, both files' records are
  there; after the watch rerun, both are still listed
- **7** — the run passes, warns that the folder holds files the report didn't
  write, and leaves `records/` and `index.html` as they were
- **8** — both bundles build. Neither may import `fs`, `path` or `url`: those
  belong to the reporters alone

## Why this exists

The report's job is to show what a snapshot's text leaves out, and two ways it
can do harm came up while building it:

- **A record carrying what its text left out on purpose.** The first version
  wrote whole trees, so a field's typed value reached the JSON — and the page —
  though the snapshot's text, printed without `values: true`, held none. Step 4
  is the guard: a sentinel in a plain field must reach a record only as the
  text the snapshot printed, and a password never.
- **The reporter's Node code leaking into the library.** Building the reporter
  with tsup's `shims` alongside the library entries put `path` and `url` imports
  into a chunk every entry shares, so `@real-a11y-dev/testing` would have
  stopped bundling for the browser. Only `size-limit` noticed. Step 8 checks the
  shipped files directly, since the workspace build is not what a user installs.

Jest gets its own steps because it loads reporters through `require` and runs
files in forked workers, two paths the Vitest run never exercises.
