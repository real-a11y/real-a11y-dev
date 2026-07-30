---
id: D7
suite: dogfood
scenario: "React inspector from npm in a fresh Next.js app (SSR-safe drop-in)"
area: React/Inspector
type: Manual
priority: P1
status: Active
validFrom: "react ≥ 0.1.0-beta.11 · inspector ≥ 0.1.0-beta.11, from the registry on the `beta` tag. Next.js App Router specifically — a client-only SPA doesn't exercise the SSR risk"
validUntil: ""
expected: "installs into a fresh Next.js App Router project, renders client-side, no hydration/SSR errors"
twin: R20
covers:
  - packages.@real-a11y-dev/react
  - packages.@real-a11y-dev/inspector
notion: "https://app.notion.com/p/3aa1c354b0b58179b030c1377fa18401"
---

## Steps

A genuinely fresh Next.js App Router project — the SSR path is the whole point, so a Vite SPA does
not substitute.

```bash
npx create-next-app@latest scratch --app --ts
```

Then install `@real-a11y-dev/react@beta` into it.

1. Follow the published drop-in instructions exactly
2. `npm run dev` — load a page with the inspector mounted
3. Watch the **server** console as well as the browser one
4. Check specifically for hydration mismatch warnings
5. Switch the `mode` prop; use the picker
6. Mount the inspector inside a component that only renders client-side
7. `npm run build && npm start` — the **production** build
8. Repeat 2–5 against the production build
9. Try mounting it in a Server Component and read the error

## Expected

- **2** — renders client-side without extra ceremony beyond what the docs describe
- **3/4** — **no** hydration errors, no "window is not defined", no SSR crash. This is the whole
  risk of this row
- **5** — works as in the example app
- **7/8** — the production build behaves like dev. React's dev build tolerates things production
  does not
- **9** — a clear error or documented guidance, not an inscrutable stack trace

## Why this exists

`@real-a11y-dev/react` reads the DOM, and Next.js renders on the server where there is no DOM. That
mismatch produces the two failures that make a library feel unusable: a build-time crash
(`window is not defined`) or a hydration warning that floods the console on every page.

Both are invisible in a client-only example app, which is exactly what the pre-publish row (**R20**)
uses. Next.js App Router is also the most common React setup a new user will arrive with, so a
failure here blocks the largest single group of adopters.

Step 7 matters independently: dev-mode React is forgiving in ways production isn't, so "works in
dev" is not evidence.
