---
id: R24
suite: regression
scenario: "Act path — the typed text is never echoed, and a sensitive field's value never appears anywhere, on success or failure, CLI and MCP"
area: CLI
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.2 · mcp ≥ 0.1.0-beta.2 (the echo checks). The password-field tree check, the plain-field value check and step 7 as written (values shown, --redact-input / REAL_A11Y_REDACT_INPUT): cli ≥ 0.1.0-beta.7 · mcp ≥ 0.1.0-beta.7 (unreleased)"
validUntil: ""
expected: "Type a sentinel secret into a type=password field, then grep for it in: CLI stdout, CLI stderr, --format json (the step renders = ‹hidden›), the MCP tool result, and any subsequent diff / get_semantic_tree / audit output. Zero hits anywhere, and no bullets — the field reads [redacted] — including the FAILURE paths (bad nth, unknown role, unterminated quote, trailing input). Typed into a plain field, the text is never ECHOED on any path, but the diff and tree show it as the field's value; into a rich-text editor, it shows by default and is withheld under --redact-input / REAL_A11Y_REDACT_INPUT=1. Prove delivery separately, via a page that echoes only the value's LENGTH."
twin: D10
covers:
  - cli.commands.type
  - mcp.tools.type_text
  - cli.commands.interact.flags.--redact-input
  - env.REAL_A11Y_REDACT_INPUT
notion: "https://app.notion.com/p/3ab1c354b0b58182b58edfe5487fada1"
---

## Steps

Pick a sentinel that would have defeated every previous fix:

```javascript
SENTINEL='api_key=sk-live-9f2b=='
```

It must contain an `=` **and** end in `=`. A secret without one passes even when the
masking is broken — that is exactly how this shipped broken three times.

The page needs a `<input type="password" aria-label="Password">` and a plain
`<input aria-label="Email">`, each echoing only its value's **length** into a heading.

1. `real-a11y type <url> --role textbox --name "Password" --text "$SENTINEL"`,
   capturing stdout and stderr **separately**
2. Same, with `--format json`
3. `real-a11y interact <url> --step "type textbox \"Password\" = $SENTINEL"`
   - **3b** — `real-a11y interact <url> --step "type textbox \"Email\" = $SENTINEL"`,
     then again with `--redact-input`
4. Failure paths — each must also stay clean:
   - `--nth 99` (out of range)
   - `--role nosuchrole`
   - `--step 'type textbox "Email = value'` (unterminated quote)
   - `--step 'type textbox "Email" = a b c'` (trailing input)
5. MCP: `checkpoint_tree`, `type_text` with the sentinel into `textbox "Password"`,
   then `diff_tree`, `get_semantic_tree`, `inspect_page`, `list_elements` (`form`) and
   `audit_page` on the same page
6. Delivery proof, separately: a field whose handler writes only `value.length` into a
   heading
7. A rich-text editor: `<div contenteditable role="textbox" aria-label="Composer"><p><br></p></div>`
   whose `beforeinput` handler cancels the event, writes `e.data` into its own `<p>`
   (the ProseMirror / Lexical shape), and echoes only the length. Repeat (3) and (5)
   against `textbox "Composer"` — once as is, once with `--redact-input` (CLI) and a
   server started with `REAL_A11Y_REDACT_INPUT=1` (MCP)

## Expected

- For the **password** field (1–5): `grep -F "$SENTINEL"` finds **zero** hits in: CLI
  stdout, CLI stderr, `--format json`, the MCP tool results, and every later
  diff / tree / list / audit output — and no `•` either, since Chromium's masking
  bullets would give away the length. The diff reads
  `~ textbox "Password": a11y.value (unset) → "[redacted]"`: it says a value is
  there, never what or how long. Before cli / mcp 0.1.0-beta.7 the diff printed no
  value line at all
- Under `--format json` the step renders `= ‹hidden›` — and there is **no** `text` key
  anywhere in the envelope
- Every failure path in (4) is equally clean. A refusal that echoes what you typed is
  still a leak
- **3b** — the step echo on stderr still reads `= ‹hidden›` with zero hits there, but
  stdout's diff shows the field's value: `~ textbox "Email": a11y.value (unset) →
  "<sentinel>"`. That is the field's content, the way a screen reader announces it
  (ADR-0001), not an echo. With `--redact-input` the diff has no `a11y.value` line
  and zero hits anywhere
- (6) shows the length changed, proving the value reached the page. Redaction that also
  broke delivery would pass a naive grep
- (7), default — the editor's content is page content: the diff shows
  `~ textbox "Composer": a11y.value (unset) → "<sentinel>"` (the step echo stays
  hidden). Under `--redact-input` / `REAL_A11Y_REDACT_INPUT=1` it is clean: the
  `interact` diff, `diff_tree`, `get_semantic_tree` and `inspect_page` show the
  length change and a bare `paragraph`, never the text. cli / mcp 0.1.0-beta.6 had
  no strict mode and printed `~ paragraph "<sentinel>"` — the editor's paragraph took
  the typed text as its name

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

A fourth path, found later and outside the echo entirely: the *tree*. Typing into a
model-driven editor puts the text in the editor's own `<p>`, and the native tree named
that paragraph with it — so `get_semantic_tree` after a clean `type_text` printed the
secret. Every earlier target was an `<input>`, whose value never becomes a node name,
which is why (7) exists.

Then the tree clause changed on purpose (ADR-0001). A field's value is what a screen
reader announces, and the act loop needs to see that a `type` landed, so the tree now
shows values — and this row's invariant narrowed to what must hold regardless: the
typed text is never *echoed*, and a **sensitive** field's value appears nowhere. That
is why the tree checks type into a password field. A password is the one value that
must fail closed twice: once as its text, and once as Chromium's bullets, whose count
is its length.

## Notes

Its own row because it is a security-class invariant that has regressed repeatedly in
review, each time through a path the previous fix didn't cover: an echo of the raw step,
then a value containing `=`, then base64 padding (`secret=`) which defeated
prefix-masking entirely. The rule is now unconditional — a `type` step never echoes its
text at all. Test secrets MUST include an `=` and a trailing `=`; secrets without one
share the old blind spot.
