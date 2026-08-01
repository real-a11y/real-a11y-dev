---
id: R24
suite: regression
scenario: "Act path R1 — a typed value never reaches ANY output stream, on success or failure, CLI and MCP"
area: CLI
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.2 · mcp ≥ 0.1.0-beta.2 (both unreleased — pending changesets)"
validUntil: ""
expected: "Type a sentinel secret, then grep for it in: CLI stdout, CLI stderr, --format json (the step renders = ‹hidden›), the MCP tool result, and any subsequent get_semantic_tree / audit output. Zero hits anywhere — including the FAILURE paths (bad nth, unknown role, unterminated quote, trailing input). Prove delivery separately, via a page that echoes only the value's LENGTH."
twin: D10
covers:
  - cli.commands.type
  - mcp.tools.type_text
notion: "https://app.notion.com/p/3ab1c354b0b58182b58edfe5487fada1"
---

## Steps

Pick a sentinel that would have defeated every previous fix:

```javascript
SENTINEL='api_key=sk-live-9f2b=='
```

It must contain an `=` **and** end in `=`. A secret without one passes even when the
masking is broken — that is exactly how this shipped broken three times.

1. `real-a11y type <url> --role textbox --name "Email" --text "$SENTINEL"`, capturing
   stdout and stderr **separately**
2. Same, with `--format json`
3. `real-a11y interact <url> --step "type textbox \"Email\" = $SENTINEL"`
4. Failure paths — each must also stay clean:
   - `--nth 99` (out of range)
   - `--role nosuchrole`
   - `--step 'type textbox "Email = value'` (unterminated quote)
   - `--step 'type textbox "Email" = a b c'` (trailing input)
5. MCP: `type_text` with the sentinel, then `get_semantic_tree` and `audit_page` on the
   same page
6. Delivery proof, separately: a field whose handler writes only `value.length` into a
   heading

## Expected

- `grep -F "$SENTINEL"` finds **zero** hits in: CLI stdout, CLI stderr,
  `--format json`, the MCP tool result, and any later tree/audit output
- Under `--format json` the step renders `= ‹hidden›` — and there is **no** `text` key
  anywhere in the envelope
- Every failure path in (4) is equally clean. A refusal that echoes what you typed is
  still a leak
- (6) shows the length changed, proving the value reached the page. Redaction that also
  broke delivery would pass a naive grep

## Why this exists

Its own P0 row because it regressed three times in review, each through a path the
previous fix didn't cover:

1. the raw step was echoed back verbatim;
2. masking from the first `=` leaked the prefix of `api_key=<secret>`;
3. a value ending in `=` (base64 padding) made `slice(0, eq + 1)` return the **whole
   string** — masking leaked everything.

The rule is now unconditional: a `type` step never echoes its text, in any output, on
any path. The `nth` token was also unredacted at one point, so check the whole rendered
step, not just the value.

Worth stating plainly: our own tests shared the blind spot. Every sentinel we used
contained no `=`. That is why the sentinel above is prescribed rather than left to the
runner.

## Notes

Its own row because it is a security-class invariant that has regressed repeatedly in
review, each time through a path the previous fix didn't cover: an echo of the raw step,
then a value containing `=`, then base64 padding (`secret=`) which defeated
prefix-masking entirely. The rule is now unconditional — a `type` step never echoes its
text at all. Test secrets MUST include an `=` and a trailing `=`; secrets without one
share the old blind spot.
