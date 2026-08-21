---
id: R37
suite: regression
scenario: "Audit — label-title-only matches axe (form title-only is a warning; buttons and glyphs are not)"
area: Testing
type: Automated
priority: P1
status: Active
validFrom: "testing ≥ the FIRST release after 0.1.0-beta.15. Running against beta.15 or earlier has no label-title-only id — unknown-rule is a load error, not a miss. The engine is private `audit` bundled into testing / cli / mcp; pin testing (and cli / mcp for those surfaces)."
validUntil: ""
expected: "title-only input is a warning; labelled/aria-label/labelledby pass; placeholder-only, glyph buttons, and title-only buttons do not fire this rule; empty-name still fires no-unlabeled-interactive"
twin: D5
covers:
  - packages.@real-a11y-dev/testing
  - packages.@real-a11y-dev/audit
  - cli.commands.audit
notion: ""
---

## Steps

1. `collectFindings` / `real-a11y audit` / `audit_page` on `<input title="Email">` with no `<label>`
2. The same with `<label>Email <input></label>`, `aria-label`, and `aria-labelledby`
3. `<input placeholder="Email">` with no other name source
4. `<button title="Download CSV">` and `<button>⬇</button>`
5. `<button><svg></svg></button>` (empty name)
6. `assertNoUnlabeledInteractive` on (1), (3), (4) — confirm it does **not** throw
7. `--rules label-title-only` on a page that also has an unlabeled button — only the title-only input is reported

## Expected

- **1** — one finding, rule `label-title-only`, severity `warning`
- **2** — no `label-title-only` finding
- **3** — no `label-title-only` finding (axe `label-title-only` does not cover placeholder)
- **4** — no `label-title-only` finding (axe `button-name` passes title/glyph; this rule is form controls only)
- **5** — `no-unlabeled-interactive` error, not `label-title-only`
- **6** — passes. A spoken name is not "unlabeled"
- **7** — the unlabeled button is absent from the subset run

## Why this exists

A dogfood pass looked like a product fork: treat glyph/`title` as unlabeled, or leave them. axe-core already split it — WCAG 4.1.2 name rules pass a non-empty accname; `label-title-only` is best-practice on form controls labeled only by `title` / `aria-describedby`. This row pins that split so R13's "icon-only button" line cannot drift back into calling a spoken name unlabeled.
