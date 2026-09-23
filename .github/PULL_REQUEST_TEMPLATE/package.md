<!-- New package PR — open with: gh pr create --template package.md -->

## New package: `@real-a11y-dev/<name>`

<!-- What it does, and why it's its own package rather than folded into an existing one. -->

## Public surface

<!-- Entry points and exports — the API consumers will import. -->

## How to verify

<!-- Steps a reviewer can run on a fresh checkout to use the new package for
     real, and what they should see — the install/build, the import or command,
     the output. Name a fixture or example in the repo rather than asking them
     to invent one.

     A brand-new package has no "before", so the before/after table the generic
     template asks for does not apply here. What replaces it is the same thing
     it was for: a reviewer confirming the thing works by using it, rather than
     inferring it from a green suite. If this package ships a surface a person
     interacts with (a CLI, a panel, a rendered page), walk through that too,
     not just the programmatic API. -->

- [ ] The steps above run clean on a fresh checkout of this branch

## Checklist

- [ ] `package.json`: `publishConfig` (`access: public`, `provenance: true`), `files`, `exports`, repo/homepage/bugs
- [ ] Dependencies justified — `@real-a11y-dev/core` stays dependency-free
- [ ] `README.md` + a docs page on the website
- [ ] Added to the `linked` cohort in `.changeset/config.json` (or `ignore` if private)
- [ ] Bundles `core`/`ui`? It's covered by `scripts/check-bundlers.mjs` (derived from tsup `noExternal`)
- [ ] `pnpm packaging:check` green
- [ ] `minor` changeset for the new package
