---
id: R1
suite: regression
scenario: "Packed tarballs install clean and every entry point resolves (ESM + CJS + types)"
area: Packaging
type: Automated
priority: P0
status: Active
validFrom: "every published package, all versions. Currently: engine family 0.1.0-beta.11, cli/mcp 0.1.0-beta.1, validate 0.1.0-beta.7"
validUntil: ""
expected: "Every import/require resolves; types found; bins executable; zero MODULE_NOT_FOUND"
twin: D1
covers:
  - packages.@real-a11y-dev/core
  - packages.@real-a11y-dev/serialize
  - packages.@real-a11y-dev/audit
  - packages.@real-a11y-dev/snapshot
  - packages.@real-a11y-dev/browser
  - packages.@real-a11y-dev/validate
  - packages.@real-a11y-dev/semantic-navigator-ui
  - packages.@real-a11y-dev/inspector
  - packages.@real-a11y-dev/react
  - packages.@real-a11y-dev/testing
  - packages.@real-a11y-dev/storybook-addon
  - packages.@real-a11y-dev/cli
  - packages.@real-a11y-dev/mcp
notion: "https://app.notion.com/p/3aa1c354b0b58146a3cbdc9f37bfc1d9"
---

## Steps

Tarballs, not workspace links — a `pnpm link` resolves through the monorepo and
hides every packaging fault this row exists to catch.

```bash
pnpm build
pnpm -r --filter "./packages/*" exec npm pack   # one tarball per package
```

Then, in a scratch project outside the repo:

1. `npm i` every tarball together
2. Import each package's `.` entry as **ESM**
3. `require()` each as **CJS**
4. Import each **subpath** export — `@real-a11y-dev/testing/playwright`,
   `/matchers`, `/matchers/vitest`, the UI's `styles`, and any others in the
   exports maps
5. Resolve types for every entry (`tsc --noEmit` on a file importing each),
   **with `skipLibCheck: false`** — see below, the default hides the fault this
   step exists to find
6. Run each package's `bin` — `npx real-a11y --version`, and the MCP server's bin
7. Repeat 2–3 on a **Node 24** runtime as well
8. Grep the install for `MODULE_NOT_FOUND` / `ERR_PACKAGE_PATH_NOT_EXPORTED`

## Expected

- Every import and require resolves
- Every subpath in every `exports` map is reachable — an entry nobody imports in
  CI is exactly the one that's broken
- Types are found for every entry, from both module systems
- **No shipped `.d.ts` imports a package that isn't published.** Run step 5 with
  `skipLibCheck: false` or this one cannot fail. A private workspace package is
  bundled into its consumers, so the JS is fine and the install is fine — but the
  declarations are a separate emit, and unless the bundler inlines them the
  `.d.ts` keeps `from "@real-a11y-dev/<private>"`. Expect `TS2307`
- Bins are executable and exit `0` on `--version`
- Zero `MODULE_NOT_FOUND`, zero unexported-path errors

## Why this exists

Packaging faults are invisible from inside the monorepo and 100% visible to the
first person who installs. The workspace resolves by path; a published package
resolves by `exports` map, and those two agree right up until they don't.

Node 24 (7) is checked separately because CI's `packages-node24` job exists for
it: newer Node is stricter about exports resolution, so a package can install
cleanly on 20 and fail on 24.

`skipLibCheck: false` in (5) is not pedantry, and this row already missed one
because of it. `@real-a11y-dev/mcp` shipped `server.d.ts` importing
`@real-a11y-dev/session-registry` — a private package, 404 on npm. Under the
common `skipLibCheck: true` a consumer sees **no error at all**: the three
re-exported names (`SessionInfo`, `SessionRegistryError`,
`RegistryShutdownError`) quietly degrade to `any`. It installs, it runs, it type-
checks, and it has silently stopped type-checking part of the public contract.
That is the same silent-success shape R9 watches for in `list_elements` — a
result that looks like a pass and isn't — so the assertion has to be written to
fail loudly, not left to a default.
