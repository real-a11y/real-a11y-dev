---
id: D10
suite: dogfood
scenario: "CLI act path from npm — drive a real page and read back what changed"
area: CLI
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.2 (unreleased). Not runnable until interact/click/type/focus + --step-settle actually publish — mark N/A for earlier releases"
validUntil: ""
expected: "Against a real site: real-a11y click <url> --role … --name … exits 0 and prints a tree diff that plainly describes what the click did. A target that role+name can't reach exits 2 with a message that reads as an accessibility finding, not a tool failure. A click that navigates says where it landed and still exits 0. Then the sentinel check: type a secret into a real field and grep stdout, stderr and --format json — zero hits."
twin:
  - R23
  - R24
covers:
  - cli.commands.click
  - cli.commands.type
  - cli.commands.focus
  - cli.commands.interact
notion: "https://app.notion.com/p/3ab1c354b0b581b4bc7ec3dd4fc5e725"
---

## Steps

Registry install, real page. Pick a flow on **our own** site — do not click through third-party
pages.

```bash
npm i -g @real-a11y-dev/cli@beta
```

Then read a target's role + name from `real-a11y tree https://real-a11y.dev`.

1. `real-a11y click https://real-a11y.dev --role button --name "<from the tree>"`
2. Copy a line of `tree` output and turn it into a `--step` — it should almost already be one
3. `real-a11y click … --role button --name "<a name matched twice>"`, then re-run with `--nth 2`
4. `real-a11y click … --role link --name "<a nav link>"` — navigates
5. `real-a11y focus … --role <a focusable>`
6. `real-a11y click … --role button --name "definitely not here"`
7. `real-a11y interact … --step '…' --step '…'` — two ordered steps
8. A slow-reacting control with `--step-settle 0`, then `--step-settle 800`
9. `real-a11y type … --text "$SENTINEL"` into a real field, capturing stdout/stderr, then again
   with `--format json`

## Expected

- **1** — exit `0` and a diff describing what the click did to the page
- **2** — the tree's vocabulary really is the step vocabulary; if you have to translate, that's the
  finding
- **3** — ambiguity is recoverable purely from what the error printed
- **4** — exit `0`, reports the new document, `url` is where it **landed**
- **6** — exit `2`, phrased as an accessibility finding — if role + name can't reach it, assistive
  tech can't either
- **8** — the settle visibly changes what the diff catches
- **9** — `grep -F "$SENTINEL"` finds **zero** hits in stdout, stderr or JSON (see **R24** for the
  sentinel — it must contain `=` and end in `=`)

## Why this exists

The only **write-capable** surface, dogfooded nowhere until now. The read path being wrong is
unhelpful; the write path being wrong mutates a real page and handles values a user typed.

Step 2 is the design claim under test: steps are meant to be written in the vocabulary the tree
already prints, so copying a line out of `tree` should nearly produce a working step. If that's
false against a real site, the feature is harder to use than it reads.

Step 9 repeats R24 deliberately — pre-publish proves the redaction logic, this proves it in the
built, published binary against a real field.

## Notes

The only WRITE-capable surface, and until now dogfooded nowhere. The read path can be wrong and
merely unhelpful; the write path mutates someone's real page and handles values a user typed. Pick
a target flow on our own site — do not click through third-party pages.
