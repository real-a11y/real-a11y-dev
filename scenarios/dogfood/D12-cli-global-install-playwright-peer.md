---
id: D12
suite: dogfood
scenario: "CLI global install from npm — Playwright peer is actually resolvable"
area: Install health
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.5 (measured on Windows + Volta). The website's local `npm i -D cli playwright` path is a different layout and is not this row."
validUntil: ""
expected: "After npm i -g @real-a11y-dev/cli@beta, a browser command either audits the local fixture for real (its exact findings, the server's log shows the request), or the missing-Playwright hint's exact commands make the next audit run. --version prints a Playwright version exactly when audit can load the driver, in the NODE_PATH-only and partial-install layouts too."
twin: R38
covers:
  - packages.@real-a11y-dev/cli
  - cli.commands.audit
notion: "https://app.notion.com/p/3c41c354b0b5815b97f0e8b6f3a13dc8"
---

## Steps

**Node.js 22.12 or newer.** From cli ≥ the first release after 0.1.0-beta.6
the CLI's `engines` is `>=22.12.0`. Run from **outside** this repo, or with
`volta run --node 22` — the repo's Volta pin is Node 20.20.2 (for the docs
build), and on 20 npm now warns `EBADENGINE` about `@real-a11y-dev/cli` and
`@puppeteer/browsers` both. Those warnings are correct, not a finding.

From a machine that does **not** already have `playwright` resolvable via
`createRequire` from the CLI package — empty cwd, no leftover global on
`NODE_PATH`. `--version` and `audit` must agree; a version number while
`audit` cannot load the driver is the lie this row exists to catch.

The page under audit is a **local fixture you serve yourself**, not a live site:
one page with exactly one known defect (an unlabeled `<button>`) and a clean twin,
on `http://localhost:<port>`. A browser command "running" only counts when the
fixture's findings come back exactly and the server's access log shows the hit — an
audit can exit `1` with findings for a page it never fetched.

```bash
npm i -g @real-a11y-dev/cli@beta
real-a11y --version
real-a11y audit http://localhost:<port>/defect.html
```

Then try the obvious unblock, still as a **global** user:

1. `npm i -g playwright` and re-run `audit` from an empty directory (no local
   `node_modules`)
2. Follow whatever hint the error printed, **as a global-install user** — do not
   silently switch to `npm i -D` in a project unless the hint says that **and**
   it actually unblocks the global binary
3. Compare `--version`'s playwright field with whether `audit` actually **loads the
   driver** — not with another `createRequire` call, which is the same mechanism
   checked against itself. Do it in three layouts:
   - the global sibling layout above;
   - Playwright resolvable **only** through `NODE_PATH` (no sibling install). This is
     the layout that tells the resolvers apart — ESM `import("playwright")` throws
     there and `createRequire` resolves — and the only one where plain npm on Linux
     reproduces the beta.5 regression, since a global sibling is found by both;
   - a partial install: the global layout with the `playwright-core` that the global
     `playwright` resolves removed. Find it with
     `require.resolve("playwright-core/package.json", { paths: [<global playwright dir>] })`
     rather than assuming where it sits — npm's global layout nests it under
     `playwright/node_modules/`, another installer may hoist it — and confirm `audit` can
     no longer load the driver before reading the result
4. Once more with a proxy in the environment: `HTTPS_PROXY` set and
   `NO_PROXY=localhost`, against the same localhost fixture. Run it with the newest
   Playwright and with 1.58.2 — inside the CLI's peer range, and the last release
   before Playwright stopped sending loopback through the proxy
5. Remove the cached browser and read the follow-up hint ("No browser is downloaded
   yet.") in the global layout

## Expected

- After `npm i -g @real-a11y-dev/cli@beta` alone, a browser command either runs,
  or fails exit `2` with a hint whose **exact commands** make the next `audit`
  run in that same layout. The hint for this layout is
  `npm i -g playwright && real-a11y install`, not a local `-D`
- `--version` prints `playwright not installed` whenever `createRequire` from
  the CLI package cannot resolve `playwright`. A version number while `audit`
  cannot load the driver is a fail of this row, whatever `createRequire` says —
  the partial install in step 3 is the layout where those two disagree
- `npm i -g playwright` unblocks the global binary (`audit` loads the driver).
  Chrome still needs `real-a11y install` if it is not already cached. Behind a
  mandatory proxy, `real-a11y install` through cli 0.1.0-beta.11 also needs `proxy-agent`,
  which nothing installs or documents — the known defect, not a new one
- The defect fixture reports exactly its one finding and exits `1`; the clean twin
  exits `0`; the server log shows both requests
- **3** — `--version` prints a version exactly when `audit` loads the driver, in all
  three layouts. The partial install fails with an error that says the install is
  incomplete, not a version followed by "is the server running?" (the known defect
  through cli 0.1.0-beta.11, found by the beta.19 dogfood)
- **4** — the proxied run reaches the fixture directly (`NO_PROXY` holds) on both
  Playwright versions. On cli 0.1.0-beta.9 with Playwright 1.58.2 (and anything from
  1.49), loopback goes to the proxy — the known defect, not a new one. cli
  0.1.0-beta.10 keeps loopback direct on both
- **5** — the follow-up hint names the command for **this** layout:
  `real-a11y install`, not `npx real-a11y install`. npx finds a global CLI only in
  npm's own global prefix. A global anywhere else, such as a `--prefix` install or a
  version manager like Volta that keeps globals in its own directory, sends it to the
  registry for the unscoped name: an E404. cli 0.1.0-beta.9 prints `npx real-a11y install` in every
  layout — the known defect the beta.19 dogfood filed, not a new one. cli
  0.1.0-beta.10 names each layout's own command

## Why this exists

D2 against cli 0.1.0-beta.5 on Windows + Volta: `npm i -g @real-a11y-dev/cli@beta`
then `audit` → Playwright missing. `npm i -g playwright` did not help.
`--version` printed `playwright 1.62.1` via `createRequire` / `NODE_PATH`
(`packages/cli/src/run.ts` `readVersion`) while ESM `import("playwright")` in
`createSession` (`packages/cli/src/session.ts`) still threw. The hint named
`npm i -D playwright && npx real-a11y install`, which is a different install
layout. D2 as written never reached step 1.

The website's `npm i -D @real-a11y-dev/cli@beta playwright` path works. This row
is the global one-liner D2 used to claim, so a fix cannot hide behind "use `-D`".

The local fixture, the `NODE_PATH`-only layout and the proxy run came from the beta.19
dogfood on Linux. Against `example.com`, "a browser command runs" passed while the CLI
audited an HTTP proxy's error page — the page was never fetched, and the findings were
the proxy's. And with a global sibling install, plain npm on Linux resolves Playwright
from both ESM and CJS, so the original steps could not reproduce the regression this
row was written for on any machine but the Windows + Volta one that found it.

## Notes

D2 still walks audit + views against the live site; it now does that via the
published-docs install. This row owns the `npm i -g` claim. Twin: R38.

`--version` and `audit` now share `createRequire` (`packages/cli/src/playwright-resolve.ts`,
`packages/browser/src/playwright-load.ts`). Bare `import("playwright")` remaining
in a comment or a one-off script is not the contract.
