---
id: D8
suite: dogfood
scenario: "Published docs match the shipped packages (quick-starts actually run)"
area: Docs/Site
type: Manual
priority: P1
status: Active
validFrom: "every release. Counts to re-check each time: commands in website/packages/cli/commands.md, tools in packages/mcp/README.md and website/packages/mcp/tools.md"
validUntil: ""
expected: "every quick-start on real-a11y.dev runs against the just-published versions; documented names/flags/tools all exist"
notion: "https://app.notion.com/p/3aa1c354b0b581b4ba99d6d7b218098d"
---

## Steps

Read the **published** site, and run what it tells you to, against the **just-published**
versions.

1. Work through every quick-start on real-a11y.dev, in a scratch project each time — and
   each one on a machine with **only** what that page installs. The MCP onboarding never
   installs the CLI, so any `npx real-a11y …` it tells you to run has to work there
2. Copy-paste each code block verbatim — no silent corrections
3. For the CLI reference: check every command and flag documented actually exists, both
   ways. `--help` is not a complete inventory — it omits flags the parser accepts, and it
   short-circuits strict parsing (`tree --bogus-flag --help` exits 0). Probe acceptance
   without a browser instead: run `real-a11y <cmd> <flag>` with no URL, giving a
   value-taking flag a value. `Unknown option '<flag>'` means the parser doesn't accept
   it; any other error — a missing URL ("takes exactly one URL", "no URL given"), a
   refusal that names the flag, as `--root` gets on a native command — means it does.
   Then list what it accepts that `--help` and the reference don't mention
4. For the MCP reference: check every tool name and parameter documented actually exists in
   `tools/list`
5. Check the stated **counts** — "Fourteen commands", "twenty tools" — against reality
6. Check the recipes (Next.js, Storybook + React 19, peer dependencies, CI diff bot) still
   describe what ships
7. Check version-pinned snippets (`@beta`, exact versions) resolve. Any
   sentence that says `latest` is unpublished must match
   `npm view @real-a11y-dev/<pkg> dist-tags` that day — D1 already asserts both
   tags move while pre-mode is on
8. Note anything documented that no longer exists, and anything shipping that isn't documented
9. For every block that shows **output** — a tree, an audit report, a diff — run the command
   above it and compare. Not "does it look right": compare. A block whose input you can't
   reproduce (a `localhost:3000` nobody committed) is a finding of its own: it needs a
   committed fixture, or an explicit "illustrative" marker

## Expected

- Every quick-start runs as written, against the versions just published, with nothing
  installed that the page didn't install
- Every documented name, flag and tool exists; no documented flag is an unimplemented error;
  and every flag the parser accepts is in its command's `--help`
- Counts match reality
- Nothing shipped is undocumented, and nothing documented is unshipped
- **7** — a sentence that says `latest` is unpublished is false while pre-mode
  keeps both tags moving; check `npm view … dist-tags`, not the paragraph
- **9** — every shown output matches what the command prints. A block that is merely
  plausible is the failure mode here: it reads as verified by someone, and never was

## Why this exists

Docs are the product for anyone who hasn't installed yet, and they rot in a way tests never
catch — nothing fails when a sentence becomes false.

Steps 5, 8 and 9 have all caught real drift. Hardcoded counts went stale the moment new commands
and tools landed; native `list_elements` was documented in three places as carrying no CSS
locator long after the producer had been fixed to emit them — the code got better and the docs
kept telling people it hadn't; and the CLI quick-start showed a `main`-rooted tree with two
children for `https://example.com`, a page that has no landmark and four. That last one survived
**four producer changes** because it was recorded once and never re-run: written in #140, never
re-recorded, and wrong in three ways by the time anyone checked.

Step 9 exists because that class is otherwise unguarded. `surface:check` validates that
documented invocations *parse* and says outright that it does not check semantics, so the
command in a block is checked and its output is not. Output is the third staleness axis, after
counts and names, and the only one with no automated gate.

Step 2 is the discipline that makes this worth running: silently fixing a broken snippet as you
go is how a broken snippet survives every release.

Steps 1, 3 and 9 were sharpened by the beta.19 dogfood. Its MCP onboarding told users to run
`npx real-a11y install`, which only works where the CLI is already installed — anywhere else it
is an E404, for a package name nobody has claimed. Checking flags through `--help` passed while
three flags every browser command accepts appeared in no help text. And the CLI's audit output
block could not be produced by the shipped CLI from any input, which a block with a committed
fixture would have shown the day it drifted.

## Notes

The CLI quick-start specifically is now pinned from the other side too — a case in
`packages/cli/e2e/cli.e2e.test.ts` runs `tree` against a copy of `example.com`'s markup and
compares it to the block in both doc copies. That catches *our* producer changing under the
block, which is what happened. It cannot see `example.com` changing its own markup, which is
why step 9 still runs here against the live page.

**On `covers:`** — this row is the human counterpart to the automated `surface:check`, which
already gates documented-vs-shipped names, flags, tools and counts on every PR. It is
deliberately not listed as covering individual commands or tools: what it actually tests is
whether the prose around them is still true, which no manifest path represents.
