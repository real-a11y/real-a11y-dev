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
npx create-next-app@latest scratch --app --ts --yes
```

`--yes` takes the defaults without prompting; record the Next.js version and what the
template turned on (16.4 enables `cacheComponents`). Then install
`@real-a11y-dev/react@beta` into it.

1. Follow the **Next.js recipe** (`website/recipes/nextjs.md`) exactly: its first snippet,
   then its Option 1
2. `npm run dev` — load a page with the inspector mounted. Then portal a
   `<p role="status">Saved</p>` into `<body>` from that page, as a toast library does: a
   live region outside the root widens the tree to `<body>`, which is where the floating
   panel itself sits
3. Watch the **server** console as well as the browser one
4. Check specifically for hydration mismatch warnings. Add one route with a deliberate
   mismatch (a `typeof window` branch) first, and confirm it **is** reported — in dev,
   Next 16 echoes browser errors to the terminal; in production it surfaces as React
   error #418. Without that control, a clean console proves nothing
5. Switch the `mode` prop; use the picker — on a control that acts on `pointerdown` (a
   dropdown trigger) and on a text input, as R20 step 4 does, plus a button with an
   `onClickCapture` handler
6. Mount the inspector inside a component that only renders client-side. Then mount the
   observed root **after** the navigator (behind a loading state)
7. `npm run build && npm start` — the **production** build. The recipe's gate renders
   your pages without the panel in production, so use an ungated mount, or Option 2 built with
   `NEXT_PUBLIC_A11Y=1`. With the gate on, check the network log: the inspector chunk is
   never requested
8. Repeat 2–5 against the production build
9. Try mounting it in a Server Component and read the error — under `next dev` **and**
   `next build`, which report it differently

## Expected

- **2** — renders client-side without extra ceremony beyond what the docs describe, and the
  panel's tree **contains the page**: search the panel for the page's `<h1>` and its
  landmarks. A blank panel, or a lone `generic` row, is a fail. The recipe as published
  when the beta.19 dogfood ran never attaches the observed root — a docs defect, whatever
  react version you install. Its fix reaches real-a11y.dev with the beta.20 release;
  next.real-a11y.dev served it first. Once the toast is up, the tree holds
  `Saved` and nothing of the panel's own: a search for `Collapse panel` finds nothing, and
  TAB view lists no panel control. On react 0.1.0-beta.19 both find the panel's title
  bar, the known defect
- **3/4** — **no** hydration errors, no "window is not defined", no SSR crash. This is the whole
  risk of this row. The deliberate mismatch is reported, so the silence is real
- **5** — works as in the example app: nothing the picker lands on opens, takes focus, or
  sees its capture-phase handler run
- **6** — a root that mounts after the navigator still populates (twin: R20 step 6b). On
  react 0.1.0-beta.19 and earlier it stays empty, the known defect; react 0.1.0-beta.20
  attaches it
- **7/8** — the production build behaves like dev. React's dev build tolerates things production
  does not
- **9** — a clear error or documented guidance, not an inscrutable stack trace, in dev and
  in `next build`

## Why this exists

`@real-a11y-dev/react` reads the DOM, and Next.js renders on the server where there is no DOM. That
mismatch produces the two failures that make a library feel unusable: a build-time crash
(`window is not defined`) or a hydration warning that floods the console on every page.

Both are invisible in a client-only example app, which is exactly what the pre-publish row (**R20**)
uses. Next.js App Router is also the most common React setup a new user will arrive with, so a
failure here blocks the largest single group of adopters.

Step 7 matters independently: dev-mode React is forgiving in ways production isn't, so "works in
dev" is not evidence.

The panel-contains-the-page check in **2** and the controls in **4** came from the beta.19
dogfood. Every earlier run passed **2** on a panel that was visibly there and observed nothing:
copied verbatim, the recipe's Option 1 never attaches its ref and its first snippet observes an
empty `<div>`, and neither logs anything. "No hydration warnings" had the same shape — it is
only evidence once a deliberate mismatch shows up in the same console.
