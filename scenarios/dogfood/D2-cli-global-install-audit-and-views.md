---
id: D2
suite: dogfood
scenario: "CLI installed globally from npm — audit + views against https://real-a11y.dev"
area: CLI
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.1 (installed from the registry on the `beta` tag). Post-#258: --producer is gone and --root survives on `tabs` alone. `tabs` itself was predicted to go and did NOT — it is permanent."
validUntil: ""
expected: "audits a real site over the network; exit codes correct; every view command `real-a11y --help` lists returns real content — enumerate from that output rather than a hardcoded set"
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

Install from the registry, globally, on a clean machine:

```bash
npm i -g @real-a11y-dev/cli@beta
```

Then `real-a11y install` (Chrome for Testing, first run only) and `real-a11y --help` —
enumerate the commands to test from **that output**, not from a list written here.

1. `real-a11y audit https://real-a11y.dev`
2. `real-a11y audit https://real-a11y.dev --format json | <parser>`
3. Every view command the help lists, against the live site
4. `real-a11y audit https://real-a11y.dev --device "iPhone 13"`
5. A page on the site with a known violation, if one exists — otherwise a deliberately
   broken local page
6. `real-a11y audit https://<a site that 404s or is unreachable>`
7. `real-a11y audit https://real-a11y.dev` and `real-a11y tree https://real-a11y.dev`
   again, reading them for **native-only** characteristics. There is no
   `--producer` flag since #258 — an earlier version of this row passed
   `--producer native` here, which is now a bare parser error
8. Re-run `real-a11y install` — should be an instant no-op

## Expected

- **1** — audits a real site over the network; exit code reflects what's actually there
- **2** — one parseable document
- **3** — every view returns **real content**, not an empty shell. Views exit `0`
- **4** — the mobile layout is audited, and the result differs where the layout does
- **6** — exit `2`, reported as a navigation error, not a clean pass
- **7** — the reads reach structure the old in-page walk couldn't (UA-shadow media
  controls on any page that has a `<video>`), and every finding carries a locator
- **8** — instant, zero network, exit `0`

## Why this exists

Everything before this ran against fixtures we wrote. A real site brings real latency, real
redirects, real CSP, a real cookie banner, and content that arrives after load — the
conditions under which "works on my fixture" quietly stops being true.

Step 6 deserves attention: an unreachable page must **never** report as clean. Exit `0` on a
page that failed to load is the single most dangerous wrong answer this tool can give,
because it makes a broken CI job look green.

**Resolved, and one half went the other way.** The native-only migration (#258) landed:
`--producer` is gone entirely, and `--root` survives on `tabs` alone. But `tabs` itself
was predicted to go and **did not** — native knows whether a node is focusable and
cannot produce the _sequence_, so it is the only command that can answer the question
at all (see R4). It ships, permanently, and must return real content here.

Enumerating from `--help` (step 3) is what carried this row across a change it was
half wrong about, which is the argument for never hardcoding the list.

## Notes

This row previously read "until it lands, `tabs` still ships" — a forecast that
outlived the migration and pointed the wrong way about `tabs`. Restated as settled.
