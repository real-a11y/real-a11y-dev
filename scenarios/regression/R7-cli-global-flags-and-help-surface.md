---
id: R7
suite: regression
scenario: "CLI global flags & help surface — every command's --help, --version, -o, -q, bad input"
area: CLI
type: Automated
priority: P1
status: Active
validFrom: "cli ≥ 0.1.0-beta.1. Steps 8–10 (act-command flag rejections) from cli ≥ 0.1.0-beta.2"
validUntil: ""
expected: "`--help` exits 0 with usage for EVERY command `real-a11y --help` lists — enumerate from that output rather than hardcoding a count, so the check can't rot. Unknown flag/command → exit 2 with a clear error; -o writes the file. A flag the help advertises must never be an unimplemented error, and a flag a command would ignore must not be accepted (the act commands take no --producer and no --root)."
covers:
  - cli.exitCodes
notion: "https://app.notion.com/p/3aa1c354b0b58191b674c0cca53141c1"
---

## Steps

Enumerate from the tool, never from a list written here — that is what went stale
last time.

```bash
real-a11y --help | ...        # extract the command names
```

Then, for each command name, run `real-a11y <c> --help` and record its exit code.

1. `--help` for **every** command the top-level help lists
2. `real-a11y --version`
3. `real-a11y notacommand`
4. `real-a11y audit <url> --notaflag`
5. `real-a11y audit <url> -o report.txt`
6. `real-a11y audit` with no URL and no `A11Y_PAGES` / config
7. Flag-surface honesty, per command:
   - every flag the help lists is actually implemented
   - a flag a command would **ignore** is rejected, not accepted
8. Specifically: `real-a11y click <url> --role button --producer native`, and
   `--root main`
9. `real-a11y click <url> --role button --text hi` (`--text` belongs to `type`)
10. `real-a11y interact <url> --step 'poke button'`

## Expected

- **1** — every one exits `0` and prints usage
- **2** — prints the version, exits `0`
- **3/4** — exit `2` with a clear error and a `--help` hint
- **5** — the file is written; progress still goes to stderr
- **6** — exit `2` explaining where pages come from
- **7** — no flag in the help is an unimplemented error, and none is silently
  ignored
- **8** — rejected by name. The act commands take neither, because they work
  against the whole-document native tree
- **9** — rejected **by name** — "`--text` applies to `type`" — not a generic
  parse error about positional arguments
- **10** — exit `2` naming the unknown verb, and **no browser launched**. Argument
  validation precedes the session

## Why this exists

Previously asserted "all 9 commands" and was wrong the moment the act verbs
landed — 14 today, 13 after the migration drops `tabs`. Enumerating from `--help`
is the fix: the row now can't go stale from a count.

Steps 7–9 encode the house rule that a flag which would do nothing must be
**refused**, with the remedy named. Accepting-and-ignoring is the worst option
(silent wrong results); a generic parse error is the second worst (the user can't
tell what to do instead).

Step 10 matters for cost: parse failures must never cost a browser launch.

## Notes

Was "all 9 commands" — wrong since the act verbs landed. 14 today (install, audit,
inspect, tree, outline, tabs, list, interact, click, type, focus, login, snapshot,
diff); 13 after the native-only migration drops `tabs`. Enumerating from `--help`
is why this row no longer needs editing when that changes.

**On `covers:`** — this row touches every command's `--help`, but it is
deliberately *not* listed as covering them. `covers` means "exercises the
behaviour of", not "touches". A row claiming all 14 commands would satisfy the
coverage gate for commands whose behaviour nothing actually drives, which is
exactly the false confidence the gate exists to prevent. What it really covers is
the exit-code contract and the flag-rejection rule.
