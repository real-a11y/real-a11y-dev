<!-- New package PR — open with: gh pr create --template package.md -->

## New package: `@real-a11y-dev/<name>`

<!-- What it does, and why it's its own package rather than folded into an existing one. -->

## Public surface

<!-- Entry points and exports — the API consumers will import. -->

## Checklist

- [ ] `package.json`: `publishConfig` (`access: public`, `provenance: true`), `files`, `exports`, repo/homepage/bugs
- [ ] Dependencies justified — `@real-a11y-dev/core` stays dependency-free
- [ ] `README.md` + a docs page on the website
- [ ] Added to the `linked` cohort in `.changeset/config.json` (or `ignore` if private)
- [ ] Bundles `core`/`ui`? It's covered by `scripts/check-bundlers.mjs` (derived from tsup `noExternal`)
- [ ] `pnpm packaging:check` green
- [ ] `minor` changeset for the new package
