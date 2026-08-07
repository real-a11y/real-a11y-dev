---
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

Stop publishing `@real-a11y-dev/validate` and `@real-a11y-dev/semantic-navigator-ui`; they are internal now.

Neither was ever a package anyone was told to install. Nothing on the website recommended either one — the only `npm install` lines for them were in their own READMEs — and no published `.d.ts` referenced their types. `semantic-navigator-ui` was already bundled by every consumer that uses it (`inspector` doesn't even declare it as a dependency), so for that one this mostly writes down what the build already did.

**Nothing changes for you unless you imported one directly.** They move from `dependencies` to `devDependencies` and are bundled into the packages that use them, so `@real-a11y-dev/testing` and `@real-a11y-dev/storybook-addon` now install _fewer_ packages, not more. Measured bundle sizes are unchanged — size-limit already counted the whole dependency graph.

If you did import one directly:

- `@real-a11y-dev/validate` (last published `0.1.0-beta.7`) → its rules reach you through `@real-a11y-dev/testing`'s `toBeValidA11yTree` matcher. The role-metadata helpers it also exported (`roleMeta`, `isValidRole`, `attributesForRole`, `requiredOwnedRoles`, …) have no published replacement — open an issue if you were using them directly.
- `@real-a11y-dev/semantic-navigator-ui` (last published `0.1.0-beta.11`) → use `@real-a11y-dev/inspector`, `@real-a11y-dev/react`, or `@real-a11y-dev/storybook-addon`, each of which bundles the components.

Both consumers inline the private declarations (`dts.resolve`) as well as the JS, so no shipped `.d.ts` names a package npm cannot resolve — `surface:check` fails if that ever regresses.
