# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

This repo is **single-context**: one `CONTEXT.md` at the root and one set of ADRs,
covering all sixteen packages. The concepts that matter here — the two tree
producers, the realm singleton, the surface manifest — cut across packages rather
than sitting inside one, so there is no per-package glossary.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **The ADRs**, which live in **Notion, not the repo**: the
  [ADRs](https://app.notion.com/p/3e71c354b0b58129a558ef5337ceef4a) page under
  Engineering. Read the ones that touch the area you're about to work in. Fetch
  them with the `notion-*` MCP tools.

If `CONTEXT.md` doesn't exist, **proceed silently**. Don't flag its absence; don't
suggest creating it upfront. The `/domain-modeling` skill (reached via
`/grill-with-docs` and `/improve-codebase-architecture`) creates it lazily when
terms actually get resolved.

Note that `CLAUDE.md` and `CONTRIBUTING.md` already carry much of this repo's
operating knowledge. A `CONTEXT.md` is for **domain vocabulary** — what a term
means — not for process or traps, which stay where they are.

## ADRs are in Notion

**Do not create `docs/adr/`.** A decision is recorded as a new child page of the
Notion ADRs page, titled `ADR-NNNN — <the decision in a phrase>` and numbered in
order of creation; that page describes the format (status, sections, how PRs and
ADRs link to each other). An ADR is never rewritten once accepted — a later one
supersedes it.

Accepted so far:

| ADR      | Decision                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0001 | [Field values: withhold what is sensitive, show what a screen reader reads](https://app.notion.com/p/3e71c354b0b581d2a8d3fb2ce6612a24) — `a11y.value`, the sensitivity policy, `redactInput` |

The table is a convenience and goes stale; the Notion page is the index.

## File structure

**`CONTEXT.md` doesn't exist yet.** This is where it goes once `/domain-modeling`
creates it:

```
/
├── CONTEXT.md
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
