---
"@real-a11y-dev/snapshot": minor
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
---

One producer per surface — `--producer` and the MCP `producer` param are gone.

The rule is **native for the a11y tree, DOM where the data only exists in the DOM**. Every read now comes from Chromium's own accessibility tree, which reaches structure no in-page walk can (a `<video controls>`'s user-agent-shadow media controls) and carries locators as of #251 — except tab order, which it cannot produce at all.

**The flags are removed, not defaulted.** Each surface has exactly one correct producer, so there was nothing left to choose: `--producer` is gone from the CLI, `producer` from the MCP tools, and `compare_producers` with them (20 → 19 tools). `--root` survives on `tabs` alone; every other command reads the whole document, so a selector has nothing to scope, and they refuse the flag with that explanation rather than the parser's "Unknown option". A config `defaults.root` **warns on stderr and keeps running** — this loader is otherwise strict and fail-closed, and erroring would red every CI that set the key, mid-beta, over config that was correct when it was written.

**`tabs` stays on the DOM producer, and that is not a fallback.** Native does know per-node focusability — `"focusable"` is in `STATE_PROPS`, which is what `focusedId` was built on. What it cannot produce is the _sequence_: `tabindex` is not in `DOM_ATTR_ALLOWLIST`, so it never reaches a native node, and ordering by it is DOM/layout work Chromium's AX tree doesn't expose. One DOM extraction still yields all four views from a single `page.evaluate`, so `tabs` is one read, not a second pass.

## The artifact had to change shape, and omission alone was not enough

`projectNativeTree` returns `tabOrder: ""`, which `buildSnapshotPage` renamed to the artifact's `tabs`. So the **first diff across this migration** would compare a DOM artifact's N tab stops against a native one's none, and `views-summary` would report every stop as gone:

```
Keyboard tab stop removed: button "Save"
Keyboard tab stop removed: link "Home"
… once per focusable element, on every page
```

That is the tool's most safety-critical signal firing spuriously, at volume, on an upgrade where no page changed — plus the `NOTHING_FOCUSABLE` sentinel ("Nothing on this page is keyboard-focusable any more") reachable the same way.

Simply omitting the view does not fix it. `parseSnapshotArtifact` coerced a missing `tabs` straight back to `""`, so a reader could not tell _absent_ from _empty_ and landed in the same place. The fix needs a presence signal that survives the round trip:

- **`SnapshotPage.tabs` is now optional**, and a native page omits it.
- **`meta.views`** records which views the run measured. Additive, so `schemaVersion` stays `1`; absent/null reads as a legacy artifact that measured all three, which is what its silence meant.
- **The parser respects it** — an unmeasured view stays `undefined` (and a stray one is dropped, so the two can never disagree), while a _measured_-but-missing view still defaults to `""`, because "measured, nothing focusable" is a real state.
- **`diff` compares an axis only when both sides measured it**, and reports the rest as `skippedViews` — surfaced in every format, so a silently skipped axis is never read as "tab order is fine".

The same signal rides through the MCP server: `checkpoint_findings` is native too (both tools must read one producer, or a checkpoint captured by one and diffed by the other compares cross-producer findings), and `export_checkpoint` declares `views: ["tree", "outline"]`. A DOM-era artifact imported as a base still diffs cleanly — the tabs axis is skipped, not emptied.

## What this costs

- **`inspect` no longer prints tab order**, and prints no empty section either — an empty block reads as _nothing here is focusable_, a very different claim from _not measured_. `real-a11y tabs` is the sequence. In exchange `inspect` and `audit` finally agree on findings, which they previously did not.
- **`snapshot`/`diff` no longer detect tab-order regressions at all**, since the artifact carries no tabs view. The CI diff-bot guide says so plainly rather than leaving a stale promise. `real-a11y tabs` still reports the sequence, and still takes `--root`.
- **A route's `urls[].rootSelector` no longer scopes `audit` or `snapshot`.** Both warn once, naming the routes, and keep running — findings from outside that subtree are now included. The entry still identifies a route.
- **MCP checkpoints are whole-document too.** `checkpoint_findings`/`diff_findings` lost their `rootSelector`, so a base imported from a DOM-era artifact that was captured at a narrow root now diffs against a whole-page re-snapshot: the old findings still match by fingerprint, but everything outside that subtree arrives as NEW — the class that gates CI. The diff says so in its first line, naming both scopes, rather than widening silently.

Tab-order machinery stays in core / serialize / browser / extension / mcp; only the CLI's `inspect` and `snapshot` stopped consuming it. `@real-a11y-dev/testing` runs in-page by design and is unaffected.
