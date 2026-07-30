---
id: R23
suite: regression
scenario: "CLI act path — interact + the click / type / focus verbs drive a real page and report what changed"
area: CLI
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.2 (unreleased — interact/click/type/focus + --step-settle are pending changesets)"
validUntil: ""
expected: "A step targets by role + accessible name only (never a selector) and the run exits 0 with a tree diff naming the change. Ambiguity lists copy-paste nth= candidates and acts on the right one once nth picks it. A DISABLED target is refused with the cause — never a success plus an empty diff, which reads as \"that button does nothing\". A step that navigates or reloads reports that no diff is possible, says where it LANDED, and still exits 0. An unreachable target exits 2. --step-settle delays the read; 0 opts out."
twin: D10
covers:
  - cli.commands.interact
  - cli.commands.click
  - cli.commands.type
  - cli.commands.focus
notion: "https://app.notion.com/p/3ab1c354b0b581dcaab5c83e274dd7bf"
---

## Steps

Build first — the e2e drives the **built** bin, and a stale `dist/` is the most common
false failure here.

```bash
pnpm --filter @real-a11y-dev/cli build
```

Serve a fixture page carrying: a button that visibly changes a heading, **two** buttons
with the same accessible name, a `disabled` button, a text field, and a link to a second
page.

1. `real-a11y interact <url> --step 'click button "Open menu"'`
2. `real-a11y interact <url> --step 'type textbox "Email" = hi' --step 'click button "Open menu"'`
   — two ordered steps
3. `real-a11y click <url> --role button --name "Save"` — two match
4. Re-run step 3 with `--nth 2`
5. `real-a11y click <url> --role button --name "Locked"` — the disabled one
6. `real-a11y click <url> --role button --name "Nope"` — absent
7. `real-a11y click <url> --role link --name "Go"` — navigates away
8. `real-a11y focus <url> --role textbox --name "Email"`
9. Any of the above with `--format json`
10. `real-a11y click <url> --role button --name "Save" --root main` and
    `--producer native`

## Expected

- **1** — exit `0`; a diff naming the change (`~ heading: "closed" → "open"`), not just
  "something changed"
- **2** — both effects in **one** diff; steps run in the order given and stop at the
  first failure
- **3** — exit `2`, listing `nth=1 · button "Save"` / `nth=2 · button "Save"` —
  copy-pasteable, and **no** action dispatched
- **4** — exit `0`, acting on the second one specifically
- **5** — exit `2` naming _disabled_ as the cause. Never exit 0 with an empty diff: a
  swallowed click reads as "that button does nothing" rather than "you can't click it"
- **6** — exit `2`, worded as an accessibility finding (if role+name can't reach it,
  assistive tech can't either), with a hint pointing at `real-a11y tree <url>` so the
  runner can go read the names that _do_ exist
- **7** — exit `0`, reports that a new document loaded so no diff is possible, and `url`
  is where it **landed**
- **8** — exit `0`; the diff shows the focus move, not a bare `a11y.states.focused` flip
- **9** — parses; `steps`, `diff` and `navigated` present; `url` is the final address
- **10** — exit `2`, rejected by name. These commands accept neither flag

## Why this exists

The only write-capable CLI surface, and it shipped with no scenario here at all. Two
failures it specifically guards:

- **The disabled refusal.** `el.click()` on a disabled control "succeeds" and fires
  nothing. Without an explicit refusal the run reports success plus an empty diff —
  technically true, actively misleading.
- **One vocabulary throughout.** Targeting, acting and the diff all read Chromium's
  native tree. An earlier build targeted native but diffed the DOM producer, so a node
  aimed at as `button "Attach"` came back in the report as `textbox "Attach"` — the same
  element under two names.

## Notes

New capability with no prior coverage. Targeting, acting, and the diff all read
Chromium's native tree, so a node aimed at by one name cannot come back in the report
under another — these commands take no `--producer` and no `--root`. Chromium only.
