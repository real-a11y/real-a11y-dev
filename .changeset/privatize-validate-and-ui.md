---
"@real-a11y-dev/storybook-addon": minor
"@real-a11y-dev/testing": minor
---

Stop publishing `@real-a11y-dev/validate` and `@real-a11y-dev/semantic-navigator-ui`; they are internal now.

Neither was ever a package anyone was told to install. Nothing on the website recommended either one — the only `npm install` lines for them were in their own READMEs — and no published `.d.ts` referenced their types. `semantic-navigator-ui` was already bundled by every consumer that uses it (`inspector` doesn't even declare it as a dependency), so for that one this mostly writes down what the build already did.

**Nothing changes for you unless you imported one directly.** They move from `dependencies` to `devDependencies` and are bundled into the packages that use them, so `@real-a11y-dev/testing` and `@real-a11y-dev/storybook-addon` now install _fewer_ packages, not more. The trade is real, though: those packages come off your install, and ~218 KB goes into `@real-a11y-dev/testing`'s `matchers` entry, which now carries `aria-query`'s role tables inline — ~15x raw, 4.8x gzipped. Nothing had been measuring that: the only `testing` entry in `.size-limit.json` pointed at `dist/index.js`, which never imported `validate`, so `pnpm size` stayed green by construction rather than by measurement. This adds a budget for `dist/matchers.js` so the number that actually moved is governed. If your suite also uses `@testing-library/dom`, you already had two copies of `aria-query` on disk (it pins `5.3.0`; `validate` asked for `^5.3.2`) — what changes is that the second copy is now frozen inside our entry, past the module boundary, where an `overrides`/`resolutions` pin can no longer collapse them.

If you did import one directly:

- `@real-a11y-dev/validate` (last published `0.1.0-beta.7`) → its rules reach you through `@real-a11y-dev/testing`'s `toBeValidA11yTree` matcher. The role-metadata helpers it also exported (`roleMeta`, `isValidRole`, `attributesForRole`, `requiredOwnedRoles`, …) have no published replacement — open an issue if you were using them directly.
- `@real-a11y-dev/semantic-navigator-ui` (last published `0.1.0-beta.11`) → use `@real-a11y-dev/inspector`, `@real-a11y-dev/react`, or `@real-a11y-dev/storybook-addon`, each of which bundles the components.

No shipped `.d.ts` names a package npm cannot resolve. Neither consumer's public surface exposes a private type today, so nothing needs inlining yet; `dts.resolve` is configured on both so it stays that way if one ever does, and `surface:check` fails if that regresses.
