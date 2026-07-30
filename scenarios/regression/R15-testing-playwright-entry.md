---
id: R15
suite: regression
scenario: "Testing pkg — /playwright entry: attach(), snapshots, assertions, navigation survival, Frame + native tree"
area: Testing
type: Automated
priority: P0
status: Active
validFrom: "testing ≥ 0.1.0-beta.11 (the ./playwright subpath export). nativeTree() through the handle: browser ≥ 0.1.0-beta.11. Step 10 is from browser ≥ 0.1.0-beta.12 — on earlier releases `__realA11y__.listByRole` is still present, which is the old surface rather than a failure."
validUntil: ""
expected: "attach works on a CSP-strict page; handle survives goto(); Frame attach audits iframe content; bad rootSelector throws; the bundle is also callable directly as __realA11y__ (the Trusted-Types path), and listByRole is no longer among its exports"
twin: D5
covers:
  - packages.@real-a11y-dev/testing
  - packages.@real-a11y-dev/browser
notion: "https://app.notion.com/p/3aa1c354b0b5810ca701c8255a966b30"
---

## Steps

From a scratch project with the packed tarball installed:

```bash
pnpm --filter @real-a11y-dev/testing test:e2e
```

1. `attach(page)` on an ordinary page
2. `attach(page)` on a page with a **strict CSP** (`script-src 'self'`)
3. Snapshot helpers through the handle: audit, tree, outline, tab sequence
4. The assertions through the handle
5. `await page.goto(<another url>)`, then reuse the **same** handle
6. `attach(frame)` on a `Frame` — audit the iframe's own content
7. `attach(page, { rootSelector: '#nope' })`
8. `nativeTree()` through the handle
9. Type a sentinel into a field, then take every snapshot the handle offers
10. Reach the bundle **directly**, the way a Trusted-Types page has to: evaluate the
    IIFE, then call `globalThis.__realA11y__.auditSnapshot(document.body)` and one
    `assert*` helper without going through `attach()`. Also confirm
    `__realA11y__.listByRole` is **absent**

## Expected

- **2** — works. The bundle is injected in a way a page CSP cannot block; if this
  fails, every CSP-strict site is unusable and most real apps are CSP-strict
- **5** — the handle **survives navigation** and reports the new page, rather than
  silently reporting the old one or throwing
- **6** — audits the iframe's content, not the host's
- **7** — throws a clear error naming the selector. Never a silent empty tree, which
  reads as "clean page"
- **8** — returns Chromium's own tree, reaching UA-shadow media controls
- **9** — the sentinel appears in no snapshot
- **10** — the direct calls work: `__realA11y__` is a published surface, not an
  internal of `attach()`, and evaluating the IIFE is the documented escape hatch
  where `addScriptTag` is blocked. `listByRole` is gone from it as of
  **browser ≥ 0.1.0-beta.12** — category listing runs in Node now, so the in-page
  copy shipped into every audited page for nobody. On an earlier release it is
  present; that is the old surface, not a fail

## Why this exists

`attach()` is the integration most likely to be adopted by people already running
Playwright, so it meets the widest variety of real pages.

The three failure modes here are all _quiet_:

- **CSP** (2) — fails only on real sites, never on the fixture someone tests with.
- **Navigation survival** (5) — a stale handle reports the previous page as if it
  were current; the test passes and describes nothing.
- **Bad root** (7) — an empty tree with no error is indistinguishable from a perfect
  page. Every assertion passes.

(10) closes a gap this suite had: every other step reaches the bundle _through_
`attach()`, so nothing checked the surface a Trusted-Types page actually has to use.
That let `listByRole` sit in the bundle with no caller across a whole migration —
the export names are resolved dynamically at both call sites (`ra[fn]`), so no type
connected them and no test named them. `packages/browser/src/page-bundle.test.ts`
now pins the list in-repo; this step is the from-the-tarball half, which is where a
bundling or export-map mistake would show up instead.

## Notes

Step 10 added when `listByRole` was dropped from the injected bundle
(browser 0.1.0-beta.12). It had no in-page caller: `real-a11y list` and the MCP's
`list_elements` both run the listing in Node over Chromium's tree, and the only
bundle exports the CLI/MCP still dispatch on are `checkpointTree` and
`diffSinceCheckpoint`. Removal took the bundle 9.96 → 9.59 kB gzipped, back under
the 10 KB budget that had been raised to 11 KB one release earlier to fit its
empty-category text. Six other exports are also uncalled in-repo (`findByRole`,
`findAllByRole`, `getOutline`, `getTabSequence`, `linearize`, `A11yAssertionError`)
but were KEPT — measured: dropping all six saved a further 0.07 kB, because what
stays pulls them in anyway, so seven breaking removals bought nothing.
