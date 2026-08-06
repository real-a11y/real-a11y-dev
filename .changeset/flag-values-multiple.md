---
"@real-a11y-dev/cli": patch
---

fix: `FlagValues` admits the array values `parseArgs` actually produces

`FlagValues` was `Record<string, string | boolean | undefined>`, but three flags
are declared `multiple: true` — `--audit-origin`, `--step` and
`--ignore-view-line` — so `node:util.parseArgs` hands back a `string[]` for them
and always has.

Nothing misbehaved at runtime, because the commands already guard with
`Array.isArray(...)`. The cost was to the type: those guards read as dead code
to both a reader and the compiler while being the branch that actually fires,
and one call site had already been patched by hand to accept `string[]` locally.
`FlagValue` is now a named alias carrying the array arm, used by every parser
helper.

The type was wrong for as long as it existed because the files that pass real
array values — the tests — were excluded from typechecking.
