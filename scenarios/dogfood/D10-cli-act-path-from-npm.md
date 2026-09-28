---
id: D10
suite: dogfood
scenario: "CLI act path from npm — drive a real page and read back what changed"
area: CLI
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.2 (unreleased). Not runnable until interact/click/type/focus + --step-settle actually publish — mark N/A for earlier releases. Steps 9–10 as written (field values, --redact-input): cli ≥ 0.1.0-beta.7"
validUntil: ""
expected: "Against a real site: real-a11y click <url> --role … --name … exits 0 and prints a tree diff that plainly describes what the click did. A target that role+name can't reach exits 2 with a message that reads as an accessibility finding, not a tool failure. A click that navigates says where it landed and still exits 0. Then the sentinel check: type a secret into a password field and grep stdout, stderr and --format json — zero hits, the field reading only [redacted]; typed into a plain field it is never echoed but shows as the field's value in the diff, and --redact-input withholds it."
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
9. Our site has no password field, so save **R24**'s page (a password field and a plain
   `Email` field, each echoing only its value's length) locally. `real-a11y type ./fields.html
   --role textbox --name "Password" --text "$SENTINEL"`, capturing stdout/stderr, then again
   with `--format json`; then the same into `Email`, with and without `--redact-input`
10. Our site has no rich-text editor either, so save **R24**'s step-7 composer page locally and
    run `real-a11y interact ./composer.html --step "type textbox \"Composer\" = $SENTINEL"`,
    then again with `--redact-input`

## Expected

- **1** — exit `0` and a diff describing what the click did to the page
- **2** — the tree's vocabulary really is the step vocabulary; if you have to translate, that's the
  finding
- **3** — ambiguity is recoverable purely from what the error printed
- **4** — exit `0`, reports the new document, `url` is where it **landed**
- **6** — exit `2`, phrased as an accessibility finding — if role + name can't reach it, assistive
  tech can't either
- **8** — the settle visibly changes what the diff catches
- **9** — into `Password`: `grep -F "$SENTINEL"` finds **zero** hits in stdout, stderr or JSON,
  and no `•`; the diff reads `a11y.value (unset) → "[redacted]"` beside the length echo (see
  **R24** for the sentinel — it must contain `=` and end in `=`). Into `Email`: stderr has zero
  hits and the step echo is `= ‹hidden›`, while the diff shows the text as the field's value —
  page content, not an echo. With `--redact-input`, zero hits anywhere
- **10** — by default the diff shows `textbox "Composer"`'s value as the sentinel (the step echo
  still hidden). With `--redact-input`, zero hits: the diff shows the length echo changed and no
  value, and a later `tree ./composer.html --redact-input` shows `textbox "Composer"` over a
  bare `paragraph`. The published build must withhold an editor's content from names, not just
  from its value

## Why this exists

The only **write-capable** surface, dogfooded nowhere until now. The read path being wrong is
unhelpful; the write path being wrong mutates a real page and handles values a user typed.

Step 2 is the design claim under test: steps are meant to be written in the vocabulary the tree
already prints, so copying a line out of `tree` should nearly produce a working step. If that's
false against a real site, the feature is harder to use than it reads.

Step 9 repeats R24 deliberately — pre-publish proves the redaction logic, this proves it in the
built, published binary. Since cli 0.1.0-beta.7 a plain field's value is shown on purpose
(ADR-0001), so the leak this guards is narrower and sharper: the echo of what was typed, and any
trace of a password — its text or its length.

## Notes

The only WRITE-capable surface, and until now dogfooded nowhere. The read path can be wrong and
merely unhelpful; the write path mutates someone's real page and handles values a user typed. Pick
a target flow on our own site — do not click through third-party pages.
