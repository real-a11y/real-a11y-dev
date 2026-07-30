---
id: R26
suite: regression
scenario: "Native tree checkpoint — a diff is only offered when the document actually survived"
area: CLI
type: Automated
priority: P1
status: Active
validFrom: "browser ≥ 0.1.0-beta.12 · cli ≥ 0.1.0-beta.2 (both unreleased — native-tree-checkpoint is a pending changeset)"
validUntil: ""
expected: "Five scenarios, each giving the right verdict: same-document mutation → diff; SPA pushState → diff; hash change → diff; reload (SAME url) → no diff, document replaced; real navigation → no diff, document replaced. The two that matter are the ones a URL comparison gets wrong: a hash/SPA change moves the URL while the document lives, and a reload keeps the URL while replacing it."
covers:
  - packages.@real-a11y-dev/browser
notion: "https://app.notion.com/p/3ab1c354b0b5816496c5c6e1a3ca406e"
---

## Steps

Fixtures must be **`<header>` / `<main>` / `<footer>`** — see _Why this exists_. Real
files on disk, not `data:` URLs: Chromium refuses top-level navigation **to** a `data:`
URL, so a link between two of them never navigates and the case silently doesn't happen.

Page A carries five controls and a link to page B:

| Control   | Does                                                          |
| --------- | ------------------------------------------------------------- |
| `#toggle` | `panel.innerHTML = '<h2>opened</h2>'`                         |
| `#spa`    | `history.pushState(…, '?route=2')` • swaps `<main>`'s content  |
| `#hash`   | `location.hash = 'x'`                                         |
| `#reload` | `location.reload()`                                           |
| `#go`     | link to `b.html`                                              |

1. Assert the fixture is multi-rooted: `tree.rootId === "ax-root"`
2. Checkpoint → click `#toggle` → diff
3. Checkpoint → click `#spa` → diff
4. Checkpoint → click `#hash` → diff
5. Checkpoint → click `#reload` → diff
6. Checkpoint → click `#go` → diff

## Expected

| #   | URL changed | Verdict                                                                                            |
| --- | ----------- | -------------------------------------------------------------------------------------------------- |
| 1   | no          | **diff** — contains `heading "opened"`                                                             |
| 2   | **yes**     | **diff** — `heading "Route 2"`, `button "SPA route"`, and the banner **not** listed as removed     |
| 3   | **yes**     | **diff**                                                                                           |
| 4   | no          | **replaced** — no diff offered                                                                     |
| 5   | yes         | **replaced** — reports where it landed                                                             |

Rows 2–4 are the whole point: a URL comparison calls all three wrong. It suppresses the
diff for a hash or SPA route change — where the document survived and the diff is exactly
what was asked for — and emits a garbage whole-page diff for a reload.

## Why this exists

The detector asks whether any **backend-derived** node id survived, because a replaced
document makes Chromium reallocate every `backendDOMNodeId`. Two things make that subtler
than it sounds:

- **`ax-root` must not count.** It is synthesized for any page with more than one
  top-level node — the ordinary header/main/footer shape — and its id is a **constant**.
  Two unrelated documents both carry it, so counting it made a navigation between two
  normal pages read as an in-place change with a whole-page remove/add diff. Step 0 exists
  because the original fixtures wrapped everything in a single `<main>`, were therefore
  single-rooted, never minted `ax-root`, and skipped this entirely. (`ax-<n>` collides
  across documents for the same reason.)
- **Cross-process navigation was checked and is fine.** A cross-origin hop swaps renderer
  process, which could in principle restart the id counter; measured, it keeps counting up
  (`7…13` → `25…31`, zero overlap), so no `loaderId` token is needed.

## Notes

Fixtures MUST be header/main/footer (multi-rooted). A page wrapped in a single `<main>` is
single-rooted, never mints the synthesized `ax-root`, and silently skips the case that
broke this once: `ax-root` is a CONSTANT id, so two unrelated documents both carry it and a
navigation between two ordinary pages read as an in-place change. Assert the fixture is
multi-rooted before trusting the rest.
