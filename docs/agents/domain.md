# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

This repo is **single-context**: one `CONTEXT.md` and one `docs/adr/` at the root,
covering all sixteen packages. The concepts that matter here — the two tree
producers, the realm singleton, the surface manifest — cut across packages rather
than sitting inside one, so there is no per-package glossary.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If either doesn't exist, **proceed silently**. Don't flag its absence; don't
suggest creating it upfront. The `/domain-modeling` skill (reached via
`/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when
terms or decisions actually get resolved.

Note that `CLAUDE.md` and `CONTRIBUTING.md` already carry much of this repo's
operating knowledge. A `CONTEXT.md` is for **domain vocabulary** — what a term
means — not for process or traps, which stay where they are.

## File structure

**Neither `CONTEXT.md` nor `docs/adr/` exists yet.** This is the shape they take
once `/domain-modeling` creates them, and the filenames below are illustrative
placeholders — there are no ADRs in this repo to cite.

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-<decision>.md
│   └── 0002-<decision>.md
└── packages/
```

## Use the glossary's vocabulary

When your output names a domain concept (in a ticket title, a refactor proposal, a
hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to
synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're
inventing language the project doesn't use (reconsider) or there's a real gap
(note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-00NN (its title), but worth reopening because…_

Cite an ADR only after reading it. Naming a plausible-sounding number you haven't
opened invents precedent, which is worse than having none.
