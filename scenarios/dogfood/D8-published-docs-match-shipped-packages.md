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

1. Work through every quick-start on real-a11y.dev, in a scratch project each time
2. Copy-paste each code block verbatim — no silent corrections
3. For the CLI reference: check every command and flag documented actually exists
   (`real-a11y <cmd> --help`)
4. For the MCP reference: check every tool name and parameter documented actually exists in
   `tools/list`
5. Check the stated **counts** — "Fourteen commands", "twenty tools" — against reality
6. Check the recipes (Next.js, Storybook + React 19, peer dependencies, CI diff bot) still
   describe what ships
7. Check version-pinned snippets (`@beta`, exact versions) resolve
8. Note anything documented that no longer exists, and anything shipping that isn't documented

## Expected

- Every quick-start runs as written, against the versions just published
- Every documented name, flag and tool exists; no documented flag is an unimplemented error
- Counts match reality
- Nothing shipped is undocumented, and nothing documented is unshipped

## Why this exists

Docs are the product for anyone who hasn't installed yet, and they rot in a way tests never
catch — nothing fails when a sentence becomes false.

Steps 5 and 8 have both caught real drift. Hardcoded counts went stale the moment new commands
and tools landed; and native `list_elements` was documented in three places as carrying no CSS
locator long after the producer had been fixed to emit them — the code got better and the docs
kept telling people it hadn't.

Step 2 is the discipline that makes this worth running: silently fixing a broken snippet as you
go is how a broken snippet survives every release.

## Notes

**On `covers:`** — this row is the human counterpart to the automated `surface:check`, which
already gates documented-vs-shipped names, flags, tools and counts on every PR. It is
deliberately not listed as covering individual commands or tools: what it actually tests is
whether the prose around them is still true, which no manifest path represents.
