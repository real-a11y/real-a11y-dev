---
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
---

feat!: a page's identity is now separate from its display label

`SnapshotPage.name` was documented as _"Diff join key + display label"_ — one
field with two jobs. Because the join key **was** the label, changing the label
changed what the tool believed the page was. Three failures came from that one
conflation:

- renaming a page for readability un-suppressed its baseline;
- auditing a bare URL and later naming it in a config did the same;
- the same page on localhost vs prod only paired if you kept the names
  character-identical by hand.

No single field fixes all three — the URL breaks the third (which is why `name`
was chosen over it), the label breaks the first two. So identity is its own
field now, derived from the part of a URL that survives both:

| field  | job                                      | default                 |
| ------ | ---------------------------------------- | ----------------------- |
| `id`   | join key — diff, baselines, fingerprints | the URL's path + search |
| `name` | display label, free to change            | the redacted URL        |
| `url`  | where it was captured                    | —                       |

Config entries take an optional `id` to collapse routes the path separates, or
to separate two sites that share one. Two pages with the same id is a **hard
error** naming both URLs and the fix — silently blending two pages' findings is
the worst outcome this model can produce.

The rule is not new: `differentUrl` already compared path + search + hash and
ignored the origin when deciding whether a checkpoint diff spanned two pages.
This promotes it to the identity it was always implying, and both now read the
same `pageIdOf` so a second definition can't drift into existence.

**Breaking.** `ARTIFACT_SCHEMA_VERSION` and `BASELINE_SCHEMA_VERSION` are both
`2`, because a finding's fingerprint now keys on the page's id rather than its
label — the hashes in a pre-upgrade file were computed over a different tuple,
and comparing the two schemes reports unchanged findings as fixed + new.

The two formats are treated differently, and the asymmetry is the point:

- **Artifacts are converted on read.** A v1 artifact holds the page `url` (→ the
  identity) and each finding's own components (rule, role, locator, …), so it
  can be re-keyed to produce exactly what a fresh capture of that page hashes.
  Nothing is guessed and nothing is lost — an old `a11y-snapshot.json` still
  diffs correctly against a new one, with no re-record.
- **Baselines are refused by name.** A baseline stores no URL, only a label, so
  its identity cannot be derived from what it holds. Guessing was rejected
  outright: a wrong guess silently suppresses a real finding.

**Upgrading a baseline.** Run `real-a11y snapshot --update-baseline`. It
replaces an unreadable baseline rather than refusing it — refusing would be a
dead end, since that is the command the refusal points you at — and says so, so
the `+new/-stale` counts stay interpretable. **Any `note` you wrote on an entry
does not survive**, and a note is the only part of a baseline nothing can
regenerate, so recover those from version control before committing.

The id is derived from the **redacted** url, so a `?token=…` never reaches the
artifact, the fingerprints or the committed baseline through this new field.
Schemes with no route — `data:`, `about:`, `blob:` — get no id at all and fall
back to the display label, which is the pre-identity behaviour and the right
answer for a content-addressed URL.

**Two config entries that differ only by `rootSelector` are now an error.**
Since the native-only migration both `audit` and `snapshot` read the whole
document, so such a pair names one URL and measures the same thing twice — one
page, one id. It used to warn and audit the page twice identically. Delete the
redundant entry, or give one an explicit `id`.

`import_checkpoint` no longer rewrites an imported page under the store label —
it did that because a label was an identity, and the rewrite would now break the
join it once repaired, so an artifact is stored as it arrived. Cross-tool diffs
(MCP `export_checkpoint` → CLI `diff`) work as a result, which they never have.

`diffLabeledCheckpoints` mostly stands down too: for a page with a real route
both sides derive the same id and join on their own. It keeps its neutral
re-fingerprint for one case — when **neither** side has a route (`data:`,
`about:blank`), where the id falls back to the display label and two checkpoints
of one unchanged page would otherwise report every finding as removed + re-added
with no note explaining why. One routed side and one not stays a genuine
mismatch and is not forced together.

`A11Y_PAGES` entries take an optional `id`, matching config `urls` entries. Two
pages resolving to one identity is a hard error, so the remedy has to be
reachable from whichever page list you use — `A11Y_PAGES` is the documented
drop-in for the CI guide, and "rewrite it as a config file" is not an answer.
