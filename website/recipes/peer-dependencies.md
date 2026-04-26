---
title: Peer Dependencies — compatibility matrix
description: Which React, Storybook, Playwright, and Testing Library versions work with each Real A11y package. Common ERESOLVE errors and their fixes.
---

# Peer Dependencies

Real A11y is a lean dev-time audit suite. It relies on a small set of peers you probably already have — React, Storybook, Playwright — plus a couple of popular companion libraries (Testing Library) that don't formally peer on anything but where version mismatches still bite. This page is the matrix.

## Compatibility matrix

| Real A11y package | Node | React | Storybook | Playwright |
|---|---|---|---|---|
| `@real-a11y-dev/core` | ≥ 20 | — | — | — |
| `@real-a11y-dev/inspector` | ≥ 20 | — | — | — |
| `@real-a11y-dev/react` | ≥ 20 | ≥ 18 | — | — |
| `@real-a11y-dev/testing` | ≥ 20 | — | — | — |
| `@real-a11y-dev/testing/playwright` | ≥ 20 | — | — | ≥ 1.49 |
| `@real-a11y-dev/storybook-addon` | ≥ 20 | ≥ 18 | ≥ 8.0 | — |

`@real-a11y-dev/core` and `@real-a11y-dev/inspector` have no runtime peers — they use standard DOM APIs. `@real-a11y-dev/testing` takes any `Element` root, so your test runner and component renderer are entirely your choice.

---

## Companion libraries

Real A11y packages don't declare these as peers, but most users install at least one of them alongside `@real-a11y-dev/testing`. The versions below are what works cleanly with React 19 — pinning older versions surfaces peer errors that *look* Real A11y-related but aren't.

### `@testing-library/react`

Not a peer of any Real A11y package — you can use `@real-a11y-dev/testing` without it (just pass any `Element` as the audit root). But if you use it: version `16.0.0` declares `react: ^18` as its own peer. Installing it alongside React 19 gives:

```
npm error ERESOLVE could not resolve
npm error While resolving: your-app
npm error Found: react@19.2.4
npm error Could not resolve dependency:
npm error peer react@"^18.0.0" from @testing-library/react@16.0.0
```

**Fix:** install `@testing-library/react@^16.1.0` (or later). Version 16.1 relaxed the peer to `react: ^18 || ^19`.

```sh
npm install -D @testing-library/react@^16.1.0
```

### `@playwright/test` in Next.js 15 projects

Next 15 declares `@playwright/test@^1.51.1` as an **optional peer**. `@real-a11y-dev/testing/playwright` itself is happy with `^1.49`, but npm resolves against Next's optional peer and errors out:

```
npm error peerOptional @playwright/test@"^1.51.1" from next@15.5.14
```

**Fix:** install `@playwright/test@^1.51.1` to satisfy both.

```sh
npm install -D @playwright/test@^1.51.1
```

---

## `@real-a11y-dev/storybook-addon` — Storybook version

The addon's manager imports from `@storybook/manager-api` v8. Storybook 7 or earlier won't work. Storybook ≥ 8.0 is required.

## `@real-a11y-dev/react` — React version

Any React ≥ 18 works. On React 19 specifically, the inspector's floating-panel mode is SSR-safe (it gates the portal behind a client-mount effect), but you still need `"use client"` at the consumer boundary — see the [Next.js recipe](/recipes/nextjs) for the full pattern.

## `@real-a11y-dev/testing/playwright` — browser install

After adding the package, install the Chromium engine:

```sh
npx playwright install chromium
# Linux CI: add --with-deps to install required system packages
npx playwright install chromium --with-deps
```

The adapter only uses Chromium — Firefox and WebKit aren't needed for the audit bundle.

---

## Single React instance

Several of the edge cases above (especially in Storybook and SSR apps) boil down to **having two copies of React resolved on the page**. The manager mixes React internals from one copy with jsx-runtime calls against another, and hooks die.

Verify a single resolution:

```sh
npm ls react react-dom
```

One version per package, one path. If you see more than one, look at transitive deps that pin React to a specific version (often older Storybook addons or legacy test helpers) and either upgrade them or override the version via `overrides` / `resolutions` / `pnpm.overrides` in `package.json`.

```json
{
  "overrides": {
    "react": "19.2.4",
    "react-dom": "19.2.4"
  }
}
```

---

## Clean install recipe

When peer conflicts get tangled, a clean install clears the lockfile state:

```sh
rm -rf node_modules package-lock.json
npm install
```

For pnpm:

```sh
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

Re-run `npm ls react` / `pnpm why react` afterwards to confirm a single resolution.
