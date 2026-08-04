---
id: R30
suite: regression
scenario: "Page identity — a baseline survives a rename and a change of host, and two pages can never silently merge"
area: CLI
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.2, snapshot ≥ 0.1.0-beta.12. Before that a page's identity WAS its display name, so steps 2 and 3 both un-suppress on an earlier release — that is the old behaviour, not a fail. Step 6's v1 refusal only exists from this release; a baseline recorded earlier cannot be carried across"
validUntil: ""
expected: "renaming a page, or naming a previously-bare URL, keeps its baseline suppressing; the same route on a different host or port pairs without hand-matched names; two pages that would share one id are a hard error naming both URLs; a schemaVersion 1 baseline is refused by name with the command that re-records it"
covers:
  - cli.commands.snapshot.flags.--baseline
  - cli.commands.snapshot.flags.--update-baseline
  - cli.commands.diff
notion: ""
---

## Steps

The subject is the **join** — which finding on the left is the same finding on the
right. Every step changes something that is _not_ the page, and asserts the join
holds anyway.

1. **Record a baseline.** Config with one entry, `{ "name": "Home", "url": "http://localhost:3000/" }`.
   `real-a11y snapshot --config a11y.config.json --update-baseline`, then
   `real-a11y snapshot --config a11y.config.json --baseline .a11y-baseline.json --fail-on error`
   — note how many findings are suppressed.
2. **Rename the page.** Change `"name": "Home"` to `"name": "Marketing home"`.
   Change **nothing else.** Re-run the `--baseline` command from (1).
3. **Name a bare URL.** Baseline a page by positional URL
   (`real-a11y snapshot http://localhost:3000/pricing --update-baseline`), then move
   that same URL into a config entry that gives it a `name`, and re-run against the
   same baseline.
4. **Change the environment.** Snapshot the page on `:3000` to `base.json`, serve the
   same build on `:3001`, snapshot to `pr.json`, `real-a11y diff base.json pr.json`.
   Do it a second time with genuinely different names on the two sides.
5. **Collide two pages.** A config with two entries whose URLs share a path but differ
   in host — `https://a.example.com/` and `https://b.example.com/`. Run `snapshot`.
   Then give one of them `"id": "b-home"` and run it again.
6. **Carry a baseline forward.** Take a `.a11y-baseline.json` written by a release
   _before_ this one (`"schemaVersion": 1`) and run (1)'s `--baseline` command against it.
7. **Diff two routes at once.** One artifact holding `/` and `/pricing`, diffed against
   another holding the same two. Then diff it against one holding `/` and `/careers`.
8. **Audit a URL carrying a secret.** `real-a11y snapshot "http://localhost:3000/?token=hunter2" -o s.json`,
   then `grep -c hunter2 s.json`. Repeat with `--update-baseline` and grep the baseline.
9. **Audit a `data:` URL.** Snapshot the same `data:text/html,…` document twice with
   one byte of content changed between the runs, and diff the two artifacts.
10. **List one URL twice with different `rootSelector`s** — the pattern the CI guide
    used to show. Run `snapshot`.
11. **Collide two routes from `A11Y_PAGES`, not a config.**
    `A11Y_PAGES='[{"name":"A","url":"http://127.0.0.1:8821/"},{"name":"B","url":"http://127.0.0.1:8822/"}]' real-a11y snapshot -o out.json`.
    Then add `"id":"b-home"` to the second entry and re-run.
12. **Diff a base artifact written by the previous release.** Keep an
    `a11y-snapshot.json` captured before this change (`"schemaVersion": 1`) and
    `real-a11y diff old-base.json fresh-pr.json`, where the PR side is a fresh
    capture of the *same* unchanged site.
13. **Compare two MCP checkpoints of a `data:` page.** `checkpoint_findings` as
    `before-fix`, then again as `after-fix` with nothing changed, then
    `diff_checkpoints`.
14. **Audit a route that redirects to a different path** (`/` → `/en`) with both
    `real-a11y audit` and `real-a11y snapshot`, and compare one finding's `id`
    across the two outputs.

## Expected

- **2** — the same count suppressed as (1), and exit `0`. **This is the whole row.**
  A rename is a change to how a page is _described_; a baseline records debt accepted
  for a page. If renaming un-suppresses, the file silently stops gating and the
  failure mode is a real finding that never fails CI
- **3** — suppressed, not `stale`. The bare run and the named run are the same page —
  they have the same URL. `--update-baseline` reporting `stale: 1` here means the two
  runs disagreed about what the page was
- **4** — the findings pair; the diff reports the real delta, not "every finding on
  `:3000` removed, every finding on `:3001` added". **The second run must behave
  identically** — the names differ and it makes no difference, which is exactly what
  changed. Before this release the names had to be kept character-identical by hand
- **5** — the first run **fails**, naming _both_ URLs and telling you to add an `id`
  to one of the config's `urls` entries. Not a warning, not last-write-wins: two
  pages' findings blended into one bucket is the worst outcome this model can
  produce, and it is invisible once it happens. The second run succeeds and treats
  them as two pages
- **6** — refused, by name, saying the file predates page identity and that its
  entries key on the display label — plus `real-a11y snapshot --update-baseline` to
  re-record. It must **not** attempt a mapping: a wrong guess suppresses a real
  finding, which is worse than the error
- **7** — the shared routes join and the unshared ones classify as added / removed.
  Check that `/` didn't pair with `/careers` just because both artifacts list a page
  in that position
- **8** — **zero** matches, in the artifact and in the baseline. The id is a
  serialized field and rides into every fingerprint tuple and every baseline entry,
  all of which get committed and posted into PR comments, so it has to sit on the
  same side of the redaction boundary as `url`. Expect `"id": "/?token=%5BREDACTED%5D"`
  — the path and the parameter *name* survive, only the value goes, so it is still a
  precise join key
- **9** — the two artifacts diff as **one page that changed**, not as two unrelated
  pages. A `data:` URL's path is the document itself, so deriving an id from it would
  make every content edit a new page; it gets no id and falls back to the label.
  Confirm too that the artifact does not contain the page's own HTML in an `id`
- **10** — refused, naming both entries. Since the native-only migration `audit` and
  `snapshot` both read the whole document, so those two entries measure the *same*
  thing under two labels — one page. It used to warn and audit the page twice
  identically. Deleting the redundant entry is the fix; an explicit `id` also works
- **11** — refused the same way as (5), and the `"id"` fixes it **without moving to a
  config file**. The refusal names `id` as the remedy, so `A11Y_PAGES` has to accept
  one: it is the documented drop-in for the CI guide and what this repo's own audit
  script uses, and an error whose only fix is "rewrite your whole setup" is not a fix
- **12** — the diff reports **no change**. The old artifact's hashes were keyed on the
  display label; this build re-keys them on read, from the `url` it already stores and
  each finding's own components, so they land exactly where a fresh capture puts them.
  Reading it without converting would report every unchanged finding as fixed **and**
  new — a spurious gating regression on the first diff after upgrading. A baseline is
  refused rather than converted because it stores no URL to derive from; note the
  asymmetry is deliberate and check the artifact path does not also refuse
- **13** — `0 new · 0 fixed`. A `data:` document has no route, so both checkpoints
  fall back to their labels for identity and would otherwise never pair — every
  finding reported as removed **and** re-added on an unchanged page, with no note,
  because the different-page note also can't fire on an unparseable address. Verify
  a real change on such a page still shows up, and that one routed side against one
  routeless side is still reported as a mismatch rather than force-joined
- **14** — the two ids are **identical**. Both commands key on the *requested* URL, not
  the landed one, so a redirect can't hand one finding two "stable" ids depending on
  which command reported it. Requested also means adding or removing a redirect later
  doesn't silently re-identify the page. `audit` still *displays* the landed URL —
  that is where the findings came from

## Why this exists

`SnapshotPage.name` was documented as _"Diff join key + display label"_ — one field
with two jobs, and the join key **was** the label. So the tool's answer to "is this
the same page?" was "does it have the same caption?", and three defects fell straight
out of that: a rename un-suppressed a baseline (2), auditing a bare URL and later
naming it in a config did the same (3), and the same page on two hosts only paired if
you kept the labels matching by hand (4).

No single field fixes all three — which is why the conflation survived as long as it
did. The URL breaks (4), and that is precisely why `name` was chosen over it in the
first place; the label breaks (2) and (3). Identity is its own field now, derived
from the URL's path + search + hash with the origin dropped.

Two traps worth aiming at deliberately:

- **A merge is silent, a split is loud.** (5) is the only failure here that cannot be
  spotted from the output afterwards — two pages sharing a bucket produce a plausible
  report with the wrong findings in it. Everything else in this row fails visibly.
  That asymmetry is why the collision is a hard error and the mismatch in (4) is not
- **(4)'s second run is the regression guard, not the first.** An implementation that
  keyed identity on the whole URL passes (4a) and fails (4b) — and one that kept
  keying on the name passes (4b) and fails (4a). Only running both distinguishes the
  fix from either half of it. The MCP side of the same pair is R10 step 7

## Notes

The rule is not new. `differentUrl` — which decides whether an MCP checkpoint diff
spans two pages, and therefore whether to suppress its structural summary — already
compared path + search + hash and ignored the origin. This release promotes that rule
to the identity it was always implying, and both surfaces read the same `pageIdOf`,
so a second definition of "same page" can't drift into existence between them.

Artifacts back-fill `id` from their `url` on parse, so an artifact from an older
release stays readable and (7) works across the boundary. Baselines can't — they
store no URL, only a label — which is what (6) is about. That asymmetry is the one
upgrade cost of this change, and it is deliberate: the alternative was guessing.

Two workarounds deleted themselves when identity split off, which was the acceptance
test for the design. `diffLabeledCheckpoints` re-fingerprinted both sides under a
neutral literal because a checkpoint's label was its identity, and `import_checkpoint`
rewrote an imported artifact under the store label for the same reason — that second
rewrite would now _break_ the join it once repaired. R10 step 5 covers the import
side.
