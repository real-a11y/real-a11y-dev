---
title: Next.js (App Router + React 19)
description: Full Real A11y integration for Next.js 15 + React 19 — client components, SSR gating, Vitest with next-intl mocks, Playwright e2e configured against next dev.
---

# Next.js (App Router + React 19)

Everything on this page assumes Next.js 15 with the App Router and React 19. For legacy Pages Router or React 18, the patterns still work — they're just less load-bearing.

## Install

```sh
npm install -D @real-a11y-dev/react @real-a11y-dev/testing @real-a11y-dev/inspector
```

`@real-a11y-dev/react` is a dev dependency — you'll gate the panel so it never ships to production. See [Keep it out of production](/guide/getting-started#keep-it-out-of-production).

---

## Mount `<SemanticNavigator />` in a client component

Any component that renders the inspector must be a **Client Component**. The inspector uses refs, DOM APIs, and (in floating mode) a portal to `document.body` — none of that is available during server rendering.

```tsx
// app/components/A11yPanel.tsx
"use client";

import { useRef, type ReactNode } from "react";
import { SemanticNavigator } from "@real-a11y-dev/react";

export function A11yPanel({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={rootRef}>
      {children}
      <SemanticNavigator root={rootRef} floating highlightOnHover />
    </div>
  );
}
```

Wrap your pages with it in the root layout, so the panel observes what they render:

```tsx
// app/layout.tsx
import type { ReactNode } from "react";
import { A11yPanel } from "./components/A11yPanel";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <A11yPanel>{children}</A11yPanel>
      </body>
    </html>
  );
}
```

`root` is the element the panel observes: here, the `<div>` that holds your pages. It has to be attached to an element that holds them. A ref that never reaches an element, or one on an empty `<div>`, leaves the panel blank, and nothing is logged.

The `floating` mode portals into `document.body`. The library already guards against SSR — the portal only activates after the first client commit — so you can render this component from a Server Component without a crash.

## Gate it out of production

Two options — pick the one that matches your toolchain.

### Option 1 — static gate (fully tree-shaken)

```tsx
// app/components/A11yPanel.tsx
"use client";

import { useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";

const SemanticNavigator = dynamic(
  () => import("@real-a11y-dev/react").then((m) => m.SemanticNavigator),
  { ssr: false },
);

export function A11yPanel({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);

  // The wrapper renders in every build, so your pages sit in the same DOM in
  // development and production. In a production build the condition is
  // statically false: the panel never renders, and its chunk is never requested.
  return (
    <div ref={rootRef}>
      {children}
      {process.env.NODE_ENV === "development" && (
        <SemanticNavigator root={rootRef} floating />
      )}
    </div>
  );
}
```

Note: `dynamic(..., { ssr: false })` has to live **inside a Client Component** in the App Router. Putting it in a Server Component throws a build-time error.

### Option 2 — environment flag

For staging deployments where you want to toggle the panel with an env var, use the component from Option 1 with this condition in place of its `NODE_ENV` check:

```tsx
{process.env.NEXT_PUBLIC_A11Y === "1" && (
  <SemanticNavigator root={rootRef} floating />
)}
```

This ships the panel chunk in the production bundle as a separate chunk — it just doesn't run. Cheaper DX, more bytes.

---

## Unit tests — Vitest + next-intl + Testing Library

The App Router's `next-intl` navigation helpers (`Link`, `usePathname`, etc.) read from the request-scoped intl context, which doesn't exist in a unit-test renderer. Mock them in `vitest.setup.tsx`:

```tsx
// vitest.setup.tsx
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

afterEach(cleanup);

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    href,
    locale,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    locale?: string;
    children: ReactNode;
  }) => (
    <a href={locale ? `/${locale}${href}` : href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => "/",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));
```

Wire it into `vitest.config.ts`:

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.tsx"],
    server: {
      // jest-dom ESM import needs this on Node strict resolution
      deps: { inline: ["@testing-library/jest-dom"] },
    },
  },
});
```

Note the file is `.tsx` — the mock itself renders JSX.

### Test a component that uses `Link`

```tsx
// src/__tests__/Breadcrumb.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { assertNoUnlabeledInteractive } from "@real-a11y-dev/testing";
import { Breadcrumb } from "@/components/Breadcrumb";

it("renders locale-scoped links and passes the audit", () => {
  const { container } = render(
    <Breadcrumb
      locale="en"
      items={[{ label: "Home", href: "/" }, { label: "Services", href: "/services" }]}
    />,
  );

  expect(screen.getByRole("link", { name: /services/i }))
    .toHaveAttribute("href", "/en/services");

  expect(() => assertNoUnlabeledInteractive(container)).not.toThrow();
});
```

Only the *Next internals* are mocked. Your own components render for real.

---

## E2E — Playwright against `next dev`

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

```ts
// e2e/home.spec.ts
import { test, expect } from "@playwright/test";
import { attach } from "@real-a11y-dev/testing/playwright";

test("home page structural audits", async ({ page }) => {
  await page.goto("/en");
  const sn = await attach(page);

  await sn.assertHeadingOrder();
  await sn.assertNoUnlabeledInteractive();
  await sn.assertLandmarkStructure();

  expect(await sn.treeSnapshot()).toMatchSnapshot("home-audit.txt");
});
```

The same `attach(page)` handle exposes `outlineSnapshot` and `tabSequenceSnapshot` — commit all three as fixtures and let PRs diff against them.

For **cross-page** CI auditing, reach for the CLI instead of raw text snapshots: `npx real-a11y snapshot` writes one findings-aware JSON artifact from your `a11y.config.json`, and `npx real-a11y diff base.json pr.json` classifies findings as new / changed / fixed — robust to the DOM churn (re-indentation, renumbered locators) that defeats a line diff. See the [CI A11y Diff Bot](/guide/ci-diff-bot) recipe and the [CLI package](/packages/cli) reference.

---

## Known constraints

- **Server Components can't render `<SemanticNavigator />`.** The component uses `useRef` + `useEffect`. Wrap it in a Client Component (`"use client"`).
- **`next/dynamic({ ssr: false })` must live inside a Client Component.** In Next 15 this is a build-time error, not a runtime one.
- **`@testing-library/react` must be ≥ 16.1** for React 19. Older versions declare `react: ^18` as a peer and fail to install.
- **`@playwright/test` version must match Next's peer range.** Next 15 declares `@playwright/test@^1.51.1` as an optional peer — install ≥ that version to avoid `ERESOLVE`.

See the [Peer Dependencies](/recipes/peer-dependencies) recipe for the full matrix.
