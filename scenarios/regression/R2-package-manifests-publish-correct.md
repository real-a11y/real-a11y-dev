---
id: R2
suite: regression
scenario: "Package manifests are publish-correct (exports, files, types, no dead entries)"
area: Packaging
type: Automated
priority: P0
status: Active
validFrom: "every published package, all versions. Automated by `pnpm packaging:check`; also runs in CI's verify job. `findPublicPackages` skips `private: true`, so a package that went internal must vanish from the output entirely — still seeing one means its `package.json` never got the flag. Read the private set from the manifests, not from this line."
validUntil: ""
expected: "publint + attw clean for every published package; no `files` entry pointing at a nonexistent path"
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
notion: "https://app.notion.com/p/3aa1c354b0b5819d887ec8af4ac3be4a"
---

## Steps

The repo automates this — run it rather than eyeballing manifests:

```bash
pnpm packaging:check     # publint + attw, every public package
```

1. Run it; read the output per package, not just the exit code
2. For each published package, check `files` lists nothing that doesn't exist on
   disk after `pnpm build`
3. Check every path in `exports` resolves to a real built file
4. Check `types` / the `types` condition points at emitted `.d.ts`
5. Confirm the documented exemptions still apply, and only those. One is live:
   - `cli` skips **attw** entirely — a bin-only package has no import surface
   - `semantic-navigator-ui` skipped **attw** for its `styles` (CSS-only) subpath —
     dead config now, true through `0.1.0-beta.11` and inert after it, since the scan
     never reaches a `private: true` package
6. `pnpm size-limit` — budgets in `.size-limit.json`
7. Confirm nothing private leaked into the publish set. `node
   scripts/list-publishable-packages.mjs` prints exactly what `pnpm publish -r` will
   act on. Diff it against the packages WITHOUT `private: true` in
   `packages/*/package.json` — the two must agree exactly. Do not check against a
   list written here or a remembered count: the publish set shrinks every release,
   and a private name *appearing* is the finding, not a name missing

## Expected

- publint clean for every published package
- attw clean for every package except the documented skips — one live one (`cli`)
  since `semantic-navigator-ui` stopped being scanned — and if a _new_ skip
  appears, that's the finding
- Nothing private is scanned at all. A package that went internal must vanish
  from the output entirely; still seeing it means its `package.json` never got
  `"private": true`
- No `files` entry pointing at a nonexistent path
- Size budgets hold, including the Storybook manager panel and the browser
  page-bundle IIFE (the one injected into every Playwright/MCP page — it ships in
  every consumer's browser, so its budget is the one that matters most)

## Why this exists

publint and attw answer different questions and both are needed: publint reads
the manifest, attw actually packs each entry and resolves it as Node 10 / Node 16
/ bundler, catching the "types masquerade as ESM but the JS is CJS" trap that a
manifest read can't see.

Step 5 matters because exemptions accrete. They are deliberate and documented at
the top of `check-packaging.mjs`; a new one appearing silently means someone made
a real failure go away.

The `semantic-navigator-ui` entry is the opposite failure and worth recognising:
`findPublicPackages` skips `private: true`, so that exemption is dead config
rather than a live skip. Leaving it costs nothing and it is still the truth about
every release up to `0.1.0-beta.11` — but read the list as history, not as the
set of things currently being waived, or step 5's "one live skip" stops meaning
anything.
