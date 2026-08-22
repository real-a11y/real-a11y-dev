---
id: D2
suite: dogfood
scenario: "CLI from npm — audit + views against https://real-a11y.dev"
area: CLI
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.1 (installed from the registry on the `beta` tag). Post-#258: --producer is gone and --root survives on `tabs` alone. `tabs` itself was predicted to go and did NOT — it is permanent. Install path restated at beta.5: the published docs are `npm i -D @real-a11y-dev/cli@beta playwright`; the `npm i -g` one-liner is D12."
validUntil: ""
expected: "audits a real site over the network; exit codes correct; every view command `real-a11y --help` lists (tree/outline/tabs/list, not inspect) returns real content — enumerate from that output rather than a hardcoded set"
twin:
  - R3
  - R4
covers:
  - cli.commands.audit
  - cli.commands.tree
  - cli.commands.outline
  - cli.commands.list
  - cli.commands.tabs
  - cli.commands.install
  - cli.exitCodes
notion: "https://app.notion.com/p/3aa1c354b0b581b9846cf5989de8de88"
---

## Steps

Install the way the **published docs** tell a stranger to (website Prerequisites /
README), not the older global one-liner. `npm i -g @real-a11y-dev/cli@beta`
without a resolvable Playwright peer is D12.

```bash
npm i -D @real-a11y-dev/cli@beta playwright
npx real-a11y install
```

Then `npx real-a11y --help` — enumerate the commands to test from **that
output**, not from a list written here. `inspect` is a gate (exits `1` on
findings), not a view.

1. `npx real-a11y audit https://real-a11y.dev`
2. `npx real-a11y audit https://real-a11y.dev --format json | <parser>`
3. Every **view** command the help lists (`tree`, `outline`, `tabs`, `list`),
   against the live site. `inspect` is allowed as an extra read; it is not a
   view and may exit `1`
4. `npx real-a11y audit https://real-a11y.dev --device "iPhone 13"` — compare the
   **tree**, not only the finding count. Audit findings can stay the same while
   the layout changes
5. A page on the site with a known violation, if one exists — otherwise a
   deliberately broken local page. Element findings must carry a CSS locator;
   a page-level finding (missing `<main>`) has none, which is spec-correct
6. `npx real-a11y audit https://<a host that does not resolve or a closed port>`
   — a URL that returns an HTML 404 is a loaded page, not this step
7. `npx real-a11y audit https://real-a11y.dev` and `npx real-a11y tree https://real-a11y.dev`
   again, reading them for **native-only** characteristics. There is no
   `--producer` flag since #258 — an earlier version of this row passed
   `--producer native` here, which is now a bare parser error
8. Re-run `npx real-a11y install` — should be an instant no-op

## Expected

- **1** — audits a real site over the network; exit code reflects what's actually there
- **2** — one parseable document
- **3** — every view returns **real content**, not an empty shell. Views exit `0`.
  `inspect` may exit `1` when the page has errors — it is a gate
- **4** — the mobile tree differs where the layout does (e.g. desktop nav vs a
  mobile-navigation control), even if the finding list does not
- **6** — exit `2`, reported as a navigation error, not a clean pass. An HTML 404
  that still loads is exit `1`/`0` according to its findings, not this case
- **7** — the reads reach structure the old in-page walk couldn't (UA-shadow media
  controls on any page that has a `<video>`). Element findings carry a locator;
  page-level landmark findings may not
- **8** — instant, zero network, exit `0`

## Why this exists

Everything before this ran against fixtures we wrote. A real site brings real latency, real
redirects, real CSP, a real cookie banner, and content that arrives after load — the
conditions under which "works on my fixture" quietly stops being true.

Step 6 deserves attention: an unreachable page must **never** report as clean. Exit `0` on a
page that failed to load is the single most dangerous wrong answer this tool can give,
because it makes a broken CI job look green. A 404 document that the browser did load is
a different question — it is a page, and it is audited.

**Resolved, and one half went the other way.** The native-only migration (#258) landed:
`--producer` is gone entirely, and `--root` survives on `tabs` alone. But `tabs` itself
was predicted to go and **did not** — native knows whether a node is focusable and
cannot produce the _sequence_, so it is the only command that can answer the question
at all (see R4). It ships, permanently, and must return real content here.

Enumerating from `--help` (step 3) is what carried this row across a change it was
half wrong about, which is the argument for never hardcoding the list. `inspect`
sitting in that list as a gate is the next such trap.

**Install path, restated at beta.5.** This row used to open with `npm i -g
@real-a11y-dev/cli@beta` and no Playwright. That one-liner cannot drive a browser
(optional peer; ESM `import("playwright")` does not see a sibling global under
Volta; `--version` can lie via `createRequire`). The published docs already say
`npm i -D @real-a11y-dev/cli@beta playwright`. D12 owns the global claim so this
row can keep testing the live site.

## Notes

This row previously read "until it lands, `tabs` still ships" — a forecast that
outlived the migration and pointed the wrong way about `tabs`. Restated as settled.
The global-install one-liner moved to D12 after the 2026-08-21 dogfood session.
