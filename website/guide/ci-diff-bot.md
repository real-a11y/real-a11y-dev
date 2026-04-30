---
title: CI A11y Diff Bot — PR comments when the a11y tree changes
description: Snapshot every audited page on PR vs main and post a sticky comment summarizing what changed. Templates for Next.js, Vite, static sites, and pnpm monorepos.
---

# CI A11y Diff Bot

Post a PR comment whenever the accessibility tree of any audited page changes. The bot catches regressions that no linter can: roles disappearing, labels silently emptied, landmarks removed, dialogs becoming unreachable.

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
  - auditSnapshot()   - auditSnapshot()
        │                   │
        └────────┬──────────┘
                 ▼
           diff + comment
         (updated on every push)
```

Two jobs run in parallel — one on `main`, one on the PR branch. A third job diffs the text output of `auditSnapshot()` and **posts or updates a single sticky comment** on the PR.

## What the comment looks like

**No changes:**
> ✅ A11y tree unchanged — No accessibility tree changes detected in this PR.

**Changes detected:**
> 🔍 A11y tree changed — **3 lines added, 1 removed**
>
> <details><summary>Show full diff</summary>
>
> ```diff
> ## Home
>
>  form "Contact form"
> -  textbox "" (no label)
> +  textbox "Full name"
> +  textbox "Email address"
> +  textbox "Message"
>    button "Send message"
> ```
> </details>

The comment is **updated in place** — not spammed. If the PR is fixed and re-pushed, the comment updates to ✅.

---

## Setup

### 1. Install

```sh
# npm
npm install -D @real-a11y-dev/testing @playwright/test
npx playwright install chromium

# pnpm
pnpm add -D @real-a11y-dev/testing @playwright/test
pnpm exec playwright install chromium

# yarn
yarn add -D @real-a11y-dev/testing @playwright/test
yarn playwright install chromium
```

### 2. Drop in the snapshot script

Copy this file into your repo at `scripts/a11y-snapshot.mjs` — it's yours to customize, version-control, and extend as your audit grows:

```js
// scripts/a11y-snapshot.mjs
//
// Visits each configured page with Chromium and captures the accessibility
// tree, heading outline, and tab sequence from @real-a11y-dev/testing.
// Reads `A11Y_PAGES` and `A11Y_SNAPSHOT_OUT` from the environment.

import { chromium } from "@playwright/test";
import { attach } from "@real-a11y-dev/testing/playwright";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outFile = process.env.A11Y_SNAPSHOT_OUT
  ?? resolve(process.cwd(), "a11y-snapshots.md");

const pages = process.env.A11Y_PAGES
  ? JSON.parse(process.env.A11Y_PAGES)
  : [{ name: "Home", url: "http://localhost:3000" }];

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext();
const page = await context.newPage();

const sections = [];
for (const { name, url, rootSelector } of pages) {
  console.log(`  auditing: ${name}  (${url})`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const sn = await attach(page, rootSelector ? { rootSelector } : {});
    const [audit, outline, tabs] = await Promise.all([
      sn.auditSnapshot(),
      sn.outlineSnapshot(),
      sn.tabSequenceSnapshot(),
    ]);
    sections.push([
      `## ${name}`, "",
      `<!-- id: ${slugify(name)} -->`, "",
      "### A11y tree", "", "```", audit, "```", "",
      "### Heading outline", "", "```", outline || "(no headings)", "```", "",
      "### Tab sequence", "", "```", tabs || "(nothing focusable)", "```", "",
    ].join("\n"));
  } catch (err) {
    sections.push([`## ${name}`, "", `> ⚠️ Snapshot failed: ${err.message}`, ""].join("\n"));
  }
}

// Deliberately no generation timestamp in the file — including one would
// make every PR's diff show a "change" even when the a11y tree is byte
// identical, because the base + PR snapshot jobs run a few seconds apart.
// CI logs and Git already record run/commit time.
writeFileSync(
  outFile,
  `# A11y Snapshots\n\n` + sections.join("\n"),
  "utf8",
);
console.log(`\n✓ Snapshots written to ${outFile}`);
await browser.close();
```

Then wire it into your `package.json`:

```json
{
  "scripts": {
    "a11y:snapshot": "node scripts/a11y-snapshot.mjs"
  }
}
```

Run it locally whenever you want:

```sh
npm run a11y:snapshot
```

Output goes to `a11y-snapshots.md` by default — add that to `.gitignore`.

> **Why an owned script?** `@real-a11y-dev/testing/playwright` is the public surface — `attach()` plus the handle methods. Your snapshot *policy* (which pages, what order, how to redact, whether to fail on network errors) belongs in your repo, not in a dependency.

### 3. Add the workflow

> **Land steps 1 and 2 on `main` first.** The workflow runs `npm run a11y:snapshot` against **both** the PR head **and** the base branch. If the script and its devDependencies don't yet exist on `main`, the `Snapshot (base)` job fails with `Missing script: a11y:snapshot` (or an `ECONNREFUSED` from `npm ci` if the lockfile points at a private registry). The diff comment never posts and you'll think the workflow is broken.
>
> Order of operations:
>
> 1. PR (or direct commit) to `main`: install `@real-a11y-dev/testing` + `@playwright/test`, add `scripts/a11y-snapshot.mjs`, add the `a11y:snapshot` npm script. **No workflow yet.**
> 2. Once that's merged, open a second PR adding `.github/workflows/a11y-diff.yml`. Both jobs now have the tooling they need.

Create `.github/workflows/a11y-diff.yml`. Pick the template that matches your project:

- [Next.js (dev server)](#template-nextjs)
- [Vite / CRA SPA (preview server)](#template-vite)
- [Static site (serve build output)](#template-static)
- [pnpm monorepo](#template-pnpm-monorepo)

All templates call the same two helpers — `npm run a11y:snapshot` (your owned script) for the snapshot job, `actions/github-script` for the PR comment. Only the "start the app" step changes.

---

## Configuration

The CLI reads its inputs from environment variables.

| Variable | Default | Description |
|---|---|---|
| `A11Y_PAGES` | (library fixtures) | JSON array of `{ name, url, rootSelector? }` objects describing each page to audit. |
| `A11Y_SNAPSHOT_OUT` | `a11y-snapshots.md` | Absolute or relative path where the markdown report is written. |

### `A11Y_PAGES` shape

```jsonc
[
  { "name": "Home",       "url": "http://localhost:3000" },
  { "name": "Login",      "url": "http://localhost:3000/login" },
  // Optional: narrow the audit to a subtree
  { "name": "Header nav", "url": "http://localhost:3000", "rootSelector": "header" },
  { "name": "Main",       "url": "http://localhost:3000", "rootSelector": "main"   }
]
```

`rootSelector` is a CSS selector passed to `attach()`. Scope-narrowed audits are useful when only part of a page is relevant to the PR (a component, a form, a specific region).

---

## Workflow templates

Each template shares the same final step — a **diff & comment** job that downloads both snapshot artifacts and posts the sticky PR comment. That step is identical across setups and is shown once at the end of this section.

### <a id="template-nextjs"></a>Next.js (dev server)

> Using `output: "export"` in `next.config`? `next start` errors out with *"does not work with output: export"* — use the [Static site](#template-static) template instead, which serves the build output via `npx serve`.

```yaml
# .github/workflows/a11y-diff.yml
name: A11y Tree Diff

on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

env:
  PAGES_JSON: |
    [
      { "name": "Home",  "url": "http://localhost:3000" },
      { "name": "About", "url": "http://localhost:3000/about" }
    ]

jobs:
  snapshot-base: &snapshot
    name: Snapshot (base)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.base_ref }}

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - run: npx playwright install chromium --with-deps

      - name: Start Next.js dev server
        run: npx next dev -p 3000 &

      - name: Wait for server
        run: npx wait-on http://localhost:3000 --timeout 120000

      - name: Generate a11y snapshots
        run: npm run a11y:snapshot
        env:
          A11Y_PAGES: ${{ env.PAGES_JSON }}
          A11Y_SNAPSHOT_OUT: ${{ github.workspace }}/base-snapshots.md

      - uses: actions/upload-artifact@v4
        with:
          name: base-snapshots
          path: base-snapshots.md
          if-no-files-found: error

  snapshot-pr:
    <<: *snapshot
    name: Snapshot (PR)
    steps:
      - uses: actions/checkout@v4
      # … rest identical to snapshot-base except for A11Y_SNAPSHOT_OUT
      #   (use pr-snapshots.md) and the artifact name (pr-snapshots).

  # See “Diff & comment” step below.
```

### <a id="template-vite"></a>Vite / CRA SPA (preview server)

Same structure as Next.js — only the build + serve step differs:

```yaml
      - run: npm run build

      - name: Serve built SPA
        run: npx vite preview --port 3000 &
        # For CRA: npx serve -s build -l 3000 &

      - name: Wait for server
        run: npx wait-on http://localhost:3000 --timeout 120000
```

### <a id="template-static"></a>Static site (serve build output)

For static exports (Next.js `output: "export"`, Astro, SvelteKit adapter-static, etc.):

```yaml
      - run: npm run build

      - name: Serve static output
        run: npx serve ./out -l 3000 &
        # Replace ./out with ./dist / ./build / ._site as appropriate.

      - name: Wait for server
        run: npx wait-on http://localhost:3000 --timeout 120000
```

### <a id="template-pnpm-monorepo"></a>pnpm monorepo

Replace `actions/setup-node`'s npm cache with pnpm's action and update the install / build steps:

```yaml
      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      # Build + serve the app that hosts your a11y:snapshot script,
      # e.g. if it lives in apps/web:
      - run: pnpm --filter web build
      - run: pnpm --filter web start &

      - name: Wait for server
        run: npx wait-on http://localhost:3000 --timeout 120000

      - name: Generate a11y snapshots
        run: pnpm --filter web a11y:snapshot
        env:
          A11Y_PAGES: ${{ env.PAGES_JSON }}
          A11Y_SNAPSHOT_OUT: ${{ github.workspace }}/base-snapshots.md
```

### <a id="diff-and-comment"></a>Shared: diff & comment job

```yaml
  diff-and-comment:
    name: Diff & comment
    needs: [snapshot-base, snapshot-pr]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: base-snapshots
      - uses: actions/download-artifact@v4
        with:
          name: pr-snapshots

      - name: Compute diff
        id: diff
        run: |
          diff --unified=3 base-snapshots.md pr-snapshots.md > a11y.diff || true
          echo "has_diff=$([ -s a11y.diff ] && echo true || echo false)" >> $GITHUB_OUTPUT

      - name: Post sticky PR comment
        uses: actions/github-script@v7
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          script: |
            const fs = require('fs');
            const hasDiff = '${{ steps.diff.outputs.has_diff }}' === 'true';
            const MARKER = '<!-- real-a11y-diff -->';

            let body;
            if (!hasDiff) {
              body = `${MARKER}\n## ✅ A11y tree unchanged\n\nNo accessibility tree changes detected in this PR.`;
            } else {
              const diff = fs.readFileSync('a11y.diff', 'utf8');
              const added   = (diff.match(/^\+[^+]/gm) || []).length;
              const removed = (diff.match(/^-[^-]/gm) || []).length;
              const MAX = 60_000;
              const diffBlock = diff.length > MAX
                ? diff.slice(0, MAX) + '\n... (truncated — see artifacts for full diff)'
                : diff;
              body = [
                MARKER,
                '## 🔍 A11y tree changed',
                '',
                `**${added} line${added !== 1 ? 's' : ''} added, ${removed} removed** — review to confirm changes are intentional.`,
                '',
                '<details><summary>Show full diff</summary>',
                '',
                '```diff',
                diffBlock,
                '```',
                '',
                '</details>',
              ].join('\n');
            }

            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find(c => c.body?.includes(MARKER));

            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body,
              });
            }
```

---

## Output format

Each page produces three blocks: the a11y tree, the heading outline, and the tab sequence. Example:

```markdown
## Home

### A11y tree
main ""
  heading "Welcome" (level 1)
  form "Newsletter"
    textbox "Email"
    button "Subscribe"

### Heading outline
h1 Welcome
  h2 Featured
  h2 Latest

### Tab sequence
01. link "Skip to content"
02. link "Home"
03. textbox "Email"
04. button "Subscribe"
```

Deterministic — the same DOM always produces the same bytes. Safe to commit as a fixture if you'd rather diff against a static file than against `main`.

---

## What it catches

| Regression | Caught? |
|---|---|
| Input loses its label | ✅ |
| Role changed (`button` → `div`) | ✅ |
| Landmark removed (`<main>` deleted) | ✅ |
| Heading level skipped | ✅ (outline section) |
| Focusable element removed from tab order | ✅ (tab sequence section) |
| Dialog no longer has accessible name | ✅ |
| ARIA state silently cleared | ✅ |

---

## Combine with assertions

The diff bot tells you *something changed* — pair it with `assertHeadingOrder`, `assertNoUnlabeledInteractive`, etc. to fail the build immediately on known-bad patterns:

```ts
// playwright.config.ts — runs on every PR via the e2e job
test("page meets structural requirements", async ({ page }) => {
  await page.goto("http://localhost:3000");
  const sn = await attach(page);

  await sn.assertHeadingOrder();
  await sn.assertNoUnlabeledInteractive();
  await sn.assertLandmarkStructure();
});
```

The diff bot catches _unexpected regressions_; the assertions catch _known-bad patterns_. Together they give you defense in depth.
