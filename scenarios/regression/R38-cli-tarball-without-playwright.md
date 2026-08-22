---
id: R38
suite: regression
scenario: "Packed CLI tarball without playwright — version line and audit agree, hint unblocks this layout"
area: Packaging
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.5"
validUntil: ""
expected: "CLI tarball installed without playwright: --version says not installed iff import('playwright') from that package would throw; audit runs or the hint's exact commands unblock this layout"
twin: D12
covers:
  - packages.@real-a11y-dev/cli
  - cli.commands.audit
notion: "https://app.notion.com/p/3c41c354b0b58117877cebb9ff355a88"
---

## Steps

Packed CLI tarball, scratch directory **without** playwright in the same
`node_modules` tree. Do not `npm i` every workspace tarball together — that can
hide a missing optional peer. R1 is the all-tarballs row; this one is the CLI
alone.

```bash
pnpm --filter @real-a11y-dev/cli build
pnpm --filter @real-a11y-dev/cli exec npm pack
```

In a scratch dir outside the repo:

1. `npm i -g ./real-a11y-dev-cli-*.tgz` (or `npm i` the tarball alone, no
   playwright)
2. `real-a11y --version`
3. `real-a11y audit https://example.com` (or a local fixture)
4. If it fails missing Playwright, run the hint's exact commands in **this**
   layout and re-audit
5. From a one-line script using `createRequire` on the installed CLI's
   `dist/index.js` and `import("playwright")` from that same file: they must
   agree

## Expected

- `--version` prints `playwright not installed` when ESM `import("playwright")`
  from the CLI package throws
- `audit` either runs, or the hint's exact commands make it run in this install
  layout
- A version number on `--version` while `audit` exits `2` missing Playwright is
  a fail

## Why this exists

Twin of D12. D2 beta.5 found `readVersion` (`createRequire`) and `createSession`
(`import("playwright")`) disagree, and the missing-Playwright hint names a local
`-D` recipe that does not repair `npm i -g`. R1 installs every tarball together
and only runs `--version`, so it cannot see this.
