---
title: CI A11y Diff Bot — PR comments when the a11y tree changes
description: Snapshot your pages on the base branch and on the PR, compare them with real-a11y diff, and post the result as one PR comment that updates on every push.
---

# CI A11y Diff Bot

A GitHub Actions workflow that comments on each pull request with what changed in the accessibility of the pages you list: new and fixed findings, plus structural changes such as a heading level, a renamed button or a removed landmark.

It runs two [`@real-a11y-dev/cli`](/packages/cli) commands. `real-a11y snapshot` audits a set of pages into one JSON file, and `real-a11y diff` compares two of those files. The diff matches findings by a stable fingerprint rather than by line, so re-indented markup or a renumbered selector doesn't show up as a change.

## How it works

```
PR opened / pushed
       │
  ┌────┴─────────────────┐
  │                      │
  ▼                      ▼
Snapshot (base)     Snapshot (PR)
  - checkout main     - checkout HEAD
  - install deps      - install deps
  - start server      - start server
  - real-a11y         - real-a11y
    snapshot            snapshot
        │                   │
        └────────┬──────────┘
                 ▼
        real-a11y diff + comment
         (updated on every push)
```

The two snapshot jobs run in parallel and upload `base.json` and `pr.json`. A third job compares them and creates or updates a single comment on the PR.

## 1. Install the CLI

The CLI drives Chrome through Playwright, which it takes as an optional peer dependency:

```sh
npm i -D @real-a11y-dev/cli playwright
```

Locally, `npx real-a11y install` downloads a browser. The workflow below uses `npx playwright install chromium --with-deps` instead, because on Linux it also installs the system libraries Chrome needs.

## 2. List your pages

Add an `a11y.config.json` at the root of the repo:

```json
{
  "urls": [
    "http://localhost:3000/",
    "http://localhost:3000/about",
    { "name": "Login", "url": "http://localhost:3000/login" }
  ]
}
```

`real-a11y snapshot` with no URL reads this file from the directory it runs in. A page is matched between base and PR by its URL path, so the two sides can run on different hosts or ports. Entries can also take an `id`, and the file can hold a `defaults` block for flags such as `rules` and `device`: see the [config reference](/packages/cli/configuration).

Leave `failOn` out of the config. A config default applies to every command that takes the flag, `snapshot` included, so the snapshot job would fail on findings `main` already has and never upload its file. Gate on the diff instead ([below](#fail-the-pr-on-new-findings)).

Try it locally with `npx real-a11y snapshot -o base.json`, and add `base.json` and `pr.json` to `.gitignore`.

> **Merge this step to `main` before adding the workflow.** The base job checks out `main` and runs `snapshot` there. If the config or the CLI isn't on `main` yet, that job fails (`snapshot needs URLs to audit`, or no `real-a11y` command) and no comment is posted.

## 3. Add the workflow

```yaml
# .github/workflows/a11y-diff.yml
name: A11y diff

on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write # create and update the comment

jobs:
  snapshot:
    name: Snapshot (${{ matrix.side }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        side: [base, pr]
    steps:
      - uses: actions/checkout@v7
        with:
          # base: the branch the PR targets. pr: empty, so the PR's merge commit.
          ref: ${{ matrix.side == 'base' && github.base_ref || '' }}
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install chromium --with-deps

      # Build and start your app. These are the steps to adapt.
      - run: npm run build
      - run: npx serve dist -l 3000 &
      - run: npx wait-on http://localhost:3000 --timeout 120000

      - run: npx real-a11y snapshot -o ${{ matrix.side }}.json
      - uses: actions/upload-artifact@v7
        with:
          name: ${{ matrix.side }}-snapshot
          path: ${{ matrix.side }}.json
          if-no-files-found: error

  diff:
    name: Diff & comment
    needs: snapshot
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci # diff only reads two files: no browser needed
      - uses: actions/download-artifact@v8
        with:
          pattern: "*-snapshot"
          merge-multiple: true

      # The full diff goes to the job log, and a shorter copy to the comment.
      - run: npx real-a11y diff base.json pr.json --explain --fail-on never
      - run: npx real-a11y diff base.json pr.json --format md --explain --fail-on never --max-pages 5 --max-lines 20 -o comment.md

      - uses: actions/github-script@v9
        with:
          script: |
            const fs = require("fs");
            const MARKER = "<!-- real-a11y-diff -->";
            const body = `${MARKER}\n${fs.readFileSync("comment.md", "utf8")}`;
            const { owner, repo } = context.repo;
            const issue_number = context.issue.number;
            const { data: comments } = await github.rest.issues.listComments({ owner, repo, issue_number });
            // Match the bot AND a marker on the first line: a page's text can
            // quote the marker, and it ends up inside the comment body.
            const mine = comments.find(
              (c) => c.user?.login === "github-actions[bot]" && c.body?.startsWith(MARKER),
            );
            if (mine) {
              await github.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body });
            } else {
              await github.rest.issues.createComment({ owner, repo, issue_number, body });
            }
```

`--explain` adds the plain-language lines under **Structure** in the comment. `--max-pages` and `--max-lines` keep a large change readable; the comment then points to the job log for the rest. If a page shows content that changes on every build, such as a timestamp, add `--ignore-view-line '<regex>'` to both diff steps so it doesn't read as a change.

### Adapting it

Only the steps that build and start the app differ between projects:

- **Vite**: `npx vite preview --port 3000 &` after the build. For Create React App, `npx serve -s build -l 3000 &`.
- **Next.js**: `npx next start -p 3000 &` after the build. With `output: "export"`, `next start` won't run; serve the export with `npx serve out -l 3000 &`.
- **Other static sites** (Astro, Eleventy, SvelteKit's static adapter): `npx serve <output folder> -l 3000 &`.
- **A dev server**: skip the build and start it in the background, for example `npx next dev -p 3000 &`. Its first requests compile, so keep the `wait-on` timeout generous.
- **pnpm**: add `pnpm/action-setup` before `setup-node`, then use `cache: pnpm`, `pnpm install --frozen-lockfile` and `pnpm exec real-a11y`. In a monorepo, build and start the app the config points at, for example `pnpm --filter web build` and `pnpm --filter web start &`.
- **Another port**: change the URLs in `a11y.config.json` and in the `wait-on` step.

## Fail the PR on new findings

`--fail-on never` keeps the diff job green so the comment always posts. To also fail the PR, add a last step:

```yaml
      - run: npx real-a11y diff base.json pr.json # exits 1 on a new error
```

Only findings the PR introduces can fail it. Findings already on `main`, fixed findings and structural changes never do. Add `--fail-on warning` to fail on new warnings as well.

## What the comment looks like

For a PR that drops an input's label and turns an `h2` into an `h3`, `diff` writes this (shortened):

````md
### Accessibility diff

**Findings** (gate CI): 1 new · 0 changed · 0 fixed
**Structure** (advisory): changed on 1 page — new or reordered headings, landmarks, or tab stops

#### Home

- ❌ **new** `no-unlabeled-interactive`: Unlabeled interactive element: textbox <input>

**Structure (advisory — never blocks merge):**

- Heading level changed: "Setup" h2 → h3
- Interactive element removed: textbox "Email"
- Interactive element added: textbox (no accessible name)

_tree_

```diff
@@ -1,6 +1,6 @@
 main
   heading "Shop" (level 1)
   heading "Plans" (level 2)
-  heading "Setup" (level 2)
-  textbox "Email"
+  heading "Setup" (level 3)
+  textbox
   button "Subscribe"
```
````

**Findings** come from the six audit rules and can fail the build. **Structure** covers changes that break no rule, and never fails it. When nothing changed, both lines say so.

Tab order isn't compared: `snapshot` reads Chromium's accessibility tree, which has no tab order, so every diff notes that the tabs view wasn't compared. For keyboard order, use [`real-a11y tabs`](/packages/cli/commands#tabs-url).

## Other formats

`snapshot` can also write SARIF for GitHub's Security tab, JUnit, JSON Lines, or a Markdown report with `--md`; `diff` can write JSON. See [`snapshot`](/packages/cli/commands#snapshot-url) and [`diff`](/packages/cli/commands#diff-base-json-pr-json) in the command reference, and [In CI](/packages/cli#in-ci) for the code-scanning setup.

To fail a test on a known-bad pattern rather than on a change, use the assertions in [`@real-a11y-dev/testing`](/packages/testing) inside your end-to-end tests.
