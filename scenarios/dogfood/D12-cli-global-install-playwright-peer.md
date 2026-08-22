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
expected: "After npm i -g @real-a11y-dev/cli@beta, a browser command either runs, or the missing-Playwright hint's exact commands make the next audit run. --version prints not installed whenever createRequire from the CLI package cannot resolve playwright."
twin: R38
covers:
  - packages.@real-a11y-dev/cli
  - cli.commands.audit
notion: "https://app.notion.com/p/3c41c354b0b5815b97f0e8b6f3a13dc8"
---

## Steps

From a machine that does **not** already have `playwright` resolvable via
`createRequire` from the CLI package — empty cwd, no leftover global on
`NODE_PATH`. `--version` and `audit` must agree; a version number while
`audit` cannot load the driver is the lie this row exists to catch.

```bash
npm i -g @real-a11y-dev/cli@beta
real-a11y --version
real-a11y audit https://example.com
```

Then try the obvious unblock, still as a **global** user:

1. `npm i -g playwright` and re-run `audit` from an empty directory (no local
   `node_modules`)
2. Follow whatever hint the error printed, **as a global-install user** — do not
   silently switch to `npm i -D` in a project unless the hint says that **and**
   it actually unblocks the global binary
3. Compare `--version`'s playwright field with whether `createRequire` from the
   installed CLI package's `dist/` can `resolve("playwright")`. Bare
   `import("playwright")` is not the resolver — it ignores `NODE_PATH`

## Expected

- After `npm i -g @real-a11y-dev/cli@beta` alone, a browser command either runs,
  or fails exit `2` with a hint whose **exact commands** make the next `audit`
  run in that same layout. The hint for this layout is
  `npm i -g playwright && real-a11y install`, not a local `-D`
- `--version` prints `playwright not installed` whenever `createRequire` from
  the CLI package cannot resolve `playwright`. A version number here while
  `audit` fails is a fail of this row
- `npm i -g playwright` unblocks the global binary (`audit` loads the driver).
  Chrome still needs `real-a11y install` if it is not already cached

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

## Notes

D2 still walks audit + views against the live site; it now does that via the
published-docs install. This row owns the `npm i -g` claim. Twin: R38.

`--version` and `audit` now share `createRequire` (`packages/cli/src/playwright-resolve.ts`,
`packages/browser/src/playwright-load.ts`). Bare `import("playwright")` remaining
in a comment or a one-off script is not the contract.
