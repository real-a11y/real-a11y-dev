---
title: CI A11y Diff Bot — PR comments when the a11y tree changes
description: Snapshot every audited page on PR vs main and post a sticky comment summarizing what changed. Templates for Next.js, Vite, static sites, and pnpm monorepos.
---

# CI A11y Diff Bot

Post a PR comment whenever the accessibility tree of any audited page changes. The bot catches regressions that no linter can: roles disappearing, labels silently emptied, landmarks removed, dialogs becoming unreachable.

It's built on the shipped [`@real-a11y-dev/cli`](/packages/cli): `real-a11y snapshot` audits a whole page set into one diffable JSON artifact, and `real-a11y diff` classifies the findings between two artifacts as **new / changed / fixed** — an identity-aware comparison, not a raw text diff.

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

Two jobs run in parallel — one on `main`, one on the PR branch — and each writes a JSON snapshot artifact. A third job runs `real-a11y diff` on the two artifacts and **posts or updates a single sticky comment** on the PR.

Because the diff is **finding-identity-aware** (each finding carries a stable `v1:` fingerprint), it ignores the DOM churn that defeats a line diff — re-indentation, a renumbered `:nth-of-type` locator, an inserted sibling — and reports only the violations that actually appeared, changed, or were fixed.

## What the comment looks like

The header reports **two separate axes** — _findings_ (the accessibility
problems that gate CI) and _structure_ (the shape of the semantic tree, always
advisory). Keeping them apart means an all-clean findings line next to a moved
structure never reads as a contradiction: adding a valid new section changes the
structure without introducing a single new finding.

**No changes:**
> ### Accessibility diff
>
> **Findings** (gate CI): 0 new · 0 changed · 0 fixed — none changed
>
> **Structure** (advisory): unchanged

**Changes detected:**
> ### Accessibility diff
>
> **Findings** (gate CI): 2 new · 0 changed · 1 fixed
>
> **Structure** (advisory): changed on 2 pages — new or reordered headings, landmarks, or tab stops
>
> **Pages with a11y changes (2):** `Home`, `Settings`
>
> #### Home
>
> - ❌ **new** `no-unlabeled-interactive`: Unlabeled interactive element: button &lt;button&gt;
> - ✅ **fixed** `heading-order`: Heading level skipped: h1 → h3
>
> **Structure (advisory — never blocks merge):**
>
> - Heading level changed: "Setup" h2 → h3
> - Keyboard tab stop added: link "Skip to setup" (now stop 2 of 14)
>
> _tree_
> ```diff
> @@ -3,7 +3,8 @@
>      link "About"
> -    button "Toggle theme"
> +    button "Switch to dark mode"
>      link "Cambiar a español"
> ```

A **route index** lists every page that changed; findings lead (they're the
gate); then the **plain-language statements** any reviewer can verify — press
<kbd>Tab</kbd>, glance at the heading — and a **real unified diff** (context +
order + indentation, color-coded so a PR email keeps the green/red). The
comment caps at the first 5 routes and 20 diff lines each; the **full diff is
always in the job log** (the workflow prints it uncapped) and linked from the
comment footer. Even changes no line diff can see get a statement: a *pure
reorder* of the tab
order adds or removes no lines, but reads as
`Keyboard tab order changed: 4 stops moved (same 14 stops)`.

The comment is **updated in place** — not spammed. If the PR is fixed and re-pushed, the comment updates to `0 new`. Only **new** findings can fail the build (`diff` exits `1` at/above `--fail-on`); pre-existing debt and fixes never block a PR — structural statements are always advisory.

---

## Setup

### 1. Install

The CLI drives a real browser through Playwright, which ships as an **optional peer** — install it alongside the CLI and fetch the Chromium binary once:

```sh
# npm
npm i -D @real-a11y-dev/cli playwright
npx playwright install chromium

# pnpm
pnpm add -D @real-a11y-dev/cli playwright
pnpm exec playwright install chromium

# yarn
yarn add -D @real-a11y-dev/cli playwright
yarn playwright install chromium
```

`diff` is pure — it reads two JSON files and never launches a browser — so only the snapshot jobs need Chromium.

### 2. Describe your pages in `a11y.config.json`

Your snapshot *policy* — which pages, which rules, what to fail on — lives in your repo as `a11y.config.json`, not in a copy-pasted script. `real-a11y snapshot` auto-discovers `./a11y.config.json` (or takes `--config <file>`):

```json
{
  "urls": [
    "http://localhost:3000",
    "http://localhost:3000/about",
    { "name": "Header nav", "url": "http://localhost:3000", "rootSelector": "header" }
  ],
  "rules": ["no-unlabeled-interactive", "image-alt", "heading-order", "dialog-labeled", "landmark-structure"],
  "failOn": "error"
}
```

A `urls` entry is a bare URL string (its `name` — the diff's join key — defaults to the URL) or an object when you need a custom `name`, a `rootSelector` (narrows the audit to a subtree), or a `sourcePath` (for the [Security tab](#findings-in-the-security-tab-sarif)). See [Configuration](#configuration) for every key. Give every entry an explicit `name` when base and PR are served from different hosts or ports — otherwise the names default to URLs that never match, and [`diff`](/packages/cli/commands#diff-base-json-pr-json) warns that it compared nothing.

Run it locally whenever you want — the output is a single JSON artifact:

```sh
npx real-a11y snapshot --output base.json
```

Add the snapshot artifacts (`base.json`, `pr.json`) to `.gitignore` — they're build outputs, not fixtures.

> **The `attach()` testing helpers still exist.** `@real-a11y-dev/testing/playwright` — `attach()` plus `auditSnapshot()`/`outlineSnapshot()`/`tabSequenceSnapshot()` — is the in-test surface for assertions inside your Playwright suite (see [Combine with assertions](#combine-with-assertions)). For *structural CI diffing*, point at the CLI: one command captures every page's findings and views into a diffable artifact, and `real-a11y diff` does the finding-aware comparison for you.

### 3. Add the workflow

> **Land step 2 on `main` first.** The `Snapshot (base)` job checks out `main` and runs `real-a11y snapshot` there, so **`a11y.config.json` and the `@real-a11y-dev/cli` devDependency must already exist on `main`.** If they don't, the base job fails (`snapshot needs URLs to audit`, or a missing `real-a11y` binary), the diff comment never posts, and you'll think the workflow is broken.
>
> Order of operations:
>
> 1. PR (or direct commit) to `main`: install `@real-a11y-dev/cli` + `playwright`, add `a11y.config.json`. **No workflow yet.**
> 2. Once that's merged, open a second PR adding `.github/workflows/a11y-diff.yml`. Both snapshot jobs now find the config and the CLI on the branch they check out.

Create `.github/workflows/a11y-diff.yml`. Pick the template that matches your project:

- [Next.js (dev server)](#template-nextjs)
- [Vite / CRA SPA (preview server)](#template-vite)
- [Static site (serve build output)](#template-static)
- [pnpm monorepo](#template-pnpm-monorepo)

All templates call the same two commands — `npx real-a11y snapshot` for the snapshot jobs, `npx real-a11y diff` (plus `actions/github-script` for the sticky comment) for the diff job. Only the "start the app" step changes.

---

## Configuration

`real-a11y snapshot` reads its page list from `a11y.config.json` (auto-discovered in the working directory, or `--config <file>`). For drop-in compatibility it also honors two environment variables, which take precedence when set:

| Variable | Default | Description |
|---|---|---|
| `A11Y_PAGES` | (config file) | JSON array of `{ name, url }` objects. When set, it overrides the config's `urls` — handy for inlining the page list in the workflow. `rootSelector`, `sourcePath`, and the other policy keys are config-only. |
| `A11Y_SNAPSHOT_OUT` | *(stdout)* | Fallback output path when `--output` / `-o` is omitted. |

### `a11y.config.json` shape

The config is strict and **fail-closed** — an unknown or typo'd key is a hard error, so a mistake can't silently un-gate CI.

| Key | Required | Description |
|---|---|---|
| `urls` | ✅ (or `A11Y_PAGES`) | The routes to audit. Each entry is a URL **string**, or an object `{ url, name?, rootSelector?, sourcePath? }`. `name` is the diff join key (defaults to the URL, so keep URLs stable across base/PR); `rootSelector` scopes the audit to a subtree; `sourcePath` is the repo file findings anchor to for SARIF (see [the Security tab](#findings-in-the-security-tab-sarif)). Formerly `pages` — still accepted. |
| `rules` | | Subset of the five rules — `no-unlabeled-interactive`, `image-alt`, `heading-order`, `dialog-labeled`, `landmark-structure`. Omit to run all. |
| `failOn` | | `error` \| `warning` \| `never`. |
| `device` | | Device to emulate, e.g. `"iPhone 13"` — audit the mobile layout. |
| `defaults` | | Set any CLI flag once for every command (`device`, `waitUntil`, `rules`, …) — see the [CLI reference](/packages/cli#configure-once). |
| `redact` | | Array of regex strings scrubbed from output before it's written. |

```jsonc
{
  "urls": [
    "http://localhost:3000",
    { "name": "Login", "url": "http://localhost:3000/login" },
    // Optional: narrow the audit to a subtree
    { "name": "Header nav", "url": "http://localhost:3000", "rootSelector": "header" },
    // Optional: anchor SARIF findings to the route's source file
    { "name": "About", "url": "http://localhost:3000/about", "sourcePath": "src/pages/about.tsx" }
  ]
}
```

---

## Workflow templates

Each template shares the same final step — a **diff & comment** job that downloads both snapshot artifacts, runs `real-a11y diff`, and posts the sticky PR comment. That step is identical across setups and is shown once at the end of this section.

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

      - name: Generate a11y snapshot
        run: npx real-a11y snapshot --output "$GITHUB_WORKSPACE/base.json"

      - uses: actions/upload-artifact@v4
        with:
          name: base-snapshot
          path: base.json
          if-no-files-found: error

  snapshot-pr:
    <<: *snapshot
    name: Snapshot (PR)
    steps:
      - uses: actions/checkout@v4
      # … rest identical to snapshot-base except for --output
      #   (use pr.json) and the artifact name (pr-snapshot).

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

      # Build + serve the app whose pages a11y.config.json points at,
      # e.g. if it lives in apps/web:
      - run: pnpm --filter web build
      - run: pnpm --filter web start &

      - name: Wait for server
        run: npx wait-on http://localhost:3000 --timeout 120000

      - name: Generate a11y snapshot
        run: pnpm exec real-a11y snapshot --output "$GITHUB_WORKSPACE/base.json"
```

### <a id="diff-and-comment"></a>Shared: diff & comment job

`real-a11y diff --explain` renders the finding-aware comparison straight to Markdown (`--format md`) — findings first, then the plain-language structural statements per page with the color-coded raw `+`/`-` diff inline beneath them — and the job posts it as the sticky comment. (`--explain` is opt-in: the bare `diff` is neutral — findings plus the raw view diff — and the bot turns on the plain-language layer for reviewers.) `--fail-on never` keeps the comment purely advisory so it *always* posts — drop it (or add a second `npx real-a11y diff base.json pr.json` step) to also fail the build on **new** findings.

If your pages render generated content that differs on every build (a "last
updated" timestamp, a build hash), add `--ignore-view-line '<regex>'` to the
diff invocation so it doesn't read as drift on every page.

Want a leaner comment? `--only findings` posts just the findings delta and
`--only views` just the structural diff. It's an output filter — the exit
gate still runs on the full result, so a gating `--only views` step can fail
the build on a new finding while the comment shows only structure (the
one-line findings summary explains why).

```yaml
  diff-and-comment:
    name: Diff & comment
    needs: [snapshot-base, snapshot-pr]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci # `diff` is browser-free — no `playwright install` needed here

      - uses: actions/download-artifact@v4
        with:
          name: base-snapshot
          path: .
      - uses: actions/download-artifact@v4
        with:
          name: pr-snapshot
          path: .

      - name: Diff snapshots
        run: npx real-a11y diff base.json pr.json --format md --fail-on never -o comment.md

      - name: Post sticky PR comment
        uses: actions/github-script@v7
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          script: |
            const fs = require('fs');
            const MARKER = '<!-- real-a11y-diff -->';
            const body = MARKER + '\n' + fs.readFileSync('comment.md', 'utf8').trim();

            // Sticky comment: match on the marker as the FIRST line AND our own
            // bot author. `includes()` is hijackable — an accessible name that
            // quotes the marker inside any comment would collide; `startsWith`
            // + author can't.
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const mine = comments.find(
              (c) =>
                c.user?.login === 'github-actions[bot]' &&
                c.body?.startsWith(MARKER),
            );

            if (mine) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: mine.id,
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

> The `snapshot-pr` job is `snapshot-base` with the PR checkout (`actions/checkout@v4` with no `ref`), `--output "$GITHUB_WORKSPACE/pr.json"`, and the artifact named `pr-snapshot`.

---

## Output format

`real-a11y snapshot` writes **one JSON artifact** per run. For each page it captures the fingerprinted findings plus the serialized semantic tree, heading outline, and tab sequence — and that JSON is exactly what `real-a11y diff` consumes (the findings are what it compares). The envelope is stable (`schemaVersion: 1`), deterministic (no timestamps, LF-only), and each finding carries a `v1:` fingerprint:

```json
{
  "schemaVersion": 1,
  "tool": { "name": "@real-a11y-dev/cli", "version": "…" },
  "pages": [
    {
      "name": "Home",
      "url": "http://localhost:3000/",
      "findings": [
        { "rule": "no-unlabeled-interactive", "severity": "error",
          "fingerprint": "v1:5ccd8ffcbc43cd09", "…": "…" }
      ],
      "tree": "main\n  heading \"Welcome\" (level 1)\n  …",
      "outline": "h1 Welcome\n  h2 Featured\n  …",
      "tabs": "01. link \"Skip to content\"\n02. …"
    }
  ]
}
```

Pass `--md` for a human-readable report instead — the semantic tree, heading outline, and tab sequence per page, as Markdown:

```markdown
## Home

### A11y tree
main
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

The JSON — not the Markdown — is what you feed into `diff`. Reach for `--md` when a human wants to read a single snapshot.

---

## What it catches

| Regression | Caught? |
|---|---|
| Input loses its label | ✅ (new `no-unlabeled-interactive` finding) |
| Image loses its alt text | ✅ (new `image-alt` finding) |
| Landmark removed (`<main>` deleted) | ✅ (new `landmark-structure` finding) |
| Heading level skipped | ✅ (new `heading-order` finding) |
| Dialog no longer has accessible name | ✅ (new `dialog-labeled` finding) |
| Role changed (`button` → `div`) | ✅ (structural tree diff) |
| Focusable element removed from tab order | ✅ (`Keyboard tab stop removed: … — still on the page but no longer keyboard-focusable`) |
| Tab order reordered (no lines added/removed) | ✅ (`Keyboard tab order changed: N stops moved`) |
| ARIA state silently cleared | ✅ (structural tree diff) |

The five rules surface as **findings** (new / changed / fixed); shape-only shifts that don't trip a rule — a landmark or heading change, a new tab stop, a role swap, a reordered tab sequence — surface as advisory **plain-language statements** per page, with the raw tree / outline / tabs line diffs inline beneath them (`--format json` exposes both, as `pages[].structural` and `pages[].views`).

---

## Findings in the Security tab (SARIF)

The bot posts a **PR comment**; you can _also_ surface a11y findings in GitHub's **Security → Code scanning** tab. `real-a11y snapshot --format sarif` emits [SARIF 2.1.0](https://sarifweb.azurewebsites.net/), and `github/codeql-action/upload-sarif` sends it to code scanning — each finding carries a stable `v1:` fingerprint, so alerts dedupe across runs.

Two things make it land well:

- **Anchor findings to source.** A code-scanning result attaches to a **repo file**, so give each route a `sourcePath` in `a11y.config.json` pointing at its source (a route file, template, or component). Without one, every finding anchors to the config file itself.
- **Scan the _default branch_, not just PRs.** The Security tab shows the **default branch's** analyses — a PR-scoped upload only appears under a `?query=pr:<n>` filter. So run the SARIF upload on **push to your default branch** (a weekly schedule keeps it fresh even when only content changes):

```yaml
# .github/workflows/a11y-code-scan.yml — a companion to the diff bot
name: A11y Semantic Scan
on:
  push: { branches: [main] }
  schedule: [{ cron: "0 6 * * 1" }] # weekly — catch content drift
  workflow_dispatch: {}
permissions:
  contents: read
  security-events: write # upload SARIF to code scanning
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # …install deps, build, and start your site (as in the templates above)…
      - run: npx real-a11y snapshot --config a11y.config.json -f sarif -o a11y.sarif
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: a11y.sarif
          category: real-a11y # keep it distinct from CodeQL / other scanners
```

Findings never gate — `snapshot` defaults to `--fail-on never`, so code scanning only _surfaces_ them for triage. (Real A11y's own repo dogfoods exactly this pattern.)

---

## Combine with assertions

The diff bot tells you *something changed* — pair it with `assertHeadingOrder`, `assertNoUnlabeledInteractive`, etc. from [`@real-a11y-dev/testing`](/packages/testing) to fail the build immediately on known-bad patterns:

```ts
// playwright.config.ts — runs on every PR via the e2e job
import { attach } from "@real-a11y-dev/testing/playwright";

test("page meets structural requirements", async ({ page }) => {
  await page.goto("http://localhost:3000");
  const sn = await attach(page);

  await sn.assertHeadingOrder();
  await sn.assertNoUnlabeledInteractive();
  await sn.assertLandmarkStructure();
});
```

The diff bot catches _unexpected regressions_; the assertions catch _known-bad patterns_. Together they give you defense in depth — the same engine on two surfaces: the CLI for the PR-wide diff, the testing library inside your e2e run.
