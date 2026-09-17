# Native-tree e2e suite — W3C APG pattern coverage

Drives the **actual built `dist-dogfood/` extension** in a real Chromium, over
the same `chrome.runtime` messages the dogfood panel sends, against fixture
pages modeled on the real [W3C ARIA APG examples][apg].

```sh
pnpm --filter @real-a11y-dev/semantic-navigator-extension test:e2e
```

Needs a Chromium binary — `pnpm exec playwright install chromium` if you have
not run Playwright in this checkout before.

`pretest:e2e` runs `build:dogfood` first — **not** `build`. The store build
dead-code-eliminates the entire native path behind `__DOGFOOD__`, so a suite
pointed at `dist/` would silently exercise an extension with no native mode at
all.

Useful switches:

| Variable                 | Effect                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| `E2E_HEADED=1`           | Watch it run, instead of `--headless=new`.                       |
| `REAL_A11Y_CHROME_PATH`  | Use a specific Chromium (the repo's own override convention).    |

## Why this exists

Every fix in PR #348's rounds 4–15 followed the same loop: a human dogfoods a
real APG example page, finds the native tree silently does nothing — or worse,
reports success while doing nothing — and a session then reconstructs the
failure by hand in a throwaway script under `/tmp`, fixes it, and discards the
script.

Round 15's slider half is the sharpest case. Round 12 fixed "sliders aren't
interactable", verified it end-to-end in real Chromium, and shipped — and it was
still broken, because the verification used a `<div role="slider">` with a
keydown handler bound to `event.target`, while the real example is an SVG
`<g role="slider">` whose handler gates on `document.activeElement === this`. A
minimal hand-built reproduction passed while the actual target pattern kept
failing.

Two rules follow from that, and every test here obeys them:

1. **Fixtures reconstruct the real APG markup** — tag names, SVG vs. HTML, and
   the real handler shape, focus-gating included. Not a `role="x"` div inferred
   from the role name. Where a fixture departs from an APG example (the tree
   view's wrapper rows, say), the fixture comment says so and why.
2. **Assertions are on the page's own state** — `aria-valuenow`, `select.value`,
   a `change` listener firing — never on `NATIVE_ACT` returning
   `{ success: true }` alone. That marker reporting success while the page
   ignored the dispatch *is* the bug class this suite exists for.

## Open questions the plan left, now measured

All three were unknown when this suite was planned. Each was resolved
empirically before the architecture was committed to.

**`chrome.debugger.attach` does not collide with Playwright's own CDP session.**
Chromium allows more than one client per target, so the extension attaches to a
Playwright-controlled tab, dispatches, and Playwright keeps driving that same
tab afterwards. That is what makes the whole design work: a test dispatches
*through the extension* and then asserts on live page state *through Playwright*.
No `devtools-conflict` is provoked, and no second non-Playwright window is
needed.

**`--headless=new` loads the unpacked MV3 extension with a working
`chrome.debugger`.** So this suite needs **no Xvfb**, which removes the CI
dependency the plan flagged. Note it is passed as a raw `--headless=new` arg
rather than Playwright's `headless: true`, which selects the old headless shell
— that one loads no extensions at all.

**Fixtures are served over `http://127.0.0.1`, not `file://`.** Not a
preference: `capability.ts` refuses `file://` with the `file-url` reason unless
"Allow access to file URLs" is granted, and that is a per-extension user toggle
with no command-line equivalent. A throwaway static server in `harness.ts`
sidesteps the question entirely.

## Layout

- `harness.ts` — the launch/enable/read/act helpers, plus the fixture server.
  The extension launches **once per worker**; tests clean up their own tabs.
- `fixtures/` — one file per pattern, named for it.
- `*.test.ts` — one file per pattern, matching the fixture name.
- `panel-ui.test.ts` — a small set of UI-level smoke tests. Everything else is
  message-level, because that is where dispatch fidelity lives; these exist
  because a message-level test cannot see a panel-wiring bug, which is exactly
  what round 7 was.

## Coverage

### Covered

| Pattern                       | Actions exercised                          |
| ----------------------------- | ------------------------------------------ |
| Slider (Multi-Thumb)          | `increment` / `decrement`, both handler shapes |
| Slider (single-thumb)         | `increment` / `decrement`, custom + native range |
| Spinbutton                    | `increment` / `decrement` / `type`         |
| Combobox (Editable)           | `type`, gated on the `editable` state      |
| Combobox (Select-Only)        | `click`, and `type` refusing               |
| Listbox (native `<select>`)   | `select`, and the custom-widget refusal    |
| Listbox (multi-select)        | `select` — limitation documented below     |
| Menu and Menubar              | `click` on the whole `menuitem` family     |
| Tabs                          | `click`                                    |
| Tree View                     | `click`, incl. the composite redirect      |
| Accordion / Disclosure        | `click`                                    |
| Checkbox (incl. tri-state)    | `click`                                    |
| Radio Group                   | `click`                                    |
| Switch                        | `click`                                    |
| Grid / Treegrid               | `click` on `gridcell`; the `row` boundary  |
| Dialog (Modal)                | `click` / `type`, plus modal tree scoping  |

### Deliberately not covered

**Read-only / announcement patterns** — Alert, Landmarks, Meter, Tooltip, Feed,
Rating, and plain Table. None has a `getActions` branch at all: there is nothing
to dispatch. Asserting on their tree shape is worth doing, but it belongs in a
parity-style suite like `packages/browser/e2e/native-parity.e2e.test.ts`, not in
an action-dispatch one. Listed here rather than silently omitted, so a future
reader does not wonder whether they were forgotten.

**Patterns whose interaction is entirely generic** — Alert Dialog, Button, Link,
Breadcrumb, Toolbar, Carousel, Date Picker Dialog, Window Splitter. Their
internal controls are plain `button`/`link` nodes, already covered by the
fixtures above; a dedicated fixture would re-test `pageClick` under a new name.
Dialog (Modal) is the exception that earned a fixture, because the thing worth
checking there is not the click but whether the tree the dogfooder is reading is
really the dialog's.

**Closing the deliberately-excluded roles** (`row`, `listbox`- and
`option`-as-custom-widget, bare `cell`). `grid-treegrid.test.ts` *pins* that
exclusion rather than attempting to close it: a test asserting click-dispatch on
`row` would be asserting against an already-rejected design decision, not a bug.
See `ACTABLE`'s docstring in `DogfoodPanel.tsx` and round 7/8 in `DOGFOOD.md`.

**CI as a merge gate.** The suite runs in the `e2e` job of
`.github/workflows/test.yml`, after the `browser` parity harness, as an
**advisory** step (`continue-on-error: true`): a failure shows in the job log
but does not fail the job or block a merge. It reuses the Chromium that job
already installs, needs no Xvfb (see `--headless=new` above), and CI's `retries:
2` from `playwright.config.ts` applies. It was kept advisory because its
stability was measured locally (315/315 across `--repeat-each=5 --workers=4`)
but not yet on an ubuntu runner; promoting it is dropping that one line once it
has a green run history there. Like every step in that job, it runs on pushes to
`main` and on pull requests targeting `main` — so it does not run on a stacked
PR until that PR's base is `main`.

## Gaps this suite found

Recorded, pinned by a test, and **not fixed here**. Each is a change to shipped
dispatch code with its own blast radius, which is the maintainer's call and not
a test suite's. If one is closed, the named test is the one to invert.

1. **A collapsible tree row redirects into a grandchild's link.**
   `pageClick`'s composite redirect uses
   `querySelector('[role="link"], [role="button"], a[href], button')`, reasoning
   that document order gives "the row's primary action". That holds when the
   row's descendants are its own controls. It fails for a collapsible row whose
   own label is plain text and whose *subtree* contains links — a docs sidebar
   or file browser — where the first match is a grandchild's control. Expanding
   "2024" activates "January", and the marker reports success.
   Pinned by `tree-view.test.ts` → *KNOWN GAP: a collapsible row redirects into
   a grandchild's link*. The APG's own treeview is unaffected: its folder rows
   carry no inner control.

2. **A stale node id dispatches through an open modal.** `pageClick` drives the
   page with `dispatchEvent`, which reaches a listener regardless of inertness,
   so an id captured before a modal opened still fires afterwards. Bounded three
   ways: it needs a stale id (the background is absent from the tree while the
   modal is open, so the panel cannot offer it), it is inherent to synthetic
   dispatch rather than specific to the native path (`element.click()` behaves
   identically, and the DOM producer dispatches the same way), and the fix would
   be an inertness check in shipped dispatch code.
   Pinned by `dialog-modal.test.ts` → *KNOWN GAP: a stale background id still
   dispatches through an open modal*.

3. **`columnheader` is actionable for the DOM producer but not for the panel.**
   `ACTABLE`'s own docstring says `gridcell`/`columnheader`/`rowheader` are the
   actionable table roles; only `gridcell` is in the set. Unlike `row`, this one
   has no role-ambiguity defence — a plain `<th>` computes `columnheader` too,
   so the same argument round 8 used for `row` would apply here. Recorded as an
   asymmetry rather than filed as a bug.
   Pinned by `grid-treegrid.test.ts` → *columnheader is present on the tree but
   outside the actionable set*.

4. **A custom `role="spinbutton"` is offered a type button it will always
   refuse.** `isTypableRole` returns true for every `spinbutton`, because the DOM
   producer's `getActions` does — but that branch fires off the element's tag,
   and the native tree has no tag. `pageType` then refuses in-page with
   `not-a-text-field`. The refusal is correct; the affordance is imprecise. It
   fails safe, so it is recorded rather than asserted to be wrong.
   Pinned by `spinbutton.test.ts` → *typing into a custom role=spinbutton
   refuses cleanly*.

[apg]: https://www.w3.org/WAI/ARIA/apg/patterns/
